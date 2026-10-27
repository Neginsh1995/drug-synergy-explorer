import type { MeterlessClient } from "../src/meterless.ts";
import type { Assessment } from "../src/types.ts";
import type { Paper, PubmedDeps } from "../src/pubmed.ts";
import type { ResearchUnit } from "../src/schema.ts";

export function sampleUnit(over: Partial<ResearchUnit> = {}): ResearchUnit {
  return {
    pair_id: "cid111_222_cl85",
    Drug1: "FooDrug",
    Drug2: "BarDrug",
    cell_line: "85",
    cell_line_original: "85",
    cell_line_normalized: "85",
    cell_line_provenance: "source_csv_column:cell_line (row-specific; filename is not used as cell-line evidence)",
    drug1_pubchem_cid: 111,
    drug2_pubchem_cid: 222,
    source_row_id: 1,
    aliases1: ["Foo"],
    aliases2: ["Bar"],
    screen_z_hsa: "3.1",
    screen_hsa_gt: "20",
    screen_label: "synergy",
    ...over,
  };
}

export function samplePaper(over: Partial<Paper> = {}): Paper {
  return {
    pmid: "1001",
    doi: "10.1000/foo",
    title: "FooDrug and BarDrug combination in model X",
    year: "2020",
    abstract: "We tested FooDrug and BarDrug together in cell line X. Synergy was not quantified.",
    abstract_available: true,
    retrieval: "efetch",
    ...over,
  };
}

export function sampleAssessment(over: Partial<Assessment> = {}): Assessment {
  const u = sampleUnit();
  return {
    pair_id: u.pair_id,
    Drug1: u.Drug1,
    Drug2: u.Drug2,
    cell_line: u.cell_line,
    cell_line_original: u.cell_line_original,
    cell_line_provenance: u.cell_line_provenance,
    drug1_pubchem_cid: u.drug1_pubchem_cid,
    drug2_pubchem_cid: u.drug2_pubchem_cid,
    source_row_id: u.source_row_id,
    evidence_class: "insufficient_or_conflicting",
    direct_experimental_synergy: "unknown",
    cell_line_specific_synergy: "none retrieved",
    cell_line_evidence_level: "none",
    synergy_method: "unknown",
    cancer_pathway_or_phenotype: "unknown",
    mechanistic_rationale: "unknown",
    evidence_summary: "no verified combination evidence",
    negative_or_contradictory_evidence: "none",
    cell_line_model_limitations: "cell_line identifier is the CSV value 85; not mapped from filename",
    citations: [],
    verified_pmids: [],
    verified_dois: [],
    rounds_used: 1,
    unresolved_issues: "none",
    final_status: "accepted",
    confidence: "low",
    score: 10,
    ...over,
  };
}

export function mockClient(handler: (prompt: string, system?: string) => string | Promise<string>): MeterlessClient {
  return {
    baseUrl: "http://127.0.0.1:8088/v1",
    status: "online",
    models: ["meterless/auto"],
    complete: async (prompt, system) => handler(prompt, system),
  };
}

export function pubmedXml(papers: Paper[]): string {
  return papers
    .map(
      (p) =>
        `<PubmedArticle><PMID>${p.pmid}</PMID><ArticleTitle>${p.title}</ArticleTitle>` +
        `<PubDate><Year>${p.year}</Year></PubDate>` +
        (p.doi ? `<ArticleId IdType="doi">${p.doi}</ArticleId>` : "") +
        (p.abstract_available ? `<AbstractText>${p.abstract}</AbstractText>` : "") +
        `</PubmedArticle>`,
    )
    .join("");
}

export function mockPubmed(papers: Paper[]): PubmedDeps {
  const ids = papers.map((p) => p.pmid);
  return {
    getJson: async () => ({ esearchresult: { idlist: ids } }),
    getText: async () => pubmedXml(papers),
    pause: async () => {},
  };
}

export function proposerJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    evidence_class: "insufficient_or_conflicting",
    direct_experimental_synergy: "unknown",
    cell_line_specific_synergy: "no exact-cell evidence in abstracts",
    cell_line_evidence_level: "none",
    synergy_method: "unknown",
    cancer_pathway_or_phenotype: "unknown",
    mechanistic_rationale: "hypothesis without citation support",
    evidence_summary: "Retrieved records do not establish synergy in cell_line 85.",
    negative_or_contradictory_evidence: "none",
    cell_line_model_limitations: "CSV cell_line value 85 is not a conventional cell-line name in abstracts",
    citations: [],
    unknowns: ["whether 85 denotes a named line in the original screen"],
    ...over,
  });
}

export function criticJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    citation_checks: [],
    issues: [],
    ...over,
  });
}
