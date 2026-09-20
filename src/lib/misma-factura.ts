/**
 * «Misma factura que una orden anterior», buscando por el número COMPLETO (D-337).
 *
 * Antes era una lista: al marcar la casilla salían hasta cien facturas de otras órdenes, con su cuenta, y se filtraba
 * tecleando. El dueño: «don't show options in the dropdown, you must input a number to be searched and the number must be
 * complete to be able to be found». Ahora no se enseña ninguna factura ajena: se teclea, se pulsa la lupa, y solo casa el
 * número entero. Medio número no encuentra nada, a propósito.
 */

/** Como se comparan dos números de factura: sin espacios (tampoco en medio), sin mayúsculas y sin el «#» de delante. */
export function facturaComparable(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").replace(/^#+/, "").toLowerCase();
}

interface OrdenConFactura { id: string; order_no: number; stage?: string | null; invoice_num?: string | null }

/** La orden más reciente, no anulada y distinta de la que se edita, con EXACTAMENTE esa factura. `null` si no hay. */
export function ordenConEsaFactura<T extends OrdenConFactura>(ordenes: readonly T[], tecleado: string, laQueSeEdita?: string | null): T | null {
  const q = facturaComparable(tecleado);
  if (!q) return null;
  let mejor: T | null = null;
  for (const o of ordenes) {
    if (o.id === laQueSeEdita || o.stage === "canceled" || facturaComparable(o.invoice_num) !== q) continue;
    if (!mejor || o.order_no > mejor.order_no) mejor = o;
  }
  return mejor;
}
