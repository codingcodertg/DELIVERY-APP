"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { canManageEmployee, isPeriodLocked, periodStartOf, type Me } from "@/lib/clockin/mgrScope";
import { maybeNotifyStoreReady } from "@/lib/clockin/notify";
import { isOverlapError, OVERLAP_MESSAGE } from "@/lib/clockin/overlap";
import { attachLunch, type PayEntry, type LunchRow } from "@/lib/clockin/payroll";
import { shiftMinutes } from "@/lib/clockin/schedule";

export type ReportResult = { ok: true } | { ok: false; message: string };

async function mgrCtx() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role, company_id, store_id").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) {
    return { ok: false as const, message: "Managers only." };
  }
  const meScope: Me = { role: me.role as string, company_id: me.company_id as string, store_id: (me.store_id as string) ?? null };
  return { ok: true as const, supabase, user, companyId: me.company_id as string, role: me.role as string, me: meScope };
}

const DENY_SCOPE = "That employee isn't in your store." as const;
const DENY_LOCKED = "This pay period is signed off and locked. Ask the owner to reopen it." as const;

type Supa = Awaited<ReturnType<typeof createClient>>;
async function audit(
  supabase: Supa,
  companyId: string,
  actorId: string,
  recordId: string,
  action: "insert" | "update" | "delete",
  oldValue: unknown,
  newValue: unknown,
) {
  await supabase.from("audit_log").insert({
    company_id: companyId,
    actor_id: actorId,
    table_name: "time_entries",
    record_id: recordId,
    action,
    old_value: oldValue,
    new_value: newValue,
  });
}

/** Manager corrects an existing punch. Records the before/after in audit_log. */
export async function editEntry(input: {
  id: string;
  clockIn: string; // datetime-local (Central)
  clockOut: string | null;
  lunch: number;
  note?: string;
}): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  const { data: old } = await ctx.supabase
    .from("time_entries")
    .select("id, clock_in_at, clock_out_at, lunch_minutes, employee_id")
    .eq("id", input.id)
    .single();
  if (!old) return { ok: false, message: "Entry not found." };
  if (!(await canManageEmployee(ctx.supabase, ctx.me, old.employee_id))) return { ok: false, message: DENY_SCOPE };
  if (await isPeriodLocked(ctx.supabase, ctx.companyId, periodStartOf(old.clock_in_at))) return { ok: false, message: DENY_LOCKED };

  const clockInAt = centralWallToUtc(input.clockIn);
  const clockOutAt = input.clockOut ? centralWallToUtc(input.clockOut) : null;
  if (clockOutAt && new Date(clockOutAt) <= new Date(clockInAt)) {
    return { ok: false, message: "Clock-out must be after clock-in." };
  }
  const patch = {
    clock_in_at: clockInAt,
    clock_out_at: clockOutAt,
    lunch_minutes: input.lunch,
    status: clockOutAt ? ("edited" as const) : ("open" as const),
    edited_at: new Date().toISOString(),
    edited_by: ctx.user.id,
    edit_note: input.note ?? null,
  };
  const { error } = await ctx.supabase.from("time_entries").update(patch).eq("id", input.id);
  // 085: mover un fichaje encima de otro ya registrado lo rechaza la base. Es por donde
  // entró el caso de Patricia —19 minutos manuales dentro de su jornada real— así que
  // conviene que diga qué pasa y no un mensaje de Postgres sobre una restricción.
  if (error) return { ok: false, message: isOverlapError(error) ? OVERLAP_MESSAGE : error.message };
  await audit(
    ctx.supabase,
    ctx.companyId,
    ctx.user.id,
    input.id,
    "update",
    { clock_in_at: old.clock_in_at, clock_out_at: old.clock_out_at, lunch_minutes: old.lunch_minutes },
    { clock_in_at: clockInAt, clock_out_at: clockOutAt, lunch_minutes: input.lunch, note: input.note ?? null },
  );
  return { ok: true };
}

/** Manager adds a missing punch (a whole shift) for an employee. */
export async function addEntry(input: {
  employeeId: string;
  clockIn: string;
  clockOut: string;
  lunch: number;
  note?: string;
}): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  if (!(await canManageEmployee(ctx.supabase, ctx.me, input.employeeId))) return { ok: false, message: DENY_SCOPE };
  const clockInAt = centralWallToUtc(input.clockIn);
  const clockOutAt = centralWallToUtc(input.clockOut);
  if (new Date(clockOutAt) <= new Date(clockInAt)) {
    return { ok: false, message: "Clock-out must be after clock-in." };
  }
  if (await isPeriodLocked(ctx.supabase, ctx.companyId, periodStartOf(clockInAt))) return { ok: false, message: DENY_LOCKED };
  const { data: entry, error } = await ctx.supabase
    .from("time_entries")
    .insert({
      company_id: ctx.companyId,
      employee_id: input.employeeId,
      clock_in_at: clockInAt,
      clock_out_at: clockOutAt,
      lunch_minutes: input.lunch,
      status: "closed",
      manual: true,
      edited_at: new Date().toISOString(),
      edited_by: ctx.user.id,
      edit_note: input.note ?? null,
    })
    .select("id")
    .single();
  if (error || !entry) return { ok: false, message: error?.message ?? "Could not add entry." };
  await audit(ctx.supabase, ctx.companyId, ctx.user.id, entry.id, "insert", null, {
    clock_in_at: clockInAt,
    clock_out_at: clockOutAt,
    lunch_minutes: input.lunch,
    manual: true,
    note: input.note ?? null,
  });
  return { ok: true };
}

/** Manager removes an erroneous punch (hard delete; the snapshot lives in audit_log). */
export async function deleteEntry(id: string): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  const { data: old } = await ctx.supabase
    .from("time_entries")
    .select("id, clock_in_at, clock_out_at, lunch_minutes, employee_id")
    .eq("id", id)
    .single();
  if (!old) return { ok: false, message: "Entry not found." };
  if (!(await canManageEmployee(ctx.supabase, ctx.me, old.employee_id))) return { ok: false, message: DENY_SCOPE };
  if (await isPeriodLocked(ctx.supabase, ctx.companyId, periodStartOf(old.clock_in_at))) return { ok: false, message: DENY_LOCKED };
  const { error } = await ctx.supabase.from("time_entries").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  await audit(ctx.supabase, ctx.companyId, ctx.user.id, id, "delete", old, null);
  return { ok: true };
}

/** Manager approves one employee's timesheet for the week (Monday period_start). */
export async function approveTimesheet(input: {
  employeeId: string;
  periodStart: string;
  note?: string;
}): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  if (!(await canManageEmployee(ctx.supabase, ctx.me, input.employeeId))) return { ok: false, message: DENY_SCOPE };
  if (await isPeriodLocked(ctx.supabase, ctx.companyId, input.periodStart)) return { ok: false, message: DENY_LOCKED };
  const { error } = await ctx.supabase.from("timesheet_approvals").upsert(
    {
      company_id: ctx.companyId,
      employee_id: input.employeeId,
      period_start: input.periodStart,
      approved_by: ctx.user.id,
      approved_at: new Date().toISOString(),
      note: input.note ?? null,
    },
    { onConflict: "employee_id,period_start" },
  );
  if (error) return { ok: false, message: error.message };

  // If this was the last pending timesheet for the store, tell the owner it's ready.
  try {
    const { data: emp } = await ctx.supabase.from("profiles").select("store_id").eq("id", input.employeeId).maybeSingle();
    await maybeNotifyStoreReady(ctx.companyId, (emp?.store_id as string) ?? null, input.periodStart);
  } catch {
    /* notification is best-effort — never block the approval */
  }
  return { ok: true };
}

export async function unapproveTimesheet(input: { employeeId: string; periodStart: string }): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  if (!(await canManageEmployee(ctx.supabase, ctx.me, input.employeeId))) return { ok: false, message: DENY_SCOPE };
  // Can't un-approve a signed-off period — that's the whole point of the lock.
  if (await isPeriodLocked(ctx.supabase, ctx.companyId, input.periodStart)) return { ok: false, message: DENY_LOCKED };
  const { error } = await ctx.supabase
    .from("timesheet_approvals")
    .delete()
    .eq("employee_id", input.employeeId)
    .eq("period_start", input.periodStart);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** Owner signs off the whole period after reviewing totals (2nd protection layer). */
export async function ownerSignoff(input: { periodStart: string }): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "owner") return { ok: false, message: "Only the owner can sign off." };
  const { error } = await ctx.supabase.from("pay_period_signoffs").upsert(
    {
      company_id: ctx.companyId,
      period_start: input.periodStart,
      owner_approved_by: ctx.user.id,
      owner_approved_at: new Date().toISOString(),
    },
    { onConflict: "company_id,period_start" },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function revokeSignoff(input: { periodStart: string }): Promise<ReportResult> {
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  if (ctx.role !== "owner") return { ok: false, message: "Only the owner can undo a sign-off." };
  const { error } = await ctx.supabase
    .from("pay_period_signoffs")
    .delete()
    .eq("company_id", ctx.companyId)
    .eq("period_start", input.periodStart);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * Un periodo de nómina entero, para la pantalla de Payroll de Time Tracker (D-117).
 *
 * La pantalla de fichaje calculaba todo esto dentro del componente de servidor. Al mudarla
 * hacía falta que lo mismo se pudiera pedir desde el cliente, así que la consulta se movió
 * aquí tal cual — mismas tablas, mismo alcance, mismo periodo viernes→jueves.
 *
 * Devuelve los fichajes CRUDOS y no los totales. El cálculo (comida, extras, turnos abiertos)
 * vive en `lib/clockin/payroll.ts`, que es puro y corre igual en el cliente; sumarlo aquí
 * habría creado una segunda aritmética de nómina, y dos nóminas que no cuadran son peor que
 * una sola pantalla fea.
 */
export async function getPayrollPeriod(periodStart: string): Promise<
  | {
      ok: true;
      signedOff: boolean;
      isOwner: boolean;
      approved: string[];
      people: { id: string; name: string; store: string | null; scheduledMin: number; remote: boolean }[];
      stores: { key: string; name: string }[];
      entries: PayEntry[];
    }
  | { ok: false; message: string }
> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return { ok: false, message: "Bad period." };
  const ctx = await mgrCtx();
  if (!ctx.ok) return ctx;
  const { supabase, me } = ctx;

  const startUtc = centralWallToUtc(`${periodStart}T00:00`);
  const endUtc = new Date(new Date(startUtc).getTime() + 7 * 86400000).toISOString();
  const periodEnd = new Date(new Date(`${periodStart}T12:00:00Z`).getTime() + 6 * 86400000)
    .toISOString().slice(0, 10);

  // Mismo alcance que la pantalla vieja: un gerente con tienda ve su cuadrilla, y el dueño
  // no aparece en la nómina de un gerente.
  const peopleQuery = supabase
    .from("profiles")
    .select("id, full_name, store_id")
    .eq("company_id", me.company_id)
    .eq("active", true);
  const scopeStore = me.role === "manager" && me.store_id ? (me.store_id as string) : null;
  if (scopeStore) peopleQuery.eq("store_id", scopeStore);
  if (me.role !== "owner") peopleQuery.neq("role", "owner");
  const { data: people } = await peopleQuery;
  const allowedIds = (people ?? []).map((p) => p.id as string);
  const noneMatch = ["00000000-0000-0000-0000-000000000000"];
  const inIds = allowedIds.length ? allowedIds : noneMatch;

  // El tipo de trabajador vive en el OTRO esquema (timetracker.employee_settings): fichaje no
  // tiene ese concepto. Se pide aquí para poder marcar en el parte a quien cobra por lo
  // cronometrado, que en una nómina de asistencia es justo lo que hay que mirar dos veces.
  const [{ data: entryRows }, { data: lunchRows }, { data: approvals }, { data: signoff }, { data: siteRows }, { data: schedRows }, { data: tipos }] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select("id, employee_id, clock_in_at, clock_out_at, lunch_minutes, status, manual, edit_note")
        .in("employee_id", inIds)
        .gte("clock_in_at", startUtc)
        .lt("clock_in_at", endUtc)
        .order("clock_in_at", { ascending: true }),
      supabase
        .from("exceptions")
        .select("time_entry_id, left_at, returned_at")
        .eq("reason", "lunch")
        .in("employee_id", inIds)
        .gte("left_at", startUtc)
        .lt("left_at", endUtc),
      supabase.from("timesheet_approvals").select("employee_id").eq("period_start", periodStart),
      supabase.from("pay_period_signoffs").select("owner_approved_at").eq("period_start", periodStart).maybeSingle(),
      supabase.from("job_sites").select("id, name").eq("company_id", me.company_id),
      supabase
        .from("scheduled_shifts")
        .select("employee_id, start_time, end_time, lunch_minutes")
        .in("employee_id", inIds)
        .gte("shift_date", periodStart)
        .lte("shift_date", periodEnd),
      supabase.schema("timetracker").from("employee_settings").select("id, worker_type"),
    ]);

  const esRemoto = new Map((tipos ?? []).map((t) => [t.id as string, (t.worker_type as string) !== "inhouse"]));

  const schedMin = new Map<string, number>();
  for (const s of schedRows ?? []) {
    const mins = shiftMinutes(s.start_time as string, s.end_time as string, (s.lunch_minutes as number) ?? 0);
    schedMin.set(s.employee_id as string, (schedMin.get(s.employee_id as string) ?? 0) + mins);
  }

  return {
    ok: true,
    signedOff: !!signoff,
    isOwner: me.role === "owner",
    approved: (approvals ?? []).map((a) => a.employee_id as string),
    people: (people ?? []).map((p) => ({
      id: p.id as string,
      name: (p.full_name as string) ?? "—",
      store: (p.store_id as string) ?? null,
      scheduledMin: schedMin.get(p.id as string) ?? 0,
      remote: esRemoto.get(p.id as string) ?? false,
    })),
    stores: (siteRows ?? []).map((s) => ({ key: s.id as string, name: s.name as string })),
    entries: attachLunch((entryRows ?? []) as PayEntry[], (lunchRows ?? []) as LunchRow[]),
  };
}
