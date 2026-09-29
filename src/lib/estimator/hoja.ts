import {
  cajasDeLinea, dinero, fechaLarga, numero, paraQuienSeImprime, preciosDeLinea, resumenDeTotales, estadoDelPrecioBajo,
  totalDeLinea, totalRegularDeLinea, type DisplayLevel, type QuoteDraft, type QuoteLine,
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
 *
 * D-NEXT (2026-09-29, sobre la hoja impresa): sin el «Valid through» de arriba (repetía el «QUOTE VALID THROUGH…» de
 * abajo), con la tienda donde se creó la cotización, el descuento como PRECIO y no como porcentaje, y **nada después de
 * «Delivery: Available upon request…»**: se quitaron la nota de cajas completas, «Delivery charges are not included…»
 * (repetía el cargo de entrega) y el descargo final. Ya no hay `notas`.
 */

/** El encabezado tecleado: la hoja NO debe parecer un documento oficial de venta. */
export const ENCABEZADO = "RODRIGUEZ TILE GROUP";
export const SUBTITULO = "Project Price Summary — Customer Reference";

export const AVISO_JUNTO_AL_TOTAL =
  "Pricing and availability are subject to verification at time of purchase. Certain quoted products may be clearance, promotional, or otherwise designated Final Sale. Applicable Final Sale conditions will be confirmed before purchase.";
/** Lo último de la hoja cuando es entrega (D-NEXT: «delete everything afte the Delivery: available text»). */
export const TEXTO_DE_ENTREGA =
  "Delivery: Available upon request. Delivery charges will be confirmed based on the delivery schedule.";

export interface FilaDelCliente {
  descripcion: string;
  /** Una o dos líneas: «Requested Area: 1,250 SF» y, desde Standard, «Quantity: 53 Boxes». */
  cantidad: string[];
  /** El total de la línea **a precio regular** (D-442). */
  importe: number;
  /**
   * «Discount price: $800.00» si hay un precio con descuento válido; null si no. Es un **precio** (el total de la línea
   * con el precio con descuento), no un porcentaje: D-NEXT, «descuento is a price not a percentage». Nunca el $/SF.
   */
  precioConDescuento: string | null;
}

export interface HojaDelCliente {
  encabezado: string;
  subtitulo: string;
  preparadoPara: string;
  referencia: string;
  /** La tienda donde se creó la cotización (D-NEXT), o null si no se sabe: entonces la línea no sale. */
  tienda: string | null;
  representante: string;
  resumen: string | null;
  filas: FilaDelCliente[];
  /** «Subtotal: $X», la suma a precio regular (D-442). */
  textoSubtotal: string;
  /** «Savings: −$Y», o null si no hay ahorro. */
  textoAhorro: string | null;
  /** «Tax 8.25%: $Z», con la tasa escrita. */
  textoImpuesto: string;
  total: number;
  textoTotal: string;
  /** La ÚNICA validez de la hoja: «QUOTE VALID THROUGH …», junto al total (D-NEXT quitó la de arriba). */
  validezConspicua: string;
  avisoJuntoAlTotal: string;
  /** Lo último que se imprime, si es entrega. Detrás no va nada. */
  entrega: string | null;
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

/**
 * «Discount price: $800.00»: el total de la línea con el precio con descuento, como lo lee el cliente (D-NEXT). Null si
 * la línea no tiene un precio con descuento que valga (vacío, igual o mayor que el regular, o sin regular).
 */
export function precioConDescuentoParaElCliente(l: QuoteLine): string | null {
  const { regular, bajo } = preciosDeLinea(l);
  if (estadoDelPrecioBajo(regular, bajo) !== "aplica") return null;
  const t = totalDeLinea(l);
  return t === null ? null : `Discount price: ${dinero(t)}`;
}

/**
 * La tienda que sale en la hoja: la guardada en la cotización (148, la del perfil del dueño al crearla) y, si no hay
 * (nueva, o el dueño no tenía tienda), la de quien la prepara. Null si ninguna: la línea no se imprime vacía.
 */
export function tiendaDeLaHoja(guardada: string | null | undefined, mia: string | null | undefined): string | null {
  return guardada?.trim() || mia?.trim() || null;
}

export function hojaDelCliente(q: QuoteDraft, tienda: string | null = null): HojaDelCliente {
  const filas: FilaDelCliente[] = q.lines.map((l) => ({
    descripcion: descripcionParaElCliente(l, q.display_level),
    cantidad: cantidadParaElCliente(l, q.display_level),
    importe: totalRegularDeLinea(l) ?? 0,
    precioConDescuento: precioConDescuentoParaElCliente(l),
  }));
  // Subtotal regular → ahorro → impuesto → total (D-442). Solo con las líneas: la entrega no entra (D-413).
  const r = resumenDeTotales(q.lines);
  const total = r.total;
  const fecha = fechaLarga(q.valid_through);
  return {
    encabezado: ENCABEZADO,
    subtitulo: SUBTITULO,
    preparadoPara: paraQuienSeImprime(q.customer),
    referencia: q.estimate_num.trim(),
    tienda: tienda?.trim() || null,
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
  };
}
