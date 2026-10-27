# Hackathon submission notes

## Checklist

| Requirement | Status | Where |
|---|---|---|
| Demo video (1–4 min): main workflow, the Meterless Engine feature, one real request through Nightshift, keys hidden | To record | Script below |
| Slide deck: problem, users, solution, architecture, stack, sponsor integrations, screenshots, future work | To update | `docs/Agentic_Drug_Synergy_Stack.pptx` (3 slides), `docs/system_architecture.png` |
| GitHub repository with README: source, dependencies, setup, usage | Ready to push | `README.md`, `docs/INSTALL_AND_CHECK.md` |
| Declare pre-existing code | Ready | Below, and README "Pre-existing work" |
| Sponsor explanation: Zetaris, Meterless Engine and its tests, Nightshift, coding tool | Ready | Below |
| NVIDIA award: a feature powered by Nemotron through Nightshift | Not implemented | Below |
| Primary track | Team to choose | |
| No credentials in the repository | Ready | README "Credentials" |

## Zetaris

- **Lightning database `DRUG_SYNERGY_DATA`**: the hackathon files are registered where they are, in a
  Docker volume (`sql/01_source_tables.sql`): the model's predictions (719,112 rows), drug and cell
  line metadata, measured combinations (359,556), train and test splits. The agent's results are a
  seventh table, `agent_ranked`, over the agent's output files (`sql/04_agent_results.sql`).
- **Semantic layer `lightning.metastore.drug_synergy.drug_synergy`** (`sql/02_semantic_layer.sql`):
  `drugs`, `cell_lines`, `synergy_results` and `measured_combinations`, linked by keys, with data
  quality rules that all pass (0 orphan predictions).
- **The pipeline is SQL in Zetaris**: all 4,921,927 drug pairs, joined to the predictions for the cell
  line, filtered for synergy and for uncertainty, ranked. The dashboard sends each stage as its own
  query and links to its plan in the Zetaris engine (`USLTableScan` over the semantic layer).
- **Zetaris closes the loop**: the agent's results are read back from `agent_ranked` for the page.
- Access: JDBC (`com.zetaris.lightning.jdbc.LightningDriver`) from the Python backend; read-only queries.

## Meterless Engine

- **Engine implemented: the Markovian engine** (`agent/reference`, the Meterless TypeScript reference
  implementation). Each drug pair is one bounded Markovian run (chunk size 8,000, at most 3 chunks,
  800-token carry-over): only a compact state passes between rounds, so each pair is isolated,
  bounded and resumable. The engine's run record is saved per pair (`markovian-history/`).
- **The agent on top of it** (`agent/synergy_agent`): per pair, PubChem names and PubMed abstracts are
  retrieved in code; a Proposer drafts the evidence class, mechanism and citations; code checks every
  cited PMID was retrieved; a Critic raises objections, and a serious one sends the pair back to the
  Proposer; a code gate keeps or rejects the pair.
- **Test results**: engine 10 of 10 tests pass; agent 39 of 39. Live run, 647V (urinary tract): 8 pairs
  examined, 2 kept (one combination effect measured in that cell line, PMID 25349305; one pathway-level),
  6 rejected with their reasons, no invented citations.

## Meterless Nightshift

Every model call of the agent goes through Nightshift's OpenAI-compatible endpoint
(`http://127.0.0.1:8088/v1`); the agent has no other model provider and refuses non-Nightshift hosts.
The model is set by `METERLESS_MODEL` (in the demo run, Claude Sonnet 4.5 through a key held in Nightshift;
empty means `meterless/auto`, where Nightshift chooses), and every call is logged with the model that answered. The token is read from Nightshift's token file at run time.
`agent/run_agent.sh --check` confirms Nightshift answers before a run.

## Coding tool

Claude Code (Anthropic), used to build the Zetaris layer, the backend, the dashboard, the agent
integration and the scripts. *(Team: confirm, and add any other tool you used.)*

## NVIDIA award (Nemotron)

Not implemented: no Nemotron model was available in the Nightshift set-up used. The agent would use it
without code changes if Nightshift routes to a Nemotron model (local or through an NVIDIA provider key).

## Pre-existing code (for the submission form)

> The multimodal prediction model, its trained weights and the feature datasets were built by the team
> before the hackathon build window; the project uses only the model's output (Output.csv), loaded into Zetaris. The agent runs on the Meterless Markovian reference implementation
> (Apache-2.0), used unchanged. The Zetaris getting-started SQL runner was used to run the setup SQL.
> Everything else was written during the hackathon.

## Demo video script (about 3 minutes)

1. **Problem (15 s)**: 4.9 million drug pairs per cell line; which are worth testing, and why?
2. **Explore (30 s)**: on the dashboard, click the workflow rings: inputs (modalities read from the
   files), model, prediction with uncertainty, agents, evidence.
3. **Run (60 s)**: Urinary tract → 647V → Run pipeline. Show the stage tracker, the funnels
   (183 → 14 → 8 → 2), one Zetaris query and its plan in the engine view (port 4040), and a funnel table.
4. **Agent (45 s)**: the agent log (handoffs, decisions), one round file
   (`results/agent/647V/rounds/`), and Nightshift's console showing a request and its receipt.
5. **Result (20 s)**: the clinician-ready overview of the top pair: scores, uncertainty, targets, evidence.
6. **Close (10 s)**: decision support, not a treatment recommendation.

Before recording: hide Nightshift's Providers tab, `.env.local` and terminals with tokens; log in to
Zetaris first; turn on Do Not Disturb.
