/**
 * ALL text sent to the LLM (Meterless Nightshift) lives here.
 * Edit prompts in this file only; debate.ts and workflow.ts just call these functions.
 *
 * Safety rules (do not remove): never invent PMIDs/DOIs/doses; computational screen scores
 * are not experimental evidence; pathway overlap is not synergy; another cell line is not
 * direct evidence. The code in citations.ts also enforces these, but the prompt should say them too.
 */
import type { Paper } from "./pubmed.ts";
import type { ResearchUnit } from "./schema.ts";
import type { Assessment, Issue } from "./types.ts";

/** The one research question asked for every drug pair. */
export const RESEARCH_QUESTION =
  "For this Drug1 + Drug2 + cancer type + cell_line unit, is there evidence the pair may act synergistically in skin-related pathways, and how strong is that evidence specifically in the requested cell line?";

/* ------------------------------------------------------------------ system prompts (one per role) */

export const PROPOSER_SYSTEM =
  "You are ROLE A (Proposer). Nightshift only. JSON only. Cite only corpus PMIDs. Never invent identifiers or experimental values.";

export const CRITIC_SYSTEM =
  "You are ROLE B (Critic). Nightshift only. JSON only. Use fetched records. Do not approve unsupported claims.";

/* ------------------------------------------------------------------ Proposer (ROLE A) */

/** Guardrails repeated in every Proposer prompt. */
export const PROPOSER_RULES: readonly string[] = [
  "Do not treat computational screen scores as experimental synergy. Do not invent PMIDs, DOIs, doses, p-values, or synergy methods.",
  "If an abstract omits cell line, dose, or synergy method, write unknown.",
  "Pathway overlap is not synergy. Another cell line is not direct evidence for this cell_line.",
];

export const PROPOSER_OUTPUT_FORMAT =
  "Return ONE JSON object with keys: evidence_class, direct_experimental_synergy (yes|no|unknown), cell_line_specific_synergy, cell_line_evidence_level (exact_cell_line|other_model|none), synergy_method, skin_pathway_or_phenotype, mechanistic_rationale, evidence_summary, negative_or_contradictory_evidence, cell_line_model_limitations, citations (array of {pmid, doi, claim}), unknowns (array of strings).";

export const PROPOSER_EVIDENCE_CLASSES =
  "evidence_class must be one of: direct_experimental_synergy_exact_cell | combination_effect_exact_cell | synergy_other_model | mechanistic_pathway_only | computational_prediction_only | insufficient_or_conflicting.";

/**
 * @param corpusText  the already-formatted PubMed corpus block (citations.ts corpusBlock())
 * @param carryover   Markovian bounded state for THIS unit only
 */
export function proposerPrompt(unit: ResearchUnit, corpusText: string, previousIssues: Issue[], carryover: string): string {
  return [
    RESEARCH_QUESTION,
    "",
    `Unit ${unit.pair_id}`,
    `Drug1=${unit.Drug1} CID ${unit.drug1_pubchem_cid}`,
    `Drug2=${unit.Drug2} CID ${unit.drug2_pubchem_cid}`,
    `cell_line=${unit.cell_line} (original=${unit.cell_line_original}; provenance=${unit.cell_line_provenance})`,
    `source_row_id=${unit.source_row_id}`,
    `Computational screen metadata (NOT literature evidence): z_HSA=${unit.screen_z_hsa}; HSA_GT=${unit.screen_hsa_gt}; label=${unit.screen_label}`,
    "",
    ...PROPOSER_RULES,
    "",
    "Bounded prior state for THIS unit only:",
    carryover || "(none)",
    "",
    previousIssues.length ? `Critic/code issues to address:\n${JSON.stringify(previousIssues, null, 2)}` : "",
    "",
    "Verified PubMed records (cite ONLY these PMIDs):",
    corpusText,
    "",
    PROPOSER_OUTPUT_FORMAT,
    PROPOSER_EVIDENCE_CLASSES,
  ].join("\n");
}

/* ------------------------------------------------------------------ Critic (ROLE B) */

export const CRITIC_INSTRUCTIONS = [
  "Evaluate ROLE A against the code-fetched records. Do not rubber-stamp.",
  "Check: citation exists; PMID/DOI match; source supports the claim; combo tested; requested cell line used; synergy vs combination vs mechanism; synergy method named only if reported; doses/endpoints not invented; abstract not overstated; negatives missing; other cell line mislabelled as direct; invented numbers; rank vs evidence.",
] as const;

export const CRITIC_OUTPUT_FORMAT =
  'Return JSON: { citation_checks: [{pmid, exists, doi_match, supports_claim, combo_tested, cell_line_match, synergy_quantified, abstract_overstated, note}], issues: [{severity, text}] }';

/** Abstract characters shown to the Critic per record. */
export const CRITIC_ABSTRACT_CHARS = 1200;

export function criticRecordBlock(records: Paper[]): string {
  return records
    .map(
      (p) =>
        `PMID ${p.pmid} DOI ${p.doi ?? "absent"} title=${p.title}\nABSTRACT: ${p.abstract_available ? p.abstract.slice(0, CRITIC_ABSTRACT_CHARS) : "(none; do not invent methods)"}`,
    )
    .join("\n\n");
}

export function criticPrompt(entry: Assessment, records: Paper[]): string {
  const recordBlock = criticRecordBlock(records);
  return [
    CRITIC_INSTRUCTIONS[0],
    CRITIC_INSTRUCTIONS[1],
    "",
    `Requested cell_line=${entry.cell_line_original}`,
    "",
    "ROLE A entry:",
    JSON.stringify(entry, null, 2),
    "",
    "Fetched records:",
    recordBlock || "(none)",
    "",
    CRITIC_OUTPUT_FORMAT,
  ].join("\n");
}

/* ------------------------------------------------------------------ Markovian run (goal + bounded memory) */

export function markovianGoal(unit: ResearchUnit): string {
  return `${RESEARCH_QUESTION} Unit ${unit.pair_id}: ${unit.Drug1} + ${unit.Drug2} in cell_line ${unit.cell_line_original}.`;
}

export function markovianMemoryContext(unit: ResearchUnit, verifiedPmids: string[]): string {
  return [
    `THIS UNIT ONLY: ${unit.pair_id}`,
    `Drug1=${unit.Drug1} CID ${unit.drug1_pubchem_cid}; Drug2=${unit.Drug2} CID ${unit.drug2_pubchem_cid}`,
    `cell_line=${unit.cell_line_original} provenance=${unit.cell_line_provenance}`,
    `Do not use evidence from any other pair or cell line.`,
    `Verified PMIDs: ${verifiedPmids.join(", ") || "(none)"}`,
  ].join("\n");
}
