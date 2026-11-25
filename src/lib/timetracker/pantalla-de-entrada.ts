/**
 * La pantalla por defecto de Time Tracker (2026-11-25, pedido del dueño: «for admin, make it default payroll view instead
 * of track time»). `/timetracker` sigue siendo la ruta de «Registrar tiempo»; el admin que entra sin marca cae en Nómina.
 * La marca es `?ver=track`: el enlace de la pestaña «Registrar tiempo» la lleva para el admin, así que esa pestaña
 * sigue abriendo Registrar tiempo. Puro y sin React.
 */

/** La ruta de Registrar tiempo (la raíz del módulo). Sin marca de nada: es lo que enlazan el hub, el escritorio y los marcadores. */
export const RUTA_DE_TRACK_TIME = "/timetracker";
/** La pantalla por defecto del admin. */
export const RUTA_DE_PAYROLL = "/timetracker/payroll";
/** El nombre del parámetro y su único valor que cuenta como marca. */
export const PARAMETRO_DE_VER = "ver";
export const VALOR_DE_TRACK = "track";

/**
 * ¿A dónde va quien entra en `/timetracker`? Admin sin marca → «payroll». Admin con `?ver=track` → «track». Quien no
 * es admin va siempre a «track». Cualquier otro valor de `ver` (vacío, otra palabra, una lista) cuenta como sin marca.
 */
export function entradaDeTimeTracker(o: { esAdmin: boolean; ver: string | string[] | null | undefined }): "payroll" | "track" {
  if (!o.esAdmin) return "track";
  return o.ver === VALOR_DE_TRACK ? "track" : "payroll";
}

/** El enlace de «Registrar tiempo»: para el admin, con la marca (así la pestaña no le manda a Nómina); para los demás, la ruta de siempre. */
export function hrefDeTrackTime(esAdmin: boolean): string {
  return esAdmin ? `${RUTA_DE_TRACK_TIME}?${PARAMETRO_DE_VER}=${VALOR_DE_TRACK}` : RUTA_DE_TRACK_TIME;
}
