// exceljs se carga al pulsar "Excel", no con el tablero (G-20, D-NEXT): estático entraba entero
// en el chunk inicial de `/` (265 kB de ruta) para un botón que casi nadie pulsa. Mismo patrón que
// lib/erp/export.ts. El tipo se importa aparte porque `import type` no pesa nada.
import type { WorksheetProperties } from "exceljs";
import type { Delivery, Profile } from "@/lib/types";
import { stageLabel } from "@/lib/constants";
import { fmtDate, orderOwner } from "@/lib/utils";
import type { Lang } from "@/lib/prefs";

// ============================================================
// Rich exports of the orders list, grouped by the employee who logged each
// order (sales rep / driver). Excel uses collapsible row outlines so a
// reviewer can fold each person's orders; a print-to-PDF mirror is provided.
// ============================================================

// Curated, review-friendly column set (narrower than the full CSV).
interface Col { header: string; header_es: string; width: number; get: (d: Delivery) => string | number; }

function columns(lang: Lang): Col[] {
  return [
    { header: "#", header_es: "#", width: 8, get: (d) => d.order_no },
    { header: "Stage", header_es: "Etapa", width: 14, get: (d) => stageLabel(d.stage, lang) },
    { header: "Type", header_es: "Tipo", width: 12, get: (d) => d.order_type ?? "" },
    { header: "Store", header_es: "Tienda", width: 13, get: (d) => d.store ?? "" },
    { header: "Account", header_es: "Cuenta", width: 20, get: (d) => d.account ?? "" },
    { header: "SO #", header_es: "SO #", width: 12, get: (d) => d.so_num ?? "" },
    { header: "Delivery date", header_es: "Fecha entrega", width: 14, get: (d) => (d.delivery_date ? fmtDate(d.delivery_date) : "") },
    { header: "Windows", header_es: "Ventanas", width: 12, get: (d) => d.delivery_windows ?? "" },
    { header: "Est. plt", header_es: "Pallets est.", width: 9, get: (d) => (d.est_pallets ?? "") },
    { header: "Act. plt", header_es: "Pallets reales", width: 9, get: (d) => (d.actual_pallets ?? "") },
    { header: "Fee", header_es: "Costo", width: 10, get: (d) => (d.delivery_fee ?? "") },
    { header: "Driver", header_es: "Chofer", width: 16, get: (d) => d.assigned_driver ?? "" },
    { header: "Miles", header_es: "Millas", width: 8, get: (d) => (d.route_miles ?? "") },
    { header: "Re-delivery", header_es: "Reentrega", width: 24, get: (d) => d.redelivery_reason ?? "" },
  ];
}

// Group orders by the sales rep they belong to (assigned_sales_rep, falling
// back to created_by for orders a rep logged themselves).
function groupByEmployee(deliveries: Delivery[], users: Profile[], lang: Lang) {
  const nameOf = (id: string | null) =>
    users.find((u) => u.id === id)?.full_name ?? (lang === "es" ? "(sin asignar)" : "(unassigned)");
  const map = new Map<string, Delivery[]>();
  for (const d of deliveries) {
    const key = nameOf(orderOwner(d));
    (map.get(key) ?? map.set(key, []).get(key)!).push(d);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Excel (.xlsx) with collapsible per-employee groups ----------
export async function exportExcelByEmployee(deliveries: Delivery[], users: Profile[], lang: Lang) {
  const cols = columns(lang);
  // Si el trozo no llega (sin red, despliegue a medias), la promesa se rechaza y el botón lo
  // enseña; con el import estático este caso no existía y no puede quedarse en silencio.
  const ExcelJS = (await import("exceljs").catch(() => { throw new Error("exceljs chunk failed to load"); })).default;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(lang === "es" ? "Órdenes" : "Orders", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { outlineLevelRow: 1 } as WorksheetProperties,
  });
  // Summary rows sit ABOVE their detail group.
  (ws.properties as unknown as { outlineProperties: { summaryBelow: boolean; summaryRight: boolean } })
    .outlineProperties = { summaryBelow: false, summaryRight: false };

  ws.columns = cols.map((c) => ({ width: c.width }));

  // Header row.
  const header = ws.addRow(cols.map((c) => (lang === "es" ? c.header_es : c.header)));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152238" } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF2B3644" } } };
  });
  header.height = 20;

  for (const [employee, orders] of groupByEmployee(deliveries, users, lang)) {
    // Employee banner (level 0 = summary above the collapsible group).
    const totalMiles = orders.reduce((s, o) => s + (o.route_miles ?? 0), 0);
    const totalFees = orders.reduce((s, o) => s + (o.delivery_fee ?? 0), 0);
    const banner = ws.addRow([
      `👤 ${employee}`,
      lang === "es" ? `${orders.length} órdenes` : `${orders.length} orders`,
      `${Math.round(totalMiles * 10) / 10} mi · $${totalFees.toFixed(2)}`,
    ]);
    ws.mergeCells(banner.number, 3, banner.number, cols.length);
    banner.eachCell((cell) => {
      cell.font = { bold: true, size: 11, color: { argb: "FF152238" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEFB" } };
    });

    orders
      .sort((a, b) => b.order_no - a.order_no)
      .forEach((o) => {
        const row = ws.addRow(cols.map((c) => c.get(o)));
        row.outlineLevel = 1;
        if (o.redelivery_of) {
          row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7EC" } }; });
        }
      });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  triggerDownload(blob, `deliveries_by_employee_${stamp()}.xlsx`);
}

// ---------- PDF (via the browser's print dialog → Save as PDF) ----------
export function exportPDFByEmployee(deliveries: Delivery[], users: Profile[], lang: Lang) {
  const cols = columns(lang);
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const groups = groupByEmployee(deliveries, users, lang);

  const sections = groups.map(([employee, orders]) => {
    const rows = orders
      .sort((a, b) => b.order_no - a.order_no)
      .map((o) => `<tr class="${o.redelivery_of ? "redel" : ""}">${cols.map((c) => `<td>${esc(c.get(o))}</td>`).join("")}</tr>`)
      .join("");
    return `
      <details open>
        <summary>👤 ${esc(employee)} — ${orders.length} ${lang === "es" ? "órdenes" : "orders"}</summary>
        <table>
          <thead><tr>${cols.map((c) => `<th>${esc(lang === "es" ? c.header_es : c.header)}</th>`).join("")}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`;
  }).join("");

  const title = lang === "es" ? "Órdenes por empleado" : "Orders by employee";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} — ${stamp()}</title>
    <style>
      body{font-family:Inter,Arial,sans-serif;color:#152238;margin:24px;}
      h1{font-size:20px;margin:0 0 4px;} .sub{color:#6b7686;font-size:12px;margin-bottom:18px;}
      details{margin-bottom:16px;border:1px solid #dfe5ee;border-radius:8px;overflow:hidden;}
      summary{background:#e8eefb;font-weight:700;padding:8px 12px;cursor:pointer;}
      table{width:100%;border-collapse:collapse;font-size:11px;}
      th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #eef1f6;}
      th{background:#152238;color:#fff;}
      tr.redel td{background:#fff7ec;}
      @media print{summary{-webkit-print-color-adjust:exact;print-color-adjust:exact;} th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head>
    <body>
      <h1>RDZ · ${title}</h1>
      <div class="sub">${stamp()} · ${deliveries.length} ${lang === "es" ? "órdenes en total" : "orders total"}</div>
      ${sections}
      <script>window.onload=()=>{setTimeout(()=>window.print(),300)}</script>
    </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
