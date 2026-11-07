/**
 * Operaciones de almacén (D-NEXT, migración 268): la foto de la merma es obligatoria, primero, y no se repite.
 *
 * Reunión del dueño con Roberto (2026-11-06): Francis subió las mismas fotos en varias mermas y las tomaba DESPUÉS de
 * capturar los datos. Lo acordado:
 *   1. Una merma no se ENVÍA sin al menos una foto de las piezas; la foto se pide justo después del producto.
 *   2. Si la apuntaron en papel, se guarda como borrador «sin foto» (en la base, `photo_pending`) y queda incompleta
 *      hasta que le agreguen la foto; a las 24 h el gerente la ve como «foto pendiente». Nada se borra solo.
 *   3. En las listas, un icono de cámara junto a la fecha dice que el reporte tiene fotos (y cuántas).
 *   4. Cada foto lleva su SHA-256 (`photo_hashes`, alineado con `photos`); si una ya se usó en otro reporte, se avisa
 *      y se marca en la lista. Solo aviso, no bloquea (el dueño decide después si bloquear).
 *
 * Sin React: lo usan la pantalla, las cuentas de la lista y las pruebas. Una ruta del servidor puede importarlo.
 */
import type { TipoDeReporte } from "./tipos";
import type { Respuestas } from "./pasos";

/** Las claves dentro de `answers` del asistente: las fotos (`data:` JPEG) y, alineados, sus SHA-256. */
export const PASO_FOTO = "photo";
export const CLAVE_HASHES = "photo_hashes";
/** Lo que viaja dentro de `answers` a `warehouse_ops_file_report`; el trigger de la 268 lo pasa a su columna. */
export const CLAVE_PENDIENTE = "photo_pending";
export const MAX_FOTOS = 3;
/** A las 24 h sin foto, el gerente la ve como «foto pendiente». */
export const HORAS_PARA_PENDIENTE = 24;

export type Lang = "en" | "es";

/** ¿Este tipo de reporte exige foto para enviarse? Hoy, solo la merma. */
export function exigeFoto(tipo: TipoDeReporte): boolean {
  return tipo === "scrap";
}

/** Las fotos que lleva el asistente (data URLs). */
export function fotosDe(r: Respuestas): string[] {
  const v = r[PASO_FOTO];
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

/** Los SHA-256 alineados con `fotosDe(r)`; un hueco (foto sin hash) va como "". */
export function hashesDe(r: Respuestas): string[] {
  const fotos = fotosDe(r);
  const v = r[CLAVE_HASHES];
  const h = Array.isArray(v) ? (v as unknown[]).map((x) => (typeof x === "string" && esHash(x) ? x : "")) : [];
  return fotos.map((_, n) => h[n] ?? "");
}

/** ¿Le falta la foto obligatoria? */
export function faltaFoto(tipo: TipoDeReporte, r: Respuestas): boolean {
  return exigeFoto(tipo) && fotosDe(r).length === 0;
}

export type MotivoDeBloqueo = "foto" | "hueco" | "tienda";

/**
 * ¿Se puede ENVIAR? `hueco` es el primer paso sin contestar (lo da `primerHueco` de pasos.ts; -1 si no hay). La foto
 * se revisa aparte porque su paso se puede saltar («la tengo en papel») y aun así no se envía sin ella.
 */
export function puedeEnviar(tipo: TipoDeReporte, r: Respuestas, tienda: string, hueco: number): { ok: true } | { ok: false; motivo: MotivoDeBloqueo } {
  if (!tienda) return { ok: false, motivo: "tienda" };
  if (hueco >= 0) return { ok: false, motivo: "hueco" };
  if (faltaFoto(tipo, r)) return { ok: false, motivo: "foto" };
  return { ok: true };
}

/**
 * ¿Se puede guardar en la base como borrador «sin foto»? Solo la merma, solo si lo ÚNICO que falta es la foto (lo
 * apuntaron en papel y ya capturaron todo lo demás).
 */
export function puedeGuardarSinFoto(tipo: TipoDeReporte, r: Respuestas, tienda: string, hueco: number): boolean {
  return exigeFoto(tipo) && !!tienda && hueco < 0 && faltaFoto(tipo, r);
}

export function motivoDeBloqueo(m: MotivoDeBloqueo, lang: Lang): string {
  switch (m) {
    case "foto": return lang === "es" ? "Falta la foto de las piezas. Sin foto no se envía." : "The photo of the pieces is missing. It cannot be sent without one.";
    case "hueco": return lang === "es" ? "Faltan respuestas." : "Some answers are missing.";
    case "tienda": return lang === "es" ? "Elige la tienda." : "Pick the store.";
  }
}

/** Lo mínimo de una fila para las cuentas de aquí. */
export interface FilaConFotos {
  id: string;
  created_at: string;
  photos: string[];
  /** 268. Puede no venir (base sin la 268 o fila vieja). */
  photo_hashes?: (string | null)[] | null;
  photo_pending?: boolean | null;
}

/** El icono de cámara junto a la fecha: solo si hay fotos; el título dice cuántas. */
export function iconoDeFotos(n: number, lang: Lang): { muestra: boolean; titulo: string } {
  if (n <= 0) return { muestra: false, titulo: "" };
  const titulo = lang === "es" ? (n === 1 ? "1 foto" : `${n} fotos`) : (n === 1 ? "1 photo" : `${n} photos`);
  return { muestra: true, titulo };
}

/** ¿Está guardada sin foto (papel primero)? */
export function sinFoto(r: FilaConFotos): boolean {
  return !!r.photo_pending && (r.photos ?? []).length === 0;
}

/** Horas desde que se guardó. */
export function horasDesde(iso: string, ahora: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (ahora.getTime() - t) / 3_600_000);
}

/** ¿Sin foto y ya pasaron las 24 h? El gerente la ve como «foto pendiente» para reclamarla. */
export function fotoPendienteVencida(r: FilaConFotos, ahora: Date = new Date()): boolean {
  return sinFoto(r) && horasDesde(r.created_at, ahora) >= HORAS_PARA_PENDIENTE;
}

export function etiquetaSinFoto(r: FilaConFotos, lang: Lang, ahora: Date = new Date()): string {
  if (!sinFoto(r)) return "";
  if (!fotoPendienteVencida(r, ahora)) return lang === "es" ? "Falta la foto" : "Missing photo";
  const h = Math.floor(horasDesde(r.created_at, ahora));
  const d = Math.floor(h / 24);
  const hace = d >= 2 ? (lang === "es" ? `${d} días` : `${d} days`) : (lang === "es" ? `${h} h` : `${h} h`);
  return lang === "es" ? `Foto pendiente · ${hace}` : `Pending photo · ${hace}`;
}

// ---------------------------------------------------------------------------
// Huella (SHA-256) de cada foto y duplicados
// ---------------------------------------------------------------------------

export function esHash(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/** El SHA-256 en hexadecimal de los bytes que se suben (el JPEG ya comprimido). Igual en el navegador y en Node. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await globalThis.crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Los bytes de un `data:` URL (lo que el asistente guarda por foto) sin pasar por `fetch`. */
export function bytesDeDataUrl(dataUrl: string): Uint8Array {
  const coma = dataUrl.indexOf(",");
  const cabeza = coma >= 0 ? dataUrl.slice(0, coma) : "";
  const cuerpo = coma >= 0 ? dataUrl.slice(coma + 1) : dataUrl;
  if (!/;base64$/i.test(cabeza)) return new TextEncoder().encode(decodeURIComponent(cuerpo));
  const bin = atob(cuerpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashDeDataUrl(dataUrl: string): Promise<string> {
  return sha256Hex(bytesDeDataUrl(dataUrl));
}

/** Un reporte que ya usó la misma foto. */
export interface Repetida { reporteId: string; created_at: string; broken_on?: string | null; store?: string | null; product_name?: string | null }

/**
 * Entre las filas que se ven, qué reportes comparten alguna foto (misma huella) con otro. Devuelve, por reporte, los
 * ids de los OTROS reportes con los que repite. Los huecos ("" / null: fotos sin huella todavía) no se comparan.
 */
export function duplicadosPorHuella(filas: FilaConFotos[]): Map<string, string[]> {
  const porHash = new Map<string, Set<string>>();
  for (const f of filas) {
    for (const h of f.photo_hashes ?? []) {
      if (!esHash(h)) continue;
      const s = porHash.get(h) ?? new Set<string>();
      s.add(f.id);
      porHash.set(h, s);
    }
  }
  const out = new Map<string, string[]>();
  for (const ids of porHash.values()) {
    if (ids.size < 2) continue;
    for (const id of ids) {
      const otros = out.get(id) ?? [];
      for (const o of ids) if (o !== id && !otros.includes(o)) otros.push(o);
      out.set(id, otros);
    }
  }
  return out;
}

/** ¿A cuántas fotos de esta fila les falta la huella (reporte de antes de la 268)? */
export function fotosSinHuella(r: FilaConFotos): number {
  const fotos = r.photos ?? [];
  const h = r.photo_hashes ?? [];
  return fotos.filter((_, n) => !esHash(h[n])).length;
}

/** El texto del aviso al agregar una foto que ya se usó. */
export function avisoDeRepetida(x: Repetida, lang: Lang, fmtDia: (iso: string) => string): string {
  const dia = fmtDia(x.broken_on ?? x.created_at);
  const que = x.product_name ? ` (${x.product_name})` : "";
  return lang === "es"
    ? `Esta foto ya se usó en el reporte del ${dia}${que}.`
    : `This photo was already used in the report from ${dia}${que}.`;
}
