"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { pushToManagers, pushToUser } from "@/lib/clockin/notify";
import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { storeScope } from "@/lib/clockin/scope";

export type TimeOffResult = { ok: true } | { ok: false; message: string };

const TYPES = ["vacation", "sick", "schedule_change", "shift_swap"];

async function authed() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_id, full_name")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false as const, message: "No profile." };
  return { ok: true as const, supabase, user, profile };
}

export async function submitTimeOff(input: {
  type: string;
  startDate: string;
  endDate: string;
  note?: string;
}): Promise<TimeOffResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  if (!TYPES.includes(input.type)) return { ok: false, message: "Invalid type." };
  if (!input.startDate || !input.endDate) return { ok: false, message: "Pick start and end dates." };
  if (input.endDate < input.startDate) return { ok: false, message: "End date is before start date." };

  const { error } = await ctx.supabase.from("time_off_requests").insert({
    company_id: ctx.profile.company_id,
    employee_id: ctx.user.id,
    type: input.type,
    start_date: input.startDate,
    end_date: input.endDate,
    note: input.note ?? null,
  });
  if (error) return { ok: false, message: error.message };
  // Notify the managers that a request came in.
  await pushToManagers(ctx.profile.company_id, "mgr_timeoff_request", { name: ctx.profile.full_name }, "/timetracker/clock-in/time-off");
  return { ok: true };
}

export async function reviewTimeOff(input: {
  id: string;
  decision: "approved" | "denied";
  comment?: string;
}): Promise<TimeOffResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  if (ctx.profile.role !== "manager" && ctx.profile.role !== "owner") {
    return { ok: false, message: "Managers only." };
  }
  const { data: updated, error } = await ctx.supabase
    .from("time_off_requests")
    .update({
      status: input.decision,
      manager_comment: input.comment ?? null,
      reviewed_by: ctx.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("employee_id, company_id")
    .single();
  if (error) return { ok: false, message: error.message };
  // Notify the employee of the decision.
  if (updated) {
    await pushToUser(
      updated.employee_id,
      updated.company_id,
      input.decision === "approved" ? "timeoff_approved" : "timeoff_denied",
    );
  }
  return { ok: true };
}

/**
 * Las dos colas de fichaje que un gerente tiene pendientes, para la bandeja única
 * (`/timetracker/inbox`, fusión de vistas #2).
 *
 * Vive aquí y no en la pantalla porque el alcance por tienda ya está resuelto en
 * `clockinManagerCtx` + `storeScope`: un gerente con tienda ve su cuadrilla y nadie más.
 * Reescribir ese filtro en la bandeja sería la segunda copia de una regla de permisos, y
 * la segunda copia es la que se queda vieja.
 */
export async function getPendingForInbox(): Promise<
  | {
      ok: true;
      timeOff: {
        id: string; employee_id: string; nombre: string; type: string;
        start_date: string; end_date: string; note: string | null;
      }[];
      exceptions: {
        id: string; employee_id: string; nombre: string; type: string;
        reason: string | null; note: string | null; created_at: string; left_at: string | null;
      }[];
    }
  | { ok: false; message: string }
> {
  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return ctx;

  const { ids } = await storeScope(ctx.supabase, ctx.companyId, ctx.role, ctx.storeId);

  let offQ = ctx.supabase
    .from("time_off_requests")
    .select("id, employee_id, type, start_date, end_date, note")
    .eq("status", "pending")
    .order("start_date");
  let excQ = ctx.supabase
    .from("exceptions")
    .select("id, employee_id, type, reason, note, created_at, left_at")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  if (ids) {
    offQ = offQ.in("employee_id", ids);
    excQ = excQ.in("employee_id", ids);
  }

  const [{ data: off }, { data: exc }, { data: people }] = await Promise.all([
    offQ,
    excQ,
    ctx.supabase.from("profiles").select("id, full_name"),
  ]);

  type Named = { employee_id: string };
  const people2 = (people ?? []) as { id: string; full_name: string | null }[];
  const nombre = new Map(people2.map((p) => [p.id, p.full_name ?? "—"]));
  const conNombre = <T extends Named>(rows: T[] | null) =>
    (rows ?? []).map((r) => ({ ...r, nombre: nombre.get(r.employee_id) ?? "—" }));
  return {
    ok: true,
    timeOff: conNombre((off ?? []) as never),
    exceptions: conNombre((exc ?? []) as never),
  };
}
