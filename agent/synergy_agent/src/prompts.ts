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
  "For this Drug1 + Drug2 + cancer type + cell_line research unit, what verified evidence supports or contradicts synergy in cancer-related pathways, and how strong is the evidence in the exact specified cancer type and cell line? For each `Drug1 + Drug2 + cell_line+cancer type` unit, investigate whether the two drugs may act synergistically in biologically relevant cancer-related pathways and determine how strong the evidence is. Define the cancer scope for this workflow from the dataset and repository documentation. Evidence from another cancer type or model may support biological plausibility, but must not be presented as direct evidence for the specified cancer type and cell line.";

/* ------------------------------------------------------------------ system prompts (one per role) */

export const PROPOSER_SYSTEM =
  "You are ROLE A (Proposer) in a Meterless Nightshift-only workflow. Return valid JSON only. Assess the exact drug pair, cancer type, and cell line using only code-retrieved PubMed records. Cite only verified corpus PMIDs; distinguish abstract-level evidence from full-text evidence. Never invent identifiers, findings, experimental values, or unsupported clinical conclusions.";

export const CRITIC_SYSTEM =
  "You are ROLE B (Critic) in a Meterless Nightshift-only workflow. Return valid JSON only. Independently audit every material scientific claim against the code-fetched records, including exact cancer type and cell-line relevance. Reject invented citations, unsupported synergy claims, overstated abstracts, and fabricated measurements.";

/* ------------------------------------------------------------------ Proposer (ROLE A) */

/** Guardrails repeated in every Proposer prompt. */
export const PROPOSER_RULES: readonly string[] = [
  "Evaluate Drug1 + Drug2 + cancer type + cell_line as one isolated unit. Never transfer direct evidence across cancer types or cell lines.",
  "Use only verified, code-retrieved PubMed records. Link each material scientific claim to a verified PMID; unsupported ideas must be explicitly labeled hypotheses.",
  "Distinguish direct quantified synergy in the exact cell line; exact-line combination effects without established synergy; synergy in another model; mechanistic rationale; computational predictions; and insufficient, negative, or conflicting evidence.",
  "Combination outperforming monotherapy does not by itself establish synergy. Pathway overlap is not synergy. Computational screen scores are not experimental evidence.",
  "Report whether both drugs were combined, whether monotherapy comparators were used, and whether synergy was actually quantified. Name Bliss, Loewe, ZIP, HSA or another method only if the source explicitly reports it.",
  "Never invent PMIDs, DOIs, paper details, doses, exposure times, schedules, endpoints, numerical synergy scores, p-values, or effect sizes.",
  "If abstracts omit the exact cell line, cancer type, doses, synergy metric, or study details, mark them unknown; do not claim to have read full text when only metadata or an abstract is supplied.",
  "Describe relevant pathways or phenotypes, negative or contradictory results, model limitations, uncertainty, and source-access limitations.",
  "Rank evidence by directness, reliability, exact-model match, and verified support, not narrative appeal or search-hit counts. Predictions are not clinical recommendations.",
];

export const PROPOSER_OUTPUT_FORMAT =
  "Return ONE JSON object with keys: evidence_class, direct_experimental_synergy (yes|no|unknown), cell_line_specific_synergy, cell_line_evidence_level (exact_cell_line|other_model|none), synergy_method, cancer_pathway_or_phenotype, mechanistic_rationale, evidence_summary, negative_or_contradictory_evidence, cell_line_model_limitations, citations (array of {pmid, doi, claim}), unknowns (array of strings).";

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
    `Cancer type=${cancerTypeOf(unit)}`,
    `Drug1=${unit.Drug1} CID ${unit.drug1_pubchem_cid}`,
    `Drug2=${unit.Drug2} CID ${unit.drug2_pubchem_cid}`,
    `cell_line=${unit.cell_line} (original=${unit.cell_line_original}; provenance=${unit.cell_line_provenance})`,
    `cell_line_name=${unit.cell_line_name || "unknown"}; tissue=${unit.tissue || "unknown"}`, // integration
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
    "Code-retrieved, verified PubMed records (cite ONLY these PMIDs; do not treat absent details as verified):",
    corpusText,
    "",
    PROPOSER_OUTPUT_FORMAT,
    PROPOSER_EVIDENCE_CLASSES,
  ].join("\n");
}

/* ------------------------------------------------------------------ Critic (ROLE B) */

export const CRITIC_INSTRUCTIONS = [
  "Independently evaluate ROLE A against code-fetched PubMed metadata and abstracts. Do not rubber-stamp; flag unsupported or unresolved claims.",
  "Check each claim: verified PMID and DOI identity; actual source support and access level; exact cancer type and cell line; whether both drugs were tested together and alone; synergy quantified versus combination effect versus mechanism; explicitly reported synergy method; accurate doses, endpoints, timing and schedules; no abstract overreach; negative or contradictory results; cross-model misclassification; invented numerical values; and whether evidence strength supports the proposed classification and rank. Identify precise corrections and unresolved issues.",
] as const;

export const CRITIC_OUTPUT_FORMAT =
  'Return JSON: { citation_checks: [{pmid, exists, doi_match, supports_claim, combo_tested, cell_line_match, synergy_quantified, abstract_overstated, note}], issues: [{severity, text}] }';

/** Abstract characters shown to the Critic per record. */
export const CRITIC_ABSTRACT_CHARS = 12000;

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
    `Requested cell_line=${entry.cell_line_original}${cellLineNameOf(entry)}`, // integration: + name
    `Cancer type=${cancerTypeOf(entry)}`,
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
  return `${RESEARCH_QUESTION} Unit ${unit.pair_id}: ${unit.Drug1} + ${unit.Drug2}; cancer type ${cancerTypeOf(unit)}; cell_line ${unit.cell_line_original}${cellLineNameOf(unit)}.`;
}

export function markovianMemoryContext(unit: ResearchUnit, verifiedPmids: string[]): string {
  return [
    `THIS UNIT ONLY: ${unit.pair_id}`,
    `Drug1=${unit.Drug1} CID ${unit.drug1_pubchem_cid}; Drug2=${unit.Drug2} CID ${unit.drug2_pubchem_cid}`,
    `Cancer type=${cancerTypeOf(unit)}`,
    `cell_line=${unit.cell_line_original}${cellLineNameOf(unit)} provenance=${unit.cell_line_provenance}`,
    `Do not use evidence from any other pair, cancer type, or cell line as direct evidence for this unit.`,
    `Verified PMIDs: ${verifiedPmids.join(", ") || "(none)"}`,
  ].join("\n");
}

/** integration: " (name UACC62, tissue skin)" when the input row gives them. */
function cellLineNameOf(value: ResearchUnit | Assessment): string {
  const r = value as unknown as Record<string, unknown>;
  const name = typeof r["cell_line_name"] === "string" ? (r["cell_line_name"] as string).trim() : "";
  const tissue = typeof r["tissue"] === "string" ? (r["tissue"] as string).trim() : "";
  return name ? ` (name ${name}${tissue ? `, tissue ${tissue}` : ""})` : "";
}

/** Read cancer type without assuming a schema field that has not been verified here. */
function cancerTypeOf(value: ResearchUnit | Assessment): string {
  const record = value as unknown as Record<string, unknown>;
  const raw = record["Cancer type"] ?? record["cancer_type"] ?? record["cancerType"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : "UNKNOWN — input schema/provenance must establish cancer type before assessment";
}
