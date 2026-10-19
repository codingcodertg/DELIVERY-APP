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

/* ---- El texto de la cita con la dirección de la tienda (D-597, 2026-10-19) ----
 * El dueño: «cuando yo pongo la fecha y la hora y el lugar, quiero que el sistema automáticamente me haga un template
 * para mandárselo por texto a la persona … te espero mañana en la tienda de Edinburg, Texas, en esta dirección, y que
 * me ponga la dirección de la tienda … que el template se pueda editar también … cuando yo le guarde la entrevista, se
 * mande por mensaje de texto, un solo template». Hasta aquí (D-585) el texto salía DESPUÉS de guardar, en un segundo
 * botón, sin dirección y sin poder tocarlo. Ahora: el texto se arma mientras se rellena el diálogo (fecha, hora, lugar
 * y la dirección de esa tienda, leída de Datos → Tiendas de Entregas por `/api/recruiting/stores`), se puede editar en
 * el propio diálogo, y «Guardar y mandar texto» hace las dos cosas de un golpe. Si en Ajustes → Plantillas hay una
 * cuyo nombre lleve «presencial» o «in person», esa manda sobre la de aquí (así se cambia el texto sin tocar código). */

export type Tienda = { name: string; address: string };

/** La tienda de Datos → Tiendas que corresponde al lugar elegido: por nombre exacto o por palabra («Edinburg» ↔ «RDZ Edinburg»). */
export function tiendaDelLugar(lugar: string, tiendas: readonly Tienda[]): Tienda | null {
  const l = lugar.trim().toLowerCase();
  if (!l) return null;
  const exacta = tiendas.find((t) => t.name.trim().toLowerCase() === l);
  if (exacta) return exacta;
  return tiendas.find((t) => t.name.toLowerCase().split(/\s+/).includes(l)) ?? null;
}

/** Marcadores de la cita, además de los de `mergeTemplate` ({name} {role} {recruiter} {phone}). */
export const MARCADORES_DE_LA_CITA = "{date} {time} {place} {address}";

const PLANTILLA = {
  // Con tienda conocida: lugar + dirección. Sin tienda (un «Otro…» escrito a mano): el lugar tal cual.
  en: {
    tienda: "Hello {name}, this is {recruiter} from Rodriguez Tile Group. I'll be expecting you on {date} at {time} for your in-person interview for the {role} position at our {place} store, at this address: {address}. Please reply to confirm. Thank you!",
    libre: "Hello {name}, this is {recruiter} from Rodriguez Tile Group. I'll be expecting you on {date} at {time} for your in-person interview for the {role} position at {place}. Please reply to confirm. Thank you!",
  },
  es: {
    tienda: "Hola {name}, le habla {recruiter} de Rodriguez Tile Group. Le espero el {date} a las {time} para su entrevista presencial para el puesto de {role} en la tienda de {place}, en esta dirección: {address}. Por favor respóndame para confirmar. ¡Gracias!",
    libre: "Hola {name}, le habla {recruiter} de Rodriguez Tile Group. Le espero el {date} a las {time} para su entrevista presencial para el puesto de {role} en {place}. Por favor respóndame para confirmar. ¡Gracias!",
  },
} as const;

const ETIQUETA_DE_PLANTILLA = /presencial|in[- ]?person/i;

/** La plantilla de Ajustes → Plantillas que manda sobre la de aquí (por el nombre), o null si no hay. */
export function plantillaDeAjustes(templates: readonly { label: string; text: string }[]): string | null {
  const t = templates.find((x) => ETIQUETA_DE_PLANTILLA.test(x.label) && x.text.trim());
  return t ? t.text : null;
}

function fechaYHora(iso: string, lang: "en" | "es"): { date: string; time: string } {
  const d = new Date(iso);
  const locale = lang === "es" ? "es-MX" : "en-US";
  return {
    date: d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
    time: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
  };
}

export type Cita = { iso: string; lugar: string };

/**
 * El texto de la cita: nombre de pila, puesto, fecha, hora, lugar y la dirección de la tienda, en el idioma de quien
 * pulsa. `tiendas` son las de Datos → Tiendas (nombre y dirección); `plantilla` es la de Ajustes si la hay.
 */
export function textoConfirmacionPresencial(
  c: Cand, cita: Cita, recruiter: string, lang: "en" | "es",
  tiendas: readonly Tienda[] = [], plantilla: string | null = null,
): string {
  const { date, time } = fechaYHora(cita.iso, lang);
  const lugar = cita.lugar.trim() || (lang === "es" ? "nuestra oficina" : "our office");
  const tienda = tiendaDelLugar(lugar, tiendas);
  const base = plantilla ?? PLANTILLA[lang][tienda ? "tienda" : "libre"];
  return mergeTemplate(base, c as Candidate, recruiter)
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{place\}/g, lugar)
    .replace(/\{address\}/g, tienda?.address ?? lugar)
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type Confirmacion =
  | { ok: true; texto: string; enlace: string }
  | { ok: false; motivo: "sin-telefono" | "sin-texto" };

/** Qué abre «Guardar y mandar texto»: el enlace de RingCentral con el texto (ya editado), o por qué no. Nunca manda nada solo. */
export function prepararConfirmacionPresencial(c: Cand, texto: string): Confirmacion {
  if (!telClean(c.phone)) return { ok: false, motivo: "sin-telefono" };
  const limpio = texto.trim();
  if (!limpio) return { ok: false, motivo: "sin-texto" };
  return { ok: true, texto: limpio, enlace: rcSms(c.phone, limpio) };
}

/** El contacto del texto de confirmación: mismo `type` SMS que el diálogo, marcado para distinguirlo. */
export const RESULTADO_CONFIRMACION = "sent · in-person confirmation";
export function contactoDeLaConfirmacion(texto: string): Pick<Contact, "type" | "result" | "note"> {
  return { type: "SMS", result: RESULTADO_CONFIRMACION, note: texto.slice(0, 80) };
}
