/**
 * Continuidad del cronómetro a través de una recarga, un cierre o un reinicio (D-195).
 *
 * Lógica pura, sin React ni red, para que la compartan la pantalla del cronómetro
 * (`(timetracker)/page.tsx`) y el cron que cierra huérfanas, y quede probada con datos
 * sintéticos. Tres cosas viven aquí:
 *
 * 1. **La regla de huérfana.** El tick escribe `end_ms` cada diez segundos mientras corre; una
 *    sesión `is_live` cuyo último latido es de hace más de `LATIDO_MAX_MS` perdió a su cliente
 *    (máquina apagada, navegador cerrado, app caída) y nadie la va a parar. Se cierra **en su
 *    último latido**, no ahora: lo que grabó es lo que se le paga, y las horas con la máquina
 *    apagada no son suyas. Es la regla de siempre; solo el umbral cambió de 5 a 15 min, para que
 *    un cierre corto (reinicio, actualización, cambio de red) no corte la sesión. Más no: el
 *    freno es lo que impidió repetir las 25,75 h (D-098) y las 10,42 h fantasma.
 * 2. **La marca de reanudación.** Antes de descargar la página (recarga del banner, `pagehide`),
 *    el cliente que ESTÁ conduciendo la sesión deja `tt_resume_<usuario>` con el id y el
 *    instante. Al volver, si la confirmación contra el servidor falla por red, esa marca es la
 *    prueba de que la sesión era de este cliente hace un momento: se sigue contando y grabando
 *    en vez de entrar en el modo "mirón" de D-096, que se reserva para la miga sin marca.
 * 3. **El backoff** de los reintentos de confirmación.
 */

/** Sin latido durante más de esto, la sesión viva es huérfana. UNA constante para todos. */
export const LATIDO_MAX_MS = 15 * 60_000;
/** Una marca de reanudación más vieja que esto no vale: se cae al comportamiento de D-096. */
export const RESUME_MAX_MS = LATIDO_MAX_MS;

export type SesionViva = { id: string; startMs: number | null; endMs: number | null };

/** El último instante que la sesión grabó: el latido del tick, o el arranque si nunca latió. */
export function ultimoLatidoDe(s: Pick<SesionViva, "startMs" | "endMs">): number {
  return s.endMs ?? s.startMs ?? 0;
}

/** ¿Perdió a su cliente? Misma comparación que tenía la página, con el umbral compartido. */
export function esHuerfana(s: Pick<SesionViva, "startMs" | "endMs">, now: number, maxMs: number = LATIDO_MAX_MS): boolean {
  const latido = ultimoLatidoDe(s);
  return latido > 0 && now - latido > maxMs;
}

/**
 * El cierre de una huérfana: en su último latido, con la duración que va del arranque a ese
 * latido. **Misma aritmética que tenía `page.tsx`** (no descuenta pausas: es lo que había, y
 * cambiarlo es tocar lo que se paga). Sin `startMs`, la duración es cero.
 */
export function cierreHuerfana(s: Pick<SesionViva, "startMs" | "endMs">): { isLive: false; endMs: number; durationSeconds: number } {
  const latido = ultimoLatidoDe(s);
  const real = Math.max(0, Math.floor((latido - (s.startMs ?? latido)) / 1000));
  return { isLive: false, endMs: latido, durationSeconds: real };
}

/** Las huérfanas de un lote de sesiones vivas, cada una con su cierre. Para el cron. */
export function huerfanasDe<T extends SesionViva>(vivas: T[], now: number, maxMs: number = LATIDO_MAX_MS): { sesion: T; cierre: ReturnType<typeof cierreHuerfana> }[] {
  return vivas.filter((s) => esHuerfana(s, now, maxMs)).map((s) => ({ sesion: s, cierre: cierreHuerfana(s) }));
}

// ---- Marca de reanudación ---------------------------------------------------------------

export type ResumeMark = { sessionId: string; at: number };

export const resumeKey = (userId: string) => `tt_resume_${userId}`;

/** Lee la marca con tolerancia: JSON roto, forma rara o más vieja que `maxMs` → null. */
export function parseResumeMark(raw: string | null, now: number, maxMs: number = RESUME_MAX_MS): ResumeMark | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ResumeMark> | null;
    if (!v || typeof v.sessionId !== "string" || !v.sessionId || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    if (now - v.at > maxMs || v.at > now + 60_000) return null; // del futuro tampoco (reloj cambiado)
    return { sessionId: v.sessionId, at: v.at };
  } catch { return null; }
}

/** ¿La marca cubre ESTA sesión? Una marca de otra sesión no autoriza a conducir esta. */
export function markCovers(mark: ResumeMark | null, sessionId: string | null | undefined): boolean {
  return !!mark && !!sessionId && mark.sessionId === sessionId;
}

// ---- Backoff ----------------------------------------------------------------------------

/** 2 s, 4 s, 8 s, 16 s, 30 s, 30 s… El intento 0 es el primero después del fallo inicial. */
export function backoffMs(attempt: number, baseMs = 2_000, capMs = 30_000): number {
  const a = Math.max(0, Math.floor(attempt));
  return Math.min(capMs, baseMs * 2 ** a);
}
