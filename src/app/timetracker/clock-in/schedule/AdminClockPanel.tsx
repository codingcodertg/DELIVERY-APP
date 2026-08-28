"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminClock } from "@/app/timetracker/clock-in/actions/clock";
import { t, type Lang } from "@/lib/clockin/i18n";
import { field } from "@/lib/clockin/ui";

type Person = { id: string; full_name: string };

export default function AdminClockPanel({ people, lang }: { people: Person[]; lang: Lang }) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(people[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go(action: "in" | "out") {
    if (!reason.trim()) {
      setMsg({ ok: false, text: tr.clockReasonNeeded });
      return;
    }
    setBusy(action);
    setMsg(null);
    const res = await adminClock({ employeeId, action, reason });
    setBusy(null);
    if (!res.ok) {
      setMsg({ ok: false, text: res.message });
      return;
    }
    setReason("");
    setMsg({ ok: true, text: res.action === "in" ? tr.clockedInBehalf : tr.clockedOutBehalf });
    router.refresh();
  }

  if (people.length === 0) return null;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.clockSomeoneIn}</h2>
        <p className="mt-0.5 text-xs text-zinc-400">{tr.clockSomeoneHint}</p>
      </div>
      <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={field}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={tr.clockReasonPh}
        className={field}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => go("in")}
          disabled={busy !== null}
          className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
        >
          {busy === "in" ? "…" : `🟢 ${tr.clockInBtn}`}
        </button>
        <button
          onClick={() => go("out")}
          disabled={busy !== null}
          className="min-h-[44px] rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
        >
          {busy === "out" ? "…" : `🔴 ${tr.clockOutBtn}`}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
