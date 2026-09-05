"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import {
  APP_SETTINGS, LOCALE, breaksText, computePay, dateISO, fmtClock, fmtDT, fmtHM,
  money, periodEndISO, periodLabel, projectWeekStart, weekIsFinished, weekStartISO,
} from "@/lib/timetracker/helpers";
import type { Assignment, Employee, Payroll, PayrollAdjustment, Session } from "@/lib/timetracker/types";
import { isOverlapError } from "@/lib/timetracker/overlap";

// Ported (D-071) from timetracker-clean's manager/ManagerReports.jsx — the
// biggest and highest-stakes screen in the app: it computes and records
// real payroll. Translated as literally as possible, not redesigned, for
// the same reason as Track Time (D-066) — this logic has years of
// production bug-fixes already baked in.
//
// One real gap, not silently dropped: Excel/PDF export (lib/
// exportTimesheet.js) isn't ported. That's a separate library the original
// dynamically imports; CSV export (plain, no extra dependency) IS ported
// and covers the same data. Receipt printing (the browser's own print
// dialog) needs no library and IS ported as-is.
const tParse = (t: string): number => { if (!t) return 0; const p = String(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); };
function hhmm(ms: number | null): string {
  if (!ms) return "";
  try { return new Intl.DateTimeFormat("en-US", { timeZone: APP_SETTINGS.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)); }
  catch { return ""; }
}
function fromRange(date: string, from: string, to: string) {
  let d = tParse(to) - tParse(from); if (d < 0) d += 1440;
  const durationSeconds = d * 60;
  const ft = String(from).length === 5 ? from : "0" + from;
  const startMs = new Date(date + "T" + ft + ":00").getTime();
  return { durationSeconds, startMs, endMs: startMs + durationSeconds * 1000 };
}
const paidAtMs = (b: Payroll | null) => (b && b.paidAt ? new Date(b.paidAt).getTime() : 0);
const adjOf = (list: PayrollAdjustment[] | null | undefined) => (list || []).reduce((n, a) => n + Number(a.amount || 0), 0);

/**
 * Informes y pago, ahora DENTRO de Nómina (D-164).
 *
 * Era una pestaña aparte de la barra, al lado de Nómina, y eran la misma pregunta partida en
 * dos: cuánto se le paga a quién por este periodo. Con dos pantallas separadas había que
 * mover dos calendarios y fiarse de que apuntaran al mismo sitio.
 *
 * El código no se ha reescrito al mudarlo —sigue siendo la traducción literal de
 * `manager/ManagerReports.jsx`, con años de correcciones dentro—. D-164 le dejó su propio
 * selector de periodo a conciencia, porque cambiar la fuente de la fecha en la misma tanda
 * que la mudanza "es como se rompe una nómina". Ese cambio es este, aparte y solo (D-190):
 * **la fecha llega por `period` (el `?period=` de la URL, un viernes) y aquí no hay
 * calendario.** Lo único que cambió es de dónde sale `week`; el cálculo es el mismo.
 */
export function ManagerReports({ period }: { period: string }) {
  const {
    me, allEmployees: users, allProjects: projects, allAssignments: assignments, settings,
    sessionsSince, payrollsForWeek, insertSession, updateSession, removeSession,
    insertPayroll, updatePayroll, removePayroll, logAudit,
  } = useData();
  const t = useT();
  const payPeriod = settings.payPeriod || "weekly";
  const week = period;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [batches, setBatches] = useState<Payroll[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ emp: Employee | undefined; batch: Payroll; lines: ReturnType<typeof calcLinesFor>["lines"]; adjustments: PayrollAdjustment[]; total: number } | null>(null);
  const adjTypes = settings.adjustmentTypes || ["Bonus", "Advance", "Deduction"];
  const [adjType, setAdjType] = useState(adjTypes[0]);
  const [adjAmount, setAdjAmount] = useState("");
  const [sa, setSa] = useState({ uid: "", type: adjTypes[0], amount: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [ed, setEd] = useState({ date: "", from: "", to: "" });
  const [addUid, setAddUid] = useState<string | null>(null);
  const [nadd, setNadd] = useState({ assignmentId: "", date: "", from: "", to: "" });

  const start = week, end = periodEndISO(week, payPeriod);
  useEffect(() => { sessionsSince(start, end).then(setSessions); }, [start, end, sessionsSince]);
  useEffect(() => { payrollsForWeek(week).then(setBatches); }, [week, payrollsForWeek]);

  const uMap = new Map(users.map((u) => [u.id, u]));
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const aMap = new Map(assignments.map((a) => [a.id, a]));

  const drafts = batches.filter((b) => b.draft);
  const draftMap = new Map(drafts.map((d) => [d.employeeUid, d]));
  const realBatches = batches.filter((b) => !b.draft);
  const batchMap = new Map(realBatches.map((b) => [b.id, b]));

  function calcLinesFor(sess: Session[]) {
    const byA = new Map<string, { sec: number; active: number; weeks: Map<string, number> }>();
    sess.forEach((s) => {
      const aid = s.assignmentId ?? "";
      if (!byA.has(aid)) byA.set(aid, { sec: 0, active: 0, weeks: new Map() });
      const g = byA.get(aid)!;
      g.sec += s.durationSeconds || 0;
      g.active += s.activeSeconds || 0;
      const proj = pMap.get(aMap.get(aid)?.projectId ?? "");
      const w = weekStartISO(s.date ?? "", projectWeekStart(proj));
      g.weeks.set(w, (g.weeks.get(w) ?? 0) + (s.durationSeconds || 0));
    });
    let pay = 0, sec = 0;
    const lines = Array.from(byA.entries()).map(([aid, g]) => {
      const a = aMap.get(aid);
      let reg = 0, ot = 0, p = 0, overLimit = 0;
      g.weeks.forEach((wsec) => {
        const c = a ? computePay(wsec / 3600, a) : { pay: 0, reg: 0, ot: 0, overLimit: 0 };
        reg += c.reg; ot += c.ot; p += c.pay; overLimit += c.overLimit;
      });
      pay += p; sec += g.sec;
      return { aid, a, g: { sec: g.sec, active: g.active }, calc: { reg, ot, pay: p, overLimit } };
    });
    return { lines, pay, sec };
  }

  const weekSessions = sessions.filter((s) => (s.date ?? "") >= start && (s.date ?? "") <= end);
  const byEmp = new Map<string, Map<string, Session[]>>();
  weekSessions.forEach((s) => {
    const bk = s.payrollId || "live";
    if (!byEmp.has(s.employeeUid)) byEmp.set(s.employeeUid, new Map());
    const g = byEmp.get(s.employeeUid)!;
    if (!g.has(bk)) g.set(bk, []);
    g.get(bk)!.push(s);
  });
  const draftUids = drafts.filter((d) => (d.adjustments || []).length).map((d) => d.employeeUid);
  const allUids = Array.from(new Set([...Array.from(byEmp.keys()), ...draftUids]));
  let grandPay = 0, grandSec = 0;
  byEmp.forEach((groups) => groups.forEach((sess) => { const c = calcLinesFor(sess); grandPay += c.pay; grandSec += c.sec; }));

  async function addAdjustment(uid: string, type: string, amount: string) {
    if (!uid || !type || amount === "") return;
    const emp = uMap.get(uid);
    const draft = draftMap.get(uid);
    const list = [...(draft ? draft.adjustments || [] : []), { label: type, amount: Number(amount) }];
    try {
      if (draft) await updatePayroll(draft.id, { adjustments: list });
      else await insertPayroll({ employeeUid: uid, employeeName: emp ? emp.fullName : "", weekOf: week, draft: true, paid: false, adjustments: list });
      await logAudit("Adjustment added", (emp ? emp.fullName : "") + " · " + type + " " + money(Number(amount)));
      payrollsForWeek(week).then(setBatches);
    } catch (e) { const err = e as { message?: string } | null; alert(t("mgr.rep.addFail", { e: err?.message || "unknown error" })); }
  }
  async function removeAdjustment(uid: string, idx: number) {
    const draft = draftMap.get(uid);
    if (!draft) return;
    const list = (draft.adjustments || []).filter((_, i) => i !== idx);
    try { await updatePayroll(draft.id, { adjustments: list }); payrollsForWeek(week).then(setBatches); }
    catch (e) { const err = e as { message?: string } | null; alert(t("mgr.rep.removeFail", { e: err?.message || "unknown error" })); }
  }
  async function markPaid(uid: string, sess: Session[], pay: number) {
    const draft = draftMap.get(uid);
    const adjustments = draft ? draft.adjustments || [] : [];
    if (!sess.length && !adjustments.length) return;
    setBusy(true);
    try {
      const emp = uMap.get(uid);
      const first = sess[0] ? aMap.get(sess[0].assignmentId ?? "") : undefined;
      const method = (first && first.paymentMethod) || (emp && emp.payMethod) || "";
      const row = await insertPayroll({
        employeeUid: uid, employeeName: emp ? emp.fullName : "", weekOf: week,
        total: Number(pay.toFixed(2)), adjustments, method: method || null, paid: true,
        paidAt: new Date().toISOString(), paidBy: me.id, sessionCount: sess.length, draft: false,
      });
      if (sess.length) await Promise.all(sess.map((s) => updateSession(s.id, { payrollId: row.id })));
      if (draft) await removePayroll(draft.id);
      await logAudit("Marked paid", (emp ? emp.fullName : "") + " · " + money(Number(pay.toFixed(2)) + adjOf(adjustments)));
      sessionsSince(start, end).then(setSessions);
      payrollsForWeek(week).then(setBatches);
    } catch (e) { const err = e as { message?: string } | null; alert(t("mgr.rep.paidFail", { e: err?.message || "unknown error" })); }
    finally { setBusy(false); }
  }
  async function toggleBatch(b: Payroll) {
    try {
      await updatePayroll(b.id, { paid: !b.paid, paidAt: b.paid ? null : new Date().toISOString() });
      await logAudit(b.paid ? "Marked unpaid" : "Marked paid", (b.employeeName || "") + " · " + money(b.total || 0));
      payrollsForWeek(week).then(setBatches);
    } catch (e) { const err = e as { message?: string } | null; alert(t("mgr.rep.updateFail", { e: err?.message || "unknown error" })); }
  }
  async function reopen(b: Payroll, sess: Session[]) {
    if (!confirm(t("mgr.rep.reopenConfirm"))) return;
    setBusy(true);
    try {
      if (sess.length) await Promise.all(sess.map((s) => updateSession(s.id, { payrollId: null })));
      await removePayroll(b.id);
      await logAudit("Payment reopened", b.employeeName || "");
      sessionsSince(start, end).then(setSessions);
      payrollsForWeek(week).then(setBatches);
    } catch (e) { const err = e as { message?: string } | null; alert(t("mgr.rep.reopenFail", { e: err?.message || "unknown error" })); }
    finally { setBusy(false); }
  }

  async function saveEditEntry(x: Session) {
    if (!ed.from || !ed.to) return;
    const d = fromRange(ed.date, ed.from, ed.to);
    try {
      await updateSession(x.id, { date: ed.date, weekOf: weekStartISO(ed.date), startMs: d.startMs, endMs: d.endMs, durationSeconds: d.durationSeconds, source: "adjusted" });
      await logAudit("Entry adjusted", (uMap.get(x.employeeUid)?.fullName || "") + " · " + ed.date + " · " + ed.from + "-" + ed.to);
      setEditId(null);
      sessionsSince(start, end).then(setSessions);
    } catch (e) {
      // 082: el tramo pisa otro ya fichado. Decirlo, no soltar el error de Postgres.
      if (isOverlapError(e)) { alert(t("track.overlap")); return; }
      const err = e as { message?: string } | null; alert(t("mgr.rep.saveFail", { e: err?.message || "unknown error" }));
    }
  }
  async function addManualEntry(uid: string) {
    if (!nadd.assignmentId || !nadd.from || !nadd.to) { alert(t("mgr.rep.addPrompt")); return; }
    const a = aMap.get(nadd.assignmentId);
    if (!a) return;
    const emp = uMap.get(uid);
    const d = fromRange(nadd.date, nadd.from, nadd.to);
    try {
      await insertSession({
        employeeUid: uid, employeeName: emp ? emp.fullName : "", projectId: a.projectId, assignmentId: a.id,
        memo: "[Manual]", weekOf: weekStartISO(nadd.date), date: nadd.date, startMs: d.startMs, endMs: d.endMs,
        durationSeconds: d.durationSeconds, activeSeconds: 0, keystrokes: 0, clicks: 0, lunchSeconds: 0, breakSeconds: 0,
        breakEvents: [], manual: true, source: "manual", isLive: false,
      });
      await logAudit("Entry added (manual)", (emp ? emp.fullName : "") + " · " + nadd.date + " · " + nadd.from + "-" + nadd.to);
      setAddUid(null); setNadd({ assignmentId: "", date: "", from: "", to: "" });
      sessionsSince(start, end).then(setSessions);
    } catch (e) {
      if (isOverlapError(e)) { alert(t("track.overlap")); return; }
      const err = e as { message?: string } | null; alert("Could not add: " + (err?.message || "unknown error"));
    }
  }
  async function deleteEntry(s: Session) {
    if (!confirm(t("mgr.rep.delEntryConfirm"))) return;
    await removeSession(s.id);
    await logAudit("Entry deleted", (uMap.get(s.employeeUid)?.fullName || "") + " · " + s.date);
    sessionsSince(start, end).then(setSessions);
  }

  const csvEscape = (v: unknown) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportCSV() {
    const rows: unknown[][] = [["Employee", "Group", "Status", "Project", "Location", "Hours", "Regular h", "OT h", "Pay", "Adjustments", "Group total", "Method", "Week"]];
    empIds.forEach((uid) => {
      const emp = uMap.get(uid);
      const groups = new Map(byEmp.get(uid) ?? []);
      if (!groups.has("live")) groups.set("live", []);
      groups.forEach((sess, k) => {
        const b = k === "live" ? null : batchMap.get(k) ?? null;
        const { lines, pay } = calcLinesFor(sess);
        const adjs = b ? b.adjustments || [] : draftMap.get(uid) ? draftMap.get(uid)!.adjustments || [] : [];
        const adj = adjOf(adjs);
        const status = b ? (b.paid ? "Paid" : "Closed-unpaid") : "Open";
        const total = (b ? b.total || 0 : pay) + adj;
        lines.forEach((l) => {
          const proj = l.a && pMap.get(l.a.projectId) ? pMap.get(l.a.projectId)! : { name: "(deleted)", location: "" };
          rows.push([emp ? emp.fullName : "", b ? "Payment" : "Current", status, proj.name, proj.location || "", (l.g.sec / 3600).toFixed(2), l.calc.reg.toFixed(2), l.calc.ot.toFixed(2), l.calc.pay.toFixed(2), adj.toFixed(2), total.toFixed(2), (b && b.method) || "", periodLabel(week, payPeriod)]);
        });
        adjs.forEach((ad) => rows.push([emp ? emp.fullName : "", b ? "Payment" : "Current", status, ad.label, "", "", "", "", ad.amount, "", "", (b && b.method) || "", periodLabel(week, payPeriod)]));
      });
    });
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "timesheet_" + week + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function openReceipt(uid: string, b: Payroll, sess: Session[]) {
    const emp = uMap.get(uid);
    const { lines, pay } = calcLinesFor(sess);
    const adjs = b.adjustments || [];
    setReceipt({ emp, batch: b, lines, adjustments: adjs, total: (b.total || pay) + adjOf(adjs) });
  }

  function renderGroup(uid: string, key: string, sess: Session[]) {
    const b = key === "live" ? null : batchMap.get(key) ?? null;
    const orphan = key !== "live" && !batchMap.get(key);
    const { lines, pay, sec } = calcLinesFor(sess);
    const adjs = b ? b.adjustments || [] : (key === "live" && draftMap.get(uid) ? draftMap.get(uid)!.adjustments || [] : []);
    const adjTotal = adjOf(adjs);
    const total = (b ? b.total || 0 : pay) + adjTotal;
    const paid = b ? b.paid : false;
    const gid = uid + "__" + key;
    const when = b && paidAtMs(b) ? fmtDT(paidAtMs(b), { day: "2-digit", month: "short" }) : "";
    const canPay = sec > 0 || adjs.length > 0;
    return (
      <div key={gid} className="box" style={{ marginTop: 10 }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 700 }}>
              {b ? t("mgr.rep.payment") + (when ? " · " + when : "") : orphan ? t("mgr.rep.orphan") : t("mgr.rep.current")}{" "}
              {b ? (paid ? <span className="pill on" style={{ marginLeft: 4 }}>{t("mgr.rep.paid")}</span> : <span className="pill wait" style={{ marginLeft: 4 }}>{t("mgr.rep.closedUnpaid")}</span>) : <span className="pill wait" style={{ marginLeft: 4 }}>{t("mgr.rep.open")}</span>}
            </div>
            <div className="small muted">{(sec / 3600).toFixed(2)} h ({fmtHM(sec)}) · {money(total)}{adjTotal ? t("mgr.rep.inclAdj") : ""}{b && b.method ? " · " + b.method : ""}</div>
          </div>
          <div className="row">
            {!b && <button className="btn-ok btn-sm" disabled={busy || !canPay} onClick={() => markPaid(uid, sess, pay)}>{t("mgr.rep.markPaid")}</button>}
            {b && <button className={paid ? "btn-ghost btn-sm" : "btn-ok btn-sm"} onClick={() => toggleBatch(b)}>{paid ? t("mgr.rep.markUnpaid") : t("mgr.rep.markPaid")}</button>}
            {b && <button className="btn-ghost btn-sm" onClick={() => openReceipt(uid, b, sess)}>{t("mgr.rep.receipt")}</button>}
            {b && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => reopen(b, sess)}>{t("mgr.rep.reopen")}</button>}
            {sec > 0 && <button className="btn-ghost btn-sm" onClick={() => setExpanded(expanded === gid ? null : gid)}>{expanded === gid ? t("common.hide") : t("mgr.rep.detail")}</button>}
          </div>
        </div>

        {lines.length > 0 && (
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>{t("mgr.rep.colProject")}</th><th className="right">{t("mgr.rep.colHours")}</th><th className="right">{t("mgr.rep.colRegular")}</th><th className="right">{t("mgr.rep.colOT")}</th><th className="right">{t("mgr.rep.colPay")}</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.aid}>
                  <td>{l.a && pMap.get(l.a.projectId) ? pMap.get(l.a.projectId)!.name : "(deleted)"}</td>
                  <td className="right nowrap">{(l.g.sec / 3600).toFixed(2)}</td>
                  <td className="right nowrap">{l.calc.reg.toFixed(2)}</td>
                  <td className="right nowrap">{l.calc.ot.toFixed(2)}</td>
                  <td className="right nowrap">{money(l.calc.pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 8 }}>
          {adjs.map((ad, i) => (
            <div key={i} className="row between" style={{ padding: "2px 0" }}>
              <span className="small">{Number(ad.amount) < 0 ? "➖" : "➕"} {ad.label}</span>
              <span className="small nowrap">{money(ad.amount)} {!b && <button className="btn-danger btn-sm" style={{ padding: "1px 6px", marginLeft: 6 }} onClick={() => removeAdjustment(uid, i)}>×</button>}</span>
            </div>
          ))}
          {key === "live" && (
            <div className="row" style={{ marginTop: 6 }}>
              <select value={adjType} onChange={(e) => setAdjType(e.target.value)} style={{ flex: 1, minWidth: 110 }}>
                {adjTypes.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
              </select>
              <input type="number" placeholder={t("mgr.rep.amountPh")} value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} style={{ flex: 1, minWidth: 90 }} />
              <button className="btn-ghost btn-sm" onClick={() => { addAdjustment(uid, adjType, adjAmount); setAdjAmount(""); }}>{t("common.add")}</button>
            </div>
          )}
          {adjTotal !== 0 && <div className="right small" style={{ marginTop: 4 }}>{t("mgr.rep.summary", { h: money(b ? b.total || 0 : pay), a: money(adjTotal), tot: money(total) })}</div>}
        </div>

        {!b && (
          <div style={{ marginTop: 8 }}>
            {addUid === uid ? (
              <div className="box">
                <div className="small muted" style={{ marginBottom: 6 }}>{t("mgr.rep.addEntryTitle")}</div>
                <div className="row">
                  <select value={nadd.assignmentId} onChange={(e) => setNadd((p) => ({ ...p, assignmentId: e.target.value }))} style={{ flex: 2, minWidth: 130 }}>
                    <option value="">{t("mgr.rep.projectOpt")}</option>
                    {assignments.filter((x) => x.employeeUid === uid).map((x) => <option key={x.id} value={x.id}>{pMap.get(x.projectId) ? pMap.get(x.projectId)!.name : "(deleted)"}</option>)}
                  </select>
                  <input type="date" value={nadd.date} onChange={(e) => setNadd((p) => ({ ...p, date: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
                  <input type="time" value={nadd.from} onChange={(e) => setNadd((p) => ({ ...p, from: e.target.value }))} style={{ width: "auto" }} />
                  <input type="time" value={nadd.to} onChange={(e) => setNadd((p) => ({ ...p, to: e.target.value }))} style={{ width: "auto" }} />
                  <button className="btn-ok btn-sm" onClick={() => addManualEntry(uid)}>{t("common.add")}</button>
                  <button className="btn-ghost btn-sm" onClick={() => setAddUid(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost btn-sm" onClick={() => { setAddUid(uid); setNadd({ assignmentId: "", date: dateISO(new Date()), from: "", to: "" }); }}>{t("mgr.rep.addEntry")}</button>
            )}
          </div>
        )}

        {expanded === gid && sec > 0 && (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>{t("mgr.rep.colDay")}</th><th>{t("mgr.rep.colProject")}</th><th>{t("mgr.rep.colNote")}</th><th className="right">{t("mgr.rep.colDuration")}</th></tr></thead>
            <tbody>
              {sess.slice().sort((a, c) => (a.startMs || 0) - (c.startMs || 0)).map((s) => {
                const proj = s.projectId && pMap.get(s.projectId) ? pMap.get(s.projectId)!.name : "—";
                if (editId === s.id) return (
                  <tr key={s.id}>
                    <td className="small nowrap"><input type="date" value={ed.date} onChange={(e) => setEd((p) => ({ ...p, date: e.target.value }))} style={{ padding: "4px 6px" }} /></td>
                    <td className="small">{proj}</td>
                    <td className="small"><div className="row"><input type="time" value={ed.from} onChange={(e) => setEd((p) => ({ ...p, from: e.target.value }))} style={{ padding: "4px 6px", width: "auto" }} /><input type="time" value={ed.to} onChange={(e) => setEd((p) => ({ ...p, to: e.target.value }))} style={{ padding: "4px 6px", width: "auto" }} /></div></td>
                    <td className="right small nowrap"><button className="btn-ok btn-sm" style={{ padding: "2px 8px" }} onClick={() => saveEditEntry(s)}>{t("common.save")}</button> <button className="btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setEditId(null)}>{t("common.cancel")}</button></td>
                  </tr>
                );
                return (
                  <tr key={s.id}>
                    <td className="small nowrap">{s.startMs ? fmtDT(s.startMs, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="small">{proj}</td>
                    <td className="small muted">
                      {s.memo || "—"}
                      {s.source === "adjusted" ? <span className="pill wait" style={{ marginLeft: 6 }}>{t("mgr.rep.adjusted")}</span> : s.source === "manual" ? <span className="pill on" style={{ marginLeft: 6 }}>{t("mgr.rep.added")}</span> : null}
                      {breaksText(s) && <div className="small muted" style={{ marginTop: 2 }}>{breaksText(s)}</div>}
                      {((s.activeSeconds || 0) + (s.idleSeconds || 0)) > 0 && (
                        <div className="small muted" style={{ marginTop: 2 }}>
                          ⌨ {fmtClock(Math.max(0, (s.activeSeconds || 0) - (s.screenSeconds || 0)))} {t("mgr.rep.wInput")}
                          {(s.screenSeconds || 0) > 0 ? <> · 🖥 {fmtClock(s.screenSeconds)} {t("mgr.rep.wScreen")}</> : null}
                          {(s.idleSeconds || 0) > 0 ? <> · 💤 {fmtClock(s.idleSeconds)} {t("mgr.rep.wIdle")}</> : null}
                        </div>
                      )}
                    </td>
                    <td className="right small nowrap">
                      {fmtClock(s.durationSeconds)}
                      {!b && <> <button className="btn-ghost btn-sm" style={{ marginLeft: 6, padding: "2px 6px" }} onClick={() => { setEditId(s.id); setEd({ date: s.date ?? "", from: hhmm(s.startMs), to: hhmm(s.endMs || s.startMs) }); }}>{t("common.edit")}</button><button className="btn-danger btn-sm" style={{ marginLeft: 4, padding: "2px 6px" }} onClick={() => deleteEntry(s)}>×</button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  const empIds = allUids.sort((x, y) => {
    const tot = (uid: string) => Array.from((byEmp.get(uid) ?? new Map<string, Session[]>()).values()).reduce((n, ss) => n + ss.reduce((m, s) => m + (s.durationSeconds || 0), 0), 0);
    return tot(y) - tot(x);
  });
  const co = APP_SETTINGS;

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.tab.reports")}</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn-ghost btn-sm" onClick={exportCSV} disabled={empIds.length === 0}>{t("mgr.rep.csv")}</button>
          <span className="small nowrap">{periodLabel(week, payPeriod)}</span>
          {weekIsFinished(week, payPeriod) && <span className="pill wait">{t("emp.week.reviewBadge")}</span>}
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <div className="stat"><div className="n">{(grandSec / 3600).toFixed(2)} h</div><div className="l">{t("mgr.rep.teamTotal")}</div></div>
        <div className="stat"><div className="n">{money(grandPay)}</div><div className="l">{t("mgr.rep.estPayroll")}</div></div>
        <div className="stat"><div className="n">{empIds.length}</div><div className="l">{t("mgr.rep.activeEmp")}</div></div>
      </div>

      <div className="box" style={{ marginTop: 14 }}>
        <div className="small muted" style={{ marginBottom: 6 }}>{t("mgr.rep.adjHint")}</div>
        <div className="row">
          <select value={sa.uid} onChange={(e) => setSa((p) => ({ ...p, uid: e.target.value }))} style={{ flex: 2, minWidth: 140 }}>
            <option value="">{t("mgr.rep.employeeOpt")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
          <select value={sa.type} onChange={(e) => setSa((p) => ({ ...p, type: e.target.value }))} style={{ flex: 1, minWidth: 110 }}>
            {adjTypes.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </select>
          <input type="number" placeholder={t("mgr.rep.amountPh")} value={sa.amount} onChange={(e) => setSa((p) => ({ ...p, amount: e.target.value }))} style={{ flex: 1, minWidth: 90 }} />
          <button className="btn-ghost btn-sm" disabled={!sa.uid || sa.amount === ""} onClick={() => { addAdjustment(sa.uid, sa.type, sa.amount); setSa((p) => ({ ...p, amount: "" })); }}>{t("common.add")}</button>
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>{t("mgr.rep.adjNote")}</div>
      </div>

      {empIds.length === 0 && <p className="muted" style={{ marginTop: 14 }}>{t("mgr.rep.noneWeek")}</p>}
      {empIds.map((uid) => {
        const groups = new Map(byEmp.get(uid) ?? []);
        if (!groups.has("live")) groups.set("live", []);
        const keys = Array.from(groups.keys()).sort((a, b) => (a === "live" ? -1 : b === "live" ? 1 : 0));
        const emp = uMap.get(uid);
        let empSec = 0, empTotal = 0, hasUnpaid = false;
        keys.forEach((k) => {
          const b = k === "live" ? null : batchMap.get(k) ?? null;
          const { pay, sec } = calcLinesFor(groups.get(k)!);
          const adjs = b ? b.adjustments || [] : (draftMap.get(uid)?.adjustments || []);
          empSec += sec;
          empTotal += (b ? b.total || 0 : pay) + adjOf(adjs);
          if (!b ? sec > 0 || adjs.length > 0 : !b.paid) hasUnpaid = true;
        });
        return (
          <details key={uid} style={{ marginTop: 12 }}>
            <summary className="emp-summary">
              <span style={{ fontWeight: 800, fontSize: 15 }}>{emp ? emp.fullName : "—"}</span>
              <span className="small muted">
                {(empSec / 3600).toFixed(2)} h · {money(empTotal)}
                {hasUnpaid && <span className="pill wait" style={{ marginLeft: 8 }}>{t("mgr.rep.open")}</span>}
              </span>
            </summary>
            {keys.map((k) => renderGroup(uid, k, groups.get(k)!))}
          </details>
        );
      })}

      <p className="small muted" style={{ marginTop: 14 }}>{t("mgr.rep.foot")}</p>

      {receipt && (
        <div className="rcpt-overlay" onClick={() => setReceipt(null)}>
          <div className="rcpt-print" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{co.companyName || t("mgr.rep.rcptTitle")}</div>
            {co.companyName && <div className="small muted">{t("mgr.rep.rcptTitle")}</div>}
            {co.companyAddress && <div className="small">{co.companyAddress}</div>}
            <div className="small">
              {co.companyTaxId ? t("mgr.rep.rcptTaxId") + " " + co.companyTaxId : ""}
              {co.companyPhone ? "  ·  " + co.companyPhone : ""}
              {co.companyEmail ? "  ·  " + co.companyEmail : ""}
            </div>
            <div className="hr" style={{ background: "#ddd" }} />
            <div><b>{t("mgr.rep.rcptEmployee")}</b> {receipt.emp ? receipt.emp.fullName : "—"}{receipt.emp && receipt.emp.city ? " · " + receipt.emp.city : ""}</div>
            {receipt.emp && receipt.emp.payMethod ? <div className="small"><b>{t("mgr.rep.rcptPayTo")}</b> {receipt.emp.payMethod}{receipt.emp.payDetails ? " · " + receipt.emp.payDetails : ""}</div> : null}
            <div className="small muted">
              {t("mgr.rep.rcptPeriod")} {periodLabel(week, payPeriod)}
              {receipt.batch && paidAtMs(receipt.batch) ? "  ·  " + t("mgr.rep.rcptPaid") + " " + fmtDT(paidAtMs(receipt.batch), { day: "2-digit", month: "short", year: "numeric" }) : ""}
              {receipt.batch && receipt.batch.method ? "  ·  " + receipt.batch.method : ""}
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>{t("mgr.rep.colProject")}</th><th>{t("mgr.rep.rcptLocation")}</th><th className="right">{t("mgr.rep.colHours")}</th><th className="right">{t("mgr.rep.rcptAmount")}</th></tr></thead>
              <tbody>
                {receipt.lines.map((l) => {
                  const p: { name: string; location: string } = l.a && pMap.get(l.a.projectId) ? pMap.get(l.a.projectId)! : { name: "(deleted)", location: "" };
                  return <tr key={l.aid}><td>{p.name}</td><td>{p.location || "—"}</td><td className="right">{(l.g.sec / 3600).toFixed(2)}</td><td className="right">{money(l.calc.pay)}</td></tr>;
                })}
                {receipt.adjustments.map((ad, i) => <tr key={"a" + i}><td>{ad.label}</td><td>—</td><td className="right">—</td><td className="right">{money(ad.amount)}</td></tr>)}
              </tbody>
            </table>
            <div className="right" style={{ marginTop: 10, fontSize: 18, fontWeight: 800 }}>{t("mgr.rep.rcptTotal")} {money(receipt.total)}</div>
            <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
              <div className="small muted">_______________________<br />{t("mgr.rep.rcptSig")}</div>
              <div className="small muted" style={{ textAlign: "right" }}>_______________________<br />{t("mgr.rep.rcptAuth")}</div>
            </div>
            <div className="row rcpt-noprint" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn-ghost btn-sm" onClick={() => setReceipt(null)}>{t("mgr.rep.close")}</button>
              <button className="btn-sm" onClick={() => window.print()}>{t("mgr.rep.print")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
