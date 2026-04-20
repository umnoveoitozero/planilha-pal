import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { FilialMap, ConversionResult } from "./spreadsheet-converter";

const COD_EMPRESA_COLUMN = "Código Empresa";
const VL_FATURA_COLUMN = "VL_FATURA";
const SINAL_COLUMN = "SINAL_OPERACAO";
const NEW_VALUE_COLUMN = "Valor_Fatura";

function normalizeKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Converts a raw VL_FATURA cell + sinal to a numeric value with 2 decimals. */
function parseFaturaValue(raw: unknown, sinal: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  let n: number;
  if (typeof raw === "number") {
    // assume number is already in "cents" representation (e.g. 88 => 0.88)
    n = raw;
  } else {
    const s = String(raw).trim().replace(/\s+/g, "");
    if (s === "") return 0;
    // If contains comma or dot as decimal separator, parse directly
    if (/[.,]/.test(s)) {
      const cleaned = s.replace(/\./g, "").replace(",", ".");
      const parsed = Number(cleaned);
      n = Number.isFinite(parsed) ? parsed * 100 : 0;
    } else {
      // pure digits string like "0000000000088"
      const parsed = Number(s);
      n = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  let value = n / 100;
  const sig = normalizeKey(sinal);
  if (sig === "-" || sig.toUpperCase() === "D" || sig.toUpperCase() === "N") {
    value = -Math.abs(value);
  } else {
    value = Math.abs(value);
  }
  return Number(value.toFixed(2));
}

export async function convertFaturamentoFile(
  file: File,
  filialMap: FilialMap,
): Promise<ConversionResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

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
  // raw:false keeps strings (preserves leading zeros like "0000000000088")
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  if (aoa.length < 2) {
    throw new Error("A planilha de Faturamento está vazia ou não tem linhas de dados.");
  }

  const headers = aoa[0].map((h) => String(h ?? ""));
  const dataRows = aoa.slice(1);

  const findIdx = (name: string) =>
    headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

  const codEmpresaIdx = findIdx(COD_EMPRESA_COLUMN);
  if (codEmpresaIdx === -1) {
    throw new Error(`Coluna "${COD_EMPRESA_COLUMN}" não encontrada na planilha de Faturamento.`);
  }
  const vlFaturaIdx = findIdx(VL_FATURA_COLUMN);
  if (vlFaturaIdx === -1) {
    throw new Error(`Coluna "${VL_FATURA_COLUMN}" não encontrada na planilha de Faturamento.`);
  }
  const sinalIdx = findIdx(SINAL_COLUMN);
  if (sinalIdx === -1) {
    throw new Error(`Coluna "${SINAL_COLUMN}" não encontrada na planilha de Faturamento.`);
  }

  // New header order: FILIAL + all original columns + Valor_Fatura
  const newHeaders = ["FILIAL", ...headers, NEW_VALUE_COLUMN];

  const groups = new Map<string, unknown[][]>();
  const unmatched: unknown[][] = [];

  for (const row of dataRows) {
    if (row.every((v) => v === "" || v === null || v === undefined)) continue;

    const cod = normalizeKey(row[codEmpresaIdx]);
    const filial = filialMap.get(cod);

    const valor = parseFaturaValue(row[vlFaturaIdx], row[sinalIdx]);

    // Pad row to header length
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");

    const newRow = [filial ?? "", ...padded, valor];

    if (filial === undefined) {
      unmatched.push(newRow);
    } else {
      if (!groups.has(filial)) groups.set(filial, []);
      groups.get(filial)!.push(newRow);
    }
  }

  // Pivot indexes within newHeaders
  const filialOutIdx = 0;
  const grupoOutIdx = newHeaders.findIndex(
    (h) => h.trim().toLowerCase() === "nome grupo empresa",
  );
  const codEmpresaOutIdx = newHeaders.findIndex(
    (h) => h.trim().toLowerCase() === "código empresa",
  );
  const cpfOutIdx = newHeaders.findIndex((h) => {
    const k = h.trim().toLowerCase();
    return k === "cpf titular" || k === "cpf_titular" || k === "cpf";
  });
  const valorOutIdx = newHeaders.length - 1;

  const buildPivotAoa = (rows: unknown[][]): unknown[][] => {
    type Node = { total: number; children: Map<string, Node> };
    const makeNode = (): Node => ({ total: 0, children: new Map() });
    const root = makeNode();

    const keyOf = (v: unknown): string => {
      const s = normalizeKey(v);
      return s === "" ? "(em branco)" : s;
    };

    for (const r of rows) {
      const path = [
        keyOf(grupoOutIdx >= 0 ? r[grupoOutIdx] : ""),
        keyOf(codEmpresaOutIdx >= 0 ? r[codEmpresaOutIdx] : ""),
        keyOf(r[filialOutIdx]),
        keyOf(cpfOutIdx >= 0 ? r[cpfOutIdx] : ""),
      ];
      const val = typeof r[valorOutIdx] === "number" ? (r[valorOutIdx] as number) : 0;
      let node = root;
      node.total += val;
      for (const seg of path) {
        let child = node.children.get(seg);
        if (!child) {
          child = makeNode();
          node.children.set(seg, child);
        }
        child.total += val;
        node = child;
      }
    }

    const aoa: unknown[][] = [["Rótulos de Linha", "Soma de Valor_Fatura"]];
    const sortKeys = (m: Map<string, Node>) =>
      Array.from(m.keys()).sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      });
    const walk = (node: Node, depth: number) => {
      for (const k of sortKeys(node.children)) {
        const child = node.children.get(k)!;
        const indent = "  ".repeat(depth);
        aoa.push([indent + k, Number(child.total.toFixed(2))]);
        if (child.children.size > 0) walk(child, depth + 1);
      }
    };
    walk(root, 0);
    aoa.push(["Total Geral", Number(root.total.toFixed(2))]);
    return aoa;
  };

  const buildBlob = (rows: unknown[][]): Blob => {
    const newWb = XLSX.utils.book_new();

    // Sheet 1: Dados
    const aoaOut = [newHeaders, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoaOut);
    ws["!cols"] = newHeaders.map((h) => ({
      wch: Math.min(Math.max(String(h).length + 2, 12), 40),
    }));
    // Format Valor_Fatura column as number
    const valorCol = newHeaders.length - 1;
    for (let r = 1; r <= rows.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: valorCol });
      const cell = ws[ref];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
      }
    }
    XLSX.utils.book_append_sheet(newWb, ws, "Dados");

    // Sheet 2: Dinâmica
    const pivotAoa = buildPivotAoa(rows);
    const wsPivot = XLSX.utils.aoa_to_sheet(pivotAoa);
    wsPivot["!cols"] = [{ wch: 50 }, { wch: 30 }];
    for (let r = 1; r < pivotAoa.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r, c: 1 });
      const cell = wsPivot[cellRef];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
      }
    }
    XLSX.utils.book_append_sheet(newWb, wsPivot, "Dinâmica");

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
      filename: `faturamento_filial_${String(filial).replace(/[^\w-]/g, "_")}.xlsx`,
    };
  });

  const unmatchedResult =
    unmatched.length > 0
      ? {
          filial: "SEM_FILIAL" as const,
          blob: buildBlob(unmatched),
          rows: unmatched.length,
          filename: "faturamento_SEM_FILIAL.xlsx",
        }
      : null;

  return {
    files,
    unmatched: unmatchedResult,
    totalRows: dataRows.length,
    totalFiliais: files.length,
  };
}

// Re-export helpers so callers can use a single import surface
export { buildZip, downloadBlob } from "./spreadsheet-converter";
export type { ConversionResult } from "./spreadsheet-converter";
