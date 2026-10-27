import { describe, expect, it } from "vitest";
import { RANKED_COLUMNS, writeRankedCsv } from "../src/artifacts.ts";
import { clampAssessment, rankAssessments, scoreAssessment } from "../src/scoring.ts";
import { sampleAssessment } from "./helpers.ts";

describe("evidence scoring and ranking", () => {
  it("ranks exact-cell synergy above mechanism and insufficient evidence", () => {
    const rows = rankAssessments([
      sampleAssessment({ pair_id: "a", evidence_class: "mechanistic_pathway_only", score: 30 }),
      sampleAssessment({ pair_id: "b", evidence_class: "direct_experimental_synergy_exact_cell", score: 90 }),
      sampleAssessment({ pair_id: "c", evidence_class: "insufficient_or_conflicting", score: 10 }),
      sampleAssessment({ pair_id: "d", evidence_class: "synergy_other_model", score: 50 }),
    ]);
    expect(rows.map((r) => r.pair_id)).toEqual(["b", "d", "a", "c"]);
    expect(rows[0].rank).toBe(1);
  });

  it("applies negative-evidence and abstract penalties", () => {
    const pos = scoreAssessment(
      sampleAssessment({ evidence_class: "synergy_other_model", negative_or_contradictory_evidence: "none" }),
      [],
    );
    const neg = scoreAssessment(
      sampleAssessment({
        evidence_class: "synergy_other_model",
        negative_or_contradictory_evidence: "PMID 1 reports antagonism",
      }),
      [{ severity: "medium", text: "PMID 1 has no abstract" }],
    );
    expect(neg.value).toBeLessThan(pos.value);
  });

  it("will not accept unsupported positive synergy", () => {
    const clamped = clampAssessment(
      sampleAssessment({
        evidence_class: "direct_experimental_synergy_exact_cell",
        direct_experimental_synergy: "yes",
        citations: [],
      }),
      [{ severity: "high", text: "direct_experimental_synergy=yes is not supported by PMID 1" }],
    );
    expect(clamped.direct_experimental_synergy).not.toBe("yes");
    expect(clamped.evidence_class).not.toBe("direct_experimental_synergy_exact_cell");
  });

  it("serializes ranked.csv with stable canonical columns and JSON arrays", () => {
    const csv = writeRankedCsv([
      sampleAssessment({
        rank: 1,
        verified_pmids: ["1001"],
        verified_dois: ["10.1000/foo"],
        citations: [{ pmid: "1001", doi: "10.1000/foo", doi_verified: true, claim: "x" }],
      }),
    ]);
    const header = csv.trim().split("\n")[0];
    expect(header.split(",")).toEqual([...RANKED_COLUMNS]);
    expect(csv).toMatch(/\["1001"\]|\[""1001""\]/);
    expect(csv).toContain("final_status");
  });
});
