import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { processResearchUnit } from "../src/workflow.ts";
import { criticJson, mockClient, mockPubmed, proposerJson, samplePaper, sampleUnit } from "./helpers.ts";

describe("Markovian isolation and bounded carryover", () => {
  it("processes one unit at a time and does not leak another unit's drugs into carryover", async () => {
    const seenPrompts: string[] = [];
    const client = mockClient(async (prompt, system) => {
      seenPrompts.push(`${system ?? ""}\n${prompt}`);
      if (system?.includes("Proposer") || prompt.includes("Return ONE JSON object")) return proposerJson();
      return criticJson();
    });
    const dir = await mkdtemp(join(tmpdir(), "iso-"));
    const u1 = sampleUnit({ pair_id: "cid111_222_cl85", Drug1: "FooDrug", Drug2: "BarDrug" });
    const u2 = sampleUnit({
      pair_id: "cid333_444_clA375",
      Drug1: "OtherOne",
      Drug2: "OtherTwo",
      cell_line: "A375",
      cell_line_original: "A375",
      cell_line_normalized: "A375",
      drug1_pubchem_cid: 333,
      drug2_pubchem_cid: 444,
      source_row_id: 2,
    });

    const r1 = await processResearchUnit({
      client,
      unit: u1,
      roundsDir: join(dir, "rounds"),
      historyDir: join(dir, "hist"),
      pubmed: mockPubmed([samplePaper()]),
      corpus: [samplePaper()],
    });
    const r2 = await processResearchUnit({
      client,
      unit: u2,
      roundsDir: join(dir, "rounds"),
      historyDir: join(dir, "hist"),
      pubmed: mockPubmed([samplePaper({ pmid: "2002", title: "unrelated", abstract: "OtherOne monotherapy notes" })]),
      corpus: [samplePaper({ pmid: "2002", title: "unrelated", abstract: "OtherOne monotherapy notes" })],
    });

    expect(r1.assessment.pair_id).toBe(u1.pair_id);
    expect(r2.assessment.pair_id).toBe(u2.pair_id);
    expect(r1.carryoverSnapshots.join(" ")).not.toMatch(/OtherOne|OtherTwo/);
    const u2Prompts = seenPrompts.filter((p) => p.includes(u2.pair_id));
    expect(u2Prompts.length).toBeGreaterThan(0);
    expect(u2Prompts.join("\n")).not.toMatch(/FooDrug|BarDrug/);
    expect(r1.carryoverSnapshots.every((s) => s.length < 4000)).toBe(true);
  });
});
