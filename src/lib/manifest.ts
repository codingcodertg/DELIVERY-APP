import type { Delivery, Settings } from "@/lib/types";
import type { Lang } from "@/lib/prefs";
import { orderLabel } from "@/lib/utils";
import { recogidaAparte } from "@/lib/order-endpoints";
import { facturasDeLaOrden } from "@/lib/agregar-material";
import { sumaPallets } from "./pallets";

// ============================================================
// Printable route manifest / driver day-sheet. Takes a driver's ordered stops
// and opens a clean print window (browser "Save as PDF" or a physical printer).
// Self-contained HTML, no dependencies, bilingual. Each stop has a ✓/received
// blank so the driver can mark the sheet off in the field.
// ============================================================

export function printRouteManifest(
  driverName: string,
  stops: Delivery[],
  settings: Settings,
  lang: Lang,
  dateLabel: string,
) {
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

  const totalPallets = sumaPallets(stops);
  const totalMiles = Math.round(stops.reduce((s, d) => s + Number(d.route_miles ?? 0), 0) * 10) / 10;

  const rows = stops.map((d, i) => {
    const addr = d.delivery_address || "";
    const contact = [d.account, d.contact].filter(Boolean).join(" · ");
    const meta = [
      // Todas las facturas (D-339): el manifiesto es papel para entregar, y el chofer tiene que
      // poder casar lo que lleva con lo que le firman.
      facturasDeLaOrden(d).length ? `${T("Inv", "Fact")} #${esc(facturasDeLaOrden(d).join(", "))}` : "",
      d.order_type ? esc(d.order_type) : "",
      d.store ? `${T("from", "de")} ${esc(d.store)}` : "",
      // La recogida, cuando no es la tienda que vende (D-343): es adonde tiene que ir el chofer.
      recogidaAparte(d, settings.stores) ? `${T("pick up at", "recoger en")} ${esc(recogidaAparte(d, settings.stores))}` : "",
    ].filter(Boolean).join(" · ");
    const notes = d.delivery_notes ? `<div class="notes">${esc(d.delivery_notes)}</div>` : "";
    return `<tr>
      <td class="seq">${i + 1}</td>
      <td>
        <div class="ono">#${esc(orderLabel(d))}</div>
        <div class="acct">${esc(contact || "—")}</div>
        <div class="addr">${esc(addr || "—")}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ""}
        ${notes}
      </td>
      <td class="win">${esc(d.delivery_windows || "—")}</td>
      <td class="pal">${esc(String(d.actual_pallets ?? d.est_pallets ?? "—"))}</td>
      <td class="phone">${esc(d.delivery_phone || "—")}</td>
      <td class="rcv"><div class="rcv-line"></div><span>${T("Received / time", "Recibido / hora")}</span></td>
    </tr>`;
  }).join("");

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <title>${esc(settings.app_name)} — ${T("Route", "Ruta")} ${esc(driverName)}</title>
    <style>
      *{box-sizing:border-box;} body{font-family:Inter,Arial,sans-serif;color:#152238;margin:0;padding:24px;}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #152238;padding-bottom:12px;margin-bottom:14px;}
      .brand{font-size:20px;font-weight:800;} .brand span{color:#e9a13b;}
      .sub{font-size:12px;color:#6b7686;margin-top:3px;}
      .driver{font-size:24px;font-weight:800;font-family:Archivo,Arial,sans-serif;text-align:right;}
      .totals{font-size:12px;color:#6b7686;text-align:right;margin-top:4px;}
      .totals b{color:#152238;}
      table{width:100%;border-collapse:collapse;}
      thead th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7686;text-align:left;border-bottom:2px solid #152238;padding:6px 8px;}
      tbody td{font-size:12px;padding:9px 8px;border-bottom:1px solid #dfe5ee;vertical-align:top;}
      .seq{font-weight:800;font-size:16px;width:26px;color:#2456c9;}
      .ono{font-weight:800;font-size:13px;}
      .acct{font-weight:600;} .addr{color:#3a4658;} .meta{color:#9aa3b0;font-size:11px;margin-top:2px;}
      .notes{margin-top:4px;padding:4px 7px;background:#fbf7ee;border-left:2px solid #e9a13b;font-size:11px;}
      .win{width:96px;font-weight:700;} .pal{width:52px;font-weight:700;text-align:center;} .phone{width:120px;}
      .rcv{width:150px;} .rcv-line{border-bottom:1px solid #9aa3b0;height:26px;margin-bottom:3px;} .rcv span{font-size:10px;color:#9aa3b0;}
      .foot{margin-top:18px;font-size:11px;color:#9aa3b0;text-align:center;}
      @media print{body{padding:10px;} @page{size:portrait;margin:12mm;}}
    </style></head><body>
    <div class="head">
      <div>
        <div class="brand">${esc(settings.app_name)}</div>
        <div class="sub">${T("Route manifest", "Hoja de ruta")}</div>
      </div>
      <div>
        <div class="driver">${esc(driverName || T("Unassigned", "Sin asignar"))}</div>
        <div class="sub" style="text-align:right;">${esc(dateLabel)}</div>
        <div class="totals"><b>${stops.length}</b> ${T("stops", "paradas")} · <b>${totalPallets}</b> ${T("pallets", "pallets")}${totalMiles > 0 ? ` · <b>${totalMiles}</b> ${T("mi", "mi")}` : ""}</div>
      </div>
    </div>

    ${stops.length === 0 ? `<div style="padding:40px;text-align:center;color:#9aa3b0;">${T("No stops on this route.", "Sin paradas en esta ruta.")}</div>` : `
    <table>
      <thead><tr>
        <th>#</th>
        <th>${T("Stop", "Parada")}</th>
        <th>${T("Window", "Ventana")}</th>
        <th>${T("Pal.", "Tar.")}</th>
        <th>${T("Phone", "Teléfono")}</th>
        <th>${T("Received", "Recibido")}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`}

    <div class="foot">
      ${T("Printed", "Impreso")} ${new Date().toLocaleString(lang === "es" ? "es" : "en-US")}
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
    </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
