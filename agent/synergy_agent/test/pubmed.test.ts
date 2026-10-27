import { describe, expect, it } from "vitest";
import {
  buildSearchQueries,
  fetchPubmedRecords,
  parsePubmedXml,
  retrievePairCorpus,
  verifyDoiAgainstRecords,
} from "../src/pubmed.ts";
import { mockPubmed, pubmedXml, samplePaper } from "./helpers.ts";

describe("PubMed retrieval", () => {
  it("builds queries from drugs, aliases, and the actual cell-line string", () => {
    const qs = buildSearchQueries({
      drug1: "FooDrug",
      drug2: "BarDrug",
      aliases1: ["Foo"],
      aliases2: ["Bar"],
      cellLineOriginal: "85",
    });
    expect(qs.some((q) => q.includes('"85"'))).toBe(true);
    expect(qs.some((q) => q.includes("synerg"))).toBe(true);
    expect(qs.join(" ")).not.toMatch(/UACC-62/);
  });

  it("parses efetch XML into records; missing abstracts stay unavailable", () => {
    const withAbs = parsePubmedXml(pubmedXml([samplePaper()]));
    expect(withAbs[0].pmid).toBe("1001");
    expect(withAbs[0].doi).toBe("10.1000/foo");
    expect(withAbs[0].abstract_available).toBe(true);
    const noAbs = parsePubmedXml(pubmedXml([samplePaper({ abstract: "", abstract_available: false })]));
    expect(noAbs[0].abstract_available).toBe(false);
  });

  it("does not treat search snippets as retrieved records", async () => {
    const papers = await fetchPubmedRecords(["1001"], mockPubmed([samplePaper()]));
    expect(papers[0].retrieval).toBe("efetch");
    expect(papers[0].title.length).toBeGreaterThan(0);
  });

  it("verifies DOIs only against retrieved records", () => {
    const papers = [samplePaper()];
    expect(verifyDoiAgainstRecords("10.1000/foo", papers).verified).toBe(true);
    expect(verifyDoiAgainstRecords("10.9999/invented", papers).verified).toBe(false);
    expect(verifyDoiAgainstRecords(null, papers).verified).toBe(false);
  });

  it("retrieves a corpus via injected E-utilities deps (no live network in this test)", async () => {
    const corpus = await retrievePairCorpus(
      {
        drug1: "FooDrug",
        drug2: "BarDrug",
        aliases1: [],
        aliases2: [],
        cellLineOriginal: "85",
      },
      mockPubmed([samplePaper()]),
    );
    expect(corpus.map((p) => p.pmid)).toEqual(["1001"]);
  });
});

// integration: the agent works for any cell line; searches use the cell line's name and tissue when given.
import { cellLineTerms, tissueTerms } from "../src/pubmed.ts";
describe("cell line name and tissue (integration)", () => {
  it("searches by the cell line name and its hyphenated form", () => {
    expect(cellLineTerms("UACC62")).toBe('"UACC62" OR "UACC-62"');
    expect(cellLineTerms("786-0")).toBe('"786-0"');
  });
  it("uses the cell line's tissue, keeping the skin terms for skin", () => {
    expect(tissueTerms("skin")).toMatch(/melanocyte/);
    expect(tissueTerms("large intestine")).toMatch(/"large intestine cancer"/);
    expect(tissueTerms("")).not.toMatch(/skin/);
  });
  it("puts the name into the cell-line queries only when given", () => {
    const base = { drug1: "A", drug2: "B", aliases1: [], aliases2: [], cellLineOriginal: "85" };
    expect(buildSearchQueries({ ...base, cellLineName: "UACC62", tissue: "skin" }).join(" ")).toMatch(/UACC-62/);
    expect(buildSearchQueries(base).join(" ")).not.toMatch(/UACC/);
  });
});
