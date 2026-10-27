import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.ts";
import {
  IncompleteRecordError,
  PilotLimitError,
  isEligibleRow,
  makePairId,
  normalizeCellLineForId,
  rowToUnit,
  selectPilotUnits,
  assertPilotLimit,
} from "../src/schema.ts";
import { PILOT_LIMIT } from "../src/constants.ts";

const CSV = `drug_1,drug_2,cell_line,z_HSA
111,222,85,3.0
333,444,85,4.0
555,666,,2.0
777,888,A375,1.0
`;

describe("input schema", () => {
  it("requires Drug1, Drug2, and cell_line from CSV columns", () => {
    const { rows } = parseCsv(CSV);
    expect(isEligibleRow(rows[0]).ok).toBe(true);
    expect(isEligibleRow(rows[2]).ok).toBe(false);
    expect((isEligibleRow(rows[2]) as { field: string }).field).toBe("cell_line");
  });

  it("does not default a missing cell line (including from filename UACC-62)", () => {
    const { rows } = parseCsv(CSV);
    expect(() =>
      rowToUnit(rows[2], { drug1: "A", drug2: "B", aliases1: [], aliases2: [] }),
    ).toThrow(IncompleteRecordError);
    expect(() =>
      rowToUnit(rows[2], { drug1: "A", drug2: "B", aliases1: [], aliases2: [] }),
    ).toThrow(/filename/);
  });

  it("uses the row-specific cell_line value, not the filename", () => {
    const { rows } = parseCsv(CSV);
    const u = rowToUnit(rows[3], { drug1: "A", drug2: "B", aliases1: [], aliases2: [] });
    expect(u.cell_line).toBe("A375");
    expect(u.cell_line_original).toBe("A375");
    expect(u.cell_line_provenance).toMatch(/source_csv_column:cell_line/);
    expect(u.cell_line).not.toMatch(/UACC/i);
  });

  it("builds stable unique pair ids that include cell line", () => {
    const a = makePairId(111, 222, "85");
    const b = makePairId(111, 222, "85");
    const c = makePairId(111, 222, "A375");
    expect(a).toBe(b);
    expect(a).toBe("cid111_222_cl85");
    expect(c).toBe("cid111_222_clA375");
    expect(a).not.toBe(c);
  });

  it("separates the same drug pair across cell lines", () => {
    const { rows } = parseCsv(`drug_1,drug_2,cell_line,z_HSA
111,222,85,1
111,222,A375,1
`);
    const u1 = rowToUnit(rows[0], { drug1: "Foo", drug2: "Bar", aliases1: [], aliases2: [] });
    const u2 = rowToUnit(rows[1], { drug1: "Foo", drug2: "Bar", aliases1: [], aliases2: [] });
    expect(u1.pair_id).not.toBe(u2.pair_id);
    expect(u1.Drug1).toBe(u2.Drug1);
    expect(u1.cell_line).not.toBe(u2.cell_line);
  });

  it("sanitizes unsafe path characters in cell-line ids", () => {
    expect(normalizeCellLineForId("UACC-62 / melanoma")).toBe("UACC-62_melanoma");
  });

  it("enforces the five-unit pilot limit", () => {
    expect(() => assertPilotLimit(6)).toThrow(PilotLimitError);
    const { rows } = parseCsv(`drug_1,drug_2,cell_line,z_HSA
1,2,85,1
1,3,85,2
1,4,85,3
1,5,85,4
1,6,85,5
1,7,85,6
`);
    expect(() => selectPilotUnits(rows, 6)).toThrow(PilotLimitError);
    const five = selectPilotUnits(rows, 5);
    expect(five).toHaveLength(PILOT_LIMIT);
    expect(five[0].drug_2).toBe("7");
  });
});

describe("source CSV", () => {
  it("maps most_promising_UACC62_PubChemCID.csv columns without inventing UACC-62", () => {
    const raw = readFileSync(new URL("../../../results/most_promising_UACC62_PubChemCID.csv", import.meta.url) /* integration: shortlist now in results/ */, "utf8");
    const { header, rows } = parseCsv(raw);
    expect(header).toContain("drug_1");
    expect(header).toContain("drug_2");
    expect(header).toContain("cell_line");
    expect(new Set(rows.map((r) => r.cell_line))).toEqual(new Set(["85"]));
    expect(rows.every((r) => r.cell_line === "85")).toBe(true);
    const five = selectPilotUnits(rows, 5);
    expect(five).toHaveLength(5);
    expect(five.map((r) => r.source_row_id)).toEqual([1, 2, 3, 4, 5]);
  });
});
