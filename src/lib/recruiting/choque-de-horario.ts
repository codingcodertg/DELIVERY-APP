import type { Candidate } from "./types";
import { formatoEnBrownsville } from "./hora-de-brownsville";

/* ---- «Ya hay alguien agendado a esa hora» (D-632, 2026-10-21) ----
 * El dueño: «cuando esté scheduling candidates … no me dejes schedule candidates a la misma hora. Dame un warning, hey,
 * esto estás haciendo para la misma hora, detente, o así, o estás seguro». Medido en producción ese día: Karina
 * Tijerina y Cristy Caballero tenían la MISMA cita presencial (21-oct, Pharr), y en julio otras dos coincidían.
 *
 * La regla (se avisa, no se bloquea: «o estás seguro»):
 * - Presencial contra presencial, en CUALQUIER sede. El lugar que se elige en el diálogo no se guarda en el candidato
 *   (solo va en la nota del contacto), así que comparar por `location` dejaría pasar justo el caso de dos citas en la
 *   misma tienda con la sede del candidato distinta. Y el dueño dijo «a la misma hora», sin tienda.
 * - Llamada contra llamada del MISMO reclutador (`assigned_recruiter`; sin asignar cuenta como uno más). Una llamada que
 *   ya se hizo (hay entrevista guardada) no ocupa la hora.
 * - Chocan si empiezan a menos de 30 minutos una de otra: 3:00 y 3:15 chocan; 3:00 y 3:30, no.
 * - No cuentan el propio candidato, los archivados ni los que ya están en una etapa final (contratado / descartado).
 * - D-667: una LLAMADA para ahora mismo no es una cita, es la entrevista que se va a hacer ya: no avisa. El dueño,
 *   2026-10-24, con el aviso «Ya hay Jorge Galvan agendado a esa hora (11:30 a.m.)» al pulsar «Ahorita» a las 11:35:
 *   «cuando yo le doy llamar ahorita no cuenta, solamente cuando agendo ahead of time». Por la hora y no por el botón:
 *   escribir la hora de ahora a mano es lo mismo, y el formulario se rellena unos minutos después de pulsarlo.
 */

export const VENTANA_DE_CHOQUE_MIN = 30;
/** Hasta cuántos minutos por delante de ahora una llamada es «ahorita» (y no avisa). */
export const MARGEN_DE_AHORITA_MIN = 5;

export type TipoDeCita = "llamada" | "presencial";

export type Choque = { id: string; nombre: string; cuando: string; lugar: string | null };

type Cand = Pick<Candidate, "id" | "name" | "status" | "archived" | "phone_date" | "inperson_date" | "assigned_recruiter" | "interview" | "location">;

export type PedidoDeCita = {
  /** El candidato que se agenda (null si aún no existe: el alta). */
  id: string | null;
  tipo: TipoDeCita;
  /** El instante que se va a guardar. */
  iso: string;
  /** Solo para llamadas: quién llama. */
  reclutador?: string | null;
  /** Solo para llamadas: el instante actual (ms). Con él, una llamada que empieza ya (`MARGEN_DE_AHORITA_MIN`) no avisa. */
  ahora?: number;
};

/** Los candidatos que ya tienen una cita del mismo tipo a esa hora, ordenados por hora. Vacío = se agenda sin preguntar. */
export function choquesDeHorario(
  candidatos: readonly Cand[], pedido: PedidoDeCita, terminales: ReadonlySet<string>, ventanaMin: number = VENTANA_DE_CHOQUE_MIN,
): Choque[] {
  const t = Date.parse(pedido.iso);
  if (Number.isNaN(t)) return [];
  if (pedido.tipo === "llamada" && pedido.ahora !== undefined && t <= pedido.ahora + MARGEN_DE_AHORITA_MIN * 60_000) return [];
  const ventanaMs = ventanaMin * 60_000;
  const choques: Choque[] = [];
  for (const o of candidatos) {
    if (o.id === pedido.id || o.archived || terminales.has(o.status)) continue;
    const cuando = pedido.tipo === "presencial" ? o.inperson_date : o.phone_date;
    if (!cuando) continue;
    if (pedido.tipo === "llamada") {
      if (o.interview) continue;
      if ((o.assigned_recruiter ?? null) !== (pedido.reclutador ?? null)) continue;
    }
    const otro = Date.parse(cuando);
    if (Number.isNaN(otro) || Math.abs(otro - t) >= ventanaMs) continue;
    choques.push({ id: o.id, nombre: o.name, cuando, lugar: o.location });
  }
  return choques.sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando));
}

/** La hora del otro, en Brownsville: «3:30 p.m.» / «3:30 PM». */
function hora(iso: string, lang: "en" | "es"): string {
  return formatoEnBrownsville(iso, lang === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s+/g, " ").trim();
}

/** El aviso: «⚠️ Ya hay Ana Pérez agendado a esa hora (3:30 p.m.). ¿Agendar de todos modos?». Con la sede en las presenciales. */
export function avisoDeChoque(choques: readonly Choque[], tipo: TipoDeCita, lang: "en" | "es"): string {
  if (!choques.length) return "";
  const detalle = (c: Choque) =>
    [hora(c.cuando, lang), tipo === "presencial" && c.lugar?.trim() ? c.lugar.trim() : ""].filter(Boolean).join(" · ");
  const lista = choques.map((c) => `${c.nombre} (${detalle(c)})`).join(", ");
  const [c0] = choques;
  if (lang === "es") {
    return choques.length === 1
      ? `⚠️ Ya hay ${c0.nombre} agendado a esa hora (${detalle(c0)}). ¿Agendar de todos modos?`
      : `⚠️ Ya hay ${choques.length} agendados a esa hora: ${lista}. ¿Agendar de todos modos?`;
  }
  return choques.length === 1
    ? `⚠️ ${c0.nombre} is already scheduled at that time (${detalle(c0)}). Schedule anyway?`
    : `⚠️ ${choques.length} people are already scheduled at that time: ${lista}. Schedule anyway?`;
}
