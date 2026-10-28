"use server";

import { createClient } from "@/lib/supabase/server";
import { parcheAsignar, parcheLiberar, valorDeActivo, type Activo, type EstadoDeActivo, type TipoDeActivo, type TipoDeTelefono } from "@/lib/recruiting/activos";
import { anotaEnHistorial } from "@/lib/recruiting/historial-escribe";
import { cambiosDeActivo, detalleDeCambios, motivoValido, textoDeActivoParaHistorial } from "@/lib/recruiting/historial";

/** D-NEXT: liberar, respaldar y borrar son deliberados: sin un motivo escrito no se hacen. */
const SIN_MOTIVO = "A reason is required.";
const CAMPOS_QUE_SE_EDITAN = ["value", "ext", "phone_type", "status", "plan", "cost_year", "note"] as const;

/**
 * Los activos de la empresa (D-730, migración 211): se leen y escriben con la sesión de quien mira; la política de la
 * 211 (admin y gerente de RR. HH.) decide. Como el expediente, no van por el proveedor de datos: se piden al abrir.
 */
const PUEDE = ["admin", "manager"];

async function quien(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ userId: string; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  return { userId: user.id, role: (data?.recruiting_role as string) ?? "" };
}

/** ¿La 211 no está? PGRST205 / 42P01. */
export async function faltaLa211(error: { code?: string | null } | null | undefined): Promise<boolean> {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function fila(f: Record<string, unknown>, nombres: Map<string, string>): Activo {
  const txt = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(f.id), kind: f.kind as TipoDeActivo, value: String(f.value), ext: txt(f.ext), phone_type: (txt(f.phone_type) as TipoDeTelefono | null),
    status: f.status as EstadoDeActivo, employee_id: txt(f.employee_id), employee_name: f.employee_id ? (nombres.get(String(f.employee_id)) ?? null) : null,
    last_employee_id: txt(f.last_employee_id), last_employee_name: f.last_employee_id ? (nombres.get(String(f.last_employee_id)) ?? null) : null,
    plan: txt(f.plan), cost_year: typeof f.cost_year === "number" ? f.cost_year : f.cost_year != null ? Number(f.cost_year) : null,
    note: txt(f.note), updated_at: txt(f.updated_at),
  };
}

export async function listAssets(): Promise<{ ok: true; rows: Activo[]; personas: { id: string; full_name: string; date_left: string | null }[] } | { ok: false; message: string; sinTabla: boolean }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Company assets are for HR admins and managers.", sinTabla: false };
  const [{ data, error }, { data: files }] = await Promise.all([
    supabase.schema("recruiting").from("company_assets").select("*").order("kind").order("value"),
    supabase.schema("recruiting").from("employee_files").select("id, full_name, profile_id, date_left"),
  ]);
  if (error) return { ok: false, message: error.message, sinTabla: await faltaLa211(error) };
  const perfiles = new Map<string, string>();
  const ids = (files ?? []).map((f) => f.profile_id as string | null).filter((x): x is string => !!x);
  if (ids.length) {
    const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of ps ?? []) perfiles.set(p.id as string, ((p.full_name as string) ?? "").trim());
  }
  const personas = (files ?? []).map((f) => ({
    id: f.id as string,
    full_name: (f.profile_id ? perfiles.get(f.profile_id as string) : null) || ((f.full_name as string) ?? "").trim() || "—",
    date_left: (f.date_left as string | null) ?? null,
  })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const nombres = new Map(personas.map((p) => [p.id, p.full_name]));
  return { ok: true, rows: ((data ?? []) as Record<string, unknown>[]).map((f) => fila(f, nombres)), personas };
}

export async function saveAsset(input: {
  id?: string; kind: TipoDeActivo; value: string; ext?: string | null; phone_type?: TipoDeTelefono | null;
  status?: EstadoDeActivo; plan?: string | null; cost_year?: number | null; note?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Company assets are for HR admins and managers." };
  const value = valorDeActivo(input.kind, input.value);
  if (!value) return { ok: false, message: "The email or number can't be empty." };
  if (input.kind === "email" && !value.includes("@")) return { ok: false, message: "That is not an email." };
  const ext = (input.ext ?? "").replace(/\D/g, "") || null;
  if (ext && !/^[0-9]{2,6}$/.test(ext)) return { ok: false, message: "An extension is 2 to 6 digits." };
  const status = input.status && input.status !== "assigned" ? input.status : undefined;
  const limpio: Record<string, unknown> = {
    kind: input.kind, value, ext: input.kind === "phone" ? ext : null, phone_type: input.kind === "phone" ? (input.phone_type ?? "app") : null,
    plan: (input.plan ?? "").trim() || null, cost_year: input.cost_year ?? null, note: (input.note ?? "").trim() || null,
    updated_at: new Date().toISOString(), updated_by: yo.userId,
  };
  const tabla = supabase.schema("recruiting").from("company_assets");
  if (input.id) {
    // El estado solo cambia aquí entre los que no son «asignado»: asignar y liberar tienen su acción.
    const { data: actual } = await tabla.select("*").eq("id", input.id).maybeSingle();
    if (status && actual?.status !== "assigned") limpio.status = status;
    const { error } = await tabla.update(limpio).eq("id", input.id);
    if (error) return { ok: false, message: error.code === "23505" ? "That email or number is already in the list." : error.message };
    const cambios = cambiosDeActivo((actual ?? {}) as Record<string, unknown>, limpio, CAMPOS_QUE_SE_EDITAN);
    if (Object.keys(cambios).length) {
      await anotaEnHistorial(supabase, yo.userId, {
        kind: "status" in cambios && Object.keys(cambios).length === 1 ? "asset_status_changed" : "asset_edited",
        assetId: input.id, employeeId: (actual?.employee_id as string | null) ?? null,
        assetText: textoDeActivoParaHistorial({ kind: input.kind, value, ext: input.kind === "phone" ? ext : null }),
        detail: detalleDeCambios(cambios), data: cambios,
      });
    }
    return { ok: true, id: input.id };
  }
  const { data, error } = await tabla.insert({ ...limpio, status: status ?? "available" }).select("id").single();
  if (error) return { ok: false, message: error.code === "23505" ? "That email or number is already in the list." : error.message };
  await anotaEnHistorial(supabase, yo.userId, {
    kind: "asset_created", assetId: data.id as string,
    assetText: textoDeActivoParaHistorial({ kind: input.kind, value, ext: input.kind === "phone" ? ext : null }),
    detail: `status: ${status ?? "available"}`, data: { status: status ?? "available", plan: limpio.plan, cost_year: limpio.cost_year },
  });
  return { ok: true, id: data.id as string };
}

export async function deleteAsset(id: string, motivo?: string | null): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Company assets are for HR admins and managers." };
  if (!motivoValido(motivo)) return { ok: false, message: SIN_MOTIVO };
  const { data: a } = await supabase.schema("recruiting").from("company_assets").select("id, kind, value, ext, status, employee_id").eq("id", id).maybeSingle();
  const { data, error } = await supabase.schema("recruiting").from("company_assets").delete().eq("id", id).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Nothing was deleted." };
  // El activo ya no existe: la fila guarda su texto y no su id (el on delete set null lo dejaría vacío igual).
  await anotaEnHistorial(supabase, yo.userId, {
    kind: "asset_deleted", employeeId: (a?.employee_id as string | null) ?? null,
    assetText: a ? textoDeActivoParaHistorial({ kind: a.kind as TipoDeActivo, value: String(a.value), ext: a.ext as string | null }) : null,
    reason: motivo, detail: a ? `was: ${a.status}` : null, data: { status: a?.status ?? null },
  });
  return { ok: true };
}

/** Asigna un activo DISPONIBLE a un expediente. Solo uno de cada tipo por persona. */
export async function assignAsset(assetId: string, employeeId: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Company assets are for HR admins and managers." };
  const tabla = () => supabase.schema("recruiting").from("company_assets");
  const { data: a, error: e1 } = await tabla().select("id, kind, status, value, ext").eq("id", assetId).maybeSingle();
  if (e1) return { ok: false, message: e1.message };
  if (!a) return { ok: false, message: "No such asset." };
  const parche = parcheAsignar({ status: a.status as EstadoDeActivo }, employeeId);
  if (!parche) return { ok: false, message: "Only an available asset can be assigned." };
  const { data: ya } = await tabla().select("id").eq("employee_id", employeeId).eq("kind", a.kind).eq("status", "assigned").limit(1);
  if (ya?.length) return { ok: false, message: a.kind === "email" ? "This person already has an email assigned. Release it first." : "This person already has a phone number assigned. Release it first." };
  const { data, error } = await tabla().update({ ...parche, updated_at: new Date().toISOString(), updated_by: yo.userId }).eq("id", assetId).eq("status", "available").select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "That asset is no longer available." };
  await anotaEnHistorial(supabase, yo.userId, {
    kind: "asset_assigned", employeeId, assetId,
    assetText: textoDeActivoParaHistorial({ kind: a.kind as TipoDeActivo, value: String(a.value), ext: a.ext as string | null }),
  });
  return { ok: true };
}

/** Libera un activo asignado: el correo a «pendiente de respaldo», el número a «disponible» (o el estado que se pida).
 *  D-NEXT: pide motivo, y queda en el historial como «Liberado» o, si era un respaldo pendiente que pasa a disponible,
 *  «Respaldado». */
export async function releaseAsset(assetId: string, estado?: EstadoDeActivo, motivo?: string | null): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await quien(supabase);
  if (!yo || !PUEDE.includes(yo.role)) return { ok: false, message: "Company assets are for HR admins and managers." };
  if (!motivoValido(motivo)) return { ok: false, message: SIN_MOTIVO };
  const tabla = () => supabase.schema("recruiting").from("company_assets");
  const { data: a, error: e1 } = await tabla().select("id, kind, employee_id, status, last_employee_id, value, ext").eq("id", assetId).maybeSingle();
  if (e1) return { ok: false, message: e1.message };
  if (!a) return { ok: false, message: "No such asset." };
  const parche = a.status === "assigned"
    ? parcheLiberar({ kind: a.kind as TipoDeActivo, employee_id: a.employee_id as string | null }, estado)
    : { status: estado && estado !== "assigned" ? estado : (a.status as EstadoDeActivo), employee_id: null, last_employee_id: a.last_employee_id as string | null };
  const { data, error } = await tabla().update({ ...parche, updated_at: new Date().toISOString(), updated_by: yo.userId }).eq("id", assetId).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Nothing changed." };
  await anotaEnHistorial(supabase, yo.userId, {
    kind: a.status === "pending_backup" && parche.status === "available" ? "asset_backed_up" : "asset_released",
    employeeId: (a.employee_id as string | null) ?? (a.last_employee_id as string | null) ?? null, assetId,
    assetText: textoDeActivoParaHistorial({ kind: a.kind as TipoDeActivo, value: String(a.value), ext: a.ext as string | null }),
    reason: motivo, detail: `${a.status} → ${parche.status}`, data: { de: a.status, a: parche.status },
  });
  return { ok: true };
}
