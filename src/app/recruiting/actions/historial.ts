"use server";

import { createClient } from "@/lib/supabase/server";
import type { EntradaDeHistorial, TipoDeHistorial } from "@/lib/recruiting/historial";

/**
 * Leer el historial de RR. HH. (D-734, migración 212): de un empleado, de un activo, o todo. Admin y gerente de RR. HH.,
 * como los activos y el expediente; la política de la 212 lo repite en la base.
 */
const PUEDE = ["admin", "manager"];

export async function listHistory(filtro: { employeeId?: string; assetId?: string; limit?: number } = {}): Promise<
  { ok: true; rows: EntradaDeHistorial[] } | { ok: false; message: string; sinTabla: boolean }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in.", sinTabla: false };
  const { data: perfil } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  if (!PUEDE.includes((perfil?.recruiting_role as string) ?? "")) return { ok: false, message: "The HR history is for HR admins and managers.", sinTabla: false };

  let q = supabase.schema("recruiting").from("hr_history").select("*").order("at", { ascending: false }).limit(filtro.limit ?? 500);
  if (filtro.employeeId) q = q.eq("employee_id", filtro.employeeId);
  if (filtro.assetId) q = q.eq("asset_id", filtro.assetId);
  const { data, error } = await q;
  if (error) return { ok: false, message: error.message, sinTabla: error.code === "PGRST205" || error.code === "42P01" };
  const txt = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    ok: true,
    rows: (data ?? []).map((f) => ({
      id: String(f.id), at: String(f.at), kind: f.kind as TipoDeHistorial,
      employee_id: txt(f.employee_id), employee_name: txt(f.employee_name),
      asset_id: txt(f.asset_id), asset_text: txt(f.asset_text),
      actor_id: txt(f.actor_id), actor_name: txt(f.actor_name),
      reason: txt(f.reason), detail: txt(f.detail),
      data: (f.data && typeof f.data === "object" ? f.data : {}) as Record<string, unknown>,
    })),
  };
}
