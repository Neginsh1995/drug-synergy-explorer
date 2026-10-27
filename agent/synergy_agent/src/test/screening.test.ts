import { describe, expect, it } from "vitest";
import { decideSynergy, screenUntilKept } from "../src/screening.ts";
import type { Assessment } from "../src/types.ts";

const mk = (evidence_class: string, extra: Partial<Assessment> = {}) =>
  ({ evidence_class, final_status: "accepted", direct_experimental_synergy: "unknown", score: 50, rounds_used: 1, ...extra }) as unknown as Assessment;

describe("decideSynergy", () => {
  it("strict keeps only experimental synergy classes", () => {
    expect(decideSynergy(mk("synergy_other_model")).keep).toBe(true);
    expect(decideSynergy(mk("mechanistic_pathway_only")).keep).toBe(false);
    expect(decideSynergy(mk("computational_prediction_only")).keep).toBe(false);
  });
  it("include_mechanistic also keeps pathway-only", () => {
    expect(decideSynergy(mk("mechanistic_pathway_only"), "include_mechanistic").keep).toBe(true);
    expect(decideSynergy(mk("insufficient_or_conflicting"), "include_mechanistic").keep).toBe(false);
  });
  it("rejects rejected/failed status and explicit no-synergy", () => {
    expect(decideSynergy(mk("synergy_other_model", { final_status: "rejected" })).keep).toBe(false);
    expect(decideSynergy(mk("synergy_other_model", { direct_experimental_synergy: "no" })).keep).toBe(false);
  });
});

describe("screenUntilKept", () => {
  const run = (classes: string[], target = 2, max = 10) =>
    screenUntilKept({
      candidates: classes.map((c, i) => ({ id: `p${i}`, c })),
      idOf: (x) => x.id,
      evaluate: async (x) => {
        if (x.c === "boom") throw new Error("nightshift down");
        return mk(x.c);
      },
      decide: (a) => decideSynergy(a),
      targetKeep: target,
      maxExamine: max,
    });
  it("skips rejected pairs and stops exactly at the target", async () => {
    const r = await run(["mechanistic_pathway_only", "synergy_other_model", "insufficient_or_conflicting", "synergy_other_model", "synergy_other_model"]);
    expect(r.kept).toHaveLength(2);
    expect(r.screened).toHaveLength(4); // 5th candidate never examined
    expect(r.stopReason).toBe("target_reached");
  });
  it("records errors and moves on", async () => {
    const r = await run(["boom", "synergy_other_model", "synergy_other_model"]);
    expect(r.screened[0].decision).toBe("error");
    expect(r.kept).toHaveLength(2);
  });
  it("respects the examine cap", async () => {
    const r = await run(Array(8).fill("insufficient_or_conflicting"), 2, 3);
    expect(r.screened).toHaveLength(3);
    expect(r.stopReason).toBe("max_examined");
  });
  it("reports exhaustion", async () => {
    const r = await run(["insufficient_or_conflicting"], 2, 10);
    expect(r.stopReason).toBe("candidates_exhausted");
  });
});
