import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { dayAndWeekStart } from "@/lib/clockin/time";
import { weekDates } from "@/lib/clockin/schedule";
import { todayAlerts } from "@/lib/clockin/scorecard";
import { t, type Lang } from "@/lib/clockin/i18n";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import ManagerHeader from "@/components/clockin/ManagerHeader";

export const dynamic = "force-dynamic";

// The dashboard used to also show "on the clock now", "attendance this week"
// and "today's punches" — all now live (and correct) inside Today's Crew. What's
// left here is the one thing Today's Crew doesn't surface as an ALERT: who is
// late or hasn't clocked in for a shift that's already started.
export default async function DashboardPage() {
  if (!isSupabaseConfigured) redirect("/timetracker/clock-in/clock");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, full_name, language, store_id, extra_store_ids")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/timetracker/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang).mgr;

  const { todayStartUtc } = dayAndWeekStart();
  const week = weekDates();

  const { stores, ids } = await storeScope(supabase, me.company_id, me.role, me.store_id, me.extra_store_ids);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let peopleQ = supabase.from("profiles").select("id, full_name").eq("company_id", me.company_id).eq("active", true);
  // `stores` y no la principal: un gerente con tiendas concedidas (D-127) las ve todas.
  if (stores) peopleQ = peopleQ.in("store_id", stores);
  if (me.role !== "owner") peopleQ = peopleQ.neq("role", "owner");

  // Only TODAY's entries + today's shifts are needed to spot late / not-in-yet.
  let entriesQ = supabase
    .from("time_entries")
    .select("id, employee_id, clock_in_at, clock_out_at, status")
    .gte("clock_in_at", todayStartUtc.toISOString());
  if (inEmp) entriesQ = entriesQ.in("employee_id", inEmp);

  let shiftsQ = supabase
    .from("scheduled_shifts")
    .select("employee_id, shift_date, start_time, end_time, lunch_minutes")
    .eq("shift_date", week.find((d) => d === new Date(todayStartUtc).toISOString().slice(0, 10)) ?? week[0]);
  if (inEmp) shiftsQ = shiftsQ.in("employee_id", inEmp);

  const [{ data: people }, { data: todayEntries }, { data: shiftRows }] = await Promise.all([peopleQ.order("full_name"), entriesQ, shiftsQ]);

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const alerts = todayAlerts(shiftRows ?? [], todayEntries ?? []);
  const hasAttention = alerts.late.length > 0 || alerts.notInYet.length > 0;

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto p-5 flex flex-col gap-6">
      <ManagerHeader lang={lang} active="dashboard" title={tr.dashboard} subtitle={`Rodriguez Tile Group · ${me.full_name}`} isOwner={me.role === "owner"} />

      {hasAttention ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">{tr.needsAttention}</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {alerts.notInYet.map((a) => (
              <li key={"n" + a.employeeId} className="flex items-center gap-2">
                <span className="text-red-600">●</span>
                <span className="font-medium">{nameOf.get(a.employeeId) ?? "Unknown"}</span>
                <span className="text-zinc-500">{tr.notClockedIn}</span>
              </li>
            ))}
            {alerts.late.map((a) => (
              <li key={"l" + a.employeeId} className="flex items-center gap-2">
                <span className="text-amber-600">▲</span>
                <span className="font-medium">{nameOf.get(a.employeeId) ?? "Unknown"}</span>
                <span className="text-zinc-500">{tr.lateBy.replace("{n}", String(a.minutes))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-8 text-center">
          <p className="text-sm text-zinc-400">{tr.allGoodToday}</p>
        </section>
      )}

      {/* Everything else a manager wants — who's working, hours, runs, punches —
          lives in Today's Crew now. */}
      <a href="/timetracker/clock-in/coverage" className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-5 text-center hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors">
        <span className="font-semibold text-emerald-700 dark:text-emerald-400">{tr.dashOpenCrew} →</span>
      </a>
    </main>
  );
}
