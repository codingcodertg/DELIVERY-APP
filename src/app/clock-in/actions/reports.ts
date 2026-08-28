"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { canManageEmployee, isPeriodLocked, periodStartOf, type Me } from "@/lib/clockin/mgrScope";
import { maybeNotifyStoreReady } from "@/lib/clockin/notify";
import { isOverlapError, OVERLAP_MESSAGE } from "@/lib/clockin/overlap";

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
