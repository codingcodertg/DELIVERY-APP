// ============================================================
// Qué enseña la ventana del mapa de una foto (Auditoría → Fotos, D-213 tras D-212).
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

/** Lo que decide el estilo del marcador: el veredicto, sin coordenadas no hay marcador. */
export type EstadoMarcador = "dentro" | "fuera" | "sinSitio";

export type EstiloMarcador = {
  /** Relleno del símbolo. Fuera: el rojo del hub (`--red`, #d64545), no ámbar. */
  fill: string;
  /** Radio del círculo en px. Fuera es claramente mayor que el estándar. */
  scale: number;
  stroke: string;
  strokeWeight: number;
  /** Texto de la etiqueta (la distancia, o el nombre). Sobre una pastilla blanca: legible en satélite. */
  labelColor: string;
  labelWeight: string;
  labelClass: string;
};

/**
 * Color y tamaño del marcador por estado (pedido del dueño sobre D-213: «un icon rojo más visible»).
 * Dentro: verde, tamaño normal. Fuera: rojo y casi el doble, con la distancia también en rojo.
 * Sin sitio: gris neutro. Es lo único que cambia: `estadoFoto` decide igual.
 */
export function estiloMarcador(estado: EstadoMarcador): EstiloMarcador {
  if (estado === "fuera") {
    return { fill: "#d64545", scale: 13, stroke: "#fff", strokeWeight: 3, labelColor: "#d64545", labelWeight: "800", labelClass: "tt-map-label tt-map-label-out" };
  }
  if (estado === "dentro") {
    return { fill: "#22c55e", scale: 7, stroke: "#fff", strokeWeight: 2, labelColor: "#166534", labelWeight: "700", labelClass: "tt-map-label" };
  }
  return { fill: "#9aa6b8", scale: 7, stroke: "#fff", strokeWeight: 2, labelColor: "#374151", labelWeight: "700", labelClass: "tt-map-label" };
}

/**
 * La etiqueta bajo la foto en Auditoría (pedido del dueño sobre D-214: la línea se cortaba y no se
 * leía el veredicto). El veredicto va en una pastilla que nunca se trunca; el nombre del sitio (o
 * las coordenadas) en una segunda línea, que es lo que puede cortarse. Puro: aquí se decide QUÉ
 * pastilla y qué segunda línea; el texto lo pone la pantalla con claves literales.
 *
 *   on      · verde   · «On site»            (distancia 0 y dentro)
 *   near    · ámbar   · «{d} away»           (con distancia pero no marcada fuera: una excepción
 *                                             lejos, o un fichaje dentro del margen de GPS)
 *   out     · rojo    · «Out · {d}»          (el servidor la marcó fuera de la geocerca)
 *   noSite  · gris    · «No site»            (coordenadas sin ningún sitio contra el que medir)
 *   none    · gris    · «No location»        (sin coordenadas: no pulsable)
 */
export type EtiquetaFoto = {
  kind: "none" | "noSite" | "on" | "near" | "out";
  /** Clase de `.pill`: neutral / on / wait / off. Variables del módulo, no hex. */
  cls: "neutral" | "on" | "wait" | "off";
  distanceM: number | null;
  /** Segunda línea: el nombre del sitio, las coordenadas, o nada. */
  second: string | null;
};

export function etiquetaFoto(p: {
  lat: number | null; lng: number | null; siteName: string | null; distanceM: number | null; offSite: boolean | null;
}): EtiquetaFoto {
  if (p.lat == null || p.lng == null) return { kind: "none", cls: "neutral", distanceM: null, second: null };
  const coords = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  if (p.siteName == null || p.distanceM == null) return { kind: "noSite", cls: "neutral", distanceM: null, second: coords };
  if (p.offSite) return { kind: "out", cls: "off", distanceM: p.distanceM, second: p.siteName };
  if (p.distanceM === 0) return { kind: "on", cls: "on", distanceM: 0, second: p.siteName };
  return { kind: "near", cls: "wait", distanceM: p.distanceM, second: p.siteName };
}

/** Un sitio de las fotos, en la forma que dibuja GeofenceMap (siempre "activo": es la geocerca que se juzga). */
export function comoFence(s: SitioFoto) {
  return {
    id: s.id, name: s.name, active: true,
    latitude: s.latitude, longitude: s.longitude,
    radius_meters: s.radius_meters, padding_meters: s.padding_meters, boundary: s.boundary,
  };
}
