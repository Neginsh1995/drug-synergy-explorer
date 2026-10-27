import type {
  CellLineEvidenceLevel,
  Confidence,
  DirectSynergy,
  EvidenceClass,
  FinalStatus,
} from "./constants.ts";
import type { Paper } from "./pubmed.ts";
import type { ResearchUnit } from "./schema.ts";

export interface Citation {
  pmid: string;
  doi: string | null;
  doi_verified: boolean;
  claim: string;
}

export interface Issue {
  severity: "high" | "medium" | "low";
  text: string;
}

export interface CriticResult {
  citation_checks: {
    pmid: string;
    exists: boolean;
    doi_match: "yes" | "no" | "unverified" | "n/a";
    supports_claim: "yes" | "partial" | "no" | "unknown";
    combo_tested: "yes" | "no" | "unknown";
    cell_line_match: "exact" | "other" | "unknown";
    synergy_quantified: "yes" | "no" | "unknown";
    abstract_overstated: boolean;
    note: string;
    paper?: Paper;
  }[];
  issues: Issue[];
}

export interface Assessment {
  pair_id: string;
  Drug1: string;
  Drug2: string;
  cell_line: string;
  cell_line_original: string;
  cell_line_provenance: string;
  /** integration: from the input row (optional so older rounds still load). */
  cell_line_name?: string;
  tissue?: string;
  cancer_type?: string;
  drug1_pubchem_cid: number;
  drug2_pubchem_cid: number;
  source_row_id: number;
  evidence_class: EvidenceClass;
  direct_experimental_synergy: DirectSynergy;
  cell_line_specific_synergy: string;
  cell_line_evidence_level: CellLineEvidenceLevel;
  synergy_method: string;
  cancer_pathway_or_phenotype: string;
  mechanistic_rationale: string;
  evidence_summary: string;
  negative_or_contradictory_evidence: string;
  cell_line_model_limitations: string;
  citations: Citation[];
  verified_pmids: string[];
  verified_dois: string[];
  rounds_used: number;
  unresolved_issues: string;
  final_status: FinalStatus;
  confidence: Confidence;
  score: number;
  rank?: number;
}

export interface RoundRecord {
  pair_id: string;
  round: number;
  timestamp: string;
  unit: ResearchUnit;
  proposer_raw: string;
  proposer: Assessment;
  critic: CriticResult;
  code_issues: Issue[];
  status: "continue" | "stop_no_high_issues" | "max_rounds" | "malformed";
  changes_from_previous: string;
  corpus_pmids: string[];
}

/** Moved to prompts.ts; re-exported so existing imports keep working. */
export { RESEARCH_QUESTION } from "./prompts.ts";
