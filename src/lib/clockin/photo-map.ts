// ============================================================
// Qué enseña la ventana del mapa de una foto (Auditoría → Fotos, D-NEXT tras D-212).
//
// Lo puro: dada una foto (con lat/lng, siteId y distanceM ya calculados en el servidor, D-212)
// y la lista de sitios que viaja con las fotos, decidir el estado y qué geocerca dibujar. No
// se recalcula ninguna distancia en el cliente: el veredicto es el del servidor, el mismo
// que decidió `in_radius` al fichar.
// ============================================================

import type { SitioFoto } from "./day-photos";

export type EstadoFoto =
  | { kind: "sinCoords" }
  | { kind: "sinSitio"; lat: number; lng: number }
  | { kind: "dentro"; lat: number; lng: number; site: SitioFoto }
  | { kind: "fuera"; lat: number; lng: number; site: SitioFoto; distanceM: number };

/** La geocerca de ESA foto (solo una: la del sitio del fichaje o el más cercano), o null. */
export function geocercaDeFoto(p: { siteId: string | null }, sites: SitioFoto[]): SitioFoto | null {
  return (p.siteId && sites.find((s) => s.id === p.siteId)) || null;
}

export function estadoFoto(
  p: { lat: number | null; lng: number | null; siteId: string | null; distanceM: number | null },
  sites: SitioFoto[],
): EstadoFoto {
  if (p.lat == null || p.lng == null) return { kind: "sinCoords" };
  const site = geocercaDeFoto(p, sites);
  if (!site || p.distanceM == null) return { kind: "sinSitio", lat: p.lat, lng: p.lng };
  if (p.distanceM === 0) return { kind: "dentro", lat: p.lat, lng: p.lng, site };
  return { kind: "fuera", lat: p.lat, lng: p.lng, site, distanceM: p.distanceM };
}

/** Un sitio de las fotos, en la forma que dibuja GeofenceMap (siempre "activo": es la geocerca que se juzga). */
export function comoFence(s: SitioFoto) {
  return {
    id: s.id, name: s.name, active: true,
    latitude: s.latitude, longitude: s.longitude,
    radius_meters: s.radius_meters, padding_meters: s.padding_meters, boundary: s.boundary,
  };
}
