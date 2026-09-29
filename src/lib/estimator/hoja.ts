import {
  cajasDeLinea, dinero, fechaLarga, numero, paraQuienSeImprime, porcentajeDeDescuento, preciosDeLinea, resumenDeTotales,
  totalRegularDeLinea, type DisplayLevel, type QuoteDraft, type QuoteLine,
} from "./modelo";

/**
 * La hoja que ve el cliente: **lo único que se imprime** (T-0408).
 *
 * Se construye aquí, en una función pura, y la pantalla de impresión (`HojaCliente.tsx`) solo recibe
 * esto — nunca el borrador. Así «¿puede salir el teléfono en la hoja?» tiene una respuesta que se
 * prueba: el teléfono, la empresa, la dirección, el código, la descripción interna y el $/SF **no
 * están en este objeto**, y lo que no está no se puede pintar.
 *
 * Los textos van en inglés y literales del documento del dueño («Estimate print outs app copy»): son
 * los descargos que él escribió, y traducirlos sería redactar por él un texto de cara al cliente.
 */

/** El encabezado tecleado: la hoja NO debe parecer un documento oficial de venta. */
export const ENCABEZADO = "RODRIGUEZ TILE GROUP";
export const SUBTITULO = "Project Price Summary — Customer Reference";

export const NOTA_DE_CANTIDAD =
  "Quantity Note: Certain products are sold by full box only. Quantities may therefore be rounded up from the requested square footage to the nearest full box.";
export const NOTA_DE_ENTREGA_EXCLUIDA =
  "Delivery charges are not included and will be confirmed based on the delivery schedule.";
export const DESCARGO_FINAL =
  "Pricing, quantities and product availability are subject to verification at time of purchase. Certain products may be clearance, promotional or Final Sale. This summary is provided for customer reference and is not an invoice, sales order, inventory reservation, or guarantee of availability.";
export const AVISO_JUNTO_AL_TOTAL =
  "Pricing and availability are subject to verification at time of purchase. Certain quoted products may be clearance, promotional, or otherwise designated Final Sale. Applicable Final Sale conditions will be confirmed before purchase.";
export const TEXTO_DE_ENTREGA =
  "Delivery: Available upon request. Delivery charges will be confirmed based on the delivery schedule.";

export interface FilaDelCliente {
  descripcion: string;
  /** Una o dos líneas: «Requested Area: 1,250 SF» y, desde Standard, «Quantity: 53 Boxes». */
  cantidad: string[];
  /** El total de la línea **a precio regular** (D-NEXT). Nunca el importe con el precio más bajo. */
  importe: number;
  /** «−20%» si hay un precio más bajo válido; null si no. Es un **porcentaje, no un importe** (lo dijo el dueño). */
  descuento: string | null;
}

export interface HojaDelCliente {
  encabezado: string;
  subtitulo: string;
  preparadoPara: string;
  referencia: string;
  validaHasta: string;
  representante: string;
  resumen: string | null;
  filas: FilaDelCliente[];
  /** «Subtotal: $X», la suma a precio regular (D-NEXT). */
  textoSubtotal: string;
  /** «Savings: −$Y», o null si no hay ahorro. */
  textoAhorro: string | null;
  /** «Tax 8.25%: $Z», con la tasa escrita. */
  textoImpuesto: string;
  total: number;
  textoTotal: string;
  validezConspicua: string;
  avisoJuntoAlTotal: string;
  entrega: string | null;
  notas: string[];
}

/** «24x48 Tile — Main Floor», y en Detailed «· 23.80 SF/Box». Nunca el código ni la descripción interna. */
export function descripcionParaElCliente(l: QuoteLine, nivel: DisplayLevel): string {
  const base = [l.customer_category.trim(), l.customer_note.trim()].filter(Boolean).join(" — ");
  if (l.kind === "sf" && nivel === "detailed" && l.sf_per_box !== null && l.sf_per_box > 0) {
    return `${base} · ${numero(l.sf_per_box, 2)} SF/Box`;
  }
  return base;
}

/**
 * La columna de cantidad. **Siempre «Requested Area», nunca «Square Feet»**: en Basic, «1,250 SF» a
 * secas haría creer que se entregan exactamente 1,250 SF, y con cajas completas se entregan más.
 */
export function cantidadParaElCliente(l: QuoteLine, nivel: DisplayLevel): string[] {
  if (l.kind === "unit") {
    return l.quantity !== null ? [`${numero(l.quantity)} ${l.unit.trim() || "Lot"}`] : [];
  }
  const out: string[] = [];
  if (l.requested_sf !== null) out.push(`Requested Area: ${numero(l.requested_sf)} SF`);
  if (nivel !== "basic") {
    const cajas = cajasDeLinea(l);
    if (cajas !== null) out.push(`Quantity: ${numero(cajas)} ${cajas === 1 ? "Box" : "Boxes"}`);
  }
  return out;
}

/** «−20%», «−12.5%»: el descuento de la línea como lo lee el cliente (D-NEXT). Null si no hay. */
export function descuentoParaElCliente(l: QuoteLine): string | null {
  const { regular, bajo } = preciosDeLinea(l);
  const p = porcentajeDeDescuento(regular, bajo);
  return p === null ? null : `−${numero(p)}%`;
}

export function hojaDelCliente(q: QuoteDraft): HojaDelCliente {
  const filas: FilaDelCliente[] = q.lines.map((l) => ({
    descripcion: descripcionParaElCliente(l, q.display_level),
    cantidad: cantidadParaElCliente(l, q.display_level),
    importe: totalRegularDeLinea(l) ?? 0,
    descuento: descuentoParaElCliente(l),
  }));
  // Subtotal regular → ahorro → impuesto → total (D-NEXT). Solo con las líneas: la entrega no entra (D-413).
  const r = resumenDeTotales(q.lines);
  const total = r.total;
  const hayCajas = q.lines.some((l) => l.kind === "sf");
  const fecha = fechaLarga(q.valid_through);
  return {
    encabezado: ENCABEZADO,
    subtitulo: SUBTITULO,
    preparadoPara: paraQuienSeImprime(q.customer),
    referencia: q.estimate_num.trim(),
    validaHasta: fecha,
    representante: q.sales_ext.trim() ? `Ext. ${q.sales_ext.trim()}` : "",
    resumen: q.project_summary.trim() || null,
    filas,
    textoSubtotal: `Subtotal: ${dinero(r.subtotal)}`,
    textoAhorro: r.ahorro > 0 ? `Savings: −${dinero(r.ahorro)}` : null,
    textoImpuesto: `Tax ${numero(r.tasa)}%: ${dinero(r.impuesto)}`,
    total,
    textoTotal: `Estimated Material Total: ${dinero(total)}`,
    validezConspicua: `QUOTE VALID THROUGH ${fecha.toUpperCase()}`,
    avisoJuntoAlTotal: AVISO_JUNTO_AL_TOTAL,
    entrega: q.delivery.mode === "delivery" ? TEXTO_DE_ENTREGA : null,
    notas: [...(hayCajas ? [NOTA_DE_CANTIDAD] : []), NOTA_DE_ENTREGA_EXCLUIDA, DESCARGO_FINAL],
  };
}
