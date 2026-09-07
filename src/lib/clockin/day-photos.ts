// ============================================================
// Dónde se tomó cada foto de fichaje (Auditoría → Fotos).
//
// La base guarda la posición junto a cada foto desde el principio (time_entries.clock_in_lat/lng,
// clock_out_lat/lng; exceptions.latitude/longitude y returned_lat/lng), pero nadie la enseñaba.
// Esto es la parte pura: convertir filas en fotos con sitio y distancia, sin red ni Supabase,
// para que se pruebe en solitario y la acción (clock-in/actions/photos.ts) solo consulte.
//
// La distancia es A LA GEOCERCA del sitio, no al centro: 0 si el punto cae dentro del polígono
// y, si no, la distancia al borde más cercano (distanceToPolygonMeters, que mide al borde
// también desde dentro: por eso va detrás de pointInPolygon); para un sitio de círculo, lo que
// sobresale del radio, max(0, haversine − radius). Es la misma matemática con la que el
// servidor decidió si el fichaje estaba dentro (geofence.ts), así que "a 35 m" de aquí y el
// "fuera de la geocerca" del fichaje no pueden contradecirse; 0 se pinta como "en el sitio".
// ============================================================

import { haversine, pointInPolygon, distanceToPolygonMeters, type GeoSite } from "./geofence";

export type PhotoKind = "in" | "out" | "left" | "back";

export type SitioFoto = GeoSite & { name: string };

export type FotoCruda = {
  path: string;
  who: string;
  /** UTC ISO del momento en que se tomó. */
  at: string;
  kind: PhotoKind;
  /** true solo cuando el fichaje quedó FUERA de la geocerca; null = no aplica. */
  offSite: boolean | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  /** El sitio del fichaje; si el fichaje no cayó en ninguno, el más cercano. null = sin sitios o sin posición. */
  siteName: string | null;
  /** El id de ese mismo sitio, para buscar su geocerca en la lista que viaja con las fotos. */
  siteId: string | null;
  /** Metros a la geocerca de ese sitio, redondeados. null = sin posición o sin sitios. */
  distanceM: number | null;
};

export type FilaFichaje = {
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_photo_path: string | null;
  clock_out_photo_path: string | null;
  clock_in_in_radius: boolean | null;
  clock_out_in_radius: boolean | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_site_id: string | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_site_id: string | null;
};

export type FilaExcepcion = {
  employee_id: string;
  time_entry_id: string | null;
  type: string;
  reason: string | null;
  note: string | null;
  photo_path: string | null;
  returned_photo_path: string | null;
  left_at: string | null;
  returned_at: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
  returned_lat: number | null;
  returned_lng: number | null;
};

export function distanciaAGeocerca(lat: number, lng: number, site: GeoSite): number {
  if (site.boundary && site.boundary.length >= 3) {
    if (pointInPolygon(lat, lng, site.boundary)) return 0;
    return distanceToPolygonMeters(lat, lng, site.boundary);
  }
  return Math.max(0, haversine(lat, lng, site.latitude, site.longitude) - site.radius_meters);
}

/** Sitio y distancia de una posición: el sitio del fichaje si lo hay; si no, el más cercano. */
export function ubicar(
  lat: number | null,
  lng: number | null,
  siteId: string | null,
  sites: SitioFoto[],
): { siteName: string | null; siteId: string | null; distanceM: number | null } {
  if (lat == null || lng == null || !sites.length) return { siteName: null, siteId: null, distanceM: null };
  let sitio = siteId ? sites.find((s) => s.id === siteId) : undefined;
  if (!sitio) {
    let mejor = Infinity;
    for (const s of sites) {
      const d = distanciaAGeocerca(lat, lng, s);
      if (d < mejor) { mejor = d; sitio = s; }
    }
  }
  if (!sitio) return { siteName: null, siteId: null, distanceM: null };
  return { siteName: sitio.name, siteId: sitio.id, distanceM: Math.round(distanciaAGeocerca(lat, lng, sitio)) };
}

/** Lo que hace falta de un fichaje para saber en qué turno cayó una excepción. */
export type EntradaTurno = {
  id: string;
  employee_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_site_id: string | null;
};

/**
 * El sitio de una excepción es el del fichaje en cuyo turno ocurrió: por `time_entry_id` si
 * lo trae (salir/volver lo graban), y si no, el fichaje de esa persona abierto en ese momento
 * (clock_in_at ≤ at ≤ clock_out_at, o aún abierto). No "el último fichaje": una excepción de
 * ayer no debe medirse contra el sitio de hoy.
 */
export function sitioDeExcepcion(
  e: { employee_id: string; time_entry_id: string | null },
  at: string,
  entradas: EntradaTurno[],
): string | null {
  const porId = e.time_entry_id ? entradas.find((x) => x.id === e.time_entry_id) : undefined;
  if (porId) return porId.clock_in_site_id;
  const t = Date.parse(at);
  const enTurno = entradas.find(
    (x) => x.employee_id === e.employee_id && Date.parse(x.clock_in_at) <= t && (x.clock_out_at == null || t <= Date.parse(x.clock_out_at)),
  );
  return enTurno?.clock_in_site_id ?? null;
}

/**
 * Filas → fotos, ordenadas por hora. `entradas` son los fichajes que sirven para situar las
 * excepciones en su turno (los del día y los que apunten sus `time_entry_id`).
 */
export function armarFotos(input: {
  punches: FilaFichaje[];
  excs: FilaExcepcion[];
  sites: SitioFoto[];
  entradas: EntradaTurno[];
  nombre: Map<string, string>;
}): FotoCruda[] {
  const { punches, excs, sites, entradas, nombre } = input;
  const raw: FotoCruda[] = [];
  for (const p of punches) {
    const who = nombre.get(p.employee_id) ?? "—";
    if (p.clock_in_photo_path)
      raw.push({
        path: p.clock_in_photo_path, who, at: p.clock_in_at, kind: "in",
        offSite: p.clock_in_in_radius === false, note: null,
        lat: p.clock_in_lat, lng: p.clock_in_lng,
        ...ubicar(p.clock_in_lat, p.clock_in_lng, p.clock_in_site_id, sites),
      });
    if (p.clock_out_photo_path)
      raw.push({
        path: p.clock_out_photo_path, who, at: p.clock_out_at ?? p.clock_in_at, kind: "out",
        offSite: p.clock_out_in_radius === false, note: null,
        lat: p.clock_out_lat, lng: p.clock_out_lng,
        ...ubicar(p.clock_out_lat, p.clock_out_lng, p.clock_out_site_id, sites),
      });
  }
  for (const e of excs) {
    const who = nombre.get(e.employee_id) ?? "—";
    const why = e.note || e.reason || e.type || null;
    if (e.photo_path) {
      const at = e.left_at ?? e.created_at;
      const siteId = sitioDeExcepcion(e, at, entradas);
      raw.push({
        path: e.photo_path, who, at, kind: "left", offSite: null, note: why,
        lat: e.latitude, lng: e.longitude, ...ubicar(e.latitude, e.longitude, siteId, sites),
      });
    }
    if (e.returned_photo_path) {
      const at = e.returned_at ?? e.created_at;
      const siteId = sitioDeExcepcion(e, at, entradas);
      raw.push({
        path: e.returned_photo_path, who, at, kind: "back", offSite: null, note: why,
        lat: e.returned_lat, lng: e.returned_lng, ...ubicar(e.returned_lat, e.returned_lng, siteId, sites),
      });
    }
  }
  raw.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return raw;
}

/** "35 m" · "1.2 km" (en) · "1,2 km" (es). Bajo un kilómetro, metros enteros. */
export function fmtDistancia(m: number, lang: "en" | "es"): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = (m / 1000).toFixed(1);
  return `${lang === "es" ? km.replace(".", ",") : km} km`;
}

/** Enlace a Google Maps con el punto: sin mapa embebido, sin API, sin llave. */
export function enlaceMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
