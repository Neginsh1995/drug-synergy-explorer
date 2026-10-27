-- =============================================================================
-- 04 Agent results: register the agent's rankings so Zetaris and the Explorer can read them.
--
-- The project's results/agent folder is mounted read-only into the Zetaris engine at
--   /home/zetaris/customer-data/shared/agent-results/
-- (setup/docker-compose.override.yml). Each cell line's run writes <CELL>/ranked.csv there; this one
-- table reads all of them. Run it once, after the first agent run (Zetaris needs one file to read
-- the columns). New runs appear after `app/pairs_app.py --refresh-agent-results`, which
-- run_pipeline.sh calls.
--
-- To recreate it (e.g. after the column names change): DROP LIGHTNING DATABASE TABLE DRUG_SYNERGY_DATA.agent_ranked;
-- then run this file again. Columns are read as text. Arrays (verified_pmids, verified_dois, evidence_citations) are JSON strings.
-- =============================================================================

CREATE LIGHTNING FILESTORE TABLE agent_ranked FROM DRUG_SYNERGY_DATA FORMAT CSV OPTIONS (path "file:///home/zetaris/customer-data/shared/agent-results/*/ranked.csv", header "true", inferSchema "false", delimiter ",", quote '"', escape '"', multiLine "true");
SELECT cell_line, COUNT(*) AS pairs FROM DRUG_SYNERGY_DATA.agent_ranked GROUP BY cell_line ORDER BY cell_line;
