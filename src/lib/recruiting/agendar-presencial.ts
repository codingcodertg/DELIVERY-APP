import type { Candidate, Contact, Stage } from "./types";
import { LOCATIONS } from "./constants";
import { fmtDateTime, mergeTemplate, rcSms, telClean } from "./utils";

/* ---- «📅 Agendar entrevista presencial» al terminar la entrevista (D-585) ----
 * El dueño pidió (2026-10-18): «en hr manager al terminar la entrevista que este el boton para
 * scheudle in person interview». Medido: ya existía el diálogo «🤝 Agendar presencial» (fecha y
 * hora, pasa a la etapa `inperson`, deja un contacto «In person / Scheduled»), pero no se llegaba
 * a él desde la entrevista: al guardar, el diálogo se cerraba y había que buscar al candidato otra
 * vez. Aquí va la lógica del diálogo ampliado —fecha futura, lugar, nota, etapa, contacto y el
 * texto de confirmación por el MISMO camino que D-581 (enlace rcsms a RingCentral)— para medirla. */

export const ETAPA_PRESENCIAL = "inperson";
export const RESULTADO_AGENDADA = "Scheduled";

type Cand = Pick<Candidate, "name" | "role"> & { phone: string | null };

export type FechaValidada =
  | { ok: true; iso: string }
  | { ok: false; motivo: "sin-fecha" | "invalida" | "en-el-pasado" };

/** La fecha del `<input type="datetime-local">` (hora local): tiene que existir y ser futura. */
export function validarFechaPresencial(local: string, ahora: Date = new Date()): FechaValidada {
  if (!local.trim()) return { ok: false, motivo: "sin-fecha" };
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return { ok: false, motivo: "invalida" };
  if (d.getTime() <= ahora.getTime()) return { ok: false, motivo: "en-el-pasado" };
  return { ok: true, iso: d.toISOString() };
}

/** Los lugares que se ofrecen: las sedes de RR. HH. (sin el «TBD»), más el que ya tenga escrito el candidato. */
export function lugaresParaAgendar(actual = ""): string[] {
  const base = LOCATIONS.filter((l) => l !== "TBD");
  const extra = actual.trim();
  return extra && !base.includes(extra) ? [...base, extra] : base;
}

/**
 * La etapa en que queda el candidato: «Entrevista presencial» si existe en el pipeline y el candidato
 * sigue activo. Un contratado o descartado no vuelve atrás por agendar; y si la etapa no existe, se queda donde está.
 */
export function etapaTrasAgendar(stages: readonly Stage[], estadoActual: string): string {
  const presencial = stages.find((s) => s.key === ETAPA_PRESENCIAL);
  if (!presencial) return estadoActual;
  const actual = stages.find((s) => s.key === estadoActual);
  if (actual && actual.type !== "active") return estadoActual;
  return ETAPA_PRESENCIAL;
}

/** El contacto que deja la cita: el mismo renglón «In person / Scheduled» de siempre, con lugar y nota detrás de la fecha. */
export function contactoDeLaCita(iso: string, lugar: string, nota: string): Pick<Contact, "type" | "result" | "note"> {
  const partes = [fmtDateTime(iso), lugar.trim(), nota.trim()].filter(Boolean);
  return { type: "In person", result: RESULTADO_AGENDADA, note: partes.join(" · ") };
}

const PLANTILLA = {
  en: "Hi {name}, this is {recruiter} from RDZ Tile Group. Your in-person interview for the {role} position is scheduled for {date} at {time}, at {place}. Please reply to confirm. Thanks!",
  es: "Hola {name}, soy {recruiter} de RDZ Tile Group. Tu entrevista presencial para el puesto de {role} queda el {date} a las {time}, en {place}. Por favor respóndeme para confirmar. ¡Gracias!",
} as const;

function fechaYHora(iso: string, lang: "en" | "es"): { date: string; time: string } {
  const d = new Date(iso);
  const locale = lang === "es" ? "es-MX" : "en-US";
  return {
    date: d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
    time: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
  };
}

/** El texto de confirmación: nombre de pila, puesto, fecha, hora y lugar, en el idioma de quien pulsa. */
export function textoConfirmacionPresencial(c: Cand, cita: { iso: string; lugar: string }, recruiter: string, lang: "en" | "es"): string {
  const { date, time } = fechaYHora(cita.iso, lang);
  const lugar = cita.lugar.trim() || (lang === "es" ? "nuestra oficina" : "our office");
  return mergeTemplate(PLANTILLA[lang], c as Candidate, recruiter)
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{place\}/g, lugar)
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type Confirmacion =
  | { ok: true; texto: string; enlace: string }
  | { ok: false; motivo: "sin-telefono" };

/** Qué abre el botón «📱 Mandar confirmación»: el enlace de RingCentral con el texto, o por qué no. Nunca manda nada solo. */
export function prepararConfirmacionPresencial(c: Cand, cita: { iso: string; lugar: string }, recruiter: string, lang: "en" | "es"): Confirmacion {
  if (!telClean(c.phone)) return { ok: false, motivo: "sin-telefono" };
  const texto = textoConfirmacionPresencial(c, cita, recruiter, lang);
  return { ok: true, texto, enlace: rcSms(c.phone, texto) };
}

/** El contacto del texto de confirmación: mismo `type` SMS que el diálogo, marcado para distinguirlo. */
export const RESULTADO_CONFIRMACION = "sent · in-person confirmation";
export function contactoDeLaConfirmacion(texto: string): Pick<Contact, "type" | "result" | "note"> {
  return { type: "SMS", result: RESULTADO_CONFIRMACION, note: texto.slice(0, 80) };
}
