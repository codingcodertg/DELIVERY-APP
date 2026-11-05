/**
 * Operaciones de almacén (D-883, migración 247): lo que la pantalla lee y escribe, y el demo.
 * Todo con la sesión de quien mira: la RLS de la 247 decide qué filas vuelven.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoDeReporte } from "./tipos";
import type { Quien } from "./visibilidad";
import type { ProductoElegido, Respuestas } from "./pasos";

export const CUBO = "warehouse-ops";

export interface Persona { id: string; full_name: string; store: string | null }
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
}

export interface Envio {
  kind: TipoDeReporte;
  store: string;
  subjectIds: string[];
  answers: Respuestas;
  photos: string[];
  scrap: null | {
    product_id: number; scrap_type: string; boxes: number; pieces_per_box: number; loose_pieces: number;
    return_type: string; reason: string; broken_by: string[]; crma: string | null;
  };
}

/** ¿Falta aplicar la 247? (tabla o función que la API no conoce). */
export function faltaLaMigracion(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883"
    || /warehouse_reports|warehouse_ops_/.test(e.message ?? "") && /does not exist|schema cache|not find/i.test(e.message ?? "");
}

export async function buscarProductos(sb: SupabaseClient, q: string): Promise<ProductoElegido[]> {
  const { data, error } = await sb.rpc("warehouse_ops_search_products", { q });
  if (error) throw error;
  return ((data ?? []) as ProductoElegido[]).map((p) => ({ ...p, cost: p.cost == null ? null : Number(p.cost) }));
}

export async function registrar(sb: SupabaseClient, e: Envio): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_file_report", {
    p_kind: e.kind, p_store: e.store, p_subject_ids: e.subjectIds, p_answers: e.answers, p_photos: e.photos, p_scrap: e.scrap,
  });
  if (error) throw error;
  return data as string;
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
  { id: "p1", full_name: "Ana García", store: "McAllen" },
  { id: "p2", full_name: "Luis Treviño", store: "McAllen" },
  { id: "p3", full_name: "Mario Salinas", store: "Edinburg" },
  { id: "p4", full_name: "Rosa Peña", store: "Harlingen" },
  { id: "demo-admin", full_name: "Demo Admin", store: "McAllen" },
];
export const DEMO_PRODUCTOS: ProductoElegido[] = [
  { id: 101, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", cost: 9.4, pieces_per_box: 2 },
  { id: 102, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", cost: 0.82, pieces_per_box: 15 },
  { id: 103, sku: "MOS-HEX-MAR", name: "Hexagon Marble Mosaic", cost: 6.25, pieces_per_box: 10 },
];
const dias = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const vacio = { product_id: null, product_sku: null, product_name: null, scrap_type: null, boxes: null, pieces_per_box: null, loose_pieces: null, total_pieces: null, unit_cost: null, total_loss: null, return_type: null, reason: null, broken_by: [], crma: null, photos: [] };
export const DEMO_REPORTES: Reporte[] = [
  { ...vacio, id: "r1", created_at: dias(0.1), kind: "scrap", store: "McAllen", author_id: "p1", author_name: "Ana García", subject_ids: [], answers: { comments: "Pallet slid off the forks" },
    product_id: 101, product_sku: "PORC-2448-GRY", product_name: "Porcelain 24x48 Ash Grey", scrap_type: "damaged", boxes: 3, pieces_per_box: 2, loose_pieces: 1, total_pieces: 7, unit_cost: 9.4, total_loss: 65.8, return_type: "internal", reason: "forklift", broken_by: ["p2"], crma: null },
  { ...vacio, id: "r2", created_at: dias(1.3), kind: "safety", store: "McAllen", author_id: "p2", author_name: "Luis Treviño", subject_ids: ["p1"], answers: { safety_type: "ppe", description: "Loading without gloves", injured: "no" } },
  { ...vacio, id: "r3", created_at: dias(3), kind: "maintenance", store: "Edinburg", author_id: "p3", author_name: "Mario Salinas", subject_ids: [], answers: { equipment: "forklift_2", issue: "repair_needed", description: "Hydraulic leak under the mast" } },
  { ...vacio, id: "r4", created_at: dias(9), kind: "scrap", store: "Edinburg", author_id: "p3", author_name: "Mario Salinas", subject_ids: [], answers: {},
    product_id: 102, product_sku: "CER-1212-WHT", product_name: "Ceramic 12x12 Matte White", scrap_type: "sample", boxes: 0, pieces_per_box: 15, loose_pieces: 6, total_pieces: 6, unit_cost: 0.82, total_loss: 4.92, return_type: "customer_return", reason: "transportation", broken_by: [], crma: "CR-2291" },
  { ...vacio, id: "r5", created_at: dias(2), kind: "positive", store: "McAllen", author_id: "demo-admin", author_name: "Demo Admin", subject_ids: ["p2"], answers: { employee: "p2", category: "safety", description: "Cleared the blocked exit before the delivery came in" } },
  { ...vacio, id: "r6", created_at: dias(4), kind: "insubordination", store: "Harlingen", author_id: "demo-admin", author_name: "Demo Admin", subject_ids: ["p4"], answers: { severity: "minor", description: "Refused to restack the returns cage", verbal_warning: "yes" } },
];
