/**
 * Una transferencia no vende (D-741, 2026-10-29).
 *
 * Francis Lestarpe (office manager), desde la ficha de una orden Transfer: «when the order type is a transfer, the
 * store sold from fields should not exist since no sale was made».
 *
 * «Transfer» es, por su regla, un movimiento de tienda a tienda SIN tienda que reciba fija (`storeToStore` sin
 * `homeIsDestination`; la Intertienda sí la tiene y sigue igual). En ese caso:
 * - La ficha no enseña «Tienda (Vendido desde)» ni su dirección, y `missingFields` no la exige.
 * - `store` se rellena solo con el **almacén de recogida** cuando ese almacén es una tienda de Ajustes (y se vacía si no
 *   lo es). Así todo lo que lee `store` —quién ve la orden, el comprobante, el Panel de millas (D-738), los informes—
 *   sigue teniendo una tienda: la que manda el material, que es la que de verdad lo mueve.
 */
import type { NamedLocation, OrderTypeRule } from "./types";

export function esTransferenciaSinVenta(regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">): boolean {
  return regla.storeToStore === true && regla.homeIsDestination !== true;
}

/** El nombre de la tienda de Ajustes que es ese almacén de recogida, o "" si la recogida no es una tienda. */
export function tiendaDeLaRecogida(pickupName: string | null | undefined, tiendas: readonly NamedLocation[]): string {
  const n = (pickupName ?? "").trim().toLowerCase();
  if (!n) return "";
  return tiendas.find((s) => s.name.trim().toLowerCase() === n)?.name ?? "";
}

/** En una transferencia, `store` sigue a la recogida; en los demás tipos no se toca. */
export function conTiendaDeLaRecogida<T extends { pickup_name?: string | null; store?: string | null }>(p: T, tiendas: readonly NamedLocation[], regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">): T {
  if (!esTransferenciaSinVenta(regla)) return p;
  return { ...p, store: tiendaDeLaRecogida(p.pickup_name, tiendas) };
}
