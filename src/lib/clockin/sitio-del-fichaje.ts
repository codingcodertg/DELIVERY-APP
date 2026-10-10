// ¿En qué sitio de la empresa está este fichaje? Y, si no se pudo preguntar, DECIRLO.
//
// Esto vivía dos veces dentro de `app/timetracker/clock-in/actions/clock.ts` —una en la entrada y
// otra en la salida—, copiado línea a línea y con el `error` del SELECT descartado en las dos:
//
//     const { data: sites } = await supabase.from("job_sites")...
//     const siteId = firstMatch(input.lat, input.lng, (sites ?? []) as GeoSite[]);
//     const onSite = !!siteId || DEV_BYPASS_GEOFENCE;
//
// Si ese SELECT fallaba —RLS, un timeout, PostgREST—, `sites` era `null`, `firstMatch` no encontraba
// nada y `onSite` salía **`false`**: exactamente el mismo valor que si la persona estuviera fuera de
// toda geocerca. Con ese `false` se le insertaba una excepción `out_of_radius` y salía un aviso a los
// gerentes; el propio fichero llama a eso «the classic fraud signal». O sea que un fallo de lectura
// escribía contra una persona una fila byte a byte idéntica a la de un fraude real, y después nadie
// —ni el gerente ni el empleado— podía distinguir las dos (hallazgo C-3 de la auditoría del
// 2026-10-09, `docs/AUDIT-2026-10-09.md`).
//
// Esta función devuelve TRES estados, no dos: en el sitio, fuera, y **no se pudo medir**. Quien la
// llama sigue decidiendo qué hace con el tercero, pero ya no puede confundirlo con «fuera» por
// omisión: para tratarlo como fuera tendría que escribirlo.

import { firstMatch, type GeoSite } from "./geofence";

type Respuesta<T> = PromiseLike<{ data: T | null; error: ErrorDeLaBase | null }>;
type ErrorDeLaBase = { message?: string | null } | null;

/** Lo mínimo del cliente de Supabase que usa esto: leer `job_sites`. Declarado aquí —como
 * `ClienteDeCandados` en `lib/rutas-bloqueadas.ts`— para poder probar la función con una base falsa
 * y, sobre todo, con una base que FALLA, que es el caso que esto existe para cubrir. */
export interface ClienteDeSitios {
  from(tabla: string): {
    select(columnas: string): {
      eq(col: string, v: unknown): { eq(col: string, v: unknown): Respuesta<unknown[]> };
    };
  };
}

export type SitioDelFichaje =
  /** Se pudo preguntar. `siteId` es el sitio donde está, o `null` si no está en ninguno. */
  | { medido: true; siteId: string | null; onSite: boolean }
  /** NO se pudo preguntar. No es «fuera»: es que no se sabe, y no se sabrá escribiendo un `false`. */
  | { medido: false; detalle: string };

/** Las columnas que necesita la geocerca. Una sola copia: la entrada y la salida pedían la misma lista. */
export const COLUMNAS_DE_GEOCERCA = "id, latitude, longitude, radius_meters, boundary, padding_meters";

export async function sitioDelFichaje(
  supabase: ClienteDeSitios,
  companyId: string,
  lat: number,
  lng: number,
  /** Solo desarrollo local (`DEV_BYPASS_GEOFENCE` en quien llama): cualquier punto cuenta como «en el sitio». */
  bypass = false,
): Promise<SitioDelFichaje> {
  const { data, error } = await supabase
    .from("job_sites")
    .select(COLUMNAS_DE_GEOCERCA)
    .eq("company_id", companyId)
    .eq("active", true);
  // `data` nulo SIN error también es no haber medido. Lo que no puede volver a pasar es que un
  // `null` se lea como lista vacía: una lista vacía es una respuesta («esta empresa no tiene
  // sitios»), y un `null` es la ausencia de respuesta.
  if (error || !data) {
    return { medido: false, detalle: error?.message?.trim() || "job_sites no devolvió filas ni error" };
  }
  // El bypass se aplica solo sobre una lectura que SÍ se hizo. Antes tapaba también el fallo
  // —`!!siteId || DEV_BYPASS_GEOFENCE`—, así que en local un SELECT roto se veía como «en el sitio»
  // y nadie se enteraba de que estaba roto. En producción no cambia nada: el bypass no puede
  // activarse en un build de producción (doble guarda en quien lo pasa).
  const siteId = firstMatch(lat, lng, data as GeoSite[]);
  return { medido: true, siteId, onSite: !!siteId || bypass };
}
