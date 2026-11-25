import * as XLSX from "xlsx";
import type { ConversionResult } from "./spreadsheet-converter";

export type Insurer = "bradesco" | "sulamerica" | "prudential";

export interface CommissionRecord {
  data: string; // dd/mm/aaaa
  apolice: string;
  nome: string;
  produto: string;
  percentual: number;
  premio: number;
  comissao: number;
}

export interface GroupedRecord extends CommissionRecord {
  lancamentos: number;
}

export function parseMoney(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/R\$|\s|%/g, "");
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const tidy = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

function dateKey(d: string): number {
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : Infinity;
}

/** Soma prêmio e comissão das linhas do mesmo produto, mesma apólice e mesmo %; ordena por data crescente. */
export function groupCommissions(records: CommissionRecord[]): Map<string, GroupedRecord[]> {
  const byProduct = new Map<string, Map<string, GroupedRecord>>();
  for (const r of records) {
    const produto = r.produto || "OUTROS";
    let groups = byProduct.get(produto);
    if (!groups) byProduct.set(produto, (groups = new Map()));
    const key = `${r.apolice}|${round2(r.percentual)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...r, produto, lancamentos: 1 });
    } else {
      g.premio = round2(g.premio + r.premio);
      g.comissao = round2(g.comissao + r.comissao);
      g.lancamentos++;
      if (dateKey(r.data) < dateKey(g.data)) g.data = r.data;
    }
  }
  const out = new Map<string, GroupedRecord[]>();
  for (const [produto, groups] of byProduct) {
    out.set(
      produto,
      [...groups.values()].sort((a, b) => dateKey(a.data) - dateKey(b.data) || a.apolice.localeCompare(b.apolice)),
    );
  }
  return out;
}

/* ---------- Bradesco (arquivo massivo .xls: uma aba por fatura, produto na célula G1) ---------- */
export function parseBradescoWorkbook(wb: XLSX.WorkBook): CommissionRecord[] {
  const out: CommissionRecord[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
    const top = aoa[0] ?? [];
    const sub = aoa[1] ?? [];
    const produto = tidy(top[6]) || name;
    const col = (label: RegExp) => sub.findIndex((h) => label.test(tidy(h).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()));
    const cLanc = col(/^LANC/);
    const cApol = col(/^APOLICE/);
    const cNome = col(/^NOME/);
    const cPremio = col(/^VL_PREMIO/);
    const cPerc = col(/^(?:%\s*(?:COMISSAO)?|(?:PERCENTUAL|PERC|COMISSAO)\s*(?:DE\s+COMISSAO|%)?)$/);
    const cValor = col(/^VALOR$/);
    if (cApol < 0 || cValor < 0) continue;
    if (cPerc < 0) throw new Error(`Coluna de % de comissão não encontrada na aba ${name}. Não é possível agrupar com segurança.`);
    for (const [rowIndex, r] of aoa.entries()) {
      if (rowIndex < 2) continue;
      const apolice = tidy(r[cApol]);
      if (!apolice) continue;
      const sign = /RECUPERA|ESTORNO/i.test(tidy(r[cLanc])) ? -1 : 1;
      const rawPercent = r[cPerc];
      out.push({
        data: tidy(r[2]),
        apolice,
        nome: tidy(r[cNome]),
        produto,
        percentual: typeof rawPercent === "number" && /%/.test(sheet[XLSX.utils.encode_cell({ r: rowIndex, c: cPerc })]?.z ?? "")
          ? round2(rawPercent * 100)
          : parseMoney(rawPercent),
        premio: sign * parseMoney(r[cPremio]),
        comissao: sign * parseMoney(r[cValor]),
      });
    }
  }
  return out;
}

/* ---------- Prudential (extrato PDF) ---------- */
const PRUDENTIAL_RAMOS: Record<string, string> = {
  "82": "ACIDENTES PESSOAIS",
  "84": "DOENCAS GRAVES",
  "90": "EVENTOS ALEATORIOS",
  "93": "VIDA",
};
const NUM = String.raw`-?[\d.]+,\d{2}`;
const PRU_LINE = new RegExp(
  String.raw`^(\d{2}/\d{2}/\d{4})\s+\d+\s+(\d+)\s+(\D+?)\s+(\d{8,})\s+\d+\s+\d+\s+(.*?)\s*(${NUM})\s+(${NUM})\s+(${NUM})$`,
);

export function parsePrudentialLines(lines: string[]): CommissionRecord[] {
  const out: CommissionRecord[] = [];
  for (const line of lines) {
    const m = tidy(line).match(PRU_LINE);
    if (!m) continue;
    out.push({
      data: m[1]!,
      apolice: m[4]!,
      nome: tidy(m[5]!.replace(/Pagamento.*$|Estorno.*$/i, "")),
      produto: PRUDENTIAL_RAMOS[m[2]!] ?? tidy(m[3]),
      premio: parseMoney(m[6]),
      percentual: parseMoney(m[7]),
      comissao: parseMoney(m[8]),
    });
  }
  return out;
}

/* ---------- Sul America (PDF "Demonstrativo de pagamentos") ---------- */
export function parseSulAmericaLines(lines: string[]): CommissionRecord[] {
  const text = lines.map(tidy).join("\n");
  const blocks = text.split(/\n(?=Nome:[^\n]*Ap[óo]lice\/T[íi]tulo:)/i).filter((b) => /Ap[óo]lice\/T[íi]tulo:/i.test(b));
  const pick = (b: string, re: RegExp) => b.match(re)?.[1]?.trim() ?? "";
  return blocks.map((b) => ({
    nome: pick(b, /Nome:\s*(.+?)\s+Ap[óo]lice\/T[íi]tulo:/i),
    apolice: pick(b, /Ap[óo]lice\/T[íi]tulo:\s*(\S+)/i),
    produto: pick(b, /Produto:\s*([^\n]+?)(?:\s+\w[\w ./]*:|\n|$)/i).toUpperCase(),
    premio: parseMoney(pick(b, /Valor Pr[êe]mio Total:\s*(R\$\s*-?[\d.,]+)/i)),
    comissao: parseMoney(pick(b, /Valor Remunera[çc][ãa]o:\s*(R\$\s*-?[\d.,]+)/i)),
    percentual: parseMoney(pick(b, /Remunera[çc][ãa]o:\s*([\d.,]+)\s*%/i)),
    data: pick(b, /Data pagamento:\s*(\d{2}\/\d{2}\/\d{4})/i),
  }));
}

/* ---------- Saída ---------- */
function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Produto";
  let n = base;
  for (let i = 2; used.has(n.toUpperCase()); i++) n = `${base.slice(0, 27)} (${i})`;
  used.add(n.toUpperCase());
  return n;
}

export function buildInsurerWorkbook(grouped: Map<string, GroupedRecord[]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const header = ["Data", "Apólice", "Nome", "Produto", "% Comissão", "Prêmio (R$)", "Valor Comissão (R$)", "Qtd. lançamentos"];
  for (const produto of [...grouped.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    const rows = grouped.get(produto);
    if (!rows) continue;
    const body = rows.map((r) => [r.data, r.apolice, r.nome, r.produto, r.percentual / 100, r.premio, r.comissao, r.lancamentos]);
    const total = ["TOTAL", "", "", "", "", round2(rows.reduce((s, r) => s + r.premio, 0)), round2(rows.reduce((s, r) => s + r.comissao, 0)), rows.reduce((s, r) => s + r.lancamentos, 0)];
    const ws = XLSX.utils.aoa_to_sheet([header, ...body, total]);
    for (let r = 1; r <= body.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 4 })];
      const percent = rows[r - 1]?.percentual ?? 0;
      if (cell) cell.z = Number.isInteger(percent) ? "0%" : Number.isInteger(percent * 10) ? "0.0%" : "0.00%";
    }
    for (let r = 1; r <= body.length + 1; r++) {
      for (const c of [5, 6]) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.z = "#,##0.00";
      }
    }
    ws["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 40 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(produto, used));
  }
  return wb;
}

export const INSURER_LABEL: Record<Insurer, string> = {
  bradesco: "Bradesco",
  sulamerica: "Sul America",
  prudential: "Prudential",
};

export async function convertInsurerFile(file: File, insurer: Insurer): Promise<ConversionResult> {
  const isPdf = /\.pdf$/i.test(file.name);
  let records: CommissionRecord[];
  if (insurer === "bradesco") {
    if (isPdf) throw new Error("Para a Bradesco, envie o arquivo massivo em Excel (.xls ou .xlsx).");
    records = parseBradescoWorkbook(XLSX.read(await file.arrayBuffer(), { type: "array", raw: true }));
  } else {
    if (!isPdf) throw new Error(`Para a ${INSURER_LABEL[insurer]}, envie o extrato em PDF.`);
    const { pdfToLines } = await import("./pdf-text");
    const lines = await pdfToLines(file);
    records = insurer === "prudential" ? parsePrudentialLines(lines) : parseSulAmericaLines(lines);
  }
  if (!records.length) throw new Error(`Nenhum lançamento da ${INSURER_LABEL[insurer]} foi encontrado neste arquivo.`);
  const grouped = groupCommissions(records);
  const buf = XLSX.write(buildInsurerWorkbook(grouped), { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const rows = [...grouped.values()].reduce((s, g) => s + g.length, 0);
  return {
    files: [],
    unmatched: null,
    consolidated: { blob, rows, filename: `${file.name.replace(/\.[^.]+$/, "")}_por_apolice.xlsx` },
    totalRows: records.length,
    totalFiliais: 0,
  };
}
