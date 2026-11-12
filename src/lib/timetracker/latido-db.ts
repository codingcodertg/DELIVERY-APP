/**
 * Cada cuánto el cronómetro GUARDA en la base (D-1004, aviso de Supabase «running out of Disk IO Budget», 12 nov).
 *
 * El reloj sigue contando cada segundo en el aparato, y cada 10 s refresca su estado local (localStorage, sin base:
 * reanudar tras recargar, D-916/D-197). Lo que baja es el UPDATE a `timetracker.sessions`: antes cada 10 s por persona
 * (~236 000 escrituras, el mayor gasto de disco de la base); ahora como mucho cada 120 s. No se pierde tiempo: parar,
 * pausar/descanso, cambiar de fila y cerrar la página (`pagehide` + sendBeacon) siguen guardando al instante, y el
 * cron solo cierra una sesión tras 15 min sin latido (LATIDO_MAX_MS), muy por encima de 120 s.
 */
export const LATIDO_DB_MS = 120_000;

/** ¿Toca escribir en la base? Sí la primera vez (sin escritura previa) y cuando ya pasó el intervalo. */
export function tocaGuardarEnBase(ultimoMs: number | null, ahoraMs: number, cadaMs: number = LATIDO_DB_MS): boolean {
  if (ultimoMs === null) return true;
  if (ahoraMs < ultimoMs) return true; // el reloj del aparato retrocedió: mejor guardar que esperar
  return ahoraMs - ultimoMs >= cadaMs;
}
