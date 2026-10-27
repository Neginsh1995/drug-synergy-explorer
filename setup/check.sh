#!/usr/bin/env bash
# Check every part of the setup, in install order. Read-only: changes nothing.
#   setup/check.sh
# Each line prints PASS or FAIL; the script exits non-zero if anything failed.
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.docker/bin:$PATH"
FAILED=0
pass() { printf '[PASS] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; FAILED=1; }

# 1. Source files in the Docker volume
if docker volume inspect drug-synergy-data >/dev/null 2>&1; then
  pass "volume drug-synergy-data exists"
  missing=$(docker run --rm -v drug-synergy-data:/data postgres:16-alpine sh -c 'for f in Output_Prediction/Output.csv Cell_Drug_Annotation_Mapping/Drug_metadata.csv Cell_Drug_Annotation_Mapping/cell_lines_metadata.csv Whole_Samples/DrugComb_V2_measured_combinations.csv; do [ -f /data/$f ] || echo $f; done' 2>/dev/null)
  [ -z "$missing" ] && pass "volume holds the four data files the pipeline needs" || fail "volume is missing: $missing (run setup/load_source_files.sh)"
else
  fail "volume drug-synergy-data missing (run setup/load_source_files.sh)"
fi

# 2. Zetaris engine running and mounting the volume
if docker ps --format '{{.Names}}' | grep -q '^zetaris-driver-1$'; then
  pass "Zetaris engine container is running"
  docker exec zetaris-driver-1 test -f /home/zetaris/customer-data/shared/drug-synergy-data/Output_Prediction/Output.csv \
    && pass "engine sees the files at /home/zetaris/customer-data/shared/drug-synergy-data" \
    || fail "engine does not see the files (copy setup/docker-compose.override.yml, then: docker compose up -d --no-deps driver)"
else
  fail "Zetaris engine container zetaris-driver-1 is not running (docker compose up -d in the platform folder)"
fi
nc -z localhost 10000 2>/dev/null && pass "JDBC port 10000 is open" || fail "JDBC port 10000 is closed"

# Python environment
[ -x .venv/bin/python ] && pass "Python environment .venv exists" || { fail "no .venv (python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)"; echo; exit 1; }
.venv/bin/python -c "import jaydebeapi" 2>/dev/null && pass "jaydebeapi installed" || fail "jaydebeapi missing (.venv/bin/pip install -r requirements.txt)"
[ -f .env.local ] && pass ".env.local exists" || fail ".env.local missing (copy .env.example and fill it in)"

# 3-5. Zetaris objects, data quality and the pipeline
.venv/bin/python - <<'EOF' 2>/dev/null
import sys
sys.path.insert(0, "app")
try:
    import pairs_app as app
except Exception as e:
    print(f"[FAIL] cannot load app/pairs_app.py: {e}"); sys.exit(1)
ok = True
def check(label, cond):
    global ok
    print(("[PASS] " if cond else "[FAIL] ") + label); ok &= bool(cond)
try:
    check("Zetaris answers SELECT 1", app.db.query("SELECT 1 AS one")[0]["one"] == 1)
    for table, expected in (("predictions", 719112), ("drug_metadata", 3139), ("cell_lines_metadata", 2320),
                            ("measured_combinations", 359556)):
        n = app.db.query(f"SELECT COUNT(*) AS n FROM DRUG_SYNERGY_DATA.{table}")[0]["n"]
        check(f"source table DRUG_SYNERGY_DATA.{table}: {n:,} rows (expected {expected:,})", n == expected)
    for table, expected in (("drugs", 3139), ("cell_lines", 2320), ("synergy_results", 719112),
                            ("measured_combinations", 359556)):
        n = app.db.query(f"SELECT COUNT(*) AS n FROM {app.USL}.{table}")[0]["n"]
        check(f"semantic layer {app.USL}.{table}: {n:,} rows (expected {expected:,})", n == expected)
    orphans = app.db.query(
        f"SELECT COUNT(*) AS n FROM {app.USL}.synergy_results r LEFT JOIN {app.USL}.drugs d1 ON r.drug_1 = d1.pubchem_cid "
        f"LEFT JOIN {app.USL}.drugs d2 ON r.drug_2 = d2.pubchem_cid LEFT JOIN {app.USL}.cell_lines c ON r.cell_line_id = c.cell_line_id "
        "WHERE d1.pubchem_cid IS NULL OR d2.pubchem_cid IS NULL OR c.cell_line_id IS NULL")[0]["n"]
    check(f"every prediction links to a drug and a cell line ({orphans} orphans)", orphans == 0)
    r = app.promising_pairs("UACC62")
    n = r["counts"]
    check(f"pipeline for UACC62: {n['all_pairs']:,} pairs -> {n['with_predictions']:,} -> {n['synergy']} -> {n['promising']} "
          "(expected 4,921,927 -> 10,121 -> 905 -> 432)",
          (n["all_pairs"], n["with_predictions"], n["synergy"], n["promising"]) == (4921927, 10121, 905, 432))
    top = r["pairs"][0]
    check(f"UACC62 top pair: {top['drug_1_name']} + {top['drug_2_name']}, z_HSA {top['z_HSA']:.4f} "
          "(expected Fludarabine + Y-39983 dihydrochloride 2/3 H2O, 3.7411)",
          (top["drug_1"], top["drug_2"], round(top["z_HSA"], 4)) == (657237, 73013358, 3.7411))
    check(f"UACC62 annotation: {r['annotation']['tissue']}", r["annotation"]["tissue"] == "skin")
except Exception as e:
    print(f"[FAIL] Zetaris query failed: {e}"); ok = False
sys.exit(0 if ok else 1)
EOF
[ $? -eq 0 ] || FAILED=1

# Agent (optional: reported, not required for the Zetaris part)
echo "-- agent"
if command -v npx >/dev/null; then pass "Node.js $(node -v)"; else echo "[INFO] Node.js not installed (needed for the agent)"; fi
if [ -d agent/synergy_agent/node_modules ] && [ -d agent/reference/node_modules ]; then
  pass "agent packages installed"
  t=$(cd agent/synergy_agent && npx vitest run --config vitest.config.ts 2>&1 | grep -E "^ +Tests" | tr -s ' ')
  echo "$t" | grep -q "failed" && fail "agent tests:$t" || pass "agent tests:$t"
else
  echo "[INFO] agent packages missing: (cd agent/synergy_agent && npm ci) && (cd agent/reference && npm ci)"
fi
TOKEN_FILE="${METERLESS_TOKEN_FILE:-$HOME/Library/Application Support/ai.meterless.runtime/proxy-token}"
[[ -f "$TOKEN_FILE" ]] || TOKEN_FILE="$HOME/Library/Application Support/ai.meterless.nightshift.m1m4/runtime-token"
if [ -f "$TOKEN_FILE" ] && curl -s -m 5 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
     http://127.0.0.1:8088/v1/models 2>/dev/null | grep -q 200; then
  pass "Meterless Nightshift answers at http://127.0.0.1:8088"
else
  echo "[INFO] Meterless Nightshift not reachable (needed to run the agent, not to view its results)"
fi
.venv/bin/python - <<'EOF' 2>/dev/null
import sys; sys.path.insert(0, "app")
import pairs_app as app
try:
    rows = app.db.query(f"SELECT cell_line, COUNT(*) AS n FROM {app.AGENT_TABLE} GROUP BY cell_line")
    print(f"[PASS] agent results in Zetaris: {sum(r['n'] for r in rows)} pairs for {len(rows)} cell line(s)")
except Exception:
    print("[INFO] no agent results in Zetaris yet (run the agent, then sql/04_agent_results.sql once)")
EOF

# 6. The page server (only if it is running)
if curl -s -o /dev/null http://127.0.0.1:8765/ 2>/dev/null; then
  curl -s http://127.0.0.1:8765/cell_lines | grep -q '"UACC62"' && pass "page server answers at http://127.0.0.1:8765/" || fail "page server is up but /cell_lines did not answer"
  grep -q "SynergyTumor Board" <<< "$(curl -s http://127.0.0.1:8765/)" && pass "dashboard at http://127.0.0.1:8765/" || fail "dashboard not served at /"
  grep -q "Drug Synergy Explorer" <<< "$(curl -s http://127.0.0.1:8765/explorer)" && pass "team Explorer at http://127.0.0.1:8765/explorer" || fail "Explorer not served at /explorer"
  curl -s http://127.0.0.1:8765/modalities | grep -q '"entity": "cell_line"' && pass "modalities read from the files (/modalities)" || fail "/modalities did not answer (HACKATHON_DATA_DIR in .env.local?)"
else
  echo "[INFO] page server not running (start it with: .venv/bin/python app/pairs_app.py --serve)"
fi

echo; [ $FAILED -eq 0 ] && echo "All checks passed." || echo "Some checks failed; see above."
exit $FAILED
