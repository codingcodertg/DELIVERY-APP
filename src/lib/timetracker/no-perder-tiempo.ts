/**
 * El reloj nunca cuenta en el vacío (D-875).
 *
 * El incidente (2026-11-04 y 2026-11-05, cuenta del dueño, app de escritorio): la pantalla
 * enseñaba «En marcha…» y el aviso «Sin guardar desde las 08:43 — 43 min…», y en la base no
 * había ninguna fila entre las 23:46 de la víspera y las 09:27. La víspera, lo mismo con otra
 * forma: una sesión de un segundo a las 18:40:23 y una hora entera sin fila detrás.
 *
 * Lo que tenían en común, medido en el código y no supuesto: **el cronómetro sabía que no
 * estaba guardando y no hacía nada para volver a guardar.** Tres caminos acababan igual:
 *
 *  1. El latido vuelve `"cerrada"` —la fila ya no es viva: la cerró el cron de huérfanas o
 *     la propia pantalla, o la RLS dejó de verla—. Antes: aviso en pantalla y el reloj seguía
 *     contando sobre una fila que no iba a aceptar nada más. Nadie abría otra.
 *  2. El latido vuelve `"overlap"` (082). Antes: `stop()`, cuyo parche choca con la misma
 *     restricción y se pierde con todo lo contado desde el último latido bueno.
 *  3. El INSERT de Start falla —red caída al despertar, token caducado tras la noche—.
 *     Antes: con la sesión caducada, `return` en silencio; con cualquier otro error, un
 *     `alert`. La persona se ponía a trabajar con la pantalla puesta a cero y nada detrás.
 *
 * La regla que queda: **lo que el reloj cuenta tiene una fila, o la va a tener.** Si la fila
 * se cierra, se abre otra que continúa donde la anterior dejó de guardar; si choca con tiempo
 * ya fichado, se recorta el arranque hasta después de ese tramo en vez de fallar; si el INSERT
 * falla, se reintenta con espera creciente y el tiempo pendiente no se toca.
 *
 * Lo que NO cambia es D-098: el hueco de una máquina dormida no se paga. La continuación
 * arranca donde terminó lo guardado solo si el reloj local no se detuvo (`continuo`); si se
 * detuvo, arranca ahora.
 *
 * Lógica pura, sin React ni red, para que la compartan la pantalla y las pruebas.
 */

import { backoffMs } from "./live-session";

/** Un tramo ya fichado, en milisegundos. */
export type Tramo = { startMs: number; endMs: number };

/** Lo que puede pasarle a un latido (ver `writeSession` en Cronometro.tsx). */
export type ResultadoLatido = boolean | "queued" | "overlap" | "auth" | "cerrada";

/**
 * Qué hacer después de un latido.
 *
 *  · `ok` — guardó.
 *  · `esperar` — el parche está en la cola (red) o esperando a que la persona vuelva a entrar
 *    (auth): se reenvía solo, con la duración completa. El reloj sigue y el aviso se ve.
 *  · `fila-nueva` — esta fila ya no acepta nada (`cerrada`) o no puede crecer más (`overlap`).
 *    Se abre otra que continúa, en vez de seguir contando en el vacío o parar perdiéndolo.
 */
export type PlanTrasLatido = "ok" | "esperar" | "fila-nueva";

export function planTrasLatido(r: ResultadoLatido): PlanTrasLatido {
  if (r === true) return "ok";
  if (r === "cerrada" || r === "overlap") return "fila-nueva";
  return "esperar";
}

/**
 * Dónde arranca la fila que continúa a una que dejó de aceptar latidos.
 *
 * `guardadoHastaMs` es el `endMs` del último latido que SÍ entró: hasta ahí la fila vieja lo
 * tiene. Si el reloj local no se paró desde entonces (`continuo`), todo lo de después se contó
 * de verdad y la fila nueva empieza justo ahí. Si se paró (portátil dormido, pestaña
 * estrangulada), el hueco no se paga (D-098) y empieza ahora. Nunca en el futuro.
 */
export function inicioDeContinuacion(a: {
  guardadoHastaMs: number | null;
  continuo: boolean;
  ahoraMs: number;
}): number {
  if (!a.continuo || a.guardadoHastaMs == null || !Number.isFinite(a.guardadoHastaMs)) return a.ahoraMs;
  return Math.min(a.guardadoHastaMs, a.ahoraMs);
}

/**
 * El primer instante ≥ `desdeMs` desde el que una fila `[x, hastaMs)` no se solapa con ningún
 * tramo de `otras` — la misma regla que `sessions_no_overlap` (rango `[)`, y solo cuenta un
 * tramo con `endMs > startMs`). Recorta en vez de fallar: si un tramo ya fichado cae dentro,
 * la fila nueva empieza cuando ese tramo acaba.
 *
 * `null` si no queda hueco hasta `hastaMs`: algo ya fichado cubre el presente, y entonces lo
 * que hay que hacer es esperar, no escribir encima.
 */
export function inicioSinSolape(desdeMs: number, hastaMs: number, otras: Tramo[]): number | null {
  const validos = otras.filter((o) => Number.isFinite(o.startMs) && Number.isFinite(o.endMs) && o.endMs > o.startMs);
  let x = desdeMs;
  // Cada vuelta salta al final de un tramo que choca; como `x` solo crece, basta con tantas
  // vueltas como tramos haya.
  for (let vuelta = 0; vuelta <= validos.length; vuelta++) {
    const choque = validos.find((o) => o.startMs < Math.max(hastaMs, x + 1) && o.endMs > x);
    if (!choque) return x;
    x = choque.endMs;
    if (x >= hastaMs) return null;
  }
  return null;
}

/**
 * Un INSERT que todavía no entró. El reloj ya cuenta desde `desdeMs`; la fila llega cuando la
 * base conteste. Mientras tanto, se reintenta con la espera de `backoffMs` (2, 4, 8, 16, 30 s…).
 */
export type Pendiente = {
  desdeMs: number;
  intento: number;
  proximoMs: number;
  solapes?: number;
  /** Sueño detectado antes de entrar la fila: el tramo cuenta hasta aquí, no hasta el INSERT. */
  hastaMs?: number;
  fueraMs?: number;
};

export function nuevoPendiente(desdeMs: number, ahoraMs: number): Pendiente {
  return { desdeMs, intento: 0, proximoMs: ahoraMs };
}

/** ¿Toca reintentar ya? */
export function tocaReintentarPendiente(p: Pendiente | null, ahoraMs: number): boolean {
  return !!p && ahoraMs >= p.proximoMs;
}

/** Tras un intento fallido: el mismo `desdeMs` —el tiempo pendiente no se toca— y más espera. */
export function trasFallo(p: Pendiente, ahoraMs: number): Pendiente {
  return { ...p, intento: p.intento + 1, proximoMs: ahoraMs + backoffMs(p.intento) };
}

/**
 * La fila completa de un tramo que se paró sin haber llegado a tener fila (Stop con el INSERT
 * todavía pendiente). Se guarda en `localStorage` y se reintenta hasta que entre: es tiempo
 * trabajado y no puede quedarse solo en la memoria de una pestaña.
 */
export type FilaPendiente = { startMs: number; endMs: number; durationSeconds: number; payload: Record<string, unknown> };

export const filasPendientesKey = (userId: string) => `tt_pending_rows_${userId}`;

export function leerFilasPendientes(raw: string | null): FilaPendiente[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is FilaPendiente =>
      !!x && typeof x === "object"
      && Number.isFinite((x as FilaPendiente).startMs)
      && Number.isFinite((x as FilaPendiente).endMs)
      && (x as FilaPendiente).endMs >= (x as FilaPendiente).startMs
      && typeof (x as FilaPendiente).payload === "object");
  } catch { return []; }
}
