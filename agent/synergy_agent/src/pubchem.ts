import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface CidRecord {
  cid: number;
  title: string;
  iupac?: string;
  synonyms: string[];
  source: string;
}

export async function loadCidCache(path: string): Promise<Record<string, CidRecord>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, CidRecord>;
  } catch {
    return {};
  }
}

export async function resolveCids(cids: number[], cachePath: string): Promise<Record<string, CidRecord>> {
  const cache = await loadCidCache(cachePath);
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const cid of cids) {
    const key = String(cid);
    if (cache[key]?.title) continue;
    const propUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/Title,IUPACName/JSON`;
    const propRes = await fetch(propUrl);
    if (!propRes.ok) throw new Error(`PubChem ${cid} ${propRes.status}`);
    const propJson = (await propRes.json()) as { PropertyTable: { Properties: { Title?: string; IUPACName?: string }[] } };
    const props = propJson.PropertyTable.Properties[0];
    let synonyms: string[] = [];
    try {
      const synRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`);
      if (synRes.ok) {
        const synJson = (await synRes.json()) as { InformationList: { Information: { Synonym?: string[] }[] } };
        synonyms = (synJson.InformationList.Information[0].Synonym ?? []).slice(0, 8);
      }
    } catch {
      synonyms = [];
    }
    cache[key] = {
      cid,
      title: props.Title ?? `CID ${cid}`,
      iupac: props.IUPACName,
      synonyms,
      source: "PubChem PUG REST",
    };
    await pause(250);
  }
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2));
  return cache;
}
