"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { EstadoDeDispositivo, TipoDeDispositivo } from "@/lib/security/reglas";

/**
 * Lo que el admin hace en Security (D-811). Con SU sesión, no con la llave de servicio: la RLS de la 229 es la que
 * decide, y aquí solo se comprueba el rol para contestar con un mensaje en vez de con cero filas.
 */
async function admin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (p?.role !== "admin") return { ok: false as const, message: "Only an admin can change security." };
  return { ok: true as const, supabase, user };
}

type R = { ok: true } | { ok: false; message: string };

/** Aprobar (con nombre), revocar o volver a pendiente. Siempre queda quién y cuándo. */
export async function cambiaEstadoDeDispositivo(id: string, estado: Exclude<EstadoDeDispositivo, "none">, label?: string): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  const ahora = new Date().toISOString();
  const parche: Record<string, unknown> = { status: estado };
  if (estado === "approved") Object.assign(parche, { approved_by: a.user.id, approved_at: ahora, revoked_by: null, revoked_at: null });
  if (estado === "revoked") Object.assign(parche, { revoked_by: a.user.id, revoked_at: ahora });
  if (label !== undefined) parche.label = label.trim() || null;
  const { error, data } = await a.supabase.from("security_devices").update(parche).eq("id", id).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "The database refused the change." };
  revalidatePath("/security");
  return { ok: true };
}

/** El nombre y el tipo: «Sales McAllen 1», computadora o teléfono. */
export async function renombraDispositivo(id: string, label: string, kind: TipoDeDispositivo, notes?: string): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  const { error, data } = await a.supabase.from("security_devices")
    .update({ label: label.trim() || null, kind, ...(notes !== undefined ? { notes: notes.trim() || null } : {}) }).eq("id", id).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "The database refused the change." };
  revalidatePath("/security");
  return { ok: true };
}

/** Borrar un dispositivo que nunca se aprobó (ruido): sus filas de uso se van con él (on delete cascade). */
export async function borraDispositivo(id: string): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  const { error } = await a.supabase.from("security_devices").delete().eq("id", id).neq("status", "approved");
  if (error) return { ok: false, message: error.message };
  revalidatePath("/security");
  return { ok: true };
}

/** El interruptor. Encender es lo que activa la regla para todo el mundo; se deja quién y cuándo. */
/** D-816: el interruptor de la web bloqueada (231). */
export async function cambiaPoliticaWeb(web_blocked: boolean): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  const { error, data } = await a.supabase.from("security_policy")
    .update({ web_blocked, changed_by: a.user.id, changed_at: new Date().toISOString() }).eq("id", 1).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "The database refused the change (is migration 231 applied?)." };
  revalidatePath("/security");
  return { ok: true };
}

export async function cambiaPolitica(enforced: boolean): Promise<R> {
  const a = await admin();
  if (!a.ok) return a;
  const { error, data } = await a.supabase.from("security_policy")
    .update({ enforced, changed_by: a.user.id, changed_at: new Date().toISOString() }).eq("id", 1).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "The database refused the change (is migration 229 applied?)." };
  revalidatePath("/security");
  return { ok: true };
}
