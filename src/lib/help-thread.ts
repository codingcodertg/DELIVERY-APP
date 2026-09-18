import type { FicheroAdjunto } from "./help-attachments";
import { adjuntosDe, quienEscribe, type SolicitudDeAyuda } from "./help-requests";
import { AYUDA_ATENDIDA_KIND } from "./notifications";

/**
 * Una solicitud de ayuda es una conversación (D-311).
 *
 * El dueño: «work on a help chat feature so i can chat with the people and be back and forth». Hasta
 * ahora era de un solo sentido: la persona escribía, el admin la atendía, fin (D-285, D-301).
 *
 * Aquí vive lo que la PANTALLA decide con estas reglas: qué botones enseña, a dónde lleva un aviso,
 * cuántos no leídos pinta. Quién lee, quién escribe, cuándo se reabre y a quién se avisa lo hace
 * cumplir la migración 126 — las políticas y un disparador —, no esto. Las dos cosas dicen lo mismo y
 * una prueba las compara: una caja de respuesta que la base rechaza es peor que ninguna.
 */

export type MensajeDeAyuda = {
  id: string;
  request_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  files: FicheroAdjunto[] | null;
  created_at: string;
};

/** El aviso a quien pidió la ayuda de que le contestaron. Lleva a «Mis solicitudes». */
export const AYUDA_RESPUESTA_KIND = "ayuda_respuesta";
/** El aviso al admin de que la persona escribió en el hilo. Lleva a la vista del admin. */
export const AYUDA_MENSAJE_KIND = "ayuda_mensaje";

export const RUTA_MIS_SOLICITUDES = "/home/ayuda";
export const RUTA_SOLICITUDES_ADMIN = "/home/solicitudes-de-ayuda";

/** Lo que cabe en un mensaje: lo mismo que en la solicitud (120). */
export const LIMITE_DEL_MENSAJE = 5000;

type Yo = { id: string; esAdmin: boolean };

/** Lee y escribe en el hilo quien lo abrió y cualquier admin; nadie más. Una solicitud cuya cuenta
 *  se borró (`user_id` nulo) queda solo para el admin. */
export function participaEnElHilo(yo: Yo | null | undefined, s: Pick<SolicitudDeAyuda, "user_id">): boolean {
  if (!yo) return false;
  return yo.esAdmin || (!!s.user_id && s.user_id === yo.id);
}

/**
 * De qué lado del hilo escribe alguien: `persona` si es quien abrió la solicitud, `admin` si no.
 * Se decide por QUIÉN ABRIÓ, no por el rol: un admin que pide ayuda es, en su hilo, la persona.
 */
export function ladoDelAutor(autorId: string | null, s: Pick<SolicitudDeAyuda, "user_id">): "persona" | "admin" {
  return !!autorId && autorId === s.user_id ? "persona" : "admin";
}

/** Contestar a una atendida la devuelve a pendiente — solo si contesta quien la abrió. Que el admin
 *  añada algo a una ya atendida no la reabre: la cerró él. */
export function reabreAlContestar(autorId: string | null, s: Pick<SolicitudDeAyuda, "user_id" | "status">): boolean {
  return s.status === "atendida" && ladoDelAutor(autorId, s) === "persona";
}

/** Adjunta solo quien abrió la solicitud. Lo que suba un admin queda en SU carpeta del cubo, y la
 *  119 no deja a la persona abrirlo: sería un adjunto que el destinatario no puede ver. */
export function puedeAdjuntar(autorId: string | null, s: Pick<SolicitudDeAyuda, "user_id">): boolean {
  return ladoDelAutor(autorId, s) === "persona";
}

/**
 * A quién se avisa de un mensaje nuevo. Nunca a quien lo escribió.
 *
 * - Escribe un admin → a quien abrió la solicitud (si su cuenta sigue existiendo).
 * - Escribe la persona → **al admin que ya está en ese hilo**: el último admin que escribió en él, y
 *   si ninguno escribió, quien la atendió. Solo si no hay ninguno de los dos se avisa a TODOS los
 *   admins. Hay cuatro (medido 2026-09-18): avisarles siempre serían cuatro campanas por mensaje.
 *
 * `admins` son los perfiles con rol admin AHORA: quien dejó de serlo ya no puede leer el hilo, así que
 * no cuenta ni como «el que ya contestó» ni como «quien la atendió».
 */
export function aQuienSeAvisa(args: {
  autorId: string;
  solicitud: Pick<SolicitudDeAyuda, "user_id" | "attended_by">;
  previos: readonly Pick<MensajeDeAyuda, "author_id" | "created_at">[];
  admins: readonly string[];
}): string[] {
  const { autorId, solicitud, previos, admins } = args;
  if (ladoDelAutor(autorId, solicitud) === "admin") {
    return solicitud.user_id ? [solicitud.user_id] : [];
  }
  const esAdminAjeno = (id: string | null): id is string => !!id && id !== autorId && admins.includes(id);
  const ultimo = [...previos]
    .filter((m) => esAdminAjeno(m.author_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.author_id;
  if (ultimo) return [ultimo];
  if (esAdminAjeno(solicitud.attended_by)) return [solicitud.attended_by];
  return admins.filter((id) => id !== autorId);
}

/** A dónde lleva la campana un aviso de ayuda, o `null` si el `kind` no es de ayuda. Por `kind` y no
 *  por rol: un admin también pide ayuda, y a él la respuesta le lleva a SUS solicitudes. */
export function destinoDelAvisoDeAyuda(kind: string): string | null {
  if (kind === AYUDA_MENSAJE_KIND) return RUTA_SOLICITUDES_ADMIN;
  if (kind === AYUDA_RESPUESTA_KIND || kind === AYUDA_ATENDIDA_KIND) return RUTA_MIS_SOLICITUDES;
  return null;
}

/** Mensajes de OTROS posteriores a la última vez que abrí el hilo. Sin marca de lectura, todos. */
export function noLeidos(mensajes: readonly Pick<MensajeDeAyuda, "author_id" | "created_at">[], yoId: string, leidoHasta: string | null | undefined): number {
  const corte = leidoHasta ? new Date(leidoHasta).getTime() : -Infinity;
  return mensajes.filter((m) => m.author_id !== yoId && new Date(m.created_at).getTime() > corte).length;
}

/**
 * El hilo entero, en orden: la solicitud original pintada como primer mensaje —no se migra nada, se
 * queda donde está— y después lo que se haya escrito.
 */
export function hiloCompleto(s: SolicitudDeAyuda, mensajes: readonly MensajeDeAyuda[]): MensajeDeAyuda[] {
  const original: MensajeDeAyuda = {
    id: `solicitud:${s.id}`, request_id: s.id, author_id: s.user_id, author_name: quienEscribe(s),
    body: s.message, files: adjuntosDe(s), created_at: s.created_at,
  };
  const suyos = mensajes.filter((m) => m.request_id === s.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [original, ...suyos];
}

/** Lo que se va a enviar, o por qué no. */
export function cuerpoDelMensaje(escrito: string): { ok: true; body: string } | { ok: false; motivo: "vacio" | "largo" } {
  const body = escrito.trim();
  if (!body) return { ok: false, motivo: "vacio" };
  if (body.length > LIMITE_DEL_MENSAJE) return { ok: false, motivo: "largo" };
  return { ok: true, body };
}

/**
 * Los no leídos repartidos entre las dos tarjetas del lobby: los de MIS solicitudes van a «Mis
 * solicitudes», y los de las ajenas —que solo un admin puede tener— a la vista del admin. Un admin que
 * pidió ayuda no ve la respuesta contada dos veces.
 */
export function repartoDeNoLeidos(porSolicitud: ReadonlyMap<string, number>, misSolicitudes: readonly string[]): { mias: number; ajenas: number } {
  const mias = new Set(misSolicitudes);
  let a = 0, b = 0;
  for (const [id, n] of porSolicitud) { if (mias.has(id)) a += n; else b += n; }
  return { mias: a, ajenas: b };
}

/** Los no leídos de cada solicitud, para los contadores de la lista. */
export function noLeidosPorSolicitud(
  mensajes: readonly Pick<MensajeDeAyuda, "request_id" | "author_id" | "created_at">[],
  lecturas: readonly { request_id: string; read_at: string }[],
  yoId: string,
): Map<string, number> {
  const leido = new Map(lecturas.map((l) => [l.request_id, l.read_at]));
  const porHilo = new Map<string, Pick<MensajeDeAyuda, "author_id" | "created_at">[]>();
  for (const m of mensajes) porHilo.set(m.request_id, [...(porHilo.get(m.request_id) ?? []), m]);
  const r = new Map<string, number>();
  for (const [id, ms] of porHilo) {
    const n = noLeidos(ms, yoId, leido.get(id));
    if (n > 0) r.set(id, n);
  }
  return r;
}
