// Detección de fallas de la app (2026-11-25, pedido del dueño): la propia app registra DÓNDE falla, sin servicio de
// terceros. Este fichero es PURO (sin red, sin base, sin React): lo usan el navegador, la ruta /api/fallas y los
// envoltorios del servidor, y por eso se prueba entero en vitest.
//
// Qué guarda una falla y qué NO: origen, app, ruta (sin query string), mensaje y pila recortados, componente, quién
// (solo id y rol), versión, navegador (user agent recortado) y si era la app de escritorio. Nada de contenido de
// formularios, nada de correos, nada de tokens: `limpiarTexto` los quita antes de que el dato salga de aquí.

import { APP_VERSIONS } from "@/lib/app-versions";

export const ORIGENES = ["cliente", "servidor", "accion", "api", "cron"] as const;
export type OrigenDeFalla = (typeof ORIGENES)[number];

export const LIMITES = {
  mensaje: 500,
  pila: 4000,
  ruta: 300,
  navegador: 300,
  componente: 120,
  /** Cuántas fallas caben en un mismo envío desde el navegador. */
  lote: 10,
  /** Tamaño máximo del cuerpo de /api/fallas, en caracteres. Lo que pase de aquí se descarta. */
  cuerpo: 40_000,
} as const;

/** Ventana en la que la MISMA huella no se vuelve a enviar desde un navegador. */
export const VENTANA_DE_DEDUPE_MS = 60_000;

/** Primer segmento de la ruta → la app a la que pertenece. Lo que no está aquí es Entregas (la app original). */
const APP_DE_SEGMENTO: Record<string, string> = {
  timetracker: "timetracker",
  recruiting: "recruiting",
  erp: "erp",
  leads: "leads",
  customers: "customers",
  estimator: "estimator",
  promos: "promos",
  surveys: "surveys",
  home: "hub",
  security: "hub",
  ringcentral: "hub",
};

export function appDeLaRuta(ruta: string): string {
  const primero = (ruta.split("/")[1] ?? "").toLowerCase();
  return APP_DE_SEGMENTO[primero] ?? "deliveries";
}

/** La versión de esa app (de `app-versions.ts`), o null si no tiene contador. */
export function versionDeLaApp(app: string): string | null {
  return (APP_VERSIONS as Record<string, string>)[app] ?? null;
}

const RE_CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_BEARER = /\bBearer\s+[^\s'",;]+/gi;
const RE_CLAVE_EN_TEXTO = /\b(password|passwd|pwd|token|secret|api[_-]?key|authorization|access_token|refresh_token)(\s*[=:]\s*)[^\s'",;&]+/gi;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_LARGO_CON_DIGITOS = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Un trozo que parece token: largo, con letras y cifras mezcladas, y no es un UUID. */
function pareceToken(trozo: string): boolean {
  if (RE_UUID.test(trozo)) return false;
  return /\d/.test(trozo) && /[A-Za-z]/.test(trozo);
}

/**
 * Quita correos, tokens, cabeceras Bearer y claves con valor, y los query strings de las URL que salgan en el texto.
 * Después recorta a `max` caracteres. Es la única puerta de salida de texto libre hacia la base.
 */
export function limpiarTexto(entrada: unknown, max: number): string {
  let texto = typeof entrada === "string" ? entrada : entrada == null ? "" : String(entrada);
  texto = texto
    .replace(RE_CORREO, "[correo]")
    .replace(RE_BEARER, "Bearer [token]")
    .replace(RE_CLAVE_EN_TEXTO, (_m, clave: string, sep: string) => `${clave}${sep}[oculto]`)
    // Query string y fragmento de cualquier URL o ruta que salga en el texto: no dicen dónde falla, y pueden traer datos.
    .replace(/(https?:\/\/[^\s?#'")]+|\/[A-Za-z0-9/_.[\]-]+)[?#][^\s'")]*/g, "$1")
    .replace(RE_LARGO_CON_DIGITOS, (t) => (pareceToken(t) ? "[token]" : t));
  // Caracteres de control fuera (menos salto de línea y tabulador): la pila trae saltos, el resto no.
  texto = texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/**
 * La ruta sin query ni fragmento, con los segmentos que parecen token o correo sustituidos por `:id`.
 * Siempre empieza por `/`.
 */
export function limpiarRuta(entrada: unknown): string {
  const crudo = typeof entrada === "string" ? entrada : "";
  const sinQuery = crudo.split(/[?#]/)[0] ?? "";
  const segmentos = sinQuery.split("/").map((s) => {
    if (!s) return s;
    if (s.includes("@")) return ":correo";
    if (s.length >= 32 && pareceToken(s)) return ":token";
    return s;
  });
  let ruta = segmentos.join("/");
  if (!ruta.startsWith("/")) ruta = `/${ruta}`;
  return limpiarTexto(ruta, LIMITES.ruta);
}

function fnv1a(texto: string, semilla: number): string {
  let h = semilla >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** La primera línea con sentido de un texto (sin los espacios de la pila). */
function primeraLinea(texto: string): string {
  return (texto.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 200);
}

/** El primer marco de la pila: la línea «at …» (V8) o «fn@archivo» (Firefox/Safari). */
function primerMarco(pila: string): string {
  const lineas = pila.split("\n").map((l) => l.trim()).filter(Boolean);
  const marco = lineas.find((l) => /^at\s/.test(l) || (/@/.test(l) && !/^[A-Za-z]*Error/.test(l)));
  return (marco ?? "").slice(0, 200);
}

/**
 * La huella: lo que hace que dos fallas sean «la misma». Origen, ruta, primera línea del mensaje y primer marco de la
 * pila, con un hash de 64 bits (dos FNV-1a). No es seguridad, es agrupar; por eso no usa `crypto` (corre también en el
 * navegador, donde `crypto.subtle` es asíncrono).
 */
export function huellaDeFalla(p: { origen: string; ruta: string; mensaje: string; pila?: string | null }): string {
  const base = [p.origen, p.ruta, primeraLinea(p.mensaje), primerMarco(p.pila ?? "")].join("|");
  return fnv1a(base, 0x811c9dc5) + fnv1a(base, 0x9e3779b9);
}

export interface FallaNormalizada {
  origen: OrigenDeFalla;
  app: string;
  ruta: string;
  mensaje: string;
  pila: string;
  componente: string | null;
  rol: string | null;
  version: string | null;
  navegador: string | null;
  escritorio: boolean;
  huella: string;
}

export interface ContextoDeFalla {
  /** Lo pone la ruta del servidor a partir de la sesión, nunca el navegador. */
  rol?: string | null;
  /** Lo pone la ruta del servidor. Sin sesión no hay usuario y la falla no llega aquí (ver la ruta). */
  navegador?: unknown;
  escritorio?: unknown;
  /** La app que declara el sitio de la llamada (un envoltorio del servidor). Si falta, sale de la ruta. */
  app?: string | null;
}

/**
 * Valida y limpia una falla que llega de fuera (navegador o envoltorio). Devuelve null si no sirve: origen desconocido,
 * sin mensaje, o no es un objeto. No lanza nunca: quien llama no puede caer por una falla mal formada.
 */
export function normalizarFalla(entrada: unknown, contexto: ContextoDeFalla = {}): FallaNormalizada | null {
  try {
    if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;
    const e = entrada as Record<string, unknown>;
    const origen = ORIGENES.find((o) => o === e.origen);
    if (!origen) return null;
    const ruta = limpiarRuta(e.ruta);
    const mensaje = limpiarTexto(e.mensaje, LIMITES.mensaje).trim();
    if (!mensaje) return null;
    const pila = limpiarTexto(e.pila, LIMITES.pila);
    const app = typeof contexto.app === "string" && contexto.app ? contexto.app : appDeLaRuta(ruta);
    const componente = typeof e.componente === "string" && e.componente.trim()
      ? limpiarTexto(e.componente, LIMITES.componente)
      : null;
    const navegador = typeof contexto.navegador === "string" && contexto.navegador
      ? limpiarTexto(contexto.navegador, LIMITES.navegador)
      : null;
    return {
      origen,
      app,
      ruta,
      mensaje,
      pila,
      componente,
      rol: typeof contexto.rol === "string" && contexto.rol ? limpiarTexto(contexto.rol, 40) : null,
      version: versionDeLaApp(app),
      navegador,
      escritorio: contexto.escritorio === true,
      huella: huellaDeFalla({ origen, ruta, mensaje, pila }),
    };
  } catch {
    return null;
  }
}

/**
 * Dedupe del navegador: la misma huella, una vez por ventana. Con tope de memoria: si pasan muchas huellas distintas,
 * se olvida la más vieja (basta para no repetir en bucle).
 */
export class Desduplicador {
  private vistas = new Map<string, number>();
  constructor(private ventanaMs = VENTANA_DE_DEDUPE_MS, private tope = 200) {}
  debeEnviarse(huella: string, ahora: number = Date.now()): boolean {
    const ultima = this.vistas.get(huella);
    if (ultima !== undefined && ahora - ultima < this.ventanaMs) return false;
    this.vistas.delete(huella);
    this.vistas.set(huella, ahora);
    if (this.vistas.size > this.tope) {
      const vieja = this.vistas.keys().next().value;
      if (vieja !== undefined) this.vistas.delete(vieja);
    }
    return true;
  }
}

/** Un cuerpo de envío cabe si no pasa el tope. Lo que no cabe se descarta entero: no se trunca JSON a medias. */
export function cabeEnElCuerpo(cuerpo: string): boolean {
  return cuerpo.length <= LIMITES.cuerpo;
}

/** Saca del cuerpo de /api/fallas la lista de fallas, con el tope de lote. Acepta una sola falla o {fallas: [...]}. */
export function fallasDelCuerpo(cuerpo: unknown): unknown[] {
  if (!cuerpo || typeof cuerpo !== "object") return [];
  const c = cuerpo as Record<string, unknown>;
  if (Array.isArray(c.fallas)) return c.fallas.slice(0, LIMITES.lote);
  return [cuerpo];
}
