import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigDeTracksolid, FetchFn } from "./api";
import { camionesDelDia } from "./camion-del-dia";
import { leeCamionesDelDia } from "./camion-del-dia-servicio";
import { historialDeCamiones, type AlmacenDeHistorial } from "./historial";
import { rastroParaElMapa, type RastroDeCamionEnLaRed } from "./rastro-en-mapa";
import type { AlmacenDeToken } from "./token";

// ============================================================
// Los rastros de camión de UN día para el mapa en vivo (D-NEXT). Solo servidor, con la llave de servicio.
//
// Qué camión llevó cada chofer ese día lo dice la misma regla de siempre (`camionesDelDia`: el del día; si no, el
// habitual). El rastro sale de `historialDeCamiones` (D-907): de la base (`truck_track_days`) si está guardado, y de
// TrackSolid si no — un día terminado se pide UNA vez; el de hoy, cuando lo guardado tiene más de 3 minutos.
//
// A TrackSolid no se le pregunta por cada persona que mira ni por cada refresco: hay UNA copia compartida. Dos pisos,
// como las posiciones (D-900): la base, que comparten todas las instancias, y la memoria de la instancia, que además
// junta en una sola las peticiones que llegan a la vez. Si la base no pudiera guardar (sin la 264), la memoria aguanta
// los 3 minutos enteros.
//
// No lanza por culpa de TrackSolid: el rastro que no se pudo leer simplemente no sale, y la pantalla dibuja el del
// teléfono. Solo lanza si no se puede leer qué camión lleva cada chofer.
// ============================================================

/** Cada cuánto se vuelve a pedir a TrackSolid el rastro de HOY de un camión, como muy seguido. */
export const REFRESCO_DEL_RASTRO_MS = 3 * 60_000;
/** Lo que la memoria de la instancia da por bueno sin mirar la base. */
export const MEMORIA_DEL_RASTRO_MS = 30_000;

export type RastrosDelDia = { rastros: RastroDeCamionEnLaRed[]; /** Camiones cuyo rastro no se pudo leer ahora. */ pendientes: number };
type Apunte = { en: number; vale: number; valor: RastrosDelDia };
export type MemoriaDeRastros = { leidos: Map<string, Apunte>; enCurso: Map<string, Promise<RastrosDelDia>> };
const memoriaDeLaInstancia: MemoriaDeRastros = { leidos: new Map(), enCurso: new Map() };

export type DepsDeRastros = {
  db: SupabaseClient;
  config: ConfigDeTracksolid;
  almacen: AlmacenDeToken;
  historial: AlmacenDeHistorial | null;
  fetch: FetchFn;
  zona: string;
  ahora?: () => number;
  memoria?: MemoriaDeRastros;
};

async function lee(deps: DepsDeRastros, fecha: string): Promise<{ valor: RastrosDelDia; conCache: boolean }> {
  const delDia = await leeCamionesDelDia(deps.db, fecha);
  const nombreDe = new Map(delDia.habituales.map((h) => [h.imei, h.device_name]));
  const pedidos = [...camionesDelDia(delDia.habituales, delDia.delDia)].flatMap(([driverId, c]) => (c.imei ? [{ driverId, imei: c.imei, fecha }] : []));
  if (!pedidos.length) return { valor: { rastros: [], pendientes: 0 }, conCache: true };
  const h = await historialDeCamiones(
    { config: deps.config, almacen: deps.almacen, historial: deps.historial, fetch: deps.fetch, ahora: deps.ahora },
    pedidos, { zona: deps.zona, refrescoDeHoyMs: REFRESCO_DEL_RASTRO_MS, aceptaViejo: true },
  );
  const rastros = pedidos.flatMap((p) => {
    const puntos = h.dias.get(`${p.imei}|${fecha}`);
    const r = puntos ? rastroParaElMapa(puntos) : null;
    return r ? [{ driverId: p.driverId, imei: p.imei, truck: nombreDe.get(p.imei) || p.imei, ...r }] : [];
  });
  return { valor: { rastros, pendientes: h.pendientes }, conCache: h.conCache };
}

/** Los rastros de camión de ese día, uno por chofer que llevó camión con rastreador y cuyo rastro sirve. */
export async function rastrosDelDia(deps: DepsDeRastros, fecha: string): Promise<RastrosDelDia> {
  const ahora = deps.ahora ?? Date.now, memoria = deps.memoria ?? memoriaDeLaInstancia;
  const tengo = memoria.leidos.get(fecha);
  if (tengo && ahora() - tengo.en < tengo.vale) return tengo.valor;
  const yaVa = memoria.enCurso.get(fecha);
  if (yaVa) return yaVa;
  const promesa = (async () => {
    try {
      const { valor, conCache } = await lee(deps, fecha);
      for (const [k, a] of memoria.leidos) if (ahora() - a.en >= a.vale) memoria.leidos.delete(k);
      memoria.leidos.set(fecha, { en: ahora(), vale: conCache ? MEMORIA_DEL_RASTRO_MS : REFRESCO_DEL_RASTRO_MS, valor });
      return valor;
    } finally {
      memoria.enCurso.delete(fecha);
    }
  })();
  memoria.enCurso.set(fecha, promesa);
  return promesa;
}
