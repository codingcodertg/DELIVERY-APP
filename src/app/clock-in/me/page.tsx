import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { t, type Lang } from "@/lib/clockin/i18n";
import AppHeader from "@/components/clockin/AppHeader";
import { centralDateStr, minutesToHrs } from "@/lib/clockin/schedule";
import { scoreWeek, longLunchesByEmployee } from "@/lib/clockin/scorecard";
import { attachLunch, type LunchRow } from "@/lib/clockin/payroll";
import { centralShiftMs } from "@/lib/clockin/tz";

export const dynamic = "force-dynamic";

function monthStartStr(now = new Date()) {
  const local = new Date(now.getTime() - centralShiftMs(now));
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function monthLabel(now = new Date()) {
  return new Date(now.getTime() - centralShiftMs(now)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Supportive, never punitive — implements the "positive reinforcement" pillar.
function praise(
  s: { onTimeDays: number; lateCount: number; missed: number; earlyDepartures: number },
  lang: Lang,
) {
  const en = lang === "en";
  if (s.onTimeDays === 0 && s.lateCount === 0 && s.missed === 0)
    return en ? "A fresh month — let's make it a great one. 💪" : "Un mes nuevo — ¡a darlo todo! 💪";
  if (s.lateCount === 0 && s.missed === 0)
    return en
      ? `Perfect attendance so far — ${s.onTimeDays} for ${s.onTimeDays}. Outstanding! 🌟`
      : `Asistencia perfecta — ${s.onTimeDays} de ${s.onTimeDays}. ¡Excelente! 🌟`;
  if (s.lateCount <= 1 && s.missed === 0)
    return en
      ? "Strong month — punctual and reliable. Keep it up! 👏"
      : "Buen mes — puntual y confiable. ¡Sigue así! 👏";
  if (s.onTimeDays >= s.lateCount)
    return en
      ? `Mostly on time — ${s.onTimeDays} solid days. A couple to tighten up.`
      : `Casi siempre a tiempo — ${s.onTimeDays} días sólidos. Unos por mejorar.`;
  return en
    ? "Let's aim to start a few more shifts on time this month — you've got this."
    : "Intentemos llegar a tiempo a más turnos este mes — ¡tú puedes!";
}

function Tile({ value, label, tone = "default" }: { value: string | number; label: string; tone?: string }) {
  const color =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-red-600" : "";
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 text-center">
      <p className={`text-3xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{label}</p>
    </div>
  );
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  if (!isSupabaseConfigured) redirect("/clock-in/clock");
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, language, full_name, store_id")
    .eq("id", user.id)
    .single();
  const lang = (me?.language === "es" ? "es" : "en") as Lang;
  const tr = t(lang);
  const isManager = me?.role === "manager" || me?.role === "owner";

  // Managers may view another employee's card via ?u=; everyone else sees self.
  const targetId = isManager && sp.u ? sp.u : user.id;
  let targetName = me?.full_name ?? "You";
  if (targetId !== user.id) {
    const { data: tp } = await supabase
      .from("profiles")
      .select("full_name, store_id, role")
      .eq("id", targetId)
      .eq("company_id", me!.company_id)
      .single();
    if (!tp) redirect("/clock-in/me");
    // The owner is invisible to managers — only an owner can view an owner's card.
    if (me!.role !== "owner" && tp.role === "owner") redirect("/clock-in/me");
    // A store-assigned manager can only view their own store's crew (owner: any).
    if (me!.role === "manager" && me!.store_id && tp.store_id !== me!.store_id) redirect("/clock-in/me");
    targetName = tp.full_name;
  }

  const start = monthStartStr();
  const [{ data: shiftRows }, { data: entryRows }, { data: noteRows }, { data: lunchRows }] =
    await Promise.all([
    supabase
      .from("scheduled_shifts")
      .select("employee_id, shift_date, start_time, end_time, lunch_minutes")
      .eq("employee_id", targetId)
      .gte("shift_date", start)
      .lte("shift_date", centralDateStr()),
    supabase
      .from("time_entries")
      .select("id, employee_id, clock_in_at, clock_out_at")
      .eq("employee_id", targetId)
      .gte("clock_in_at", start + "T00:00:00Z"),
    supabase
      .from("notes_log")
      .select("id, note, created_at")
      .eq("employee_id", targetId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("exceptions")
      .select("employee_id, time_entry_id, left_at, returned_at")
      .eq("employee_id", targetId)
      .eq("reason", "lunch")
      .gte("created_at", start + "T00:00:00Z"),
  ]);
  const notes = noteRows ?? [];

  const scoreEntries = attachLunch(
    (entryRows ?? []) as { id: string; employee_id: string; clock_in_at: string; clock_out_at: string | null; punched_lunch_min?: number | null }[],
    (lunchRows ?? []) as LunchRow[],
  );
  const score = scoreWeek(shiftRows ?? [], scoreEntries).get(targetId) ?? {
    onTimeDays: 0,
    lateCount: 0,
    lateMinTotal: 0,
    earlyDepartures: 0,
    clockedInEarly: 0,
    missed: 0,
    workedMins: 0,
  };
  const longLunches = longLunchesByEmployee(lunchRows ?? []).get(targetId) ?? 0;

  return (
    <main className="flex-1 w-full max-w-xl mx-auto p-5 flex flex-col gap-6">
      <AppHeader title={tr.myAccountability} subtitle={`${targetName} · ${monthLabel()}`} />

      <div className="rounded-2xl border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 p-5 text-center">
        <p className="text-base font-medium text-emerald-800 dark:text-emerald-300">{praise(score, lang)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile value={`${minutesToHrs(score.workedMins)} h`} label={tr.hoursLabel} />
        <Tile value={score.onTimeDays} label={`✅ ${tr.daysOnTime}`} tone={score.onTimeDays > 0 ? "good" : "default"} />
        <Tile
          value={score.lateCount}
          label={`⚠️ ${tr.lateArrivals}${score.lateMinTotal ? ` (${score.lateMinTotal}m)` : ""}`}
          tone={score.lateCount > 0 ? "warn" : "default"}
        />
        <Tile value={score.earlyDepartures} label={`🚪 ${tr.leftEarly}`} tone={score.earlyDepartures > 0 ? "warn" : "default"} />
        <Tile value={score.missed} label={`❌ ${tr.missedShifts}`} tone={score.missed > 0 ? "bad" : "default"} />
        <Tile value={score.clockedInEarly} label={`⏰ ${tr.clockedEarly}`} tone={score.clockedInEarly > 0 ? "warn" : "default"} />
        <Tile value={longLunches} label={`🍽️ ${tr.longLunches}`} tone={longLunches > 0 ? "warn" : "default"} />
      </div>

      {notes.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.dailyNotes}</h2>
          <ul className="mt-3 flex flex-col">
            {notes.map((n) => (
              <li key={n.id} className="py-2 border-t border-zinc-100 dark:border-zinc-900 first:border-0">
                <p className="text-sm">{n.note}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {new Date(n.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "America/Chicago",
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-zinc-400 text-center">
        Graded against scheduled shifts · 5-min grace. Used for fair reviews, raises &amp; recognition.
      </p>
    </main>
  );
}
