// D-706: Excel de una tabla cualquiera (cabeceras + filas ya calculadas), para las tablas que no son Órdenes.
// exceljs se carga al pulsar, como en lib/export.ts (G-20, D-209): no entra en el trozo inicial de la página.
import type { ValorDeCelda } from "@/lib/orden-y-filtro";

export async function exportaTablaExcel(archivo: string, hoja: string, cabeceras: string[], filas: ValorDeCelda[][]): Promise<void> {
  const ExcelJS = (await import("exceljs").catch(() => { throw new Error("exceljs chunk failed to load"); })).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(hoja.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(cabeceras).font = { bold: true };
  for (const f of filas) ws.addRow(f.map((v) => v ?? ""));
  ws.columns.forEach((c, i) => { c.width = Math.min(40, Math.max(10, cabeceras[i]?.length ?? 10, ...filas.map((f) => String(f[i] ?? "").length))); });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabeceras.length } };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = archivo;
  a.click();
  URL.revokeObjectURL(a.href);
}
