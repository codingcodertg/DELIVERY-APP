import { centralWallToUtc } from "@/lib/clockin/tz";
import { todasLasFilas } from "@/lib/puntualidad";
import { shiftDateISO } from "@/lib/utils";
import type { Fix } from "@/lib/track-history";

// ============================================================
// Las posiciones del TELÉFONO de cada chofer en un día (`driver_locations`), ENTERAS (D-909).
//
// Las dos pantallas que dibujan el recorrido del día (el Recorrido y el Gestor de Rutas) lo leían en UNA petición con
// `.limit(20 000 × choferes)`. PostgREST no da más de 1.000 filas por petición, pida uno lo que pida, así que llegaban
// las primeras 1.000 del día ENTRE TODOS los choferes y la línea de cada uno se acababa a media mañana. Medido el
// 2026-11-06: 3.415 posiciones ese día, 1.000 leídas; a Ernesto y a Máximo se les cortaba la línea a las 10:07 (y la
// cabecera decía «1003 posiciones»: las 1.000 y las tres que llegaron en vivo).
//
// Aquí se lee chofer por chofer y de 1.000 en 1.000 hasta el final (`todasLasFilas`). Quién ve qué lo sigue diciendo
// la base (043 + 121): a quien no puede ver a un chofer no le llegan filas.
//
// Sin React (lo usan una página y un hook).
// ============================================================

/** Como mucho, por chofer y día: a 10 m / 5 s (D-831) un día largo son ~6.000. */
export const FIXES_POR_DIA = 20_000;

type Fila = { driver_id: string; lat: number; lng: number; accuracy_m: number | null; recorded_at: string };
type Pagina = PromiseLike<{ data: Fila[] | null; error: { message: string } | null }>;
/** Lo justo del cliente de Supabase, para poder pasar uno de mentira en las pruebas. */
export type BaseDePosiciones = { from: (tabla: string) => any };

/** Dónde empieza y acaba (ISO, UTC) el día de la empresa, con su cambio de horario (G-24, D-198). */
export function limitesDelDiaDeTrabajo(fecha: string): { from: string; to: string } {
  return { from: centralWallToUtc(`${fecha}T00:00`), to: centralWallToUtc(`${shiftDateISO(fecha, 1)}T00:00`) };
}

export type RecorridosDelTelefono = {
  porId: Record<string, Fix[]>;
  error: string | null;
  /** Algún chofer pasó del tope: su línea está incompleta. */
  cortado: boolean;
};

export async function leeRecorridoDelTelefono(db: BaseDePosiciones, ids: readonly string[], fecha: string): Promise<RecorridosDelTelefono> {
  const { from, to } = limitesDelDiaDeTrabajo(fecha);
  const out: RecorridosDelTelefono = { porId: {}, error: null, cortado: false };
  await Promise.all(ids.map(async (id) => {
    const r = await todasLasFilas<Fila>((a, b) =>
      db.from("driver_locations").select("driver_id, lat, lng, accuracy_m, recorded_at").eq("driver_id", id)
        .gte("recorded_at", from).lt("recorded_at", to)
        // El `id` desempata dos posiciones con la misma hora: sin él, una fila podría salir en dos páginas o en ninguna.
        .order("recorded_at", { ascending: true }).order("id", { ascending: true }).range(a, b) as Pagina, FIXES_POR_DIA);
    out.porId[id] = r.filas.map((f) => ({ lat: f.lat, lng: f.lng, accuracy_m: f.accuracy_m, at: f.recorded_at }));
    if (r.error) out.error = r.error;
    if (r.cortado) out.cortado = true;
  }));
  return out;
}
