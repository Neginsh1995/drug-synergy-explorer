# Drug-synergy literature evidence ranking

Generated: 2026-10-27T04:25:07.886Z
Provider: Meterless Nightshift at http://127.0.0.1:8088/v1 (app id `markovian-drug-synergy`). No other LLM provider is called.
Model: not recorded by the pilot. Requests use the routing mode `meterless/auto`, so Nightshift decides which model answers. Check the Nightshift Archive and your provider dashboard for the actual model.
Units processed: 8. Failures: 0. Only the pilot sample was run, not the full CSV.

This is a literature-evidence heuristic, not a clinical recommendation.

| Rank | Pair | Evidence class | Direct synergy | Score | Confidence | Rounds | PMIDs | Status |
|---:|---|---|---|---:|---|---:|---:|---|
| 1 | 4-Amino-1-[3,3-difluoro-4-hydroxy-5-(hydroxymethyl)-2-oxolanyl]-2-pyrimidinone + Azd7762 | combination_effect_exact_cell | unknown | 42 | low | 3 | 1 | unresolved |
| 2 | Azd7762 + Ceralasertib | mechanistic_pathway_only | no | 22 | medium | 2 | 1 | accepted |
| 3 | Pictilisib + Vistusertib | mechanistic_pathway_only | unknown | 22 | medium | 1 | 2 | accepted |
| 4 | KU-60019 + Ceralasertib | mechanistic_pathway_only | no | 12 | medium | 1 | 1 | accepted |

## Per-unit findings

### 1. 4-Amino-1-[3,3-difluoro-4-hydroxy-5-(hydroxymethyl)-2-oxolanyl]-2-pyrimidinone + Azd7762 (cell_line 136)

- Evidence: For this exact unit (gemcitabine [CID 3461] + AZD7762 [CID 11152667] in the 647V urinary tract/bladder cancer cell line, dataset cell_line code 136), one verified abstract-level record (PMID 25349305) provides direct, exact-pair, exact-cell-line combination evidence: both drugs are explicitly named and tested together in the named cell line 647V (matched to dataset mapping cell_line=136 → cell_line_name=647V, tissue=urinary tract), within a TP53/CDKN1A double-mutant genetic background relevant to invasive bladder cancer. The reported combination effect is qualitative ('heightened sensitivity t…
- Contradictory or negative evidence: None reported in the fetched abstract. The abstract presents a uniformly positive narrative for the combination effect in TP53/CDKN1A double-mutant bladder cancer cells. No conflicting results, cell-line-specific resistance, or failure of the combination are mentioned. The genetic rescue experiment (CDKN1A restoration reducing sensitivity) is confirmatory, not contradictory, supporting that the do…
- Full rounds: `rounds/cid3461_11152667_cl136_round*.md`

### 2. Azd7762 + Ceralasertib (cell_line 136)

- Evidence: For the queried unit (AZD7762 [CID 11152667] + Ceralasertib [CID 54761306] in 647V urinary tract cancer cells, dataset cell_line=136), zero experimental evidence exists. The single verified abstract, PMID 25349305, tests a different drug pair: gemcitabine + AZD7762 (or gemcitabine + PF477736) in 647V and RT-112 bladder cancer cells. AZD7762 is explicitly named as one of two Chk1 inhibitors tested with gemcitabine in these lines, and qualitative combination benefit ('heightened sensitivity') is reported in a TP53/CDKN1A double-mutant genetic background. However, Ceralasertib (ATR inhibitor, CID…
- Contradictory or negative evidence: No negative or contradictory experimental evidence was retrieved for AZD7762 + Ceralasertib in 647V or any other system, because no experimental evidence of any kind was found for this drug pair. The absence of published combination studies may reflect lack of investigation rather than negative results.
- Full rounds: `rounds/cid11152667_54761306_cl136_round*.md`

### 3. Pictilisib + Vistusertib (cell_line 136)

- Evidence: Across the two code-retrieved, verified PubMed records, there is no direct experimental evidence of combination testing or synergy quantification for Pictilisib + Vistusertib in the 647V urinary tract cancer cell line or in any urinary tract cancer model. PMID 37633163 is an unrelated bioanalytical method paper (plasma drug quantification for hepatocellular carcinoma pharmacokinetic monitoring) in which pictilisib and vistusertib appear only as two of five analytes in a multi-drug LC-MS/MS assay validation; no combination treatment, no cancer cell experiments, and no synergy assessment are rep…
- Contradictory or negative evidence: None retrieved. No verified PubMed record reports negative results, lack of synergy, antagonism, or contradictory findings for Pictilisib + Vistusertib in 647V, urinary tract cancer, or any cancer model. The absence of evidence is not evidence of absence; the retrieved corpus simply does not address this specific drug combination in this cancer type or cell line.
- Full rounds: `rounds/cid17755052_25262792_cl136_round*.md`

### 4. KU-60019 + Ceralasertib (cell_line 136)

- Evidence: Only one code-retrieved, verified PubMed record is available; it provides no direct evidence for this unit. PMID 31471531 is a mechanistic study in nasopharyngeal carcinoma (NPC) cell lines (CNE1, CNE2, C666-1) investigating the role of EBV-miR-BART8-3p in radioresistance via ATM/ATR pathway regulation. The study used KU60019 (ATM inhibitor, CID 15953870) and AZD6738 (Ceralasertib, ATR inhibitor, CID 54761306) as separate monotherapy tool compounds—not in combination—to validate that ATM and ATR pathway inhibition reverses EBV-miR-BART8-3p-mediated radioresistance and G2/M cell cycle arrest ph…
- Contradictory or negative evidence: None reported in retrieved corpus. PMID 31471531 does not test the drug combination, so it provides neither positive nor negative evidence for synergy. No verified PubMed record retrieved by code reports lack of synergy, antagonism, toxicity, or failure of KU-60019 + Ceralasertib combination in any cancer type or model.
- Full rounds: `rounds/cid15953870_54761306_cl136_round*.md`

## Limits

- The CSV `cell_line` value is an opaque identifier. Exact-cell-line evidence may be unfindable in PubMed text.
- Retrieval is PubMed title and abstract only, not full text.
- Screen values such as z_HSA are metadata, not literature evidence.
