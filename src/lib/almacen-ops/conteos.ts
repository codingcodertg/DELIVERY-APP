/**
 * Operaciones de almacén (274, revisada en 333): CONTEOS DE INVENTARIO. Roberto (2026-11-19), con el dueño:
 * «Organize, Count, Review, Sign off, Adjust».
 *
 *   organizing   1 Organizar: acomodar el material (las notas del gerente; el personal marca «listo»).
 *   counting     2 Contar: cada línea se toca y se captura cajas + sueltas (o el total).
 *   review       3 Revisar: DESPUÉS de contar, por producto, las órdenes pendientes (factura, cantidad vendida y no
 *                entregada). Lo contado − lo pendiente = lo real.
 *   sign_off     4 Firmar: el gerente ve contado, pendiente, real, SISTEMA (lo tecleado si no venía) y la diferencia
 *                en cajas y en $; con diferencias pide la razón; firma (nombre + fecha; hoja firmada opcional).
 *   adjusted     5 Ajustar: sube la captura del ajuste en el ERP. Cerrado.
 *   cancelled    el gerente lo canceló.
 *
 * La diferencia SIEMPRE es después de las órdenes pendientes: real = contado − pendiente; diferencia = real − sistema.
 * Quién hace qué (la MISMA regla que la base): `warehouse_ops_in_store` para 1–3 y `warehouse_ops_can_manage` para
 * crear, recontar, poner el sistema, firmar, volver, ajustar y cancelar. Sin React: lo usan la pantalla, la hoja
 * impresa (servidor), el informe de Reportes y las pruebas.
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
  vendor_size: { emoji: "📐", en: "Supplier + size", es: "Proveedor + medida", desc_en: "Every product of a supplier in one size. A note is optional and narrows it.", desc_es: "Todo lo de un proveedor en una medida. La nota es opcional y la afina." },
  vendor_note: { emoji: "🏷️", en: "Supplier + note", es: "Proveedor + nota", desc_en: "A supplier's products whose name, collection, color or style has the word.", desc_es: "Los productos de un proveedor cuyo nombre, colección, color o estilo lleva la palabra." },
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

/** El título automático: «Daltile · 24x48», «Daltile · 24x48 · black», «Daltile · black», «PORC-2448 · Porcelain 24x48». */
export function tituloDeAlcance(a: AlcanceElegido): string {
  const limpio = (s: string | null | undefined) => (s ?? "").trim();
  switch (a.scope_kind) {
    case "vendor_size": return [limpio(a.vendor_name), limpio(a.size_in), limpio(a.note)].filter(Boolean).join(" · ");
    case "vendor_note": return [limpio(a.vendor_name), limpio(a.note)].filter(Boolean).join(" · ");
    case "product": return [limpio(a.product_sku), limpio(a.product_name)].filter(Boolean).join(" · ");
  }
}

/** ¿Está completo el alcance para pedir la vista previa / crear? Devuelve qué falta. La nota de «proveedor + medida» es opcional. */
export function faltaDelAlcance(a: AlcanceElegido): "vendor" | "size" | "note" | "product" | null {
  if (a.scope_kind === "product") return a.product_id == null ? "product" : null;
  if (!(a.vendor_name ?? "").trim()) return "vendor";
  if (a.scope_kind === "vendor_size") {
    if (!(a.size_in ?? "").trim()) return "size";
    const nota = (a.note ?? "").trim();
    return nota.length === 0 || nota.length >= 2 ? null : "note";
  }
  return (a.note ?? "").trim().length >= 2 ? null : "note";
}

// ---------------------------------------------------------------------------
// Las etapas
// ---------------------------------------------------------------------------
/** Los cinco pasos, en orden. `cancelled` va aparte. */
export const ETAPAS_DE_CONTEO = ["organizing", "counting", "review", "sign_off", "adjusted"] as const;
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
  counting: { n: 2, en: "Count", es: "Contar", color: "var(--accent)", que_en: "Tap each product and enter boxes and loose pieces.", que_es: "Toca cada producto y captura cajas y piezas sueltas." },
  review: { n: 3, en: "Review", es: "Revisar", color: "var(--amber)", que_en: "Record the pending orders for each product: invoice, quantity sold and not yet delivered.", que_es: "Anota las órdenes pendientes de cada producto: factura, cantidad vendida y no entregada." },
  sign_off: { n: 4, en: "Sign off", es: "Firmar", color: "var(--blue, #2563eb)", que_en: "Manager compares counted minus pending against the system, types the system quantity where missing, and signs.", que_es: "El gerente compara contado menos pendiente contra el sistema, teclea el sistema donde falta y firma." },
  adjusted: { n: 5, en: "Adjust", es: "Ajustar", color: "var(--green, #1f8f4e)", que_en: "Adjustment made in the ERP; screenshot attached.", que_es: "Ajuste hecho en el ERP; captura adjunta." },
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
  /** Las notas del paso 1 («Notes (optional)»). */
  instructions: string | null;
  comments: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  organized_at: string | null; organized_by: string | null;
  counting_done_at: string | null; counting_done_by: string | null;
  /** Entró a «Firmar» (la revisión terminó): la nota general de la revisión va en orders_note. */
  orders_reviewed_at: string | null; orders_reviewed_by: string | null; orders_note: string | null;
  signed_at: string | null; signed_by: string | null; signed_by_name: string | null; signed_sheet: string | null; sign_note: string | null;
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
  system_qty_set_by: string | null;
  system_qty_set_by_name: string | null;
  system_qty_set_at: string | null;
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

/** Una orden pendiente de una línea (paso 3): factura, cantidad vendida y no entregada (en la unidad de la línea). */
export interface OrdenPendiente {
  id: string;
  count_id: string;
  line_id: string;
  invoice_no: string;
  qty: number;
  note: string | null;
  entered_by: string | null;
  entered_by_name: string | null;
  entered_at: string;
  edited_by_name: string | null;
  edited_at: string | null;
}

/** La etapa siguiente en la línea de los cinco pasos (null en adjusted / cancelled). */
export function siguienteEtapaDeConteo(e: EstadoDeConteo): EtapaDeConteo | null {
  if (e === "cancelled") return null;
  const i = ETAPAS_DE_CONTEO.indexOf(e);
  return i >= 0 && i < ETAPAS_DE_CONTEO.length - 1 ? ETAPAS_DE_CONTEO[i + 1] : null;
}

/** Cuándo y quién ENTRÓ a cada etapa (la fuente es la columna que escribe la base). */
export function fechaDeEtapaDeConteo(c: Conteo, e: EtapaDeConteo): { at: string | null; by: string | null } {
  switch (e) {
    case "organizing": return { at: c.created_at, by: c.created_by };
    case "counting": return { at: c.organized_at, by: c.organized_by };
    case "review": return { at: c.counting_done_at, by: c.counting_done_by };
    case "sign_off": return { at: c.orders_reviewed_at, by: c.orders_reviewed_by };
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
// Las cuentas de una línea: contado, pendiente, real, sistema, diferencia y $
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

/** Lo pendiente (órdenes vendidas y no entregadas) de una línea: la suma de sus órdenes. */
export function pendienteDeLinea(pendientes: readonly Pick<OrdenPendiente, "line_id" | "qty">[], lineId: string): number {
  return redondea(pendientes.reduce((s, p) => (p.line_id === lineId ? s + p.qty : s), 0));
}

export interface CuentasDeLinea {
  contado: number | null;
  pendiente: number;
  /** contado − pendiente. */
  real: number | null;
  sistema: number | null;
  /** real − sistema (con signo). Null si falta el contado o el sistema. */
  diferencia: number | null;
  /** diferencia × precio (con signo). Null sin precio. */
  valor: number | null;
}

/** Las cuentas de una línea DESPUÉS de las órdenes pendientes (la misma regla de la firma, el informe y la hoja). */
export function cuentasDeLinea(x: Pick<Linea, "counted_total" | "system_qty" | "price">, pendiente: number): CuentasDeLinea {
  const contado = x.counted_total;
  const real = contado == null ? null : redondea(contado - pendiente);
  const dif = real == null || x.system_qty == null ? null : redondea(real - x.system_qty);
  const valor = dif == null || x.price == null ? null : redondea(dif * x.price, 2);
  return { contado, pendiente, real, sistema: x.system_qty, diferencia: dif, valor };
}

/** Las cajas de una cantidad en piezas (2 decimales) si el producto tiene piezas por caja; si no, null. */
export function enCajas(piezas: number | null, piezasPorCaja: number | null): number | null {
  if (piezas == null || piezasPorCaja == null || piezasPorCaja <= 0) return null;
  return redondea(piezas / piezasPorCaja, 2);
}

/** contado − sistema, SIN las pendientes (la vista de la captura). Null si falta alguno de los dos. */
export function diferencia(x: Pick<Linea, "system_qty" | "counted_total">): number | null {
  if (x.system_qty == null || x.counted_total == null) return null;
  return redondea(x.counted_total - x.system_qty);
}

/** El valor de la diferencia a precio de venta (precio × diferencia), con signo; sin pendientes. */
export function valorDeLaDiferencia(x: Pick<Linea, "system_qty" | "counted_total" | "price">): number | null {
  const d = diferencia(x);
  if (d == null || x.price == null) return null;
  return redondea(d * x.price, 2);
}

export function redondea(n: number, dec = 2): number {
  const f = 10 ** dec;
  return Math.round(n * f) / f;
}

/** El avance del paso 2: líneas contadas / total y el porcentaje entero. */
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
  /** Suma de las órdenes pendientes (piezas). */
  pendientePiezas: number;
  /** Faltan (real < sistema): piezas y $ (positivos). */
  faltanPiezas: number;
  faltanValor: number;
  /** Sobran (real > sistema): piezas y $ (positivos). */
  sobranPiezas: number;
  sobranValor: number;
  /** Suma con signo del valor ($). */
  valorNeto: number;
  /** exactas / líneas comparables, en %. Null sin comparables. */
  exactitudPct: number | null;
}

/** El resumen de la firma: cuántas cuadran DESPUÉS de las pendientes, cuántas no, faltan / sobran en piezas y $. */
export function resumenDelConteo(lineas: readonly Pick<Linea, "id" | "system_qty" | "counted_total" | "price" | "counted_at">[], pendientes: readonly Pick<OrdenPendiente, "line_id" | "qty">[] = []): ResumenDeConteo {
  let exactas = 0, conDiferencia = 0, sinSistema = 0, pend = 0, faltaP = 0, faltaV = 0, sobraP = 0, sobraV = 0, neto = 0;
  for (const l of lineas) {
    if (l.counted_at == null) continue;
    const p = pendienteDeLinea(pendientes, l.id);
    pend += p;
    const c = cuentasDeLinea(l, p);
    if (c.diferencia == null) { sinSistema++; continue; }
    if (c.diferencia === 0) exactas++; else conDiferencia++;
    if (c.diferencia < 0) { faltaP += -c.diferencia; faltaV += -(c.valor ?? 0); }
    if (c.diferencia > 0) { sobraP += c.diferencia; sobraV += c.valor ?? 0; }
    neto += c.valor ?? 0;
  }
  const comparables = exactas + conDiferencia;
  return {
    lineas: lineas.length, contadas: lineas.filter((l) => l.counted_at != null).length, exactas, conDiferencia, sinSistema,
    pendientePiezas: redondea(pend), faltanPiezas: redondea(faltaP), faltanValor: redondea(faltaV), sobranPiezas: redondea(sobraP), sobranValor: redondea(sobraV),
    valorNeto: redondea(neto), exactitudPct: comparables === 0 ? null : Math.round((exactas / comparables) * 100),
  };
}

/** ¿Hay alguna línea con diferencia después de las pendientes? (la firma pide la razón). */
export function hayDiferencias(lineas: readonly Pick<Linea, "id" | "system_qty" | "counted_total" | "price" | "counted_at">[], pendientes: readonly Pick<OrdenPendiente, "line_id" | "qty">[]): boolean {
  return lineas.some((l) => {
    if (l.counted_at == null || l.system_qty == null) return false;
    return cuentasDeLinea(l, pendienteDeLinea(pendientes, l.id)).diferencia !== 0;
  });
}

/** Un número entero escrito a mano: vacío = null; NaN si no es un entero ≥ 0. */
export function enteroDelCampo(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** Un número (con decimales si hace falta) escrito a mano, para la cantidad del sistema: vacío = null; NaN si no es ≥ 0. */
export function numeroDelCampo(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
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

/** El orden de la firma: la diferencia más grande en $ primero (después de las pendientes). */
export function ordenarPorDiferencia<T extends Pick<Linea, "id" | "system_qty" | "counted_total" | "price" | "position">>(lineas: readonly T[], pendientes: readonly Pick<OrdenPendiente, "line_id" | "qty">[] = []): T[] {
  const peso = (l: T) => {
    const c = cuentasDeLinea(l, pendienteDeLinea(pendientes, l.id));
    return Math.abs(c.valor ?? 0) || Math.abs(c.diferencia ?? 0) * 1e-6;
  };
  return [...lineas].sort((a, b) => (peso(b) - peso(a)) || (a.position - b.position));
}

// ---------------------------------------------------------------------------
// Permisos (la misma regla que la base)
// ---------------------------------------------------------------------------
/** ¿Se le ofrece la sección «Conteos»? Al personal con nivel (pasos 1–3), salvo el Associate (solo merma; 17 nov). */
export function veConteos(q: Quien): boolean {
  const n = nivelDe(q);
  return n !== null && n !== "scrap_only";
}

/** Pasos 1–3 en la tienda: tiene nivel en la app y la tienda es suya (o es admin). = `warehouse_ops_in_store`. */
export function puedeContar(q: Quien, tienda: string): boolean {
  return puedeOperar(q, tienda);
}

/** Crear, recontar, poner el sistema, firmar, volver, ajustar, cancelar: = `warehouse_ops_can_manage`. */
export function puedeGestionarConteo(q: Quien, tienda: string): boolean {
  return puedeGestionar(q, tienda);
}

export type AccionDeConteo = "organizado" | "terminar_conteo" | "contar_linea" | "pendiente" | "terminar_revision" | "recontar" | "firmar" | "ajustar" | "volver" | "cancelar";

/**
 * Qué puede hacer quien mira con el conteo en su etapa actual (la MISMA regla que las RPC de la 274/333):
 * personal: 1→2 (organizado), capturar líneas y pasar a revisar en 2, órdenes pendientes y pasar a firmar en 3;
 * gestor: además recontar (2–4), firmar (4, con el sistema de todas las líneas), ajustar (4, firmado), volver a revisar
 * (4), cancelar (abierto).
 */
export function accionesDeConteo(q: Quien, c: Pick<Conteo, "store" | "stage" | "signed_at">, lineas: readonly Pick<Linea, "counted_at">[]): AccionDeConteo[] {
  const cuenta = puedeContar(q, c.store);
  const gestiona = puedeGestionarConteo(q, c.store);
  if (!cuenta && !gestiona) return [];
  const out: AccionDeConteo[] = [];
  const todas = lineas.length > 0 && lineas.every(estaContada);
  switch (c.stage) {
    case "organizing":
      if (cuenta) out.push("organizado");
      break;
    case "counting":
      if (cuenta) { out.push("contar_linea"); if (todas) out.push("terminar_conteo"); }
      if (gestiona) out.push("recontar");
      break;
    case "review":
      if (cuenta) out.push("pendiente", "terminar_revision");
      if (gestiona) out.push("recontar");
      break;
    case "sign_off":
      if (gestiona) {
        out.push("recontar", "volver");
        out.push(c.signed_at ? "ajustar" : "firmar");
      }
      break;
  }
  if (gestiona && estaAbierto(c)) out.push("cancelar");
  return out;
}

// ---------------------------------------------------------------------------
// La hoja impresa (paso 4)
// ---------------------------------------------------------------------------
export interface FilaDeHojaDeConteo { sku: string; nombre: string; medida: string; sistema: string; contado: string; pendiente: string; diferencia: string; valor: number | null; conto: string }

/** Las filas de la hoja de conteo, en el orden de la lista; los números como texto («—» si no hay). La diferencia ya descuenta lo pendiente. */
export function filasDeHojaDeConteo(lineas: readonly Linea[], pendientes: readonly Pick<OrdenPendiente, "line_id" | "qty">[] = []): FilaDeHojaDeConteo[] {
  return [...lineas].sort((a, b) => a.position - b.position).map((l) => {
    const c = cuentasDeLinea(l, pendienteDeLinea(pendientes, l.id));
    const d = c.diferencia;
    return {
      sku: l.sku, nombre: l.name, medida: l.size_in ?? "", sistema: l.system_qty == null ? "—" : String(l.system_qty),
      contado: l.counted_total == null ? "—" : String(l.counted_total), pendiente: c.pendiente ? String(c.pendiente) : "0",
      diferencia: d == null ? "—" : (d > 0 ? `+${d}` : String(d)), valor: c.valor, conto: l.counted_by_name ?? "",
    };
  });
}

/** El id del conteo en la URL de la hoja (`?id=`), si es un uuid. */
export function idDeHoja(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^[0-9a-f-]{36}$/i.test(s) ? s : null;
}
