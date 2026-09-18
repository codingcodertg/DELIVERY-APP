import type { Tramo } from "@/lib/route-engine";
import type { LatLng } from "./claves";

/**
 * Quién contesta cuánto se tarda de un sitio a otro (D-NEXT). Tres escalones, como hoy (D-008): Google, y si
 * falla o no hay llave, OSRM público; y si fallan los dos, una estimación en línea recta que se declara como
 * tal. **`fetch` llega inyectado**: en las pruebas es un doble, y ninguna llama a un servicio de verdad.
 *
 * Dos preguntas distintas, que se facturan distinto:
 *   · `matriz`  muchos orígenes × muchos destinos, SIN tráfico  → Google lo cobra por ELEMENTO (Essentials).
 *   · `tramo`   un origen → un destino saliendo a una hora, CON tráfico → por PETICIÓN (Pro).
 * Nunca se pide una matriz con tráfico: es lo que el diseño descartó por coste (§3.1).
 */

export type NombreDeProveedor = "google" | "osrm" | "estimado";

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string>;
}>;

export interface ProveedorDeTiempos {
  nombre: NombreDeProveedor;
  /** ¿Sabe de tráfico? Si no, no tiene sentido preguntarle por horas. */
  conTrafico: boolean;
  /** `resultado[i][j]` = de `origenes[i]` a `destinos[j]`; `null` donde no hay ruta. */
  matriz(origenes: readonly LatLng[], destinos: readonly LatLng[]): Promise<(Tramo | null)[][]>;
  /** `salidaISO` en el futuro (Google rechaza el pasado); sin ella, sin tráfico. */
  tramo(origen: LatLng, destino: LatLng, salidaISO?: string): Promise<Tramo | null>;
}

const METROS_POR_MILLA = 1609.344;
const aTramo = (segundos: number, metros: number): Tramo => ({ minutos: Math.round(segundos / 60), millas: Math.round((metros / METROS_POR_MILLA) * 100) / 100 });
const segundosDe = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/s$/, "")) || 0);

/** El tope de Google por petición de matriz: orígenes × destinos ≤ 625 (sin tráfico). */
export const MAX_ELEMENTOS_POR_PETICION = 625;

const URL_MATRIZ = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const URL_RUTA = "https://routes.googleapis.com/directions/v2:computeRoutes";
const waypoint = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

export function proveedorGoogle(apiKey: string, fetchFn: FetchFn): ProveedorDeTiempos {
  const cabeceras = (mascara: string) => ({ "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": mascara });
  return {
    nombre: "google",
    conTrafico: true,
    async matriz(origenes, destinos) {
      const r: (Tramo | null)[][] = origenes.map(() => destinos.map(() => null));
      if (!origenes.length || !destinos.length) return r;
      // Se trocea por filas para no pasar del tope de elementos por petición.
      const filasPorPeticion = Math.max(1, Math.floor(MAX_ELEMENTOS_POR_PETICION / destinos.length));
      for (let i0 = 0; i0 < origenes.length; i0 += filasPorPeticion) {
        const trozo = origenes.slice(i0, i0 + filasPorPeticion);
        const res = await fetchFn(URL_MATRIZ, {
          method: "POST", headers: cabeceras("originIndex,destinationIndex,duration,distanceMeters,condition"),
          body: JSON.stringify({ origins: trozo.map(waypoint), destinations: destinos.map(waypoint), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
        });
        if (!res.ok) throw new Error(`google matrix ${res.status}`);
        for (const e of (await res.json()) as { originIndex?: number; destinationIndex?: number; duration?: unknown; distanceMeters?: number; condition?: string }[]) {
          if (e.condition !== "ROUTE_EXISTS") continue;
          r[i0 + (e.originIndex ?? 0)][e.destinationIndex ?? 0] = aTramo(segundosDe(e.duration), e.distanceMeters ?? 0);
        }
      }
      return r;
    },
    async tramo(origen, destino, salidaISO) {
      const res = await fetchFn(URL_RUTA, {
        method: "POST", headers: cabeceras("routes.duration,routes.distanceMeters"),
        body: JSON.stringify({
          origin: waypoint(origen).waypoint, destination: waypoint(destino).waypoint, travelMode: "DRIVE",
          routingPreference: salidaISO ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE", ...(salidaISO ? { departureTime: salidaISO } : {}),
        }),
      });
      if (!res.ok) throw new Error(`google route ${res.status}`);
      const ruta = ((await res.json()) as { routes?: { duration?: unknown; distanceMeters?: number }[] }).routes?.[0];
      return ruta ? aTramo(segundosDe(ruta.duration), ruta.distanceMeters ?? 0) : null;
    },
  };
}

const OSRM = "https://router.project-osrm.org";
const coords = (ps: readonly LatLng[]) => ps.map((p) => `${p.lng},${p.lat}`).join(";");

/** El respaldo de hoy (D-008): gratis, SIN tráfico —en hora punta sale optimista— y sin garantía de servicio. */
export function proveedorOSRM(fetchFn: FetchFn): ProveedorDeTiempos {
  return {
    nombre: "osrm",
    conTrafico: false,
    async matriz(origenes, destinos) {
      if (!origenes.length || !destinos.length) return origenes.map(() => []);
      const todos = [...origenes, ...destinos];
      const fuentes = origenes.map((_, i) => i).join(";"), metas = destinos.map((_, j) => origenes.length + j).join(";");
      const res = await fetchFn(`${OSRM}/table/v1/driving/${coords(todos)}?annotations=duration,distance&sources=${fuentes}&destinations=${metas}`);
      if (!res.ok) throw new Error(`osrm table ${res.status}`);
      const b = (await res.json()) as { durations?: (number | null)[][]; distances?: (number | null)[][] };
      return origenes.map((_, i) => destinos.map((_, j) => {
        const s = b.durations?.[i]?.[j], m = b.distances?.[i]?.[j];
        return s == null || m == null ? null : aTramo(s, m);
      }));
    },
    async tramo(origen, destino) {
      const res = await fetchFn(`${OSRM}/route/v1/driving/${coords([origen, destino])}?overview=false`);
      if (!res.ok) throw new Error(`osrm route ${res.status}`);
      const ruta = ((await res.json()) as { routes?: { duration: number; distance: number }[] }).routes?.[0];
      return ruta ? aTramo(ruta.duration, ruta.distance) : null;
    },
  };
}

/** Millas en línea recta. */
export function millasEnLineaRecta(a: LatLng, b: LatLng): number {
  const R = 3958.8, rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lo que una carretera alarga la línea recta, y a qué velocidad media se va. Valores gruesos a propósito:
 *  esto no es una medida, es para que el despachador no se quede sin nada si fallan los dos servicios. */
export const FACTOR_DE_RODEO = 1.3;
export const MILLAS_POR_HORA_ESTIMADAS = 30;

/** El último escalón: no llama a nadie. Un plan hecho con esto se marca «estimado» y lo dice. */
export function proveedorEstimado(): ProveedorDeTiempos {
  const uno = (a: LatLng, b: LatLng): Tramo => {
    const millas = Math.round(millasEnLineaRecta(a, b) * FACTOR_DE_RODEO * 100) / 100;
    return { minutos: Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60), millas };
  };
  return {
    nombre: "estimado",
    conTrafico: false,
    async matriz(origenes, destinos) { return origenes.map((o) => destinos.map((d) => uno(o, d))); },
    async tramo(origen, destino) { return uno(origen, destino); },
  };
}
