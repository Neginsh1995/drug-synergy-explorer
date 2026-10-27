import { describe, expect, it } from "vitest";
import { codeSupportChecks, enforceCitationAllowlist } from "../src/citations.ts";
import { sampleAssessment, samplePaper } from "./helpers.ts";

describe("citation verification", () => {
  it("rejects fabricated PMIDs not in the retrieved corpus", () => {
    const { kept, issues } = enforceCitationAllowlist(
      [{ pmid: "99999999", doi: "10.0/x", doi_verified: false, claim: "invented" }],
      new Set(["1001"]),
    );
    expect(kept).toHaveLength(0);
    expect(issues[0].severity).toBe("high");
    expect(issues[0].text).toMatch(/not in the code-retrieved corpus/);
  });

  it("rejects missing PMIDs", () => {
    const { kept, issues } = enforceCitationAllowlist(
      [{ pmid: "", doi: null, doi_verified: false, claim: "x" }],
      new Set(["1001"]),
    );
    expect(kept).toHaveLength(0);
    expect(issues[0].text).toMatch(/missing PMID/);
  });

  it("flags exact-cell synergy when the abstract does not name the requested cell line", () => {
    const a = sampleAssessment({
      evidence_class: "direct_experimental_synergy_exact_cell",
      direct_experimental_synergy: "yes",
      cell_line_evidence_level: "exact_cell_line",
      citations: [{ pmid: "1001", doi: "10.1000/foo", doi_verified: true, claim: "synergy in 85" }],
    });
    const issues = codeSupportChecks(a, [samplePaper()], new Set(["1001"]));
    expect(issues.some((i) => /cell_line/.test(i.text))).toBe(true);
  });

  it("marks missing abstracts instead of guessing experimental details", () => {
    const paper = samplePaper({ abstract: "", abstract_available: false });
    const a = sampleAssessment({
      citations: [{ pmid: "1001", doi: null, doi_verified: false, claim: "doses unknown" }],
    });
    const issues = codeSupportChecks(a, [paper], new Set(["1001"]));
    expect(issues.some((i) => /no abstract/.test(i.text))).toBe(true);
  });
});
