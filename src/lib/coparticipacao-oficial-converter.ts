import * as XLSX from "xlsx";
import type { ConversionResult } from "./spreadsheet-converter";

export type CnpjFilialInfo = { filial: string; codigo: string };
export type CnpjFilialMap = Map<string, CnpjFilialInfo>;

function normalizeHeader(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCnpj(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value).replace(/\D/g, "");
  // CNPJs lidos como número podem perder zeros à esquerda — completar até 14 dígitos
  if (s.length > 0 && s.length < 14) s = s.padStart(14, "0");
  return s;
}

function normalizeKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Reads a "Relação de Filiais por CNPJ" workbook.
 * Looks for CNPJ column and a "Filial" / "N° Filial" / "Nº Filial" column.
 */
export async function parseCnpjFiliaisFile(file: File): Promise<CnpjFilialMap> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rows.length === 0) {
    throw new Error("A planilha de Relação de Filiais por CNPJ está vazia.");
  }

  const sampleKeys = Object.keys(rows[0]);
  const cnpjKey = sampleKeys.find((k) => normalizeHeader(k).includes("cnpj"));
  const filialKey = sampleKeys.find((k) => {
    const n = normalizeHeader(k);
    return n.includes("filial") || n === "n filial" || n === "no filial" || n === "num filial";
  });
  const codigoKey = sampleKeys.find((k) => {
    const n = normalizeHeader(k);
    return (
      n === "cod empresa" ||
      n === "codigo empresa" ||
      n === "cod_empresa" ||
      n === "codigo" ||
      n === "cod" ||
      n.includes("cod empresa") ||
      n.includes("codigo empresa")
    );
  });

  if (!cnpjKey || !filialKey) {
    throw new Error(
      'Não foi possível identificar as colunas "CNPJ" e "N° Filial" na planilha de Relação de Filiais.',
    );
  }

  const map: CnpjFilialMap = new Map();
  for (const row of rows) {
    const cnpj = normalizeCnpj(row[cnpjKey]);
    const fil = normalizeKey(row[filialKey]);
    const cod = codigoKey ? normalizeKey(row[codigoKey]) : "";
    if (cnpj && fil) map.set(cnpj, { filial: fil, codigo: cod });
  }

  if (map.size === 0) {
    throw new Error("Nenhum mapeamento CNPJ → Filial encontrado na planilha de Relação de Filiais.");
  }

  return map;
}

/**
 * Convert "Coparticipação Oficial" main file using CNPJ → Filial mapping.
 * Keeps all original columns and adds FILIAL as the first column.
 */
export async function convertCoparticipacaoOficialFile(
  file: File,
  cnpjMap: CnpjFilialMap,
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
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][];
  if (aoa.length < 2) {
    throw new Error("A planilha principal está vazia ou não tem linhas de dados.");
  }

  const headers = aoa[0].map((h) => String(h ?? ""));
  const dataRows = aoa.slice(1);

  const cnpjIdx = headers.findIndex((h) => normalizeHeader(h) === "cnpj");
  if (cnpjIdx === -1) {
    throw new Error('Coluna "CNPJ" não encontrada na planilha principal.');
  }

  const newHeaders = ["FILIAL", "CODIGO", ...headers];

  // Locate columns for pivot (in newHeaders space)
  const findHeader = (...candidates: string[]): number => {
    const set = new Set(candidates.map(normalizeHeader));
    return newHeaders.findIndex((h) => set.has(normalizeHeader(h)));
  };
  const filialOutIdx = 0;
  const grupoOutIdx = findHeader(
    "nome grupo empresa",
    "grupo empresa",
    "grupo_empresa",
    "nome do grupo",
  );
  const codEmpresaOutIdx = findHeader(
    "codigo",
    "codigo empresa",
    "cod empresa",
    "cod_empresa",
    "num contrato",
    "num_contrato",
  );
  const cpfOutIdx = findHeader("cpf titular", "cpf_titular", "cpf");
  const valorOutIdx = findHeader(
    "valor fat. coparticipacao",
    "valor fat coparticipacao",
    "valor coparticipacao",
    "vlr participacao",
    "vlr_participacao",
    "valor",
  );

  const groups = new Map<string, unknown[][]>();
  const unmatched: unknown[][] = [];

  for (const row of dataRows) {
    if (row.every((v) => v === "" || v === null || v === undefined)) continue;

    const cnpj = normalizeCnpj(row[cnpjIdx]);
    const info = cnpjMap.get(cnpj);

    const padded = row.slice();
    while (padded.length < headers.length) padded.push("");
    const newRow = [info?.filial ?? "", info?.codigo ?? "", ...padded];

    if (info === undefined) {
      unmatched.push(newRow);
    } else {
      const key = info.filial;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(newRow);
    }
  }

  const buildPivotAoa = (rows: unknown[][]): unknown[][] => {
    type Node = { total: number; children: Map<string, Node> };
    const makeNode = (): Node => ({ total: 0, children: new Map() });
    const root = makeNode();

    const toNum = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (v === null || v === undefined || v === "") return 0;
      const s = String(v).replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    };
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
      const val = valorOutIdx >= 0 ? toNum(r[valorOutIdx]) : 0;
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

    const aoa: unknown[][] = [["Rótulos de Linha", "Soma de Valor"]];
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
    const aoaOut = [newHeaders, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoaOut);
    ws["!cols"] = newHeaders.map((h) => ({
      wch: Math.min(Math.max(String(h).length + 2, 12), 40),
    }));
    XLSX.utils.book_append_sheet(newWb, ws, "Dados");

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
