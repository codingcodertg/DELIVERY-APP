import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { centralDateStr, fmtDate, fmtTime, minutesToHrs, shiftMinutes, payPeriodDates, type WeekPattern } from "@/lib/clockin/schedule";
import { t, type Lang } from "@/lib/clockin/i18n";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import ManagerHeader from "@/components/clockin/ManagerHeader";
import ShiftForm from "./ShiftForm";
import DeleteShiftButton from "./DeleteShiftButton";
import AdminClockPanel from "./AdminClockPanel";

export const dynamic = "force-dynamic";

type Shift = {
  id: string;
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  lunch_minutes: number;
  site_id: string | null;
};

export default async function SchedulePage() {
  if (!isSupabaseConfigured) redirect("/timetracker/clock-in/clock");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, language, store_id")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/timetracker/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang).mgr;

  const week = payPeriodDates(); // schedule view runs Fri→Thu, matching the pay week

  // Store-scoping: a manager with a home store schedules only their store's crew.
  const { scopeStore, ids } = await storeScope(supabase, me.company_id, me.role, me.store_id);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let peopleQ = supabase
    .from("profiles")
    .select("id, full_name, default_schedule, store_id")
    .eq("company_id", me.company_id)
    .eq("active", true);
  if (scopeStore) peopleQ = peopleQ.eq("store_id", scopeStore);
  // The owner is invisible to managers — only the owner sees owners.
  if (me.role !== "owner") peopleQ = peopleQ.neq("role", "owner");

  let shiftsQ = supabase
    .from("scheduled_shifts")
    .select("id, employee_id, shift_date, start_time, end_time, lunch_minutes, site_id")
    .gte("shift_date", week[0])
    .lte("shift_date", week[6]);
  if (inEmp) shiftsQ = shiftsQ.in("employee_id", inEmp);

  const [{ data: people }, { data: sites }, { data: shiftRows }] = await Promise.all([
    peopleQ.order("full_name"),
    supabase.from("job_sites").select("id, name").eq("company_id", me.company_id).eq("active", true).order("name"),
    shiftsQ.order("start_time"),
  ]);

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const storeOf = new Map((people ?? []).map((p) => [p.id as string, (p.store_id as string) ?? null]));
  const storeName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  // Drop any shift for someone not in the visible roster (e.g. the owner).
  const shifts: Shift[] = (shiftRows ?? []).filter((s) => nameOf.has(s.employee_id));

  // Custom weekly patterns for the form (tolerant — the custom_schedule column
  // may not exist until the migration is applied; the page still works without it).
  const customById = new Map<string, WeekPattern | null>();
  {
    const { data: cs, error: csErr } = await supabase
      .from("profiles")
      .select("id, custom_schedule")
      .eq("company_id", me.company_id);
    if (!csErr && cs) for (const r of cs) customById.set(r.id, (r.custom_schedule as WeekPattern | null) ?? null);
  }
  const peopleForForm = (people ?? []).map((p) => ({ ...p, custom_schedule: customById.get(p.id) ?? null }));
  const weekMins = shifts.reduce((sum, s) => sum + shiftMinutes(s.start_time, s.end_time, s.lunch_minutes), 0);
  const today = centralDateStr();

  // Group the week's shifts by the employee's store → collapsible sections.
  const storeKeys = [...new Set(shifts.map((s) => storeOf.get(s.employee_id) ?? "__none__"))];
  const scheduleStores = storeKeys
    .map((key) => ({
      key,
      name: key === "__none__" ? tr.noStore : storeName.get(key) ?? tr.noStore,
      shifts: shifts.filter((s) => (storeOf.get(s.employee_id) ?? "__none__") === key),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto p-5 flex flex-col gap-6">
      <ManagerHeader
        lang={lang}
        active="schedule"
        title={tr.schedule}
        subtitle={tr.weekScheduled.replace("{h}", String(minutesToHrs(weekMins)))}
        isOwner={me.role === "owner"}
      />

      <AdminClockPanel people={(people ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))} lang={lang} />

      <ShiftForm people={peopleForForm} sites={sites ?? []} weekDates={week} lang={lang} />

      <section className="flex flex-col gap-3">
        {scheduleStores.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-4">{tr.noShifts}</p>
        ) : (
          scheduleStores.map((g) => (
            <details
              key={g.key}
              open={scheduleStores.length === 1}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <span className="font-semibold">📍 {g.name} <span className="text-zinc-400 font-normal">({g.shifts.length})</span></span>
                <span className="text-sm text-zinc-500">▾</span>
              </summary>
              <div className="flex flex-col gap-3 p-3">
                {week.map((d) => {
                  const dayShifts = g.shifts.filter((s) => s.shift_date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
                  return (
                    <div
                      key={d}
                      className={`rounded-xl border p-4 ${
                        d === today ? "border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20" : "border-zinc-100 dark:border-zinc-900"
                      }`}
                    >
                      <h3 className="text-sm font-semibold">{fmtDate(d)}</h3>
                      {dayShifts.length === 0 ? (
                        <p className="mt-1 text-xs text-zinc-400">{tr.noShifts}</p>
                      ) : (
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {dayShifts.map((s) => (
                            <li key={s.id} className="flex items-center justify-between text-sm">
                              <span>
                                <span className="font-medium">{nameOf.get(s.employee_id) ?? "Unknown"}</span>
                                <span className="text-zinc-500">
                                  {" "}
                                  · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                                  {s.lunch_minutes ? ` (${s.lunch_minutes}m 🍽️)` : ""}
                                </span>
                              </span>
                              <DeleteShiftButton id={s.id} lang={lang} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          ))
        )}
      </section>
    </main>
  );
}
