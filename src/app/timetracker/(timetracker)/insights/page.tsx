"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { addWeeks, computePay, fmtISOday, money, thisWeekStart, weekStartISO } from "@/lib/timetracker/helpers";
import type { Session } from "@/lib/timetracker/types";

const WEEKS = 8;

// Ported (D-070) from timetracker-clean's manager/Insights.jsx — the
// manager dashboard: headline KPIs, an 8-week hours trend, a sortable
// per-employee table, and top projects. First manager-only screen: reads
// `allEmployees`/`allProjects`/`allAssignments` (reference data, kept live
// by the provider) plus `sessionsSince()` (an on-demand company-wide query
// — see the provider's block comment on why sessions aren't bulk-loaded
// the way `mySessions` safely is for one employee).
export default function InsightsPage() {
  const { me, allEmployees: users, allProjects: projects, allAssignments: assignments, sessionsSince } = useData();
  const t = useT();

  // Hooks below must run unconditionally (Rules of Hooks) — the admin gate
  // is applied to the JSX return at the bottom instead. sessionsSince()
  // already no-ops for a non-admin (the provider guards it), so nothing
  // here does real work for someone who fails the check.
  const startISO = addWeeks(thisWeekStart(), -(WEEKS - 1));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sort, setSort] = useState<{ key: "name" | "hours" | "activity" | "cost"; dir: "asc" | "desc" }>({ key: "hours", dir: "desc" });
  useEffect(() => { sessionsSince(startISO).then(setSessions); }, [startISO, sessionsSince]);

  const uMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const pMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const aMap = useMemo(() => new Map(assignments.map((a) => [a.id, a])), [assignments]);
  const thisWk = thisWeekStart();

  const weekKeys = Array.from({ length: WEEKS }, (_, i) => addWeeks(startISO, i));
  const weekHours = new Map(weekKeys.map((w) => [w, 0]));
  sessions.forEach((s) => { const w = weekStartISO(s.date ?? ""); if (weekHours.has(w)) weekHours.set(w, weekHours.get(w)! + (s.durationSeconds || 0) / 3600); });
  const trend = weekKeys.map((w) => ({ w, hours: weekHours.get(w) ?? 0 }));

  const wk = sessions.filter((s) => weekStartISO(s.date ?? "") === thisWk);
  const byEmp = new Map<string, { sec: number; active: number; byWeekAssign: Map<string, number> }>();
  wk.forEach((s) => {
    const uid = s.employeeUid;
    if (!byEmp.has(uid)) byEmp.set(uid, { sec: 0, active: 0, byWeekAssign: new Map() });
    const e = byEmp.get(uid)!;
    e.sec += s.durationSeconds || 0;
    e.active += s.activeSeconds || 0;
    const aid = s.assignmentId ?? "";
    e.byWeekAssign.set(aid, (e.byWeekAssign.get(aid) ?? 0) + (s.durationSeconds || 0));
  });
  const empRows = Array.from(byEmp.entries()).map(([uid, e]) => {
    let cost = 0;
    e.byWeekAssign.forEach((sec, aid) => { const a = aMap.get(aid); if (a) cost += computePay(sec / 3600, a).pay; });
    return {
      uid, name: uMap.get(uid)?.fullName || "—",
      hours: e.sec / 3600,
      activity: e.sec > 0 ? Math.round((e.active / e.sec) * 100) : 0,
      cost,
    };
  });

  const totalHours = empRows.reduce((n, r) => n + r.hours, 0);
  const totalCost = empRows.reduce((n, r) => n + r.cost, 0);
  const avgActivity = empRows.length ? Math.round(empRows.reduce((n, r) => n + r.activity * r.hours, 0) / (totalHours || 1)) : 0;

  function hoursAndCost(list: Session[]) {
    let sec = 0; const byA = new Map<string, number>();
    list.forEach((s) => { sec += s.durationSeconds || 0; const aid = s.assignmentId ?? ""; byA.set(aid, (byA.get(aid) ?? 0) + (s.durationSeconds || 0)); });
    let cost = 0;
    byA.forEach((sc, aid) => { const a = aMap.get(aid); if (a) cost += computePay(sc / 3600, a).pay; });
    return { hours: sec / 3600, cost };
  }
  const lastWkStart = addWeeks(thisWk, -1);
  const lastWk = hoursAndCost(sessions.filter((s) => weekStartISO(s.date ?? "") === lastWkStart));
  const now = new Date();
  const monthKey = (d: string | null) => String(d).slice(0, 7);
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthD.getFullYear()}-${String(lastMonthD.getMonth() + 1).padStart(2, "0")}`;
  const thisMo = hoursAndCost(sessions.filter((s) => monthKey(s.date) === thisMonth));
  const lastMo = hoursAndCost(sessions.filter((s) => monthKey(s.date) === lastMonth));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthEnding = now.getDate() > daysInMonth - 3;

  const sorted = empRows.slice().sort((a, b) => {
    const d = sort.dir === "asc" ? 1 : -1;
    if (sort.key === "name") return d * a.name.localeCompare(b.name);
    return d * (a[sort.key] - b[sort.key]);
  });
  const maxHours = Math.max(1, ...empRows.map((r) => r.hours));

  const byProj = new Map<string, number>();
  wk.forEach((s) => { const pid = s.projectId ?? ""; byProj.set(pid, (byProj.get(pid) ?? 0) + (s.durationSeconds || 0) / 3600); });
  const projRowsAll = Array.from(byProj.entries()).map(([id, h]) => ({ name: pMap.get(id)?.name || "(deleted)", hours: h })).sort((a, b) => b.hours - a.hours);
  const topProj = projRowsAll.slice(0, 6);
  const otherProj = projRowsAll.slice(6).reduce((n, r) => n + r.hours, 0);
  if (otherProj > 0) topProj.push({ name: t("mgr.ins.other"), hours: otherProj });
  const maxProj = Math.max(1, ...topProj.map((r) => r.hours));

  const hdr = (key: "name" | "hours" | "activity" | "cost", label: string, right?: boolean) => (
    <th className={right ? "right" : ""} style={{ cursor: "pointer" }} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}>
      {label}{sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
    </th>
  );
  const actColor = (p: number) => (p >= 60 ? "var(--tt-accent2)" : p >= 25 ? "var(--tt-warn)" : "var(--tt-danger)");

  if (me.role !== "admin") return <div className="card"><p className="muted">{t("common.adminsOnly")}</p></div>;

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="n">{totalHours.toFixed(1)} h</div><div className="l">{t("mgr.ins.hoursWeek")}</div></div>
        <div className="stat"><div className="n">{money(totalCost)}</div><div className="l">{t("mgr.ins.payWeek")}</div></div>
        <div className="stat"><div className="n">{empRows.length}</div><div className="l">{t("mgr.ins.people")}</div></div>
        <div className="stat"><div className="n">{avgActivity}%</div><div className="l">{t("mgr.ins.avgAct")}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>{t("mgr.ins.compare")}</h2>
        <div className="grid g2">
          <CompareBlock label={t("mgr.ins.vsLastWeek")} now={{ hours: totalHours, cost: totalCost }} prev={lastWk} t={t} />
          <CompareBlock
            label={monthEnding ? t("mgr.ins.monthReview") : t("mgr.ins.vsLastMonth")}
            now={thisMo} prev={lastMo} t={t} highlight={monthEnding}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>{t("mgr.ins.perWeek")} <span className="small muted">{t("mgr.ins.lastWeeks", { n: WEEKS })}</span></h2>
        <TrendChart data={trend} />
      </div>

      <div className="card">
        <div className="between"><h2 style={{ margin: 0 }}>{t("mgr.ins.empWeek")}</h2><span className="small muted">{t("mgr.ins.tracking", { n: empRows.length })}</span></div>
        {empRows.length === 0 ? <p className="muted" style={{ marginTop: 10 }}>{t("mgr.ins.noTime")}</p> : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table>
              <thead><tr>{hdr("name", t("mgr.ins.colEmp"))}{hdr("hours", t("mgr.ins.colHours"), true)}<th>{t("mgr.ins.colLoad")}</th>{hdr("activity", t("mgr.ins.colActivity"), true)}{hdr("cost", t("mgr.ins.colPay"), true)}</tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.uid}>
                    <td className="nowrap">{r.name}</td>
                    <td className="right nowrap">{r.hours.toFixed(2)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div style={{ background: "var(--tt-line)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                        <div style={{ width: (r.hours / maxHours) * 100 + "%", height: "100%", background: "var(--tt-accent)" }} />
                      </div>
                    </td>
                    <td className="right nowrap"><span style={{ color: actColor(r.activity), fontWeight: 700 }}>{r.activity}%</span></td>
                    <td className="right nowrap">{money(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>{t("mgr.ins.topProj")}</h2>
        {topProj.length === 0 ? <p className="muted">{t("mgr.ins.noProj")}</p> : topProj.map((r) => (
          <div key={r.name} style={{ margin: "8px 0" }}>
            <div className="small" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{r.name}</span><span className="muted">{r.hours.toFixed(1)} h</span>
            </div>
            <div style={{ background: "var(--tt-line)", borderRadius: 6, height: 10, overflow: "hidden", marginTop: 2 }}>
              <div style={{ width: (r.hours / maxProj) * 100 + "%", height: "100%", background: "var(--tt-accent2)" }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CompareBlock({ label, now, prev, t, highlight }: { label: string; now: { hours: number; cost: number }; prev: { hours: number; cost: number }; t: ReturnType<typeof useT>; highlight?: boolean }) {
  return (
    <div className="box" style={highlight ? { borderColor: "var(--tt-accent)" } : undefined}>
      <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div className="between" style={{ alignItems: "baseline" }}>
        <div><div className="n" style={{ fontSize: 22, fontWeight: 800 }}>{now.hours.toFixed(1)} h</div><div className="l small muted">{t("mgr.ins.hours")}</div></div>
        <Delta now={now.hours} prev={prev.hours} />
      </div>
      <div className="between" style={{ alignItems: "baseline", marginTop: 8 }}>
        <div><div className="n" style={{ fontSize: 22, fontWeight: 800 }}>{money(now.cost)}</div><div className="l small muted">{t("mgr.ins.pay")}</div></div>
        <Delta now={now.cost} prev={prev.cost} />
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>{t("mgr.ins.prev")}: {prev.hours.toFixed(1)} h · {money(prev.cost)}</div>
    </div>
  );
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev || prev <= 0) return <span className="pill" style={{ opacity: 0.7 }}>new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className="small" style={{ color: up ? "var(--tt-accent2)" : "var(--tt-danger)", fontWeight: 800 }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

// Compact 8-week hours trend: area + line + end dot.
function TrendChart({ data }: { data: { w: string; hours: number }[] }) {
  const W = 720, H = 160, padL = 8, padR = 8, padT = 12, padB = 22;
  const max = Math.max(1, ...data.map((d) => d.hours));
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const pts = data.map((d, i) => [x(i), y(d.hours)] as const);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = `M ${x(0).toFixed(1)} ${(H - padB).toFixed(1)} ` + pts.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") + ` L ${x(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="tt-trendfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--tt-accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--tt-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tt-trendfill)" />
      <path d={line} fill="none" stroke="var(--tt-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill="var(--tt-accent)" />
          <text x={p[0]} y={H - 6} fontSize="10" fill="var(--tt-muted)" textAnchor="middle">{fmtISOday(data[i].w)}</text>
          {data[i].hours > 0 && <text x={p[0]} y={p[1] - 6} fontSize="10" fill="var(--tt-txt)" textAnchor="middle">{data[i].hours.toFixed(0)}</text>}
        </g>
      ))}
    </svg>
  );
}
