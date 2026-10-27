/** NCBI E-utilities retrieval. The LLM may only cite PMIDs this module returned. */

export interface Paper {
  pmid: string;
  doi: string | null;
  title: string;
  year: string;
  abstract: string;
  abstract_available: boolean;
  retrieval: "efetch";
}

export interface PubmedDeps {
  getJson: (url: string) => Promise<unknown>;
  getText: (url: string) => Promise<string>;
  pause?: (ms: number) => Promise<void>;
}

const UA = "MarkovianDrugSynergyAgent/1.0 (local research; NCBI E-utilities)";
const defaultPause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function defaultGetJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`pubmed http ${res.status}`);
  return res.json();
}

async function defaultGetText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`pubmed http ${res.status}`);
  return res.text();
}

function deps(d?: PubmedDeps): Required<PubmedDeps> {
  return {
    getJson: d?.getJson ?? defaultGetJson,
    getText: d?.getText ?? defaultGetText,
    pause: d?.pause ?? defaultPause,
  };
}

export async function searchPubmed(term: string, retmax = 20, d?: PubmedDeps): Promise<string[]> {
  const { getJson, pause } = deps(d);
  const params = new URLSearchParams({
    db: "pubmed",
    term,
    retmode: "json",
    retmax: String(retmax),
    sort: "relevance",
  });
  const data = (await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}`)) as {
    esearchresult?: { idlist?: string[] };
  };
  await pause(340);
  return data.esearchresult?.idlist ?? [];
}

export async function fetchPubmedRecords(pmids: string[], d?: PubmedDeps): Promise<Paper[]> {
  const { getText, pause } = deps(d);
  const ids = [...new Set(pmids.filter(Boolean))];
  if (!ids.length) return [];
  const params = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "xml" });
  const xml = await getText(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`);
  await pause(340);
  return parsePubmedXml(xml);
}

export async function searchPubmedByDoi(doi: string, d?: PubmedDeps): Promise<string[]> {
  const cleaned = doi.trim();
  if (!cleaned) return [];
  return searchPubmed(`${cleaned}[AID] OR ${cleaned}[DOI]`, 5, d);
}

export function parsePubmedXml(xml: string): Paper[] {
  const articles = xml.split("<PubmedArticle>").slice(1);
  const out: Paper[] = [];
  for (const raw of articles) {
    const pmid = textOf(raw, "PMID");
    if (!pmid) continue;
    const title = textOf(raw, "ArticleTitle");
    const yearMatch = raw.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const doiMatch = raw.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/i);
    const absParts = [...raw.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    const abstract = absParts.join(" ");
    out.push({
      pmid,
      doi: doiMatch ? doiMatch[1] : null,
      title,
      year: yearMatch ? yearMatch[1] : "",
      abstract,
      abstract_available: abstract.length > 0,
      retrieval: "efetch",
    });
  }
  return out;
}

function textOf(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

export function buildSearchQueries(args: {
  drug1: string;
  drug2: string;
  aliases1: string[];
  aliases2: string[];
  cellLineOriginal: string;
  cellLineName?: string;
  tissue?: string;
}): string[] {
  const a = [args.drug1, ...args.aliases1].filter(Boolean).map((s) => `"${s}"`).join(" OR ");
  const b = [args.drug2, ...args.aliases2].filter(Boolean).map((s) => `"${s}"`).join(" OR ");
  // integration: search by the cell line's name (e.g. UACC62, also as UACC-62) when the input gives it,
  // and by the cell line's own tissue instead of fixed skin terms.
  const name = (args.cellLineName ?? "").trim();
  const cell = name ? cellLineTerms(name) : args.cellLineOriginal.trim() ? `"${args.cellLineOriginal.trim()}"` : "";
  const queries = [
    `(${a}) AND (${b}) AND (synerg* OR combinational OR combination)`,
    `(${a}) AND (${b})`,
    `(${a}) AND (${b}) AND (${tissueTerms(args.tissue ?? "")})`,
  ];
  if (cell) {
    queries.push(`(${a}) AND (${b}) AND (${cell})`);
    queries.push(`(${a}) AND ("cell line") AND (${cell})`);
    queries.push(`(${b}) AND ("cell line") AND (${cell})`);
  }
  return queries;
}

/** integration: the cell line name as written, plus a hyphenated form (UACC62 -> UACC-62). */
export function cellLineTerms(name: string): string {
  const forms = new Set([name]);
  const m = name.match(/^([A-Za-z]+)(\d+)$/);
  if (m) forms.add(`${m[1]}-${m[2]}`);
  return [...forms].map((f) => `"${f}"`).join(" OR ");
}

/** integration: tissue context for the search; skin keeps the original skin terms. */
export function tissueTerms(tissue: string): string {
  const t = tissue.trim().toLowerCase();
  if (t === "skin") return 'skin OR keratinocyte OR melanocyte OR melanoma OR dermal OR pigmentation OR collagen OR "wound healing" OR inflammation';
  const generic = "cancer OR tumor OR tumour OR carcinoma OR neoplasm";
  return t ? `"${t}" OR "${t} cancer" OR ${generic}` : generic;
}

export async function retrievePairCorpus(
  args: {
    drug1: string;
    drug2: string;
    aliases1: string[];
    aliases2: string[];
    cellLineOriginal: string;
    cellLineName?: string;
    tissue?: string;
  },
  d?: PubmedDeps,
): Promise<Paper[]> {
  const queries = buildSearchQueries(args);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const found = await searchPubmed(q, 12, d);
      for (const id of found) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    } catch {
      // keep other queries; empty/error is recorded by missing ids
    }
  }
  return fetchPubmedRecords(ids.slice(0, 40), d);
}

export function verifyDoiAgainstRecords(doi: string | null | undefined, papers: Paper[]): {
  verified: boolean;
  pmid: string | null;
} {
  if (!doi) return { verified: false, pmid: null };
  const want = doi.trim().toLowerCase();
  const hit = papers.find((p) => (p.doi ?? "").trim().toLowerCase() === want);
  return hit ? { verified: true, pmid: hit.pmid } : { verified: false, pmid: null };
}
