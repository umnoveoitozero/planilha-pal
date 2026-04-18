import { useRef, useState, type DragEvent } from "react";
import { Upload, FileSpreadsheet, X, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface FileDropzoneProps {
  label: string;
  description: string;
  file: File | null;
  onFile: (file: File | null) => void;
  accent?: "primary" | "accent";
}

export function FileDropzone({ label, description, file, onFile, accent = "primary" }: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const ringClass = accent === "primary" ? "ring-primary/40 bg-primary/5" : "ring-accent/40 bg-accent/5";
  const iconBg = accent === "primary" ? "bg-primary/10 text-primary" : "bg-accent/15 text-accent-foreground";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-semibold text-foreground">{label}</label>
        {file && (
          <button
            onClick={() => onFile(null)}
            className="text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            Remover
          </button>
        )}
      </div>

      <motion.div
        whileHover={{ y: -2 }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "group relative cursor-pointer rounded-2xl border-2 border-dashed border-border bg-card p-6 transition-all",
          "hover:border-primary/50 hover:shadow-[var(--shadow-soft)]",
          isDragging && `border-primary ring-4 ${ringClass}`,
          file && "border-solid border-success/40 bg-success/5"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors",
              file ? "bg-success/15 text-success" : iconBg
            )}
          >
            {file ? <CheckCircle2 className="h-6 w-6" /> : <FileSpreadsheet className="h-6 w-6" />}
          </div>

          <div className="min-w-0 flex-1">
            {file ? (
              <>
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · pronto</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">
                  <span className="text-primary">Clique para enviar</span> ou arraste o arquivo
                </p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </>
            )}
          </div>

          {!file && <Upload className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />}
          {file && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFile(null);
              }}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
