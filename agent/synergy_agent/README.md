> **Integration note (Drug Synergy Explorer).** This agent was adapted from the UACC62 skin pilot to
> work for any cell line; changes are marked `integration:` in the code. It reads
> `AGENT_INPUT_CSV` (the Zetaris shortlist plus `cell_line_name`, `tissue`, `cancer_type` per row)
> and writes to `AGENT_OUTPUT_DIR`; `../run_agent.sh` and `../../run_pipeline.sh` set both. The
> output column `skin_pathway_or_phenotype` is now `tissue_pathway_or_phenotype`. The description
> below is the original pilot's.

# Cell-line-specific skin synergy literature pilot

Evaluates `Drug1 + Drug2 + cell_line` units from `most_promising_UACC62_PubChemCID.csv` against PubMed records retrieved in code, then ranks evidence of skin-related synergy. **This is not a clinical recommendation.**

## Architecture (reused, not replaced)

| Piece | Where |
|---|---|
| Nightshift / Meterless Runtime 0.90.0 | `src/meterless.ts`, contract in `docs-agent-ready/add-meterless-provider.md` and `docs-nightshift/hotspot.md` |
| Markovian | `reference/` — **one `Markovian.run` per research unit**, RESEARCH mode, max 3 chunks = 3 scientific rounds |
| PubMed | NCBI E-utilities in `src/pubmed.ts` (never the LLM) |
| Scoring | Deterministic heuristic in `src/scoring.ts` |

Every runtime LLM call (Proposer, Critic) goes through Nightshift (`meterless-app: markovian-uacc62-skin`). There is **no** OpenAI/Anthropic/Google fallback. If Nightshift is offline or unauthorized, the pilot stops.

Markovian compression uses the reference marker/heuristic cascade (no extra LLM compressor) so scientific round counting stays honest.

## Cell-line provenance

The CSV has a `cell_line` column. In this file every row is `85`. That **row-specific CSV value** is the cell line. The filename `most_promising_UACC62_PubChemCID.csv` is **not** used as cell-line evidence and is not mapped to UACC-62.

- `cell_line` / `cell_line_original`: the CSV string (e.g. `85`)
- `cell_line_provenance`: `source_csv_column:cell_line (row-specific; filename is not used as cell-line evidence)`
- Missing `cell_line` is rejected. Nothing is filled in.

## Pair ID

`cid{drug1}_{drug2}_cl{sanitized_cell_line}`

Example: `cid657237_73013358_cl85`. The same drug pair in two cell lines cannot collide.

## Pilot selection (exactly five units)

Eligible rows: non-empty `drug_1`, `drug_2`, `cell_line` (PubChem CIDs). Sort by `z_HSA` descending, then `source_row_id` ascending. Take **5**. Stop. Do not continue the CSV.

`source_row_id` is the 1-based data-row index in the file (header is not counted).

## Evidence classes and scores

Heuristic only — not a validated synergy model.

| `evidence_class` | base score |
|---|---:|
| `direct_experimental_synergy_exact_cell` | 90 |
| `combination_effect_exact_cell` | 70 |
| `synergy_other_model` | 50 |
| `mechanistic_pathway_only` | 30 |
| `computational_prediction_only` | 20 |
| `insufficient_or_conflicting` | 10 |

Penalties: missing abstract −10; negative/contradictory text −8; high-severity critic issues −5 each (cap −20). `direct_experimental_synergy` is `yes`/`no`/`unknown` and is never inferred from mechanism alone.

## Output

- `rounds/<pairID>_round<N>.md` — one file per scientific round, never overwritten
- `ranked.csv` — final assessments (`accepted` or `unresolved` after the workflow). Arrays are JSON strings.
- `progress.json` — selection, provider status, stop confirmation

`ranked.csv` columns are listed in `src/artifacts.ts` (`RANKED_COLUMNS`).

## Run

1. `npm test` at the repo root (pilot unit tests + Markovian reference tests).
2. Conformance: `cd reference && MARKOVIAN_IMPL=$PWD/src/index.ts npx tsx ../conformance/runner.ts`
3. Start Nightshift so `GET http://127.0.0.1:8088/v1/models` returns `meterless/*` ids. If 401/403, set `METERLESS_RUNTIME_TOKEN` from `<stateDir>/proxy-token` (`rt-local` is rejected). Optional: `METERLESS_BASE_URL`.
4. `cd uacc62_skin_pilot && npx tsx src/pilot.ts`

Do not set a cloud LLM base URL. The client refuses non-Nightshift hosts.

## Limitations

- Retrieval is PubMed title/abstract via E-utilities, not full text.
- Cell-line identifier `85` may not appear in papers under that token; exact-cell matches will then be `none`/`unknown`, which is intentional.
- Computational HSA/z_HSA screen values are metadata only, not literature evidence.
