import { textoDeClave, type ClaveDeTiempo } from "./claves";
import type { CacheDeTiempos, FilaDeCache } from "./tiempos";
import type { NombreDeProveedor } from "./proveedores";

/**
 * La caché de tiempos de viaje sobre `public.travel_time_cache` (D-NEXT, migración 132).
 *
 * **Solo para el servidor, con la llave de servicio.** La tabla no tiene ninguna política: ningún navegador
 * la lee ni la escribe. No guarda nada de nadie —dos coordenadas redondeadas y una duración—, pero quien
 * pudiera escribirla podría falsear los tiempos con los que se planifica, y quien pudiera llenarla, gastar.
 *
 * Recibe el cliente ya hecho en vez de crearlo: así este fichero no importa la llave de servicio y se prueba
 * con un doble.
 */

type Fila = { origin_key: string; dest_key: string; weekday: number; block: number; traffic: boolean; minutes: number; miles: number; provider: string; fetched_at: string };

/** Lo mínimo de supabase-js que se usa aquí. */
export interface ClienteDeCache {
  from(tabla: "travel_time_cache"): {
    select(columnas: string): { in(col: string, valores: string[]): { in(col: string, valores: string[]): PromiseLike<{ data: Fila[] | null; error: { message: string } | null }> } };
    upsert(filas: Fila[], opciones: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}
export interface ClienteDeGasto {
  cuentaDePago(desdeISO: string, conTrafico: boolean): Promise<number>;
}

const COLUMNAS = "origin_key, dest_key, weekday, block, traffic, minutes, miles, provider, fetched_at";
const aFila = (f: FilaDeCache): Fila => ({
  origin_key: f.origen, dest_key: f.destino, weekday: f.dia, block: f.bloque, traffic: f.trafico,
  minutes: f.minutos, miles: f.millas, provider: f.proveedor, fetched_at: f.pedidoEl,
});
const deFila = (r: Fila): FilaDeCache => ({
  origen: r.origin_key, destino: r.dest_key, dia: r.weekday, bloque: r.block, trafico: r.traffic,
  minutos: r.minutes, millas: Number(r.miles), proveedor: r.provider as NombreDeProveedor, pedidoEl: r.fetched_at,
});

export function cacheEnSupabase(cliente: ClienteDeCache, gasto: ClienteDeGasto): CacheDeTiempos {
  return {
    async lee(claves: readonly ClaveDeTiempo[]) {
      if (!claves.length) return [];
      // Se pide por orígenes y destinos y se casa aquí: PostgREST no filtra por una lista de quíntuplas. Trae
      // de más (otros días y bloques de los mismos pares), que son filas pequeñas; lo que no casa se descarta.
      const origenes = [...new Set(claves.map((k) => k.origen))], destinos = [...new Set(claves.map((k) => k.destino))];
      const { data, error } = await cliente.from("travel_time_cache").select(COLUMNAS).in("origin_key", origenes).in("dest_key", destinos);
      // Una caché que falla no es un error del plan: se sigue como si estuviera vacía, y se pregunta de nuevo.
      if (error || !data) return [];
      const pedidas = new Set(claves.map(textoDeClave));
      return data.map(deFila).filter((f) => pedidas.has(textoDeClave(f)));
    },
    async escribe(filas: readonly FilaDeCache[]) {
      if (!filas.length) return;
      await cliente.from("travel_time_cache").upsert(filas.map(aFila), { onConflict: "origin_key,dest_key,weekday,block,traffic" });
    },
    async gastoDesde(desdeISO: string) {
      const [elementos, tramos] = await Promise.all([gasto.cuentaDePago(desdeISO, false), gasto.cuentaDePago(desdeISO, true)]);
      return { elementos, tramos };
    },
  };
}
