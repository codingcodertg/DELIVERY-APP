"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setCustomSchedule } from "@/app/clock-in/actions/schedule";
import type { WeekPattern } from "@/lib/clockin/schedule";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

const DOW_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DOW_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
type Row = { on: boolean; start: string; end: string; lunch: number };

function initRows(pattern: WeekPattern | null | undefined): Row[] {
  return Array.from({ length: 7 }, (_, d) => {
    const p = pattern?.[String(d)];
    return p
      ? { on: true, start: p.start.slice(0, 5), end: p.end.slice(0, 5), lunch: p.lunch ?? 0 }
      : { on: false, start: "08:00", end: "16:00", lunch: 30 };
  });
}

export default function CustomScheduleEditor({
  employeeId,
  pattern,
  lang,
}: {
  employeeId: string;
  pattern: WeekPattern | null | undefined;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const dow = lang === "es" ? DOW_ES : DOW_EN;
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => initRows(pattern));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function set(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    const wp: WeekPattern = {};
    for (let d = 0; d < 7; d++) {
      const r = rows[d];
      if (r.on && r.start && r.end) wp[String(d)] = { start: r.start, end: r.end, lunch: r.lunch };
    }
    if (Object.keys(wp).length === 0) {
      setMsg({ ok: false, text: tr.pickDays });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await setCustomSchedule(employeeId, wp);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: res.message });
      return;
    }
    setMsg({ ok: true, text: tr.shiftsAdded.replace("{n}", String(res.count ?? 0)) });
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/10 p-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{tr.customWeekly}</p>
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 w-24 shrink-0 text-xs font-medium">
              <input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
              {dow[i]}
            </label>
            {r.on ? (
              <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                <input type="time" value={r.start} onChange={(e) => set(i, { start: e.target.value })} className={`${field} !py-1 !px-1.5 text-xs w-24`} />
                <span className="text-zinc-400 text-xs">–</span>
                <input type="time" value={r.end} onChange={(e) => set(i, { end: e.target.value })} className={`${field} !py-1 !px-1.5 text-xs w-24`} />
                <select value={r.lunch} onChange={(e) => set(i, { lunch: parseInt(e.target.value, 10) })} className={`${field} !py-1 !px-1.5 text-xs w-auto`}>
                  <option value={0}>{tr.noLunch}</option>
                  {[15, 30, 45, 60, 90].map((n) => (
                    <option key={n} value={n}>{n}m 🍽️</option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="text-xs text-zinc-400">{tr.dayOff}</span>
            )}
          </div>
        ))}
      </div>
      <button onClick={save} disabled={busy} className={btn("primary", "sm")}>
        {busy ? "…" : tr.saveCustom}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
