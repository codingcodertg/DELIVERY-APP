/**
 * La PO de una orden, bajo su factura en la tabla de paradas del Gestor (D-1187). El dueño, 2026-11-25: «quiero que se
 * miren los po en vez del orden id». Una orden con PO enseña `PO <número>` en gris, donde iba su ID. Una sin PO no enseña
 * nada debajo: su ID va en el `title` del enlace de la factura, para que la fila siga siendo identificable.
 */
export interface OrdenConPO { po2?: string | null }

/** La PO sin espacios en los extremos, o null si está vacía (o no existe). */
export function poDeLaOrden(orden: OrdenConPO): string | null {
  const po = String(orden.po2 ?? "").trim();
  return po || null;
}

/** El texto gris que va bajo la factura: `PO <número>`, o null si la orden no tiene PO. */
export function textoBajoLaFactura(orden: OrdenConPO): string | null {
  const po = poDeLaOrden(orden);
  return po ? `PO ${po}` : null;
}

/**
 * El `title` del texto de la PO: `PO <número> · Orden #<código>` (EN: `PO <número> · Order #<código>`). Sin PO, solo
 * `Orden #<código>`: es lo que lleva el enlace de la factura cuando no hay PO que enseñar.
 */
export function tituloDeLaFactura(orden: OrdenConPO, codigo: string, es: boolean): string {
  const nombre = es ? "Orden" : "Order";
  const po = poDeLaOrden(orden);
  return po ? `PO ${po} · ${nombre} ${codigo}` : `${nombre} ${codigo}`;
}
