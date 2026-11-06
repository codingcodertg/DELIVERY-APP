import type { SupabaseClient } from "@supabase/supabase-js";
import { instanteLocalISO } from "@/lib/route-times/tiempos";
import type { PuntoDeRastro } from "@/lib/reportes-choferes/rastro";
import { ErrorDeTracksolid, llamaTracksolid, type ConfigDeTracksolid, type FetchFn } from "./api";
import { tokenDeTracksolid, type AlmacenDeToken } from "./token";

// ============================================================
// Por dónde anduvo cada camión: el HISTORIAL del rastreador (D-907, «Reportes de choferes»). Solo servidor.
//
// TrackSolid lo guarda y lo da con `jimi.device.track.list`: un rastreador por llamada, como mucho 7 días por
// llamada, y solo de los últimos 3 meses. Medido el 2026-11-06 con los dos camiones: un punto cada 10 s con el
// camión en marcha (unos 800–1.900 puntos por camión y día), la hora en UTC, y silencio con el motor apagado.
//
// Para no preguntar dos veces lo mismo —y para no perder lo de hace más de 3 meses— cada día de cada camión se
// guarda en la base (`truck_track_days`, migración 264) la primera vez que se pide. Un día ya terminado no se
// vuelve a pedir nunca; el de hoy se refresca si lo guardado tiene más de 10 minutos.
//
// Sin la 264 todo funciona igual, solo que se le pregunta a TrackSolid cada vez (con el tope de llamadas).
// Aquí solo se LEE de TrackSolid: nada de esto cambia nada en la cuenta.
// ============================================================

/** Lo que TrackSolid devuelve por punto (lo que se usa). */
export type PuntoCrudo = { lat?: number | string | null; lng?: number | string | null; gpsTime?: string | null; gpsSpeed?: number | string | null; posType?: number | string | null };

/** «2026-11-05 14:37:01» (UTC) → ms. */
export function horaDeJimi(texto: string | null | undefined): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec((texto ?? "").trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? t : null;
}
/** ms → «2026-11-05 14:37:01» (UTC), como lo pide Jimi. */
export const aHoraDeJimi = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** Un punto del historial. Solo los de GPS (`posType` 1): los de antena o wifi fallan por cientos de metros. */
export function puntoDesdeJimi(c: PuntoCrudo): PuntoDeRastro | null {
  const t = horaDeJimi(c.gpsTime), lat = Number(c.lat), lng = Number(c.lng);
  if (t == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (c.posType != null && String(c.posType) !== "1") return null;
  const kmh = Number(c.gpsSpeed);
  return { t, lat, lng, mph: Number.isFinite(kmh) ? Math.round(kmh * 0.621371 * 10) / 10 : null };
}

export const DIAS_POR_LLAMADA = 7;
/** TrackSolid solo guarda 3 meses; se deja un margen. */
export const DIAS_QUE_GUARDA_TRACKSOLID = 85;
export const REFRESCO_DE_HOY_MS = 10 * 60_000;

export type DepsDeHistorial = { config: ConfigDeTracksolid; almacen: AlmacenDeToken; fetch: FetchFn; ahora?: () => number; espera?: (ms: number) => Promise<void> };

/** UNA llamada: los puntos de un camión entre dos instantes (como mucho 7 días). `null` si ahora no hay token. */
export async function pideHistorial(deps: DepsDeHistorial, imei: string, desdeMs: number, hastaMs: number): Promise<PuntoDeRastro[] | null> {
  const ahora = deps.ahora ?? Date.now;
  const fin = Math.min(hastaMs, ahora() - 60_000);   // Jimi: el final tiene que ser anterior a ahora
  if (fin <= desdeMs) return [];
  const pide = (token: string) => llamaTracksolid<PuntoCrudo[]>(deps.config, {
    method: "jimi.device.track.list", access_token: token, imei, begin_time: aHoraDeJimi(desdeMs), end_time: aHoraDeJimi(fin),
  }, { fetch: deps.fetch, ahora: () => new Date(ahora()) });
  let token = await tokenDeTracksolid(deps);
  if (!token) return null;
  let crudos: PuntoCrudo[];
  try {
    crudos = await pide(token);
  } catch (e) {
    if (!(e instanceof ErrorDeTracksolid && e.esTokenInvalido)) throw e;
    await deps.almacen.guardaToken(null);
    token = await tokenDeTracksolid(deps);
    if (!token) return null;
    crudos = await pide(token);
  }
  return (Array.isArray(crudos) ? crudos : []).flatMap((c) => puntoDesdeJimi(c) ?? []).sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------------------------------------------
// Lo guardado en la base (264)
// ---------------------------------------------------------------------------------------------------------------

export type DiaDeCamion = { imei: string; fecha: string; puntos: PuntoDeRastro[]; completo: boolean; leidoEn: number };

export interface AlmacenDeHistorial {
  /** `null`: la base aún no tiene la 264 (o no se pudo leer): se sigue sin caché. */
  lee(imeis: readonly string[], desde: string, hasta: string): Promise<DiaDeCamion[] | null>;
  guarda(dias: readonly DiaDeCamion[]): Promise<void>;
}

type FilaDeDia = { imei: string; day: string; points: unknown; complete: boolean; fetched_at: string };

/** Compacto: `[segundos, lat, lng, mph]`. Un día de camión son ~1.500 puntos, unos 50 KB. */
export const aGuardar = (ps: readonly PuntoDeRastro[]): number[][] => ps.map((p) => [Math.round(p.t / 1000), Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6, p.mph ?? -1]);
export function deLoGuardado(crudo: unknown): PuntoDeRastro[] {
  if (!Array.isArray(crudo)) return [];
  return crudo.flatMap((f) => (Array.isArray(f) && f.length >= 3 && f.slice(0, 3).every((x) => typeof x === "number" && Number.isFinite(x))
    ? [{ t: (f[0] as number) * 1000, lat: f[1] as number, lng: f[2] as number, mph: typeof f[3] === "number" && f[3] >= 0 ? f[3] : null }] : []));
}

export function historialEnSupabase(db: SupabaseClient): AlmacenDeHistorial {
  return {
    async lee(imeis, desde, hasta) {
      if (!imeis.length) return [];
      const { data, error } = await db.from("truck_track_days").select("imei, day, points, complete, fetched_at").in("imei", [...imeis]).gte("day", desde).lte("day", hasta);
      if (error || !data) return null;
      return (data as FilaDeDia[]).map((f) => ({ imei: f.imei, fecha: String(f.day).slice(0, 10), puntos: deLoGuardado(f.points), completo: !!f.complete, leidoEn: Date.parse(f.fetched_at) }));
    },
    async guarda(dias) {
      if (!dias.length) return;
      await db.from("truck_track_days").upsert(dias.map((d) => ({
        imei: d.imei, day: d.fecha, points: aGuardar(d.puntos), point_count: d.puntos.length, complete: d.completo, fetched_at: new Date(d.leidoEn).toISOString(),
      })), { onConflict: "imei,day" });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Los días que hacen falta: de la base los que estén, de TrackSolid el resto
// ---------------------------------------------------------------------------------------------------------------

const DIA_MS = 86_400_000;
const sumaDias = (fecha: string, n: number): string => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

/** Dónde empieza y acaba (ms) un día LOCAL. */
export function limitesDelDia(fecha: string, zona: string): [number, number] | null {
  const a = Date.parse(instanteLocalISO(fecha, 0, zona) ?? ""), b = Date.parse(instanteLocalISO(sumaDias(fecha, 1), 0, zona) ?? "");
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

/** Las ventanas de hasta 7 días seguidos que cubren las fechas que faltan de un camión. */
export function ventanasDe(fechas: readonly string[]): { desde: string; hasta: string; fechas: string[] }[] {
  const out: { desde: string; hasta: string; fechas: string[] }[] = [];
  for (const f of [...new Set(fechas)].sort()) {
    const v = out[out.length - 1];
    if (v && f <= sumaDias(v.desde, DIAS_POR_LLAMADA - 1)) { v.hasta = f; v.fechas.push(f); } else out.push({ desde: f, hasta: f, fechas: [f] });
  }
  return out;
}

export type ResultadoDeHistorial = {
  /** Clave `imei|fecha`. Un día pedido que no está aquí no se pudo leer (ver `pendientes`). */
  dias: Map<string, PuntoDeRastro[]>;
  /** Días que se quedaron sin leer: por el tope de llamadas, porque TrackSolid falló, o por ser de hace más de 3 meses. */
  pendientes: number; llamadas: number; conCache: boolean;
};

/**
 * Los rastros de los camiones en los días pedidos. No lanza: lo que no se pueda leer se queda en `pendientes`, y quien
 * llama usa el teléfono para esos días.
 */
export async function historialDeCamiones(
  deps: DepsDeHistorial & { historial: AlmacenDeHistorial | null },
  pedidos: readonly { imei: string; fecha: string }[],
  opciones: {
    zona: string; maxLlamadas?: number;
    /** Cada cuánto se vuelve a pedir un día sin terminar (por defecto 10 min). El mapa en vivo pide menos (D-NEXT). */
    refrescoDeHoyMs?: number;
    /** Si TrackSolid no contesta, vale lo guardado aunque esté viejo (el mapa: mejor la línea de hace un rato que ninguna). */
    aceptaViejo?: boolean;
  },
): Promise<ResultadoDeHistorial> {
  const ahora = (deps.ahora ?? Date.now)(), max = opciones.maxLlamadas ?? 8;
  const dias = new Map<string, PuntoDeRastro[]>();
  const pedidas = [...new Set(pedidos.map((p) => `${p.imei}|${p.fecha}`))];
  if (!pedidas.length) return { dias, pendientes: 0, llamadas: 0, conCache: !!deps.historial };
  const fechas = pedidos.map((p) => p.fecha).sort(), imeis = [...new Set(pedidos.map((p) => p.imei))];

  let guardados: DiaDeCamion[] | null = null;
  try { guardados = deps.historial ? await deps.historial.lee(imeis, fechas[0], fechas[fechas.length - 1]) : null; } catch { guardados = null; }
  let llamadas = 0, pendientes = 0;
  const refresco = opciones.refrescoDeHoyMs ?? REFRESCO_DE_HOY_MS;
  const viejos = new Map<string, PuntoDeRastro[]>();
  for (const g of guardados ?? []) {
    if (g.completo || ahora - g.leidoEn < refresco) dias.set(`${g.imei}|${g.fecha}`, g.puntos);
    else viejos.set(`${g.imei}|${g.fecha}`, g.puntos);
  }
  /** Lo que no se pudo leer ahora: con `aceptaViejo`, lo guardado; siempre cuenta como pendiente. */
  const sinLeer = (imei: string, fs: readonly string[]) => {
    pendientes += fs.length;
    if (!opciones.aceptaViejo) return;
    for (const f of fs) { const v = viejos.get(`${imei}|${f}`); if (v) dias.set(`${imei}|${f}`, v); }
  };

  const faltan = pedidas.filter((k) => !dias.has(k));
  const hoyMenos = new Date(ahora - DIAS_QUE_GUARDA_TRACKSOLID * DIA_MS).toISOString().slice(0, 10);
  for (const imei of imeis) {
    const suyas = faltan.filter((k) => k.startsWith(`${imei}|`)).map((k) => k.slice(imei.length + 1));
    pendientes += suyas.filter((f) => f < hoyMenos).length;
    for (const v of ventanasDe(suyas.filter((f) => f >= hoyMenos))) {
      const a = limitesDelDia(v.desde, opciones.zona), b = limitesDelDia(v.hasta, opciones.zona);
      if (!a || !b) { pendientes += v.fechas.length; continue; }
      if (a[0] >= ahora) continue;                                    // días que aún no han empezado: sin rastro, y no es un fallo
      if (llamadas >= max) { sinLeer(imei, v.fechas); continue; }
      llamadas++;
      let puntos: PuntoDeRastro[] | null = null;
      try { puntos = await pideHistorial(deps, imei, a[0], b[1]); }
      catch (e) { console.warn("[tracksolid] no se pudo leer el historial:", e instanceof ErrorDeTracksolid ? e.codigo : "error"); }
      if (!puntos) { sinLeer(imei, v.fechas); continue; }
      const nuevos: DiaDeCamion[] = [];
      for (const f of v.fechas) {
        const lim = limitesDelDia(f, opciones.zona);
        if (!lim) continue;
        const delDia = puntos.filter((p) => p.t >= lim[0] && p.t < lim[1]);
        dias.set(`${imei}|${f}`, delDia);
        // Completo: el día local acabó hace más de una hora (el rastreador reenvía lo que le quedó sin mandar).
        nuevos.push({ imei, fecha: f, puntos: delDia, completo: ahora > lim[1] + 3_600_000, leidoEn: ahora });
      }
      if (deps.historial && guardados !== null) await deps.historial.guarda(nuevos).catch(() => { /* la próxima vez se vuelve a pedir */ });
    }
  }
  return { dias, pendientes, llamadas, conCache: !!deps.historial && guardados !== null };
}
