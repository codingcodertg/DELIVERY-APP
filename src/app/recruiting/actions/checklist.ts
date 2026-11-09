"use server";

import { createClient } from "@/lib/supabase/server";
import {
  combinaChecklist, esFaseValida, esItemValido, normalizaEstadoItem,
  type EstadoItem, type FaseChecklist, type ItemDeChecklist,
} from "@/lib/recruiting/checklist";

/**
 * Checklist de alta y baja del empleado (D-934, migración 275): se lee y escribe con la sesión de quien mira; la política
 * de la 275 (admin y gerente de RR. HH.) decide. Como el expediente y los activos, no va por el proveedor de datos: se
 * pide al abrir la ficha. La plantilla de pasos vive en `@/lib/recruiting/checklist`.
 */
const PUEDE = ["admin", "manager"];

async function quien(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ userId: string; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  return { userId: user.id, role: (data?.recruiting_role as string) ?? "" };
}

/** ¿La 275 no está? PGRST205 / 42P01. */
function faltaLa275(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/** El checklist de una fase, ya mezclado con la plantilla (siempre los cinco pasos, en orden). */
export async function getChecklist(employeeId: string, phase: FaseChecklist): Promise<
  { ok: true; items: ItemDeChecklist[] } | { ok: false; message: string; sinTabla: boolean }
> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Checklists are for HR admins and managers.", sinTabla: false };
  if (!esFaseValida(phase)) return { ok: false, message: "Unknown checklist phase.", sinTabla: false };
  const { data, error } = await supabase.schema("recruiting").from("employee_checklist")
    .select("item_key, status, done_by_name, done_at, note")
    .eq("employee_file_id", employeeId).eq("phase", phase);
  if (error) return { ok: false, message: error.message, sinTabla: faltaLa275(error) };
  return { ok: true, items: combinaChecklist(phase, data ?? []) };
}

/**
 * Marca un ítem del checklist (pending / done / na). Hace upsert por (expediente, fase, ítem): si nunca se tocó, lo crea;
 * si ya existía, lo actualiza. Guarda quién lo marcó y cuándo (solo cuando pasa a «hecho»; al volver a pendiente se limpia).
 */
export async function setChecklistItem(input: {
  employeeId: string; phase: FaseChecklist; itemKey: string; status: EstadoItem; note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Checklists are for HR admins and managers." };
  if (!esFaseValida(input.phase)) return { ok: false, message: "Unknown checklist phase." };
  if (!esItemValido(input.itemKey)) return { ok: false, message: "Unknown checklist item." };
  const status = normalizaEstadoItem(input.status);

  const { data: actor } = await supabase.from("profiles").select("full_name").eq("id", yo.userId).maybeSingle();
  const marcado = status === "done";
  const fila = {
    employee_file_id: input.employeeId,
    phase: input.phase,
    item_key: input.itemKey,
    status,
    done_by: marcado ? yo.userId : null,
    done_by_name: marcado ? (actor?.full_name ?? null) : null,
    done_at: marcado ? new Date().toISOString() : null,
    note: (input.note ?? "").trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: yo.userId,
  };
  const { error } = await supabase.schema("recruiting").from("employee_checklist")
    .upsert(fila, { onConflict: "employee_file_id,phase,item_key" });
  if (error) return { ok: false, message: faltaLa275(error) ? "Migration 275 is not applied yet." : error.message };
  return { ok: true };
}
