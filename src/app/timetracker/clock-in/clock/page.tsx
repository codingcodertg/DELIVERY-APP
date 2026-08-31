import Link from "next/link";
import { redirect } from "next/navigation";
import ClockInPanel, { type OpenShift } from "./ClockInPanel";
import VehicleTripPanel, { type Stop as RunnerStop, type Vehicle as RunnerVehicle, type TripMode } from "./VehicleTripPanel";
import NavMenu from "./NavMenu";
import HubLink from "@/components/clockin/HubLink";
import Tour, { type TourRole } from "./Tour";
import type { ActiveLeave } from "@/app/timetracker/clock-in/actions/leave";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import { centralDateStr, fmtTime, minutesToHrs, payPeriodDates, shiftMinutes, weekDates } from "@/lib/clockin/schedule";
import { scoreWeek } from "@/lib/clockin/scorecard";
import { attachLunch, type LunchRow } from "@/lib/clockin/payroll";
import { centralShiftMs, centralWallToUtc } from "@/lib/clockin/tz";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";

type TodayShift = { start: string; end: string; lunch: number; site: string | null } | null;
type WeekSummary = { scheduledMins: number; workedMs: number; onTimeDays: number; lateCount: number; daysScheduled: number } | null;

export default async function ClockPage() {
  if (!isSupabaseConfigured) {
    return (
      <ClockShell
        lang="en"
        name={null}
        openShift={null}
        activeLeave={null}
        todayShift={null}
        week={null}
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, language, role, company_id, location_consent_at, store_id, is_runner, vehicle_id")
    .eq("id", user.id)
    .single();

  // First-time employees must accept the location-use notice before clocking in.
  if (profile && !profile.location_consent_at) redirect("/timetracker/clock-in/welcome");

  // Has this account seen the first-login tutorial? Fetched tolerantly so the
  // page still works before the tutorial_seen_at migration has run.
  const { data: tut } = await supabase.from("profiles").select("tutorial_seen_at").eq("id", user.id).maybeSingle();
  const tourSeen = !!tut?.tutorial_seen_at;

  const week = weekDates();
  const today = centralDateStr();
  // Central-time week bounds (not UTC midnight) so "this week" doesn't leak
  // Sunday-night or next-Monday punches into the totals.
  const weekStartUtc = centralWallToUtc(`${week[0]}T00:00`);
  const weekEndUtc = new Date(new Date(centralWallToUtc(`${week[6]}T00:00`)).getTime() + 86400000).toISOString();

  const [{ data: openRow }, { data: shiftRows }, { data: weekEntries }] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, clock_in_at, still_working_at")
      .eq("employee_id", user.id)
      .eq("status", "open")
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("scheduled_shifts")
      .select("shift_date, start_time, end_time, lunch_minutes, site_id")
      .eq("employee_id", user.id)
      .gte("shift_date", week[0])
      .lte("shift_date", week[6]),
    supabase
      .from("time_entries")
      .select("id, clock_in_at, clock_out_at")
      .eq("employee_id", user.id)
      .gte("clock_in_at", weekStartUtc)
      .lt("clock_in_at", weekEndUtc),
  ]);
  const { data: weekLunch } = await supabase
    .from("exceptions")
    .select("time_entry_id, left_at, returned_at")
    .eq("employee_id", user.id)
    .eq("reason", "lunch")
    .gte("left_at", weekStartUtc)
    .lt("left_at", weekEndUtc);
  const { data: siteRows } = await supabase.from("job_sites").select("id, name").eq("active", true);
  const siteName = new Map((siteRows ?? []).map((s) => [s.id, s.name]));

  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", user.id)
    .eq("read", false);

  const openShift: OpenShift = openRow ? { id: openRow.id, clockInAt: openRow.clock_in_at } : null;

  // Vehicle-trip layer. Everyone clocks in the normal way first; once clocked in,
  // a runner is prompted to record the vehicle before their first run, and a
  // (non-runner) salesman can optionally log an ad-hoc trip. One shared panel.
  let trip: {
    mode: TripMode;
    vehicles: RunnerVehicle[];
    onTrip: boolean;
    personalTrip: boolean;
    tripStartedAt: string | null;
    tripPaused: boolean;
    stops: RunnerStop[];
    currentVehicleId: string | null;
  } | null = null;
  if (openRow && profile?.company_id) {
    const mode: TripMode = profile.is_runner ? "runner" : "sales";
    const { data: veh } = await supabase
      .from("vehicles")
      .select("id, name")
      .eq("company_id", profile.company_id)
      .eq("active", true)
      .order("name");
    const vehicles = (veh ?? []) as RunnerVehicle[];
    // Always render for a runner (even with no vehicles → personal-run option);
    // a salesman gets the panel whenever there's a vehicle OR they're mid-trip.
    const { data: openTrip } = await supabase
      .from("vehicle_trips")
      .select("id, started_at, vehicle_id, paused_at")
      .eq("employee_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mode === "runner" || vehicles.length > 0 || openTrip) {
      let stops: RunnerStop[] = [];
      if (openTrip) {
        const { data: st } = await supabase
          .from("trip_stops")
          .select("id, label, arrived_at, departed_at, miles_from_prev, photo_path")
          .eq("trip_id", openTrip.id)
          .order("arrived_at", { ascending: true });
        stops = (st ?? []) as RunnerStop[];
      }
      trip = {
        mode,
        vehicles,
        onTrip: !!openTrip,
        personalTrip: !!openTrip && openTrip.vehicle_id == null,
        tripStartedAt: openTrip?.started_at ?? null,
        tripPaused: !!openTrip?.paused_at,
        stops,
        currentVehicleId: (profile.vehicle_id as string) ?? null,
      };
    }
  }

  // Active "leaving work location" event for the current shift (if any).
  let activeLeave: ActiveLeave = null;
  if (openRow) {
    const { data: lv } = await supabase
      .from("exceptions")
      .select("id, reason, left_at, expected_return_at")
      .eq("employee_id", user.id)
      .eq("type", "leaving_while_clocked_in")
      .is("returned_at", null)
      .order("left_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeLeave = lv
      ? { id: lv.id, reason: lv.reason, leftAt: lv.left_at, expectedReturnAt: lv.expected_return_at }
      : null;
  }

  // Lunch already TAKEN on the current shift (completed breaks) — the on-screen
  // worked timer subtracts this so it matches how payroll counts the day.
  let lunchTakenMin = 0;
  let lunchTakenCount = 0; // a 20-second lunch still counts as a lunch
  if (openRow) {
    const { data: doneLunches } = await supabase
      .from("exceptions")
      .select("left_at, returned_at")
      .eq("employee_id", user.id)
      .eq("reason", "lunch")
      .not("returned_at", "is", null)
      .gte("left_at", openRow.clock_in_at);
    for (const l of doneLunches ?? []) {
      lunchTakenMin += Math.max(0, (new Date(l.returned_at).getTime() - new Date(l.left_at).getTime()) / 60000);
    }
    lunchTakenCount = (doneLunches ?? []).length;
    lunchTakenMin = Math.round(lunchTakenMin);
  }

  const shifts = shiftRows ?? [];
  const todayRow = shifts.find((s) => s.shift_date === today);
  const todayShift: TodayShift = todayRow
    ? {
        start: todayRow.start_time,
        end: todayRow.end_time,
        lunch: todayRow.lunch_minutes,
        site: todayRow.site_id ? (siteName.get(todayRow.site_id) ?? null) : null,
      }
    : null;
  const scheduledMins = shifts.reduce(
    (sum, s) => sum + shiftMinutes(s.start_time, s.end_time, s.lunch_minutes),
    0,
  );
  // Attach punched lunch so worked time (and OT alerts) exclude unpaid breaks.
  const weekEntriesL = attachLunch(
    (weekEntries ?? []).map((e) => ({
      id: e.id as string,
      employee_id: user.id,
      clock_in_at: e.clock_in_at as string,
      clock_out_at: e.clock_out_at as string | null,
      punched_lunch_min: null as number | null,
    })),
    (weekLunch ?? []) as LunchRow[],
  );
  const now = Date.now();
  const workedMs = weekEntriesL.reduce((sum, e) => {
    const start = new Date(e.clock_in_at).getTime();
    const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : now;
    return sum + Math.max(0, end - start - (e.punched_lunch_min ?? 0) * 60000);
  }, 0);

  const myScore = scoreWeek(
    shifts.map((s) => ({
      employee_id: user.id,
      shift_date: s.shift_date,
      start_time: s.start_time,
      end_time: s.end_time,
      lunch_minutes: s.lunch_minutes,
    })),
    weekEntriesL,
  ).get(user.id);

  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const isManager = profile?.role === "manager" || profile?.role === "owner";

  // In-app alerts (work on every phone): computed on load. Proactive push/SMS is a later layer.
  const tr = t(lang);
  const localNow = new Date(Date.now() - centralShiftMs(new Date()));
  const nowMin = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const alerts: string[] = [];
  if (openShift && todayShift) {
    const [eh, em] = todayShift.end.split(":").map(Number);
    const remaining = eh * 60 + em - nowMin;
    if (remaining > 0 && remaining <= 15) alerts.push(tr.shiftEndsSoon.replace("{n}", String(remaining)));
  }
  const workedHours = workedMs / 3600000;
  if (workedHours >= 40) alerts.push(tr.inOvertime);
  else if (workedHours >= 36) alerts.push(tr.approachingOT);

  // Manager/owner "needs your attention" to-dos, surfaced on the home page.
  let pending: { timesheets: number; timeoff: number; exceptions: number } | null = null;
  if (isManager && profile?.company_id) {
    const cid = profile.company_id;
    // MUST be the pay period (Fri->Thu), not the Mon->Sun display week. Approvals
    // are stored keyed on the pay period's Friday, so counting them against a
    // Monday meant the keys never matched and approving a timesheet never
    // cleared this counter — it just sat there showing work as outstanding.
    const period = payPeriodDates();
    const startUtc = centralWallToUtc(`${period[0]}T00:00`);
    const endUtc = new Date(new Date(startUtc).getTime() + 7 * 86400000).toISOString();
    // Store-scoping: a manager's to-dos cover only their store's crew.
    const { ids } = await storeScope(supabase, cid, profile.role as string, profile.store_id);
    const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

    let timeoffQ = supabase.from("time_off_requests").select("id", { count: "exact", head: true }).eq("company_id", cid).eq("status", "pending");
    let excQ = supabase.from("exceptions").select("id", { count: "exact", head: true }).eq("company_id", cid).eq("resolved", false);
    let entQ = supabase.from("time_entries").select("employee_id").eq("company_id", cid).gte("clock_in_at", startUtc).lt("clock_in_at", endUtc);
    if (inEmp) {
      timeoffQ = timeoffQ.in("employee_id", inEmp);
      excQ = excQ.in("employee_id", inEmp);
      entQ = entQ.in("employee_id", inEmp);
    }
    const [{ count: timeoff }, { count: exc }, { data: ent }, { data: appr }] = await Promise.all([
      timeoffQ,
      excQ,
      entQ,
      supabase.from("timesheet_approvals").select("employee_id").eq("period_start", period[0]),
    ]);
    const approved = new Set((appr ?? []).map((a) => a.employee_id));
    const empWithHours = new Set((ent ?? []).map((e) => e.employee_id));
    pending = {
      timesheets: [...empWithHours].filter((id) => !approved.has(id)).length,
      timeoff: timeoff ?? 0,
      exceptions: exc ?? 0,
    };
  }

  return (
    <ClockShell
      pending={pending}
      lang={lang}
      name={profile?.full_name ?? user.email ?? null}
      openShift={openShift}
      activeLeave={activeLeave}
      isManager={isManager}
      todayShift={todayShift}
      alerts={alerts}
      unread={unreadCount ?? 0}
      tourRole={profile?.role === "owner" ? "owner" : profile?.role === "manager" ? "manager" : "employee"}
      tourSeen={tourSeen}
      uploadCtx={{ companyId: profile?.company_id ?? null, userId: user.id }}
      trip={trip}
      lunchTakenMin={lunchTakenMin}
      lunchTaken={lunchTakenCount > 0}
      stillWorkingAt={(openRow?.still_working_at as string) ?? null}
      week={{
        scheduledMins,
        workedMs,
        onTimeDays: myScore?.onTimeDays ?? 0,
        lateCount: myScore?.lateCount ?? 0,
        daysScheduled: new Set(shifts.map((s) => s.shift_date)).size,
      }}
    />
  );
}

function ClockShell({
  lang,
  name,
  openShift,
  activeLeave,
  isManager = false,
  todayShift,
  week,
  alerts = [],
  unread = 0,
  pending = null,
  tourRole = "employee",
  tourSeen = true,
  uploadCtx = { companyId: null, userId: null },
  trip = null,
  lunchTakenMin = 0,
  lunchTaken = false,
  stillWorkingAt = null,
}: {
  lang: Lang;
  name: string | null;
  openShift: OpenShift;
  activeLeave: ActiveLeave;
  isManager?: boolean;
  todayShift: TodayShift;
  week: WeekSummary;
  alerts?: string[];
  unread?: number;
  pending?: { timesheets: number; timeoff: number; exceptions: number } | null;
  tourRole?: TourRole;
  tourSeen?: boolean;
  uploadCtx?: { companyId: string | null; userId: string | null };
  trip?: { mode: TripMode; vehicles: RunnerVehicle[]; onTrip: boolean; personalTrip: boolean; tripStartedAt: string | null; tripPaused: boolean; stops: RunnerStop[]; currentVehicleId: string | null } | null;
  lunchTakenMin?: number;
  lunchTaken?: boolean;
  stillWorkingAt?: string | null;
  runPaused?: boolean;
}) {
  const tr = t(lang);
  const pendingTotal = pending ? pending.timesheets + pending.timeoff + pending.exceptions : 0;
  const todoLink =
    "flex items-center justify-between rounded-xl bg-white/70 dark:bg-zinc-900/50 px-3 py-2.5 text-sm hover:bg-white dark:hover:bg-zinc-900 transition-colors";
  return (
    <main className="flex-1 w-full max-w-md mx-auto flex flex-col p-5 gap-5">
      {/* Top bar: brand + everything-else menu. The hub link matters most here — this is where
          clock-in lands you, and the sub-pages' 🏠 comes back to it. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{tr.appName}</h1>
          <p className="text-xs text-zinc-500 truncate">{name ?? tr.tagline}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {name && <HubLink lang={lang} />}
          {name && <NavMenu lang={lang} isManager={isManager} isOwner={tourRole === "owner"} unread={unread} />}
        </div>
      </div>

      {/* Quick tiles — employees & managers (owners have no personal schedule/notes/score) */}
      {name && tourRole !== "owner" && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/timetracker/clock-in/my-schedule", icon: "📅", label: tr.mySchedule },
            { href: "/timetracker/clock-in/notes", icon: "📝", label: tr.dailyNotes },
            { href: "/timetracker/clock-in/me", icon: "📊", label: tr.myAccountability },
          ].map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-3 text-center hover:border-brand-400 transition-colors"
            >
              <span className="text-xl" aria-hidden>{tile.icon}</span>
              <span className="text-[11px] font-medium leading-tight text-zinc-600 dark:text-zinc-300">{tile.label}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Manager to-dos */}
      {pendingTotal > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50/70 dark:bg-amber-950/20 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-500">{tr.toDo}</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {pending!.timesheets > 0 && (
              <li>
                <Link href="/timetracker/payroll" className={todoLink}>
                  <span>✅ <b className="tabular-nums">{pending!.timesheets}</b> {tr.timesheetsToApprove}</span>
                  <span className="text-amber-600">→</span>
                </Link>
              </li>
            )}
            {pending!.timeoff > 0 && (
              <li>
                <Link href="/timetracker/team-requests" className={todoLink}>
                  <span>🗓️ <b className="tabular-nums">{pending!.timeoff}</b> {tr.timeoffToReview}</span>
                  <span className="text-amber-600">→</span>
                </Link>
              </li>
            )}
            {pending!.exceptions > 0 && (
              <li>
                <Link href="/timetracker/audit" className={todoLink}>
                  <span>📍 <b className="tabular-nums">{pending!.exceptions}</b> {tr.exceptionsToReview}</span>
                  <span className="text-amber-600">→</span>
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Centered clock area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 py-2">
      {alerts.length > 0 && (
        <div className="w-full max-w-sm flex flex-col gap-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2"
            >
              <span>🔔</span>
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {(todayShift || week) && (
        <div
          data-tour="shift"
          className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 text-center text-sm"
        >
          <p className="text-zinc-500">
            {tr.todaysShift}:{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {todayShift ? `${fmtTime(todayShift.start)} – ${fmtTime(todayShift.end)}` : "—"}
            </span>
          </p>
          {todayShift && (todayShift.lunch || false) ? (
            <p className="mt-0.5 text-xs text-zinc-400">
              {todayShift.lunch}m {tr.lunchWord}
              {todayShift.site ? ` · ${todayShift.site}` : ""}
            </p>
          ) : todayShift && todayShift.site ? (
            <p className="mt-0.5 text-xs text-zinc-400">{todayShift.site}</p>
          ) : null}
          {week && (
            <>
              <p className="mt-1 text-zinc-500">
                {tr.thisWeek}:{" "}
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {minutesToHrs(Math.round(week.workedMs / 60000))} h
                </span>{" "}
                / {minutesToHrs(week.scheduledMins)} h
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {week.daysScheduled} {tr.daysScheduledWord}
              </p>
            </>
          )}
          {week && week.onTimeDays > 0 && (
            <p className="mt-1 text-xs text-emerald-600">
              {week.lateCount === 0
                ? `On time every day this week — ${week.onTimeDays} for ${week.onTimeDays} 🎉`
                : `${week.onTimeDays} days on time this week`}
            </p>
          )}
        </div>
      )}

      {/* Heading out / the run sits ABOVE lunch and clock-out — it's the first
          decision of the day, and the three buttons now read as one stack. */}
      {/* An on-site employee at lunch has no reason to see "Voy a salir" — the
          clock is stopped and where they go is their own business. Someone
          mid-run is a different case and keeps their panel: it shows the run is
          paused, which they need on the way back. */}
      {trip && !(activeLeave?.reason === "lunch" && !trip.onTrip) && (
        <VehicleTripPanel
          lang={lang}
          mode={trip.mode}
          vehicles={trip.vehicles}
          currentVehicleId={trip.currentVehicleId}
          initialOnTrip={trip.onTrip}
          personalTrip={trip.personalTrip}
          tripStartedAt={trip.tripStartedAt}
          tripPaused={trip.tripPaused}
          stops={trip.stops}
          uploadCtx={uploadCtx}
        />
      )}
      <ClockInPanel
        lang={lang}
        initialOpen={openShift}
        initialLeave={activeLeave}
        uploadCtx={uploadCtx}
        lunchTakenMin={lunchTakenMin}
        lunchTaken={lunchTaken}
        lunchAllowanceMin={todayShift?.lunch ?? 0}
        stillWorkingAt={stillWorkingAt}
        runPaused={trip?.tripPaused ?? false}
      />
      </div>

      <Tour lang={lang} enabled={!!name} role={tourRole} seen={tourSeen} />
    </main>
  );
}
