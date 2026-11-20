/**
 * Operaciones de almacén (274, revisada en 333): lo que la sección «Conteos» y el informe de Reportes leen y escriben,
 * y el demo. Todo con la sesión de quien mira: la RLS decide qué filas vuelven; las escrituras van por RPC (security
 * definer con las puertas de la base).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { esUnidadDeConteo, type Alcance, type AlcanceElegido, type Conteo, type EstadoDeConteo, type EtapaDeConteo, type Linea, type Lote, type OrdenPendiente, type UnidadDeConteo } from "./conteos";

/**
 * ¿Falta aplicar la 274? Solo cuando la base dice que la TABLA de conteos no existe (D-1021): el código de «tabla
 * desconocida» (42P01 de Postgres, PGRST205 de la API) Y el nombre de `warehouse_counts` o `warehouse_count_lines`.
 */
export function faltaLa274(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  const m = e.message ?? "";
  const nombraLaTabla = /warehouse_count(s|_lines)(?![a-z_])/.test(m);
  if (e.code === "42P01" || e.code === "PGRST205") return nombraLaTabla;
  if (e.code) return false;
  return nombraLaTabla && /relation .* does not exist|could not find the table/i.test(m);
}

/** ¿Falta aplicar la 333? Solo cuando la base dice que falta la tabla de órdenes pendientes (la de la revisión). */
export function faltaLa333(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  const m = e.message ?? "";
  const nombraLaTabla = /warehouse_count_pending/.test(m);
  if (e.code === "42P01" || e.code === "PGRST205") return nombraLaTabla;
  if (e.code) return false;
  return nombraLaTabla && /relation .* does not exist|could not find the table/i.test(m);
}

export interface Conteos { conteos: Conteo[]; lineas: Linea[]; pendientes: OrdenPendiente[]; sin333: boolean }

export interface Proveedor { vendor_name: string; sizes: string[]; products: number }
export interface ProductoDeConteo { id: number; sku: string; name: string; vendor_name: string | null; size_in: string | null; price: number | null; pieces_per_box: number | null; qoh: number | null }

const DIAS = 120;

/**
 * Lee los conteos de los últimos `dias` días (más los abiertos) y sus líneas y órdenes pendientes. Si la 333 no está,
 * las órdenes pendientes vienen vacías y `sin333` lo dice (la pantalla lo enseña y no ofrece lo que no funciona).
 */
export async function leerConteos(sb: SupabaseClient, dias = DIAS): Promise<Conteos> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const c = await sb.from("warehouse_counts").select("*").or(`created_at.gte.${desde},stage.in.(organizing,counting,review,sign_off)`).order("created_at", { ascending: false });
  if (c.error) throw c.error;
  const conteos = ((c.data ?? []) as Record<string, unknown>[]).map(conteoDeLaFila);
  if (conteos.length === 0) return { conteos, lineas: [], pendientes: [], sin333: false };
  const ids = conteos.map((x) => x.id);
  const l = await sb.from("warehouse_count_lines").select("*").in("count_id", ids).order("position");
  if (l.error) throw l.error;
  const p = await sb.from("warehouse_count_pending").select("*").in("count_id", ids).order("entered_at");
  if (p.error && !faltaLa333(p.error)) throw p.error;
  return {
    conteos,
    lineas: ((l.data ?? []) as Record<string, unknown>[]).map(lineaDeLaFila),
    pendientes: p.error ? [] : ((p.data ?? []) as Record<string, unknown>[]).map(pendienteDeLaFila),
    sin333: !!p.error,
  };
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);

/**
 * La etapa que enseña la pantalla. Las filas de ANTES de la 333 se leen igual que la conversión de la migración:
 * reviewing_orders → counting; review firmado → sign_off; review sin firma se queda en review.
 */
export function etapaDeFila(stage: unknown, signedAt: unknown): EstadoDeConteo {
  if (stage === "reviewing_orders") return "counting";
  if (stage === "review" && signedAt) return "sign_off";
  if (typeof stage === "string" && ["organizing", "counting", "review", "sign_off", "adjusted", "cancelled"].includes(stage)) return stage as EstadoDeConteo;
  return "organizing";
}

export function conteoDeLaFila(x: Record<string, unknown>): Conteo {
  return {
    ...(x as unknown as Conteo),
    stage: etapaDeFila(x.stage, x.signed_at),
    product_id: num(x.product_id),
    adjustment_shots: arr(x.adjustment_shots),
    sign_note: (x.sign_note as string | null) ?? null,
  };
}
/** Los lotes de una línea tal como vienen del jsonb (cualquier cosa que no sea un lote válido se descarta). */
export function lotesDeLaFila(v: unknown): Lote[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object" && num(x.qty) != null)
    .map((x) => ({ qty: num(x.qty) ?? 0, lot: (x.lot as string | null) ?? null, note: (x.note as string | null) ?? null, photo: (x.photo as string | null) ?? null }));
}

export function lineaDeLaFila(x: Record<string, unknown>): Linea {
  return {
    ...(x as unknown as Linea), product_id: num(x.product_id), unit_of_measure: esUnidadDeConteo(x.unit_of_measure) ? x.unit_of_measure : null, lots: lotesDeLaFila(x.lots), system_qty: num(x.system_qty), price: num(x.price), pieces_per_box: num(x.pieces_per_box),
    counted_boxes: num(x.counted_boxes), counted_pieces: num(x.counted_pieces), counted_total: num(x.counted_total), recount_requested: !!x.recount_requested, position: num(x.position) ?? 0,
    system_qty_set_by: (x.system_qty_set_by as string | null) ?? null, system_qty_set_by_name: (x.system_qty_set_by_name as string | null) ?? null, system_qty_set_at: (x.system_qty_set_at as string | null) ?? null,
  };
}
export function pendienteDeLaFila(x: Record<string, unknown>): OrdenPendiente {
  return {
    ...(x as unknown as OrdenPendiente), qty: num(x.qty) ?? 0, note: (x.note as string | null) ?? null, entered_by_name: (x.entered_by_name as string | null) ?? null,
    edited_by_name: (x.edited_by_name as string | null) ?? null, edited_at: (x.edited_at as string | null) ?? null,
  };
}

export async function leerProveedores(sb: SupabaseClient, tienda: string): Promise<Proveedor[]> {
  const { data, error } = await sb.rpc("warehouse_ops_count_vendors", { p_store: tienda });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((v) => ({ vendor_name: String(v.vendor_name ?? ""), sizes: arr(v.sizes), products: num(v.products) ?? 0 }));
}

function paramsDeAlcance(tienda: string, a: AlcanceElegido) {
  return { p_store: tienda, p_scope_kind: a.scope_kind, p_vendor: a.vendor_name ?? null, p_size: a.size_in ?? null, p_note: a.note ?? null, p_product_id: a.product_id ?? null };
}

/** La vista previa del alcance: los productos con el qoh de la tienda (lo mismo que se congela al crear). */
export async function leerProductosDelAlcance(sb: SupabaseClient, tienda: string, a: AlcanceElegido): Promise<ProductoDeConteo[]> {
  const { data, error } = await sb.rpc("warehouse_ops_count_products", paramsDeAlcance(tienda, a));
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
    id: num(p.id) ?? 0, sku: String(p.sku ?? ""), name: String(p.name ?? ""), vendor_name: (p.vendor_name as string | null) ?? null, size_in: (p.size_in as string | null) ?? null,
    price: num(p.price), pieces_per_box: num(p.pieces_per_box), qoh: num(p.qoh),
  }));
}

/** El gestor crea el conteo (congela las líneas). Devuelve el id. */
export async function crearConteo(sb: SupabaseClient, tienda: string, a: AlcanceElegido, notas: string): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_create_count", { ...paramsDeAlcance(tienda, a), p_instructions: notas });
  if (error) throw error;
  return data as string;
}

/** Un paso adelante (personal): organizing → counting; counting → review; review → sign_off (la nota general de la revisión). */
export async function avanzarConteo(sb: SupabaseClient, id: string, etapa: Exclude<EtapaDeConteo, "organizing" | "adjusted">, nota: string | null): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_advance", { p_count: id, p_stage: etapa, p_note: nota });
  if (error) throw error;
}

export interface CapturaDeCantidad { cajas: number | null; sueltas: number | null; total: number | null }

export async function registrarLinea(sb: SupabaseClient, x: { lineaId: string; cajas: number | null; sueltas: number | null; total: number | null; nota: string; foto: string | null }): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_line", { p_line: x.lineaId, p_boxes: x.cajas, p_pieces: x.sueltas, p_total: x.total, p_note: x.nota, p_photo: x.foto });
  if (error) throw error;
}

/** Los lotes de una línea (19 nov): la unidad (caja, bolsa, pieza) y la lista de lotes. La base suma y guarda el total. */
export async function registrarLotes(sb: SupabaseClient, x: { lineaId: string; unidad: UnidadDeConteo; lotes: Lote[] }): Promise<void> {
  const p_lots = x.lotes.map((l) => ({ qty: l.qty, lot: l.lot?.trim() || null, note: l.note?.trim() || null, photo: l.photo }));
  const { error } = await sb.rpc("warehouse_ops_count_lots", { p_line: x.lineaId, p_unit: x.unidad, p_lots });
  if (error) throw error;
}

/** Un producto escrito a mano (no lo encontró la búsqueda): una línea sin producto del catálogo. Devuelve el id de la línea. */
export async function agregarLineaLibre(sb: SupabaseClient, countId: string, nombre: string): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_count_add_line", { p_count: countId, p_name: nombre });
  if (error) throw error;
  return data as string;
}

export async function mandarARecontar(sb: SupabaseClient, lineaId: string, nota: string): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_recount", { p_line: lineaId, p_note: nota });
  if (error) throw error;
}

/** Revisión (personal, etapa review): una orden pendiente de una línea. Cajas + sueltas (si hay piezas por caja) o el total. */
export async function agregarPendiente(sb: SupabaseClient, lineaId: string, x: CapturaDeCantidad & { factura: string; nota: string }): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_pending_add", { p_line: lineaId, p_invoice: x.factura, p_boxes: x.cajas, p_pieces: x.sueltas, p_total: x.total, p_note: x.nota });
  if (error) throw error;
  return data as string;
}

export async function editarPendiente(sb: SupabaseClient, id: string, x: CapturaDeCantidad & { factura: string; nota: string }): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_pending_update", { p_pending: id, p_invoice: x.factura, p_boxes: x.cajas, p_pieces: x.sueltas, p_total: x.total, p_note: x.nota });
  if (error) throw error;
}

export async function quitarPendiente(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_pending_delete", { p_pending: id });
  if (error) throw error;
}

/** Firma (gerente, sign_off): pone o corrige la cantidad del SISTEMA de una línea (quita una firma previa). */
export async function ponerSistema(sb: SupabaseClient, lineaId: string, cantidad: number): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_set_system", { p_line: lineaId, p_qty: cantidad });
  if (error) throw error;
}

/** Firma (gerente, sign_off): firma con la razón (obligatoria si hay diferencias) y la hoja firmada opcional. */
export async function firmarConteo(sb: SupabaseClient, id: string, hoja: string | null, razon: string | null): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_sign", { p_count: id, p_sheet: hoja, p_note: razon });
  if (error) throw error;
}

/** Gerente: regresa de firma a revisión (para corregir órdenes pendientes). */
export async function volverARevision(sb: SupabaseClient, id: string, nota: string): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_back", { p_count: id, p_note: nota });
  if (error) throw error;
}

export async function ajustarConteo(sb: SupabaseClient, id: string, capturas: string[]): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_adjust", { p_count: id, p_shots: capturas });
  if (error) throw error;
}

export async function cancelarConteo(sb: SupabaseClient, id: string, nota: string): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_cancel", { p_count: id, p_note: nota });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Demo (NEXT_PUBLIC_LOCAL_MODE): nada sale de la pantalla. Datos inventados.
// ---------------------------------------------------------------------------
const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const vacio = {
  instructions: null, comments: null, organized_at: null, organized_by: null, counting_done_at: null, counting_done_by: null,
  orders_reviewed_at: null, orders_reviewed_by: null, orders_note: null, signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null, sign_note: null,
  adjusted_at: null, adjusted_by: null, adjustment_shots: [] as string[], cancelled_at: null, cancelled_by: null, cancel_note: null,
};
const alcance = (k: Alcance, vendor: string | null, size: string | null, note: string | null, product: number | null) => ({ scope_kind: k, vendor_name: vendor, size_in: size, note, product_id: product });
const lineaVacia = { unit_of_measure: null, lots: [] as Lote[], system_qty_set_by: null, system_qty_set_by_name: null, system_qty_set_at: null, counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, note: null, photo: null, recount_requested: false, recount_note: null };

export const DEMO_PROVEEDORES: Proveedor[] = [
  { vendor_name: "Daltile", sizes: ["12x24", "24 x 48"], products: 3 },
  { vendor_name: "MSI", sizes: ["12x12", "Hex 2in"], products: 2 },
];
export const DEMO_PRODUCTOS_DE_CONTEO: ProductoDeConteo[] = [
  { id: 101, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", vendor_name: "Daltile", size_in: "24 x 48", price: 9.4, pieces_per_box: 2, qoh: 140 },
  { id: 104, sku: "PORC-2448-WHT", name: "Porcelain 24x48 Polar White", vendor_name: "Daltile", size_in: "24x48", price: 9.9, pieces_per_box: 2, qoh: 62 },
  { id: 105, sku: "PORC-1224-BLK", name: "Porcelain 12x24 Black", vendor_name: "Daltile", size_in: "12x24", price: 3.2, pieces_per_box: 8, qoh: 400 },
  { id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", vendor_name: "MSI", size_in: "12x12", price: 0.82, pieces_per_box: 15, qoh: 1200 },
  { id: 103, sku: "MOS-HEX-MAR", name: "Hexagon Marble Mosaic", vendor_name: "MSI", size_in: "Hex 2in", price: 6.25, pieces_per_box: null, qoh: null },
];

export const DEMO_CONTEOS: Conteos = {
  sin333: false,
  conteos: [
    { ...vacio, ...alcance("vendor_size", "Daltile", "24x48", null, null), id: "c1", store: "McAllen", title: "Daltile · 24x48", stage: "counting", instructions: "Pull the 24x48 pallets to aisle 3, one SKU per spot.",
      created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(1.2), organized_at: dias(1.0), organized_by: "p1" },
    { ...vacio, ...alcance("vendor_size", "MSI", "12x12", "matte", null), id: "c2", store: "McAllen", title: "MSI · 12x12 · matte", stage: "review", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(3),
      organized_at: dias(2.8), organized_by: "p2", counting_done_at: dias(2.2), counting_done_by: "p2" },
    { ...vacio, ...alcance("product", null, null, null, 103), id: "c3", store: "Edinburg", title: "MOS-HEX-MAR · Hexagon Marble Mosaic", stage: "adjusted", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(9),
      organized_at: dias(8.9), organized_by: "p3", counting_done_at: dias(8.5), counting_done_by: "p3", orders_reviewed_at: dias(8.4), orders_reviewed_by: "p3",
      signed_at: dias(8.2), signed_by: "demo-admin", signed_by_name: "Demo Admin", signed_sheet: "demo/hoja-conteo.jpg", adjusted_at: dias(7.5), adjusted_by: "demo-admin", adjustment_shots: ["demo/ajuste-1.jpg"] },
    { ...vacio, ...alcance("vendor_note", "Daltile", null, "black", null), id: "c4", store: "McAllen", title: "Daltile · black", stage: "organizing", instructions: "Group every black Daltile SKU on the front rack.", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(0.1) },
    { ...vacio, ...alcance("vendor_size", "Daltile", "12x24", null, null), id: "c5", store: "McAllen", title: "Daltile · 12x24", stage: "sign_off", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(4),
      organized_at: dias(3.9), organized_by: "p1", counting_done_at: dias(3.2), counting_done_by: "p1", orders_reviewed_at: dias(3.1), orders_reviewed_by: "p1", orders_note: "Two open invoices with PORC-1224-BLK." },
  ],
  lineas: [
    { ...lineaVacia, id: "l1", count_id: "c1", product_id: 101, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", size_in: "24 x 48", system_qty: 140, price: 9.4, pieces_per_box: 2, position: 1,
      counted_boxes: 68, counted_pieces: 1, counted_total: 137, counted_by: "p1", counted_by_name: "Ana García", counted_at: dias(0.5) },
    { ...lineaVacia, id: "l2", count_id: "c1", product_id: 104, sku: "PORC-2448-WHT", name: "Porcelain 24x48 Polar White", size_in: "24x48", system_qty: 62, price: 9.9, pieces_per_box: 2, position: 2 },
    { ...lineaVacia, id: "l3", count_id: "c2", product_id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", size_in: "12x12", system_qty: 1200, price: 0.82, pieces_per_box: 15, position: 1,
      counted_boxes: 79, counted_pieces: 12, counted_total: 1197, counted_by: "p2", counted_by_name: "Luis Treviño", counted_at: dias(2.3) },
    { ...lineaVacia, id: "l4", count_id: "c3", product_id: 103, sku: "MOS-HEX-MAR", name: "Hexagon Marble Mosaic", size_in: "Hex 2in", system_qty: 35, price: 6.25, pieces_per_box: null, position: 1,
      counted_total: 35, counted_by: "p3", counted_by_name: "Mario Salinas", counted_at: dias(8.6) },
    { ...lineaVacia, id: "l5", count_id: "c4", product_id: 105, sku: "PORC-1224-BLK", name: "Porcelain 12x24 Black", size_in: "12x24", system_qty: 400, price: 3.2, pieces_per_box: 8, position: 1 },
    { ...lineaVacia, id: "l6", count_id: "c5", product_id: 105, sku: "PORC-1224-BLK", name: "Porcelain 12x24 Black", size_in: "12x24", system_qty: 400, price: 3.2, pieces_per_box: 8, position: 1,
      counted_boxes: 46, counted_pieces: 0, counted_total: 368, counted_by: "p1", counted_by_name: "Ana García", counted_at: dias(3.3) },
    { ...lineaVacia, id: "l7", count_id: "c5", product_id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", size_in: "12x24", system_qty: null, price: 0.82, pieces_per_box: 15, position: 2,
      counted_boxes: 20, counted_pieces: 0, counted_total: 300, counted_by: "p1", counted_by_name: "Ana García", counted_at: dias(3.3) },
  ],
  pendientes: [
    { id: "o1", count_id: "c5", line_id: "l6", invoice_no: "4471", qty: 16, note: null, entered_by: "p1", entered_by_name: "Ana García", entered_at: dias(3.1), edited_by_name: null, edited_at: null },
    { id: "o2", count_id: "c5", line_id: "l6", invoice_no: "4480", qty: 8, note: "pickup", entered_by: "p1", entered_by_name: "Ana García", entered_at: dias(3.1), edited_by_name: null, edited_at: null },
    { id: "o3", count_id: "c2", line_id: "l3", invoice_no: "4502", qty: 30, note: null, entered_by: "p2", entered_by_name: "Luis Treviño", entered_at: dias(2.2), edited_by_name: null, edited_at: null },
  ],
};
