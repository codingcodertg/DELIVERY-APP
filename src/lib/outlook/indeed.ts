/**
 * Lee un correo de Indeed («alguien aplicó a tu vacante») y saca el candidato. PURO: sin red, sin base, sin reloj.
 *
 * ADVERTENCIA: los formatos de Indeed no están documentados aquí y varían (asunto, idioma, HTML o texto). Estas reglas
 * están escritas a partir de patrones habituales («New application: <Puesto> - <Nombre>», «<Nombre> applied to <Puesto>»,
 * líneas «Name:» / «Email:» / «Phone:», y la dirección relay xxx@indeedemail.com en Reply-To). Hay que probarlas con
 * correos REALES: los fixtures de `indeed.test.ts` son inventados a partir de esos patrones.
 *
 * Regla del correo: si no sale nombre, o no sale ni teléfono ni correo, NO se crea nada; el motivo se guarda para que el
 * admin lo vea en la tarjeta («omitido»).
 */
import { DOMINIOS_INDEED } from "./config";
import { enlaceConTexto, extraerEmailsLineal, textoPlanoLineal } from "./html-lineal";

export interface CorreoDeIndeed {
  subject: string;
  /** Remitente (From), p. ej. «Indeed <noreply@indeed.com>» o solo la dirección. */
  from: string;
  /** Direcciones de Reply-To (Graph: replyTo[].emailAddress.address). Indeed pone aquí el relay del candidato. */
  replyTo: string[];
  /** Cuerpo en texto o HTML, tal como llega. */
  cuerpo: string;
  /** Fecha de recepción (ISO), solo para la nota del candidato. */
  recibido: string;
  /** Dominio del buzón conectado: sus direcciones no son del candidato (p. ej. la del propio RR. HH.). */
  dominioBuzon?: string | null;
}

export interface CandidatoDeIndeed {
  name: string;
  /** Correo del candidato: directo si aparece; si no, el relay de Indeed (sirve para responder desde Indeed). */
  email: string | null;
  /** true si el correo es el relay de Indeed y no la dirección directa del candidato. */
  correoEsRelay: boolean;
  /** Teléfono en 10 dígitos (sin formato). Se formatea al guardar. */
  phone: string;
  role: string | null;
  home_location: string | null;
  /** Calificaciones de la solicitud («Forklift», «Spanish»…): van como etiquetas del candidato. */
  tags: string[];
  /** Enlaces de la solicitud. Indeed los pide con login: NO se abren aquí, solo se guardan para que RR. HH. haga clic. */
  enlaces: { solicitud: string | null; cv: string | null };
  notes: string;
}

export type ResultadoIndeed = { ok: true; candidato: CandidatoDeIndeed } | { ok: false; motivo: string };

/** ¿La dirección es de Indeed (dominio exacto o subdominio de la lista)? */
export function esDireccionIndeed(direccion: string | null | undefined): boolean {
  const dom = (direccion ?? "").split("@")[1]?.trim().toLowerCase();
  if (!dom) return false;
  return DOMINIOS_INDEED.some((d) => dom === d || dom.endsWith(`.${d}`));
}

/** Del campo From: «Indeed <noreply@indeed.com>» → «noreply@indeed.com». */
export function direccionDe(from: string | null | undefined): string {
  const m = /<([^>]+)>/.exec(from ?? "");
  return (m ? m[1] : (from ?? "")).trim().toLowerCase();
}

/** ¿Es un correo que manda Indeed? (El filtro de la corrida; el parser también lo vuelve a mirar.) */
export function esCorreoDeIndeed(from: string | null | undefined): boolean {
  return esDireccionIndeed(direccionDe(from));
}

/** El HTML (o el texto) a líneas de texto plano. Los saltos de bloque se conservan; las etiquetas, no. */
/** El HTML (o el texto) a líneas de texto plano, sin regex que retroceda; el cuerpo se acota a 200 KB. */
export function aTextoPlano(cuerpo: string): string {
  return textoPlanoLineal(cuerpo);
}

export function extraerEmails(...textos: string[]): string[] {
  return extraerEmailsLineal(...textos);
}

/** Teléfono de 10 dígitos (quita el 1 del país). Null si no es uno. Acepta «+1 (956) 555-0182», «9565550182», etc. */
export function telefonoDe(texto: string): string | null {
  const m = /(?<![\d])(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?![\d])/.exec(texto);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** Etiquetas habituales (en inglés y español). La primera que aparezca gana. */
const ETIQUETAS = {
  nombre: ["name", "applicant name", "candidate name", "full name", "nombre", "nombre del candidato", "nombre del solicitante", "candidato", "solicitante"],
  correo: ["email", "e-mail", "email address", "correo", "correo electronico", "correo electrónico", "email del candidato", "correo del candidato"],
  telefono: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "teléfono", "telefono", "celular", "móvil", "movil", "teléfono del candidato", "telefono del candidato"],
  puesto: ["job", "job title", "position", "job applied for", "applied for", "job posting", "puesto", "vacante", "posición", "posicion", "puesto solicitado"],
  ubicacion: ["location", "city", "candidate location", "ubicación", "ubicacion", "ciudad", "lugar"],
};

/** El valor de la primera línea «Etiqueta: valor» que coincida (sin distinguir mayúsculas). */
export function valorDeEtiqueta(texto: string, etiquetas: readonly string[]): string | null {
  for (const etiqueta of etiquetas) {
    const esc = etiqueta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^\\s*${esc}\\s*[:：]\\s*(.+)$`, "im");
    const m = re.exec(texto);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

/** Quita comillas, puntos finales y espacios de sobra. */
function limpiaCampo(s: string): string {
  return s.replace(/^["'«»“”]+|["'«»“”]+$/g, "").replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();
}

function esNombrePlausible(s: string): boolean {
  return s.length >= 3 && s.length <= 80 && !s.includes("@") && /\p{L}/u.test(s) && !/\d{3,}/.test(s);
}

/** Encabezado de solicitud: «Johnathon Garza applied» (o «… aplicó»). Va en el asunto o en la primera línea del cuerpo. */
export function nombreDeEncabezadoSolicitud(asunto: string, lineas: readonly string[]): string | null {
  const re = /^(.+?)\s+(?:applied|aplic[oó])\s*[.!]?$/i;
  const candidatos = [asunto ?? "", ...lineas.slice(0, 6)];
  for (const l of candidatos) {
    const m = re.exec(l.trim());
    if (m && esNombrePlausible(limpiaCampo(m[1]))) return limpiaCampo(m[1]);
  }
  return null;
}

/**
 * Enlace https de indeed.com (o subdominio) cuyo texto cumple `etiqueta` (regex sobre el texto del ancla, corta).
 * Cualquier otro host se descarta: no se guarda nada que no sea de Indeed.
 */
export function enlaceDe(cuerpo: string, etiqueta: string): string | null {
  return enlaceConTexto(cuerpo, new RegExp(etiqueta, "i"));
}

export function calificacionesDe(lineas: readonly string[]): string[] {
  const i = lineas.findIndex((l) => /^qualifications$|^calificaciones$|^cualificaciones$/i.test(l.trim()));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lineas.slice(i + 1)) {
    if (/see full application|view resume|manage|ver (la )?solicitud|ver (el )?curr[ií]culum|administrar/i.test(l)) break;
    for (const t of l.split(/\s*[·•|]\s*/)) {
      const limpio = limpiaCampo(t);
      if (limpio && limpio.length <= 60 && !out.includes(limpio)) out.push(limpio);
    }
  }
  return out;
}

/** «Inventory and Warehouse Coordinator • McAllen, TX» → puesto y ubicación, si la línea tiene esa forma. */
function puestoYUbicacionDe(lineas: readonly string[]): { puesto: string | null; ubicacion: string | null } {
  for (const l of lineas) {
    const m = /^(.+?)\s*[•·|]\s*(.+)$/.exec(l);
    if (m && RE_UBICACION.test(m[2].trim())) return { puesto: limpiaCampo(m[1]), ubicacion: limpiaCampo(m[2]) };
  }
  return { puesto: null, ubicacion: null };
}

/** Del asunto: «New application: Cashier - Maria Lopez» o «Juan Perez applied to Driver». */
export function datosDelAsunto(asunto: string): { nombre: string | null; puesto: string | null } {
  const a = (asunto ?? "").trim();
  const porPuesto = /^(?:new application|application|nueva (?:solicitud|candidatura|postulaci[oó]n|aplicaci[oó]n)|nuevo candidato|candidatura nueva)\s*[:\-–—]\s*(.+?)\s+[-–—]\s+(.+)$/i.exec(a);
  if (porPuesto) return { puesto: limpiaCampo(porPuesto[1]), nombre: limpiaCampo(porPuesto[2]) };
  const porNombre = /^(.+?)\s+(?:has applied (?:to|for)|applied (?:to|for)|aplic[oó] (?:a|para)|se postul[oó] (?:a|para)|postul[oó] (?:a|para))\s+(.+)$/i.exec(a);
  if (porNombre) return { nombre: limpiaCampo(porNombre[1]), puesto: limpiaCampo(porNombre[2]) };
  const solo = /^(?:new applicant|nuevo (?:candidato|solicitante))\s*[:\-–—]\s*(.+)$/i.exec(a);
  if (solo) return { nombre: limpiaCampo(solo[1]), puesto: null };
  return { nombre: null, puesto: null };
}

/**
 * El candidato de un correo de Indeed. `motivo` explica por qué no (para el admin): «no es un aviso de candidato»,
 * «no se encontró el nombre», «sin teléfono ni correo».
 */
export function leerCandidatoDeIndeed(c: CorreoDeIndeed): ResultadoIndeed {
  if (!esCorreoDeIndeed(c.from)) return { ok: false, motivo: "no es de Indeed" };

  const texto = aTextoPlano(c.cuerpo);
  const lineas = texto.split("\n");
  const delAsunto = datosDelAsunto(c.subject);
  const delEncabezado = nombreDeEncabezadoSolicitud(c.subject, lineas);
  const delBloque = puestoYUbicacionDe(lineas);

  const nombre = valorDeEtiqueta(texto, ETIQUETAS.nombre) ?? delAsunto.nombre ?? delEncabezado;
  if (!nombre || !esNombrePlausible(limpiaCampo(nombre))) {
    return { ok: false, motivo: "formato no reconocido: no se encontró el nombre del candidato" };
  }

  const puesto = valorDeEtiqueta(texto, ETIQUETAS.puesto) ?? delAsunto.puesto ?? delBloque.puesto;
  const ubicacion = valorDeEtiqueta(texto, ETIQUETAS.ubicacion) ?? delBloque.ubicacion;

  // Correo: 1) directo en una etiqueta o en el cuerpo, 2) el relay de Reply-To, 3) un relay de Indeed en el cuerpo.
  const remitente = direccionDe(c.from);
  const dominioBuzon = (c.dominioBuzon ?? "").toLowerCase() || null;
  const esUtil = (e: string) => e !== remitente && !/^no-?reply|^noreply/.test(e) && (!dominioBuzon || !e.endsWith(`@${dominioBuzon}`));
  const todos = extraerEmails(valorDeEtiqueta(texto, ETIQUETAS.correo) ?? "", texto, c.cuerpo).filter(esUtil);
  const directo = todos.find((e) => !esDireccionIndeed(e)) ?? null;
  const replyTo = c.replyTo.map((r) => r.trim().toLowerCase()).filter(esUtil);
  const relayReply = replyTo.find((e) => esDireccionIndeed(e)) ?? replyTo[0] ?? null;
  const relayCuerpo = todos.find((e) => esDireccionIndeed(e)) ?? null;
  const email = directo ?? relayReply ?? relayCuerpo ?? null;
  const correoEsRelay = email !== null && esDireccionIndeed(email);

  // Teléfono: primero la línea con etiqueta, después cualquier número con forma de teléfono en el cuerpo.
  const etiquetado = valorDeEtiqueta(texto, ETIQUETAS.telefono);
  const phone = (etiquetado ? telefonoDe(etiquetado) : null) ?? telefonoDe(texto);

  if (!phone && !email) return { ok: false, motivo: "sin teléfono ni correo del candidato" };

  const solicitud = enlaceDe(c.cuerpo, "See full application") ?? enlaceDe(c.cuerpo, "Ver (la )?solicitud");
  const cv = enlaceDe(c.cuerpo, "View resume") ?? enlaceDe(c.cuerpo, "Ver (el )?curr[ií]culum");
  const enlaces = { solicitud, cv };
  const lineasNota = [
    `Llegó por correo de Indeed${puesto ? ` para ${limpiaCampo(puesto)}` : ""} (${c.recibido.slice(0, 16).replace("T", " ")} UTC).`,
  ];
  if (solicitud) lineasNota.push(`Solicitud completa (Indeed, requiere sesión): ${solicitud}`);
  if (cv) lineasNota.push(`CV en Indeed (requiere sesión): ${cv}`);

  return {
    ok: true,
    candidato: {
      name: limpiaCampo(nombre),
      email,
      correoEsRelay,
      phone: phone ?? "",
      role: puesto ? limpiaCampo(puesto) : null,
      home_location: ubicacion ? limpiaCampo(ubicacion) : null,
      tags: calificacionesDe(lineas),
      enlaces,
      notes: lineasNota.join("\n"),
    },
  };
}

// ---------------------------------------------------------------------------
// Tipos de correo de Indeed: solicitud (application), mensaje de un candidato (message) u otro (other).
// ---------------------------------------------------------------------------

export type TipoCorreoIndeed = "application" | "message" | "other";

/** Encabezado de un mensaje de candidato: «You've received a new message from <Nombre>» (o su versión en español). */
const RE_ENCABEZADO_MENSAJE = /(?:you[’']ve received a new message from|you have received a new message from|nuevo mensaje de|recibiste un nuevo mensaje de|tienes un nuevo mensaje de)\s+(.+)$/i;

/** Lo que pone la tarjeta del mensaje y no es el texto del candidato. */
const RE_RUIDO_MENSAJE = /indeed|view (?:message|conversation|job)|reply|respond|ver (?:mensaje|conversación|vacante)|responder/i;

/** Ubicación tipo «McAllen, TX 78501» o «Harlingen, TX». */
const RE_UBICACION = /,\s*[A-Z]{2}(?:\s+\d{5})?\s*$/;

export function clasificaCorreoIndeed(c: CorreoDeIndeed): TipoCorreoIndeed {
  if (!esCorreoDeIndeed(c.from)) return "other";
  const texto = aTextoPlano(c.cuerpo);
  if (RE_ENCABEZADO_MENSAJE.test(c.subject) || texto.split("\n").some((l) => RE_ENCABEZADO_MENSAJE.test(l))) return "message";
  const app = datosDelAsunto(c.subject);
  const lineas = texto.split("\n");
  if (app.nombre || nombreDeEncabezadoSolicitud(c.subject, lineas) || valorDeEtiqueta(texto, ETIQUETAS.nombre)) return "application";
  return "other";
}

export interface MensajeDeIndeed {
  /** Nombre del candidato, tal como lo pone Indeed. */
  candidateName: string;
  /** Texto del mensaje del candidato. */
  texto: string;
  /** Puesto y empresa del bloque de abajo, si se reconocen (la última línea de ubicación marca el bloque). */
  puesto: string | null;
  empresa: string | null;
  ubicacion: string | null;
}

export type ResultadoMensajeIndeed = { ok: true; mensaje: MensajeDeIndeed } | { ok: false; motivo: string };

/**
 * El mensaje de un candidato. Estructura del correo real (captura del dueño): encabezado con el nombre, la tarjeta con el
 * texto del mensaje, y un bloque de vacante al final: puesto, empresa y ubicación. El bloque se toma de las últimas tres
 * líneas cuando la última parece una ubicación; lo que queda entre el encabezado y el bloque es el mensaje.
 */
export function leerMensajeDeIndeed(c: CorreoDeIndeed): ResultadoMensajeIndeed {
  if (!esCorreoDeIndeed(c.from)) return { ok: false, motivo: "no es de Indeed" };
  const lineas = aTextoPlano(c.cuerpo).split("\n");
  const idxEncabezado = lineas.findIndex((l) => RE_ENCABEZADO_MENSAJE.test(l));
  const enAsunto = RE_ENCABEZADO_MENSAJE.exec(c.subject);
  const enCuerpo = idxEncabezado >= 0 ? RE_ENCABEZADO_MENSAJE.exec(lineas[idxEncabezado]) : null;
  const nombre = (enCuerpo?.[1] ?? enAsunto?.[1] ?? "").replace(/[.!]+$/, "").trim();
  if (!nombre) return { ok: false, motivo: "message, no se encontró el nombre" };

  const resto = (idxEncabezado >= 0 ? lineas.slice(idxEncabezado + 1) : []).filter((l) => !RE_RUIDO_MENSAJE.test(l));
  let puesto: string | null = null;
  let empresa: string | null = null;
  let ubicacion: string | null = null;
  let cuerpo = resto;
  if (resto.length >= 4 && RE_UBICACION.test(resto[resto.length - 1])) {
    [puesto, empresa, ubicacion] = resto.slice(-3);
    cuerpo = resto.slice(0, -3);
  }
  const texto = cuerpo.join(" ").trim();
  if (!texto) return { ok: false, motivo: "message, no se encontró el texto del mensaje" };
  return { ok: true, mensaje: { candidateName: nombre, texto, puesto, empresa, ubicacion } };
}
