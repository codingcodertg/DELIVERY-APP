"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { addDaysISO, dateISO, fmtClock, fmtDayLong, fmtTime } from "@/lib/timetracker/helpers";
import type { Screenshot, Session } from "@/lib/timetracker/types";
import { DayActivitySummary } from "./DayActivitySummary";

// Ported (D-069) from timetracker-clean's WorkDiary.jsx — shared between the
// employee's own diary and (later) the manager's per-employee view. Upwork-
// style: a date navigator, the day's total tracked time, and screenshots
// grouped by hour (6 fixed 10-minute slots/hour), each with a segmented
// activity bar. Will stay empty until the desktop app exists (see
// ARCHITECTURE.md) — there is nothing to show yet, not a bug.
//
// D-403: con `summary` (solo desde Auditoría → Capturas de escritorio, `TeamDiary`) la cabecera
// enseña a la derecha del selector de fecha el resumen del día y las «horas bajas»
// (`DayActivitySummary`), que incluye el total de horas; el diario del propio empleado no cambia.
export function WorkDiary({ shots, sessions = [], onDelete, summary = false }: { shots: Screenshot[]; sessions?: Session[]; onDelete?: (s: Screenshot) => void; summary?: boolean }) {
  const t = useT();
  const { screenshotSignedUrl } = useData();
  const today = dateISO(new Date());
  const [date, setDate] = useState(today);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const dayShots = useMemo(
    () => shots.filter((s) => (s.date || (s.takenAt ? dateISO(new Date(s.takenAt)) : "")) === date),
    [shots, date],
  );

  useEffect(() => {
    let cancelled = false;
    const missing = dayShots.filter((s) => s.path && !urls[s.path]);
    if (!missing.length) return;
    Promise.all(missing.map(async (s) => {
      try { return [s.path as string, await screenshotSignedUrl(s.path as string, 3600)] as const; } catch { return [s.path as string, null] as const; }
    })).then((pairs) => {
      if (cancelled) return;
      setUrls((prev) => { const next = { ...prev }; pairs.forEach(([p, u]) => { if (u) next[p] = u; }); return next; });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayShots, screenshotSignedUrl]);

  const totalSec = sessions.filter((s) => s.date === date).reduce((n, s) => n + (s.durationSeconds || 0), 0);

  const byHour = new Map<number, Screenshot[]>();
  dayShots.forEach((s) => {
    const h = s.takenAt ? new Date(s.takenAt).getHours() : 0;
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(s);
  });
  // Only show hours that actually have a screenshot (real activity). An hour
  // with nothing but no-activity markers isn't "worked", so it's skipped.
  const hours = Array.from(byHour.keys()).filter((h) => byHour.get(h)!.some((s) => s.path)).sort((a, b) => a - b);
  const hourLabel = (h: number) => {
    const base = new Date(); base.setHours(h, 0, 0, 0);
    const end = new Date(base.getTime() + 3600000);
    return fmtTime(base.getTime()) + " – " + fmtTime(end.getTime());
  };
  const slotLabel = (h: number, i: number) => { const b = new Date(); b.setHours(h, i * 10, 0, 0); return fmtTime(b.getTime()); };

  return (
    <div style={{ marginTop: 8 }}>
      <div className="between box" style={{ alignItems: "center" }}>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn-ghost btn-sm" onClick={() => setDate((d) => addDaysISO(d, -1))}>←</button>
          <b className="nowrap">{fmtDayLong(date)}</b>
          <button className="btn-ghost btn-sm" disabled={date >= today} onClick={() => setDate((d) => addDaysISO(d, 1))}>→</button>
          {date !== today && <button className="link" onClick={() => setDate(today)}>{t("mgr.diary.today")}</button>}
          {summary && <DayActivitySummary key={date} shots={dayShots} totalSec={totalSec} hourLabel={hourLabel} />}
        </div>
        {!summary && <div><b>{t("mgr.diary.total")} {fmtClock(totalSec)}</b> <span className="small muted">{t("mgr.diary.hrs")}</span></div>}
      </div>

      {dayShots.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>{t("mgr.diary.noneDay")}</p>
      ) : hours.map((h) => {
        const slots: (Screenshot | null)[] = [null, null, null, null, null, null];
        byHour.get(h)!.forEach((s) => {
          const m = s.takenAt ? new Date(s.takenAt).getMinutes() : 0;
          const idx = Math.max(0, Math.min(5, Math.floor(m / 10)));
          if (!slots[idx]) slots[idx] = s;
        });
        const count = slots.filter(Boolean).length;
        return (
          <div key={h} style={{ marginTop: 14 }}>
            <div className="small muted" style={{ fontWeight: 600 }}>🟢 {hourLabel(h)} · {count} {t("mgr.diary.shots")}</div>
            <div className="slotgrid" style={{ marginTop: 8 }}>
              {slots.map((s, i) => {
                const label = slotLabel(h, i);
                if (!s) {
                  return (
                    <div key={i} className="shot" style={{ opacity: 0.75 }}>
                      <div className="shot-empty">{label}</div>
                      <div className="small muted" style={{ marginTop: 4 }}>{label} · —</div>
                    </div>
                  );
                }
                const when = s.takenAt ? fmtTime(new Date(s.takenAt).getTime()) : "…";
                if (!s.path) {
                  return (
                    <div key={i} className="shot">
                      <div className="shot-blank">{t("mgr.diary.noActivity")}</div>
                      <div className="small muted" style={{ marginTop: 4 }}>{when} · —</div>
                    </div>
                  );
                }
                const url = urls[s.path];
                const pct = Math.max(0, Math.min(100, s.activityPercent || 0));
                const filled = Math.round(pct / 10);
                return (
                  <div key={i} className="shot">
                    <a href={url || undefined} target="_blank" rel="noopener noreferrer">
                      {url ? <img src={url} loading="lazy" alt="screenshot" /> : <div className="shot-loading" />}
                    </a>
                    <div className="meter" title={t("mgr.diary.activityTitle", { pct })} style={{ marginTop: 4 }}>
                      {Array.from({ length: 10 }).map((_, j) => <i key={j} className={j < filled ? "on" : ""} />)}
                    </div>
                    <div className="small muted">{when} · {pct}%</div>
                    {onDelete && (
                      <button className="btn-danger btn-sm" style={{ width: "100%", marginTop: 4, padding: "2px 6px" }} onClick={() => onDelete(s)}>{t("mgr.diary.delete")}</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
