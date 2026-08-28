"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addEntry, deleteEntry, editEntry } from "@/app/timetracker/clock-in/actions/reports";
import { entryMinutes, hrs, type PayEntry } from "@/lib/clockin/payroll";
import { utcToCentralInput } from "@/lib/clockin/tz";
import { btn, field } from "@/lib/clockin/ui";
import { t, type Lang } from "@/lib/clockin/i18n";

const LUNCH_OPTS = [0, 15, 30, 45, 60, 90];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

type Draft = { clockIn: string; clockOut: string; lunch: number; note: string };

export default function EmployeeEntries({
  employeeId,
  entries,
  periodStart,
  locked,
  lang,
}: {
  employeeId: string;
  entries: PayEntry[];
  periodStart: string;
  locked: boolean;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ clockIn: "", clockOut: "", lunch: 0, note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit(e: PayEntry) {
    setErr(null);
    setAdding(false);
    setEditing(e.id);
    setDraft({
      clockIn: utcToCentralInput(e.clock_in_at),
      clockOut: e.clock_out_at ? utcToCentralInput(e.clock_out_at) : "",
      lunch: e.lunch_minutes ?? 0,
      note: e.edit_note ?? "",
    });
  }
  function startAdd() {
    setErr(null);
    setEditing(null);
    setAdding(true);
    setDraft({ clockIn: `${periodStart}T08:00`, clockOut: `${periodStart}T16:30`, lunch: 30, note: "" });
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setErr(null);
    const res = await editEntry({
      id,
      clockIn: draft.clockIn,
      clockOut: draft.clockOut || null,
      lunch: draft.lunch,
      note: draft.note || undefined,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.message);
    setEditing(null);
    router.refresh();
  }
  async function saveAdd() {
    if (!draft.clockIn || !draft.clockOut) return setErr(tr.needBothTimes);
    setBusy(true);
    setErr(null);
    const res = await addEntry({
      employeeId,
      clockIn: draft.clockIn,
      clockOut: draft.clockOut,
      lunch: draft.lunch,
      note: draft.note || undefined,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.message);
    setAdding(false);
    router.refresh();
  }
  async function remove(id: string) {
    if (!confirm(tr.confirmDelete)) return;
    setBusy(true);
    await deleteEntry(id);
    setBusy(false);
    router.refresh();
  }

  function DraftForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
    return (
      <div className="mt-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/10 p-3 flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{tr.clockInLabel}</span>
            <input
              type="datetime-local"
              value={draft.clockIn}
              onChange={(e) => setDraft({ ...draft, clockIn: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{tr.clockOutLabel}</span>
            <input
              type="datetime-local"
              value={draft.clockOut}
              onChange={(e) => setDraft({ ...draft, clockOut: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{tr.lunchMin}</span>
            <select
              value={draft.lunch}
              onChange={(e) => setDraft({ ...draft, lunch: parseInt(e.target.value, 10) })}
              className={field}
            >
              {LUNCH_OPTS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? tr.noLunch : `${n} ${tr.minutesWord}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">{tr.editNote}</span>
            <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={field} />
          </label>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onSave} disabled={busy} className={btn("primary", "sm")}>
            {busy ? "…" : tr.save}
          </button>
          <button onClick={onCancel} disabled={busy} className={btn("neutral", "sm")}>
            {tr.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {entries.length === 0 && !adding && <p className="text-sm text-zinc-400">{tr.emptyPunches}</p>}
      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <li key={e.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm">
                <span className="font-medium">{fmtDate(e.clock_in_at)}</span>
                <span className="text-zinc-500">
                  {" "}
                  · {fmtTime(e.clock_in_at)} – {e.clock_out_at ? fmtTime(e.clock_out_at) : tr.stillOpen}
                </span>
                {/* Lunch from that day: the emoji + the actual punch time and how
                    long it was. Falls back to just the minutes if there's no
                    punch (e.g. a manually-entered lunch). */}
                {e.lunch_windows && e.lunch_windows.length > 0 ? (
                  e.lunch_windows.map((w, wi) => (
                    <span key={wi} className="text-zinc-400">
                      {" "}· 🍽️ {fmtTime(w.left)}–{fmtTime(w.returned)} ({Math.round((new Date(w.returned).getTime() - new Date(w.left).getTime()) / 60000)}m)
                    </span>
                  ))
                ) : e.lunch_minutes ? (
                  <span className="text-zinc-400"> · 🍽️ {e.lunch_minutes}m</span>
                ) : null}
                {e.manual ? (
                  <span className="ml-1.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-xs px-1.5 py-0.5">
                    {tr.badgeManual}
                  </span>
                ) : e.status === "edited" ? (
                  <span className="ml-1.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 text-xs px-1.5 py-0.5">
                    {tr.badgeEdited}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums">
                  {e.clock_out_at ? `${hrs(entryMinutes(e))} h` : "—"}
                </span>
                {!locked && (
                  <>
                    <button onClick={() => startEdit(e)} className="text-xs text-emerald-600 hover:underline">
                      {tr.edit}
                    </button>
                    <button onClick={() => remove(e.id)} className="text-xs text-zinc-400 hover:text-red-600">
                      {tr.delete}
                    </button>
                  </>
                )}
              </div>
            </div>
            {e.edit_note && <p className="mt-1 text-xs text-zinc-500 italic">“{e.edit_note}”</p>}
            {editing === e.id && <DraftForm onSave={() => saveEdit(e.id)} onCancel={() => setEditing(null)} />}
          </li>
        ))}
      </ul>

      {adding && <DraftForm onSave={saveAdd} onCancel={() => setAdding(false)} />}

      {!locked && !adding && (
        <button onClick={startAdd} className="mt-2 text-sm text-emerald-600 hover:underline font-medium">
          + {tr.addPunch}
        </button>
      )}
    </div>
  );
}
