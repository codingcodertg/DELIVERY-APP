import type { Candidate, Contact, Stage } from "./types";
import { LOCATIONS } from "./constants";
import { fmtDateTime, mergeTemplate, rcSms, telClean } from "./utils";
import { diaEnBrownsville, formatoEnBrownsville, hoyEnBrownsville, instanteDePared, sumarDias } from "./hora-de-brownsville";

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

/** La fecha del `<input type="datetime-local">`, en hora de BROWNSVILLE (no la del aparato): tiene que existir y ser futura. */
export function validarFechaPresencial(local: string, ahora: Date = new Date()): FechaValidada {
  if (!local.trim()) return { ok: false, motivo: "sin-fecha" };
  const d = instanteDePared(local);
  if (!d) return { ok: false, motivo: "invalida" };
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

/** Marcadores de la cita, además de los de `mergeTemplate` ({name} {role} {recruiter} {phone}). `{when}` = «mañana a las
 *  10:00 a.m.» / «hoy a las…» / «el martes 20 de octubre a las…»; `{day}` = «mañana» / «hoy» / «el martes». */
export const MARCADORES_DE_LA_CITA = "{when} {day} {date} {time} {place} {address} {maps}";

/** El enlace para llegar a la tienda, desde su dirección (D-717, el dueño: «un link de Google Maps o de Waze … que solo
 *  apriete ahí y se abra»). D-764: solo Google Maps; con los dos, el SMS pasaba del largo que admite el chat
 *  («Your message is too long», el dueño, 2026-10-30: «solo deja el link de google maps»). Sin dirección, nada. */
export function enlacesDeMapa(address: string | null | undefined): string {
  const q = direccionCorta(address);
  if (!q) return "";
  // D-970: el enlace corto de Google Maps (`maps.google.com/?q=`), con los espacios como «+» y las comas tal cual. El
  // largo (`/maps/search/?api=1&query=` con todo en %20/%2C) triplicaba la dirección y el SMS volvía a pasar del límite
  // («Your message is too long», el dueño, 2026-11-10: «hay que acortar eso mira eso del mapa creo que esta muy largo»).
  const e = q.split(/\s+/).map((w) => encodeURIComponent(w).replace(/%2C/gi, ",")).join("+");
  return `Google Maps: https://maps.google.com/?q=${e}`;
}

/** La dirección para el candidato, sin lo que no le sirve para llegar (D-970): sin el país («United States [of America]»),
 *  sin el condado («Hidalgo County»), sin la colonia que añade el geocodificador («L R Bell Colonia»), con «Texas» → «TX»
 *  y sin la coma entre el número y la calle («1120, East…» → «1120 East…»). Lo que no reconoce lo deja igual. */
export function direccionCorta(address: string | null | undefined): string {
  const partes = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean)
    .filter((p) => !/^united states( of america)?$|^usa?$/i.test(p) && !/\bcounty$/i.test(p) && !/\bcolonia$/i.test(p))
    .map((p) => p.replace(/^texas$/i, "TX"));
  if (partes.length > 1 && /^\d+[a-z]?$/i.test(partes[0])) partes.splice(0, 2, `${partes[0]} ${partes[1]}`);
  // «TX, 78577» → «TX 78577»
  const i = partes.findIndex((p, k) => /^\d{5}(-\d{4})?$/.test(p) && k > 0 && /^[A-Z]{2}$/.test(partes[k - 1]));
  if (i > 0) partes.splice(i - 1, 2, `${partes[i - 1]} ${partes[i]}`);
  return partes.join(", ");
}

/** La plantilla del dueño (D-604, 2026-10-19: «así es el template que yo uso, no me gustó el que hiciste»), letra por letra,
 *  con «Andrés» → `{recruiter}`, «mañana a las 10:00 a.m.» → `{when}`, «mañana» → `{day}` y el bloque de la dirección →
 *  `{address}` (la de Datos → Tiendas). Sin tienda conocida (un «Otro…» a mano), «en {place}» en vez del bloque. */
const PLANTILLA = {
  en: {
    tienda: "Hello, this is {recruiter}, recruiter at Rodriguez Tile Group. Thank you for your time. I'm confirming your in-person interview for {when} at our office:\n\nRodriguez Tile Group\n{address}\n{maps}\n\nPlease arrive a few minutes early and bring an ID. If you have any questions or need to change the time, reply to this number.\n\nSee you {day},\n{recruiter}\nRodriguez Tile Group",
    libre: "Hello, this is {recruiter}, recruiter at Rodriguez Tile Group. Thank you for your time. I'm confirming your in-person interview for {when} at {place}.\n\nPlease arrive a few minutes early and bring an ID. If you have any questions or need to change the time, reply to this number.\n\nSee you {day},\n{recruiter}\nRodriguez Tile Group",
  },
  es: {
    tienda: "Hola, le habla {recruiter}, reclutador de Rodriguez Tile Group. Gracias por su tiempo. Le confirmo su entrevista presencial para {when} en nuestra oficina:\n\nRodriguez Tile Group\n{address}\n{maps}\n\nPor favor llegue unos minutos antes y traiga una identificación. Cualquier duda o si necesita cambiar la hora, respóndame a este número.\n\nNos vemos {day},\n{recruiter}\nRodriguez Tile Group",
    libre: "Hola, le habla {recruiter}, reclutador de Rodriguez Tile Group. Gracias por su tiempo. Le confirmo su entrevista presencial para {when} en {place}.\n\nPor favor llegue unos minutos antes y traiga una identificación. Cualquier duda o si necesita cambiar la hora, respóndame a este número.\n\nNos vemos {day},\n{recruiter}\nRodriguez Tile Group",
  },
} as const;

const ETIQUETA_DE_PLANTILLA = /presencial|in[- ]?person/i;

/** La plantilla de Ajustes → Plantillas que manda sobre la de aquí (por el nombre), o null si no hay. */
export function plantillaDeAjustes(templates: readonly { label: string; text: string }[]): string | null {
  const t = templates.find((x) => ETIQUETA_DE_PLANTILLA.test(x.label) && x.text.trim());
  return t ? t.text : null;
}

/** `{date}`, `{time}`, y los del dueño: `{when}` («mañana a las 10:00 a.m.») y `{day}` («mañana»), todo en hora de
 *  Brownsville: el candidato va a una tienda de Texas, y «hoy» / «mañana» son los de allí. `ahora` solo para medir. */
export function fechaYHora(iso: string, lang: "en" | "es", ahora: Date = new Date()): { date: string; time: string; when: string; day: string } {
  const locale = lang === "es" ? "es-MX" : "en-US";
  const date = formatoEnBrownsville(iso, locale, { weekday: "long", day: "numeric", month: "long" });
  const time = formatoEnBrownsville(iso, locale, { hour: "numeric", minute: "2-digit" }).replace(/\s+/g, " ").trim();
  const hoy = hoyEnBrownsville(ahora);
  const manana = sumarDias(hoy, 1);
  const dia = diaEnBrownsville(iso);
  const day = dia === hoy ? (lang === "es" ? "hoy" : "today")
    : dia === manana ? (lang === "es" ? "mañana" : "tomorrow")
    : (lang === "es" ? "el " : "on ") + formatoEnBrownsville(iso, locale, { weekday: "long" });
  const when = dia === hoy || dia === manana
    ? `${day} ${lang === "es" ? "a las" : "at"} ${time}`
    : `${lang === "es" ? "el" : ""} ${date} ${lang === "es" ? "a las" : "at"} ${time}`.trim();
  return { date, time, when, day };
}

export type Cita = { iso: string; lugar: string };

/**
 * El texto de la cita: nombre de pila, puesto, fecha, hora, lugar y la dirección de la tienda, en el idioma de quien
 * pulsa. `tiendas` son las de Datos → Tiendas (nombre y dirección); `plantilla` es la de Ajustes si la hay.
 */
export function textoConfirmacionPresencial(
  c: Cand, cita: Cita, recruiter: string, lang: "en" | "es",
  tiendas: readonly Tienda[] = [], plantilla: string | null = null, ahora: Date = new Date(),
): string {
  const { date, time, when, day } = fechaYHora(cita.iso, lang, ahora);
  const lugar = cita.lugar.trim() || (lang === "es" ? "nuestra oficina" : "our office");
  const tienda = tiendaDelLugar(lugar, tiendas);
  let base = plantilla ?? PLANTILLA[lang][tienda ? "tienda" : "libre"];
  // Una plantilla de Ajustes escrita antes de D-717 no lleva {maps}: los enlaces van debajo de la dirección igual.
  if (tienda && !base.includes("{maps}") && base.includes("{address}")) base = base.replace("{address}", "{address}\n{maps}");
  return mergeTemplate(base, c as Candidate, recruiter)
    .replace(/\{when\}/g, when)
    .replace(/\{day\}/g, day)
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{place\}/g, lugar)
    .replace(/\{maps\}/g, tienda ? enlacesDeMapa(tienda.address) : "")
    .replace(/\{address\}/g, tienda ? direccionCorta(tienda.address) : lugar)
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
