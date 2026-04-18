import * as XLSX from "xlsx";
import JSZip from "jszip";

export type FilialMap = Map<string, string>;

export interface ConversionResult {
  files: { filial: string; blob: Blob; rows: number; filename: string }[];
  unmatched: { filial: "SEM_FILIAL"; blob: Blob; rows: number; filename: string } | null;
  totalRows: number;
  totalFiliais: number;
}

const KEEP_COLUMN_NAME = "Valor Fat. Coparticipação";
const COD_EMPRESA_COLUMN = "Código Empresa";
const CUTOFF_INDEX = 25; // Z = index 25 (0-based: A=0..Y=24, Z=25)

function normalizeKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Reads the códigos workbook and returns Map<COD_EMPRESA, FILIAL>.
 */
export async function parseCodigosFile(file: File): Promise<FilialMap> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const map: FilialMap = new Map();
  for (const row of rows) {
    // Find columns case-insensitively
    const keys = Object.keys(row);
    const codKey = keys.find((k) => k.toLowerCase().replace(/_/g, " ").includes("cod") && k.toLowerCase().includes("empresa"));
    const filKey = keys.find((k) => k.toLowerCase().includes("filial"));
    if (!codKey || !filKey) continue;
    const cod = normalizeKey(row[codKey]);
    const fil = normalizeKey(row[filKey]);
    if (cod) map.set(cod, fil);
  }
  if (map.size === 0) {
    throw new Error("Não foi possível ler a Planilha de Códigos. Verifique se contém as colunas COD_EMPRESA e FILIAL.");
  }
  return map;
}

/**
 * Convert main workbook applying all rules.
 */
export async function convertMainFile(file: File, filialMap: FilialMap): Promise<ConversionResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  // Pick first non-empty sheet
  let mainSheetName = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    const ref = sh["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      if (range.e.r > 0) {
        mainSheetName = name;
        break;
      }
    }
  }
  const sheet = wb.Sheets[mainSheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][];
  if (aoa.length < 2) {
    throw new Error("A planilha principal está vazia ou não tem linhas de dados.");
  }

  const headers = aoa[0].map((h) => String(h ?? ""));
  const dataRows = aoa.slice(1);

  // Locate the AR column (Valor Fat. Coparticipação) by name to be robust
  let keepIdx = headers.findIndex((h) => h.trim() === KEEP_COLUMN_NAME);
  if (keepIdx === -1) {
    // fallback: literal AR position (index 43)
    keepIdx = 43;
  }

  const codEmpresaIdx = headers.findIndex((h) => h.trim() === COD_EMPRESA_COLUMN);
  if (codEmpresaIdx === -1) {
    throw new Error(`Coluna "${COD_EMPRESA_COLUMN}" não encontrada na planilha principal.`);
  }

  // Build new header: FILIAL + columns A..Y (indices 0..24) + Valor Fat. Coparticipação at end
  const baseHeaders = headers.slice(0, CUTOFF_INDEX); // A..Y
  const keepHeader = headers[keepIdx] ?? KEEP_COLUMN_NAME;
  const newHeaders = ["FILIAL", ...baseHeaders, keepHeader];

  // Group rows by filial
  const groups = new Map<string, unknown[][]>();
  const unmatched: unknown[][] = [];

  for (const row of dataRows) {
    // Skip fully empty rows
    if (row.every((v) => v === "" || v === null || v === undefined)) continue;

    const cod = normalizeKey(row[codEmpresaIdx]);
    const filial = filialMap.get(cod);

    const baseCells = row.slice(0, CUTOFF_INDEX);
    // pad if shorter
    while (baseCells.length < CUTOFF_INDEX) baseCells.push("");
    const keepCell = row[keepIdx] ?? "";

    const newRow = [filial ?? "", ...baseCells, keepCell];

    if (filial === undefined) {
      unmatched.push(newRow);
    } else {
      const key = filial;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(newRow);
    }
  }

  const buildBlob = (rows: unknown[][]): Blob => {
    const newWb = XLSX.utils.book_new();
    const aoaOut = [newHeaders, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoaOut);
    // column widths
    ws["!cols"] = newHeaders.map((h) => ({ wch: Math.min(Math.max(String(h).length + 2, 12), 40) }));
    XLSX.utils.book_append_sheet(newWb, ws, "Dados");
    const out = XLSX.write(newWb, { bookType: "xlsx", type: "array" });
    return new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  };

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const files = sortedKeys.map((filial) => {
    const rows = groups.get(filial)!;
    return {
      filial,
      blob: buildBlob(rows),
      rows: rows.length,
      filename: `filial_${String(filial).replace(/[^\w-]/g, "_")}.xlsx`,
    };
  });

  const unmatchedResult =
    unmatched.length > 0
      ? {
          filial: "SEM_FILIAL" as const,
          blob: buildBlob(unmatched),
          rows: unmatched.length,
          filename: "SEM_FILIAL.xlsx",
        }
      : null;

  return {
    files,
    unmatched: unmatchedResult,
    totalRows: dataRows.length,
    totalFiliais: files.length,
  };
}

export async function buildZip(result: ConversionResult): Promise<Blob> {
  const zip = new JSZip();
  for (const f of result.files) {
    zip.file(f.filename, f.blob);
  }
  if (result.unmatched) {
    zip.file(result.unmatched.filename, result.unmatched.blob);
  }
  return await zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
