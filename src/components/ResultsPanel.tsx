import { motion } from "framer-motion";
import { Download, Package, FileSpreadsheet, AlertTriangle } from "lucide-react";
import type { ConversionResult } from "@/lib/spreadsheet-converter";
import { buildZip, downloadBlob } from "@/lib/spreadsheet-converter";
import { useState } from "react";

interface ResultsPanelProps {
  result: ConversionResult;
  onReset: () => void;
}

export function ResultsPanel({ result, onReset }: ResultsPanelProps) {
  const [zipping, setZipping] = useState(false);

  const handleDownloadAll = async () => {
    setZipping(true);
    try {
      const zip = await buildZip(result);
      downloadBlob(zip, "planilhas_por_filial.zip");
    } finally {
      setZipping(false);
    }
  };

  const allFiles = [
    ...result.files,
    ...(result.unmatched ? [result.unmatched] : []),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Linhas processadas" value={result.totalRows.toLocaleString("pt-BR")} />
        <StatCard label="Filiais geradas" value={String(result.totalFiliais)} />
        <StatCard
          label="Sem correspondência"
          value={result.unmatched ? String(result.unmatched.rows) : "0"}
          warning={!!result.unmatched}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={handleDownloadAll}
          disabled={zipping}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--gradient-primary)] px-5 py-3 text-sm font-semibold text-slate-900 shadow-[var(--shadow-elegant)] transition-transform hover:scale-[1.01] disabled:opacity-60"
        >
          <Package className="h-4 w-4" />
          {zipping ? "Compactando..." : "Baixar tudo (.zip)"}
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Nova conversão
        </button>
      </div>

      {/* File list */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">Arquivos gerados ({allFiles.length})</h3>
        </div>
        <ul className="divide-y divide-border">
          {allFiles.map((f, i) => {
            const isUnmatched = "filial" in f && f.filial === "SEM_FILIAL";
            return (
              <motion.li
                key={f.filename}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <div
                  className={
                    "flex h-9 w-9 items-center justify-center rounded-lg " +
                    (isUnmatched ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")
                  }
                >
                  {isUnmatched ? <AlertTriangle className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {isUnmatched ? "Sem filial correspondente" : `Filial ${f.filial}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.filename} · {f.rows.toLocaleString("pt-BR")} linhas
                  </p>
                </div>
                <button
                  onClick={() => downloadBlob(f.blob, f.filename)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar
                </button>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </motion.div>
  );
}

function StatCard({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={"mt-1 text-2xl font-bold " + (warning ? "text-destructive" : "text-foreground")}>{value}</p>
    </div>
  );
}
