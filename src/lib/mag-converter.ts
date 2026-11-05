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
      const copy: unknown[] = r.map((c) => clean(c));
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

function dateOrder(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? Date.UTC(date.y, date.m - 1, date.d) : Infinity;
  }
  const text = clean(value);
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/);
  if (br) return Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return Infinity;
}

/** Ordena por nome e depois pela data de efetivação (ou prevista, se ausente). */
export function sortMagRows(rows: unknown[][], header: string[]): unknown[][] {
  const normalized = header.map((value) =>
    clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
  );
  const effective = normalized.findIndex((value) => value.includes("data") && value.includes("efetivacao"));
  const planned = normalized.findIndex((value) => value.includes("data") && value.includes("prevista"));
  const dateColumn = effective >= 0 ? effective : normalized.findIndex((value) => value.includes("data"));
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const rowDate = (row: unknown[]) => {
    const date = dateColumn >= 0 ? dateOrder(row[dateColumn]) : Infinity;
    return Number.isFinite(date) || planned < 0 ? date : dateOrder(row[planned]);
  };
  return [...rows].sort((a, b) => {
    const nameOrder = collator.compare(clean(a[COL_NOME]), clean(b[COL_NOME]));
    if (nameOrder) return nameOrder;
    const aDate = rowDate(a);
    const bDate = rowDate(b);
    return aDate === bDate ? 0 : aDate < bDate ? -1 : 1;
  });
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
  const grouped = sortMagRows(groupMagRows(data), header);

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
