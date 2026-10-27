import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { csvEscape } from "./csv.ts";
import { RESEARCH_QUESTION, type Assessment, type RoundRecord } from "./types.ts";

export const RANKED_COLUMNS = [
  "pair_id",
  "Drug1",
  "Drug2",
  "cell_line",
  "cell_line_original",
  "drug1_pubchem_cid",
  "drug2_pubchem_cid",
  "source_row_id",
  "rank",
  "score",
  "confidence",
  "evidence_class",
  "direct_experimental_synergy",
  "cell_line_specific_synergy",
  "cell_line_evidence_level",
  "synergy_method",
  "cancer_pathway_or_phenotype",
  "mechanistic_rationale",
  "evidence_summary",
  "negative_or_contradictory_evidence",
  "cell_line_model_limitations",
  "verified_pmids",
  "verified_dois",
  "evidence_citations",
  "rounds_used",
  "unresolved_issues",
  "final_status",
] as const;

/** Arrays in CSV cells are JSON strings. */
export function serializeAssessmentRow(a: Assessment): string[] {
  return [
    a.pair_id,
    a.Drug1,
    a.Drug2,
    a.cell_line,
    a.cell_line_original,
    String(a.drug1_pubchem_cid),
    String(a.drug2_pubchem_cid),
    String(a.source_row_id),
    String(a.rank ?? ""),
    String(a.score),
    a.confidence,
    a.evidence_class,
    a.direct_experimental_synergy,
    a.cell_line_specific_synergy,
    a.cell_line_evidence_level,
    a.synergy_method,
    a.cancer_pathway_or_phenotype,
    a.mechanistic_rationale,
    a.evidence_summary,
    a.negative_or_contradictory_evidence,
    a.cell_line_model_limitations,
    JSON.stringify(a.verified_pmids),
    JSON.stringify(a.verified_dois),
    JSON.stringify(a.citations),
    String(a.rounds_used),
    a.unresolved_issues,
    a.final_status,
  ];
}

export function writeRankedCsv(entries: Assessment[]): string {
  const lines = [RANKED_COLUMNS.join(",")];
  for (const e of entries) {
    lines.push(serializeAssessmentRow(e).map(csvEscape).join(","));
  }
  return lines.join("\n") + "\n";
}

export function roundPath(roundsDir: string, pairId: string, round: number): string {
  return join(roundsDir, `${pairId}_round${round}.md`);
}

export function renderRoundMarkdown(rec: RoundRecord): string {
  const u = rec.unit;
  return [
    `# ${rec.pair_id} round ${rec.round}`,
    "",
    `- pair_id: ${rec.pair_id}`,
    `- Drug1: ${u.Drug1} (PubChem CID ${u.drug1_pubchem_cid})`,
    `- Drug2: ${u.Drug2} (PubChem CID ${u.drug2_pubchem_cid})`,
    `- cell_line: ${u.cell_line}`,
    `- cell_line_original: ${u.cell_line_original}`,
    `- cell_line_provenance: ${u.cell_line_provenance}`,
    `- source_row_id: ${u.source_row_id}`,
    `- round: ${rec.round}`,
    `- timestamp: ${rec.timestamp}`,
    `- research_question: ${RESEARCH_QUESTION}`,
    `- verified_source_pmids: ${rec.corpus_pmids.join(", ") || "(none)"}`,
    `- round_status: ${rec.status}`,
    "",
    "## Proposer assessment",
    "",
    "```json",
    JSON.stringify(rec.proposer, null, 2),
    "```",
    "",
    "## Critic assessment",
    "",
    "```json",
    JSON.stringify(rec.critic, null, 2),
    "```",
    "",
    "## Code citation checks",
    "",
    "```json",
    JSON.stringify(rec.code_issues, null, 2),
    "```",
    "",
    "## Claims / evidence",
    "",
    `- evidence_class: ${rec.proposer.evidence_class}`,
    `- direct_experimental_synergy: ${rec.proposer.direct_experimental_synergy}`,
    `- cell_line_evidence_level: ${rec.proposer.cell_line_evidence_level}`,
    `- cell_line_model_limitations: ${rec.proposer.cell_line_model_limitations}`,
    `- unresolved_issues: ${rec.proposer.unresolved_issues}`,
    `- changes_from_previous: ${rec.changes_from_previous}`,
    "",
    "## Proposer raw (truncated)",
    "",
    rec.proposer_raw.slice(0, 4000),
    "",
  ].join("\n");
}

export async function saveRoundArtifact(roundsDir: string, rec: RoundRecord): Promise<string> {
  await mkdir(roundsDir, { recursive: true });
  const path = roundPath(roundsDir, rec.pair_id, rec.round);
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing round artifact ${path}`);
  } catch (err) {
    if ((err as Error).message?.includes("Refusing")) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await writeFile(path, renderRoundMarkdown(rec));
  return path;
}

export async function writeRankedFile(path: string, entries: Assessment[]): Promise<void> {
  await writeFile(path, writeRankedCsv(entries));
}

/** Restart-safe: existing round markdown is never overwritten; last proposer JSON is reused. */
export async function loadLatestAssessmentFromRounds(
  roundsDir: string,
  pairId: string,
): Promise<{ assessment: Assessment; roundsUsed: number } | null> {
  let names: string[] = [];
  try {
    names = await readdir(roundsDir);
  } catch {
    return null;
  }
  const prefix = `${pairId}_round`;
  const rounds = names
    .filter((n) => n.startsWith(prefix) && n.endsWith(".md"))
    .map((n) => Number(n.slice(prefix.length, -3)))
    .filter((n) => Number.isInteger(n) && n >= 1);
  if (!rounds.length) return null;
  const roundsUsed = Math.max(...rounds);
  const md = await readFile(roundPath(roundsDir, pairId, roundsUsed), "utf8");
  const m = md.match(/## Proposer assessment\s+```json\s*([\s\S]*?)```/);
  if (!m) return null;
  const assessment = JSON.parse(m[1]) as Assessment;
  assessment.rounds_used = roundsUsed;
  return { assessment, roundsUsed };
}

/** Minimal row shape so the same renderer works for live Assessments and for rows parsed back from ranked.csv. */
export interface RankedMdRow {
  rank: string;
  pair_id: string;
  Drug1: string;
  Drug2: string;
  score: string;
  confidence: string;
  evidence_class: string;
  direct_experimental_synergy: string;
  cell_line_evidence_level: string;
  rounds_used: string;
  final_status: string;
  evidence_summary: string;
  negative_or_contradictory_evidence: string;
  cell_line_original: string;
  pmid_count: number;
}

export interface RankedMdMeta {
  generatedAt: string;
  baseUrl: string;
  app: string;
  processed: number;
  failures: { pair_id: string; error: string }[];
  screening?: { examined: number; kept: number; rejected: number; stopReason: string; mode: string };
}

export function assessmentToMdRow(a: Assessment): RankedMdRow {
  return {
    rank: String(a.rank ?? ""),
    pair_id: a.pair_id,
    Drug1: a.Drug1,
    Drug2: a.Drug2,
    score: String(a.score),
    confidence: a.confidence,
    evidence_class: a.evidence_class,
    direct_experimental_synergy: a.direct_experimental_synergy,
    cell_line_evidence_level: a.cell_line_evidence_level,
    rounds_used: String(a.rounds_used),
    final_status: a.final_status,
    evidence_summary: a.evidence_summary,
    negative_or_contradictory_evidence: a.negative_or_contradictory_evidence,
    cell_line_original: a.cell_line_original,
    pmid_count: a.verified_pmids.length,
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ");

/** Human-readable summary of ONE run. Regenerated every run so it can never describe an older run. */
export function renderRankedMarkdown(rows: RankedMdRow[], meta: RankedMdMeta): string {
  const out: string[] = [
    "# Drug-synergy literature evidence ranking",
    "",
    `Generated: ${meta.generatedAt}`,
    `Provider: Meterless Nightshift at ${meta.baseUrl} (app id \`${meta.app}\`). No other LLM provider is called.`,
    "Model: not recorded by the pilot. Requests use the routing mode `meterless/auto`, so Nightshift decides which model answers. Check the Nightshift Archive and your provider dashboard for the actual model.",
    `Units processed: ${meta.processed}. Failures: ${meta.failures.length}. Only the pilot sample was run, not the full CSV.`,
    ...(meta.screening
      ? [`Screening: examined ${meta.screening.examined} pairs in z_HSA order, kept ${meta.screening.kept}, rejected ${meta.screening.rejected}. Stop reason: ${meta.screening.stopReason}. Synergy mode: ${meta.screening.mode}. Every decision is in screened.csv.`]
      : []),
    "",
    "This is a literature-evidence heuristic, not a clinical recommendation.",
    "",
  ];
  if (!rows.length) {
    out.push("No assessments were produced in this run.", "");
  } else {
    out.push(
      "| Rank | Pair | Evidence class | Direct synergy | Score | Confidence | Rounds | PMIDs | Status |",
      "|---:|---|---|---|---:|---|---:|---:|---|",
    );
    for (const r of rows) {
      out.push(
        `| ${r.rank} | ${cell(r.Drug1)} + ${cell(r.Drug2)} | ${r.evidence_class} | ${r.direct_experimental_synergy} | ${r.score} | ${r.confidence} | ${r.rounds_used} | ${r.pmid_count} | ${r.final_status} |`,
      );
    }
    out.push("");
    if (rows.length > 1 && new Set(rows.map((r) => r.score)).size === 1) {
      out.push(
        `> **Tied scores.** Every unit scored ${rows[0].score}, so the rank order is only an ID tie-break and says nothing about relative quality.`,
        "",
      );
    }
    if (rows.every((r) => r.rounds_used === "1")) {
      out.push("> **Single round.** Every unit stopped after round 1, so the Critic raised no high-severity issue and the Proposer was never asked to revise.", "");
    }
    out.push("## Per-unit findings", "");
    for (const r of rows) {
      out.push(
        `### ${r.rank}. ${r.Drug1} + ${r.Drug2} (cell_line ${r.cell_line_original})`,
        "",
        `- Evidence: ${clip(r.evidence_summary, 600)}`,
        `- Contradictory or negative evidence: ${clip(r.negative_or_contradictory_evidence, 400)}`,
        `- Full rounds: \`rounds/${r.pair_id}_round*.md\``,
        "",
      );
    }
  }
  if (meta.failures.length) {
    out.push("## Failures", "");
    for (const f of meta.failures) out.push(`- ${f.pair_id}: ${clip(f.error, 300)}`);
    out.push("");
  }
  out.push(
    "## Limits",
    "",
    "- The CSV `cell_line` value is an opaque identifier. Exact-cell-line evidence may be unfindable in PubMed text.",
    "- Retrieval is PubMed title and abstract only, not full text.",
    "- Screen values such as z_HSA are metadata, not literature evidence.",
    "",
  );
  return out.join("\n");
}

export async function writeRankedMarkdownFile(path: string, rows: RankedMdRow[], meta: RankedMdMeta): Promise<void> {
  await writeFile(path, renderRankedMarkdown(rows, meta));
}
