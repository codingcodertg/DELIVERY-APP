import type { Delivery, Profile, Settings } from "@/lib/types";
import type { Lang } from "@/lib/prefs";
import { stageLabel } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMilitary, fmtMoney, fmtWindows, orderLabel } from "@/lib/utils";
import { rutaPorChofer, SIN_CHOFER } from "@/lib/ruta-del-dia";

// ============================================================
// Documentos imprimibles: el comprobante de una orden (#20) y las hojas de carga del día.
// HTML propio, sin dependencias, bilingüe. El HTML se construye aparte del acto de imprimir, así
// que se puede probar sin navegador.
// ============================================================

/** El iframe de imprimir se reutiliza: uno por página, escondido y sin borde. */
const ID_MARCO = "rtg-marco-de-imprimir";

/**
 * Imprime un documento propio SIN abrir una ventana nueva (D-287).
 *
 * Antes esto era `window.open("", "_blank")` + `document.write`. En el navegador funciona; en la
 * app de escritorio, no: `desktop/main.js` tiene un `setWindowOpenHandler` que solo permite los
 * orígenes propios, y `window.open("")` le llega como `about:blank`, que no lo es. Medido con su
 * propio módulo: `esNuestro("about:blank")` es false. Se denegaba, `window.open` devolvía null, y
 * el código hacía `if (!w) return`: el botón no hacía nada y no lo decía.
 *
 * Un iframe oculto del mismo documento no abre ventana, así que no pasa por ese filtro, e imprime
 * igual en las dos plataformas. El HTML que se le mete llama a `window.print()` en su `onload`,
 * que dentro de un iframe imprime el iframe.
 *
 * No se retira al acabar, y es a propósito: quitarlo mientras el diálogo de impresión está abierto
 * se lleva el documento por delante. Se reutiliza el mismo marco en la siguiente impresión.
 */
export function imprimeDocumento(html: string, alFallar?: (motivo: string) => void): boolean {
  if (typeof document === "undefined") { alFallar?.("no-document"); return false; }
  const previo = document.getElementById(ID_MARCO);
  const marco = (previo instanceof HTMLIFrameElement ? previo : null) ?? document.createElement("iframe");
  marco.id = ID_MARCO;
  marco.setAttribute("aria-hidden", "true");
  marco.setAttribute("title", "");
  marco.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  if (!marco.isConnected) document.body.appendChild(marco);
  const doc = marco.contentWindow?.document;
  if (!doc) { alFallar?.("no-iframe"); return false; }
  doc.open();
  doc.write(html);
  doc.close();
  return true;
}

/** Imprime el comprobante de una orden. Devuelve false si el navegador no dejó preparar el marco. */
export function printDeliverySlip(d: Delivery, settings: Settings, users: Profile[], lang: Lang): boolean {
  return imprimeDocumento(htmlDelComprobante(d, settings, users, lang));
}

export function htmlDelComprobante(d: Delivery, settings: Settings, users: Profile[], lang: Lang): string {
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? "—";
  const storeAddr = settings.stores.find((s) => s.name === d.store)?.address || d.pickup_address || "";

  const row = (label: string, value: string) =>
    `<tr><th>${esc(label)}</th><td>${esc(value || "—")}</td></tr>`;

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <title>${esc(settings.app_name)} — ${T("Slip", "Comprobante")} #${esc(orderLabel(d))}</title>
    <style>
      *{box-sizing:border-box;} body{font-family:Inter,Arial,sans-serif;color:#152238;margin:0;padding:28px;}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #152238;padding-bottom:14px;margin-bottom:18px;}
      .brand{font-size:22px;font-weight:800;} .brand span{color:#e9a13b;}
      .ono{font-size:30px;font-weight:800;font-family:Archivo,Arial,sans-serif;text-align:right;}
      .stage{display:inline-block;background:#152238;color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700;margin-top:4px;}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7686;margin:18px 0 6px;}
      table{width:100%;border-collapse:collapse;margin-bottom:6px;}
      th{width:210px;text-align:left;vertical-align:top;color:#6b7686;font-weight:600;font-size:13px;padding:5px 10px 5px 0;}
      td{font-size:13px;font-weight:600;padding:5px 0;border-bottom:1px solid #eef1f6;}
      .cols{display:flex;gap:30px;} .cols>div{flex:1;}
      .notes{border:1px solid #dfe5ee;border-radius:8px;padding:10px 12px;min-height:52px;font-size:13px;}
      .sign{display:flex;gap:30px;margin-top:36px;}
      .sign>div{flex:1;border-top:1px solid #152238;padding-top:6px;font-size:12px;color:#6b7686;}
      .pod{display:flex;gap:24px;align-items:flex-end;margin-top:4px;}
      .pod-info{flex:1;} .pod-info th{width:120px;}
      .pod-sig{flex:1;} .pod-sig-label{font-size:12px;color:#6b7686;margin-bottom:4px;}
      .pod-sig img{max-height:110px;max-width:100%;border:1px solid #dfe5ee;border-radius:8px;background:#fff;}
      .pod-sig-empty{border:1px dashed #dfe5ee;border-radius:8px;padding:20px;text-align:center;color:#9aa3b0;font-size:12px;}
      .foot{margin-top:26px;font-size:11px;color:#9aa3b0;text-align:center;}
      @media print{body{padding:12px;}}
    </style></head><body>
    <div class="head">
      <div>
        <div class="brand">${esc(settings.app_name)}</div>
        <div style="font-size:12px;color:#6b7686;margin-top:4px;">${T("Delivery slip", "Comprobante de entrega")}</div>
      </div>
      <div>
        <div class="ono">#${esc(orderLabel(d))}</div>
        <div class="stage">${esc(stageLabel(d.stage, lang))}</div>
      </div>
    </div>

    <div class="cols">
      <div>
        <h2>${T("Pickup", "Recolección")}</h2>
        <table>
          ${row(T("Store", "Tienda"), d.store || "")}
          ${row(T("Pickup warehouse", "Almacén"), d.pickup_name || "")}
          ${row(T("Pickup address", "Dirección"), d.pickup_address || storeAddr)}
        </table>
      </div>
      <div>
        <h2>${T("Delivery", "Entrega")}</h2>
        <table>
          ${row(T("Account", "Cuenta"), d.account || "")}
          ${row(T("Contact", "Contacto"), d.contact || "")}
          ${row(T("Phone", "Teléfono"), d.delivery_phone || "")}
          ${row(T("Address", "Dirección"), d.delivery_address || "")}
        </table>
      </div>
    </div>

    <h2>${T("Order", "Orden")}</h2>
    <div class="cols"><div><table>
      ${row(T("Type", "Tipo"), d.order_type || "")}
      ${row(T("SO #", "SO #"), d.so_num || "")}
      ${row(T("PO #", "PO #"), d.po2 || "")}
      ${row(T("Invoice #", "Factura #"), d.invoice_num || "")}
    </table></div><div><table>
      ${row(T("Delivery date", "Fecha entrega"), d.delivery_date ? fmtDate(d.delivery_date) : "")}
      ${row(T("Windows", "Ventanas"), fmtWindows(d.delivery_windows))}
      ${row(T("Pallets", "Pallets"), String(d.actual_pallets ?? d.est_pallets ?? ""))}
      ${row(T("Delivery fee", "Costo de entrega"), d.delivery_fee == null ? "" : fmtMoney(d.delivery_fee))}
      ${row(T("Driver", "Chofer"), d.assigned_driver || "")}
    </table></div></div>

    <h2>${T("Delivery notes", "Notas de entrega")}</h2>
    <div class="notes">${esc(d.delivery_notes || "")}</div>

    ${d.pod_received_by ? `
    <h2>${T("Proof of delivery", "Comprobante de entrega")}</h2>
    <div class="pod">
      <div class="pod-info">
        <table>
          ${row(T("Received by", "Recibido por"), d.pod_received_by || "")}
          ${row(T("Delivered", "Entregado"), d.pod_delivered_at ? fmtDateTime(d.pod_delivered_at) : "")}
          ${d.pod_lat != null && d.pod_lng != null
            ? row(T("GPS location", "Ubicación GPS"), `${d.pod_lat}, ${d.pod_lng}${d.pod_accuracy != null ? ` (±${d.pod_accuracy} m)` : ""}`)
            : ""}
        </table>
      </div>
      <div class="pod-sig">
        <div class="pod-sig-label">${T("Signature", "Firma")}</div>
        ${d.pod_signature
          ? `<img src="${d.pod_signature}" alt="signature" />`
          : `<div class="pod-sig-empty">${T("(no signature captured)", "(sin firma capturada)")}</div>`}
      </div>
    </div>` : `
    <div class="sign">
      <div>${T("Received by (print name)", "Recibido por (nombre)")}</div>
      <div>${T("Signature", "Firma")}</div>
      <div>${T("Date / time", "Fecha / hora")}</div>
    </div>`}

    <div class="foot">
      ${T("Created by", "Creado por")} ${esc(nameOf(d.created_by))} ·
      ${T("Input", "Ingreso")} ${esc(d.input_date || "")} ${esc(fmtMilitary(d.input_time))} ·
      ${T("Printed", "Impreso")} ${new Date().toLocaleString(lang === "es" ? "es" : "en-US")}
    </div>
    <script>
      // Wait for the signature image (a data: URL) to finish decoding before
      // printing, otherwise it can be omitted from the generated PDF.
      window.onload=function(){
        var imgs=[].slice.call(document.images);
        var pending=imgs.filter(function(i){return !i.complete;});
        var done=function(){setTimeout(function(){window.print();},200);};
        if(!pending.length){done();return;}
        var left=pending.length;
        pending.forEach(function(i){
          var fin=function(){if(--left<=0)done();};
          i.addEventListener('load',fin);i.addEventListener('error',fin);
        });
        setTimeout(done,1500); // safety net
      };
    </script>
    </body></html>`;

  return html;
}

// ============================================================
// Printable DAILY LOAD SHEETS — one page per driver, listing that driver's
// stops for the day (in route order) so the warehouse can stage and load each
// truck. Opens a print window like the slip above.
// ============================================================

/** Imprime las hojas de carga del día, una por chofer. */
export function printLoadSheets(orders: Delivery[], settings: Settings, lang: Lang, dateISO: string): boolean {
  return imprimeDocumento(htmlDeLasHojasDeCarga(orders, settings, lang, dateISO));
}

export function htmlDeLasHojasDeCarga(orders: Delivery[], settings: Settings, lang: Lang, dateISO: string): string {
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

  // Una hoja por chofer, con «Sin asignar» al final y las paradas en orden de ruta. El agrupado
  // y el orden los decide `rutaPorChofer`, que es el MISMO que usa la vista de ruta del almacén:
  // dos copias del mismo orden acaban ordenando distinto.
  const pages = rutaPorChofer(orders).map(({ chofer, paradas: list, pallets }) => {
    const driver = chofer === SIN_CHOFER ? T("Unassigned", "Sin asignar") : chofer;
    const rows = list.map((o, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td><b>#${esc(orderLabel(o))}</b></td>
        <td>${esc(o.account || o.delivery_name || "—")}</td>
        <td>${esc(o.delivery_address || "—")}</td>
        <td>${esc(fmtWindows(o.delivery_windows))}</td>
        <td class="num">${esc(o.actual_pallets ?? o.est_pallets ?? "—")}</td>
        <td>${esc(o.invoice_num || o.po2 || o.so_num || o.estimate_num || "—")}</td>
        <td>${esc(o.delivery_notes || "")}</td>
      </tr>`).join("");
    return `
      <section class="sheet">
        <div class="head">
          <div>
            <div class="brand">${esc(settings.app_name)}</div>
            <div class="sub">${T("Load sheet", "Hoja de carga")} · ${esc(fmtDate(dateISO))}</div>
          </div>
          <div class="drv">
            <div class="drv-name">🚚 ${esc(driver)}</div>
            <div class="drv-tot">${list.length} ${T("stops", "paradas")} · ${pallets} ${T("pallets", "pallets")}</div>
          </div>
        </div>
        <table class="loads">
          <thead><tr>
            <th class="num">#</th><th>${T("Order", "Orden")}</th><th>${T("Account", "Cuenta")}</th>
            <th>${T("Address", "Dirección")}</th><th>${T("Window", "Ventana")}</th>
            <th class="num">${T("Pallets", "Pallets")}</th><th>${T("Ref", "Ref")}</th><th>${T("Notes", "Notas")}</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="8" class="empty">${T("No stops.", "Sin paradas.")}</td></tr>`}</tbody>
        </table>
        <div class="sign"><div>${T("Loaded by", "Cargado por")}</div><div>${T("Checked by", "Verificado por")}</div></div>
      </section>`;
  }).join("");

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <title>${esc(settings.app_name)} — ${T("Load sheets", "Hojas de carga")} ${esc(dateISO)}</title>
    <style>
      *{box-sizing:border-box;} body{font-family:Inter,Arial,sans-serif;color:#152238;margin:0;padding:0;}
      .sheet{padding:26px 28px;page-break-after:always;}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #152238;padding-bottom:12px;margin-bottom:14px;}
      .brand{font-size:20px;font-weight:800;} .sub{font-size:12px;color:#6b7686;margin-top:3px;}
      .drv{text-align:right;} .drv-name{font-size:22px;font-weight:800;font-family:Archivo,Arial,sans-serif;}
      .drv-tot{font-size:12px;color:#6b7686;margin-top:3px;}
      table.loads{width:100%;border-collapse:collapse;}
      table.loads th{background:#f4f6fa;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7686;padding:6px 8px;border-bottom:2px solid #dfe5ee;}
      table.loads td{font-size:12.5px;padding:7px 8px;border-bottom:1px solid #eef1f6;vertical-align:top;}
      td.num,th.num{text-align:center;width:34px;}
      .empty{text-align:center;color:#9aa3b0;padding:16px;}
      .sign{display:flex;gap:30px;margin-top:34px;}
      .sign>div{flex:1;border-top:1px solid #152238;padding-top:6px;font-size:12px;color:#6b7686;}
      @media print{.sheet{padding:12px;}}
    </style></head><body>
    ${pages || `<section class="sheet"><div class="empty">${T("No orders for this day.", "No hay órdenes para este día.")}</div></section>`}
    <script>window.onload=function(){setTimeout(function(){window.print();},200);};</script>
    </body></html>`;

  return html;
}
