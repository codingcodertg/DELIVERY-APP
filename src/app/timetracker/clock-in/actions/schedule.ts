"use server";

import type { AnySupabase } from "@/lib/clockin/supabase/types";
import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { payPeriodDates, currentAndNextPeriodDates, patternRowsForDates, presetRowsForDates, cleanPattern, centralDateStr, type WeekPattern, type PresetType } from "@/lib/clockin/schedule";
import { canManageEmployee } from "@/lib/clockin/mgrScope";

export type ShiftResult = { ok: true } | { ok: false; message: string };
const DENY_SCOPE = "That employee isn't in your store." as const;

/**
 * Ensure an employee has the shifts of a weekly `pattern` for the given
 * week-Mondays. Idempotent — only inserts shifts that don't already exist.
 * This is what makes an assigned schedule (A/B/C or custom) "stick" and recur.
 */
export async function materializeForEmployee(
  supabase: AnySupabase,
  opts: {
    companyId: string;
    employeeId: string;
    siteId: string | null;
    createdBy: string;
    dates: string[];
    // Either an A/B/C preset (rotates weekly) OR a fixed custom pattern.
    presetType?: PresetType;
    pattern?: WeekPattern;
  },
): Promise<number> {
  const wanted = opts.presetType
    ? presetRowsForDates(opts.presetType, opts.dates)
    : opts.pattern
      ? patternRowsForDates(opts.pattern, opts.dates)
      : [];
  if (wanted.length === 0) return 0;
  const dates = [...new Set(wanted.map((r) => r.shift_date))];
  const { data: existing } = await supabase
    .from("scheduled_shifts")
    .select("shift_date, start_time")
    .eq("employee_id", opts.employeeId)
    .in("shift_date", dates);
  const have = new Set((existing ?? []).map((s) => `${s.shift_date}|${String(s.start_time).slice(0, 5)}`));
  // Per-date removals: never re-create a shift a manager deleted for that date.
  // Tolerant — if the shift_cancellations table isn't migrated yet, treat as none.
  const { data: cancels } = await supabase
    .from("shift_cancellations")
    .select("shift_date, start_time")
    .eq("employee_id", opts.employeeId)
    .in("shift_date", dates);
  const cancelled = new Set((cancels ?? []).map((c) => `${c.shift_date}|${String(c.start_time).slice(0, 5)}`));
  const rows = wanted
    .filter((r) => !have.has(`${r.shift_date}|${r.start_time}`) && !cancelled.has(`${r.shift_date}|${r.start_time}`))
    .map((r) => ({
      company_id: opts.companyId,
      employee_id: opts.employeeId,
      site_id: opts.siteId,
      created_by: opts.createdBy,
      ...r,
    }));
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("scheduled_shifts").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

/**
 * Wipe an employee's upcoming shifts (today onward) so a NEW schedule can be laid
 * out cleanly — otherwise reassigning A→C (or editing a custom pattern) would
 * leave the old pattern's shifts behind, giving overlapping days + inflated hours.
 * Past/worked days are untouched.
 */
export async function clearFutureShifts(supabase: AnySupabase, employeeId: string) {
  await supabase.from("scheduled_shifts").delete().eq("employee_id", employeeId).gte("shift_date", centralDateStr());
}

const managerCtx = clockinManagerCtx;

export async function createShift(input: {
  employeeId: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
  lunch: number;
  lunchStart?: string | null; // HH:MM — optional lunch break start
  siteId?: string | null;
}): Promise<ShiftResult> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;

  if (!input.employeeId || !input.date || !input.start || !input.end) {
    return { ok: false, message: "Please fill in employee, date, start and end." };
  }
  if (!(await canManageEmployee(ctx.supabase, ctx.me, input.employeeId))) return { ok: false, message: DENY_SCOPE };

  const { error } = await ctx.supabase.from("scheduled_shifts").insert({
    company_id: ctx.companyId,
    employee_id: input.employeeId,
    site_id: input.siteId || null,
    shift_date: input.date,
    start_time: input.start,
    end_time: input.end,
    lunch_minutes: Number.isFinite(input.lunch) ? input.lunch : 30,
    lunch_start_time: input.lunchStart || null,
    created_by: ctx.user.id,
  });
  if (error) return { ok: false, message: error.message };
  // Re-adding a shift un-cancels that date (best-effort).
  await ctx.supabase
    .from("shift_cancellations")
    .delete()
    .eq("employee_id", input.employeeId)
    .eq("shift_date", input.date)
    .eq("start_time", input.start);
  return { ok: true };
}

/** Create the same shift on multiple dates at once (e.g. Mon–Fri in one go). */
export async function createShifts(input: {
  employeeId: string;
  dates: string[]; // YYYY-MM-DD[]
  start: string;
  end: string;
  lunch: number;
  lunchStart?: string | null;
  siteId?: string | null;
}): Promise<ShiftResult & { count?: number }> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  if (!input.employeeId || input.dates.length === 0 || !input.start || !input.end) {
    return { ok: false, message: "Pick an employee, at least one day, and start/end times." };
  }
  if (!(await canManageEmployee(ctx.supabase, ctx.me, input.employeeId))) return { ok: false, message: DENY_SCOPE };
  const rows = input.dates.map((d) => ({
    company_id: ctx.companyId,
    employee_id: input.employeeId,
    site_id: input.siteId || null,
    shift_date: d,
    start_time: input.start,
    end_time: input.end,
    lunch_minutes: Number.isFinite(input.lunch) ? input.lunch : 30,
    lunch_start_time: input.lunchStart || null,
    created_by: ctx.user.id,
  }));
  const { error } = await ctx.supabase.from("scheduled_shifts").insert(rows);
  if (error) return { ok: false, message: error.message };
  // Re-adding shifts un-cancels those dates (best-effort).
  await ctx.supabase
    .from("shift_cancellations")
    .delete()
    .eq("employee_id", input.employeeId)
    .eq("start_time", input.start)
    .in("shift_date", input.dates);
  return { ok: true, count: rows.length };
}

/** Lay out an employee's standard week (A/B/C or custom) for this + next week. */
export async function applySchedule(input: { employeeId: string }): Promise<ShiftResult & { count?: number }> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  if (!(await canManageEmployee(ctx.supabase, ctx.me, input.employeeId))) return { ok: false, message: DENY_SCOPE };
  const { data: emp } = await ctx.supabase
    .from("profiles")
    .select("default_schedule, store_id")
    .eq("id", input.employeeId)
    .maybeSingle();
  const type = emp?.default_schedule as string | null | undefined;

  // A/B/C rotate weekly (handled by presetType); custom is a fixed pattern.
  let presetType: PresetType | undefined;
  let pattern: WeekPattern | undefined;
  if (type === "A" || type === "B" || type === "C") {
    presetType = type;
  } else if (type === "custom") {
    // Tolerant: custom_schedule column may not exist before the migration.
    const { data: cs } = await ctx.supabase.from("profiles").select("custom_schedule").eq("id", input.employeeId).maybeSingle();
    pattern = cleanPattern((cs as { custom_schedule?: unknown } | null)?.custom_schedule);
    if (Object.keys(pattern).length === 0) {
      return { ok: false, message: "No custom pattern set yet — define their days first." };
    }
  } else {
    return { ok: false, message: "This employee has no schedule — assign one or add shifts manually." };
  }

  try {
    // Clear upcoming shifts first so a reassigned pattern replaces (not stacks on) the old one.
    await clearFutureShifts(ctx.supabase, input.employeeId);
    const count = await materializeForEmployee(ctx.supabase, {
      companyId: ctx.companyId as string,
      employeeId: input.employeeId,
      siteId: (emp?.store_id as string) ?? null,
      presetType,
      pattern,
      createdBy: ctx.user.id,
      dates: currentAndNextPeriodDates(),
    });
    if (count === 0) return { ok: false, message: "Already scheduled for this week and next." };
    return { ok: true, count };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not apply the schedule." };
  }
}

/** Define/replace a person's CUSTOM recurring weekly pattern, then lay it out. */
export async function setCustomSchedule(
  employeeId: string,
  pattern: WeekPattern,
): Promise<ShiftResult & { count?: number }> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  if (!(await canManageEmployee(ctx.supabase, ctx.me, employeeId))) return { ok: false, message: DENY_SCOPE };
  const clean = cleanPattern(pattern);
  if (Object.keys(clean).length === 0) return { ok: false, message: "Pick at least one working day with start and end times." };

  const { data: emp } = await ctx.supabase.from("profiles").select("store_id").eq("id", employeeId).maybeSingle();
  const { error: upErr } = await ctx.supabase
    .from("profiles")
    .update({ default_schedule: "custom", custom_schedule: clean })
    .eq("id", employeeId);
  if (upErr) return { ok: false, message: upErr.message };

  try {
    // Replacing a custom pattern: drop upcoming shifts before laying out the new one.
    await clearFutureShifts(ctx.supabase, employeeId);
    const count = await materializeForEmployee(ctx.supabase, {
      companyId: ctx.companyId as string,
      employeeId,
      siteId: (emp?.store_id as string) ?? null,
      pattern: clean,
      createdBy: ctx.user.id,
      dates: currentAndNextPeriodDates(),
    });
    return { ok: true, count };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saved, but could not lay out shifts." };
  }
}

export async function deleteShift(id: string): Promise<ShiftResult> {
  const ctx = await managerCtx();
  if (!ctx.ok) return ctx;
  const { data: sh } = await ctx.supabase
    .from("scheduled_shifts")
    .select("employee_id, shift_date, start_time, company_id")
    .eq("id", id)
    .maybeSingle();
  if (!sh) return { ok: false, message: "Shift not found." };
  if (!(await canManageEmployee(ctx.supabase, ctx.me, sh.employee_id))) return { ok: false, message: DENY_SCOPE };
  const { error } = await ctx.supabase.from("scheduled_shifts").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  // Tombstone this exact date so the auto-scheduler won't re-create it for THIS
  // week (future weeks have different dates and are unaffected). Best-effort.
  await ctx.supabase.from("shift_cancellations").upsert(
    {
      company_id: (sh.company_id as string) ?? ctx.companyId,
      employee_id: sh.employee_id,
      shift_date: sh.shift_date,
      start_time: String(sh.start_time).slice(0, 5),
      created_by: ctx.user.id,
    },
    { onConflict: "employee_id,shift_date,start_time" },
  );
  return { ok: true };
}

/**
 * Una semana de horario, para la vista de Time Tracker (D-121).
 *
 * La pantalla vieja calculaba esto dentro de un componente de servidor y **solo sabía enseñar
 * la semana en curso**. Eso era una limitación de verdad, no cosmética: un horario se planifica
 * hacia delante, y ahí no había forma de programar la semana siguiente. Por eso ahora recibe el
 * viernes del periodo y quien llama decide cuál.
 *
 * `storeScope` como en el resto del módulo: un gerente con tienda ve y programa a su cuadrilla
 * y a nadie más. El dueño no aparece en la lista de un gerente.
 */
export async function getScheduleWeek(periodStart?: string): Promise<
  | {
      ok: true;
      week: string[];
      people: { id: string; full_name: string; default_schedule: string | null; store_id: string | null; custom_schedule: WeekPattern | null }[];
      sites: { id: string; name: string }[];
      shifts: { id: string; employee_id: string; shift_date: string; start_time: string; end_time: string; lunch_minutes: number; site_id: string | null }[];
    }
  | { ok: false; message: string }
> {
  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return ctx;
  const { supabase, me } = ctx;

  const base = periodStart && /^\d{4}-\d{2}-\d{2}$/.test(periodStart)
    ? new Date(`${periodStart}T12:00:00Z`)
    : new Date();
  const week = payPeriodDates(base);

  const scopeStore = me.role === "manager" && me.store_id ? (me.store_id as string) : null;
  let peopleQ = supabase
    .from("profiles")
    .select("id, full_name, default_schedule, store_id, custom_schedule")
    .eq("company_id", me.company_id)
    .eq("active", true);
  if (scopeStore) peopleQ = peopleQ.eq("store_id", scopeStore);
  if (me.role !== "owner") peopleQ = peopleQ.neq("role", "owner");

  let shiftsQ = supabase
    .from("scheduled_shifts")
    .select("id, employee_id, shift_date, start_time, end_time, lunch_minutes, site_id")
    .gte("shift_date", week[0])
    .lte("shift_date", week[6]);
  if (scopeStore) {
    const { data: crew } = await supabase.from("profiles").select("id").eq("company_id", me.company_id).eq("store_id", scopeStore);
    const ids = (crew ?? []).map((c) => c.id as string);
    shiftsQ = shiftsQ.in("employee_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data: people }, { data: sites }, { data: shiftRows }] = await Promise.all([
    peopleQ.order("full_name"),
    supabase.from("job_sites").select("id, name").eq("company_id", me.company_id).eq("active", true).order("name"),
    shiftsQ.order("start_time"),
  ]);

  const visibles = new Set((people ?? []).map((p) => p.id as string));
  return {
    ok: true,
    week,
    people: (people ?? []).map((p) => ({
      id: p.id as string,
      full_name: (p.full_name as string) ?? "—",
      default_schedule: (p.default_schedule as string) ?? null,
      store_id: (p.store_id as string) ?? null,
      custom_schedule: (p.custom_schedule as WeekPattern | null) ?? null,
    })),
    sites: (sites ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
    // Un turno de alguien que no se ve (el dueño, otra tienda) se descarta aquí y no en la
    // pantalla: si llegara, saldría una fila sin nombre y parecería un fallo de datos.
    shifts: (shiftRows ?? []).filter((s) => visibles.has(s.employee_id as string)).map((s) => ({
      id: s.id as string,
      employee_id: s.employee_id as string,
      shift_date: s.shift_date as string,
      start_time: s.start_time as string,
      end_time: s.end_time as string,
      lunch_minutes: (s.lunch_minutes as number) ?? 0,
      site_id: (s.site_id as string) ?? null,
    })),
  };
}
