/**
 * Del texto que el candidato contesta en Indeed saca el teléfono y la hora a la que quiere que lo llamen, y decide qué
 * hacer con el calendario de RR. HH. PURO: sin base, sin red. Las horas son de Brownsville (America/Chicago).
 *
 * Qué se entiende (EN y ES, sin tildes):
 *   - Teléfono de 10 dígitos en cualquier formato habitual (ver telefonoDe).
 *   - Día: «today/hoy», «tomorrow/mañana», día de la semana («Monday», «lunes»…), fecha «11/18» o «Nov 18»/«18 de noviembre».
 *   - Hora: «12pm», «3:30 pm», «10 am», «at 10», «a las 3», «after 3», «noon/mediodía», «15:00».
 *   - Sin am/pm, la hora se interpreta como de horario laboral: 1–6 → tarde, 8–11 → mañana, 12 → mediodía. 7 y 0 son
 *     ambiguas: no se agenda.
 *   - «anytime / any time / whenever / cualquier hora» → cualquiera (sin hora fija).
 * Día sin hora, hora sin entender, o dos horas distintas en el mismo mensaje → «no entendida»: no se agenda, y la nota lo dice.
 *
 * Regla de la hora: siempre la PRÓXIMA ocurrencia futura, contada desde la fecha de recepción del correo. Si la hora
 * resultante ya pasó (correo viejo, o revisión tardía), `planearAgenda` no la pone en el pasado: la deja como pendiente.
 */
import { formatoEnBrownsville, instanteDePared, paredDeInstante } from "@/lib/recruiting/hora-de-brownsville";
import { telefonoDe } from "./indeed";

export type HoraDetectada =
  | { tipo: "fija"; iso: string; fragmento: string }
  | { tipo: "cualquiera" }
  | { tipo: "no-entendida"; fragmento: string }
  | { tipo: "ninguna" };

// ---------------------------------------------------------------------------
// Utilidades de calendario (en la hora de Chicago, con aritmética UTC sobre la fecha de reloj).
// ---------------------------------------------------------------------------

interface Partes { y: number; mo: number; d: number; h: number; mi: number; }

function partesDeChicago(iso: string): Partes | null {
  const p = paredDeInstante(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(p);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Suma días a una fecha de reloj («y, mo, d») sin pasar por ninguna zona horaria. */
function sumaDias(y: number, mo: number, d: number, n: number): { y: number; mo: number; d: number } {
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

function diaDeLaSemana(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

const fechaTexto = (f: { y: number; mo: number; d: number }) => `${f.y}-${pad(f.mo)}-${pad(f.d)}`;

/** Un instante (Chicago) con esa fecha y hora de reloj. Null si no existe. */
export function instanteDeReloj(f: { y: number; mo: number; d: number }, h: number, mi: number): string | null {
  const i = instanteDePared(`${fechaTexto(f)}T${pad(h)}:${pad(mi)}`);
  return i ? i.toISOString() : null;
}

/** El próximo día hábil (lun–vie) después de la fecha de Chicago del instante: vie → lun, sáb/dom → lun. */
export function proximoDiaHabil(iso: string): string {
  const p = partesDeChicago(iso);
  if (!p) return "";
  let f = sumaDias(p.y, p.mo, p.d, 1);
  while ([0, 6].includes(diaDeLaSemana(f.y, f.mo, f.d))) f = sumaDias(f.y, f.mo, f.d, 1);
  return fechaTexto(f);
}

/** Etiqueta corta en hora de Brownsville para el resumen («lun 16 nov, 12:00 p. m.»). */
export function cuandoEnBrownsville(iso: string): string {
  return formatoEnBrownsville(iso, "es-MX", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Lectura del texto.
// ---------------------------------------------------------------------------

const TOPE = 2000;

/** Minúsculas, sin tildes, «a.m.»→«am», espacios colapsados. */
export function normalizaTexto(s: string): string {
  return (s ?? "")
    .slice(0, TOPE)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/a\.m\./g, "am")
    .replace(/p\.m\./g, "pm")
    .replace(/\s+/g, " ");
}

/** Teléfonos en cualquier formato US: se quitan del texto antes de buscar horas, para que sus dígitos no parezcan horas. */
const RE_TEL = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

export function quitaTelefonos(s: string): string {
  return s.replace(RE_TEL, " ");
}

/** El primer teléfono de 10 dígitos del texto (sin formato), o null. */
export function telefonoDeMensaje(texto: string): string | null {
  return telefonoDe(texto.slice(0, TOPE));
}

const DIAS: Record<string, number> = {
  domingo: 0, sunday: 0, sun: 0,
  lunes: 1, monday: 1, mon: 1,
  martes: 2, tuesday: 2, tues: 2, tue: 2,
  miercoles: 3, wednesday: 3, wed: 3,
  jueves: 4, thursday: 4, thurs: 4, thur: 4, thu: 4,
  viernes: 5, friday: 5, fri: 5,
  sabado: 6, saturday: 6, sat: 6,
};
const RE_DIA = /\b(domingo|sunday|sun|lunes|monday|mon|martes|tuesday|tues|tue|miercoles|wednesday|wed|jueves|thursday|thurs|thur|thu|viernes|friday|fri|sabado|saturday|sat)\b/g;

const MESES: Record<string, number> = {
  january: 1, jan: 1, enero: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8,
  september: 9, sept: 9, sep: 9, septiembre: 9, setiembre: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12,
};
const MES_RE = Object.keys(MESES).sort((a, b) => b.length - a.length).join("|");
const RE_MES_DIA = new RegExp(`\\b(${MES_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g");
const RE_DIA_MES = new RegExp(`\\b(\\d{1,2})(?:\\s+de)?\\s+(${MES_RE})\\b`, "g");
const RE_FECHA_BARRA = /(?<![\d/:])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![\d/:])/g;

const RE_HORA_AMPM = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?![a-z])/g;
const RE_HORA_PREFIJO = /\b(at|a las|a la|@|after|despues de|around|a eso de)\s+(\d{1,2})(?::(\d{2}))?(?!\s?(?:am|pm)|[\d:])/g;
const RE_HORA_24 = /(?<![\d:/])([01]?\d|2[0-3]):([0-5]\d)(?!\s?(?:am|pm)|[\d:])/g;
const RE_MEDIODIA = /\b(noon|mediodia)\b/g;
const RE_CUALQUIERA = /\b(anytime|any time|whenever|cualquier(?:a)? (?:hora|momento|dia)|en cualquier (?:hora|momento)|a cualquier hora)\b/;

interface HoraCruda { h: number; mi: number; fragmento: string; ambigua: boolean; }

/** Las horas que aparecen, ya en 24 h. `ambigua` = no se puede saber si es mañana o tarde. */
function horasDelTexto(s: string): HoraCruda[] {
  const out: HoraCruda[] = [];
  for (const m of s.matchAll(RE_HORA_AMPM)) {
    let h = +m[1];
    const mi = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12) { out.push({ h, mi, fragmento: m[0], ambigua: true }); continue; }
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    out.push({ h, mi, fragmento: m[0], ambigua: false });
  }
  for (const m of s.matchAll(RE_HORA_24)) {
    out.push({ h: +m[1], mi: +m[2], fragmento: m[0], ambigua: false });
  }
  for (const m of s.matchAll(RE_HORA_PREFIJO)) {
    const h0 = +m[2];
    const mi = m[3] ? +m[3] : 0;
    let h = h0;
    let ambigua = false;
    if (h0 >= 1 && h0 <= 6) h = h0 + 12; // «after 3», «at 3»: tarde
    else if (h0 >= 8 && h0 <= 11) h = h0; // mañana
    else if (h0 === 12) h = 12;
    else ambigua = true; // 0, 7, 13+
    out.push({ h, mi, fragmento: m[0], ambigua });
  }
  for (const m of s.matchAll(RE_MEDIODIA)) out.push({ h: 12, mi: 0, fragmento: m[0], ambigua: false });
  return out;
}

/** La fecha que pide el texto: hoy, mañana, un día de la semana o una fecha exacta. */
type DiaPedido =
  | { tipo: "hoy"; fragmento: string }
  | { tipo: "manana"; fragmento: string }
  | { tipo: "semana"; dow: number; fragmento: string }
  | { tipo: "fecha"; mo: number; d: number; y: number | null; fragmento: string };

function diasDelTexto(s: string): DiaPedido[] {
  const out: DiaPedido[] = [];
  for (const m of s.matchAll(/\b(today|hoy)\b/g)) out.push({ tipo: "hoy", fragmento: m[0] });
  // «mañana» sin tilde; «por la mañana / en la mañana» es la parte del día, no el día de mañana.
  for (const m of s.matchAll(/\b(tomorrow|manana)\b/g)) {
    const antes = s.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (/(por la|en la|de la|por el)\s*$/.test(antes)) continue;
    out.push({ tipo: "manana", fragmento: m[0] });
  }
  for (const m of s.matchAll(RE_DIA)) out.push({ tipo: "semana", dow: DIAS[m[0]], fragmento: m[0] });
  for (const m of s.matchAll(RE_MES_DIA)) out.push({ tipo: "fecha", mo: MESES[m[1]], d: +m[2], y: null, fragmento: m[0] });
  for (const m of s.matchAll(RE_DIA_MES)) out.push({ tipo: "fecha", mo: MESES[m[2]], d: +m[1], y: null, fragmento: m[0] });
  for (const m of s.matchAll(RE_FECHA_BARRA)) {
    const a = +m[1];
    const b = +m[2];
    if (a < 1 || a > 12 || b < 1 || b > 31) continue; // US: mes/día
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null;
    out.push({ tipo: "fecha", mo: a, d: b, y, fragmento: m[0] });
  }
  return out;
}

/**
 * La hora de llamada del texto, resuelta desde la fecha de recepción (`recibidoIso`). Nunca lanza.
 */
export function horaDeLlamada(texto: string, recibidoIso: string): HoraDetectada {
  const s = quitaTelefonos(normalizaTexto(texto));
  const horas = horasDelTexto(s);
  const dias = diasDelTexto(s);
  const cualquiera = RE_CUALQUIERA.test(s);

  if (horas.length === 0) {
    if (dias.length > 0) return { tipo: "no-entendida", fragmento: dias[0].fragmento };
    return cualquiera ? { tipo: "cualquiera" } : { tipo: "ninguna" };
  }
  const fragmento = horas[0].fragmento;
  if (horas.some((x) => x.ambigua)) return { tipo: "no-entendida", fragmento: horas.find((x) => x.ambigua)!.fragmento };
  const distintas = new Set(horas.map((x) => x.h * 60 + x.mi));
  if (distintas.size > 1) return { tipo: "no-entendida", fragmento: "varias horas" };
  const { h, mi } = horas[0];
  if (h < 7 || h > 20) return { tipo: "no-entendida", fragmento };

  const hoy = partesDeChicago(recibidoIso);
  if (!hoy) return { tipo: "no-entendida", fragmento };

  // Un solo día pedido, o ninguno (en ese caso, la próxima vez que sea esa hora).
  const tipos = new Set(dias.map((x) => (x.tipo === "semana" ? `s${x.dow}` : x.tipo === "fecha" ? `f${x.mo}-${x.d}-${x.y}` : x.tipo)));
  if (tipos.size > 1) return { tipo: "no-entendida", fragmento: "varios días" };
  const dia = dias[0];
  let f: { y: number; mo: number; d: number } | null = null;
  if (!dia) {
    const hoyHora = instanteDeReloj({ y: hoy.y, mo: hoy.mo, d: hoy.d }, h, mi);
    f = hoyHora && Date.parse(hoyHora) > Date.parse(recibidoIso) ? { y: hoy.y, mo: hoy.mo, d: hoy.d } : sumaDias(hoy.y, hoy.mo, hoy.d, 1);
  } else if (dia.tipo === "hoy") {
    f = { y: hoy.y, mo: hoy.mo, d: hoy.d };
  } else if (dia.tipo === "manana") {
    f = sumaDias(hoy.y, hoy.mo, hoy.d, 1);
  } else if (dia.tipo === "semana") {
    let n = (dia.dow - diaDeLaSemana(hoy.y, hoy.mo, hoy.d) + 7) % 7;
    const hoyHora = instanteDeReloj({ y: hoy.y, mo: hoy.mo, d: hoy.d }, h, mi);
    if (n === 0 && hoyHora && Date.parse(hoyHora) <= Date.parse(recibidoIso)) n = 7;
    f = sumaDias(hoy.y, hoy.mo, hoy.d, n);
  } else {
    let y = dia.y ?? hoy.y;
    let iso = instanteDeReloj({ y, mo: dia.mo, d: dia.d }, h, mi);
    if (dia.y === null && iso && Date.parse(iso) <= Date.parse(recibidoIso)) {
      y += 1;
      iso = instanteDeReloj({ y, mo: dia.mo, d: dia.d }, h, mi);
    }
    if (!iso) return { tipo: "no-entendida", fragmento: dia.fragmento };
    return { tipo: "fija", iso, fragmento: `${dia.fragmento} ${fragmento}`.trim() };
  }
  const iso = instanteDeReloj(f, h, mi);
  if (!iso) return { tipo: "no-entendida", fragmento };
  return { tipo: "fija", iso, fragmento: dia ? `${dia.fragmento} ${fragmento}`.trim() : fragmento };
}

// ---------------------------------------------------------------------------
// Qué hacer con el calendario.
// ---------------------------------------------------------------------------

export type PlanAgenda =
  /** Poner `phone_date` = iso. `reemplaza`: ya había una llamada futura y el mensaje da otra hora (se cambia esa). */
  | { accion: "agendar"; iso: string; reemplaza: boolean; pendiente: boolean; detalle: string }
  /** Poner `follow_up` = dia («cualquier hora»: la tarea aparece en Hoy ese día). */
  | { accion: "seguimiento"; dia: string; detalle: string }
  | { accion: "ninguna"; detalle: string };

export interface EntradaAgenda {
  hora: HoraDetectada;
  /** Fecha de recepción del correo (ISO). */
  recibido: string;
  /** Ahora (ISO): la hora de la corrida. Decide si la hora ya pasó. */
  ahora: string;
  /** Llamada futura que ya tiene el candidato (`phone_date`), o null. */
  citaFuturaIso: string | null;
  /** Seguimiento que ya tiene (`follow_up`), o null. */
  seguimientoActual: string | null;
  /** Nombres de otros candidatos con llamada a esa misma hora (choque). Vacío si no hay. */
  choques: string[];
}

export function planearAgenda(e: EntradaAgenda): PlanAgenda {
  const h = e.hora;
  const fecha = (iso: string) => cuandoEnBrownsville(iso);
  const cita = e.citaFuturaIso && Date.parse(e.citaFuturaIso) > Date.parse(e.ahora) ? e.citaFuturaIso : null;

  if (h.tipo === "ninguna") return { accion: "ninguna", detalle: "Sin hora en el mensaje." };
  if (h.tipo === "no-entendida") return { accion: "ninguna", detalle: `Hora no entendida: «${h.fragmento}». No se agendó.` };

  if (h.tipo === "cualquiera") {
    if (cita) return { accion: "ninguna", detalle: `Cualquier hora. Ya tiene llamada el ${fecha(cita)}; no se cambió.` };
    const base = Date.parse(e.ahora) > Date.parse(e.recibido) ? e.ahora : e.recibido;
    const dia = proximoDiaHabil(new Date(base).toISOString());
    if (e.seguimientoActual && e.seguimientoActual <= dia) {
      return { accion: "ninguna", detalle: `Cualquier hora. Ya tiene seguimiento el ${e.seguimientoActual}.` };
    }
    return { accion: "seguimiento", dia, detalle: `Cualquier hora: tarea de llamada para el ${dia}.` };
  }

  // Hora fija.
  const pedidaEl = fecha(e.recibido);
  if (Date.parse(h.iso) <= Date.parse(e.ahora)) {
    // Ya pasó (correo viejo o revisión tardía): no se pone en el pasado. Pendiente el siguiente día hábil, 9:00.
    if (cita) return { accion: "ninguna", detalle: `La hora pasó (pidió «${h.fragmento}» el ${pedidaEl}). Ya tiene llamada el ${fecha(cita)}; no se cambió.` };
    const dia = proximoDiaHabil(e.ahora);
    const iso = instanteDeReloj({ y: +dia.slice(0, 4), mo: +dia.slice(5, 7), d: +dia.slice(8, 10) }, 9, 0);
    if (!iso) return { accion: "ninguna", detalle: "No se pudo fijar el pendiente." };
    return {
      accion: "agendar",
      iso,
      reemplaza: false,
      pendiente: true,
      detalle: `Hora pasada: pidió «${h.fragmento}» el ${pedidaEl}. Pendiente ${cuandoEnBrownsville(iso)}.`,
    };
  }
  if (cita) {
    if (Math.abs(Date.parse(cita) - Date.parse(h.iso)) < 60_000) {
      return { accion: "ninguna", detalle: `Misma hora que la llamada ya agendada (${fecha(cita)}).` };
    }
    return { accion: "agendar", iso: h.iso, reemplaza: true, pendiente: false, detalle: `Nueva hora: ${fecha(h.iso)} (antes ${fecha(cita)}). Duración 15 min.` };
  }
  if (e.choques.length) {
    return { accion: "ninguna", detalle: `La hora ${fecha(h.iso)} choca con ${e.choques.join(", ")}. No se agendó.` };
  }
  return { accion: "agendar", iso: h.iso, reemplaza: false, pendiente: false, detalle: `Llamada ${fecha(h.iso)}. Duración 15 min.` };
}
