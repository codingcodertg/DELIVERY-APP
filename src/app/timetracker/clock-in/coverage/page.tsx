import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import { centralDateStr, payPeriodDates } from "@/lib/clockin/schedule";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { storeScope, NO_MATCH } from "@/lib/clockin/scope";
import CrewMap, { type CrewPoint } from "@/app/timetracker/clock-in/dashboard/CrewMap";
import TripMap, { type MapPoint } from "@/app/timetracker/clock-in/runs/TripMap";
import ReviewButton from "@/app/timetracker/clock-in/runs/ReviewButton";
import HubLink from "@/components/clockin/HubLink";
import {
  buildTimeline,
  centralDateOf,
  storeCode,
  POSITION_ORDER,
  type CrewEvent,
  type Trip,
  type TripStop,
} from "./timeline";

export const dynamic = "force-dynamic";

type Group = "employees" | "managers" | "runners" | "owners";
type CrewMember = {
  id: string;
  name: string;
  group: Group;
  where: string;
  ago: string;
  offSite: boolean;
};

function addDays(dateStr: string, days: number) {
  return new Date(new Date(`${dateStr}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
function tm(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}
function weekdayLabel(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function rangeLabel(a: string, b: string) {
  const d = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${d(a)} – ${d(b)}`;
}
function minsBetween(a: string, b: string) {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
}

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  if (!isSupabaseConfigured) redirect("/timetracker/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("company_id, language, location_consent_at, role, store_id, extra_store_ids")
    .eq("id", user.id)
    .single();
  if (me && !me.location_consent_at) redirect("/timetracker/clock-in/welcome");
  if (!me || (me.role !== "manager" && me.role !== "owner")) redirect("/timetracker/clock-in/clock");
  const lang = (me.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);
  const m = tr.mgr;
  const isOwner = me.role === "owner";

  const today = centralDateStr();
  const todayStartUtc = centralWallToUtc(`${today}T00:00`);
  const now = Date.now();

  // Which pay week (Fri→Thu) are we looking at? Defaults to the current one.
  const { week: weekParam } = await searchParams;
  const period = payPeriodDates(weekParam ? new Date(`${weekParam}T12:00:00Z`) : new Date());
  const [periodStart, periodEnd] = [period[0], period[6]];
  const weekStartUtc = centralWallToUtc(`${periodStart}T00:00`);
  const weekEndUtc = new Date(new Date(centralWallToUtc(`${periodEnd}T00:00`)).getTime() + 86400000).toISOString();

  // Store scope: manager → their store; owner → everyone. Owner hidden from managers.
  const { stores, ids } = await storeScope(supabase, me.company_id, me.role, me.store_id, me.extra_store_ids);
  const inEmp = ids ? (ids.length ? ids : NO_MATCH) : null;

  let peopleQ = supabase
    .from("profiles")
    .select("id, full_name, role, is_runner, position, store_id")
    .eq("company_id", me.company_id)
    .eq("active", true);
  // `stores` y no la principal: un gerente con tiendas concedidas (D-127) las ve todas.
  if (stores) peopleQ = peopleQ.in("store_id", stores);
  if (!isOwner) peopleQ = peopleQ.neq("role", "owner");

  let openQ = supabase
    .from("time_entries")
    .select("employee_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_site_id, clock_in_in_radius")
    .eq("company_id", me.company_id)
    .eq("status", "open");
  if (inEmp) openQ = openQ.in("employee_id", inEmp);

  // The whole week's punches / leaves / trips, in bulk (one query each).
  const punchSel = "employee_id, clock_in_at, clock_out_at, clock_in_photo_path, clock_out_photo_path, clock_in_in_radius, clock_out_in_radius, auto_closed";
  let punchQ = supabase.from("time_entries").select(punchSel).eq("company_id", me.company_id).gte("clock_in_at", weekStartUtc).lt("clock_in_at", weekEndUtc);
  let leaveQ = supabase.from("exceptions").select("employee_id, reason, left_at, returned_at").eq("company_id", me.company_id).eq("type", "leaving_while_clocked_in").gte("left_at", weekStartUtc).lt("left_at", weekEndUtc);
  const tripSel = "id, employee_id, started_at, ended_at, start_address, end_address, start_photo_path, end_photo_path, reason, note, vehicle_id, start_odometer, end_odometer, start_lat, start_lng, end_lat, end_lng";
  let tripQ = supabase.from("vehicle_trips").select(tripSel).eq("company_id", me.company_id).gte("started_at", weekStartUtc).lt("started_at", weekEndUtc).order("started_at");
  if (inEmp) {
    punchQ = punchQ.in("employee_id", inEmp);
    leaveQ = leaveQ.in("employee_id", inEmp);
    tripQ = tripQ.in("employee_id", inEmp);
  }

  const [{ data: people }, { data: openRows }, { data: sites }, { data: punches }, { data: leaves }, { data: trips }, { data: vehicles }] =
    await Promise.all([
      peopleQ.order("full_name"),
      openQ,
      supabase.from("job_sites").select("id, name").eq("company_id", me.company_id),
      punchQ,
      leaveQ,
      tripQ,
      supabase.from("vehicles").select("id, name").eq("company_id", me.company_id),
    ]);

  const roster = new Map((people ?? []).map((p) => [p.id as string, p]));
  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  const vehicleName = new Map((vehicles ?? []).map((v) => [v.id as string, v.name as string]));
  const openIds = new Set((openRows ?? []).map((o) => o.employee_id as string));
  const tripList = (trips ?? []) as (Trip & { employee_id: string; start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null })[];

  // Stops for the week's trips.
  const tripIds = tripList.map((t) => t.id);
  let stops: (TripStop & { employee_id: string; latitude: number | null; longitude: number | null })[] = [];
  if (tripIds.length) {
    const { data: st } = await supabase
      .from("trip_stops")
      .select("trip_id, employee_id, label, address, arrived_at, departed_at, photo_path, miles_from_prev, latitude, longitude")
      .in("trip_id", tripIds);
    stops = (st ?? []) as typeof stops;
  }

  // Run sign-off is per EMPLOYEE per pay week (not per trip). Who's signed off,
  // and by whom.
  const reviewedBy = new Map<string, string | null>();
  const { data: reviews } = await supabase
    .from("run_reviews")
    .select("employee_id, reviewed_by")
    .eq("company_id", me.company_id)
    .eq("period_start", periodStart);
  const reviewerIds = [...new Set((reviews ?? []).map((r) => r.reviewed_by).filter(Boolean))] as string[];
  const reviewerName = new Map<string, string>();
  if (reviewerIds.length) {
    const { data: revs } = await supabase.from("profiles").select("id, full_name").in("id", reviewerIds);
    for (const r of revs ?? []) reviewerName.set(r.id as string, r.full_name as string);
  }
  for (const r of reviews ?? []) reviewedBy.set(r.employee_id as string, r.reviewed_by ? reviewerName.get(r.reviewed_by) ?? null : null);
  const canReview = me.role === "manager" || me.role === "owner";

  // Sign every photo the week references, once.
  const photoUrl = new Map<string, string>();
  const paths = [
    ...(punches ?? []).flatMap((p) => [p.clock_in_photo_path, p.clock_out_photo_path]),
    ...tripList.flatMap((t) => [t.start_photo_path, t.end_photo_path]),
    ...stops.map((s) => s.photo_path),
  ].filter(Boolean) as string[];
  for (const p of paths) {
    const { data } = await supabase.storage.from("exception-photos").createSignedUrl(p, 3600);
    if (data?.signedUrl) photoUrl.set(p, data.signedUrl);
  }

  // ---- "On the clock now" strip (unchanged behaviour) --------------------
  const lastStop = new Map<string, { lat: number; lng: number; at: string; address: string | null }>();
  if (openIds.size) {
    const { data: recent } = await supabase
      .from("trip_stops")
      .select("employee_id, latitude, longitude, arrived_at, address")
      .in("employee_id", [...openIds])
      .gte("arrived_at", todayStartUtc)
      .order("arrived_at", { ascending: false });
    for (const s of recent ?? []) {
      if (lastStop.has(s.employee_id)) continue;
      if (s.latitude == null || s.longitude == null) continue;
      lastStop.set(s.employee_id, { lat: s.latitude, lng: s.longitude, at: s.arrived_at, address: s.address ?? null });
    }
  }
  const groupOf = (p: { role: string; is_runner?: boolean | null }): Group =>
    p.is_runner ? "runners" : p.role === "manager" ? "managers" : p.role === "owner" ? "owners" : "employees";
  const agoLabel = (ms: number) => {
    const mins = Math.round((now - ms) / 60000);
    return mins < 1 ? m.justNow : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
  };
  const crew: CrewMember[] = [];
  const crewPoints: CrewPoint[] = [];
  for (const o of openRows ?? []) {
    const p = roster.get(o.employee_id as string);
    if (!p) continue;
    const stop = lastStop.get(o.employee_id as string);
    const clockInMs = new Date(o.clock_in_at as string).getTime();
    const onSite = o.clock_in_in_radius !== false;
    let lat: number | null, lng: number | null, where: string, atMs: number;
    if (stop && new Date(stop.at).getTime() >= clockInMs) {
      lat = stop.lat; lng = stop.lng; where = stop.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`; atMs = new Date(stop.at).getTime();
    } else {
      lat = (o.clock_in_lat as number) ?? null; lng = (o.clock_in_lng as number) ?? null;
      where = o.clock_in_site_id ? siteName.get(o.clock_in_site_id as string) ?? m.atStore : onSite ? m.atStore : m.offSite; atMs = clockInMs;
    }
    const ago = agoLabel(atMs);
    crew.push({ id: p.id, name: p.full_name, group: groupOf(p), where, ago, offSite: !onSite });
    if (lat != null && lng != null) crewPoints.push({ lat, lng, label: `${p.full_name} · ${ago}`, stale: now - atMs > 90 * 60000 });
  }
  const nowGroups: { key: Group; label: string; icon: string }[] = [
    { key: "employees", label: m.grpEmployees, icon: "👤" },
    { key: "managers", label: m.grpManagers, icon: "👔" },
    { key: "runners", label: m.grpRunners, icon: "🚚" },
    { key: "owners", label: m.grpOwners, icon: "⭐" },
  ];

  // ---- Index the week's data by employee ---------------------------------
  const punchesByEmp = new Map<string, typeof punches>();
  for (const p of punches ?? []) (punchesByEmp.get(p.employee_id) ?? punchesByEmp.set(p.employee_id, []).get(p.employee_id)!).push(p);
  const leavesByEmp = new Map<string, typeof leaves>();
  for (const l of leaves ?? []) (leavesByEmp.get(l.employee_id) ?? leavesByEmp.set(l.employee_id, []).get(l.employee_id)!).push(l);
  const tripsByEmp = new Map<string, typeof tripList>();
  for (const t of tripList) (tripsByEmp.get(t.employee_id) ?? tripsByEmp.set(t.employee_id, []).get(t.employee_id)!).push(t);
  const stopsByTrip = new Map<string, typeof stops>();
  for (const s of stops) (stopsByTrip.get(s.trip_id) ?? stopsByTrip.set(s.trip_id, []).get(s.trip_id)!).push(s);
  const tripById = new Map(tripList.map((t) => [t.id, t]));

  const positionLabel = (pos: string | null): string =>
    pos === "office" ? m.posOffice : pos === "warehouse" ? m.posWarehouse : pos === "manager" ? m.posManager : pos === "owner" ? m.posOwner : m.posSales;
  const positionOf = (p: { position?: string | null }) => (p.position ?? "sales") as (typeof POSITION_ORDER)[number];

  // Stores that actually have people in scope, ordered by their code.
  const storeIds = new Set((people ?? []).map((p) => (p.store_id as string) ?? "none"));
  const storeList = [...storeIds]
    .map((id) => ({ id, name: id === "none" ? m.noStore : siteName.get(id) ?? m.noStore }))
    .sort((a, b) => storeCode(a.name).localeCompare(storeCode(b.name)));

  const dateList = period; // Fri..Thu

  // Timeline for one employee on one Central date (fetched-by-start-time, so an
  // overnight run's end stays on the day it began).
  function timelineFor(empId: string, date: string): CrewEvent[] {
    const pun = (punchesByEmp.get(empId) ?? []).filter((p) => centralDateOf(p.clock_in_at) === date);
    const lea = (leavesByEmp.get(empId) ?? []).filter((l) => centralDateOf(l.left_at) === date);
    const trp = (tripsByEmp.get(empId) ?? []).filter((t) => centralDateOf(t.started_at) === date);
    const stp = trp.flatMap((t) => stopsByTrip.get(t.id) ?? []);
    return buildTimeline({ punches: pun, leaves: lea, trips: trp, stops: stp });
  }

  const Photo = ({ path }: { path: string | null | undefined }) =>
    path && photoUrl.get(path) ? (
      <a href={photoUrl.get(path)} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline shrink-0">
        📷 {m.viewPhoto}
      </a>
    ) : null;

  // ---- Render one timeline event -----------------------------------------
  function renderEvent(e: CrewEvent, i: number) {
    const time = tm(e.at);
    if (e.kind === "lunch" || e.kind === "leave") {
      const label = e.kind === "lunch" ? `🍽️ ${tr.onLunch}` : `🚪 ${tr.leaveReasons[(e.label as keyof typeof tr.leaveReasons)] ?? e.label}`;
      const dur = e.openEnded ? m.stillOut : `${minsBetween(e.at, e.endAt!)}m`;
      return (
        <div key={i} className="flex items-center gap-2 py-1.5 my-1 border-y border-dashed border-amber-300 dark:border-amber-900 text-sm text-amber-700 dark:text-amber-400">
          <span className="font-medium">{label}</span>
          <span className="text-xs">{time}{e.endAt ? `–${tm(e.endAt)}` : ""} · {dur}</span>
        </div>
      );
    }
    const icon =
      e.kind === "clock_in" ? "🟢" : e.kind === "clock_out" ? "🔴" : e.kind === "run_start" ? "🚗" : e.kind === "run_end" ? "🏁" : "📍";
    const title =
      e.kind === "clock_in" ? m.clockedInAt
        : e.kind === "clock_out" ? m.clockedOutAt
        : e.kind === "run_start" ? m.runStarted
        : e.kind === "run_end" ? m.runEnded
        : e.label || e.address || m.stopsWord;
    const trip = e.tripId ? tripById.get(e.tripId) : null;

    return (
      <div key={i} className="flex flex-col gap-1 py-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm">
            <span className="font-medium">{icon} {title}</span>
            {/* Always show when they ARRIVED at the stop — for an open stop that
                was the only thing missing (it just said "still out"). A closed
                stop adds the departure + duration. */}
            {e.kind === "stop" && (
              <span className="text-xs text-zinc-500">
                {" · "}{m.arrivedWord} {tm(e.at)}
                {e.endAt ? ` – ${tm(e.endAt)} (${minsBetween(e.at, e.endAt)}m)` : ""}
              </span>
            )}
            {e.kind === "stop" && e.openEnded && <span className="text-xs text-amber-600"> · {m.stillOut}</span>}
            {e.miles != null && <span className="text-xs text-zinc-400"> · +{e.miles} {m.milesWord}</span>}
            {e.note === "offsite" && <span className="ml-1 text-[11px] rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5">{m.offSite}</span>}
            {e.note === "auto" && <span className="ml-1 text-[11px] rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5">{m.autoOut}</span>}
            {/* Only show the address line when it isn't already the title — a stop
                with no typed label uses its address AS the title, and printing it
                again looked like a second stop. */}
            {e.address && e.address !== title && <span className="block text-xs text-zinc-500 truncate">📍 {e.address}</span>}
            {e.kind === "run_start" && e.label && e.note !== "offsite" && e.note !== "auto" && (
              <span className="block text-xs text-zinc-400">{tr.leaveReasons[(e.label as keyof typeof tr.leaveReasons)] ?? e.label}</span>
            )}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {e.kind !== "stop" && <span className="text-xs text-zinc-400 tabular-nums">{time}</span>}
            <Photo path={e.photo} />
          </span>
        </div>

        {/* A run's odometer readings + review live on its start event. */}
        {e.kind === "run_start" && trip && trip.vehicle_id && (
          <p className="text-xs text-zinc-500 pl-5">
            {trip.vehicle_id ? `🚚 ${vehicleName.get(trip.vehicle_id) ?? ""}` : ""}
            {trip.start_odometer != null ? ` · ${m.odoStart} ${trip.start_odometer}` : ""}
            {trip.end_odometer != null ? ` · ${m.odoEnd} ${trip.end_odometer}` : ""}
          </p>
        )}
        {e.kind === "run_start" && trip && (
          <div className="pl-5">
            {(() => {
              const pts: MapPoint[] = [];
              if (trip.start_lat != null && trip.start_lng != null) pts.push({ lat: trip.start_lat, lng: trip.start_lng, kind: "start", label: m.startedAt });
              for (const s of stopsByTrip.get(trip.id) ?? []) if (s.latitude != null && s.longitude != null) pts.push({ lat: s.latitude, lng: s.longitude, kind: "stop", label: s.label || s.address || m.stopsWord });
              if (trip.end_lat != null && trip.end_lng != null) pts.push({ lat: trip.end_lat, lng: trip.end_lng, kind: "end", label: m.endedAt });
              return pts.length ? <TripMap points={pts} label={m.showMap} hideLabel={m.hideMap} /> : null;
            })()}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="flex-1 w-full max-w-md mx-auto p-5 flex flex-col gap-5">
      <header className="flex items-center gap-2.5">
        <HubLink lang={lang} />
        <Link href="/timetracker/clock-in/clock" aria-label={tr.home} className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-10 px-3 text-sm font-semibold hover:border-brand-400 transition-colors shrink-0">
          <span aria-hidden>🏠</span>
          {tr.home}
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{tr.teamCoverage}</h1>
          <p className="text-sm text-zinc-500 truncate">{m.onClockNow} · {crew.length}</p>
        </div>
      </header>

      {/* On the clock RIGHT NOW — pinned, always visible. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">🟢 {m.onClockNow} ({crew.length})</h2>
        {crew.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-3">{m.nobodyClocked}</p>
        ) : (
          <>
            {crewPoints.length > 0 && <CrewMap points={crewPoints} label={m.showMap} />}
            {nowGroups.map((g) => {
              const members = crew.filter((c) => c.group === g.key).sort((a, b) => a.name.localeCompare(b.name));
              if (!members.length) return null;
              return (
                <div key={g.key} className="flex flex-col gap-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{g.icon} {g.label}</p>
                  {members.map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{c.name}</span>
                        {c.offSite && <span className="ml-1 text-[11px] rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5">{m.offSite}</span>}
                        <span className="block text-xs text-zinc-500 truncate">📍 {c.where}</span>
                      </span>
                      <span className="text-xs text-zinc-400 whitespace-nowrap shrink-0">{m.lastSeen} {c.ago}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </section>

      {/* Week navigation. */}
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <Link href={`/timetracker/clock-in/coverage?week=${addDays(periodStart, -7)}`} className="text-sm text-brand-600 hover:underline px-2 py-1">← {m.prevWeek}</Link>
        <span className="text-sm font-semibold text-center">{m.crewWeek} {rangeLabel(periodStart, periodEnd)}</span>
        <Link href={`/timetracker/clock-in/coverage?week=${addDays(periodStart, 7)}`} className="text-sm text-brand-600 hover:underline px-2 py-1">{m.nextWeek} →</Link>
      </div>

      {/* store → date → position → employee → timeline */}
      {storeList.map((store) => {
        const storePeople = (people ?? []).filter((p) => ((p.store_id as string) ?? "none") === store.id);
        // Manager's own store opens by default; owner sees all closed.
        const defaultOpen = !isOwner || store.id === me.store_id;
        return (
          <details key={store.id} open={defaultOpen} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <summary className="cursor-pointer list-none px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 font-semibold flex items-center justify-between">
              <span>{storeCode(store.name)} · {store.name}</span>
              <span className="text-xs text-zinc-400">{storePeople.length} ▾</span>
            </summary>
            <div className="p-3 flex flex-col gap-2">
              {dateList.map((date) => {
                // Who from this store had any activity on this date?
                const active = storePeople.filter((p) => timelineFor(p.id, date).length > 0);
                const dayDefaultOpen = date === today;
                return (
                  <details key={date} open={dayDefaultOpen} className="rounded-xl border border-zinc-100 dark:border-zinc-900">
                    <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium flex items-center justify-between">
                      <span>{weekdayLabel(date)}</span>
                      <span className="text-xs text-zinc-400">{active.length} ▾</span>
                    </summary>
                    <div className="px-3 pb-3 flex flex-col gap-2">
                      {active.length === 0 ? (
                        <p className="text-xs text-zinc-400 py-1">{m.noActivity}</p>
                      ) : (
                        POSITION_ORDER.map((pos) => {
                          const inPos = active.filter((p) => positionOf(p) === pos).sort((a, b) => (a.full_name as string).localeCompare(b.full_name as string));
                          if (!inPos.length) return null;
                          return (
                            <div key={pos} className="flex flex-col gap-1.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 pt-1">{positionLabel(pos)}</p>
                              {inPos.map((p) => {
                                const events = timelineFor(p.id, date);
                                const hasRun = events.some((e) => e.kind === "run_start");
                                return (
                                  <details key={p.id} className="rounded-lg border border-zinc-100 dark:border-zinc-900">
                                    <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium flex items-center justify-between">
                                      <span>{p.full_name}</span>
                                      <span className="text-xs text-zinc-400">{events.length} ▾</span>
                                    </summary>
                                    <div className="px-3 pb-2 divide-y divide-zinc-100 dark:divide-zinc-900">
                                      {events.map((e, i) => renderEvent(e, i))}
                                    </div>
                                    {/* Run sign-off is a WEEK-level action per employee — shown
                                        where the runs are (a day with a run), reviews the whole week. */}
                                    {canReview && hasRun && (
                                      <div className="px-3 pb-2 pt-1 border-t border-zinc-100 dark:border-zinc-900">
                                        <ReviewButton
                                          employeeId={p.id as string}
                                          periodStart={periodStart}
                                          initialReviewed={reviewedBy.has(p.id as string)}
                                          reviewedBy={reviewedBy.get(p.id as string) ?? null}
                                          labelReview={m.markReviewed}
                                          labelReviewed={m.reviewed}
                                        />
                                      </div>
                                    )}
                                  </details>
                                );
                              })}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        );
      })}
    </main>
  );
}
