/* ---- A qué hora «sale» la medida de una ruta (D-602, 2026-10-19) ----
 * Ernesto (chofer): «Why does ETA say 8 to orders that havent been done yet?». A las 12:40, con 11 paradas hechas, la
 * parada 12 (pendiente) decía 8:23: la medida de la ruta siempre arrancaba de la base a las 08:00 (`DAY_START_MIN`),
 * aunque fueran las doce y el camión llevara horas fuera. Las paradas HECHAS ya no están en la lista que se mide (solo
 * se miden las pendientes), así que la primera pendiente «salía» a las 08:00 más el trayecto desde la base.
 *
 * Regla: la medida de HOY no puede salir antes de la hora que es. Si ya pasaron las 08:00, sale AHORA; si aún no son las
 * 08:00, a las 08:00 como siempre. Otro día (mañana, o uno pasado que se revisa) no tiene «ahora»: las 08:00.
 *
 * Lo que sigue sin ser exacto, y se dice: el camión «sale» de la base, no de donde está (no se usa el GPS), y la hora se
 * fija cuando se mide (al cambiar la lista: cada parada hecha la vuelve a medir), no corre sola con el reloj. */

export const SALIDA_MIN = 8 * 60; // 08:00, la misma `DAY_START_MIN` del Gestor y `SALIDA_POR_DEFECTO_MIN` de optimizar.

/** `fecha` es la del día que se mide (yyyy-mm-dd); `ahora`, el reloj de quien mide (hora local). Minutos desde la medianoche. */
export function salidaDeLaMedida(fecha: string, ahora: Date = new Date(), salidaMin: number = SALIDA_MIN): number {
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  if (fecha !== hoy) return salidaMin;
  const minutosDeAhora = ahora.getHours() * 60 + ahora.getMinutes();
  return Math.max(salidaMin, minutosDeAhora);
}
