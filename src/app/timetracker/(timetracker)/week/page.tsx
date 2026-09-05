"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import {
  addWeeks, breaksText, computePay, dateISO, fmtClock, fmtDayLong, fmtTime, money,
  thisWeekStart, weekIsFinished, weekLabel, weekStartISO,
} from "@/lib/timetracker/helpers";
import type { Assignment, Session } from "@/lib/timetracker/types";

// Ported (D-066, pass 2) from timetracker-clean's employee/EmployeeWeek.jsx —
// read-only weekly timesheet + estimated pay, grouped by day. No desktop-
// only or offline-queue concerns here (it's a report, not a write path), so
// this port is closer to 1:1 than Track Time was.
export default function MyWeekPage() {
  const { myAssignments: assignments, mySessions: sessions, myPayrolls: batches, settings, ensureSessionsSince } = useData();
  const t = useT();
  const [week, setWeek] = useState(thisWeekStart());
  // G-17: the provider holds SESSIONS_WINDOW_DAYS of my sessions; paging back past that asks
  // for the older weeks on demand (idempotent).
  useEffect(() => { void ensureSessionsSince(week); }, [week, ensureSessionsSince]);
  // Re-anchor to the current week when the pay-week start / timezone changes live.
  useEffect(() => { setWeek(thisWeekStart()); }, [settings.weekStartDay, settings.timeZone]);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set([dateISO(new Date())]));
  const toggleDay = (d: string) => setOpenDays((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const aMap = new Map(assignments.map((a) => [a.id, a]));

  const weekSessions = sessions.filter((s) => weekStartISO(s.date ?? "") === week);
  const weekBatches = batches.filter((b) => b.weekOf === week);
  const paidTotal = weekBatches.filter((b) => b.paid).reduce((n, b) => n + (b.total || 0), 0);

  const isPaid = weekBatches.some((b) => b.paid);
  const finished = weekIsFinished(week, "weekly");
  const status = isPaid ? "paid" : finished ? "review" : "active";
  const statusPill = status === "paid"
    ? <span className="pill on">{t("emp.week.paidBadge")}</span>
    : status === "review"
      ? <span className="pill wait">{t("emp.week.reviewBadge")}</span>
      : <span className="pill on">{t("emp.week.activeBadge")}</span>;

  const byAssign = new Map<string, { sec: number }>();
  weekSessions.forEach((s) => {
    const aid = s.assignmentId ?? "";
    if (!byAssign.has(aid)) byAssign.set(aid, { sec: 0 });
    byAssign.get(aid)!.sec += s.durationSeconds || 0;
  });

  const byDay = new Map<string, { date: string; sec: number; items: Session[] }>();
  weekSessions.forEach((s) => {
    const d = s.date ?? "";
    if (!byDay.has(d)) byDay.set(d, { date: d, sec: 0, items: [] });
    const g = byDay.get(d)!;
    g.sec += s.durationSeconds || 0;
    g.items.push(s);
  });
  const dayGroups = Array.from(byDay.values())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((d) => ({ ...d, items: d.items.slice().sort((a, b) => (a.startMs || 0) - (b.startMs || 0)) }));

  let totalPay = 0, totalSec = 0;
  const rows = Array.from(byAssign.entries()).map(([aid, v]) => {
    const a = aMap.get(aid);
    const hours = v.sec / 3600;
    const calc = a ? computePay(hours, a) : { pay: 0, reg: 0, ot: 0, overLimit: 0 };
    totalPay += calc.pay; totalSec += v.sec;
    const proj = a ? a.project : { name: "(deleted project)" };
    return { aid, proj, sec: v.sec, calc };
  });

  const projectName = (a: Assignment | undefined) => a ? a.project.name : "—";

  return (
    <div className="card">
      <div className="between">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{t("tab.week")}</h2>
          {statusPill}
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn-ghost btn-sm" onClick={() => setWeek(addWeeks(week, -1))}>← Previous</button>
          <span className="small nowrap">{weekLabel(week)}</span>
          <button className="btn-ghost btn-sm" disabled={week >= thisWeekStart()} onClick={() => setWeek(addWeeks(week, 1))}>Next →</button>
        </div>
      </div>

      {status === "review" && !isPaid && weekSessions.length > 0 && (
        <div className="banner info" style={{ marginTop: 12 }}>{t("emp.week.reviewNote")}</div>
      )}
      {paidTotal > 0 && <div className="banner ok" style={{ marginTop: 12 }}>Paid this week: {money(paidTotal)}.</div>}

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="stat"><div className="n">{(totalSec / 3600).toFixed(2)} h</div><div className="l">Total hours</div></div>
        <div className="stat"><div className="n">{money(totalPay)}</div><div className="l">Estimated pay</div></div>
        <div className="stat"><div className="n">{money(paidTotal)}</div><div className="l">Paid so far</div></div>
      </div>

      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>No time logged this week.</p>
      ) : (
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Project</th>
              <th className="right">Hours</th>
              <th className="right">Regular</th>
              <th className="right">Overtime</th>
              <th className="right">Over limit</th>
              <th className="right">Pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.aid}>
                <td>{r.proj.name}</td>
                <td className="right nowrap">{(r.sec / 3600).toFixed(2)}</td>
                <td className="right nowrap">{r.calc.reg.toFixed(2)}</td>
                <td className="right nowrap">{r.calc.ot.toFixed(2)}</td>
                <td className="right nowrap" style={{ color: r.calc.overLimit > 0 ? "var(--tt-danger)" : "inherit" }}>{r.calc.overLimit.toFixed(2)}</td>
                <td className="right nowrap">{money(r.calc.pay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>This week&apos;s entries</h3>
      {dayGroups.length === 0 ? (
        <p className="muted small">No entries.</p>
      ) : (
        dayGroups.map((d) => {
          const open = openDays.has(d.date);
          return (
            <div key={d.date} className="box" style={{ marginTop: 8 }}>
              <div className="between" style={{ cursor: "pointer", alignItems: "center" }} onClick={() => toggleDay(d.date)}>
                <div style={{ fontWeight: 700 }}>
                  <span className="small muted" style={{ marginRight: 6 }}>{open ? "▾" : "▸"}</span>
                  {fmtDayLong(d.date)}
                  <span className="small muted" style={{ marginLeft: 6 }}>· {d.items.length} {d.items.length === 1 ? "entry" : "entries"}</span>
                </div>
                <b className="nowrap">{fmtClock(d.sec)}</b>
              </div>
              {open && (
                <table style={{ marginTop: 8 }}>
                  <thead><tr><th>In → Out</th><th>Project</th><th>Note</th><th className="right">Duration</th></tr></thead>
                  <tbody>
                    {d.items.map((s) => {
                      const a = aMap.get(s.assignmentId ?? "");
                      return (
                        <tr key={s.id}>
                          <td className="small nowrap">{s.startMs ? fmtTime(s.startMs) : "—"} → {s.endMs ? fmtTime(s.endMs) : "—"}</td>
                          <td className="small">{projectName(a)}</td>
                          <td className="small muted">
                            {s.memo || "—"}
                            {s.source === "manual" ? <span className="pill on" style={{ marginLeft: 6 }}>added</span>
                              : s.source === "adjusted" ? <span className="pill wait" style={{ marginLeft: 6 }}>adjusted</span> : null}
                            {breaksText(s) && <div className="small muted" style={{ marginTop: 2 }}>{breaksText(s)}</div>}
                          </td>
                          <td className="right nowrap small">{fmtClock(s.durationSeconds)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        {status === "active"
          ? 'Entries are grouped by day — tap a day to see its in/out times. To adjust, delete or add time, send a request from the "My requests" tab. The manager must approve it.'
          : t("emp.week.lockedNote")}
      </p>
    </div>
  );
}
