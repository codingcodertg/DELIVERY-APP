import { orderLabel } from "@/lib/utils";
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";

/**
 * Cómo se nombra una orden en todo lo del plan de ruta (D-331): su código Y su número de factura.
 *
 * El dueño lo pidió para cada parada —«número de orden, número de factura»— y no estaba: el plan, «Fuera de este plan»,
 * «¿Por qué aquí?», la comparación con la hoja y «Mi ruta» nombraban la orden solo por su código. La factura se lee EN
 * VIVO de la orden (`deliveries`), no de la foto del plan: los planes ya guardados no la llevan, y quien ve el plan ve
 * esas órdenes. Una orden que ya no está a la vista se nombra por el principio de su referencia, como antes.
 */
export type OrdenParaNombrar = { id: string; order_code?: string | null; order_no: number; order_suffix?: string | null; invoice_num?: string | null };

export function etiquetaDeOrden(d: OrdenParaNombrar, es: boolean): string {
  const factura = (d.invoice_num ?? "").trim();
  return factura ? `#${orderLabel(d)} · ${es ? "Fact." : "Inv."} ${factura}` : `#${orderLabel(d)}`;
}

/** `ref` puede ser el id de la orden o el de una de sus cargas (`<id>#b`). */
export function nombraLaOrden(ordenes: readonly OrdenParaNombrar[], ref: string, es: boolean): string {
  const d = ordenes.find((x) => x.id === ref.split("#")[0]);
  return d ? etiquetaDeOrden(d, es) : ref.slice(0, 8);
}

/**
 * A dónde va una entrega del plan (D-422): la ciudad y la dirección, leídas EN VIVO de la orden como la factura, para que
 * salga también en los borradores ya guardados. El dueño, con la captura del borrador: «aun no miro a donde delivere».
 * `null` si la orden no está a la vista o no tiene dirección.
 */
export function destinoDeLaOrden(
  ordenes: readonly (OrdenParaNombrar & { delivery_address?: string | null })[],
  ref: string,
): { ciudad: string; direccion: string } | null {
  const d = ordenes.find((x) => x.id === ref.split("#")[0]);
  const direccion = (d?.delivery_address ?? "").replace(/\s+/g, " ").trim();
  if (!direccion) return null;
  return { ciudad: ciudadDeEntrega(direccion), direccion };
}
