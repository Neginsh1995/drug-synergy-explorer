/**
 * Input schema: Drug1 + Drug2 + cell_line is the scientific unit.
 * Cell line is taken only from the CSV column (or explicit dataset docs), never from the filename.
 */
import { PILOT_LIMIT } from "./constants.ts";

export class IncompleteRecordError extends Error {
  constructor(
    public field: string,
    public sourceRowId: number,
  ) {
    super(
      `Incomplete record at source_row_id=${sourceRowId}: missing ${field}. No silent default is applied (including no filename-based cell line).`,
    );
    this.name = "IncompleteRecordError";
  }
}

export class PilotLimitError extends Error {
  constructor(requested: number) {
    super(`Pilot limit is ${PILOT_LIMIT} units; requested ${requested}. Full-dataset runs are not authorized.`);
    this.name = "PilotLimitError";
  }
}

export interface SourceRow {
  source_row_id: number;
  csv_line: number;
  raw: Record<string, string>;
  drug_1: string;
  drug_2: string;
  cell_line: string;
}

export interface ResearchUnit {
  pair_id: string;
  Drug1: string;
  Drug2: string;
  cell_line: string;
  cell_line_original: string;
  cell_line_normalized: string;
  cell_line_provenance: string;
  drug1_pubchem_cid: number;
  drug2_pubchem_cid: number;
  source_row_id: number;
  aliases1: string[];
  aliases2: string[];
  screen_z_hsa: string;
  screen_hsa_gt: string;
  screen_label: string;
  /** integration: row-specific annotation columns written from the Zetaris cell line table ("" when absent). */
  cell_line_name: string;
  tissue: string;
  cancer_type: string;
}

const UNSAFE = /[^A-Za-z0-9._-]+/g;

export function normalizeCellLineForId(raw: string): string {
  const s = raw.trim().replace(UNSAFE, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!s) {
    throw new IncompleteRecordError("cell_line", -1);
  }
  return s;
}

/**
 * Stable filesystem-safe unit id from source CIDs + original cell-line string.
 * Same drug pair in two cell lines MUST produce different ids.
 */
export function makePairId(cid1: number, cid2: number, cellLineOriginal: string): string {
  return `cid${cid1}_${cid2}_cl${normalizeCellLineForId(cellLineOriginal)}`;
}

export function parseCid(value: string, field: string, sourceRowId: number): number {
  const n = Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new IncompleteRecordError(field, sourceRowId);
  }
  return n;
}

export function requireField(value: string | undefined, field: string, sourceRowId: number): string {
  const s = String(value ?? "").trim();
  if (!s) throw new IncompleteRecordError(field, sourceRowId);
  return s;
}

/**
 * Map CSV columns to the canonical unit. Does not rename source columns in `raw`.
 * Does not infer cell line from the filename most_promising_UACC62_PubChemCID.csv.
 */
export function rowToUnit(
  row: SourceRow,
  names: { drug1: string; drug2: string; aliases1: string[]; aliases2: string[] },
): ResearchUnit {
  const cellOriginal = requireField(row.cell_line, "cell_line", row.source_row_id);
  const cid1 = parseCid(row.drug_1, "drug_1", row.source_row_id);
  const cid2 = parseCid(row.drug_2, "drug_2", row.source_row_id);
  return {
    pair_id: makePairId(cid1, cid2, cellOriginal),
    Drug1: names.drug1,
    Drug2: names.drug2,
    cell_line: cellOriginal,
    cell_line_original: cellOriginal,
    cell_line_normalized: normalizeCellLineForId(cellOriginal),
    cell_line_provenance: String(row.raw.cell_line_name ?? "").trim()
      ? "source_csv_columns:cell_line,cell_line_name,tissue,cancer_type (row-specific, from the Zetaris cell line table; filename is not used as cell-line evidence)"
      : "source_csv_column:cell_line (row-specific; filename is not used as cell-line evidence)",
    drug1_pubchem_cid: cid1,
    drug2_pubchem_cid: cid2,
    source_row_id: row.source_row_id,
    aliases1: names.aliases1,
    aliases2: names.aliases2,
    screen_z_hsa: row.raw.z_HSA ?? "",
    screen_hsa_gt: row.raw.Ground_Truth_label_HSA ?? "",
    screen_label: row.raw.label ?? "",
    cell_line_name: String(row.raw.cell_line_name ?? "").trim(),
    tissue: String(row.raw.tissue ?? "").trim(),
    cancer_type: String(row.raw.cancer_type ?? "").trim(),
  };
}

export function isEligibleRow(row: SourceRow): { ok: true } | { ok: false; field: string } {
  try {
    requireField(row.drug_1, "drug_1", row.source_row_id);
    requireField(row.drug_2, "drug_2", row.source_row_id);
    requireField(row.cell_line, "cell_line", row.source_row_id);
    parseCid(row.drug_1, "drug_1", row.source_row_id);
    parseCid(row.drug_2, "drug_2", row.source_row_id);
    return { ok: true };
  } catch (err) {
    if (err instanceof IncompleteRecordError) return { ok: false, field: err.field };
    throw err;
  }
}

/** Every eligible CSV row, z_HSA descending (ties: source_row_id ascending). No slicing. */
export function sortEligibleRows(rows: SourceRow[]): SourceRow[] {
  const eligible = rows.filter((r) => isEligibleRow(r).ok);
  return [...eligible].sort((a, b) => {
    const za = Number(a.raw.z_HSA ?? 0);
    const zb = Number(b.raw.z_HSA ?? 0);
    if (zb !== za) return zb - za;
    return a.source_row_id - b.source_row_id;
  });
}

export function selectPilotUnits(rows: SourceRow[], limit = PILOT_LIMIT): SourceRow[] {
  if (limit > PILOT_LIMIT) throw new PilotLimitError(limit);
  return sortEligibleRows(rows).slice(0, limit);
}

export function assertPilotLimit(count: number): void {
  if (count > PILOT_LIMIT) throw new PilotLimitError(count);
}
