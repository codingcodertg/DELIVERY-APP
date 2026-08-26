import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { payPeriodDates, shiftMinutes } from "@/lib/clockin/schedule";
import { hrs, summarize, attachLunch, type PayEntry, type LunchRow } from "@/lib/clockin/payroll";
import { btn } from "@/lib/clockin/ui";
import { t, type Lang } from "@/lib/clockin/i18n";
import ManagerHeader from "@/components/clockin/ManagerHeader";
import EmployeeEntries from "./EmployeeEntries";
import PayrollSearch from "./PayrollSearch";
import ApproveButton from "./ApproveButton";
import SignoffButton from "./SignoffButton";

export const dynamic = "force-dynamic";

function addDays(dateStr: string, days: number) {
  return new Date(new Date(`${dateStr}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
function weekLabel(mon: string, sun: string) {
  const d = (s: string) =>
    new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${d(mon)} – ${d(sun)}`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, language")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang).mgr;
  const isOwner = me.role === "owner";
  // Store-scoping: a manager with a home store sees only that store's crew; the
  // owner (and an unassigned manager) sees everyone. Fetched separately so the
  // page still works before the store_id migration has run.
  const { data: meStore } = await supabase.from("profiles").select("store_id").eq("id", user.id).maybeSingle();
  const scopeStore = me.role === "manager" && meStore?.store_id ? (meStore.store_id as string) : null;

  const { week: weekParam } = await searchParams;
  const base = weekParam ? new Date(`${weekParam}T12:00:00Z`) : new Date();
  // Payroll week runs Friday → Thursday. `monday`/`sunday` here are the pay
  // period's Friday (period_start) and Thursday (period_end).
  const period = payPeriodDates(base);
  const monday = period[0];
  const sunday = period[6];
  const startUtc = centralWallToUtc(`${monday}T00:00`);
  const endUtc = new Date(new Date(startUtc).getTime() + 7 * 86400000).toISOString();

  const peopleQuery = supabase
    .from("profiles")
    .select("id, full_name, store_id")
    .eq("company_id", me.company_id)
    .eq("active", true);
  if (scopeStore) peopleQuery.eq("store_id", scopeStore);
  if (me.role !== "owner") peopleQuery.neq("role", "owner"); // owner not in a manager's payroll
  const { data: people } = await peopleQuery;
  const allowedIds = (people ?? []).map((p) => p.id as string);
  const storeOf = new Map((people ?? []).map((p) => [p.id as string, (p.store_id as string) ?? null]));

  const emptyIds = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: entryRows }, { data: lunchRows }, { data: approvals }, { data: signoff }] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, employee_id, clock_in_at, clock_out_at, lunch_minutes, status, manual, edit_note")
      .in("employee_id", allowedIds.length ? allowedIds : emptyIds)
      .gte("clock_in_at", startUtc)
      .lt("clock_in_at", endUtc)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("exceptions")
      .select("time_entry_id, left_at, returned_at")
      .eq("reason", "lunch")
      .in("employee_id", allowedIds.length ? allowedIds : emptyIds)
      .gte("left_at", startUtc)
      .lt("left_at", endUtc),
    supabase.from("timesheet_approvals").select("employee_id").eq("period_start", monday),
    supabase.from("pay_period_signoffs").select("owner_approved_at").eq("period_start", monday).maybeSingle(),
  ]);

  // Store names + each person's scheduled minutes for the pay week (worked / scheduled).
  const [{ data: siteRows }, { data: schedRows }] = await Promise.all([
    supabase.from("job_sites").select("id, name").eq("company_id", me.company_id),
    supabase
      .from("scheduled_shifts")
      .select("employee_id, start_time, end_time, lunch_minutes")
      .in("employee_id", allowedIds.length ? allowedIds : emptyIds)
      .gte("shift_date", monday)
      .lte("shift_date", sunday),
  ]);
  const storeName = new Map((siteRows ?? []).map((s) => [s.id as string, s.name as string]));
  const schedMinByEmp = new Map<string, number>();
  for (const s of schedRows ?? []) {
    const mins = shiftMinutes(s.start_time as string, s.end_time as string, (s.lunch_minutes as number) ?? 0);
    schedMinByEmp.set(s.employee_id as string, (schedMinByEmp.get(s.employee_id as string) ?? 0) + mins);
  }

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const approvedSet = new Set((approvals ?? []).map((a) => a.employee_id as string));
  const signedOff = !!signoff;
  const entries = attachLunch((entryRows ?? []) as PayEntry[], (lunchRows ?? []) as LunchRow[]);

  const byEmp = new Map<string, PayEntry[]>();
  for (const e of entries) {
    const arr = byEmp.get(e.employee_id) ?? [];
    arr.push(e);
    byEmp.set(e.employee_id, arr);
  }
  const ids = [...byEmp.keys()].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? ""));

  // Group the roster by store so payroll is collapsed sections, not one long list.
  const groupsMap = new Map<string, string[]>();
  for (const id of ids) {
    const key = storeOf.get(id) ?? "__none__";
    (groupsMap.get(key) ?? groupsMap.set(key, []).get(key)!).push(id);
  }
  const storeGroups = [...groupsMap.entries()]
    .map(([key, memberIds]) => ({
      key,
      name: key === "__none__" ? tr.noStore : storeName.get(key) ?? tr.noStore,
      memberIds,
      totalMin: memberIds.reduce((sum, id) => sum + summarize(byEmp.get(id)!).totalMin, 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Company rollup.
  let cReg = 0,
    cOt = 0,
    cTot = 0,
    cOpen = 0;
  for (const id of ids) {
    const s = summarize(byEmp.get(id)!);
    cReg += s.regularMin;
    cOt += s.otMin;
    cTot += s.totalMin;
    cOpen += s.openCount;
  }

  const exportHref = (type: string) => `/api/clock-in/reports/export?type=${type}&week=${monday}`;

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto p-5 flex flex-col gap-5">
      <ManagerHeader lang={lang} active="reports" title={tr.payroll} subtitle={tr.payrollSubtitle} isOwner={isOwner} />

      {/* Week navigation */}
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <Link href={`/clock-in/reports?week=${addDays(monday, -7)}`} className="text-sm text-emerald-600 hover:underline px-2 py-1">
          ← {tr.prevWeek}
        </Link>
        <span className="text-sm font-semibold">
          {tr.weekOf} {weekLabel(monday, sunday)}
        </span>
        <Link href={`/clock-in/reports?week=${addDays(monday, 7)}`} className="text-sm text-emerald-600 hover:underline px-2 py-1">
          {tr.nextWeek} →
        </Link>
      </div>

      {/* Rollup + export + sign-off */}
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">{tr.companyTotal}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{hrs(cTot)} h</p>
            <p className="text-sm text-zinc-500">
              {tr.regular} {hrs(cReg)} · {tr.overtime} {hrs(cOt)} · {ids.length} {tr.employeesWord} ·{" "}
              {approvedSet.size}/{ids.length} {tr.approvedWord}
            </p>
          </div>
          {signedOff ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-sm font-semibold px-3 py-1.5">
              🔒 {tr.periodSignedOff}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-sm font-semibold px-3 py-1.5">
              {tr.periodOpen}
            </span>
          )}
        </div>

        {cOpen > 0 && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            ⚠️ {cOpen} {tr.openPunchWarning}
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <a href={`/api/clock-in/reports/xlsx?week=${monday}`} className={btn("primary", "sm")}>
            ⬇ {isOwner ? tr.exportExcelAll : tr.exportExcel}
          </a>
          <a href={exportHref("summary")} className={btn("neutral", "sm")}>
            ⬇ {tr.exportSummary}
          </a>
          <a href={exportHref("detail")} className={btn("neutral", "sm")}>
            ⬇ {tr.exportDetail}
          </a>
          {isOwner && <SignoffButton periodStart={monday} signedOff={signedOff} lang={lang} />}
        </div>
        {!isOwner && <p className="text-xs text-zinc-400">{tr.ownerSignsOff}</p>}
      </section>

      {/* Per-store timesheets (collapsed dropdowns) */}
      {ids.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-8">{tr.noTimesheets}</p>
      ) : (
        <section className="flex flex-col gap-3">
          <PayrollSearch placeholder={`🔍 ${tr.searchEmployees}`} />
          {storeGroups.map((g) => (
            <details
              key={g.key}
              open={storeGroups.length === 1}
              data-store-group
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <span className="font-semibold">📍 {g.name} <span className="text-zinc-400 font-normal">({g.memberIds.length})</span></span>
                <span className="text-sm text-zinc-500 tabular-nums">{hrs(g.totalMin)} h ▾</span>
              </summary>
              <div className="flex flex-col gap-3 p-3">
                {g.memberIds.map((id) => {
                  const s = summarize(byEmp.get(id)!);
                  const schedMin = schedMinByEmp.get(id) ?? 0;
                  return (
                    <div key={id} data-emp-name={(nameOf.get(id) ?? "").toLowerCase()} className="rounded-xl border border-zinc-100 dark:border-zinc-900 p-4">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-semibold">{nameOf.get(id) ?? "Unknown"}</p>
                          <p className="text-sm text-zinc-500 tabular-nums">
                            <span className="font-medium text-zinc-700 dark:text-zinc-200">{hrs(s.totalMin)}</span> / {schedMin > 0 ? hrs(schedMin) : "—"} h {tr.scheduledWord}
                            {s.otMin > 0 ? ` · ${hrs(s.otMin)} ${tr.overtime}` : ""}
                            {s.lunchMin > 0 ? ` · 🍽️ ${Math.round(s.lunchMin)}m` : ""}
                          </p>
                        </div>
                        <ApproveButton
                          employeeId={id}
                          periodStart={monday}
                          approved={approvedSet.has(id)}
                          locked={signedOff}
                          lang={lang}
                        />
                      </div>
                      <EmployeeEntries
                        employeeId={id}
                        entries={byEmp.get(id)!}
                        periodStart={monday}
                        locked={signedOff}
                        lang={lang}
                      />
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
          <p className="text-xs text-zinc-400 text-center">{tr.noPunchesNote}</p>
        </section>
      )}
    </main>
  );
}
