import { describe, it as test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import * as XLSX from "xlsx";
import { buildInsurerWorkbook, groupCommissions, parseBradescoWorkbook, parsePrudentialLines, type CommissionRecord } from "./insurer-converter";

const rec = (o: Partial<CommissionRecord>): CommissionRecord => ({
  data: "10/10/2026", apolice: "1", nome: "A", produto: "VIDA", percentual: 20, premio: 100, comissao: 20, ...o,
});

test("exporta 20% e 25% sem juntar percentuais diferentes da mesma apólice", () => {
  const wb = buildInsurerWorkbook(groupCommissions([rec({}), rec({ premio: 50, comissao: 10 }), rec({ percentual: 25, comissao: 25 })]));
  const ws = wb.Sheets["VIDA"];
  if (!ws) throw new Error("Aba VIDA ausente");
  strictEqual(ws["E2"]?.v, 0.2);
  strictEqual(XLSX.utils.format_cell(ws["E2"]), "20%");
  strictEqual(XLSX.utils.format_cell(ws["E3"]), "25%");
  strictEqual(ws["F2"]?.v, 150);
  strictEqual(ws["G2"]?.v, 30);
  strictEqual(ws["H2"]?.v, 2);
});

test("Bradesco lê % Comissão variável e preserva 0% explícito", () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["", "", "", "", "", "", "AUTO"],
    ["LANÇ", "APÓLICE", "Data", "NOME", "VL_PRÊMIO", "% Comissão", "VALOR"],
    ["CRÉDITO", "1", "10/10/2026", "A", 100, "20,00", 20],
    ["CRÉDITO", "1", "10/10/2026", "A", 100, 0.25, 25],
    ["CRÉDITO", "1", "10/10/2026", "A", 100, "0,00", 0],
  ]);
  const percentCell = ws["F4"];
  if (!percentCell) throw new Error("Percentual ausente");
  percentCell.z = "0%";
  XLSX.utils.book_append_sheet(wb, ws, "Fatura");
  deepStrictEqual(parseBradescoWorkbook(wb).map((r) => r.percentual), [20, 25, 0]);
});

describe("Seguradoras: agrupamento por apólice e %", () => {
  test("soma prêmio e comissão da mesma apólice com o mesmo %", () => {
    const g = groupCommissions([rec({}), rec({ premio: 50, comissao: 10 })]).get("VIDA")!;
    strictEqual(g.length, 1);
    strictEqual(g[0]!.premio, 150);
    strictEqual(g[0]!.comissao, 30);
  });
  test("não soma quando o % é diferente", () => {
    strictEqual(groupCommissions([rec({}), rec({ percentual: 25 })]).get("VIDA")!.length, 2);
  });
  test("separa por produto", () => {
    deepStrictEqual([...groupCommissions([rec({}), rec({ produto: "AUTO" })]).keys()].sort(), ["AUTO", "VIDA"]);
  });
  test("ordena por data crescente", () => {
    const g = groupCommissions([rec({ apolice: "2", data: "20/10/2026" }), rec({ apolice: "3", data: "05/10/2026" })]).get("VIDA")!;
    deepStrictEqual(g.map((r) => r.data), ["05/10/2026", "20/10/2026"]);
  });
});

test("Prudential: lê uma linha do extrato", () => {
  const [r] = parsePrudentialLines([
    "15/10/2026 34169190 93 VIDA 1099300051519 9 9 TROPICAL Pagamento de Comissão 5.827,16 15,00 874,07",
  ]);
  deepStrictEqual(r, { data: "15/10/2026", apolice: "1099300051519", nome: "TROPICAL", produto: "VIDA", premio: 5827.16, percentual: 15, comissao: 874.07 });
});
