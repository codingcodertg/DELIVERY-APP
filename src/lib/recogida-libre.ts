/**
 * Recogida libre: en «Otro» y «Proveedor» la recogida se teclea, no se elige entre nuestras tiendas (D-753, 2026-10-29).
 *
 * Roberto Rodriguez Jr, desde la ficha de una orden nueva (reenviado por el dueño): «Other and Supplier should give option
 * for pickup address to be inputted rather than saying to pickup at one of our stores».
 *
 * Por la REGLA del tipo, no por su nombre: un tipo con origen libre (`anyOrigin`, D-753 de «Otro») o sin cliente detrás
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
import { orderTypeRule, type OrderTypeRules } from "./required";

export function recogidaLibre(regla: Pick<OrderTypeRule, "anyOrigin" | "hasCustomer">): boolean {
  return regla.anyOrigin === true || regla.hasCustomer === false;
}

/** La misma regla, desde la orden: por su tipo y las reglas de Ajustes. */
export function recogidaLibreDeLaOrden(d: { order_type?: string | null }, reglas: OrderTypeRules | undefined): boolean {
  return recogidaLibre(orderTypeRule(d.order_type, reglas));
}

/**
 * D-NEXT (223): el punto de la recogida libre, el que se geocodificó de la dirección tecleada al guardar. `0,0` y
 * lo que no es número cuentan como «sin punto», como `necesitaUbicacion` con la entrega.
 */
export function puntoDeRecogidaLibre(d: { pickup_point_lat?: number | null; pickup_point_lng?: number | null }): { lat: number; lng: number } | null {
  const lat = d.pickup_point_lat, lng = d.pickup_point_lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** Lo que se escribe al guardar: el punto encontrado, o nada (la dirección cambió y no se encontró). */
export function parcheDePuntoDeRecogida(p: { lat: number; lng: number } | null): { pickup_point_lat: number | null; pickup_point_lng: number | null } {
  return { pickup_point_lat: p?.lat ?? null, pickup_point_lng: p?.lng ?? null };
}

/**
 * Lo que el desplegable de recogida ofrece con recogida libre: los puntos guardados que NO son una de nuestras tiendas
 * (Roberto: «pickup is not a store»). Sin repetidos, en su orden.
 */
export function opcionesDeRecogidaLibre(tiendas: readonly NamedLocation[], guardados: readonly NamedLocation[] | null | undefined): NamedLocation[] {
  const esTienda = new Set(tiendas.map((s) => s.name.trim().toLowerCase()));
  const vistos = new Set<string>();
  return (guardados ?? []).filter((l) => {
    const n = (l.name ?? "").trim().toLowerCase();
    if (!n || esTienda.has(n) || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

/** Al cambiar al tipo: una recogida que es una de nuestras tiendas se vacía; una tecleada se respeta. */
export function sinRecogidaDeTienda<T extends { pickup_name?: string | null; pickup_address?: string | null }>(p: T, tiendas: readonly NamedLocation[]): T {
  const n = (p.pickup_name ?? "").trim().toLowerCase();
  if (!n || !tiendas.some((s) => s.name.trim().toLowerCase() === n)) return p;
  return { ...p, pickup_name: "", pickup_address: "" };
}
