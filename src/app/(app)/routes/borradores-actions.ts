"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Borradores de ruta (D-953, migración 279): guardar/cargar versiones nombradas de las rutas de un día. Solo admin y
 * logística. Con la sesión de quien llama, así que la RLS de `route_drafts` y el guard de `deliveries` deciden de verdad;
 * aquí se comprueba el rol solo para contestar con un aviso en vez de con cero filas.
 */

const SIN_TABLA = "Falta aplicar la migración 279 (borradores de ruta).";
const esSinTabla = (e: { code?: string } | null | undefined) => e?.code === "42P01";

async function gate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: p } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  const role = (p?.role as string | null) ?? null;
  if (role !== "admin" && role !== "logistics") return { ok: false as const, message: "Only an admin or logistics can use route drafts." };
  return { ok: true as const, supabase, user, nombre: (p?.full_name as string | null) ?? null };
}

export interface BorradorFila { id: string; name: string; created_at: string; created_by_name: string | null; n: number }
type PayloadFila = { id: string; assigned_driver: string | null; route_seq: number | null };

/** Los borradores guardados de ese día (sin el payload completo, solo cuántas paradas trae). */
export async function listarBorradores(day: string): Promise<{ ok: true; borradores: BorradorFila[] } | { ok: false; message: string }> {
  const a = await gate();
  if (!a.ok) return a;
  const { data, error } = await a.supabase.from("route_drafts").select("id, name, created_at, created_by_name, payload")
    .eq("day", day).order("created_at", { ascending: true });
  if (error) return { ok: false, message: esSinTabla(error) ? SIN_TABLA : error.message };
  const borradores = (data ?? []).map((r) => ({
    id: r.id as string, name: r.name as string, created_at: r.created_at as string,
    created_by_name: (r.created_by_name as string | null) ?? null,
    n: Array.isArray(r.payload) ? (r.payload as unknown[]).length : 0,
  }));
  return { ok: true, borradores };
}

/** Guarda la foto ACTUAL de las rutas del día (chofer + orden de cada parada no entregada) como un borrador con nombre. */
export async function guardarBorrador(day: string, name: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const a = await gate();
  if (!a.ok) return a;
  const limpio = (name ?? "").trim();
  if (!limpio) return { ok: false, message: "El borrador necesita un nombre." };
  if (limpio.length > 60) return { ok: false, message: "El nombre es muy largo (máx. 60)." };
  const { data: ords, error: eRead } = await a.supabase.from("deliveries")
    .select("id, assigned_driver, route_seq").eq("delivery_date", day).not("stage", "in", "(delivered,canceled)");
  if (eRead) return { ok: false, message: eRead.message };
  const payload: PayloadFila[] = (ords ?? []).map((d) => ({
    id: d.id as string, assigned_driver: (d.assigned_driver as string | null) ?? null, route_seq: (d.route_seq as number | null) ?? null,
  }));
  const { data, error } = await a.supabase.from("route_drafts")
    .insert({ day, name: limpio, payload, created_by: a.user.id, created_by_name: a.nombre, updated_by: a.user.id })
    .select("id").single();
  if (error) return { ok: false, message: esSinTabla(error) ? SIN_TABLA : error.message };
  revalidatePath("/routes");
  return { ok: true, id: data.id as string };
}

/** Carga un borrador: escribe su foto (chofer + orden) de vuelta en `deliveries`. Para en la primera que la base rechace. */
export async function cargarBorrador(id: string): Promise<{ ok: true; n: number } | { ok: false; message: string }> {
  const a = await gate();
  if (!a.ok) return a;
  const { data: row, error: eRead } = await a.supabase.from("route_drafts").select("payload").eq("id", id).maybeSingle();
  if (eRead) return { ok: false, message: esSinTabla(eRead) ? SIN_TABLA : eRead.message };
  if (!row) return { ok: false, message: "Ese borrador ya no existe." };
  const payload = (Array.isArray(row.payload) ? row.payload : []) as PayloadFila[];
  let n = 0;
  for (const p of payload) {
    const { error } = await a.supabase.from("deliveries")
      .update({ assigned_driver: p.assigned_driver, route_seq: p.route_seq, route_miles: null, route_duration: null, route_provider: null })
      .eq("id", p.id).select("id");
    // La base (RLS/guard) puede negar una orden que ya avanzó; se para y se dice cuál, sin dejarlo a medias en silencio.
    if (error) return { ok: false, message: `Se cargaron ${n}; la orden ${p.id.slice(0, 8)} no se pudo cambiar: ${error.message}` };
    n++;
  }
  revalidatePath("/routes");
  return { ok: true, n };
}

export async function borrarBorrador(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const a = await gate();
  if (!a.ok) return a;
  const { error } = await a.supabase.from("route_drafts").delete().eq("id", id);
  if (error) return { ok: false, message: esSinTabla(error) ? SIN_TABLA : error.message };
  revalidatePath("/routes");
  return { ok: true };
}
