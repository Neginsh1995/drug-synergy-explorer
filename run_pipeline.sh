#!/usr/bin/env bash
# The whole pipeline, for one cell line or all of them:
#   1. Zetaris: all drug pairs -> predictions -> synergy and confidence filters -> ranked shortlist
#      results/most_promising_<CELL>_PubChemCID.csv, plus the agent's input
#      results/agent/<CELL>/agent_input.csv (the shortlist + cell line name, tissue, cancer type)
#   2. Agent: LLM review through Meterless Nightshift -> pathways and evidence
#      results/agent/<CELL>/ranked.csv, screened.csv, ranked.md, rounds/, progress.json
#   3. Zetaris: refresh the agent results table (DRUG_SYNERGY_DATA.agent_ranked) after each cell
#      line, so the Explorer page shows results while a long run is still going
#
#   ./run_pipeline.sh UACC62                 one cell line (or several: UACC62 HCT116)
#   ./run_pipeline.sh --all                  every cell line with predictions (170)
#   ./run_pipeline.sh --all --skip-done      resume: skip cell lines that already finished
# Options:
#   --no-agent      step 1 only (shortlists)
#   --examine N     examine at most N pairs per cell line (agent default 40)
#   --keep K        stop a cell line after K pairs with synergy evidence (agent default 5)
#   --skip-done     skip cell lines whose results/agent/<CELL>/progress.json says the run finished
# Every run is logged to results/agent/logs/, and results/agent/run_summary.csv lists every cell
# line's shortlist size, pairs examined, pairs kept and agent status.
# If Nightshift stops answering, the run stops; rerun with --skip-done to continue (finished
# Proposer/Critic rounds are reused, not paid for again).
set -uo pipefail
cd "$(dirname "$0")"

usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
CELLS=(); AGENT=1; SKIP_DONE=0; ALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) ALL=1 ;;
    --no-agent) AGENT=0 ;;
    --examine) export MAX_EXAMINE="${2:?}"; shift ;;
    --keep) export TARGET_KEEP="${2:?}"; shift ;;
    --skip-done) SKIP_DONE=1 ;;
    -h|--help) usage ;;
    -*) echo "unknown option $1" >&2; usage ;;
    *) CELLS+=("$1") ;;
  esac
  shift
done
PY=.venv/bin/python
[[ -x "$PY" ]] || { echo "No .venv: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2; exit 1; }
quiet() { grep -v -E '^(WARNING|SLF4J|$)' || true; }

mkdir -p results/agent/logs
LOG="results/agent/logs/run_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "Log: $LOG"

# A cell line is done when its agent run reached a final status (not "running" or "blocked_*").
finished() {
  local f="results/agent/$1/progress.json"
  [[ -f "$f" ]] && grep -q -E '"status": *"(target_reached|stopped_max_examined|stopped_candidates_exhausted)"' "$f"
}

if [[ $ALL == 1 ]]; then
  while IFS= read -r c; do [[ -n "$c" ]] && CELLS+=("$c"); done < <($PY app/pairs_app.py --list-cell-lines 2>/dev/null)
  [[ ${#CELLS[@]} -gt 0 ]] || { echo "Could not list cell lines from Zetaris." >&2; exit 1; }
fi
[[ ${#CELLS[@]} -gt 0 ]] || usage

# Check the agent's setup and Nightshift once, before spending time on shortlists.
if [[ $AGENT == 1 ]]; then
  agent/run_agent.sh --check || { echo "Agent not ready (see above). Use --no-agent for shortlists only."; exit 1; }
fi

echo "Cell lines: ${#CELLS[@]}   agent: $([[ $AGENT == 1 ]] && echo on || echo off)   max examine: ${MAX_EXAMINE:-default}   keep: ${TARGET_KEEP:-default}"
DONE=(); EMPTY=(); FAILED=(); SKIPPED=(); STOPPED=0; i=0
for CELL in "${CELLS[@]}"; do
  i=$((i + 1))
  echo; echo "================ [$i/${#CELLS[@]}] $CELL  $(date +%H:%M:%S)"
  if [[ $SKIP_DONE == 1 ]] && { finished "$CELL" || { [[ $AGENT == 0 ]] && [[ -f "results/agent/$CELL/agent_input.csv" ]]; }; }; then
    SKIPPED+=("$CELL"); echo "already done, skipped"; continue
  fi
  if ! out="$($PY app/pairs_app.py "$CELL" --agent-input 2>&1)"; then
    echo "$out" | quiet; FAILED+=("$CELL (shortlist)"); continue
  fi
  echo "$out" | quiet
  INPUT="results/agent/$CELL/agent_input.csv"
  if [[ ! -f "$INPUT" ]]; then
    # the cell line name in Zetaris may differ in case from what was typed
    INPUT="$(echo "$out" | sed -n 's/^Agent input //p')"
  fi
  [[ $AGENT == 1 ]] || { DONE+=("$CELL"); continue; }
  if [[ "$(wc -l < "$INPUT")" -le 1 ]]; then
    echo "No promising pairs; agent not run."; EMPTY+=("$CELL"); continue
  fi
  agent/run_agent.sh "$INPUT" "$(dirname "$INPUT")"; rc=$?
  if [[ $rc == 0 ]]; then
    DONE+=("$CELL")
    $PY app/pairs_app.py --refresh-agent-results 2>&1 | quiet
  elif [[ $rc == 3 ]]; then
    FAILED+=("$CELL (Nightshift)"); STOPPED=1
    echo "Nightshift stopped answering; stopping. Rerun with --skip-done to continue."; break
  else
    FAILED+=("$CELL (agent)")
  fi
done

# One row per cell line that has an agent folder (this run and earlier ones).
$PY - <<'EOF'
import csv, json, pathlib
rows = []
for d in sorted(p for p in pathlib.Path("results/agent").iterdir() if p.is_dir() and p.name != "logs"):
    inp = d / "agent_input.csv"
    if not inp.exists():
        continue
    with inp.open(newline="") as f:
        n = sum(1 for _ in csv.DictReader(f))
    prog = {}
    if (d / "progress.json").exists():
        try:
            prog = json.loads((d / "progress.json").read_text())
        except ValueError:
            pass
    status = prog.get("status") or ("no promising pairs" if n == 0 else
                                    "earlier run, no progress.json" if (d / "ranked.csv").exists() else "agent not run")
    rows.append([d.name, n, prog.get("examined", prog.get("pairs_processed", "")), prog.get("kept", ""), status])
with open("results/agent/run_summary.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cell_line", "promising_pairs", "examined", "kept", "agent_status"])
    w.writerows(rows)
print(f"\nSummary of {len(rows)} cell line(s): results/agent/run_summary.csv")
EOF

echo; echo "================ Summary"
echo "done:    ${#DONE[@]} ${DONE[*]:-}"
[[ ${#EMPTY[@]} -gt 0 ]] && echo "no promising pairs: ${#EMPTY[@]} ${EMPTY[*]}"
[[ ${#SKIPPED[@]} -gt 0 ]] && echo "skipped (already done): ${#SKIPPED[@]}"
[[ ${#FAILED[@]} -gt 0 ]] && echo "failed:  ${#FAILED[@]} ${FAILED[*]}"
[[ $STOPPED == 1 ]] && echo "stopped early: Nightshift not reachable"
echo "Log: $LOG"
[[ ${#FAILED[@]} -eq 0 ]]
