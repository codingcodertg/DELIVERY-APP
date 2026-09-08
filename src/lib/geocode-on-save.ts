import type { Delivery } from "@/lib/types";

// ============================================================
// Buscarle el punto a un pedido AL GUARDARLO (D-223).
//
// El camino que se cierra: hasta ahora, un pedido con dirección y sin coordenadas solo se
// geocodificaba si alguien abría Mapa o Rutas **y** ese pedido caía dentro del `dayOrders` de esa
// pantalla (`useAutoGeocode`, filtros estrechos por fecha y etapa). Medición del 2026-09-08: 13
// pedidos sin punto, todos con dirección, y ocho de ellos ya entregados y de días cerrados — por
// esa vía no se recuperan nunca, porque nadie vuelve a abrir el mapa de un día pasado.
//
// Y no es cosmético: sin punto, la zona vuelve a decidirse por el nombre de la ciudad (D-219), o
// sea que esto decide una tarifa.
//
// Aquí vive lo puro: si hace falta buscar, qué se manda, qué significó la respuesta y qué se
// escribe. La llamada y las dos escrituras las hace el proveedor de datos.
// ============================================================

export interface FilaParaUbicar {
  delivery_address?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
}

/**
 * ¿Este pedido, **tal como queda guardado**, necesita que le busquemos el punto?
 *
 * Hace falta dirección y **no** tener ya un punto. `0,0` cuenta como no tenerlo: es el Golfo de
 * Guinea, nunca una entrega, y `puntoEnZonaLocal` ya lo trata así desde D-219 — que las dos
 * funciones discrepasen sobre qué es «tener punto» sería peor que cualquiera de las dos reglas.
 */
export function necesitaUbicacion(fila: FilaParaUbicar): boolean {
  if (!(fila.delivery_address ?? "").trim()) return false;
  const { delivery_lat: lat, delivery_lng: lng } = fila;
  if (lat == null || lng == null) return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return lat === 0 && lng === 0;
}

/**
 * La dirección como **clave**: es lo que distingue «esta dirección ya la intentamos» de «esta es
 * otra». Normalizada para que dos escrituras de la misma calle no cuenten como dos intentos.
 */
export function claveDireccion(direccion: string | null | undefined): string {
  return (direccion ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Qué pasó, en tres estados, porque **no todos los fallos son iguales**:
 *
 *  - `ok`: hay punto.
 *  - `noEncontrada`: el proveedor respondió y esa dirección no existe para él (404 — la ruta ya
 *    agotó Google, Mapbox y OSM antes de devolverlo). Volver a intentarla daría el mismo 404, así
 *    que se recuerda y no se repite: es la diferencia entre «no reintentar en bucle» y «no
 *    reintentar nunca».
 *  - `falloTemporal`: la red, un 500, una respuesta que no trae coordenadas. Puede funcionar
 *    dentro de un rato, así que **no** se recuerda; el próximo guardado lo intentará otra vez.
 */
export type ResultadoUbicar =
  | { kind: "ok"; lat: number; lng: number }
  | { kind: "noEncontrada" }
  | { kind: "falloTemporal" };

/** Lee la respuesta de `/api/geocode-point`. El 404 es el único fallo definitivo. */
export function resultadoDeRespuesta(status: number, cuerpo: unknown): ResultadoUbicar {
  if (status === 404) return { kind: "noEncontrada" };
  if (status < 200 || status >= 300) return { kind: "falloTemporal" };
  const p = cuerpo as { lat?: unknown; lng?: unknown } | null;
  const lat = p?.lat, lng = p?.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    // Un 200 sin coordenadas usables no es «esta dirección no existe», es un fallo de nuestro lado.
    // Marcar la dirección por esto la dejaría sin punto para siempre por un error ajeno a ella.
    return { kind: "falloTemporal" };
  }
  if (lat === 0 && lng === 0) return { kind: "falloTemporal" };
  return { kind: "ok", lat, lng };
}

/**
 * Lo que se escribe cuando se encuentra. **`"geocoded"`, nunca `"manual"`** (D-221): el aviso al
 * chofer —«sin dirección formal, Navegar usa el pin»— se enciende solo con `"manual"`, y aquí no
 * lo puso ninguna persona. Etiquetarlo de manual le mentiría justo en el pedido cuya dirección se
 * acaba de encontrar.
 */
export function parcheDeUbicacion(
  p: { lat: number; lng: number },
): Pick<Delivery, "delivery_lat" | "delivery_lng" | "delivery_pin_source"> {
  return { delivery_lat: p.lat, delivery_lng: p.lng, delivery_pin_source: "geocoded" };
}

/**
 * El aviso al usuario. Existe porque hasta hoy el fallo era **mudo**: `useAutoGeocode` se tragaba
 * cualquier error con un `catch {}`, sin señal ni reintento, así que una dirección que el proveedor
 * no resuelve se quedaba sin punto para siempre y nadie se enteraba — mientras esa misma falta de
 * punto decidía la tarifa por ciudad.
 *
 * Discreto a propósito: el pedido **sí se guardó**. Es un aviso, no un error.
 *
 * Mismo patrón que `mensajeEscrituraPerfil` (D-217): el texto se elige aquí, con el idioma que
 * pasa la pantalla, y la lógica no sabe de frases.
 */
export function avisoUbicacion(r: ResultadoUbicar, lang: string): string | null {
  if (r.kind === "ok") return null;
  const es = lang === "es";
  if (r.kind === "noEncontrada") {
    return es
      ? "Se guardó, pero no se pudo ubicar la dirección en el mapa. Revísela, o marque el pin exacto."
      : "Saved, but the address couldn't be found on the map. Check it, or drop the exact pin.";
  }
  return es
    ? "Se guardó, pero la búsqueda de la ubicación falló. Se reintentará al volver a guardar."
    : "Saved, but the location lookup failed. It will be retried on the next save.";
}

/** La nota que queda en el registro del pedido cuando la dirección no existe para el proveedor. */
export const NOTA_NO_ENCONTRADA = "No se pudo ubicar la dirección en el mapa (geocodificación)";

/** El tipo de evento con el que se registra. Uno propio: no es una edición del usuario. */
export const EVENTO_NO_ENCONTRADA = "geocode_failed";
