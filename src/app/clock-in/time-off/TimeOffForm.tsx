"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitTimeOff } from "@/app/clock-in/actions/timeoff";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

const TYPES = ["vacation", "sick", "schedule_change", "shift_swap"] as const;

export default function TimeOffForm({ lang, defaultDate }: { lang: Lang; defaultDate: string }) {
  const tr = t(lang);
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]>("vacation");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const res = await submitTimeOff({ type, startDate, endDate, note: note || undefined });
    setBusy(false);
    if (!res.ok) {
      setMsg({ text: res.message, ok: false });
      return;
    }
    setMsg({ text: tr.submitted, ok: true });
    setNote("");
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.requestTimeOff}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs text-zinc-500">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={field}>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {tr.timeOffTypes[ty]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.startDate}</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.endDate}</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs text-zinc-500">{tr.optionalNote}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
      </div>
      <button onClick={submit} disabled={busy} className={btn("primary", "md")}>
        {busy ? "…" : tr.submit}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
