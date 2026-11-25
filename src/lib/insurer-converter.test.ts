import { describe, it as test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { groupCommissions, parsePrudentialLines, type CommissionRecord } from "./insurer-converter";

const rec = (o: Partial<CommissionRecord>): CommissionRecord => ({
  data: "10/10/2026", apolice: "1", nome: "A", produto: "VIDA", percentual: 20, premio: 100, comissao: 20, ...o,
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
