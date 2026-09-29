/**
 * Medir la ruta de un chofer en el Gestor de Rutas SIN reordenarla (D-NEXT).
 *
 * Hasta D-NEXT, elegir un chofer «dibujaba» su ruta llamando a «Optimizar» (`computeRoute` + `applyPlan`): pedía a Google
 * el MEJOR orden y lo escribía. Como la medida se borra tras cada cambio (`clearRouteFor`), una flecha con el chofer elegido
 * volvía a optimizar y deshacía la flecha. El dueño pidió quitar Optimizar (2026-09-28): el orden lo deciden «Armar las
 * rutas del día», «📍 Mejor lugar», el arrastre y las flechas. Esto solo mide y pinta: millas, horas por viaje, llegada
 * estimada de cada parada y el trazo del mapa, en el orden GUARDADO.
 */

export interface PuntoDeLaMedida { id: string; lat: number; lng: number }

/**
 * El cuerpo que se manda a `/api/optimize-route` para un viaje: la base (si hay) y las paradas EN SU ORDEN, con
 * `optimize: false` —el camino en ese orden, como «Mi ruta» y el trazo del plan publicado—. Con base, ida y vuelta.
 */
export function cuerpoDeLaMedida(paradas: readonly PuntoDeLaMedida[], base: readonly [number, number] | null, fecha: string | null) {
  return {
    stops: [...(base ? [{ id: "__depot__", lat: base[0], lng: base[1] }] : []), ...paradas.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))],
    roundtrip: !!base,
    date: fecha,
    optimize: false as const,
  };
}

/**
 * ¿Se pinta en el mapa la línea del plan PUBLICADO de un chofer (D-352)? Solo si le quedan paradas pendientes y su ruta
 * de hoy SIGUE siendo la publicada (`fuente: "plan"`, la misma decisión que da las etiquetas P/D, D-335/D-433).
 *
 * El dueño, 2026-09-28, con captura: «julio esta vacio pero aun asi aparece». Julio tenía 0 paradas y el mapa seguía
 * dibujando la línea de su plan publicado —Pharr → … → Brownsville—, porque el trazo se pedía con las paradas DEL PLAN,
 * no con las suyas de ahora. Se decidió «nada» antes que «el plan recortado a lo que le queda»: recortado ya no es el plan
 * (sus recogidas y su orden eran para otra ruta), y la ruta de ahora ya tiene su propia línea, la medida (`mideLaRuta`).
 */
export const pintaElTrazoDelPlan = (pendientes: number, fuente: "plan" | "derivada"): boolean => pendientes > 0 && fuente === "plan";

/**
 * La forma de la ruta que se mide: qué paradas, en qué puesto, en qué viaje y dónde. La pantalla mide cada forma UNA vez:
 * si la medida falla (sin sesión, sin red), no se vuelve a pedir en bucle; si la ruta cambia, es otra forma y se mide.
 */
export function firmaDeLaMedida(
  fecha: string, clave: string,
  paradas: readonly { id: string; route_seq?: number | null; load_no?: number | null; delivery_lat?: number | null; delivery_lng?: number | null }[],
): string {
  return [fecha, clave, ...paradas.map((p) => `${p.id}:${p.route_seq ?? ""}:${p.load_no ?? ""}:${p.delivery_lat ?? ""},${p.delivery_lng ?? ""}`)].join("|");
}
