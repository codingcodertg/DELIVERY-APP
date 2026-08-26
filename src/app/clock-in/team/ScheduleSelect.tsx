"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeSchedule } from "@/app/clock-in/actions/team";
import { scheduleLabel } from "@/lib/clockin/schedule";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function ScheduleSelect({
  employeeId,
  schedule,
  lang,
}: {
  employeeId: string;
  schedule: string | null;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function change(value: string) {
    setBusy(true);
    setNote(null);
    const res = await setEmployeeSchedule(employeeId, value || null);
    setBusy(false);
    if (res.ok && "shiftsCreated" in res && (res.shiftsCreated ?? 0) > 0) {
      setNote(`✓ ${res.shiftsCreated}`);
    } else if (res.ok && value === "custom") {
      setNote(tr.customHint);
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={schedule ?? ""}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        title={tr.scheduleType}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs disabled:opacity-60"
      >
        <option value="">{tr.noSchedule}</option>
        {(["A", "B", "C"] as const).map((k) => (
          <option key={k} value={k}>
            {scheduleLabel(k, lang)}
          </option>
        ))}
        <option value="custom">{tr.customSchedule}</option>
      </select>
      {note && <span className="text-[11px] text-emerald-600 whitespace-nowrap">{note}</span>}
    </div>
  );
}
