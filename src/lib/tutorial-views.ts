import type { Tutorial } from "@/lib/types";

/**
 * Quién vio qué tutorial, y el aviso al entrar (D-913, 2026-11-06).
 *
 * El pedido (el dueño y Roberto): «Implement tutorial link: add pop-up notifications or a help menu entry for
 * accessing training resources» y «require users to view new videos upon signing in». Tres piezas:
 *
 * - **Lo visto, por persona**, en `public.tutorial_views` (267): una fila por persona y video. Lo marca la persona
 *   («Marcar como visto») o el reproductor solo, al llegar al 90 % del video (YouTube y ficheros; Loom, Vimeo y
 *   Drive no lo cuentan, así que ahí queda el botón).
 * - **El aviso al entrar al hub**: una tarjeta con los videos de su rol que aún no vio. «Recordar mañana» lo
 *   aplaza hasta el día siguiente; vuelve cada día hasta que todo esté visto. Solo el admin puede quitarlo
 *   para siempre. Una vez por sesión del navegador, y nunca en modo enseñanza (D-626).
 * - **La entrada en el menú de Ayuda**, con cuántos faltan.
 *
 * Quién ve qué video lo sigue decidiendo `public.tutorials()` en la base (115): a este fichero le llega la lista
 * ya filtrada. Aquí no hay React: lo importan componentes y pruebas por igual.
 */

/** Una fila de `tutorial_views`, como la devuelve la base. */
export type VistaDeTutorial = { tutorial_id: string; watched_at?: string | null };

/** Los videos de la lista que la persona NO ha visto, en el orden de la lista. */
export function tutorialesPendientes<T extends Pick<Tutorial, "id">>(lista: readonly T[], vistos: ReadonlySet<string> | readonly VistaDeTutorial[]): T[] {
  const ids = vistos instanceof Set ? vistos : new Set((vistos as readonly VistaDeTutorial[]).map((v) => v.tutorial_id));
  return lista.filter((t) => !ids.has(t.id));
}

/** Cuántos faltan: lo que enseña la insignia del menú de Ayuda. */
export function cuentaSinVer(lista: readonly Pick<Tutorial, "id">[], vistos: ReadonlySet<string> | readonly VistaDeTutorial[]): number {
  return tutorialesPendientes(lista, vistos).length;
}

// ---- El aviso: cuándo sale ---------------------------------------------------------------------------------------

/** Claves del navegador. El aplazamiento y el descarte son POR NAVEGADOR: cambiar de teléfono vuelve a avisar, y está bien. */
export const CLAVE_APLAZADO = "rtg_tutoriales_aplazado_hasta";
export const CLAVE_DESCARTADO = "rtg_tutoriales_descartado";
export const CLAVE_VISTO_EN_SESION = "rtg_tutoriales_avisado";

/** El primer instante del día siguiente, en la hora local de quien mira: hasta ahí se aplaza. */
export function proximoAviso(ahora: Date): Date {
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1, 0, 0, 0, 0);
  return d;
}

/** ¿Sigue aplazado? Un valor ilegible cuenta como «no aplazado». */
export function sigueAplazado(aplazadoHasta: string | null | undefined, ahora: Date): boolean {
  if (!aplazadoHasta) return false;
  const limite = new Date(aplazadoHasta);
  if (Number.isNaN(limite.getTime())) return false;
  return ahora.getTime() < limite.getTime();
}

export type EstadoDelAviso = {
  /** Lo que la persona tiene pendiente (ya filtrado por su rol en la base). */
  pendientes: number;
  /** Modo enseñanza encendido (D-626): nunca se avisa practicando. */
  ensenanza: boolean;
  /** `sessionStorage`: ya salió en esta sesión del navegador. */
  yaAvisadoEnSesion: boolean;
  /** `localStorage`: hasta cuándo pidió que no se le molestara. */
  aplazadoHasta: string | null | undefined;
  /** `localStorage`: el admin lo quitó para siempre. A quien no es admin no se le hace caso. */
  descartado: boolean;
  esAdmin: boolean;
  ahora: Date;
};

/**
 * ¿Sale la tarjeta? Sí cuando hay algo pendiente, no se está practicando, no salió ya en esta sesión, no está
 * aplazada y —solo si es admin— no la descartó. Un descarte guardado por quien no es admin se ignora: el aviso
 * «comes back daily until every video for their role is marked watched».
 */
export function debeAvisar(e: EstadoDelAviso): boolean {
  if (e.pendientes <= 0) return false;
  if (e.ensenanza) return false;
  if (e.yaAvisadoEnSesion) return false;
  if (e.esAdmin && e.descartado) return false;
  if (sigueAplazado(e.aplazadoHasta, e.ahora)) return false;
  return true;
}

// ---- «Visto» automático: el reproductor -------------------------------------------------------------------------

/** A partir de qué parte del video se da por visto. */
export const PARTE_VISTA = 0.9;

/** ¿Ya llegó al 90 %? Sin duración (todavía no cargó, o un directo) no se decide. */
export function seDioPorVisto(actual: number | null | undefined, duracion: number | null | undefined, parte = PARTE_VISTA): boolean {
  if (!duracion || !Number.isFinite(duracion) || duracion <= 0) return false;
  if (actual == null || !Number.isFinite(actual)) return false;
  return actual / duracion >= parte;
}

/**
 * Lo que manda el reproductor de YouTube por `postMessage` cuando se le pidió escuchar (`enablejsapi=1` y el evento
 * `listening`): mensajes JSON con `event: "infoDelivery"` e `info.currentTime` / `info.duration`. Devuelve el avance,
 * o `null` si el mensaje no es de eso. Un mensaje de otra ventana, u otro formato, no rompe nada.
 */
export function avanceDeYouTube(dato: unknown): { actual: number; duracion: number } | null {
  let obj: unknown = dato;
  if (typeof dato === "string") {
    try { obj = JSON.parse(dato); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const m = obj as { event?: unknown; info?: { currentTime?: unknown; duration?: unknown } };
  if (m.event !== "infoDelivery" || !m.info || typeof m.info !== "object") return null;
  const actual = Number(m.info.currentTime);
  const duracion = Number(m.info.duration);
  if (!Number.isFinite(actual) || !Number.isFinite(duracion)) return null;
  return { actual, duracion };
}

/** El `src` del iframe de YouTube con la API del reproductor encendida; cualquier otro `src` se devuelve tal cual. */
export function srcConApiDeYouTube(src: string, origen: string | null | undefined): string {
  let u: URL;
  try { u = new URL(src); } catch { return src; }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return src;
  u.searchParams.set("enablejsapi", "1");
  if (origen) u.searchParams.set("origin", origen);
  return u.toString();
}

/** ¿Este `src` sabe avisar su avance? Solo YouTube; Loom, Vimeo y Drive no, así que ahí se marca a mano. */
export function sabeAvisarAvance(src: string): boolean {
  try { return /(^|\.)youtube(-nocookie)?\.com$/.test(new URL(src).hostname); } catch { return false; }
}

// ---- La base, sin red para probarlo -----------------------------------------------------------------------------

type Respuesta<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;

/** Lo mínimo del cliente de Supabase que hace falta aquí. */
export type ClienteDeVistas = {
  from: (tabla: "tutorial_views") => {
    select: (cols: string) => { eq: (c: "user_id", v: string) => Respuesta<VistaDeTutorial[]> };
    upsert: (fila: { user_id: string; tutorial_id: string; watched_at: string }, opts: { onConflict: string }) => Respuesta<unknown>;
  };
  rpc: (fn: "tutorial_view_stats") => Respuesta<EstadisticaDeTutorial[]>;
};

/** La tabla aún no existe (la 267 sin aplicar): PostgREST contesta 42P01 o PGRST205. */
export function esTablaAusente(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? "");
}

export type ResultadoDeVistos =
  | { ok: true; vistos: Set<string> }
  /** `sin_tabla`: la 267 no está. `error`: cualquier otro fallo. En los dos casos NO se avisa a nadie. */
  | { ok: false; motivo: "sin_tabla" | "error" };

/** Lo que esta persona ya vio. Solo sus filas, por la RLS; el `eq` es por claridad y por la caché. */
export async function leeVistos(cliente: ClienteDeVistas, userId: string): Promise<ResultadoDeVistos> {
  const { data, error } = await cliente.from("tutorial_views").select("tutorial_id").eq("user_id", userId);
  if (error) return { ok: false, motivo: esTablaAusente(error) ? "sin_tabla" : "error" };
  return { ok: true, vistos: new Set((data ?? []).map((v) => v.tutorial_id)) };
}

export type ResultadoDeMarcar = { ok: true } | { ok: false; motivo: "sin_tabla" | "ensenanza" | "error" };

/** Marcar un video como visto. Idempotente (`upsert` por persona y video). En enseñanza la base contesta 403. */
export async function marcaVisto(cliente: ClienteDeVistas, userId: string, tutorialId: string, cuando: Date): Promise<ResultadoDeMarcar> {
  const { error } = await cliente
    .from("tutorial_views")
    .upsert({ user_id: userId, tutorial_id: tutorialId, watched_at: cuando.toISOString() }, { onConflict: "user_id,tutorial_id" });
  if (!error) return { ok: true };
  if (esTablaAusente(error)) return { ok: false, motivo: "sin_tabla" };
  if (error.code === "ENSENANZA" || error.code === "CAPACITACION") return { ok: false, motivo: "ensenanza" };
  return { ok: false, motivo: "error" };
}

// ---- El conteo del admin ----------------------------------------------------------------------------------------

export type EstadisticaDeTutorial = { tutorial_id: string; watched: number; total: number };

/** Por video, «vistos / total» para el admin. `null` si la base no contesta (sin la 267, o sin permiso): no se enseña. */
export async function leeEstadisticas(cliente: ClienteDeVistas): Promise<Map<string, EstadisticaDeTutorial> | null> {
  const { data, error } = await cliente.rpc("tutorial_view_stats");
  if (error || !data) return null;
  return new Map(data.map((e) => [e.tutorial_id, { tutorial_id: e.tutorial_id, watched: Number(e.watched) || 0, total: Number(e.total) || 0 }]));
}

/** «3 / 12» o, sin público, «— / 0». */
export function textoDeEstadistica(e: EstadisticaDeTutorial | undefined): string | null {
  if (!e) return null;
  return `${e.watched} / ${e.total}`;
}
