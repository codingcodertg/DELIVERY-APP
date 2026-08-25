// Client-side export helpers. Exports whatever rows the caller passes — which for staff are
// already cost/margin-masked (the view returned null), so #29 holds automatically.

export function download(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
  download(filename, "﻿" + csv, "text/csv;charset=utf-8");
}

export async function exportXlsx(filename: string, sheet: string, headers: string[], rows: unknown[][]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  download(filename, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
