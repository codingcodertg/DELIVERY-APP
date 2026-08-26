"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createShifts, applySchedule } from "@/app/clock-in/actions/schedule";
import { scheduleLabel, type PresetType } from "@/lib/clockin/schedule";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

type Person = { id: string; full_name: string; default_schedule?: string | null };
type Site = { id: string; name: string };

const DOW_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOW_ES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
// 0=Mon … 6=Sun for a YYYY-MM-DD date (so labels are correct for any week order).
const dowIndex = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;

export default function ShiftForm({
  people,
  sites,
  weekDates,
  lang,
}: {
  people: Person[];
  sites: Site[];
  weekDates: string[]; // 7 dates Mon..Sun of the displayed week
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const es = lang === "es";
  const dow = es ? DOW_ES : DOW_EN;
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(people[0]?.id ?? "");
  const [days, setDays] = useState<Set<string>>(new Set());
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:30");
  const [lunch, setLunch] = useState(30);
  const [lunchStart, setLunchStart] = useState("");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedType = people.find((p) => p.id === employeeId)?.default_schedule;
  const isPreset = selectedType === "A" || selectedType === "B" || selectedType === "C";

  async function doApplySchedule() {
    setBusy(true);
    setMsg(null);
    const res = await applySchedule({ employeeId });
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.message });
      return;
    }
    setMsg({ ok: true, text: tr.shiftsAdded.replace("{n}", String(res.count ?? 0)) });
    router.refresh();
  }

  function toggleDay(d: string) {
    setDays((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  }
  const setWeekdays = () => setDays(new Set(weekDates.filter((d) => dowIndex(d) < 5))); // Mon–Fri
  const clearDays = () => setDays(new Set());

  async function add() {
    if (days.size === 0) {
      setMsg({ ok: false, text: tr.pickDays });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await createShifts({
      employeeId,
      dates: weekDates.filter((d) => days.has(d)),
      start,
      end,
      lunch,
      lunchStart: lunchStart || null,
      siteId,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.message });
      return;
    }
    setDays(new Set());
    setMsg({ ok: true, text: tr.shiftsAdded.replace("{n}", String(res.count ?? 0)) });
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.addShift}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">{tr.employee}</span>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={field}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
              {p.default_schedule ? ` (${p.default_schedule})` : ""}
            </option>
          ))}
        </select>
      </label>

      {/* One-click: lay out this employee's A/B/C week */}
      {isPreset && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/10 p-3 flex flex-col gap-2">
          <p className="text-xs text-zinc-600 dark:text-zinc-300">{scheduleLabel(selectedType as PresetType, lang)}</p>
          <button type="button" onClick={doApplySchedule} disabled={busy} className={btn("primary", "sm")}>
            {busy ? "…" : tr.applySchedule.replace("{s}", selectedType as string)}
          </button>
        </div>
      )}

      <p className="text-xs text-zinc-400 text-center">{tr.orAddManually}</p>

      {/* Day picker — select any days this week (schedule a whole week at once) */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-500">{tr.days}</span>
        <div className="grid grid-cols-7 gap-1.5">
          {weekDates.map((d) => {
            const on = days.has(d);
            const dayNum = Number(d.slice(8, 10));
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`flex flex-col items-center rounded-lg border py-2 transition-colors ${
                  on
                    ? "border-emerald-500 bg-emerald-600 text-white"
                    : "border-zinc-300 dark:border-zinc-700 hover:border-emerald-400"
                }`}
              >
                <span className="text-[11px] font-medium">{dow[dowIndex(d)]}</span>
                <span className="text-sm font-semibold tabular-nums">{dayNum}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={setWeekdays} className="text-emerald-600 hover:underline">
            {tr.monFri}
          </button>
          {days.size > 0 && (
            <button type="button" onClick={clearDays} className="text-zinc-400 hover:text-zinc-600">
              {tr.clearDays}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.start}</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.end}</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.site}</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={field}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.lunchMin}</span>
          <select value={lunch} onChange={(e) => setLunch(parseInt(e.target.value, 10))} className={field}>
            <option value={0}>{tr.noLunch}</option>
            {[15, 30, 45, 60, 90].map((n) => (
              <option key={n} value={n}>
                {n} {tr.minutesWord}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs text-zinc-500">{tr.lunchStart}</span>
          <input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} className={field} />
        </label>
      </div>

      <button onClick={add} disabled={busy} className={btn("primary", "md")}>
        {busy ? tr.adding : days.size > 1 ? tr.addShiftsBtn.replace("{n}", String(days.size)) : tr.addShiftBtn}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
