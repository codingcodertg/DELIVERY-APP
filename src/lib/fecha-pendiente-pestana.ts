import type { Delivery } from "@/lib/types";

/**
 * La pestaña «Pending Delivery Date» / «Fecha pendiente» de Órdenes (D-994). Roberto, 2026-11-11 (Órdenes, vista de tabla):
 * «Need to add a tab saying Pending Delivery Date». Desde D-972 una orden se puede programar y aprobar SIN día de entrega;
 * aquí se juntan todas las que siguen así, con su número, igual que «Outdated» y «Factura pendiente».
 */
export const PESTANA_FECHA_PENDIENTE = "pending-date";

/** Las etapas que ya no esperan día: entregada o anulada. */
const SIN_ESPERA: ReadonlySet<string> = new Set(["delivered", "canceled"]);

/** Las órdenes sin día de entrega que todavía lo esperan, sin repetir (llegan de dos listas que se pisan). */
export function ordenesSinFecha(...listas: readonly (readonly Delivery[])[]): Delivery[] {
  const vistas = new Set<string>();
  const out: Delivery[] = [];
  for (const l of listas) for (const d of l) {
    if (vistas.has(d.id)) continue;
    vistas.add(d.id);
    if (!(d.delivery_date ?? "").trim() && !SIN_ESPERA.has(d.stage)) out.push(d);
  }
  return out;
}
