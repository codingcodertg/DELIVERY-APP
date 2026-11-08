/**
 * Operaciones de almacén (migración 274): CONTEOS DE INVENTARIO. Fase 1 de los KPI de almacén (el dueño y Roberto,
 * 2026-11-08). Roberto: «Choose supplier and size, or supplier and note, or product. Steps: 1) organize, 2) review
 * pending orders, 3) count and record, 4) review and sign off, 5) adjust and screenshot».
 *
 *   organizing        paso 1: acomodar el material (instrucciones del gerente; el personal marca «listo»).
 *   reviewing_orders  paso 2: revisar las órdenes pendientes. Las entregas de la app no llevan líneas de producto (solo
 *                     facturas y pallets), así que es una confirmación manual con nota.
 *   counting          paso 3: cada línea se toca y se captura cajas + sueltas (o el total); foto opcional.
 *   review            paso 4: el gerente ve sistema vs contado, diferencia y $; manda a recontar; firma (nombre + fecha,
 *                     hoja firmada opcional).
 *   adjusted          paso 5: el gerente sube la captura del ajuste en el ERP. Cerrado.
 *   cancelled         el gerente lo canceló.
 *
 * Quién hace qué (la MISMA regla que la base: `warehouse_ops_in_store` para los pasos 1–3 y `warehouse_ops_can_manage`
 * para crear, recontar, firmar, ajustar y cancelar). Sin React: lo usan la pantalla, la hoja impresa (servidor), las
 * pruebas y el KPI.
 */
import type { Quien } from "./visibilidad";
import { nivelDe } from "./nivel";
import { puedeGestionar, puedeOperar } from "./mantenimiento";

export type Lang = "en" | "es";

// ---------------------------------------------------------------------------
// El alcance
// ---------------------------------------------------------------------------
export const ALCANCES = ["vendor_size", "vendor_note", "product"] as const;
export type Alcance = (typeof ALCANCES)[number];
export function esAlcance(x: unknown): x is Alcance {
  return typeof x === "string" && (ALCANCES as readonly string[]).includes(x);
}
export const INFO_DE_ALCANCE: Record<Alcance, { emoji: string; en: string; es: string; desc_en: string; desc_es: string }> = {
  vendor_size: { emoji: "📐", en: "Supplier + size", es: "Proveedor + medida", desc_en: "Every product of a supplier in one size (e.g. Daltile · 24x48).", desc_es: "Todo lo de un proveedor en una medida (p. ej. Daltile · 24x48)." },
  vendor_note: { emoji: "🏷️", en: "Supplier + note", es: "Proveedor + nota", desc_en: "A supplier's products whose name, collection or color matches a word.", desc_es: "Los productos de un proveedor cuyo nombre, colección o color lleva una palabra." },
  product: { emoji: "📦", en: "One product", es: "Un producto", desc_en: "A single SKU.", desc_es: "Un solo SKU." },
};

export interface AlcanceElegido {
  scope_kind: Alcance;
  vendor_name?: string | null;
  size_in?: string | null;
  note?: string | null;
  product_id?: number | null;
  /** Para el título del alcance «producto» (la base lo arma con el SKU y el nombre del catálogo). */
  product_sku?: string | null;
  product_name?: string | null;
}

/** El título automático: «Daltile · 24x48», «Daltile · Marazzi gris», «PORC-2448 · Porcelain 24x48». La misma regla que `warehouse_ops_create_count`. */
export function tituloDeAlcance(a: AlcanceElegido): string {
  const limpio = (s: string | null | undefined) => (s ?? "").trim();
  switch (a.scope_kind) {
    case "vendor_size": return [limpio(a.vendor_name), limpio(a.size_in)].filter(Boolean).join(" · ");
    case "vendor_note": return [limpio(a.vendor_name), limpio(a.note)].filter(Boolean).join(" · ");
    case "product": return [limpio(a.product_sku), limpio(a.product_name)].filter(Boolean).join(" · ");
  }
}

/** ¿Está completo el alcance para pedir la vista previa / crear? Devuelve qué falta. */
export function faltaDelAlcance(a: AlcanceElegido): "vendor" | "size" | "note" | "product" | null {
  if (a.scope_kind === "product") return a.product_id == null ? "product" : null;
  if (!(a.vendor_name ?? "").trim()) return "vendor";
  if (a.scope_kind === "vendor_size") return (a.size_in ?? "").trim() ? null : "size";
  return (a.note ?? "").trim().length >= 2 ? null : "note";
}

// ---------------------------------------------------------------------------
// Las etapas
// ---------------------------------------------------------------------------
/** Los cinco pasos de Roberto, en orden. `cancelled` va aparte. */
export const ETAPAS_DE_CONTEO = ["organizing", "reviewing_orders", "counting", "review", "adjusted"] as const;
export type EtapaDeConteo = (typeof ETAPAS_DE_CONTEO)[number];
export type EstadoDeConteo = EtapaDeConteo | "cancelled";
export function esEtapaDeConteo(x: unknown): x is EtapaDeConteo {
  return typeof x === "string" && (ETAPAS_DE_CONTEO as readonly string[]).includes(x);
}
export function esEstadoDeConteo(x: unknown): x is EstadoDeConteo {
  return x === "cancelled" || esEtapaDeConteo(x);
}

export const INFO_DE_ETAPA_DE_CONTEO: Record<EstadoDeConteo, { n: number; en: string; es: string; color: string; que_en: string; que_es: string }> = {
  organizing: { n: 1, en: "Organize", es: "Organizar", color: "var(--gray)", que_en: "Get the material ready: one SKU per spot, labels facing out.", que_es: "Acomodar el material: un SKU por lugar, etiquetas a la vista." },
  reviewing_orders: { n: 2, en: "Review pending orders", es: "Revisar órdenes pendientes", color: "var(--amber)", que_en: "Check open deliveries / pick-ups that include these products before counting.", que_es: "Revisar las entregas / recolecciones abiertas que llevan estos productos antes de contar." },
  counting: { n: 3, en: "Count & record", es: "Contar y registrar", color: "var(--accent)", que_en: "Tap each product and enter boxes and loose pieces.", que_es: "Toca cada producto y captura cajas y piezas sueltas." },
  review: { n: 4, en: "Review & sign off", es: "Revisar y firmar", color: "var(--blue, #2563eb)", que_en: "Manager compares system vs counted, sends lines back if needed and signs.", que_es: "El gerente compara sistema vs contado, manda a recontar si hace falta y firma." },
  adjusted: { n: 5, en: "Adjusted", es: "Ajustado", color: "var(--green, #1f8f4e)", que_en: "Adjustment made in the ERP; screenshot attached.", que_es: "Ajuste hecho en el ERP; captura adjunta." },
  cancelled: { n: 0, en: "Cancelled", es: "Cancelado", color: "var(--red)", que_en: "", que_es: "" },
};

export function nombreDeEtapaDeConteo(e: EstadoDeConteo, lang: Lang): string {
  return lang === "es" ? INFO_DE_ETAPA_DE_CONTEO[e].es : INFO_DE_ETAPA_DE_CONTEO[e].en;
}

export interface Conteo {
  id: string;
  store: string;
  scope_kind: Alcance;
  vendor_name: string | null;
  size_in: string | null;
  note: string | null;
  product_id: number | null;
  title: string;
  stage: EstadoDeConteo;
  instructions: string | null;
  comments: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  organized_at: string | null; organized_by: string | null;
  orders_reviewed_at: string | null; orders_reviewed_by: string | null; orders_note: string | null;
  counting_done_at: string | null; counting_done_by: string | null;
  signed_at: string | null; signed_by: string | null; signed_by_name: string | null; signed_sheet: string | null;
  adjusted_at: string | null; adjusted_by: string | null; adjustment_shots: string[];
  cancelled_at: string | null; cancelled_by: string | null; cancel_note: string | null;
}

export interface Linea {
  id: string;
  count_id: string;
  product_id: number | null;
  sku: string;
  name: string;
  size_in: string | null;
  system_qty: number | null;
  price: number | null;
  pieces_per_box: number | null;
  counted_boxes: number | null;
  counted_pieces: number | null;
  counted_total: number | null;
  counted_by: string | null;
  counted_by_name: string | null;
  counted_at: string | null;
  note: string | null;
  photo: string | null;
  recount_requested: boolean;
  recount_note: string | null;
  position: number;
}

/** La etapa siguiente en la línea de los cinco pasos (null en adjusted / cancelled). */
export function siguienteEtapaDeConteo(e: EstadoDeConteo): EtapaDeConteo | null {
  if (e === "cancelled") return null;
  const i = ETAPAS_DE_CONTEO.indexOf(e);
  return i >= 0 && i < ETAPAS_DE_CONTEO.length - 1 ? ETAPAS_DE_CONTEO[i + 1] : null;
}

/** Fecha y actor de cada etapa hecha (para la línea de tiempo), con la MISMA fuente que escribe la base. */
export function fechaDeEtapaDeConteo(c: Conteo, e: EtapaDeConteo): { at: string | null; by: string | null } {
  switch (e) {
    case "organizing": return { at: c.created_at, by: c.created_by };
    case "reviewing_orders": return { at: c.organized_at, by: c.organized_by };
    case "counting": return { at: c.orders_reviewed_at, by: c.orders_reviewed_by };
    case "review": return { at: c.counting_done_at, by: c.counting_done_by };
    case "adjusted": return { at: c.adjusted_at, by: c.adjusted_by };
  }
}

/** ¿Ya se pasó por esta etapa? (la actual incluida). */
export function etapaHecha(c: Pick<Conteo, "stage">, e: EtapaDeConteo): boolean {
  if (c.stage === "cancelled") return false;
  return ETAPAS_DE_CONTEO.indexOf(e) <= ETAPAS_DE_CONTEO.indexOf(c.stage);
}

export function estaAbierto(c: Pick<Conteo, "stage">): boolean {
  return c.stage !== "adjusted" && c.stage !== "cancelled";
}

// ---------------------------------------------------------------------------
// Las cuentas de una línea: contado, diferencia y $
// ---------------------------------------------------------------------------
/** Lo que se contó a partir de cajas + sueltas (si hay piezas por caja) o el total directo. Null si no hay nada. */
export function totalContado(x: { pieces_per_box: number | null }, cajas: number | null, sueltas: number | null, total: number | null): number | null {
  if (cajas != null || sueltas != null) {
    if (x.pieces_per_box == null || x.pieces_per_box <= 0) return null;
    return (cajas ?? 0) * x.pieces_per_box + (sueltas ?? 0);
  }
  return total;
}

/** ¿Lleva piezas por caja? Entonces se capturan cajas + sueltas; si no, solo el total. */
export function capturaPorCajas(x: Pick<Linea, "pieces_per_box">): boolean {
  return x.pieces_per_box != null && x.pieces_per_box > 0;
}

export function estaContada(x: Pick<Linea, "counted_at">): boolean {
  return x.counted_at != null;
}

/** contado − sistema. Null si falta alguno de los dos. */
export function diferencia(x: Pick<Linea, "system_qty" | "counted_total">): number | null {
  if (x.system_qty == null || x.counted_total == null) return null;
  return redondea(x.counted_total - x.system_qty);
}

/** El valor de la diferencia a precio de venta (precio × diferencia), con signo. Null sin precio o sin diferencia. */
export function valorDeLaDiferencia(x: Pick<Linea, "system_qty" | "counted_total" | "price">): number | null {
  const d = diferencia(x);
  if (d == null || x.price == null) return null;
  return redondea(d * x.price, 2);
}

function redondea(n: number, dec = 2): number {
  const f = 10 ** dec;
  return Math.round(n * f) / f;
}

/** El avance del paso 3: líneas contadas / total y el porcentaje entero. */
export function progresoDelConteo(lineas: readonly Pick<Linea, "counted_at">[]): { hechas: number; total: number; pct: number } {
  const total = lineas.length;
  const hechas = lineas.filter(estaContada).length;
  return { hechas, total, pct: total === 0 ? 0 : Math.round((hechas / total) * 100) };
}

export interface ResumenDeConteo {
  lineas: number;
  contadas: number;
  exactas: number;
  conDiferencia: number;
  sinSistema: number;
  /** Suma de |diferencia| en piezas. */
  piezasDeDiferencia: number;
  /** Suma con signo del valor ($). */
  valorNeto: number;
  /** Suma de |valor| ($). */
  valorAbsoluto: number;
  /** exactas / líneas con sistema y contado, en %. Null sin comparables. */
  exactitudPct: number | null;
}

/** El resumen del paso 4: cuántas cuadran, cuántas no, piezas y $ de diferencia, exactitud. */
export function resumenDelConteo(lineas: readonly Pick<Linea, "system_qty" | "counted_total" | "price" | "counted_at">[]): ResumenDeConteo {
  let exactas = 0, conDiferencia = 0, sinSistema = 0, piezas = 0, neto = 0, abs = 0;
  for (const l of lineas) {
    if (l.counted_at == null) continue;
    if (l.system_qty == null) { sinSistema++; continue; }
    const d = diferencia(l) ?? 0;
    if (d === 0) exactas++; else conDiferencia++;
    piezas += Math.abs(d);
    const v = valorDeLaDiferencia(l);
    if (v != null) { neto += v; abs += Math.abs(v); }
  }
  const comparables = exactas + conDiferencia;
  return {
    lineas: lineas.length, contadas: lineas.filter((l) => l.counted_at != null).length, exactas, conDiferencia, sinSistema,
    piezasDeDiferencia: redondea(piezas), valorNeto: redondea(neto), valorAbsoluto: redondea(abs),
    exactitudPct: comparables === 0 ? null : Math.round((exactas / comparables) * 100),
  };
}

/** Un número entero escrito a mano: vacío = null; NaN si no es un entero ≥ 0. */
export function enteroDelCampo(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** ¿Se puede guardar la captura de una línea? Devuelve el motivo si no. */
export function validarCaptura(x: Pick<Linea, "pieces_per_box">, cajas: string, sueltas: string, total: string): { ok: true; cajas: number | null; sueltas: number | null; total: number } | { ok: false; motivo: "numero" | "vacio" } {
  if (capturaPorCajas(x)) {
    const c = enteroDelCampo(cajas), s = enteroDelCampo(sueltas);
    if ((c != null && Number.isNaN(c)) || (s != null && Number.isNaN(s))) return { ok: false, motivo: "numero" };
    if (c == null && s == null) return { ok: false, motivo: "vacio" };
    return { ok: true, cajas: c ?? 0, sueltas: s ?? 0, total: totalContado(x, c ?? 0, s ?? 0, null) ?? 0 };
  }
  const t = enteroDelCampo(total);
  if (t == null) return { ok: false, motivo: "vacio" };
  if (Number.isNaN(t)) return { ok: false, motivo: "numero" };
  return { ok: true, cajas: null, sueltas: null, total: t };
}

export function motivoDeCaptura(m: "numero" | "vacio", lang: Lang): string {
  if (m === "numero") return lang === "es" ? "Solo números enteros (0 o más)." : "Whole numbers only (0 or more).";
  return lang === "es" ? "Captura lo que contaste." : "Enter what you counted.";
}

/** El orden de las líneas al contar: las que faltan (y las mandadas a recontar) primero; después, por posición. */
export function ordenarLineas<T extends Pick<Linea, "counted_at" | "recount_requested" | "position">>(lineas: readonly T[]): T[] {
  return [...lineas].sort((a, b) => (Number(!a.recount_requested) - Number(!b.recount_requested)) || (Number(a.counted_at != null) - Number(b.counted_at != null)) || (a.position - b.position));
}

/** El orden del paso 4: la diferencia más grande en $ primero. */
export function ordenarPorDiferencia<T extends Pick<Linea, "system_qty" | "counted_total" | "price" | "position">>(lineas: readonly T[]): T[] {
  const peso = (l: T) => Math.abs(valorDeLaDiferencia(l) ?? 0) || Math.abs(diferencia(l) ?? 0) * 1e-6;
  return [...lineas].sort((a, b) => (peso(b) - peso(a)) || (a.position - b.position));
}

// ---------------------------------------------------------------------------
// Permisos (la misma regla que la base)
// ---------------------------------------------------------------------------
/** ¿Se le ofrece la sección «Conteos»? A cualquiera con nivel en la app (el personal hace los pasos 1–3). */
export function veConteos(q: Quien): boolean {
  return nivelDe(q) !== null;
}

/** Pasos 1–3 en la tienda: tiene nivel en la app y la tienda es suya (o es admin). = `warehouse_ops_in_store`. */
export function puedeContar(q: Quien, tienda: string): boolean {
  return puedeOperar(q, tienda);
}

/** Crear, recontar, firmar, ajustar, cancelar: = `warehouse_ops_can_manage`. */
export function puedeGestionarConteo(q: Quien, tienda: string): boolean {
  return puedeGestionar(q, tienda);
}

export type AccionDeConteo = "organizado" | "ordenes_revisadas" | "terminar_conteo" | "contar_linea" | "recontar" | "firmar" | "ajustar" | "cancelar";

/**
 * Qué puede hacer quien mira con el conteo en su etapa actual (la MISMA regla que las RPC de la 274):
 * personal: avanzar 1→2→3→4 y capturar líneas en el 3; gestor: además recontar (3–4), firmar (4), ajustar (4, firmado), cancelar (abierto).
 */
export function accionesDeConteo(q: Quien, c: Pick<Conteo, "store" | "stage" | "signed_at">, lineas: readonly Pick<Linea, "counted_at">[]): AccionDeConteo[] {
  const cuenta = puedeContar(q, c.store);
  const gestiona = puedeGestionarConteo(q, c.store);
  if (!cuenta && !gestiona) return [];
  const out: AccionDeConteo[] = [];
  const todas = lineas.length > 0 && lineas.every(estaContada);
  switch (c.stage) {
    case "organizing": out.push("organizado"); break;
    case "reviewing_orders": out.push("ordenes_revisadas"); break;
    case "counting":
      out.push("contar_linea");
      if (todas) out.push("terminar_conteo");
      if (gestiona) out.push("recontar");
      break;
    case "review":
      if (gestiona) {
        out.push("recontar");
        if (!c.signed_at) out.push("firmar"); else out.push("ajustar");
      }
      break;
  }
  if (gestiona && estaAbierto(c)) out.push("cancelar");
  return out;
}

// ---------------------------------------------------------------------------
// La hoja impresa (paso 4)
// ---------------------------------------------------------------------------
export interface FilaDeHojaDeConteo { sku: string; nombre: string; medida: string; sistema: string; contado: string; diferencia: string; valor: number | null; conto: string }

/** Las filas de la hoja de conteo, en el orden de la lista; los números como texto («—» si no hay). */
export function filasDeHojaDeConteo(lineas: readonly Linea[]): FilaDeHojaDeConteo[] {
  return [...lineas].sort((a, b) => a.position - b.position).map((l) => {
    const d = diferencia(l);
    return {
      sku: l.sku, nombre: l.name, medida: l.size_in ?? "", sistema: l.system_qty == null ? "—" : String(l.system_qty),
      contado: l.counted_total == null ? "—" : String(l.counted_total), diferencia: d == null ? "—" : (d > 0 ? `+${d}` : String(d)),
      valor: valorDeLaDiferencia(l), conto: l.counted_by_name ?? "",
    };
  });
}

/** El id del conteo en la URL de la hoja (`?id=`), si es un uuid. */
export function idDeHoja(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^[0-9a-f-]{36}$/i.test(s) ? s : null;
}
