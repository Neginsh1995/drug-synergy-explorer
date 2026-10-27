#!/usr/bin/env bash
# Agent step for one cell line: review its shortlisted drug pairs with an LLM through Meterless
# Nightshift (Proposer-Critic rounds on the Markovian engine, PubMed evidence retrieved in code)
# and write the pathway and evidence ranking.
#
#   agent/run_agent.sh results/agent/UACC62/agent_input.csv results/agent/UACC62
#   agent/run_agent.sh --check        only check Node.js, packages and Nightshift, then exit
# Exit codes: 0 done, 1 setup or agent error, 3 Nightshift not reachable.
#
# Usually called by ../run_pipeline.sh, which writes the input file from Zetaris first.
# Settings (environment, or .env.local in the project folder):
#   METERLESS_BASE_URL      default http://127.0.0.1:8088
#   METERLESS_RUNTIME_TOKEN default: read from METERLESS_TOKEN_FILE (never printed)
#   METERLESS_TOKEN_FILE    default ~/Library/Application Support/ai.meterless.runtime/proxy-token,
#                           else .../ai.meterless.nightshift.m1m4/runtime-token (Mac M1-M4 edition)
#   MAX_EXAMINE             pairs examined at most, in z_HSA order (agent default 40)
#   TARGET_KEEP             stop after this many pairs with synergy evidence (agent default 5)
#   SYNERGY_ACCEPT          strict | include_mechanistic (agent default)
#   METERLESS_MODEL         the model Nightshift routes to, e.g. claude-sonnet-4-5-20250929 (default meterless/auto)
#   AGENT_DIR               the agent project (default agent/synergy_agent)
# Output in the output folder: ranked.csv (pairs kept, with pathways and evidence), screened.csv
# (every decision), ranked.md, rounds/, markovian-history/, progress.json.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
CHECK_ONLY=0; [[ "${1:-}" == "--check" ]] && CHECK_ONLY=1
if [[ $CHECK_ONLY == 0 ]]; then
  INPUT="${1:-${AGENT_INPUT_CSV:-}}"
  OUTPUT="${2:-${AGENT_OUTPUT_DIR:-}}"
  [[ -n "$INPUT" && -n "$OUTPUT" ]] || { echo "usage: $0 <agent_input.csv> <output folder>  |  $0 --check" >&2; exit 1; }
  [[ -f "$INPUT" ]] || { echo "Input not found: $INPUT" >&2; exit 1; }
  INPUT="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
  mkdir -p "$OUTPUT"; OUTPUT="$(cd "$OUTPUT" && pwd)"
fi
AGENT_DIR="${AGENT_DIR:-$HERE/synergy_agent}"

# Load METERLESS_* and agent limits from .env.local without overriding the environment.
if [[ -f "$ROOT/.env.local" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^(METERLESS_[A-Z_]+|MAX_EXAMINE|TARGET_KEEP|SYNERGY_ACCEPT)$ ]] && [[ -z "${!key:-}" ]] && export "$key=$value"
  done < "$ROOT/.env.local"
fi

BASE="${METERLESS_BASE_URL:-http://127.0.0.1:8088}"
BASE="${BASE%/}"; BASE="${BASE%/v1}"   # accept either form of the address
# Default token locations: the runtime's proxy-token, or the Mac M1-M4 edition's runtime-token.
if [[ -n "${METERLESS_TOKEN_FILE:-}" ]]; then TOKEN_FILE="$METERLESS_TOKEN_FILE"
else
  TOKEN_FILE="$HOME/Library/Application Support/ai.meterless.runtime/proxy-token"
  [[ -f "$TOKEN_FILE" ]] || TOKEN_FILE="$HOME/Library/Application Support/ai.meterless.nightshift.m1m4/runtime-token"
fi

# 0) The agent project, its packages and Node.js must be in place.
[[ -f "$AGENT_DIR/src/pilot.ts" ]] || { echo "Agent project not found: $AGENT_DIR/src/pilot.ts" >&2; exit 1; }
command -v npx >/dev/null || { echo "Node.js is not installed (npx not found). Install the LTS from nodejs.org." >&2; exit 1; }
for d in "$AGENT_DIR" "$HERE/reference"; do
  [[ -d "$d/node_modules" ]] || { echo "Packages missing in $d: run  (cd \"$d\" && npm ci)" >&2; exit 1; }
done

# 1) Token: use the env var if set, else read it from Nightshift's token file (never printed).
if [[ -z "${METERLESS_RUNTIME_TOKEN:-}" ]]; then
  [[ -f "$TOKEN_FILE" ]] || { echo "No Nightshift token. Open Nightshift once, or set METERLESS_RUNTIME_TOKEN or METERLESS_TOKEN_FILE." >&2; exit 3; }
  METERLESS_RUNTIME_TOKEN="$(cat "$TOKEN_FILE")"
fi
export METERLESS_RUNTIME_TOKEN METERLESS_BASE_URL="$BASE"

# 2) Preflight: Nightshift must answer with meterless/* model ids.
models="$(mktemp)"; trap 'rm -f "$models"' EXIT
code=$(curl -s -o "$models" -w '%{http_code}' -m 5 \
  -H "Authorization: Bearer $METERLESS_RUNTIME_TOKEN" -H "meterless-app: markovian-drug-synergy" \
  "$BASE/v1/models" || true)
if [[ "$code" != "200" ]] || ! grep -q 'meterless/' "$models"; then
  echo "Nightshift not ready (HTTP $code at $BASE/v1/models). Open the app, check Setup > Providers/Local models, then retry." >&2
  exit 3
fi
echo "Nightshift OK. Model: ${METERLESS_MODEL:-meterless/auto}"
[[ $CHECK_ONLY == 1 ]] && exit 0

# 3) Run the agent and rebuild the readable summary, both in the output folder.
export AGENT_INPUT_CSV="$INPUT" AGENT_OUTPUT_DIR="$OUTPUT"
for v in MAX_EXAMINE TARGET_KEEP SYNERGY_ACCEPT; do [[ -n "${!v:-}" ]] && export "$v"; done
cd "$AGENT_DIR"
npx tsx src/pilot.ts
npx tsx src/render-ranked-md.ts

echo
echo "Agent output in ${OUTPUT#"$ROOT"/}:"   # project-relative, so logs hold no home folder
echo "  ranked.csv / ranked.md      pairs with synergy evidence: pathways, evidence, verified PMIDs"
echo "  screened.csv                every pair examined and the decision"
echo "  rounds/, markovian-history/ Proposer + Critic rounds and engine history"
echo "  progress.json               run status"
