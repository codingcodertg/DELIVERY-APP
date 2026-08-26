import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import AppHeader from "@/components/clockin/AppHeader";
import { centralDateStr, fmtDate, fmtTime, minutesToHrs, shiftMinutes, payPeriodDates } from "@/lib/clockin/schedule";

export const dynamic = "force-dynamic";

type Shift = {
  shift_date: string;
  start_time: string;
  end_time: string;
  lunch_minutes: number;
  lunch_start_time: string | null;
  site_id: string | null;
};

export default async function MySchedulePage() {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("language, location_consent_at")
    .eq("id", user.id)
    .single();
  if (profile && !profile.location_consent_at) redirect("/clock-in/welcome");
  const lang = (profile?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);

  const week = payPeriodDates(); // Fri→Thu, matching the pay week
  const today = centralDateStr();
  const [{ data: shiftRows }, { data: sites }, { data: timeOffRows }] = await Promise.all([
    supabase
      .from("scheduled_shifts")
      .select("shift_date, start_time, end_time, lunch_minutes, lunch_start_time, site_id")
      .eq("employee_id", user.id)
      .gte("shift_date", week[0])
      .lte("shift_date", week[6]),
    supabase.from("job_sites").select("id, name").eq("active", true),
    // Approved time-off overlapping this week — so the employee sees the days
    // their manager already approved them off.
    supabase
      .from("time_off_requests")
      .select("type, start_date, end_date")
      .eq("employee_id", user.id)
      .eq("status", "approved")
      .lte("start_date", week[6])
      .gte("end_date", week[0]),
  ]);

  const shifts: Shift[] = shiftRows ?? [];
  const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]));
  const byDate = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!byDate.has(s.shift_date)) byDate.set(s.shift_date, []);
    byDate.get(s.shift_date)!.push(s);
  }
  // date -> approved time-off type covering it
  const offByDate = new Map<string, string>();
  for (const r of timeOffRows ?? []) {
    for (const d of week) if (d >= r.start_date && d <= r.end_date) offByDate.set(d, r.type as string);
  }
  const weekMins = shifts.reduce((sum, s) => sum + shiftMinutes(s.start_time, s.end_time, s.lunch_minutes), 0);

  return (
    <main className="flex-1 w-full max-w-md mx-auto p-5 flex flex-col gap-5">
      <AppHeader
        title={tr.mySchedule}
        subtitle={<>{tr.weekTotal}: <span className="font-medium">{minutesToHrs(weekMins)} h</span></>}
      />

      <section className="flex flex-col gap-2.5">
        {week.map((d) => {
          const dayShifts = (byDate.get(d) ?? []).sort((a, b) => a.start_time.localeCompare(b.start_time));
          const isToday = d === today;
          return (
            <div
              key={d}
              className={`rounded-xl border p-4 ${
                isToday
                  ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <h3 className="text-sm font-semibold">{fmtDate(d)}</h3>
              {offByDate.has(d) && (
                <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold px-2.5 py-1">
                  ✓ {tr.approvedTimeOff}: {tr.timeOffTypes[offByDate.get(d) as keyof typeof tr.timeOffTypes]}
                </p>
              )}
              {dayShifts.length === 0 ? (
                !offByDate.has(d) && <p className="mt-1 text-sm text-zinc-400">{tr.off}</p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {dayShifts.map((s, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                      </span>
                      {s.lunch_minutes ? (
                        <span className="text-zinc-500">
                          {" "}· {s.lunch_minutes}m {tr.lunchWord}
                          {s.lunch_start_time ? ` ${tr.at} ${fmtTime(s.lunch_start_time)}` : ""}
                        </span>
                      ) : null}
                      {s.site_id && siteName.get(s.site_id) ? (
                        <span className="block text-xs text-zinc-500">
                          {tr.at} {siteName.get(s.site_id)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
