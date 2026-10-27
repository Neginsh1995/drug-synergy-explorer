import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalBlock, Markovian, resetRunSeq } from "../../reference/src/index.ts";
import { saveRoundArtifact } from "./artifacts.ts";
import { MAX_SCIENTIFIC_ROUNDS } from "./constants.ts";
import { runScientificRound, shouldStop } from "./debate.ts";
import type { MeterlessClient } from "./meterless.ts";
import { retrievePairCorpus, type Paper, type PubmedDeps } from "./pubmed.ts";
import { clampAssessment } from "./scoring.ts";
import type { ResearchUnit } from "./schema.ts";
import type { Assessment, Issue, RoundRecord } from "./types.ts";
import { markovianGoal, markovianMemoryContext } from "./prompts.ts";

export interface UnitRunResult {
  unit: ResearchUnit;
  assessment: Assessment;
  rounds: RoundRecord[];
  markovianStatus: string;
  markovianChunks: number;
  carryoverSnapshots: string[];
}

/**
 * One Markovian run per Drug1+Drug2+cell_line unit.
 * Carryover is bounded marker state for this unit only. Other units never enter memoryContext.
 */
export async function processResearchUnit(args: {
  client: MeterlessClient;
  unit: ResearchUnit;
  roundsDir: string;
  historyDir: string;
  pubmed?: PubmedDeps;
  corpus?: Paper[];
}): Promise<UnitRunResult> {
  const { client, unit, roundsDir, historyDir, pubmed } = args;
  await mkdir(roundsDir, { recursive: true });
  await mkdir(historyDir, { recursive: true });

  const corpus = args.corpus ?? (await retrievePairCorpus({
    drug1: unit.Drug1,
    drug2: unit.Drug2,
    aliases1: unit.aliases1,
    aliases2: unit.aliases2,
    cellLineOriginal: unit.cell_line_original,
    cellLineName: unit.cell_line_name, // integration
    tissue: unit.tissue, // integration
  }, pubmed));

  const rounds: RoundRecord[] = [];
  const carryoverSnapshots: string[] = [];
  let previousIssues: Issue[] = [];
  let previous: Assessment | null = null;

  resetRunSeq();
  const markovian = new Markovian({
    chunkConfig: { chunkSize: 8000, maxChunks: MAX_SCIENTIFIC_ROUNDS, carryoverTokens: 800, overlapTokens: 0 },
    historyDir: join(historyDir, unit.pair_id),
  });

  const run = await markovian.run({
    goal: markovianGoal(unit),
    mode: "RESEARCH",
    reflect: false,
    memoryContext: markovianMemoryContext(unit, corpus.map((p) => p.pmid)),
    stepFn: async ({ step, carryover }) => {
      const round = step + 1;
      if (round > MAX_SCIENTIFIC_ROUNDS) {
        return { content: "[TASK_COMPLETE]" };
      }
      const rec = await runScientificRound({
        client,
        unit,
        corpus,
        round,
        previousIssues,
        previous,
        carryover,
        pubmed,
      });
      await saveRoundArtifact(roundsDir, rec);
      rounds.push(rec);
      previous = rec.proposer;
      previousIssues = rec.critic.issues;
      const bounded = canonicalBlock({
        completed: `round ${round} class=${rec.proposer.evidence_class} synergy=${rec.proposer.direct_experimental_synergy}`,
        remaining: shouldStop(rec) ? "stop scientific review" : `up to ${MAX_SCIENTIFIC_ROUNDS - round} rounds`,
        decisions: `status=${rec.status}; pmids=${rec.proposer.verified_pmids.join(",") || "none"}`,
        context: rec.proposer.unresolved_issues.slice(0, 400),
      });
      carryoverSnapshots.push(bounded);
      const marker = shouldStop(rec)
        ? "[TASK_COMPLETE]"
        : `[STATE_CHECKPOINT]\n${bounded}`;
      return { content: `>> ${unit.pair_id} round ${round}\n${bounded}\n${marker}` };
    },
  });

  const last = rounds[rounds.length - 1];
  if (!last) {
    const failed: Assessment = clampAssessment(
      {
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
        cell_line_specific_synergy: "workflow produced no round",
        cell_line_evidence_level: "none",
        synergy_method: "unknown",
        cancer_pathway_or_phenotype: "unknown",
        mechanistic_rationale: "unknown",
        evidence_summary: run.error ?? "no rounds",
        negative_or_contradictory_evidence: "unknown",
        cell_line_model_limitations: "unknown",
        citations: [],
        verified_pmids: [],
        verified_dois: [],
        rounds_used: 0,
        unresolved_issues: run.error ?? "no rounds",
        final_status: "failed",
        confidence: "low",
        score: 0,
      },
      [{ severity: "high", text: run.error ?? "no rounds" }],
    );
    failed.final_status = "failed";
    return { unit, assessment: failed, rounds, markovianStatus: run.status, markovianChunks: run.chunks.length, carryoverSnapshots };
  }

  const assessment = { ...last.proposer, rounds_used: rounds.length };
  if (last.status === "max_rounds" && last.critic.issues.some((i) => i.severity === "high")) {
    assessment.final_status = "unresolved";
  }
  return {
    unit,
    assessment,
    rounds,
    markovianStatus: run.status,
    markovianChunks: run.chunks.length,
    carryoverSnapshots,
  };
}
