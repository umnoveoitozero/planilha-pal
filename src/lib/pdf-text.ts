/** Extrai as linhas de texto de um PDF no navegador, agrupando itens pela posição vertical. */
export async function pdfToLines(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows: { y: number; items: { x: number; s: string }[] }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [a, b, , , e, f] = item.transform as number[];
      // Páginas giradas (ex.: Prudential) trazem a linha no eixo X e a posição no eixo Y.
      const rotated = Math.abs(a ?? 0) < Math.abs(b ?? 0);
      const y = rotated ? -(e ?? 0) : (f ?? 0);
      const x = rotated ? (b! > 0 ? f! : -f!) : (e ?? 0);
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, s: item.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  return lines;
}
