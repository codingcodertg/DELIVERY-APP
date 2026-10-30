import {
  cajasDeLinea, dinero, fechaLarga, numero, paraQuienSeImprime, porcentajeDeDescuento, preciosDeLinea, resumenDeTotales, estadoDelPrecioBajo, sfReal,
  totalDeLinea, totalRegularDeLinea, type DisplayLevel, type QuoteDraft, type QuoteLine,
  tasaDeImpuesto,
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
 * D-451 (2026-09-29, sobre la hoja impresa): sin el «Valid through» de arriba (repetía el «QUOTE VALID THROUGH…» de
 * abajo), con la tienda donde se creó la cotización, el descuento como PRECIO y no como porcentaje, y **nada después de
 * «Delivery: Available upon request…»**: se quitaron la nota de cajas completas, «Delivery charges are not included…»
 * (repetía el cargo de entrega) y el descargo final. Ya no hay `notas`.
 *
 * D-575 (2026-10-18): vuelve UNA nota, la de cajas completas, con el texto que describió el dueño ese día («a note saying
 * that some items are rounded to nearest box; not sold by piece or exact sqft requested»), y solo cuando hace falta:
 * alguna línea por SF cuyas cajas cubren más de lo pedido (`notaDeCajas`). Va bajo la tabla, antes de los totales, así
 * que «nada después de Delivery: Available…» (D-451) sigue en pie.
 */

/** El encabezado tecleado: la hoja NO debe parecer un documento oficial de venta. */
export const ENCABEZADO = "RODRIGUEZ TILE GROUP";
export const SUBTITULO = "Project Price Summary — Customer Reference";

export const AVISO_JUNTO_AL_TOTAL =
  "Pricing and availability are subject to verification at time of purchase. Certain quoted products may be clearance, promotional, or otherwise designated Final Sale. Applicable Final Sale conditions will be confirmed before purchase.";
/** Lo último de la hoja cuando es entrega (D-451: «delete everything afte the Delivery: available text»). */
export const TEXTO_DE_ENTREGA =
  "Delivery: Available upon request. Delivery charges will be confirmed based on the delivery schedule.";
/**
 * La nota de cajas completas (D-575, 2026-10-18): el dueño pidió «a note saying that some items are rounded to nearest
 * box; not sold by piece or exact sqft requested». En la hoja va en inglés, como todo lo que lee el cliente; la versión en
 * español es para la pantalla del vendedor (`Estimador.tsx`) cuando está en español.
 */
export const NOTA_DE_CAJAS =
  "Some items are rounded up to the nearest full box; they are not sold by the piece or by the exact square footage requested.";
export const NOTA_DE_CAJAS_ES =
  "Algunos artículos se redondean hacia arriba a la caja completa; no se venden por pieza ni por los pies cuadrados exactos pedidos.";

/**
 * Si alguna línea por SF se lleva más de lo pedido —sus cajas (las escritas o las de por defecto, `cajasDeLinea`) cubren
 * más SF que `requested_sf`— devuelve la nota; si no, null y no se imprime nada. Una línea por unidad, una sin SF pedidos,
 * sin SF/caja o sin cajas no cuenta: no hay redondeo que explicar. Si las cajas cubren exactamente lo pedido (100 SF a 25
 * SF/caja = 4 cajas) tampoco: el cliente se lleva lo que pidió.
 */
export function notaDeCajas(lineas: readonly QuoteLine[]): string | null {
  const redondea = lineas.some((l) => {
    if (l.kind !== "sf" || l.requested_sf === null || l.requested_sf <= 0) return false;
    const real = sfReal(l);
    return real !== null && real > l.requested_sf;
  });
  return redondea ? NOTA_DE_CAJAS : null;
}

export interface FilaDelCliente {
  descripcion: string;
  /** Una o dos líneas: «Requested Area: 1,250 SF» y, desde Standard, «Quantity: 53 Boxes». */
  cantidad: string[];
  /** El total de la línea **a precio regular** (D-442). */
  importe: number;
  /**
   * «Discount: 20%» si hay un precio con descuento válido; null si no. Es el **porcentaje** (D-475, con foto de la hoja:
   * «Instead of discount price I want it to be discount %»; reemplaza en parte a D-451, que lo ponía como precio). El
   * nombre del campo se queda para no mover la pantalla ni las pruebas que lo nombran.
   */
  precioConDescuento: string | null;
}

export interface HojaDelCliente {
  encabezado: string;
  subtitulo: string;
  preparadoPara: string;
  referencia: string;
  /** La tienda donde se creó la cotización (D-451), o null si no se sabe: entonces la línea no sale. */
  tienda: string | null;
  representante: string;
  resumen: string | null;
  filas: FilaDelCliente[];
  /** La nota de cajas completas (D-575), bajo la tabla; null si ninguna línea se redondea, y entonces no sale. */
  notaDeCajas: string | null;
  /** «Subtotal: $X», la suma a precio regular (D-442). */
  textoSubtotal: string;
  /** «Savings: −$Y», o null si no hay ahorro. */
  textoAhorro: string | null;
  /** «Tax 8.25%: $Z», con la tasa escrita. */
  textoImpuesto: string;
  total: number;
  textoTotal: string;
  /** La ÚNICA validez de la hoja: «QUOTE VALID THROUGH …», junto al total (D-451 quitó la de arriba). */
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
 * «Discount: 20%»: el porcentaje de descuento de la línea, como lo lee el cliente (D-475; antes el precio, D-451). Null
 * si la línea no tiene un precio con descuento que valga (vacío, igual o mayor que el regular, o sin regular). El
 * porcentaje es el mismo que ve el vendedor en la pantalla (`porcentajeDeDescuento`, a un decimal).
 */
export function precioConDescuentoParaElCliente(l: QuoteLine): string | null {
  const { regular, bajo } = preciosDeLinea(l);
  const pct = porcentajeDeDescuento(regular, bajo);
  return pct === null ? null : `Discount: ${numero(pct, 0)}%`;
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
  const r = resumenDeTotales(q.lines, tasaDeImpuesto(tienda));
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
    notaDeCajas: notaDeCajas(q.lines),
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
