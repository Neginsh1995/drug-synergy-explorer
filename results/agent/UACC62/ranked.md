# Drug-synergy literature evidence ranking

Generated: 2026-10-27T08:03:04.885Z
Provider: Meterless Nightshift at http://127.0.0.1:8088/v1 (app id `markovian-drug-synergy`). No other LLM provider is called.
Model: not recorded by the pilot. Requests use the routing mode `meterless/auto`, so Nightshift decides which model answers. Check the Nightshift Archive and your provider dashboard for the actual model.
Units processed: 10. Failures: 0. Only the pilot sample was run, not the full CSV.

This is a literature-evidence heuristic, not a clinical recommendation.

| Rank | Pair | Evidence class | Direct synergy | Score | Confidence | Rounds | PMIDs | Status |
|---:|---|---|---|---:|---|---:|---:|---|
| 1 | Palbociclib + Pazopanib | combination_effect_exact_cell | unknown | 62 | medium | 1 | 14 | accepted |

> **Single round.** Every unit stopped after round 1, so the Critic raised no high-severity issue and the Proposer was never asked to revise.

## Per-unit findings

### 1. Palbociclib + Pazopanib (cell_line 85)

- Evidence: No verified PubMed record retrieved by code reports experimental combination treatment or quantified synergy assessment for palbociclib (CID 5330286) + pazopanib (CID 10113978) in the UACC62 melanoma cell line (cell_line=85) or any skin cancer model. PMID 38645422 is a clinical case report describing a patient with a novel FGFR2 alteration, CDKN2A/B alterations, and CDH1 alteration who received a three-drug combination (pazopanib + crizotinib + palbociclib) after progression on pazopanib monotherapy and achieved 'a remarkable and sustained response.' This provides clinical evidence that the co…
- Contradictory or negative evidence: No verified PubMed record retrieved by code reports negative, antagonistic, or contradictory results for palbociclib + pazopanib combination in UACC62, melanoma, or skin cancer models. PMID 37610680 describes CDKN2A/B homozygous deletion in a DFSP model; loss of CDK4/6 negative regulators (p16INK4a, p15INK4b) can, in some cellular contexts, confer resistance to CDK4/6 inhibitors such as palbocicli…
- Full rounds: `rounds/cid5330286_10113978_cl85_round*.md`

## Limits

- The CSV `cell_line` value is an opaque identifier. Exact-cell-line evidence may be unfindable in PubMed text.
- Retrieval is PubMed title and abstract only, not full text.
- Screen values such as z_HSA are metadata, not literature evidence.
