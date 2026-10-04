import { inflateSync } from "node:zlib";
import { normalizaLectura, type CodigoDeLectura, type LecturaDeCompetencia } from "./lectura";

/**
 * Leer el estimado de la competencia con Claude (D-NEXT): **solo servidor**. La llave `ANTHROPIC_API_KEY` es una
 * variable de servidor (sin `NEXT_PUBLIC_`) y este fichero no lo importa ninguna pantalla.
 *
 * Todo lo que decide está aquí y recibe por parámetro lo que toca el mundo (la base, el cubo, la red, el reloj, las
 * variables): la ruta (`/api/estimator/leer-competencia`) solo lo cablea, y las pruebas lo corren entero con todo
 * falso. **Ninguna prueba llama a la API de verdad** (CLAUDE.md: las pruebas no gastan en terceros).
 *
 * El orden importa: primero lo que no cuesta nada (quién es, si hay llave, de quién es el archivo, tipo, tamaño, el
 * tope del día, las páginas) y solo al final la llamada, que es lo único que se paga.
 */

/**
 * `claude-opus-5-5`: el Opus vigente (2026-10), lee imágenes y PDF y admite salida con esquema. Se cambia sin tocar
 * código con `COMPETENCIA_MODELO` (p. ej. `claude-fable-5-1`, el más capaz, a 2,5 veces el precio por token).
 */
export const MODELO_POR_DEFECTO = "claude-opus-5-5";
/** Los que aceptan `fallbacks: "default"` (si el modelo se niega, la API reintenta en otro dentro de la misma llamada). */
const CON_RESPALDO = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
export const URL_DE_MENSAJES = "https://api.anthropic.com/v1/messages";
/** Techo de la respuesta (lo que se paga más caro): el razonamiento y el JSON salen de aquí. */
export const MAX_TOKENS_DE_SALIDA = 16000;
/** Un minuto y medio: un estimado de pocas páginas tarda segundos; más que eso es que algo va mal. */
export const ESPERA_MS = 90_000;

export const LIMITES_DE_LECTURA = {
  /** El PDF entero va en la petición: 10 MB es el techo del cubo (153), y en base64 queda lejos de los 32 MB de la API. */
  maxBytesPdf: 10 * 1024 * 1024,
  /** La API no acepta imágenes de más de 5 MB. */
  maxBytesImagen: 5 * 1024 * 1024,
  /** Un estimado tiene 1-3 páginas. Cada página se paga (texto e imagen): un catálogo de 80 no se lee. */
  maxPaginas: 10,
  /** Lecturas al día (las últimas 24 h), de todos juntos, si `COMPETENCIA_LECTURAS_DIA` no dice otra cosa. */
  topeDiario: 40,
  /** HEIC/HEIF no: la API solo lee JPEG, PNG, GIF y WEBP. */
  tiposDeImagen: ["image/jpeg", "image/png", "image/webp"] as string[],
} as const;

/** El tope del día: `COMPETENCIA_LECTURAS_DIA` si es un entero ≥ 0 (0 = lectura apagada); si no, el de por defecto. */
export function topeDiario(crudo: string | undefined): number {
  const s = (crudo ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) return LIMITES_DE_LECTURA.topeDiario;
  return Number(s);
}

export function modeloDeLectura(crudo: string | undefined): string {
  const s = (crudo ?? "").trim();
  return /^claude-[a-z0-9-]{3,60}$/.test(s) ? s : MODELO_POR_DEFECTO;
}

/**
 * Cuántas páginas tiene un PDF, sin librería: cuenta los objetos `/Type /Page`, también dentro de los «object streams»
 * comprimidos (PDF 1.5+, lo que escribe casi todo programa moderno). Devuelve null si no encuentra ninguna (cifrado,
 * roto o raro): **lo que no se puede contar no se manda**, porque no se sabría cuánto va a costar.
 */
export function paginasDePdf(bytes: Uint8Array): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const s = buf.toString("latin1");
  const cuenta = (t: string) => (t.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  let n = cuenta(s);
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    // `endstream` también casa con `stream\n`: ese no abre nada.
    if (s.slice(Math.max(0, m.index - 3), m.index) === "end") continue;
    const cabecera = s.slice(Math.max(0, m.index - 400), m.index);
    if (!/\/ObjStm/.test(cabecera.slice(cabecera.lastIndexOf("obj")))) continue;
    const desde = m.index + m[0].length;
    const hasta = s.indexOf("endstream", desde);
    if (hasta < 0) break;
    try {
      n += cuenta(inflateSync(buf.subarray(desde, hasta), { maxOutputLength: 16 * 1024 * 1024 }).toString("latin1"));
    } catch { /* no es Flate, o está roto: ese trozo no se cuenta */ }
    re.lastIndex = hasta;
  }
  return n > 0 ? n : null;
}

// ---- lo que se le pide a Claude ------------------------------------------------------------------------

const nulo = (tipo: "string" | "number", description: string) => ({ anyOf: [{ type: tipo }, { type: "null" }], description });

/** La forma del JSON que se exige (salida estructurada: la API garantiza que la respuesta la cumple). */
export const ESQUEMA_DE_LECTURA = {
  type: "object",
  additionalProperties: false,
  required: ["competitor", "doc_date", "doc_number", "items", "subtotal", "tax", "total"],
  properties: {
    competitor: nulo("string", "Name of the company that issued the document, as printed. null if not visible."),
    doc_date: nulo("string", "Date of the document as YYYY-MM-DD. null if not printed or if day and month cannot be told apart with certainty."),
    doc_number: nulo("string", "Estimate / quote / invoice number as printed. null if none."),
    items: {
      type: "array",
      description: "One entry per product line, in the order printed.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "brand", "sku", "quantity", "unit", "unit_price", "line_total"],
        properties: {
          description: nulo("string", "Product description as printed."),
          brand: nulo("string", "Brand or manufacturer, only if printed."),
          sku: nulo("string", "Item code / SKU, only if printed."),
          quantity: nulo("number", "Quantity as printed."),
          unit: nulo("string", "Unit of the quantity: 'SF' for square feet, 'box' for boxes or cartons, 'piece' for each/pieces; otherwise the unit as printed."),
          unit_price: nulo("number", "Price per unit as printed, without currency symbol."),
          line_total: nulo("number", "Line total as printed, without currency symbol."),
        },
      },
    },
    subtotal: nulo("number", "Subtotal as printed."),
    tax: nulo("number", "Tax amount as printed (the amount, not the rate)."),
    total: nulo("number", "Grand total as printed."),
  },
} as const;

export const INSTRUCCIONES = [
  "You transcribe a competitor's estimate, quote or invoice for flooring and tile products into structured data for a sales team.",
  "Copy only what is printed in the document. Never guess, infer, calculate or complete a value: if a field is absent, cut off, or not clearly legible, return null for it.",
  "Do not compute totals, unit prices or quantities from other numbers; a number goes in only if it is printed.",
  "Numbers are plain numbers (no currency symbols, no thousands separators). Dates are YYYY-MM-DD.",
  "List every product line once, in the order printed. Lines that are not products (delivery, fees, discounts) are listed too, described as printed.",
  "If the document is not an estimate, quote or invoice, return null for every field and an empty items list.",
].join("\n");

/** El cuerpo de `POST /v1/messages`: el documento (PDF) o la imagen primero, la petición después. */
export function peticionAClaude(a: { modelo: string; tipo: string; base64: string }) {
  const fuente = { type: "base64", media_type: a.tipo, data: a.base64 };
  const documento = a.tipo === "application/pdf" ? { type: "document", source: fuente } : { type: "image", source: fuente };
  return {
    model: a.modelo,
    max_tokens: MAX_TOKENS_DE_SALIDA,
    system: INSTRUCCIONES,
    // `medium` dicho a las claras (es el de por defecto en Opus 5.5; en otros modelos es `high`): transcribir un
    // estimado no pide más, y el razonamiento se paga como salida.
    output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA_DE_LECTURA } },
    ...(CON_RESPALDO.has(a.modelo) ? { fallbacks: "default" } : {}),
    messages: [{ role: "user", content: [documento, { type: "text", text: "Extract the data of this document." }] }],
  };
}

export function cabecerasDeClaude(llave: string, modelo: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": llave,
    "anthropic-version": "2023-06-01",
    ...(CON_RESPALDO.has(modelo) ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
  };
}

export type Uso = { input_tokens: number | null; output_tokens: number | null };

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const entero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export function usoDeLaRespuesta(json: unknown): Uso {
  const u = esObjeto(json) && esObjeto(json.usage) ? json.usage : {};
  return { input_tokens: entero(u.input_tokens), output_tokens: entero(u.output_tokens) };
}

/**
 * De la respuesta de la API a una lectura. Antes de leer el contenido se mira **por qué paró**: una negativa
 * (`refusal`) o una respuesta cortada (`max_tokens`) no traen un JSON del que fiarse. Lo que el modelo no leyó llega
 * como null y se queda null; lo que llegue con otra forma (un texto donde va un número) también.
 */
export function lecturaDeLaRespuesta(json: unknown): { ok: true; lectura: LecturaDeCompetencia } | { ok: false; error: string } {
  if (!esObjeto(json)) return { ok: false, error: "empty response" };
  if (json.stop_reason === "refusal") return { ok: false, error: "the model declined to read this document" };
  if (json.stop_reason === "max_tokens") return { ok: false, error: "the reading was cut off (too long)" };
  const bloques = Array.isArray(json.content) ? json.content : [];
  const txt = bloques.find((b): b is { type: "text"; text: string } => esObjeto(b) && b.type === "text" && typeof b.text === "string");
  if (!txt) return { ok: false, error: "no text in the response" };
  let crudo: unknown;
  try { crudo = JSON.parse(txt.text); } catch { return { ok: false, error: "the response is not JSON" }; }
  // El emparejado es del vendedor, a mano: aunque la respuesta trajera uno, no entra.
  if (esObjeto(crudo) && Array.isArray(crudo.items)) {
    crudo = { ...crudo, items: crudo.items.map((p) => (esObjeto(p) ? { ...p, id: undefined, matched_line_id: null } : p)) };
  }
  const lectura = normalizaLectura(crudo, "ocr");
  if (!lectura) return { ok: false, error: "the response does not have the expected shape" };
  return { ok: true, lectura };
}

// ---- la ruta, sin la ruta --------------------------------------------------------------------------------

export interface ArchivoALeer {
  id: string;
  path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
}

export interface RegistroDeLectura {
  file_id: string;
  file_name: string;
  read_by: string;
  read_by_name: string | null;
  model: string;
  pages: number | null;
  bytes: number;
}

export interface DepsDeLectura {
  env: { ANTHROPIC_API_KEY?: string; COMPETENCIA_LECTURAS_DIA?: string; COMPETENCIA_MODELO?: string };
  usuario: { id: string };
  /** El perfil de quien pide, leído con SU sesión. */
  perfil(): Promise<{ role: string | null; module_access: string[] | null; full_name: string | null } | null>;
  /** La fila del archivo leída con la SESIÓN de quien pide: si su RLS no se la enseña, no existe. */
  archivo(fileId: string): Promise<ArchivoALeer | null>;
  /** Lecturas registradas desde `desde`. `"sin-tabla"` si la 161 no está. */
  lecturasDesde(desde: Date): Promise<number | "sin-tabla">;
  /** Los bytes del archivo, con la llave de servicio. */
  descargar(path: string): Promise<Uint8Array | null>;
  /** Apunta que se va a leer (quién, qué, con qué modelo). Devuelve el id de la anotación. */
  registrar(r: RegistroDeLectura): Promise<string | null>;
  /** Cierra la anotación con cómo acabó y lo que costó en tokens. */
  cerrar(id: string, fin: { status: "ok" | "error"; error: string | null } & Uso): Promise<void>;
  pedir: typeof fetch;
  ahora(): Date;
}

export type RespuestaDeLectura =
  | { status: 200; cuerpo: { lectura: LecturaDeCompetencia; paginas: number | null; modelo: string } }
  | { status: number; cuerpo: { error: string; codigo: CodigoDeLectura } };

const no = (status: number, codigo: CodigoDeLectura, error: string): RespuestaDeLectura => ({ status, cuerpo: { error, codigo } });

export const tieneElModulo = (p: { role: string | null; module_access: string[] | null } | null): boolean =>
  !!p && (p.role === "admin" || !!p.module_access?.includes("estimator"));

export async function leerCompetencia(fileId: unknown, d: DepsDeLectura): Promise<RespuestaDeLectura> {
  const perfil = await d.perfil();
  if (!tieneElModulo(perfil)) return no(403, "sin-modulo", "The Quote Builder module is required.");
  if (typeof fileId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(fileId)) return no(400, "no-esta", "fileId is required.");

  const llave = (d.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!llave) return no(503, "sin-llave", "Falta configurar ANTHROPIC_API_KEY en el servidor: la lectura automática no está disponible. Los productos se pueden teclear a mano.");

  const archivo = await d.archivo(fileId);
  if (!archivo) return no(404, "no-esta", "File not found.");
  // Leer cuesta dinero y lo leído lo guarda quien puede editarlo: quien lo subió o el admin (la misma regla que la 161).
  if (perfil!.role !== "admin" && archivo.uploaded_by !== d.usuario.id) return no(403, "no-es-tuyo", "Only the uploader or an admin can read this file.");

  const esPdf = archivo.mime_type === "application/pdf";
  if (!esPdf && !LIMITES_DE_LECTURA.tiposDeImagen.includes(archivo.mime_type)) {
    return no(415, "tipo", `Cannot read ${archivo.mime_type || "this type"}: only PDF, JPEG, PNG and WEBP.`);
  }
  const maxBytes = esPdf ? LIMITES_DE_LECTURA.maxBytesPdf : LIMITES_DE_LECTURA.maxBytesImagen;
  if (archivo.size_bytes > maxBytes) return no(413, "tamano", `The file is over ${Math.round(maxBytes / (1024 * 1024))} MB.`);

  const tope = topeDiario(d.env.COMPETENCIA_LECTURAS_DIA);
  const hechas = await d.lecturasDesde(new Date(d.ahora().getTime() - 24 * 60 * 60 * 1000));
  if (hechas === "sin-tabla") return no(503, "sin-161", "Falta la migración 161 (estimator_competitor_reads).");
  if (hechas >= tope) return no(429, "tope", `Daily limit of ${tope} automatic readings reached.`);

  const bytes = await d.descargar(archivo.path);
  if (!bytes || bytes.byteLength === 0) return no(502, "descarga", "The file could not be downloaded from storage.");
  // El tamaño de la fila lo puso el disparador desde el objeto, pero lo que se manda es esto: se vuelve a mirar.
  if (bytes.byteLength > maxBytes) return no(413, "tamano", `The file is over ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  let paginas: number | null = null;
  if (esPdf) {
    paginas = paginasDePdf(bytes);
    if (paginas === null) return no(413, "paginas", "The pages of this PDF could not be counted, so it is not sent.");
    if (paginas > LIMITES_DE_LECTURA.maxPaginas) return no(413, "paginas", `The PDF has ${paginas} pages; up to ${LIMITES_DE_LECTURA.maxPaginas} are read.`);
  }

  const modelo = modeloDeLectura(d.env.COMPETENCIA_MODELO);
  // Se apunta ANTES de llamar: una lectura que no deja rastro no cuenta para el tope, y el tope es lo que evita gastar de más.
  const anotacion = await d.registrar({
    file_id: archivo.id, file_name: archivo.file_name, read_by: d.usuario.id, read_by_name: perfil!.full_name,
    model: modelo, pages: paginas, bytes: bytes.byteLength,
  });
  if (!anotacion) return no(503, "sin-161", "The reading could not be logged (migration 161), so it was not made.");

  const acabar = async (error: string, uso: Uso = { input_tokens: null, output_tokens: null }, codigo: CodigoDeLectura = "proveedor") => {
    await d.cerrar(anotacion, { status: "error", error: error.slice(0, 300), ...uso });
    return no(502, codigo, error);
  };

  let json: unknown;
  try {
    const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
    const r = await d.pedir(URL_DE_MENSAJES, {
      method: "POST",
      headers: cabecerasDeClaude(llave, modelo),
      body: JSON.stringify(peticionAClaude({ modelo, tipo: archivo.mime_type, base64 })),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    json = await r.json().catch(() => null);
    if (!r.ok) {
      const detalle = esObjeto(json) && esObjeto(json.error) && typeof json.error.message === "string" ? json.error.message : "";
      if (r.status === 401) return await acabar("ANTHROPIC_API_KEY was rejected by the API (401).");
      if (r.status === 429) return await acabar("The reading service is rate limited (429). Try again in a minute.");
      return await acabar(`The reading service answered ${r.status}${detalle ? `: ${detalle.slice(0, 200)}` : ""}.`);
    }
  } catch (e) {
    return await acabar(`The reading service could not be reached: ${e instanceof Error ? e.message : "error"}.`);
  }

  const uso = usoDeLaRespuesta(json);
  const leida = lecturaDeLaRespuesta(json);
  if (!leida.ok) return await acabar(leida.error, uso, "respuesta");
  await d.cerrar(anotacion, { status: "ok", error: null, ...uso });
  return { status: 200, cuerpo: { lectura: leida.lectura, paginas, modelo } };
}
