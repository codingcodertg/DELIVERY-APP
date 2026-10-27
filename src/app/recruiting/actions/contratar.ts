"use server";

import { createClient } from "@/lib/supabase/server";
import { esColumnaQueFalta, telefonoDeFicha } from "@/lib/recruiting/employee-file";
import { falta201, fichaDesdeCandidato, puedeContratar, veSolicitudesDeUsuario, yaPedido } from "@/lib/recruiting/contratar";
import { hoyEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";

/**
 * «Hire» desde el candidato (D-688, migración 201).
 *
 * El cambio de etapa a `hired` lo hace la pantalla con `updateCandidate`, que es el camino que ya guarda el
 * historial de etapas. Esto hace lo que la etapa sola no hacía: el expediente del empleado (crearlo o reusar el
 * que salió de ese candidato) y, si se pide, la solicitud «créale el usuario» para el admin.
 *
 * Sin la 201 sigue funcionando: el expediente se crea sin `candidate_id` (y se reusa uno sin cuenta con el mismo
 * nombre para no duplicar), y la solicitud se omite avisándolo en `sinSolicitudes`.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

async function rolDeHr(supabase: Sb): Promise<{ userId: string; role: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("recruiting_role").eq("id", user.id).single();
  return { userId: user.id, role: (data?.recruiting_role as string) ?? "" };
}

export async function hireCandidate(input: { candidateId: string; requestUser: boolean; note?: string | null }): Promise<
  { ok: true; fileId: string; creado: boolean; solicitado: boolean; sinSolicitudes: boolean; profileId: string | null } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await rolDeHr(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!puedeContratar(yo.role)) return { ok: false, message: "Only an HR manager or admin can hire." };

  const { data: cand, error: eCand } = await supabase.schema("recruiting").from("candidates")
    .select("id, name, phone, role, location").eq("id", input.candidateId).maybeSingle();
  if (eCand) return { ok: false, message: eCand.message };
  if (!cand) return { ok: false, message: "Candidate not found." };
  const ficha = fichaDesdeCandidato(cand, hoyEnBrownsville());
  if (!ficha) return { ok: false, message: "The candidate has no name." };

  const tabla = () => supabase.schema("recruiting").from("employee_files");
  let con201 = true;

  // 1. ¿Ya hay expediente de este candidato?
  let fileId: string | null = null;
  // D-710: `profile_id` para saber si el expediente ya tiene cuenta y no crear otra.
  let profileId: string | null = null;
  const porCandidato = await tabla().select("id, profile_id").eq("candidate_id", cand.id).maybeSingle();
  if (porCandidato.error) {
    if (!falta201(porCandidato.error)) return { ok: false, message: porCandidato.error.message };
    con201 = false;
    const porNombre = await tabla().select("id").eq("full_name", ficha.full_name).is("profile_id", null).limit(1);
    if (!porNombre.error && porNombre.data?.length) fileId = porNombre.data[0].id as string;
  } else if (porCandidato.data) {
    fileId = porCandidato.data.id as string;
    profileId = (porCandidato.data.profile_id as string | null) ?? null;
  }

  // 2. Si no, se crea.
  let creado = false;
  if (!fileId) {
    const sello = { updated_at: new Date().toISOString(), updated_by: yo.userId };
    const base: Record<string, unknown> = {
      full_name: ficha.full_name, profile_id: null, date_hired: ficha.date_hired,
      phone: telefonoDeFicha(ficha.phone), store: ficha.store, ...sello,
    };
    const intentos: Record<string, unknown>[] = [];
    if (con201) intentos.push({ ...base, job_title: ficha.job_title, candidate_id: cand.id }, { ...base, candidate_id: cand.id });
    intentos.push({ ...base, job_title: ficha.job_title }, base);
    let ultimo = "";
    for (const fila of intentos) {
      const r = await tabla().insert(fila).select("id").single();
      if (!r.error) { fileId = r.data.id as string; creado = true; break; }
      ultimo = r.error.message;
      if (!esColumnaQueFalta(r.error) && !falta201(r.error)) return { ok: false, message: r.error.message };
    }
    if (!fileId) return { ok: false, message: ultimo || "Could not create the employee file." };
  }

  // 3. La solicitud al admin. Sin `.select()`: el gerente puede insertar pero no leer (201).
  let solicitado = false;
  let sinSolicitudes = !con201;
  if (input.requestUser && con201) {
    const { error } = await supabase.schema("recruiting").from("user_creation_requests").insert({
      employee_file_id: fileId, candidate_id: cand.id, full_name: ficha.full_name,
      note: (input.note ?? "").trim() || null, requested_by: yo.userId,
    });
    if (!error || yaPedido(error)) solicitado = true;
    else if (falta201(error)) sinSolicitudes = true;
    else return { ok: false, message: error.message };
  }
  return { ok: true, fileId, creado, solicitado, sinSolicitudes, profileId };
}

/**
 * D-710: la cuenta del contratado ya se creó y se enlazó desde «Contratar»: su solicitud pendiente se cierra.
 * Solo el admin de RR. HH. (lo mismo que `markUserCreationDone`). `.select("id")`: cero filas no es éxito, pero
 * aquí tampoco es error (sin la 201, o sin solicitud, no hay nada que cerrar).
 */
export async function closeUserRequestsForFile(fileId: string): Promise<{ ok: boolean; cerradas: number; message?: string }> {
  const supabase = await createClient();
  const yo = await rolDeHr(supabase);
  if (!yo) return { ok: false, cerradas: 0, message: "Not signed in." };
  if (!veSolicitudesDeUsuario(yo.role)) return { ok: false, cerradas: 0, message: "Only an HR admin can close a request." };
  const { data, error } = await supabase.schema("recruiting").from("user_creation_requests")
    .update({ status: "done", done_by: yo.userId, done_at: new Date().toISOString() })
    .eq("employee_file_id", fileId).eq("status", "pending").select("id");
  if (error) return falta201(error) ? { ok: true, cerradas: 0 } : { ok: false, cerradas: 0, message: error.message };
  return { ok: true, cerradas: data?.length ?? 0 };
}

export type UserCreationRequest = {
  id: string; employee_file_id: string | null; candidate_id: string | null; full_name: string; note: string | null;
  status: "pending" | "done"; requested_by: string | null; requested_by_name: string | null; requested_at: string;
};

/** Las pendientes, para el admin de RR. HH. `missing` = la 201 no está aplicada. */
export async function listUserCreationRequests(): Promise<
  { ok: true; rows: UserCreationRequest[]; missing: boolean } | { ok: false; message: string }
> {
  const supabase = await createClient();
  const yo = await rolDeHr(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!veSolicitudesDeUsuario(yo.role)) return { ok: true, rows: [], missing: false };
  const { data, error } = await supabase.schema("recruiting").from("user_creation_requests")
    .select("*").eq("status", "pending").order("requested_at", { ascending: true });
  if (error) return falta201(error) ? { ok: true, rows: [], missing: true } : { ok: false, message: error.message };
  const ids = [...new Set((data ?? []).map((r) => r.requested_by).filter(Boolean))] as string[];
  const nombres = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of ps ?? []) nombres.set(p.id as string, (p.full_name as string) ?? "");
  }
  const rows = (data ?? []).map((r) => ({ ...r, requested_by_name: r.requested_by ? nombres.get(r.requested_by) ?? null : null })) as UserCreationRequest[];
  return { ok: true, rows, missing: false };
}

/** El admin la marca hecha. `.select("id")` para no tomar cero filas por éxito. */
export async function markUserCreationDone(id: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const yo = await rolDeHr(supabase);
  if (!yo) return { ok: false, message: "Not signed in." };
  if (!veSolicitudesDeUsuario(yo.role)) return { ok: false, message: "Only an HR admin can close a request." };
  const { data, error } = await supabase.schema("recruiting").from("user_creation_requests")
    .update({ status: "done", done_by: yo.userId, done_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { ok: false, message: error.message };
  if (!data?.length) return { ok: false, message: "Request not found." };
  return { ok: true };
}
