"use server";

import { createClient } from "@/lib/supabase/server";
import { expedienteQueSobra } from "@/lib/recruiting/usuarios-rrhh";

/**
 * Enlaza el expediente de un empleado con la cuenta que se le acaba de crear (D-NEXT).
 *
 * La cuenta la crea `/api/invite`, igual que en el hub. Al nacer, el trigger de la 106 le hace un
 * expediente vacío propio; aquí se borra ese vacío (si no tiene papeles) y se apunta el del
 * empleado a la cuenta. Solo el admin de RR. HH.: lo mismo exige el trigger de la 106.
 */
export async function linkEmployeeToAccount(
  fileId: string,
  profileId: string,
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: yo, error: errYo } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).maybeSingle();
  if (errYo) return { ok: false, message: errYo.message };
  if (yo?.recruiting_role !== "admin") return { ok: false, message: "Only an HR admin can link an employee file to an account." };

  const rec = supabase.schema("recruiting");
  const { data: file, error: errFile } = await rec.from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (errFile) return { ok: false, message: errFile.message };
  if (!file) return { ok: false, message: "Employee file not found." };
  if (file.profile_id === profileId) return { ok: true };
  if (file.profile_id) return { ok: false, message: "This employee already has an account." };

  const { data: delPerfil, error: errDel } = await rec.from("employee_files").select("id").eq("profile_id", profileId);
  if (errDel) return { ok: false, message: errDel.message };
  const conDocs: { id: string; docs: number }[] = [];
  for (const f of delPerfil ?? []) {
    const { count, error } = await rec.from("employee_docs").select("id", { count: "exact", head: true }).eq("employee_id", f.id);
    if (error) return { ok: false, message: error.message };
    conDocs.push({ id: f.id as string, docs: count ?? 0 });
  }
  const d = expedienteQueSobra(fileId, profileId, conDocs);
  if (!d.ok) return d;
  if (d.borrar) {
    // Con .select("id"): un DELETE que la RLS deja en cero filas vuelve sin error.
    const { data: borrados, error } = await rec.from("employee_files").delete().eq("id", d.borrar).select("id");
    if (error) return { ok: false, message: error.message };
    if (!borrados?.length) return { ok: false, message: "Could not remove the empty file created with the account." };
  }
  const { data: hechos, error: errUp } = await rec.from("employee_files")
    .update({ profile_id: profileId }).eq("id", fileId).select("id");
  if (errUp) return { ok: false, message: errUp.message };
  if (!hechos?.length) return { ok: false, message: "The employee file was not updated." };
  return { ok: true };
}
