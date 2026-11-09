"use server";

import { createClient } from "@/lib/supabase/server";
import { revisaQuitForm, type DatosQuitForm, type MotivoRenuncia } from "@/lib/recruiting/quit-form";

/**
 * Formulario de renuncia (D-935, migración 276): el formato que firma quien renuncia, con el motivo, para protegerse de
 * reclamos de desempleo. Admin y gerente de RR. HH. (la política de la 276). La foto del formato firmado se sube con
 * `uploadDocFile` (hr.ts, cubo `hr-docs`, kind «quit_form») y aquí solo se guarda su ruta; se ve con `signDocUrl`.
 */
const PUEDE = ["admin", "manager"];

async function quien(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ userId: string; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  return { userId: user.id, role: (data?.recruiting_role as string) ?? "" };
}

function faltaLa276(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export interface QuitForm {
  id: string;
  employee_file_id: string;
  reason: MotivoRenuncia;
  note: string | null;
  signed_name: string;
  signed_at: string | null;
  photo_path: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Los formularios de renuncia de un expediente, del más reciente al más viejo. */
export async function getQuitForms(employeeId: string): Promise<
  { ok: true; rows: QuitForm[] } | { ok: false; message: string; sinTabla: boolean }
> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Quit forms are for HR admins and managers.", sinTabla: false };
  const { data, error } = await supabase.schema("recruiting").from("quit_forms")
    .select("id, employee_file_id, reason, note, signed_name, signed_at, photo_path, created_by_name, created_at")
    .eq("employee_file_id", employeeId).order("created_at", { ascending: false });
  if (error) return { ok: false, message: error.message, sinTabla: faltaLa276(error) };
  return { ok: true, rows: (data ?? []) as QuitForm[] };
}

/** Guarda un formulario de renuncia nuevo. La validación pura vive en `@/lib/recruiting/quit-form`. */
export async function saveQuitForm(
  employeeId: string, datos: DatosQuitForm,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Quit forms are for HR admins and managers." };
  const r = revisaQuitForm(datos);
  if (!r.ok) {
    const msg = r.motivo === "sin_firma" ? "Write who signs the form."
      : r.motivo === "motivo_desconocido" ? "Unknown reason."
      : "Choose a reason (and a note if «Other»).";
    return { ok: false, message: msg };
  }
  const { data: actor } = await supabase.from("profiles").select("full_name").eq("id", yo.userId).maybeSingle();
  const ahora = new Date().toISOString();
  const { data, error } = await supabase.schema("recruiting").from("quit_forms").insert({
    employee_file_id: employeeId,
    reason: r.motivo,
    note: r.nota,
    signed_name: r.firmaNombre,
    signed_at: r.firmaFecha,
    photo_path: r.fotoPath,
    created_by: yo.userId,
    created_by_name: actor?.full_name ?? null,
    created_at: ahora,
    updated_at: ahora,
    updated_by: yo.userId,
  }).select("id").single();
  if (error) return { ok: false, message: faltaLa276(error) ? "Migration 276 is not applied yet." : error.message };
  return { ok: true, id: data.id as string };
}
