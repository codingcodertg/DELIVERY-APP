/**
 * El estado "por app" de cada persona en el panel de permisos (289): para cada app habilitada, un punto verde si la usa
 * (está live ahí ahora, o la usó en los últimos 2 días) o gris si lleva más de 2 días sin usarla, con la última vez.
 *
 * Puro: sin React ni red. Los datos (último uso por app) vienen de `app_last_seen` y el "live ahora" del «en vivo».
 */

/** Días desde los que una app se considera "sin usar" (pasa a gris). */
export const DIAS_FRESCO = 2;
const MS_FRESCO = DIAS_FRESCO * 24 * 60 * 60 * 1000;

export type EstadoDeApp = {
  /** verde = live ahora o usada en ≤ 2 días; gris = +2 días sin usar (o nunca). */
  estado: "verde" | "gris";
  /** El sello del último uso (ISO), o null si nunca. */
  ultimaVez: string | null;
  /** Minutos desde el último uso, para pintar "hace N" (null si nunca y no está live). */
  mins: number | null;
};

/**
 * El estado de UNA app para una persona.
 * @param ultimaVezISO  último uso de esa app (de `app_last_seen`), o null/undefined si no hay.
 * @param liveAhora     true si la persona está metida en ESA app en este momento (del «en vivo»).
 */
export function estadoDeApp(ultimaVezISO: string | null | undefined, liveAhora: boolean, ahora: number = Date.now()): EstadoDeApp {
  const t = ultimaVezISO ? Date.parse(ultimaVezISO) : NaN;
  const valido = !Number.isNaN(t);
  const mins = valido ? Math.max(0, Math.round((ahora - t) / 60000)) : null;
  if (liveAhora) return { estado: "verde", ultimaVez: valido ? ultimaVezISO! : null, mins: mins ?? 0 };
  if (!valido) return { estado: "gris", ultimaVez: null, mins: null };
  return { estado: ahora - t <= MS_FRESCO ? "verde" : "gris", ultimaVez: ultimaVezISO!, mins };
}

/** El último uso por app de una persona, tal como lo devuelve el API: app → sello ISO. */
export type UsoPorApp = Record<string, string>;
/** Por persona: su `UsoPorApp`. */
export type UsoPorAppDeTodos = Record<string, UsoPorApp>;

export interface FilaUsoCrudo { user_id: string; app: string; last_seen_at: string }

/** Arma el mapa persona → (app → último uso) a partir de las filas crudas de `app_last_seen`. Puro, con prueba. */
export function construyeUsoPorApp(filas: readonly FilaUsoCrudo[]): UsoPorAppDeTodos {
  const m: UsoPorAppDeTodos = {};
  for (const f of filas) {
    if (!f.user_id || !f.app || !f.last_seen_at) continue;
    const porApp = (m[f.user_id] ??= {});
    const prev = porApp[f.app];
    if (!prev || Date.parse(f.last_seen_at) > Date.parse(prev)) porApp[f.app] = f.last_seen_at;
  }
  return m;
}
