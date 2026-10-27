import { readFile } from "node:fs/promises";
import type { SourceRow } from "./schema.ts";

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(raw: string): { header: string[]; rows: SourceRow[] } {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const header = parseCsvLine(lines[0]);
  const rows: SourceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });
    rows.push({
      source_row_id: i,
      csv_line: i + 1,
      raw: rec,
      drug_1: rec.drug_1 ?? "",
      drug_2: rec.drug_2 ?? "",
      cell_line: rec.cell_line ?? "",
    });
  }
  return { header, rows };
}

export async function loadSourceCsv(path: string): Promise<{ header: string[]; rows: SourceRow[] }> {
  return parseCsv(await readFile(path, "utf8"));
}

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
