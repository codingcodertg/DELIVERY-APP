/**
 * La tarifa de entrega en el Estimador (D-NEXT): **la misma calculadora que la ficha de Entregas**, no una copia.
 *
 * Lo pidió el dueño el 2026-09-28: «en el estimador la misma funcion de delivery fee y el calculador ponlo cuando es
 * entrega y se pone el address tambien agrega la funcion de pin del mapa and the search of the address just like in the
 * delivery app and it should output the price and discount price for the sales rep but not for the customer in the
 * estimate».
 *
 * Lo que decide el precio vive donde ya vivía y aquí solo se le da de comer:
 * - la tarifa de lista y la de descuento, la zona LOCAL / NO LOCAL y el «requiere aprobación»: `suggestDeliveryFee`
 *   (`lib/pricing.ts`), la función que usa `OrderModal`;
 * - la zona por el pin: `puntoEnZonaLocal`, que `suggestDeliveryFee` ya llama cuando hay punto;
 * - las millas: `/api/distance`, la misma ruta del botón «🚚 Calcular distancia y tarifa» de la ficha.
 *
 * **Nada de esto sale en la hoja del cliente** (D-413): `hoja.ts` no lee `delivery` salvo el modo, y su prueba lo
 * comprueba con la dirección, las millas y los dos precios puestos.
 */

import { suggestDeliveryFee, type FeeSuggestion } from "@/lib/pricing";
import type { NamedLocation, Settings } from "@/lib/types";
import type { Delivery } from "./modelo";

/** Lo que la calculadora necesita de Ajustes: las tiendas (origen de las millas), las ciudades locales y el recargo. */
export type AjustesDeEntrega = { stores: NamedLocation[] } & Partial<Pick<Settings, "local_cities" | "same_day_surcharge">>;

/**
 * La sugerencia de tarifa de ESTA cotización, con la función de la ficha de la orden.
 *
 * Se le pasa la entrega con los nombres de una orden (`delivery_address`, `route_miles`, `delivery_lat/lng`). **Sin
 * fecha de entrega**: una cotización no la tiene, así que el recargo de mismo día no se aplica nunca aquí (en la ficha
 * solo se aplica si la entrega es hoy). Recogiendo, no hay tarifa.
 */
export function tarifaDeLaCotizacion(d: Delivery, ajustes: AjustesDeEntrega): FeeSuggestion {
  if (d.mode !== "delivery") return suggestDeliveryFee({}, ajustes);
  return suggestDeliveryFee(
    { delivery_address: d.address, route_miles: d.miles, delivery_lat: d.lat, delivery_lng: d.lng, delivery_date: null },
    ajustes,
  );
}

/**
 * Cobrar por debajo del descuento pide aprobación, como en la ficha (D-303): el descuento es el suelo de lo que un
 * vendedor puede ofrecer solo. La misma condición que `OrderModal`, sobre el cargo de la cotización.
 */
export function bajoElDescuento(cargo: number | null, s: Pick<FeeSuggestion, "discount">): boolean {
  return s.discount != null && cargo != null && cargo < s.discount;
}

/**
 * Pulsar Lista o Descuento pone ese importe en el cargo; pulsar el que ya está puesto lo quita. Es el mismo gesto de
 * los botones de la ficha (`d.delivery_fee === x ? null : x`).
 */
export function alternarCargo(d: Delivery, importe: number): Delivery {
  return { ...d, charge: d.charge === importe ? null : importe };
}

/**
 * El origen de las millas: la dirección de la tienda de salida, o su nombre si no la tiene. Es el mismo respaldo que
 * la ficha (`storeAddress || d.store`).
 */
export function origenDeLasMillas(tienda: string, tiendas: NamedLocation[]): string {
  const direccion = tiendas.find((s) => s.name === tienda)?.address || "";
  return (direccion || tienda || "").trim();
}

/**
 * Cambiar la dirección **borra las millas**: eran de la otra dirección y darían un precio que no es de esta. Volver a
 * pulsar «Calcular» cuesta una llamada; enseñar un precio equivocado cuesta más. Escribir lo mismo no borra nada.
 */
export function conDireccion(d: Delivery, address: string): Delivery {
  return address === d.address ? d : { ...d, address, miles: null };
}

/** Cambiar la tienda de salida también: las millas se cuentan desde ella. */
export function conTienda(d: Delivery, store: string): Delivery {
  return store === d.store ? d : { ...d, store, miles: null };
}

/**
 * La tienda con la que nace la entrega: la del perfil de quien prepara si está en Ajustes; si no, ninguna, y se elige
 * (un admin no tiene tienda). Se compara sin mayúsculas ni espacios de más, como `tiendasParaElMapa`.
 */
export function tiendaDePartida(delPerfil: string | null | undefined, tiendas: NamedLocation[]): string {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const buscada = n(delPerfil ?? "");
  if (!buscada) return "";
  return tiendas.find((s) => n(s.name) === buscada)?.name ?? "";
}

export type ResultadoMillas = { ok: true; miles: number } | { ok: false; error: string };

/**
 * Pide las millas a `/api/distance` — **una llamada, solo cuando se pulsa el botón**. Esa ruta llama a Google Routes
 * (gasta cuota), así que ni se lanza al teclear ni al mover el pin. En la ficha de Entregas, además del botón, se lanza
 * sola 900 ms después de dejar de escribir; aquí no, a propósito: una cotización se escribe y se reescribe más que una
 * orden, y cada vuelta costaría una llamada.
 */
export async function pedirMillas(
  origen: string, destino: string, f: typeof fetch = fetch,
): Promise<ResultadoMillas> {
  if (!origen.trim()) return { ok: false, error: "sin-origen" };
  if (!destino.trim()) return { ok: false, error: "sin-destino" };
  try {
    const res = await f("/api/distance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: origen.trim(), destination: destino.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
    const miles = Number(body?.miles);
    if (!Number.isFinite(miles) || miles < 0) return { ok: false, error: "sin-millas" };
    return { ok: true, miles };
  } catch {
    return { ok: false, error: "red" };
  }
}
