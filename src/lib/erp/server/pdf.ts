// Server-side PDF → text adapter for PO/proforma ingestion. Pure JS (unpdf, a serverless build of
// pdf.js — no native deps), so it runs on Vercel serverless. Imported only by the upload server
// action; kept free of "server-only" so the extraction is unit-testable.
//
// Reconstructs spatial LAYOUT (like `pdftotext -layout`): text items are grouped into lines by
// y-coordinate and placed into a fixed-pitch grid by x, so label:value pairs and table columns land
// on the same line in reading order — which is exactly what lib/domain/po-parse expects.
import { getDocumentProxy } from "unpdf";

type TextItem = { str: string; transform: number[]; width: number };

export async function pdfToLayoutText(data: ArrayBuffer | Uint8Array): Promise<string> {
  // unpdf requires a plain Uint8Array (it rejects a Node Buffer, which subclasses Uint8Array), so
  // copy into a fresh one — handles ArrayBuffer (File.arrayBuffer()), Uint8Array, and Buffer alike.
  const src = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const bytes = new Uint8Array(src.byteLength);
  bytes.set(src);
  const pdf = await getDocumentProxy(bytes);
  const pages: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter((it) => it.str && it.str.trim() !== "");
    if (items.length === 0) continue;

    // fixed-pitch grid: estimate a global character width (median of per-item width/length)
    const widths = items
      .map((it) => it.width / Math.max(it.str.length, 1))
      .filter((w) => w > 0)
      .sort((a, b) => a - b);
    const charW = widths[Math.floor(widths.length / 2)] || 5;

    // group items into lines by y (baseline), tolerant of small sub/superscript jitter
    const lines: { y: number; items: TextItem[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) <= 3);
      if (!line) { line = { y, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    lines.sort((a, b) => b.y - a.y); // top of page (higher y) first

    const minX = Math.min(...items.map((it) => it.transform[4]));
    const text = lines
      .map((l) => {
        l.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let s = "";
        for (const it of l.items) {
          const col = Math.max(0, Math.round((it.transform[4] - minX) / charW));
          if (col > s.length) s += " ".repeat(col - s.length);
          s += it.str;
        }
        return s.replace(/\s+$/, "");
      })
      .join("\n");
    pages.push(text);
  }

  return pages.join("\n\n");
}
