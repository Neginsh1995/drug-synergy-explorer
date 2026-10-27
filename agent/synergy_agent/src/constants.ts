/** Hard cap for this authorized pilot. Expanding past this is a contract violation. */
export const PILOT_LIMIT = 5;

/** Scientific review rounds per research unit (not infrastructure retries). */
export const MAX_SCIENTIFIC_ROUNDS = 3;

/** Bounded retries for Nightshift HTTP/timeouts/rate limits. Separate from review rounds. */
export const MAX_INFRA_RETRIES = 2;

/** integration: generic id (was "markovian-uacc62-skin"); the agent works for any cell line. */
export const APP_ID = "markovian-drug-synergy";

export const EVIDENCE_CLASSES = [
  "direct_experimental_synergy_exact_cell",
  "combination_effect_exact_cell",
  "synergy_other_model",
  "mechanistic_pathway_only",
  "computational_prediction_only",
  "insufficient_or_conflicting",
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Transparent heuristic scores. Not a validated clinical model. */
export const CLASS_BASE_SCORE: Record<EvidenceClass, number> = {
  direct_experimental_synergy_exact_cell: 90,
  combination_effect_exact_cell: 70,
  synergy_other_model: 50,
  mechanistic_pathway_only: 30,
  computational_prediction_only: 20,
  insufficient_or_conflicting: 10,
};

export const CELL_LINE_EVIDENCE_LEVELS = ["exact_cell_line", "other_model", "none"] as const;
export type CellLineEvidenceLevel = (typeof CELL_LINE_EVIDENCE_LEVELS)[number];

export const DIRECT_SYNERGY_VOCAB = ["yes", "no", "unknown"] as const;
export type DirectSynergy = (typeof DIRECT_SYNERGY_VOCAB)[number];

export const FINAL_STATUSES = ["accepted", "unresolved", "rejected", "failed"] as const;
export type FinalStatus = (typeof FINAL_STATUSES)[number];

export const CONFIDENCE_VOCAB = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_VOCAB)[number];

/** Screening mode: keep scanning the z_HSA-sorted CSV until this many pairs pass the synergy check. */
export const TARGET_KEEP = 5;

/** Safety cap on how many pairs may be examined (each costs PubMed calls + 2 Nightshift calls per round). Override: MAX_EXAMINE=80 */
export const DEFAULT_MAX_EXAMINE = 40;

/** Evidence classes that count as "synergy supported". strict = experimental synergy/combination evidence only. */
export const STRICT_SYNERGY_CLASSES: readonly EvidenceClass[] = [
  "direct_experimental_synergy_exact_cell",
  "combination_effect_exact_cell",
  "synergy_other_model",
];
/** include_mechanistic also keeps pathway-only rationale (weaker). Set SYNERGY_ACCEPT=include_mechanistic */
export const LENIENT_SYNERGY_CLASSES: readonly EvidenceClass[] = [...STRICT_SYNERGY_CLASSES, "mechanistic_pathway_only"];
