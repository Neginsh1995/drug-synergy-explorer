/**
 * Cell-line drug-synergy literature agent (any cell line; originally the UACC62 skin pilot).
 * LLM: Meterless Nightshift only. PubMed: NCBI E-utilities in this process.
 * Cell line: CSV column cell_line only (never the filename).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { assessmentToMdRow, loadLatestAssessmentFromRounds, writeRankedFile, writeRankedMarkdownFile } from "./artifacts.ts";
import { DEFAULT_MAX_EXAMINE, TARGET_KEEP } from "./constants.ts";
import { loadSourceCsv } from "./csv.ts";
import { createMeterlessClient } from "./meterless.ts";
import { resolveCids } from "./pubchem.ts";
import { rankAssessments } from "./scoring.ts";
import { rowToUnit, sortEligibleRows } from "./schema.ts";
import { decideSynergy, screenedToCsv, screenUntilKept, synergyModeFromEnv, type ScreenRecord } from "./screening.ts";
import { processResearchUnit } from "./workflow.ts";
import type { Assessment } from "./types.ts";
import type { ResearchUnit } from "./schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// integration: input and output come from AGENT_INPUT_CSV / AGENT_OUTPUT_DIR (set by run_agent.sh);
// the defaults are the original pilot layout. The PubChem name cache stays shared across runs.
const OUT = process.env.AGENT_OUTPUT_DIR || ROOT;
const CSV_IN = process.env.AGENT_INPUT_CSV || join(ROOT, "..", "most_promising_UACC62_PubChemCID.csv");
const CACHE = join(ROOT, "pubchem_cid_cache.json");
const ROUNDS = join(OUT, "rounds");
const RANKED_CSV = join(OUT, "ranked.csv");
const RANKED_ROOT = process.env.AGENT_OUTPUT_DIR ? null : join(ROOT, "..", "ranked.csv");
const RANKED_MD = join(OUT, "ranked.md");
const SCREENED_CSV = join(OUT, "screened.csv");
const PROGRESS = join(OUT, "progress.json");
const HISTORY = join(OUT, "markovian-history");
const TARGET = Number(process.env.TARGET_KEEP ?? TARGET_KEEP); // integration: overridable

function displayName(title: string): string {
  if (/y-39983/i.test(title)) return "Y-39983";
  if (/plx-4720/i.test(title)) return "PLX-4720";
  return title;
}

async function saveProgress(payload: unknown): Promise<void> {
  await writeFile(PROGRESS, JSON.stringify(payload, null, 2));
}

/** All eligible CSV rows, z_HSA descending. Nothing is sliced here: the screening loop decides when to stop. */
export async function loadCandidates() {
  const { header, rows } = await loadSourceCsv(CSV_IN);
  if (!header.includes("cell_line")) {
    throw new Error("CSV has no cell_line column; cannot invent a cell line from the filename. Stop.");
  }
  return sortEligibleRows(rows);
}

/** Resolve drug names for ONE row (PubChem, cached) and build the research unit. */
async function buildUnit(row: Awaited<ReturnType<typeof loadCandidates>>[number]): Promise<ResearchUnit> {
  const cache = await resolveCids([Number(row.drug_1), Number(row.drug_2)], CACHE);
  const a = cache[String(row.drug_1)];
  const b = cache[String(row.drug_2)];
  return rowToUnit(row, {
    drug1: displayName(a?.title ?? `CID ${row.drug_1}`),
    drug2: displayName(b?.title ?? `CID ${row.drug_2}`),
    aliases1: (a?.synonyms ?? []).slice(0, 4),
    aliases2: (b?.synonyms ?? []).slice(0, 4),
  });
}

async function main(): Promise<void> {
  const candidates = await loadCandidates();
  const maxExamine = Number(process.env.MAX_EXAMINE ?? DEFAULT_MAX_EXAMINE);
  const mode = synergyModeFromEnv();
  const selection = {
    method: `all eligible CSV rows sorted by z_HSA descending; examine one at a time; keep pairs with synergy evidence (mode=${mode}); reject the rest; stop at ${TARGET} kept or ${maxExamine} examined. Filename is not used as cell-line provenance.`,
    source_csv: basename(CSV_IN),
    candidates_total: candidates.length,
    target_keep: TARGET,
    max_examine: maxExamine,
    synergy_mode: mode,
  };

  let client;
  try {
    client = await createMeterlessClient();
  } catch (err) {
    await saveProgress({
      run_id: "cell-line-synergy-screening",
      status: "blocked_nightshift",
      error: (err as Error).message,
      selection,
      pairs_processed: 0,
      note: "No alternate LLM provider. Start Nightshift; set METERLESS_RUNTIME_TOKEN if GET /v1/models is 401/403.",
    });
    console.error((err as Error).message);
    process.exitCode = 2;
    return;
  }

  await mkdir(OUT, { recursive: true });
  await mkdir(ROUNDS, { recursive: true });
  const meta = new Map<string, { Drug1: string; Drug2: string; z_HSA: string }>();
  const provider = {
    id: "meterless", app: "markovian-drug-synergy", baseUrl: client.baseUrl, status: client.status,
    model: process.env.METERLESS_MODEL?.trim() || "meterless/auto", // integration: the requested model
  };

  const result = await screenUntilKept({
    candidates,
    idOf: (row) => `row ${row.source_row_id}`,
    targetKeep: TARGET,
    maxExamine,
    decide: (a) => decideSynergy(a, mode),
    evaluate: async (row) => {
      const unit = await buildUnit(row);
      meta.set(`row ${row.source_row_id}`, { Drug1: unit.Drug1, Drug2: unit.Drug2, z_HSA: String(row.raw.z_HSA ?? "") });
      console.log(`unit ${unit.pair_id} source_row_id=${unit.source_row_id} z_HSA=${row.raw.z_HSA} cell_line=${unit.cell_line_original}`);
      const existing = await loadLatestAssessmentFromRounds(ROUNDS, unit.pair_id);
      if (existing) {
        console.log(`unit ${unit.pair_id} restart-skip: reused round ${existing.roundsUsed} (no overwrite)`);
        return existing.assessment;
      }
      const r = await processResearchUnit({ client, unit, roundsDir: ROUNDS, historyDir: HISTORY });
      return r.assessment;
    },
    onStep: async (rec: ScreenRecord, kept, screened) => {
      console.log(`  -> ${rec.decision.toUpperCase()}: ${rec.reason}  [kept ${kept.length}/${TARGET}, examined ${screened.length}]`);
      await saveProgress({
        run_id: "cell-line-synergy-screening", status: "running", provider, selection,
        examined: screened.length, kept: kept.length, last: rec,
      });
    },
  });

  const withMeta = result.screened.map((r) => ({ ...r, ...(meta.get(r.pair_id) ?? {}) }));
  await writeFile(SCREENED_CSV, screenedToCsv(withMeta));

  const ranked = rankAssessments(result.kept);
  await writeRankedFile(RANKED_CSV, ranked);
  if (RANKED_ROOT) await writeRankedFile(RANKED_ROOT, ranked);
  const failures = result.screened.filter((r) => r.decision === "error").map((r) => ({ pair_id: r.pair_id, error: r.reason }));
  const rejected = result.screened.filter((r) => r.decision === "reject").length;
  await writeRankedMarkdownFile(RANKED_MD, ranked.map(assessmentToMdRow), {
    generatedAt: new Date().toISOString(),
    baseUrl: client.baseUrl,
    app: "markovian-drug-synergy",
    processed: result.screened.length,
    failures,
    screening: { examined: result.screened.length, kept: result.kept.length, rejected, stopReason: result.stopReason, mode },
  });
  await saveProgress({
    run_id: "cell-line-synergy-screening",
    status: result.stopReason === "target_reached" ? "target_reached" : `stopped_${result.stopReason}`,
    provider, selection,
    pairs_processed: result.screened.length,
    kept: result.kept.length,
    rejected,
    failures,
    ranked_pair_ids: ranked.map((r) => r.pair_id),
    screened_file: "screened.csv",
    stop_reason: result.stopReason,
  });
  console.log(`examined=${result.screened.length} kept=${result.kept.length} rejected=${rejected} errors=${failures.length} stop=${result.stopReason}`);
  // integration: the home folder is shown as ~ so run logs hold no user name
  console.log(`ranked.csv (kept only) and screened.csv (every decision) written in ${OUT.replace(homedir(), "~")}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
