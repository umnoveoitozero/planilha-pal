import * as XLSX from "xlsx";
import type { ConversionResult } from "./spreadsheet-converter";

const COL_NOME = 3; // D
const COL_BASE = 10; // K
const COL_COMISSAO = 21; // V
const COL_PERC = 22; // W

export function parseBrNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function clean(v: unknown): string {
  return String(v ?? "").replace(/^\uFEFF/, "").trim();
}

/** Agrupa linhas com mesmo Nome (D) e mesmo % Comissão (W), somando K e V. */
export function groupMagRows(rows: unknown[][]): unknown[][] {
  const groups = new Map<string, unknown[]>();
  for (const r of rows) {
    if (!r || r.every((c) => clean(c) === "")) continue;
    const key = `${clean(r[COL_NOME]).toUpperCase()}|${clean(r[COL_PERC])}`;
    const existing = groups.get(key);
    if (!existing) {
      const copy = r.map((c) => clean(c));
      copy[COL_BASE] = parseBrNumber(r[COL_BASE]);
      copy[COL_COMISSAO] = parseBrNumber(r[COL_COMISSAO]);
      groups.set(key, copy);
    } else {
      existing[COL_BASE] = Math.round(((existing[COL_BASE] as number) + parseBrNumber(r[COL_BASE])) * 100) / 100;
      existing[COL_COMISSAO] =
        Math.round(((existing[COL_COMISSAO] as number) + parseBrNumber(r[COL_COMISSAO])) * 100) / 100;
    }
  }
  return [...groups.values()];
}

export async function convertMagFile(file: File): Promise<ConversionResult> {
  let wb: XLSX.WorkBook;
  if (/\.(csv|txt)$/i.test(file.name)) {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const sep = (text.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > 0 ? ";" : ",";
    wb = XLSX.read(text, { type: "string", FS: sep, raw: true });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  if (aoa.length < 2) throw new Error("A planilha MAG está vazia.");
  const header = aoa[0].map(clean);
  const data = aoa.slice(1);
  const grouped = groupMagRows(data);

  const ws = XLSX.utils.aoa_to_sheet([header, ...grouped]);
  for (let r = 1; r <= grouped.length; r++) {
    for (const c of [COL_BASE, COL_COMISSAO]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.z = "#,##0.00";
    }
  }
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, ws, "MAG");
  const buf = XLSX.write(out, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const base = file.name.replace(/\.[^.]+$/, "");
  return {
    files: [],
    unmatched: null,
    consolidated: { blob, rows: grouped.length, filename: `${base}_agrupado.xlsx` },
    totalRows: data.filter((r) => r.some((c) => clean(c) !== "")).length,
    totalFiliais: 0,
  };
}
