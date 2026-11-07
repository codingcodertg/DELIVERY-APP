/**
 * Recuperarse solo cuando los latidos dejan de entrar (D-916, incidente del 2026-11-07).
 *
 * Lo que pasó, medido en los registros de Supabase (horas UTC; Chicago = UTC−6):
 *
 *   17:22:56  último latido bueno de la fila a550e937 (app de escritorio 0.0.45).
 *   17:23–17:40  ni una petición de la app: el portátil cambió de red varias veces y quedó
 *                bloqueado mientras se configuraba el router.
 *   17:40:32  vuelve la red: tres refrescos de token a la vez (los tres clientes de navegador
 *             que monta el hub), los tres 200.
 *   17:40:33  PATCH /sessions?id=eq.a550… → **401** (el JWT viejo, caducado durante el corte).
 *             Es el cierre «fire-and-forget» de `continuarEnFilaNueva`: el desbloqueo tras más
 *             de cinco minutos (D-892) quiso cerrar la fila vieja y abrir una nueva. Ese PATCH
 *             iba por `updateSession`, que —a diferencia de `updateLiveSession`— no reintentaba
 *             con token fresco, y su error se tragaba con `.catch(() => {})`.
 *   17:40:33 → 18:30  POST /sessions → **409** cada 35 s, 100 veces: el INSERT de la fila nueva
 *             chocaba con `sessions_one_live_per_employee` (092) porque la vieja seguía viva, y
 *             `intentarPendiente` solo entendía el solape (082): con el 23505 esperaba y volvía
 *             a chocar. Nadie volvía a intentar el cierre. Setenta minutos de «Sin guardar».
 *   18:32     la app se cierra y se abre: la vieja se cierra como huérfana y arranca otra.
 *
 * Tres cosas se arreglan, y las tres sin inventar un segundo:
 *
 *  1. **El cierre de la fila anterior se reintenta** hasta que entre, y un 092 al insertar la
 *     continuación cierra la fila viva propia que estorba (`intentarPendiente`). `updateSession`
 *     reintenta con token fresco como ya hacía la vía viva.
 *  2. **Racha de fallos → sanar.** Tres latidos seguidos sin entrar (~30 s), o un fallo que dura
 *     más de dos minutos, disparan la recuperación: esperar a `online`, refrescar la sesión de
 *     Supabase (y rehacer el cliente si el refresco no contesta), y reintentar ya con un latido.
 *     Si tras cinco minutos sigue fallando con red (`navigator.onLine` y `/api/version`
 *     contestan), la página se recarga **sin perder el reloj** (punto 3).
 *  3. **La recarga conserva la sesión.** El estado vivo (id, arranque, segundos activos y de
 *     pausa, teclas, clics, último guardado) se escribe en `localStorage` en cada latido y
 *     justo antes de recargar. Al montar, si ese estado es de hace menos de `ESTADO_VIVO_MAX_MS`
 *     y es de la misma fila, la página **continúa la misma sesión** con esos contadores en vez
 *     de cerrarla como huérfana: el tramo sin guardar lo midió esta misma app, viva y contando
 *     («67 min del reloj de arriba»), y el primer latido lo lleva entero a la base. Un estado
 *     más viejo que ese margen no se usa: ahí nadie midió, y D-098/D-246 siguen mandando (el
 *     hueco no se paga).
 *
 * Lógica pura, sin React ni red, para probarla sin levantar nada.
 */

import type { BreakEvent } from "./types";

/** Latidos seguidos sin entrar antes de sanar. Tres: medio minuto. */
export const SANAR_TRAS_FALLOS = 3;
/** O un fallo que dure más de esto, aunque los latidos no sean seguidos. */
export const SANAR_TRAS_MS = 2 * 60_000;
/** Con red y el sitio contestando, pero sin poder escribir: recarga suave. */
export const RECARGA_TRAS_MS = 5 * 60_000;
/** Entre dos intentos de sanar. */
export const SANAR_CADA_MS = 10_000;
/** La notificación de Windows de «no está grabando», como mucho una cada diez minutos. */
export const AVISO_SISTEMA_CADA_MS = 10 * 60_000;
/** Cuánto se fía la página de un estado vivo guardado: una recarga suave tarda segundos. */
export const ESTADO_VIVO_MAX_MS = 2 * 60_000;
/** Un latido que no contesta en esto cuenta como fallido (un `fetch` colgado tras cambiar de red). */
export const LATIDO_TIMEOUT_MS = 20_000;

export type EtapaRacha = "ok" | "reconectando" | "alcanzando";

/** La racha actual de latidos fallidos. */
export type Racha = {
  fallos: number;
  /** Cuándo empezó a fallar (el primer fallo de la racha). */
  desdeMs: number | null;
  /** Último intento de sanar. */
  ultimoSanarMs: number | null;
  etapa: EtapaRacha;
};

export const RACHA_LIMPIA: Racha = { fallos: 0, desdeMs: null, ultimoSanarMs: null, etapa: "ok" };

export function registrarFallo(r: Racha, ahoraMs: number): Racha {
  return { ...r, fallos: r.fallos + 1, desdeMs: r.desdeMs ?? ahoraMs, etapa: r.etapa === "ok" ? "reconectando" : r.etapa };
}

/** Un latido que entró borra la racha entera. */
export function registrarExito(): Racha {
  return RACHA_LIMPIA;
}

/** ¿Toca intentar sanar? Tres fallos seguidos o dos minutos fallando, y sin machacar. */
export function tocaSanar(r: Racha, ahoraMs: number): boolean {
  if (r.fallos === 0 || r.desdeMs === null) return false;
  const bastante = r.fallos >= SANAR_TRAS_FALLOS || ahoraMs - r.desdeMs > SANAR_TRAS_MS;
  if (!bastante) return false;
  return r.ultimoSanarMs === null || ahoraMs - r.ultimoSanarMs >= SANAR_CADA_MS;
}

/** Segundos hasta el próximo intento, para el banner («Reconectando… reintento en 7 s»). */
export function segundosHastaSanar(r: Racha, ahoraMs: number): number {
  if (r.ultimoSanarMs === null) return 0;
  return Math.max(0, Math.ceil((r.ultimoSanarMs + SANAR_CADA_MS - ahoraMs) / 1000));
}

/**
 * ¿Toca la recarga suave? Solo cuando el fallo lleva más de cinco minutos Y hay red Y el propio
 * sitio contesta: entonces lo que está roto es esta página (sockets viejos, cliente atascado),
 * no la red, y recargar es lo que lo arregla. Sin red no se recarga: sería perder el reloj por
 * nada.
 */
export function tocaRecargar(r: Racha, ahoraMs: number, red: { online: boolean; sitioResponde: boolean }): boolean {
  if (r.desdeMs === null || r.fallos === 0) return false;
  if (!red.online || !red.sitioResponde) return false;
  return ahoraMs - r.desdeMs >= RECARGA_TRAS_MS;
}

// ---- El estado vivo que sobrevive a la recarga ------------------------------------------

export type EstadoVivo = {
  sessionId: string;
  startMs: number;
  activeSeconds: number;
  idleSeconds: number;
  keystrokes: number;
  clicks: number;
  lunchSeconds: number;
  breakSeconds: number;
  breakEvents: BreakEvent[];
  /** `endMs` y duración del último latido que SÍ entró (o null si ninguno desde la fila). */
  guardadoHastaMs: number | null;
  guardadoNeto: number;
  /** Segundos ya guardados en filas anteriores de la misma tanda (el reloj no vuelve a 0:00). */
  arrastre: number;
  source?: string | null;
  /** Cuándo se escribió. Lo que decide si se usa. */
  at: number;
};

export const estadoVivoKey = (userId: string) => `tt_estado_vivo_${userId}`;

export function parseEstadoVivo(raw: string | null, ahoraMs: number, maxMs: number = ESTADO_VIVO_MAX_MS): EstadoVivo | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Partial<EstadoVivo>;
    if (!e || typeof e.sessionId !== "string" || !Number.isFinite(e.startMs) || !Number.isFinite(e.at)) return null;
    // Más viejo que el margen: nadie midió desde entonces. Y del futuro, tampoco (reloj de pared).
    if (ahoraMs - (e.at as number) > maxMs || (e.at as number) > ahoraMs + 60_000) return null;
    const n = (x: unknown) => (Number.isFinite(x) ? (x as number) : 0);
    return {
      sessionId: e.sessionId,
      startMs: e.startMs as number,
      activeSeconds: n(e.activeSeconds),
      idleSeconds: n(e.idleSeconds),
      keystrokes: n(e.keystrokes),
      clicks: n(e.clicks),
      lunchSeconds: n(e.lunchSeconds),
      breakSeconds: n(e.breakSeconds),
      breakEvents: Array.isArray(e.breakEvents) ? (e.breakEvents as BreakEvent[]) : [],
      guardadoHastaMs: Number.isFinite(e.guardadoHastaMs) ? (e.guardadoHastaMs as number) : null,
      guardadoNeto: n(e.guardadoNeto),
      arrastre: n(e.arrastre),
      source: e.source ?? null,
      at: e.at as number,
    };
  } catch { return null; }
}

/** ¿Este estado es el de ESA fila? Si no, no se toca: sería pegarle contadores ajenos. */
export function estadoVivoAplica(e: EstadoVivo | null, sessionId: string | null | undefined): e is EstadoVivo {
  return !!e && !!sessionId && e.sessionId === sessionId;
}

/**
 * El latido de alcance: lo que se escribe en cuanto vuelve a haber por dónde escribir.
 *
 * **Nada se inventa.** La duración es la del reloj de pared desde el arranque menos comida,
 * descanso e inactividad —exactamente lo que el tick llevaba sumando mientras no podía guardar—
 * y los contadores de actividad son los que la app tenía en memoria. Si la base tenía la fila en
 * 11:22 y el reloj iba por 12:29, la fila pasa a 12:29 con esos números; ni un segundo más de
 * lo que se midió.
 */
export function parcheDeAlcance(e: Pick<EstadoVivo, "startMs" | "activeSeconds" | "idleSeconds" | "keystrokes" | "clicks" | "lunchSeconds" | "breakSeconds" | "breakEvents">, ahoraMs: number, liveNote = "active") {
  const el = Math.max(0, Math.floor((ahoraMs - e.startMs) / 1000));
  const durationSeconds = Math.max(0, el - e.lunchSeconds - e.breakSeconds - e.idleSeconds);
  return {
    endMs: ahoraMs,
    durationSeconds,
    activeSeconds: Math.min(e.activeSeconds, durationSeconds),
    idleSeconds: e.idleSeconds,
    liveNote,
    keystrokes: e.keystrokes,
    clicks: e.clicks,
    lunchSeconds: e.lunchSeconds,
    breakSeconds: e.breakSeconds,
    breakEvents: e.breakEvents.map((b) => ({ kind: b.kind, start: b.start, end: b.end || null })),
  };
}

/** La notificación del sistema: la primera vez, y luego no más de una cada `cadaMs`. */
export function tocaAvisarSistema(ultimoAvisoMs: number | null, ahoraMs: number, cadaMs: number = AVISO_SISTEMA_CADA_MS): boolean {
  return ultimoAvisoMs === null || ahoraMs - ultimoAvisoMs >= cadaMs;
}

/** Una promesa con tope: pasado `ms` rechaza, para que un `fetch` colgado cuente como fallo. */
export function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
