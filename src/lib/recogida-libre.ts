/**
 * Recogida libre: en «Otro» y «Proveedor» la recogida se teclea, no se elige entre nuestras tiendas (D-746, 2026-10-29).
 *
 * Roberto Rodriguez Jr, desde la ficha de una orden nueva (reenviado por el dueño): «Other and Supplier should give option
 * for pickup address to be inputted rather than saying to pickup at one of our stores».
 *
 * Por la REGLA del tipo, no por su nombre: un tipo con origen libre (`anyOrigin`, D-746 de «Otro») o sin cliente detrás
 * (`hasCustomer: false`, el «Proveedor» de D-511) recoge donde sea. En producción son exactamente Other y Proveedor; Customer,
 * Intertienda y Transfer siguen igual (la recogida es una tienda).
 *
 * Qué cambia con ella:
 * - El control de recogida abre en modo «escribir»: nombre tecleado y dirección buscada (y «Elegir guardado» si se quiere una
 *   de la lista).
 * - Elegir «Vendido desde» ya no pisa la recogida con esa tienda.
 * - Al cambiar a uno de estos tipos, una recogida que era una de nuestras tiendas se vacía para teclear la de verdad.
 */
import type { NamedLocation, OrderTypeRule } from "./types";

export function recogidaLibre(regla: Pick<OrderTypeRule, "anyOrigin" | "hasCustomer">): boolean {
  return regla.anyOrigin === true || regla.hasCustomer === false;
}

/** Al cambiar al tipo: una recogida que es una de nuestras tiendas se vacía; una tecleada se respeta. */
export function sinRecogidaDeTienda<T extends { pickup_name?: string | null; pickup_address?: string | null }>(p: T, tiendas: readonly NamedLocation[]): T {
  const n = (p.pickup_name ?? "").trim().toLowerCase();
  if (!n || !tiendas.some((s) => s.name.trim().toLowerCase() === n)) return p;
  return { ...p, pickup_name: "", pickup_address: "" };
}
