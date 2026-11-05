import { describe, it as test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { groupMagRows, sortMagRows } from "./mag-converter";

const header = Array.from({ length: 23 }, () => "");
header[17] = "Data prevista";
header[18] = "Data de efetivação do crédito/débito";

function row(name: string, date: unknown, percentage = "25%", base = "100,00", commission = "25,00") {
  const values: unknown[] = Array.from({ length: 23 }, () => "");
  values[3] = name;
  values[10] = base;
  values[18] = date;
  values[21] = commission;
  values[22] = percentage;
  return values;
}

describe("MAG output ordering", () => {
  test("orders names alphabetically using Portuguese accents", () => {
    deepStrictEqual(sortMagRows([row("Zelia", "01/01/2026"), row("Bruna", "01/01/2026"), row("Álvaro", "01/01/2026")], header).map((r) => r[3]),
      ["Álvaro", "Bruna", "Zelia"]);
  });

  test("orders dates oldest first within a name, with missing dates last", () => {
    const rows = [row("Ana", ""), row("Ana", "02/11/2026"), row("Ana", "15/10/2026")];
    deepStrictEqual(sortMagRows(rows, header).map((r) => r[18]), ["15/10/2026", "02/11/2026", ""]);
  });

  test("supports Excel serial dates and falls back to planned dates", () => {
    const planned = row("Ana", "");
    planned[17] = "01/01/2026";
    deepStrictEqual(sortMagRows([row("Ana", 46327), planned], header)[0], planned);
  });

  test("preserves grouping and sums of K and V when ordering", () => {
    const grouped = sortMagRows(groupMagRows([
      row("Zelia", "01/01/2026"),
      row("Ana", "15/10/2026", "25%", "100,00", "25,00"),
      row("Ana", "16/10/2026", "25%", "200,00", "50,00"),
      row("Ana", "01/10/2026", "10%", "50,00", "5,00"),
    ]), header);
    strictEqual(grouped.length, 3);
    deepStrictEqual(grouped.map((r) => [r[3], r[22], r[10], r[21]]), [
      ["Ana", "10%", 50, 5], ["Ana", "25%", 300, 75], ["Zelia", "25%", 100, 25],
    ]);
  });
});