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

import { BUSINESS_TZ } from "@/lib/utils";

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

// ---- Reabrir tras un cierre del cron (D-197) ---------------------------------------------

/**
 * La marca que deja el cron en `live_note` al cerrar una huérfana. `live_note` es texto libre
 * que el tick sobreescribe cada diez segundos mientras la sesión vive ("active", "idle",
 * "break", el nombre de la app) y que "Trabajando ahora" solo lee en filas `is_live`: en una
 * fila cerrada nadie lo mira, así que sirve de marca sin migración. Un Stop escribe `null`.
 * Desde D-241 marcan los DOS cierres automáticos —el cron y la pantalla—, cada uno con el
 * suyo; antes la pantalla no marcaba y su cierre era indistinguible de un Stop.
 */
export const CRON_CLOSE_NOTE = "closed:cron";

/**
 * Y el que deja la PANTALLA cuando cierra una huérfana (D-241).
 *
 * Hasta ahora ese cierre no dejaba marca: la fila quedaba con el `live_note` del último
 * latido —`active`, `idle`, el nombre de la app— y `decisionReabrir` lo leía como «la cerró
 * una persona», que es lo mismo que un Stop. No lo es: **un Stop lo pulsa alguien y esto lo
 * decide una máquina**, con la misma regla y la misma aritmética que el cron.
 *
 * Con marca propia, las dos cosas se distinguen: el cierre automático se puede deshacer si
 * hay prueba de que el reloj de este cliente nunca se detuvo (las cuatro condiciones de
 * D-197, sin relajar ninguna), y un Stop no se deshace nunca.
 */
export const PAGE_ORPHAN_CLOSE_NOTE = "closed:orphan-page";

/** Los cierres que decidió una máquina, no una persona. */
export const CIERRES_AUTOMATICOS = [CRON_CLOSE_NOTE, PAGE_ORPHAN_CLOSE_NOTE];

export type FilaSesion = {
  id: string;
  employeeUid: string;
  isLive: boolean;
  liveNote: string | null;
  /** Cuándo arrancó. Solo lo mira el caso `tras-carga`, para exigir la misma jornada. */
  startMs?: number | null;
};

/** La jornada de negocio (Chicago) de un instante, como `YYYY-MM-DD`. */
export const jornadaDe = (ms: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));

export type MotivoNoReabrir =
  | "sin-fila" | "no-es-mia" | "sigue-viva" | "la-cerro-una-persona" | "sin-marca" | "sin-evidencia-local"
  | "otra-jornada" | "otra-viva";

/**
 * De dónde sale la prueba de que este reloj no se detuvo. **Son dos casos distintos**, y
 * confundirlos fue el hueco que costó cuatro horas del dueño (D-NEXT).
 *
 *  · `"sin-red"` — la pantalla **sigue abierta y contando** y descubre que el servidor cerró la
 *    fila. La prueba es el propio tick corriendo: es el caso de D-197.
 *  · `"tras-carga"` — la página **acaba de arrancar**: hubo un crash, un «Reload app», un
 *    cierre del navegador. Aquí no hay tick, ni `running`, ni id en memoria, **porque todo eso
 *    se acaba de reiniciar**. Exigirlos es exigir lo imposible, y por eso la reapertura tras un
 *    reload no ocurría nunca aunque D-241 dijera que sí. La prueba es la **marca**, que vive en
 *    `localStorage` y sobrevive precisamente a lo que borra la memoria.
 */
export type ContextoReapertura = "sin-red" | "tras-carga";

/**
 * ¿Se puede reabrir una sesión que una máquina cerró mientras la persona seguía trabajando?
 *
 * Es una excepción acotada a D-195, no una relajación del freno: el freno sigue cerrando a los
 * 15 min sin latido, y esto solo deshace ese cierre cuando hay prueba de que el reloj de ESTE
 * cliente nunca se detuvo. Las cuatro condiciones, todas obligatorias:
 *
 *  1. Es SU fila, y está cerrada.
 *  2. La cerró una MÁQUINA (`live_note` en `CIERRES_AUTOMATICOS`: el cron o la propia
 *     pantalla al ver una huérfana), no una persona ni un Stop.
 *  3. Hay marca de reanudación reciente PARA ESA sesión — y, **solo en el caso `sin-red`**,
 *     además evidencia local continua: el tick sigue corriendo ahora mismo sobre esa sesión.
 *     Tras una carga esa evidencia no puede existir; ver `ContextoReapertura`.
 *  4. No hay OTRA sesión viva de la misma persona (092: una sola viva). Si arrancó otra
 *     mientras tanto, esta no se reabre y se anota.
 *
 * Que la marca baste tras una carga **no la debilita**: `parseResumeMark` ya la descarta si es
 * más vieja que `RESUME_MAX_MS`, que son los mismos 15 minutos del freno, y `markCovers` exige
 * que sea de esa sesión y no de otra. Una máquina que estuvo apagada de verdad no tiene marca
 * fresca y sigue sin reabrir nada.
 */
export function decisionReabrir(args: {
  fila: FilaSesion | null;
  me: string;
  mark: ResumeMark | null;
  evidenciaLocal: boolean;
  otrasVivas: string[];
  contexto?: ContextoReapertura;
  /** Para poder fijar la jornada en las pruebas sin tocar el reloj. */
  ahora?: number;
}): { reabrir: true } | { reabrir: false; motivo: MotivoNoReabrir } {
  const { fila, me, mark, otrasVivas } = args;
  const contexto = args.contexto ?? "sin-red";
  const ahora = args.ahora ?? Date.now();
  if (!fila) return { reabrir: false, motivo: "sin-fila" };
  if (fila.employeeUid !== me) return { reabrir: false, motivo: "no-es-mia" };

  if (contexto === "sin-red") {
    // El de D-197, intacto: la fila ya está cerrada por una máquina y el tick sigue corriendo.
    if (fila.isLive) return { reabrir: false, motivo: "sigue-viva" };
    if (!CIERRES_AUTOMATICOS.includes(fila.liveNote ?? "")) return { reabrir: false, motivo: "la-cerro-una-persona" };
    if (!markCovers(mark, fila.id)) return { reabrir: false, motivo: "sin-marca" };
    if (!args.evidenciaLocal) return { reabrir: false, motivo: "sin-evidencia-local" };
    if (otrasVivas.some((id) => id !== fila.id)) return { reabrir: false, motivo: "otra-viva" };
    return { reabrir: true };
  }

  // `tras-carga`. La pregunta NO es «¿la cerró una máquina?» —**nadie la ha cerrado todavía**:
  // la máquina que iba a cerrarla es esta misma página, dos líneas después—. La pregunta es
  // «¿la adopto en vez de cerrarla?».
  //
  // Preguntar lo otro fue el fallo que costó una vuelta entera: la fila que llega aquí está
  // VIVA y su `live_note` es el del último tick (`active`, `break`), así que la condición de
  // «cerrada por máquina» la rechazaba **siempre** y la reapertura no ocurría en ninguna carga
  // real. La prueba pasaba porque le daba una fila con la nota de cierre ya puesta: una entrada
  // que la página no produce en ese punto.
  //
  // Si además llega cerrada —el cron se adelantó mientras no estábamos— vale igual, pero solo
  // si la cerró una máquina: un Stop no se deshace nunca.
  if (!fila.isLive && !CIERRES_AUTOMATICOS.includes(fila.liveNote ?? "")) {
    return { reabrir: false, motivo: "la-cerro-una-persona" };
  }
  if (!markCovers(mark, fila.id)) return { reabrir: false, motivo: "sin-marca" };

  // **El límite aquí es la jornada, no los quince minutos**, y esa diferencia es lo que hace
  // que esto sirva de algo. Con el umbral de la marca (`RESUME_MAX_MS`) la ventana era **vacía
  // por construcción**: `esHuerfana` mide desde `endMs`, la marca la escribe el mismo tick que
  // escribe `endMs`, y los dos umbrales son 15 min — así que cuando la fila es huérfana la
  // marca ya caducó, siempre.
  //
  // Relajarlo no reabre la puerta de D-098 porque en `tras-carga` **el hueco no se paga**: la
  // pantalla adelanta el arranque tanto como duró, así que los minutos sin latidos no entran en
  // la nómina pase lo que pase. Lo único que se decide aquí es la **continuidad** — si el
  // trabajo de después sigue en la misma fila o pide un Start nuevo.
  //
  // Al día siguiente no: reabrir una fila de ayer sería juntar dos jornadas en una.
  const arranque = fila.startMs ?? mark?.at ?? null;
  if (arranque == null || jornadaDe(arranque) !== jornadaDe(ahora)) {
    return { reabrir: false, motivo: "otra-jornada" };
  }
  if (otrasVivas.some((id) => id !== fila.id)) return { reabrir: false, motivo: "otra-viva" };
  return { reabrir: true };
}

/**
 * ¿El tick ha latido sin interrupción? (CAMBIOS del auditor sobre D-197.)
 *
 * "El tick está armado" no es "el tick siguió corriendo": un portátil suspendido con la tapa
 * cerrada, o una pestaña de fondo estrangulada, congela `setInterval` durante horas y al
 * despertar el siguiente tick escribe la marca con fecha de ahora, fresca, y `el` incluye la
 * noche entera. Reabrir con eso es pagar la noche: las 10,42 h y las 25,75 h de D-098 por la
 * puerta de atrás. Así que la evidencia local mide el HUECO entre un tick y el siguiente, con
 * el mismo umbral que tolera la base: el reloj local nunca se paró más de lo que el servidor
 * habría aceptado sin latido. `prev === null` es el primer tick de un arranque o de una
 * adopción confirmada, que no tiene hueco que medir.
 */
export function tickContinuo(prevTickMs: number | null, nowMs: number, maxMs: number = LATIDO_MAX_MS): boolean {
  return prevTickMs === null || nowMs - prevTickMs <= maxMs;
}

// ---- Backoff ----------------------------------------------------------------------------

/** 2 s, 4 s, 8 s, 16 s, 30 s, 30 s… El intento 0 es el primero después del fallo inicial. */
export function backoffMs(attempt: number, baseMs = 2_000, capMs = 30_000): number {
  const a = Math.max(0, Math.floor(attempt));
  return Math.min(capMs, baseMs * 2 ** a);
}
