import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { FileDropzone } from "@/components/FileDropzone";
import { ResultsPanel } from "@/components/ResultsPanel";
import {
  parseCodigosFile,
  convertMainFile,
  type ConversionResult,
} from "@/lib/spreadsheet-converter";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Conversor de Planilhas Seguradora · Por Filial" },
      {
        name: "description",
        content:
          "Converta planilhas de coparticipação automaticamente: aplica regras de colunas, mapeia o código da empresa para filial e separa os dados em planilhas individuais.",
      },
    ],
  }),
});

function Index() {
  const [mainFile, setMainFile] = useState<File | null>(null);
  const [codigosFile, setCodigosFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canProcess = !!mainFile && !!codigosFile && !processing;

  const handleProcess = async () => {
    if (!mainFile || !codigosFile) return;
    setProcessing(true);
    setError(null);
    try {
      const map = await parseCodigosFile(codigosFile);
      const res = await convertMainFile(mainFile, map);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado ao processar arquivos.");
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setMainFile(null);
    setCodigosFile(null);
    setError(null);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* mesh background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: "var(--gradient-mesh)" }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-3xl px-4 py-12 sm:py-20">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Processamento local · seus dados não saem do navegador
          </div>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Conversor de Planilhas <span className="bg-[var(--gradient-primary)] bg-clip-text text-transparent">por Filial</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted-foreground">
            Envie a planilha principal de coparticipação e a planilha de códigos. O sistema aplica as
            regras e gera uma planilha separada para cada filial.
          </p>
        </motion.header>

        <AnimatePresence mode="wait">
          {!result ? (
            <motion.section
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-5 rounded-3xl border border-border bg-card/80 p-6 shadow-[var(--shadow-soft)] backdrop-blur sm:p-8"
            >
              <FileDropzone
                label="1. Planilha principal (Coparticipação)"
                description="Aceita .xlsx ou .xls"
                file={mainFile}
                onFile={setMainFile}
                accent="primary"
              />
              <FileDropzone
                label="2. Planilha de códigos (Empresa → Filial)"
                description="Deve conter as colunas COD_EMPRESA e FILIAL"
                file={codigosFile}
                onFile={setCodigosFile}
                accent="accent"
              />

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                >
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{error}</p>
                </motion.div>
              )}

              <button
                onClick={handleProcess}
                disabled={!canProcess}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--gradient-primary)] px-6 py-3.5 text-base font-semibold text-primary-foreground shadow-[var(--shadow-elegant)] transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {processing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    Converter planilha
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              <RulesList />
            </motion.section>
          ) : (
            <motion.section
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ResultsPanel result={result} onReset={handleReset} />
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RulesList() {
  const rules = [
    "Apaga as colunas da Z em diante (mantém Valor Fat. Coparticipação)",
    "Adiciona a coluna FILIAL como primeira coluna",
    "Mapeia o Código Empresa para o número da filial",
    "Gera uma planilha separada por filial",
  ];
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Regras aplicadas
      </p>
      <ul className="space-y-1.5">
        {rules.map((r) => (
          <li key={r} className="flex items-start gap-2 text-sm text-foreground">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
