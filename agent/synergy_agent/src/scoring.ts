import {
  CLASS_BASE_SCORE,
  CELL_LINE_EVIDENCE_LEVELS,
  DIRECT_SYNERGY_VOCAB,
  EVIDENCE_CLASSES,
  type CellLineEvidenceLevel,
  type Confidence,
  type DirectSynergy,
  type EvidenceClass,
  type FinalStatus,
} from "./constants.ts";
import type { Assessment, Issue } from "./types.ts";

export function asEvidenceClass(value: unknown): EvidenceClass {
  const s = String(value ?? "");
  return (EVIDENCE_CLASSES as readonly string[]).includes(s)
    ? (s as EvidenceClass)
    : "insufficient_or_conflicting";
}

export function asDirectSynergy(value: unknown): DirectSynergy {
  const s = String(value ?? "");
  return (DIRECT_SYNERGY_VOCAB as readonly string[]).includes(s) ? (s as DirectSynergy) : "unknown";
}

export function asCellLevel(value: unknown): CellLineEvidenceLevel {
  const s = String(value ?? "");
  return (CELL_LINE_EVIDENCE_LEVELS as readonly string[]).includes(s)
    ? (s as CellLineEvidenceLevel)
    : "none";
}

/**
 * Clamp LLM-proposed class to what verified citations can support.
 * Mechanism/narrative cannot outrank missing experimental evidence.
 */
export function clampAssessment(a: Assessment, issues: Issue[]): Assessment {
  const highs = issues.filter((i) => i.severity === "high");
  let evidence_class = a.evidence_class;
  let direct = a.direct_experimental_synergy;
  let cellLevel = a.cell_line_evidence_level;

  if (highs.some((i) => /direct_experimental_synergy=yes/i.test(i.text))) {
    direct = "no";
  }
  if (highs.some((i) => /cell_line_evidence_level=exact/i.test(i.text))) {
    cellLevel = cellLevel === "exact_cell_line" ? "none" : cellLevel;
  }
  if (highs.some((i) => /evidence_class overstated/i.test(i.text))) {
    evidence_class = cellLevel === "other_model" ? "synergy_other_model" : "mechanistic_pathway_only";
  }
  if (a.citations.length === 0) {
    if (evidence_class !== "computational_prediction_only") {
      evidence_class = "insufficient_or_conflicting";
    }
    if (direct === "yes") direct = "unknown";
    cellLevel = "none";
  }
  if (direct === "yes" && evidence_class !== "direct_experimental_synergy_exact_cell") {
    // yes is only allowed with the exact-cell synergy class; otherwise treat as unknown.
    direct = "unknown";
  }
  if (direct !== "yes" && evidence_class === "direct_experimental_synergy_exact_cell") {
    evidence_class = "combination_effect_exact_cell";
  }

  const score = scoreAssessment({ ...a, evidence_class, direct_experimental_synergy: direct, cell_line_evidence_level: cellLevel }, issues);
  const confidence = confidenceFrom(issues, a);
  const final_status = statusFrom(issues, a.rounds_used);

  return {
    ...a,
    evidence_class,
    direct_experimental_synergy: direct,
    cell_line_evidence_level: cellLevel,
    score: score.value,
    confidence,
    final_status,
    verified_pmids: [...new Set(a.citations.map((c) => c.pmid))],
    verified_dois: [...new Set(a.citations.filter((c) => c.doi_verified && c.doi).map((c) => c.doi as string))],
  };
}

export function scoreAssessment(a: Assessment, issues: Issue[]): { value: number; parts: string[] } {
  const parts: string[] = [];
  let value = CLASS_BASE_SCORE[a.evidence_class];
  parts.push(`base(${a.evidence_class})=${value}`);
  if (a.direct_experimental_synergy !== "yes") {
    /* no bonus */
  }
  const noAbs = issues.some((i) => /no abstract/i.test(i.text));
  if (noAbs) {
    value -= 10;
    parts.push("abstract_missing=-10");
  }
  if (a.negative_or_contradictory_evidence && !/^none$|^unknown$|^n\/a$/i.test(a.negative_or_contradictory_evidence)) {
    value -= 8;
    parts.push("negative_or_contradictory=-8");
  }
  const highs = issues.filter((i) => i.severity === "high").length;
  if (highs) {
    value -= Math.min(20, highs * 5);
    parts.push(`high_issues=-${Math.min(20, highs * 5)}`);
  }
  value = Math.max(0, Math.min(100, value));
  parts.push(`clamped=${value}`);
  return { value, parts };
}

export function confidenceFrom(issues: Issue[], a: Assessment): Confidence {
  const highs = issues.filter((i) => i.severity === "high").length;
  if (highs > 0) return "low";
  if (a.citations.length === 0) return "low";
  if (issues.some((i) => i.severity === "medium")) return "medium";
  if (a.evidence_class === "insufficient_or_conflicting") return "low";
  if (a.evidence_class === "direct_experimental_synergy_exact_cell") return "high";
  return "medium";
}

export function statusFrom(issues: Issue[], roundsUsed: number): FinalStatus {
  const highs = issues.filter((i) => i.severity === "high");
  if (roundsUsed < 1) return "failed";
  if (highs.length && roundsUsed >= 3) return "unresolved";
  if (highs.length) return "unresolved";
  return "accepted";
}

export function rankAssessments(rows: Assessment[]): Assessment[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.pair_id.localeCompare(b.pair_id);
  });
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

export const SCORING_LIMITATIONS =
  "Scores are a documented heuristic over evidence_class, abstract availability, and remaining critic issues. They are not a validated synergy model, clinical recommendation, or safety/efficacy claim.";
