/** Rebuild ranked.md from the existing ranked.csv + progress.json without re-running the LLM.
 *  Usage: npx tsx src/render-ranked-md.ts */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeRankedMarkdownFile, type RankedMdRow } from "./artifacts.ts";
import { parseCsv } from "./csv.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// integration: same output folder as pilot.ts (AGENT_OUTPUT_DIR), default the project folder
const OUT = process.env.AGENT_OUTPUT_DIR || ROOT;
const { rows } = parseCsv(await readFile(join(OUT, "ranked.csv"), "utf8"));
const progress = JSON.parse(await readFile(join(OUT, "progress.json"), "utf8"));
const g = (r: { raw: Record<string, string> }, k: string) => String(r.raw[k] ?? "");
const mdRows: RankedMdRow[] = rows.map((r) => ({
  rank: g(r, "rank"), pair_id: g(r, "pair_id"), Drug1: g(r, "Drug1"), Drug2: g(r, "Drug2"),
  score: g(r, "score"), confidence: g(r, "confidence"), evidence_class: g(r, "evidence_class"),
  direct_experimental_synergy: g(r, "direct_experimental_synergy"),
  cell_line_evidence_level: g(r, "cell_line_evidence_level"), rounds_used: g(r, "rounds_used"),
  final_status: g(r, "final_status"), evidence_summary: g(r, "evidence_summary"),
  negative_or_contradictory_evidence: g(r, "negative_or_contradictory_evidence"),
  cell_line_original: g(r, "cell_line_original"),
  pmid_count: (() => { try { return JSON.parse(g(r, "verified_pmids")).length; } catch { return 0; } })(),
}));
await writeRankedMarkdownFile(join(OUT, "ranked.md"), mdRows, {
  generatedAt: new Date().toISOString(),
  baseUrl: progress.provider?.baseUrl ?? "unknown",
  app: progress.provider?.app ?? "markovian-drug-synergy",
  processed: progress.pairs_processed ?? mdRows.length,
  failures: progress.failures ?? [],
});
console.log(`ranked.md rebuilt from ranked.csv (${mdRows.length} rows)`);
