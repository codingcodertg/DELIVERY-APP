/**
 * Operaciones de almacén (274): lo que la sección «Conteos» lee y escribe, y el demo. Todo con la sesión de quien mira:
 * la RLS de la 274 decide qué filas vuelven; las escrituras van por RPC (security definer con las puertas).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Alcance, AlcanceElegido, Conteo, EtapaDeConteo, Linea } from "./conteos";

/**
 * ¿Falta aplicar la 274? Solo cuando la base dice que la TABLA de conteos no existe (D-1021).
 *
 * Antes cualquier 42P01 / PGRST202 / PGRST205 / 42883 pintaba «Muy pronto», aunque la 274 ya estuviera aplicada: una
 * función u operador que falta, otra tabla que no existe o un caché de esquema a medias no son «falta la 274». Ahora
 * tiene que ser el código de «tabla desconocida» (42P01 de Postgres, PGRST205 de la API) Y nombrar `warehouse_counts` o
 * `warehouse_count_lines`; lo demás sale como error, con su mensaje (mensajeDeError).
 */
export function faltaLa274(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  const m = e.message ?? "";
  const nombraLaTabla = /warehouse_count(s|_lines)(?![a-z_])/.test(m);
  if (e.code === "42P01" || e.code === "PGRST205") return nombraLaTabla;
  if (e.code) return false;
  return nombraLaTabla && /relation .* does not exist|could not find the table/i.test(m);
}

export interface Conteos { conteos: Conteo[]; lineas: Linea[] }

export interface Proveedor { vendor_name: string; sizes: string[]; products: number }
export interface ProductoDeConteo { id: number; sku: string; name: string; vendor_name: string | null; size_in: string | null; price: number | null; pieces_per_box: number | null; qoh: number | null }

const DIAS = 120;

/** Lee los conteos de los últimos 120 días (más los abiertos) y sus líneas. */
export async function leerConteos(sb: SupabaseClient): Promise<Conteos> {
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();
  const c = await sb.from("warehouse_counts").select("*").or(`created_at.gte.${desde},stage.in.(organizing,reviewing_orders,counting,review)`).order("created_at", { ascending: false });
  if (c.error) throw c.error;
  const conteos = ((c.data ?? []) as Record<string, unknown>[]).map(conteoDeLaFila);
  if (conteos.length === 0) return { conteos, lineas: [] };
  const l = await sb.from("warehouse_count_lines").select("*").in("count_id", conteos.map((x) => x.id)).order("position");
  if (l.error) throw l.error;
  return { conteos, lineas: ((l.data ?? []) as Record<string, unknown>[]).map(lineaDeLaFila) };
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);

export function conteoDeLaFila(x: Record<string, unknown>): Conteo {
  return { ...(x as unknown as Conteo), product_id: num(x.product_id), adjustment_shots: arr(x.adjustment_shots) };
}
export function lineaDeLaFila(x: Record<string, unknown>): Linea {
  return {
    ...(x as unknown as Linea), product_id: num(x.product_id), system_qty: num(x.system_qty), price: num(x.price), pieces_per_box: num(x.pieces_per_box),
    counted_boxes: num(x.counted_boxes), counted_pieces: num(x.counted_pieces), counted_total: num(x.counted_total), recount_requested: !!x.recount_requested, position: num(x.position) ?? 0,
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
export async function crearConteo(sb: SupabaseClient, tienda: string, a: AlcanceElegido, instrucciones: string): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_create_count", { ...paramsDeAlcance(tienda, a), p_instructions: instrucciones });
  if (error) throw error;
  return data as string;
}

/** Un paso adelante (personal): a reviewing_orders, counting o review. */
export async function avanzarConteo(sb: SupabaseClient, id: string, etapa: EtapaDeConteo, nota: string | null): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_advance", { p_count: id, p_stage: etapa, p_note: nota });
  if (error) throw error;
}

export async function registrarLinea(sb: SupabaseClient, x: { lineaId: string; cajas: number | null; sueltas: number | null; total: number | null; nota: string; foto: string | null }): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_line", { p_line: x.lineaId, p_boxes: x.cajas, p_pieces: x.sueltas, p_total: x.total, p_note: x.nota, p_photo: x.foto });
  if (error) throw error;
}

export async function mandarARecontar(sb: SupabaseClient, lineaId: string, nota: string): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_recount", { p_line: lineaId, p_note: nota });
  if (error) throw error;
}

export async function firmarConteo(sb: SupabaseClient, id: string, hoja: string | null): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_count_sign", { p_count: id, p_sheet: hoja });
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
// Demo (NEXT_PUBLIC_LOCAL_MODE): nada sale de la pantalla.
// ---------------------------------------------------------------------------
const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const vacio = {
  instructions: null, comments: null, organized_at: null, organized_by: null, orders_reviewed_at: null, orders_reviewed_by: null, orders_note: null,
  counting_done_at: null, counting_done_by: null, signed_at: null, signed_by: null, signed_by_name: null, signed_sheet: null,
  adjusted_at: null, adjusted_by: null, adjustment_shots: [] as string[], cancelled_at: null, cancelled_by: null, cancel_note: null,
};
const alcance = (k: Alcance, vendor: string | null, size: string | null, note: string | null, product: number | null) => ({ scope_kind: k, vendor_name: vendor, size_in: size, note, product_id: product });
const lineaVacia = { counted_boxes: null, counted_pieces: null, counted_total: null, counted_by: null, counted_by_name: null, counted_at: null, note: null, photo: null, recount_requested: false, recount_note: null };

export const DEMO_PROVEEDORES: Proveedor[] = [
  { vendor_name: "Daltile", sizes: ["12x24", "24x48"], products: 3 },
  { vendor_name: "MSI", sizes: ["12x12", "Hex 2in"], products: 2 },
];
export const DEMO_PRODUCTOS_DE_CONTEO: ProductoDeConteo[] = [
  { id: 101, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", vendor_name: "Daltile", size_in: "24x48", price: 9.4, pieces_per_box: 2, qoh: 140 },
  { id: 104, sku: "PORC-2448-WHT", name: "Porcelain 24x48 Polar White", vendor_name: "Daltile", size_in: "24x48", price: 9.9, pieces_per_box: 2, qoh: 62 },
  { id: 105, sku: "PORC-1224-BLK", name: "Porcelain 12x24 Black", vendor_name: "Daltile", size_in: "12x24", price: 3.2, pieces_per_box: 8, qoh: 400 },
  { id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", vendor_name: "MSI", size_in: "12x12", price: 0.82, pieces_per_box: 15, qoh: 1200 },
  { id: 103, sku: "MOS-HEX-MAR", name: "Hexagon Marble Mosaic", vendor_name: "MSI", size_in: "Hex 2in", price: 6.25, pieces_per_box: null, qoh: 35 },
];

export const DEMO_CONTEOS: Conteos = {
  conteos: [
    { ...vacio, ...alcance("vendor_size", "Daltile", "24x48", null, null), id: "c1", store: "McAllen", title: "Daltile · 24x48", stage: "counting", instructions: "Pull the 24x48 pallets to aisle 3, one SKU per spot.",
      created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(1.2), organized_at: dias(1.0), organized_by: "p1", orders_reviewed_at: dias(0.9), orders_reviewed_by: "p1", orders_note: "Two open deliveries with PORC-2448-GRY (inv 4471, 4480), not pulled yet." },
    { ...vacio, ...alcance("vendor_size", "MSI", "12x12", null, null), id: "c2", store: "McAllen", title: "MSI · 12x12", stage: "review", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(3),
      organized_at: dias(2.8), organized_by: "p2", orders_reviewed_at: dias(2.7), orders_reviewed_by: "p2", orders_note: "None open.", counting_done_at: dias(2.2), counting_done_by: "p2" },
    { ...vacio, ...alcance("product", null, null, null, 103), id: "c3", store: "Edinburg", title: "MOS-HEX-MAR · Hexagon Marble Mosaic", stage: "adjusted", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(9),
      organized_at: dias(8.9), organized_by: "p3", orders_reviewed_at: dias(8.8), orders_reviewed_by: "p3", counting_done_at: dias(8.5), counting_done_by: "p3",
      signed_at: dias(8.2), signed_by: "demo-admin", signed_by_name: "Demo Admin", signed_sheet: "demo/hoja-conteo.jpg", adjusted_at: dias(7.5), adjusted_by: "demo-admin", adjustment_shots: ["demo/ajuste-1.jpg"] },
    { ...vacio, ...alcance("vendor_note", "Daltile", null, "black", null), id: "c4", store: "McAllen", title: "Daltile · black", stage: "organizing", instructions: "Group every black Daltile SKU on the front rack.", created_by: "demo-admin", created_by_name: "Demo Admin", created_at: dias(0.1) },
  ],
  lineas: [
    { ...lineaVacia, id: "l1", count_id: "c1", product_id: 101, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", size_in: "24x48", system_qty: 140, price: 9.4, pieces_per_box: 2, position: 1,
      counted_boxes: 68, counted_pieces: 1, counted_total: 137, counted_by: "p1", counted_by_name: "Ana García", counted_at: dias(0.5) },
    { ...lineaVacia, id: "l2", count_id: "c1", product_id: 104, sku: "PORC-2448-WHT", name: "Porcelain 24x48 Polar White", size_in: "24x48", system_qty: 62, price: 9.9, pieces_per_box: 2, position: 2 },
    { ...lineaVacia, id: "l3", count_id: "c2", product_id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", size_in: "12x12", system_qty: 1200, price: 0.82, pieces_per_box: 15, position: 1,
      counted_boxes: 79, counted_pieces: 12, counted_total: 1197, counted_by: "p2", counted_by_name: "Luis Treviño", counted_at: dias(2.3) },
    { ...lineaVacia, id: "l4", count_id: "c3", product_id: 103, sku: "MOS-HEX-MAR", name: "Hexagon Marble Mosaic", size_in: "Hex 2in", system_qty: 35, price: 6.25, pieces_per_box: null, position: 1,
      counted_total: 35, counted_by: "p3", counted_by_name: "Mario Salinas", counted_at: dias(8.6) },
    { ...lineaVacia, id: "l5", count_id: "c4", product_id: 105, sku: "PORC-1224-BLK", name: "Porcelain 12x24 Black", size_in: "12x24", system_qty: 400, price: 3.2, pieces_per_box: 8, position: 1 },
  ],
};
