import { MAX_SCIENTIFIC_ROUNDS } from "./constants.ts";
import { codeSupportChecks, corpusBlock, enforceCitationAllowlist, pmidDigits } from "./citations.ts";
import type { MeterlessClient } from "./meterless.ts";
import type { Paper } from "./pubmed.ts";
import { fetchPubmedRecords, type PubmedDeps } from "./pubmed.ts";
import { asCellLevel, asDirectSynergy, asEvidenceClass, clampAssessment } from "./scoring.ts";
import type { Assessment, CriticResult, Issue, RoundRecord } from "./types.ts";
import { criticPrompt, CRITIC_SYSTEM, proposerPrompt, PROPOSER_SYSTEM } from "./prompts.ts";
import type { ResearchUnit } from "./schema.ts";

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON object in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

function emptyAssessment(unit: ResearchUnit): Assessment {
  return {
    pair_id: unit.pair_id,
    Drug1: unit.Drug1,
    Drug2: unit.Drug2,
    cell_line: unit.cell_line,
    cell_line_original: unit.cell_line_original,
    cell_line_provenance: unit.cell_line_provenance,
    cell_line_name: unit.cell_line_name, // integration
    tissue: unit.tissue,
    cancer_type: unit.cancer_type,
    drug1_pubchem_cid: unit.drug1_pubchem_cid,
    drug2_pubchem_cid: unit.drug2_pubchem_cid,
    source_row_id: unit.source_row_id,
    evidence_class: "insufficient_or_conflicting",
    direct_experimental_synergy: "unknown",
    cell_line_specific_synergy: "unknown",
    cell_line_evidence_level: "none",
    synergy_method: "unknown",
    cancer_pathway_or_phenotype: "unknown",
    mechanistic_rationale: "unknown",
    evidence_summary: "Malformed proposer output; no claims accepted.",
    negative_or_contradictory_evidence: "unknown",
    cell_line_model_limitations: "unknown",
    citations: [],
    verified_pmids: [],
    verified_dois: [],
    rounds_used: 0,
    unresolved_issues: "malformed proposer JSON",
    final_status: "failed",
    confidence: "low",
    score: 0,
  };
}

export function parseAssessment(raw: unknown, unit: ResearchUnit): Assessment {
  const o = (raw ?? {}) as Record<string, unknown>;
  const citationsRaw = Array.isArray(o.citations) ? o.citations : [];
  const citations = citationsRaw.map((c) => {
    const x = c as Record<string, unknown>;
    return {
      pmid: pmidDigits(String(x.pmid ?? "")),
      doi: x.doi ? String(x.doi) : null,
      doi_verified: false,
      claim: String(x.claim ?? ""),
    };
  });
  const method = String(o.synergy_method ?? "unknown").trim() || "unknown";
  return {
    pair_id: unit.pair_id,
    Drug1: unit.Drug1,
    Drug2: unit.Drug2,
    cell_line: unit.cell_line,
    cell_line_original: unit.cell_line_original,
    cell_line_provenance: unit.cell_line_provenance,
    cell_line_name: unit.cell_line_name, // integration
    tissue: unit.tissue,
    cancer_type: unit.cancer_type,
    drug1_pubchem_cid: unit.drug1_pubchem_cid,
    drug2_pubchem_cid: unit.drug2_pubchem_cid,
    source_row_id: unit.source_row_id,
    evidence_class: asEvidenceClass(o.evidence_class),
    direct_experimental_synergy: asDirectSynergy(o.direct_experimental_synergy),
    cell_line_specific_synergy: String(o.cell_line_specific_synergy ?? "unknown"),
    cell_line_evidence_level: asCellLevel(o.cell_line_evidence_level),
    synergy_method: method,
    // integration: the key her prompt asks for is cancer_pathway_or_phenotype; older keys are still accepted
    cancer_pathway_or_phenotype: String(o.cancer_pathway_or_phenotype ?? o.tissue_pathway_or_phenotype ?? o.skin_pathway_or_phenotype ?? "unknown"),
    mechanistic_rationale: String(o.mechanistic_rationale ?? ""),
    evidence_summary: String(o.evidence_summary ?? ""),
    negative_or_contradictory_evidence: String(o.negative_or_contradictory_evidence ?? "unknown"),
    cell_line_model_limitations: String(o.cell_line_model_limitations ?? "unknown"),
    citations,
    verified_pmids: [],
    verified_dois: [],
    rounds_used: 0,
    unresolved_issues: "",
    final_status: "unresolved",
    confidence: "low",
    score: 0,
  };
}

export async function runScientificRound(args: {
  client: MeterlessClient;
  unit: ResearchUnit;
  corpus: Paper[];
  round: number;
  previousIssues: Issue[];
  previous: Assessment | null;
  carryover: string;
  pubmed?: PubmedDeps;
}): Promise<RoundRecord> {
  const { client, unit, corpus, round, previousIssues, previous, carryover, pubmed } = args;
  const allow = new Set(corpus.map((p) => p.pmid));
  const pairLabel = `${unit.Drug1} + ${unit.Drug2}`; // integration: names the call in the run log
  const aText = await client.complete(
    proposerPrompt(unit, corpusBlock(corpus), previousIssues, carryover),
    PROPOSER_SYSTEM,
    `Proposer round ${round} · ${pairLabel} · ${corpus.length} PubMed records`,
  );

  let proposer: Assessment;
  let malformed = false;
  try {
    proposer = parseAssessment(extractJson(aText), unit);
  } catch (err) {
    proposer = emptyAssessment(unit);
    proposer.unresolved_issues = `malformed proposer JSON: ${(err as Error).message}`;
    malformed = true;
  }

  const { kept, issues: allowIssues } = enforceCitationAllowlist(proposer.citations, allow);
  proposer.citations = kept;
  const citedPmids = proposer.citations.map((c) => c.pmid);
  let records: Paper[] = [];
  try {
    records = await fetchPubmedRecords(citedPmids, pubmed);
  } catch (err) {
    allowIssues.push({ severity: "high", text: `efetch failed: ${(err as Error).message}` });
  }
  const codeIssues = [...allowIssues, ...codeSupportChecks(proposer, records, allow)];
  proposer = clampAssessment({ ...proposer, rounds_used: round }, codeIssues);

  let critic: CriticResult;
  try {
    const bText = await client.complete(
      criticPrompt(proposer, records),
      CRITIC_SYSTEM,
      `Critic round ${round} · ${pairLabel}`,
    );
    critic = extractJson(bText) as CriticResult;
    if (!Array.isArray(critic.issues)) critic.issues = [];
    if (!Array.isArray(critic.citation_checks)) critic.citation_checks = [];
  } catch (err) {
    critic = {
      citation_checks: [],
      issues: [{ severity: "high", text: `Critic output was not valid JSON: ${(err as Error).message}` }],
    };
  }
  critic.issues.push(...codeIssues);
  proposer = clampAssessment(proposer, critic.issues);
  proposer.rounds_used = round;
  proposer.unresolved_issues = critic.issues.length
    ? critic.issues.map((i) => `[${i.severity}] ${i.text}`).join(" | ")
    : "none";

  const highs = critic.issues.filter((i) => i.severity === "high");
  let status: RoundRecord["status"] = "continue";
  if (malformed) status = "malformed";
  else if (highs.length === 0) status = "stop_no_high_issues";
  else if (round >= MAX_SCIENTIFIC_ROUNDS) status = "max_rounds";

  return {
    pair_id: unit.pair_id,
    round,
    timestamp: new Date().toISOString(),
    unit,
    proposer_raw: aText,
    proposer,
    critic,
    code_issues: codeIssues,
    status,
    changes_from_previous: previous
      ? `class ${previous.evidence_class} -> ${proposer.evidence_class}; synergy ${previous.direct_experimental_synergy} -> ${proposer.direct_experimental_synergy}`
      : "first round",
    corpus_pmids: [...allow],
  };
}

export function shouldStop(rec: RoundRecord): boolean {
  return rec.status === "stop_no_high_issues" || rec.status === "max_rounds" || rec.round >= MAX_SCIENTIFIC_ROUNDS;
}
