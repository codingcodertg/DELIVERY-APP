// ============================================================
// Straight-line distance between two points.
//
// Hasta D-NEXT este fichero era también la agrupación por zona del Gestor de Rutas (Clarke–Wright + or-opt:
// `buildGeoLoads`, `fillByCapacity`, `planCostMi`, `loadCostMi`), que usaba «Optimizar ruta» para decidir qué paradas
// iban en el mismo camión antes de pedir el orden a Google. Con «Optimizar» quitado (el dueño, 2026-09-28: «Quitar los
// dos; solo Armar rutas») nadie la llamaba y se borró: quién lleva qué y en qué viaje lo decide el motor de «Armar las
// rutas del día» (`lib/route-engine`). Queda la distancia, que usa el historial de recorridos (`track-history.ts`).
// ============================================================

export interface LatLng { lat: number; lng: number }

const EARTH_MI = 3958.8;

/** Straight-line miles between two points. */
export function haversineMi(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}
