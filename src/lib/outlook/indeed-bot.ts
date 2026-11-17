/**
 * Entrada del bot local de Indeed (`tools/indeed-bot`): el bot lee el buzón del empleador en el navegador de una PC y
 * manda los candidatos y mensajes aquí. SOLO SERVIDOR.
 *
 * Es la MISMA lógica que el buzón de Outlook, no una copia:
 *   - solicitud → `crearCandidatoDesdeCorreo` (dedupe, estandarización, CV con `validaCv`);
 *   - mensaje   → `procesarMensaje` (teléfono, llamada en el calendario, nota), con el teléfono del bot solo si el
 *     texto no trae ninguno;
 *   - el reclamo y el cierre del registro (`outlook_processed`) pasan por `registro.ts`, igual que `sincronizar.ts`.
 *
 * Lo que cambia respecto al correo: no hay cabeceras que verificar (la autoridad es el token `INDEED_BOT_TOKEN`) y no
 * hay Reply-To relay, así que un mensaje solo se liga a una ficha existente por nombre + puesto (la regla de D-1050).
 *
 * Idempotencia: `message_id = "bot:" + externalId`. Un segundo envío del mismo externalId choca con la clave primaria y
 * se devuelve como `skipped` sin tocar nada.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearCandidatoDesdeCorreo } from "./crear-candidato";
import { enlaceSeguro } from "./html-lineal";
import { telefonoDe, type CandidatoDeIndeed, type MensajeDeIndeed } from "./indeed";
import { validaCv } from "./cv";
import { procesarMensaje } from "./mensaje-a-candidato";
import { cierraRegistro, reclamaRegistro, type CierreRegistro } from "./registro";

/** Como mucho este número de elementos por envío. */
export const MAX_ELEMENTOS_INGESTA = 25;
/** Cuerpo máximo de la petición. Vercel corta antes en ~4,5 MB; el bot parte los envíos por debajo de esto. */
export const MAX_CUERPO_INGESTA_BYTES = 4 * 1024 * 1024;
/** Texto del mensaje (caracteres). */
export const MAX_TEXTO_MENSAJE = 20_000;
/** Un CV de 10 MB en base64 ocupa unos 13,4 M caracteres; se deja margen de relleno. */
export const MAX_CV_BASE64 = Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4;

const CLAVES_ELEMENTO = ["kind", "externalId", "receivedAt", "candidateName", "position", "location", "text", "phone", "qualifications", "links", "resume"] as const;
const CLAVES_ENLACES = ["application", "resume"] as const;
const CLAVES_CV = ["filename", "contentBase64"] as const;

export interface ElementoDeBot {
  kind: "application" | "message";
  externalId: string;
  /** ISO, normalizada. */
  receivedAt: string;
  candidateName: string;
  position: string | null;
  location: string | null;
  text: string | null;
  /** Teléfono de 10 dígitos, o null si no se pudo leer. */
  phone: string | null;
  qualifications: string[];
  links: { application: string | null; resume: string | null };
  resume: { nombreFichero: string; bytes: Buffer } | null;
}

export type ValidacionIngesta = { ok: true; items: ElementoDeBot[] } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function texto(x: unknown, ruta: string, min: number, max: number): string {
  if (typeof x !== "string") throw new Error(`${ruta}: debe ser texto.`);
  const t = x.trim();
  if (t.length < min || t.length > max) throw new Error(`${ruta}: entre ${min} y ${max} caracteres.`);
  return t;
}

function opcional(x: unknown, ruta: string, max: number): string | null {
  if (x === undefined || x === null) return null;
  if (typeof x !== "string") throw new Error(`${ruta}: debe ser texto.`);
  if (x.length > max) throw new Error(`${ruta}: más de ${max} caracteres.`);
  return x.trim() || null;
}

function validaElemento(x: unknown, ruta: string): ElementoDeBot {
  if (!isObj(x)) throw new Error(`${ruta}: debe ser un objeto.`);
  for (const k of Object.keys(x)) if (!(CLAVES_ELEMENTO as readonly string[]).includes(k)) throw new Error(`${ruta}: campo no permitido «${k}».`);

  if (x.kind !== "application" && x.kind !== "message") throw new Error(`${ruta}.kind: «application» o «message».`);
  const externalId = texto(x.externalId, `${ruta}.externalId`, 1, 200);
  if (!/^[\x21-\x7e]+$/.test(externalId)) throw new Error(`${ruta}.externalId: sin espacios ni caracteres raros.`);
  const recibido = texto(x.receivedAt, `${ruta}.receivedAt`, 1, 40);
  const cuando = Date.parse(recibido);
  if (Number.isNaN(cuando)) throw new Error(`${ruta}.receivedAt: fecha ISO no válida.`);

  const candidateName = texto(x.candidateName, `${ruta}.candidateName`, 1, 120);
  const position = opcional(x.position, `${ruta}.position`, 200);
  const location = opcional(x.location, `${ruta}.location`, 200);
  const text = opcional(x.text, `${ruta}.text`, MAX_TEXTO_MENSAJE);

  // Un teléfono que no se puede leer se trata como ausente: no tumba el envío entero.
  const phoneRaw = opcional(x.phone, `${ruta}.phone`, 40);
  const phone = phoneRaw ? telefonoDe(phoneRaw) : null;

  let qualifications: string[] = [];
  if (x.qualifications !== undefined && x.qualifications !== null) {
    if (!Array.isArray(x.qualifications) || x.qualifications.length > 30) throw new Error(`${ruta}.qualifications: lista de hasta 30.`);
    qualifications = [...new Set(x.qualifications.map((q, i) => texto(q, `${ruta}.qualifications[${i}]`, 1, 60)))];
  }

  // Enlaces: solo https de indeed.com (`enlaceSeguro`). Uno que no cumple se descarta sin error.
  const links = { application: null as string | null, resume: null as string | null };
  if (x.links !== undefined && x.links !== null) {
    if (!isObj(x.links)) throw new Error(`${ruta}.links: debe ser un objeto.`);
    for (const k of Object.keys(x.links)) if (!(CLAVES_ENLACES as readonly string[]).includes(k)) throw new Error(`${ruta}.links: campo no permitido «${k}».`);
    for (const k of CLAVES_ENLACES) {
      const v = opcional(x.links[k], `${ruta}.links.${k}`, 2000);
      links[k] = v ? enlaceSeguro(v) : null;
    }
  }

  let resume: ElementoDeBot["resume"] = null;
  if (x.resume !== undefined && x.resume !== null) {
    if (!isObj(x.resume)) throw new Error(`${ruta}.resume: debe ser un objeto.`);
    for (const k of Object.keys(x.resume)) if (!(CLAVES_CV as readonly string[]).includes(k)) throw new Error(`${ruta}.resume: campo no permitido «${k}».`);
    const nombreFichero = texto(x.resume.filename, `${ruta}.resume.filename`, 1, 200);
    const b64 = texto(x.resume.contentBase64, `${ruta}.resume.contentBase64`, 1, MAX_CV_BASE64);
    if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error(`${ruta}.resume.contentBase64: base64 no válido.`);
    resume = { nombreFichero, bytes: Buffer.from(b64, "base64") };
  }

  return {
    kind: x.kind,
    externalId,
    receivedAt: new Date(cuando).toISOString(),
    candidateName,
    position,
    location,
    text,
    phone,
    qualifications,
    links,
    resume,
  };
}

/** Valida el cuerpo entero de `POST /api/indeed-bot/ingest`. Estricto: campos desconocidos, tamaños y tipos. */
export function validaIngesta(cuerpo: unknown): ValidacionIngesta {
  try {
    if (!isObj(cuerpo)) throw new Error("El cuerpo debe ser un objeto JSON.");
    for (const k of Object.keys(cuerpo)) if (k !== "items") throw new Error(`campo no permitido «${k}».`);
    if (!Array.isArray(cuerpo.items)) throw new Error("items: debe ser una lista.");
    if (cuerpo.items.length < 1 || cuerpo.items.length > MAX_ELEMENTOS_INGESTA) {
      throw new Error(`items: entre 1 y ${MAX_ELEMENTOS_INGESTA} elementos.`);
    }
    const items = cuerpo.items.map((x, i) => validaElemento(x, `items[${i}]`));
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cuerpo no válido." };
  }
}

/**
 * ¿El token del encabezado `Authorization: Bearer …` es el esperado? Se comparan los SHA-256 de los dos con
 * `timingSafeEqual`: así las longitudes no se filtran y la comparación no depende de dónde difieren.
 */
export function tokenAutorizado(cabecera: string | null, esperado: string): boolean {
  const m = /^Bearer\s+(\S+)\s*$/.exec(cabecera ?? "");
  if (!m || !esperado) return false;
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

export interface ResultadoElementoBot {
  externalId: string;
  result: CierreRegistro["result"];
  candidateId: string | null;
  scheduledAt: string | null;
  detail: string | null;
  error: string | null;
}

function mensajeSeguro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 200);
}

async function aplicaSolicitud(db: SupabaseClient, it: ElementoDeBot): Promise<CierreRegistro> {
  if (!it.phone) {
    return { result: "skipped", candidateId: null, error: "sin teléfono ni correo del candidato", scheduledAt: null, detail: null };
  }
  const lineas = [`Llegó desde Indeed (bot)${it.position ? ` para ${it.position}` : ""} (${it.receivedAt.slice(0, 16).replace("T", " ")} UTC).`];
  if (it.links.application) lineas.push(`Solicitud completa (Indeed, requiere sesión): ${it.links.application}`);
  if (it.links.resume) lineas.push(`CV en Indeed (requiere sesión): ${it.links.resume}`);

  const candidato: CandidatoDeIndeed = {
    name: it.candidateName,
    email: null,
    correoEsRelay: false,
    phone: it.phone,
    role: it.position,
    home_location: it.location,
    tags: it.qualifications,
    enlaces: { solicitud: it.links.application, cv: it.links.resume },
    notes: lineas.join("\n"),
  };

  let cv: { nombreFichero: string; bytes: Buffer } | null = null;
  let avisoCv: string | null = null;
  if (it.resume) {
    const v = validaCv(it.resume.nombreFichero, it.resume.bytes);
    if (v.ok) cv = it.resume;
    else avisoCv = `CV no guardado: ${v.motivo}`;
  }
  const alta = await crearCandidatoDesdeCorreo(db, candidato, cv);
  return { result: alta.resultado, candidateId: alta.candidateId, error: alta.aviso ?? alta.avisoCv ?? avisoCv, scheduledAt: null, detail: null };
}

async function aplicaMensaje(db: SupabaseClient, it: ElementoDeBot, ahora: Date): Promise<CierreRegistro> {
  if (!it.text) {
    return { result: "skipped", candidateId: null, error: "message sin texto", scheduledAt: null, detail: null };
  }
  const mensaje: MensajeDeIndeed = { candidateName: it.candidateName, texto: it.text, puesto: it.position, empresa: null, ubicacion: it.location };
  const out = await procesarMensaje(db, {
    mensaje,
    recibido: it.receivedAt,
    ahora: ahora.toISOString(),
    replyToRelay: null,
    telefonoExtra: it.phone,
  });
  return { result: out.resultado, candidateId: out.candidateId, error: out.error, scheduledAt: out.scheduledAt, detail: out.detail };
}

/**
 * Procesa un elemento: lo reclama (si ya existía, lo omite), lo aplica según su tipo y anota el resultado. Un error no
 * tumba a los demás elementos del envío.
 */
export async function procesaElementoDeBot(db: SupabaseClient, it: ElementoDeBot, ahora: Date): Promise<ResultadoElementoBot> {
  const messageId = `bot:${it.externalId}`;
  const etiqueta = it.kind === "message" ? "Mensaje" : "Solicitud";
  let reclamo;
  try {
    reclamo = await reclamaRegistro(db, {
      messageId,
      receivedAt: it.receivedAt,
      subject: `Indeed (bot) · ${etiqueta} de ${it.candidateName}`,
      fromAddress: "indeed-bot",
    });
  } catch (e) {
    return { externalId: it.externalId, result: "failed", candidateId: null, scheduledAt: null, detail: null, error: mensajeSeguro(e) };
  }
  if (reclamo === "ya-reclamado") {
    return {
      externalId: it.externalId,
      result: "skipped",
      candidateId: null,
      scheduledAt: null,
      detail: null,
      error: "ya recibido antes (mismo externalId): no se vuelve a procesar",
    };
  }

  let cierre: CierreRegistro;
  try {
    cierre = it.kind === "message" ? await aplicaMensaje(db, it, ahora) : await aplicaSolicitud(db, it);
  } catch (e) {
    cierre = { result: "failed", candidateId: null, error: mensajeSeguro(e), scheduledAt: null, detail: null };
  }
  await cierraRegistro(db, messageId, cierre);
  return { externalId: it.externalId, ...cierre };
}
