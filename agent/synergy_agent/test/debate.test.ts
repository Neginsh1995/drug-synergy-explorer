import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLatestAssessmentFromRounds, saveRoundArtifact } from "../src/artifacts.ts";
import { MAX_SCIENTIFIC_ROUNDS } from "../src/constants.ts";
import { runScientificRound } from "../src/debate.ts";
import { processResearchUnit } from "../src/workflow.ts";
import {
  criticJson,
  mockClient,
  mockPubmed,
  proposerJson,
  samplePaper,
  sampleUnit,
} from "./helpers.ts";
import type { RoundRecord } from "../src/types.ts";

describe("proposer-critic rounds", () => {
  it("stops at a maximum of three scientific rounds", async () => {
    let calls = 0;
    const client = mockClient(async (prompt, system) => {
      calls += 1;
      if (system?.includes("Proposer") || prompt.includes("Return ONE JSON object")) {
        return proposerJson({
          evidence_class: "mechanistic_pathway_only",
          citations: [{ pmid: "1001", doi: "10.1000/foo", claim: "both drugs named" }],
        });
      }
      return criticJson({
        issues: [{ severity: "high", text: "abstract does not establish synergy" }],
      });
    });
    const dir = await mkdtemp(join(tmpdir(), "markov-unit-"));
    const result = await processResearchUnit({
      client,
      unit: sampleUnit(),
      roundsDir: join(dir, "rounds"),
      historyDir: join(dir, "hist"),
      pubmed: mockPubmed([samplePaper()]),
      corpus: [samplePaper()],
    });
    expect(result.rounds.length).toBe(MAX_SCIENTIFIC_ROUNDS);
    expect(result.assessment.rounds_used).toBe(MAX_SCIENTIFIC_ROUNDS);
    expect(result.rounds.length).toBeLessThanOrEqual(3);
    expect(result.markovianChunks).toBeLessThanOrEqual(3);
  });

  it("persists each round without overwriting previous rounds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rounds-"));
    const unit = sampleUnit();
    const mk = (round: number): RoundRecord => ({
      pair_id: unit.pair_id,
      round,
      timestamp: "2026-01-01T00:00:00.000Z",
      unit,
      proposer_raw: "{}",
      proposer: {
        ...unit,
        evidence_class: "insufficient_or_conflicting",
        direct_experimental_synergy: "unknown",
        cell_line_specific_synergy: "n",
        cell_line_evidence_level: "none",
        synergy_method: "unknown",
        cancer_pathway_or_phenotype: "unknown",
        mechanistic_rationale: "",
        evidence_summary: `round ${round}`,
        negative_or_contradictory_evidence: "none",
        cell_line_model_limitations: "",
        citations: [],
        verified_pmids: [],
        verified_dois: [],
        rounds_used: round,
        unresolved_issues: "none",
        final_status: "accepted",
        confidence: "low",
        score: 10,
      },
      critic: { citation_checks: [], issues: [] },
      code_issues: [],
      status: "continue",
      changes_from_previous: "n/a",
      corpus_pmids: [],
    });
    const p1 = await saveRoundArtifact(dir, mk(1));
    const p2 = await saveRoundArtifact(dir, mk(2));
    expect(p1).not.toBe(p2);
    await expect(saveRoundArtifact(dir, mk(1))).rejects.toThrow(/overwrite/);
    expect(await readFile(p1, "utf8")).toMatch(/round 1/);
    expect(await readFile(p2, "utf8")).toMatch(/round 2/);
    const loaded = await loadLatestAssessmentFromRounds(dir, unit.pair_id);
    expect(loaded?.roundsUsed).toBe(2);
    expect(loaded?.assessment.evidence_summary).toMatch(/round 2/);
  });

  it("handles malformed proposer JSON without inventing citations", async () => {
    const client = mockClient(async (prompt) => {
      if (prompt.includes("Return ONE JSON object")) return "not json at all";
      return criticJson();
    });
    const rec = await runScientificRound({
      client,
      unit: sampleUnit(),
      corpus: [samplePaper()],
      round: 1,
      previousIssues: [],
      previous: null,
      carryover: "",
      pubmed: mockPubmed([samplePaper()]),
    });
    expect(rec.proposer.citations).toEqual([]);
    expect(rec.status).toBe("malformed");
  });
});
