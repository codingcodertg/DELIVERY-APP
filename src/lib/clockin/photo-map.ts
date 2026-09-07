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
/** «near» (D-216): con distancia pero sin marca de fuera del servidor, como en la pastilla bajo la foto. */
export type EstadoMarcador = "dentro" | "fuera" | "near" | "sinSitio";

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
  if (estado === "near") {
    return { fill: "#e9a13b", scale: 9, stroke: "#fff", strokeWeight: 2, labelColor: "#8a6400", labelWeight: "700", labelClass: "tt-map-label" };
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

// ---- El mapa "obvio" (pedido del dueño sobre D-215 con captura: el polígono apenas se veía, el
// punto de la foto no, y no quedaba claro qué está lejos de qué) -------------------------------

export type LatLng = { lat: number; lng: number };

// Proyección plana local en metros, la misma idea que geofence.ts (que no la exporta): a escala
// de una propiedad, un grado de latitud son ~110 540 m y uno de longitud 111 320·cos(lat).
function aXY(p: LatLng, o: LatLng) {
  return { x: (p.lng - o.lng) * Math.cos((o.lat * Math.PI) / 180) * 111320, y: (p.lat - o.lat) * 110540 };
}
function deXY(xy: { x: number; y: number }, o: LatLng): LatLng {
  return { lat: o.lat + xy.y / 110540, lng: o.lng + xy.x / (Math.cos((o.lat * Math.PI) / 180) * 111320) };
}

/**
 * El punto de la geocerca más cercano a la foto: donde termina la línea de distancia. Polígono:
 * el punto más cercano de sus lados (geofence.ts mide esa distancia pero no devuelve el punto;
 * se calcula aquí con la misma proyección). Círculo: el punto del borde en la dirección de la
 * foto (centro + radio hacia la foto); si la foto ya está dentro, la propia foto.
 */
export function puntoMasCercanoGeocerca(lat: number, lng: number, site: SitioFoto): LatLng {
  const foto = { lat, lng };
  if (site.boundary && site.boundary.length >= 3) {
    const o = site.boundary[0];
    const p = aXY(foto, o);
    let mejor = { d: Infinity, x: 0, y: 0 };
    const poly = site.boundary;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = aXY(poly[j], o);
      const b = aXY(poly[i], o);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < mejor.d) mejor = { d, ...q };
    }
    return deXY(mejor, o);
  }
  const centro = { lat: site.latitude, lng: site.longitude };
  const v = aXY(foto, centro);
  const dist = Math.hypot(v.x, v.y);
  if (dist <= site.radius_meters || dist === 0) return foto;
  const k = site.radius_meters / dist;
  return deXY({ x: v.x * k, y: v.y * k }, centro);
}

export function puntoMedio(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/** La geocerca: en Ajustes (sin puntos) como siempre; en la ventana de una foto, marcada. */
export function estiloGeocerca(conPuntos: boolean): { fillOpacity: number; strokeWeight: number } {
  return conPuntos ? { fillOpacity: 0.3, strokeWeight: 4 } : { fillOpacity: 0.18, strokeWeight: 2 };
}

/** Un pin (el "place" de Material, 24×24): la punta en (12, 22). */
export const PIN_PATH = "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z";

export type EstiloPin = {
  path: string;
  fill: string;
  stroke: string;
  strokeWeight: number;
  scale: number;
  /** Punto del path que se ancla a la coordenada: la punta. */
  anchor: { x: number; y: number };
  /** Punto pequeño en la punta, con la coordenada exacta. */
  dot: { scale: number; fill: string };
  labelColor: string;
  labelClass: string;
};

/** El pin de la foto: rojo grande fuera, verde dentro, ámbar cerca, gris sin sitio; borde blanco siempre. */
export function estiloPin(estado: EstadoMarcador | "near"): EstiloPin {
  const base = { path: PIN_PATH, stroke: "#fff", strokeWeight: 2, anchor: { x: 12, y: 22 } };
  if (estado === "fuera") return { ...base, fill: "#d64545", scale: 2.4, dot: { scale: 3, fill: "#d64545" }, labelColor: "#d64545", labelClass: "tt-map-label tt-map-label-out" };
  if (estado === "dentro") return { ...base, fill: "#22c55e", scale: 2, dot: { scale: 3, fill: "#166534" }, labelColor: "#166534", labelClass: "tt-map-label" };
  if (estado === "near") return { ...base, fill: "#e9a13b", scale: 2.2, dot: { scale: 3, fill: "#8a6400" }, labelColor: "#8a6400", labelClass: "tt-map-label" };
  return { ...base, fill: "#9aa6b8", scale: 2, dot: { scale: 3, fill: "#374151" }, labelColor: "#374151", labelClass: "tt-map-label" };
}

/** El marcador del centro del sitio: círculo verde con borde blanco y el nombre en pastilla. */
export function estiloSitio(): { fill: string; stroke: string; strokeWeight: number; scale: number; labelColor: string; labelClass: string } {
  return { fill: "#22c55e", stroke: "#fff", strokeWeight: 2, scale: 8, labelColor: "#166534", labelClass: "tt-map-label" };
}

/** La línea de distancia: discontinua, roja, con flecha en el extremo de la geocerca. */
export function estiloLinea(): { color: string; dashScale: number; dashRepeat: string; arrowScale: number } {
  return { color: "#d64545", dashScale: 3, dashRepeat: "14px", arrowScale: 3.5 };
}

/** Un sitio de las fotos, en la forma que dibuja GeofenceMap (siempre "activo": es la geocerca que se juzga). */
export function comoFence(s: SitioFoto) {
  return {
    id: s.id, name: s.name, active: true,
    latitude: s.latitude, longitude: s.longitude,
    radius_meters: s.radius_meters, padding_meters: s.padding_meters, boundary: s.boundary,
  };
}
