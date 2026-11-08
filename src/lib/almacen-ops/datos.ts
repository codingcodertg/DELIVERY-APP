/**
 * Operaciones de almacén (D-883, migración 247): lo que la pantalla lee y escribe, y el demo.
 * Todo con la sesión de quien mira: la RLS de la 247 decide qué filas vuelven.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoDeReporte } from "./tipos";
import type { Quien } from "./visibilidad";
import type { ProductoElegido, Respuestas } from "./pasos";
import { tipoDeReparto, type Cantidades, type Reparto } from "./perdida";
import type { Repetida } from "./fotos";

export const CUBO = "warehouse-ops";

export interface Persona { id: string; full_name: string; store: string | null; role?: string | null; module_access?: string[] | null; left_at?: string | null }
export interface Yo extends Quien { full_name: string }

export interface Reporte {
  id: string;
  created_at: string;
  kind: TipoDeReporte;
  store: string;
  author_id: string;
  author_name: string | null;
  subject_ids: string[];
  answers: Respuestas;
  photos: string[];
  product_id: number | null;
  product_sku: string | null;
  product_name: string | null;
  scrap_type: string | null;
  boxes: number | null;
  pieces_per_box: number | null;
  loose_pieces: number | null;
  total_pieces: number | null;
  unit_cost: number | null;
  total_loss: number | null;
  return_type: string | null;
  reason: string | null;
  broken_by: string[];
  crma: string | null;
  /** 266: el día en que se rompió la merma (YYYY-MM-DD). Null en lo que no es merma. */
  broken_on?: string | null;
  /** 254: de `total_pieces`, cuántas dañadas y cuántas de muestra. Null en los reportes de antes (una sola opción). */
  damaged_pieces?: number | null;
  sample_pieces?: number | null;
  /** 252: producto escrito a mano, no está en el catálogo (un gerente lo vincula o corrige). */
  product_not_in_catalog?: boolean;
  /** 268: el SHA-256 de cada foto, alineado con `photos` (null en las de antes de la 268, hasta que alguien abra la tarjeta). */
  photo_hashes?: (string | null)[] | null;
  /** 268: merma guardada SIN foto (la apuntaron en papel); queda incompleta hasta que le agreguen la foto. */
  photo_pending?: boolean | null;
  /** 270 (D-921): la etapa de la merma y sus fechas / actores / adjuntos. No vienen si la 270 no está aplicada. */
  stage?: string | null;
  photographed_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  approval_sheet?: string | null;
  dumped_at?: string | null;
  dumped_by?: string | null;
  adjusted_at?: string | null;
  adjusted_by?: string | null;
  adjustment_proof?: string | null;
}

export interface Envio {
  kind: TipoDeReporte;
  store: string;
  subjectIds: string[];
  answers: Respuestas;
  photos: string[];
  scrap: null | {
    product_id: number | null; free_name?: string; unit_cost?: number | null; scrap_type: string; damaged_pieces: number; sample_pieces: number; boxes: number; pieces_per_box: number; loose_pieces: number;
    return_type: string; reason: string; broken_by: string[]; crma: string | null;
  };
}

/** ¿Falta aplicar la 247? (tabla o función que la API no conoce). */
export function faltaLaMigracion(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883"
    || /warehouse_reports|warehouse_ops_/.test(e.message ?? "") && /does not exist|schema cache|not find/i.test(e.message ?? "");
}

/** 272: la RPC devuelve en `cost` el PRECIO DE VENTA (erp.products.price), no el costo del proveedor. */
export async function buscarProductos(sb: SupabaseClient, q: string): Promise<ProductoElegido[]> {
  const { data, error } = await sb.rpc("warehouse_ops_search_products", { q });
  if (error) throw error;
  return ((data ?? []) as ProductoElegido[]).map((p) => ({ ...p, cost: p.cost == null ? null : Number(p.cost) }));
}

/**
 * 268: agrega fotos a un reporte ya guardado (la merma «sin foto» que apuntaron en papel). La base exige al menos una,
 * quita `photo_pending` y guarda las huellas. Solo el autor o quien corrige la merma de esa tienda.
 */
export async function agregarFotos(sb: SupabaseClient, reporteId: string, rutas: string[], huellas: string[]): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_add_photos", { p_report: reporteId, p_photos: rutas, p_hashes: huellas });
  if (error) throw error;
}

/** 268: guarda las huellas de las fotos de un reporte de antes (se calculan al abrir la tarjeta). Solo rellena huecos. */
export async function guardarHuellas(sb: SupabaseClient, reporteId: string, huellas: (string | null)[]): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_set_photo_hashes", { p_report: reporteId, p_hashes: huellas });
  if (error) throw error;
}

/** 268: ¿otro reporte (que quien mira puede ver) ya usó una foto con esta huella? El más reciente primero. */
export async function reportesConLaFoto(sb: SupabaseClient, huella: string): Promise<Repetida[]> {
  const { data, error } = await sb.from("warehouse_reports").select("id, created_at, broken_on, store, product_name")
    .contains("photo_hashes", [huella]).order("created_at", { ascending: false }).limit(5);
  // Sin la 268 la columna no existe: no hay huellas que comparar, y no es un error para quien llena.
  if (error) { if (faltaLaColumna(error)) return []; throw error; }
  return ((data ?? []) as { id: string; created_at: string; broken_on: string | null; store: string | null; product_name: string | null }[])
    .map((x) => ({ reporteId: x.id, created_at: x.created_at, broken_on: x.broken_on, store: x.store, product_name: x.product_name }));
}

/** ¿Falta una columna (la 268 aún no se aplicó)? */
export function faltaLaColumna(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|photo_hashes|photo_pending/i.test(e.message ?? ""));
}

/**
 * 270 (D-921): mueve la etapa de una merma (aprobada, desechada, ajustada; o un paso atrás si es admin). `prueba` es
 * la ruta en el cubo de la hoja firmada (aprobada) o de la captura del sistema (ajustada). La base revisa el orden,
 * quién llama (`warehouse_ops_can_manage`) y que el adjunto venga cuando toca; guarda fecha y actor.
 */
export async function cambiarEtapa(sb: SupabaseClient, reporteId: string, etapa: string, prueba: string | null = null): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_set_scrap_stage", { p_report: reporteId, p_stage: etapa, p_proof: prueba });
  if (error) throw error;
}

/** Los tipos que admite el cubo para la hoja firmada y la captura (la 270 agrega el PDF). */
export const TIPOS_DE_ADJUNTO = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export function tipoDeAdjuntoValido(tipo: string): tipo is (typeof TIPOS_DE_ADJUNTO)[number] {
  return (TIPOS_DE_ADJUNTO as readonly string[]).includes(tipo);
}

/** 270: sube la hoja firmada o la captura (imagen o PDF) a la carpeta de quien la sube. Devuelve la ruta dentro del cubo. */
export async function subirAdjunto(sb: SupabaseClient, uid: string, f: Blob, tipo: string, que: "hoja" | "ajuste"): Promise<string> {
  if (!tipoDeAdjuntoValido(tipo)) throw new Error("warehouse_ops: adjunto no válido (imagen o PDF)");
  const ext = tipo === "application/pdf" ? "pdf" : tipo === "image/png" ? "png" : tipo === "image/webp" ? "webp" : "jpg";
  const ruta = `${uid}/${que}-${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from(CUBO).upload(ruta, f, { contentType: tipo, upsert: false });
  if (error) throw error;
  return ruta;
}

export async function registrar(sb: SupabaseClient, e: Envio): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_file_report", {
    p_kind: e.kind, p_store: e.store, p_subject_ids: e.subjectIds, p_answers: e.answers, p_photos: e.photos, p_scrap: e.scrap,
  });
  if (error) throw error;
  return data as string;
}

/** 252: el gerente vincula la merma a un producto del catálogo (productId) o corrige nombre y precio a mano. */
export async function corregirMerma(sb: SupabaseClient, reporteId: string, c: { productId: number | null; nombre: string; costo: number | null }): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_edit_scrap_product", {
    p_report: reporteId, p_product_id: c.productId, p_name: c.nombre, p_cost: c.costo,
  });
  if (error) throw error;
}

/**
 * 263: el gerente corrige de dónde viene la merma y su CRMA (que es opcional y suele llegar después del reporte). La
 * base recalcula la pérdida: una devolución de cliente sin CRMA no cuenta; al ponerle el CRMA, cuenta.
 */
export async function corregirOrigenDeMerma(sb: SupabaseClient, reporteId: string, c: { origen: "internal" | "customer_return"; crma: string | null }): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_edit_scrap_origin", { p_report: reporteId, p_return_type: c.origen, p_crma: c.crma });
  if (error) throw error;
}

/** El cuerpo de merma que va a `warehouse_ops_file_report`. Fuera de catálogo: sin product_id, con nombre y precio de venta. */
export function productoParaEnviar(p: ProductoElegido): { product_id: number | null; free_name?: string; unit_cost?: number | null } {
  return p.libre || p.id == null ? { product_id: null, free_name: p.name.trim(), unit_cost: p.cost } : { product_id: p.id };
}

/**
 * Las cuentas de la merma que van a `warehouse_ops_file_report` (254): cajas, el reparto dañadas / muestra, de dónde
 * viene y el CRMA. El CRMA es opcional y solo viaja si es devolución de cliente (si alguien lo escribió y luego cambió
 * a «interno», no se guarda). Un borrador de Warehouse Ops 0.4.0 no trae el origen: el resumen lo pide antes de enviar.
 */
export function mermaParaEnviar(r: Respuestas): Omit<NonNullable<Envio["scrap"]>, "product_id" | "free_name" | "unit_cost"> {
  const q = r.qty as Cantidades;
  const s = r.split as Reparto;
  const devolucion = r.return_type === "customer_return";
  return {
    scrap_type: tipoDeReparto(s), damaged_pieces: s.damaged, sample_pieces: s.sample,
    boxes: q.boxes, pieces_per_box: q.piecesPerBox, loose_pieces: 0,
    return_type: devolucion ? "customer_return" : "internal", reason: String(r.reason), broken_by: (r.broken_by as string[] | undefined) ?? [],
    crma: devolucion && typeof r.crma === "string" && r.crma.trim() ? r.crma.trim() : null,
  };
}

/** Sube una foto (ya comprimida, `data:` JPEG) a la carpeta de quien la saca. Devuelve la ruta dentro del cubo. */
export async function subirFoto(sb: SupabaseClient, uid: string, dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const ruta = `${uid}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(CUBO).upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return ruta;
}

export async function enlacesDeFotos(sb: SupabaseClient, rutas: string[]): Promise<string[]> {
  if (rutas.length === 0) return [];
  const { data } = await sb.storage.from(CUBO).createSignedUrls(rutas, 600);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}

// ---------------------------------------------------------------------------
// Demo (NEXT_PUBLIC_LOCAL_MODE): nada sale de la pantalla.
// ---------------------------------------------------------------------------
export const DEMO_TIENDAS = ["McAllen", "Edinburg", "Harlingen"];
export const DEMO_YO: Yo = { id: "demo-admin", role: "admin", store: "McAllen", full_name: "Demo Admin", module_access: ["warehouse_ops"] };
export const DEMO_PERSONAS: Persona[] = [
  { id: "p1", full_name: "Ana García", store: "McAllen", role: "warehouse" },
  { id: "p2", full_name: "Luis Treviño", store: "McAllen", role: "warehouse" },
  { id: "p3", full_name: "Mario Salinas", store: "Edinburg", role: "warehouse" },
  { id: "p4", full_name: "Rosa Peña", store: "Harlingen", role: "warehouse" },
  { id: "p5", full_name: "Sofía Ruiz", store: "McAllen", role: "sales" },
  { id: "demo-admin", full_name: "Demo Admin", store: "McAllen", role: "admin" },
];
export const DEMO_PRODUCTOS: ProductoElegido[] = [
  { id: 101, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", cost: 9.4, pieces_per_box: 2 },
  { id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", cost: 0.82, pieces_per_box: 15 },
  { id: 103, sku: "MOS-HEX-MAR", name: "Hexagon Marble Mosaic", cost: 6.25, pieces_per_box: 10 },
];
const dias = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const vacio = { damaged_pieces: null, sample_pieces: null, product_id: null, product_sku: null, product_name: null, scrap_type: null, boxes: null, pieces_per_box: null, loose_pieces: null, total_pieces: null, unit_cost: null, total_loss: null, return_type: null, reason: null, broken_by: [], crma: null, photos: [], photo_hashes: [], photo_pending: false,
  stage: null as string | null, photographed_at: null, approved_at: null, approved_by: null, approval_sheet: null, dumped_at: null, dumped_by: null, adjusted_at: null, adjusted_by: null, adjustment_proof: null };
// 268 (demo): r1 y r4 comparten una foto (misma huella) para ver la marca de «foto repetida»; r7 está guardada sin foto.
const HUELLA_DEMO = "a".repeat(64);
const DEMO_FOTOS = { photos: ["demo/1.jpg", "demo/2.jpg"], photo_hashes: [HUELLA_DEMO, "b".repeat(64)] };
export const DEMO_REPORTES: Reporte[] = [
  { ...vacio, ...DEMO_FOTOS, stage: "photographed", photographed_at: dias(0.1), id: "r1", created_at: dias(0.1), kind: "scrap", store: "McAllen", author_id: "p1", author_name: "Ana García", subject_ids: [], answers: { comments: "Pallet slid off the forks" },
    product_id: 101, product_sku: "PORC-2448-GRY", product_name: "Porcelain 24x48 Ash Grey", scrap_type: "mixed", damaged_pieces: 5, sample_pieces: 2, boxes: 3, pieces_per_box: 2, loose_pieces: 1, total_pieces: 7, unit_cost: 9.4, total_loss: 47, return_type: "internal", reason: "forklift", broken_by: ["p2"], crma: null },
  { ...vacio, id: "r2", created_at: dias(1.3), kind: "safety", store: "McAllen", author_id: "p2", author_name: "Luis Treviño", subject_ids: ["p1"], answers: { safety_type: "ppe", description: "Loading without gloves", injured: "no" } },
  { ...vacio, id: "r3", created_at: dias(3), kind: "maintenance", store: "Edinburg", author_id: "p3", author_name: "Mario Salinas", subject_ids: [], answers: { equipment: "forklift_2", issue: "repair_needed", description: "Hydraulic leak under the mast" } },
  // 270 (demo): r4 ya fue aprobada y desechada (para ver la línea de tiempo y «ajustar»).
  { ...vacio, photos: ["demo/3.jpg"], photo_hashes: [HUELLA_DEMO], stage: "dumped", photographed_at: dias(9), approved_at: dias(7), approved_by: "demo-admin", approval_sheet: "demo/hoja.jpg", dumped_at: dias(6), dumped_by: "demo-admin", id: "r4", created_at: dias(9), kind: "scrap", store: "Edinburg", author_id: "p3", author_name: "Mario Salinas", subject_ids: [], answers: {},
    product_id: 102, product_sku: "CER-1212-WHT", product_name: "Ceramic 12x12 Matte White", scrap_type: "sample", damaged_pieces: 0, sample_pieces: 6, boxes: 0, pieces_per_box: 15, loose_pieces: 6, total_pieces: 6, unit_cost: 0.82, total_loss: 0, return_type: "customer_return", reason: "transportation", broken_by: [], crma: "CR-2291" },
  // Devolución de cliente SIN CRMA: no cuenta como pérdida hasta que el gerente le ponga el CRMA (263).
  { ...vacio, photo_pending: true, stage: "documented", id: "r7", created_at: dias(1.5), kind: "scrap", store: "Harlingen", author_id: "p4", author_name: "Rosa Peña", subject_ids: [], answers: {},
    product_id: 103, product_sku: "MOS-HEX-MAR", product_name: "Hexagon Marble Mosaic", scrap_type: "damaged", damaged_pieces: 4, sample_pieces: 0, boxes: 0, pieces_per_box: 10, loose_pieces: 4, total_pieces: 4, unit_cost: 6.25, total_loss: 0, return_type: "customer_return", reason: "transportation", broken_by: [], crma: null },
  { ...vacio, id: "r5", created_at: dias(2), kind: "positive", store: "McAllen", author_id: "demo-admin", author_name: "Demo Admin", subject_ids: ["p2"], answers: { employee: "p2", category: "safety", description: "Cleared the blocked exit before the delivery came in" } },
  { ...vacio, id: "r6", created_at: dias(4), kind: "insubordination", store: "Harlingen", author_id: "demo-admin", author_name: "Demo Admin", subject_ids: ["p4"], answers: { severity: "minor", description: "Refused to restack the returns cage", verbal_warning: "yes" } },
];
