"use client";

import { useRef, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { fmtClock, weekStartISO } from "@/lib/timetracker/helpers";
import { rangeOverlapsAny, type OccupiedRange } from "@/lib/timetracker/timeOverlap";
import type { RequestType } from "@/lib/timetracker/types";
import { isOverlapError } from "@/lib/timetracker/overlap";

// Ported (D-071) from timetracker-clean's manager/ManagerRequests.jsx — the
// approve/reject queue for employee time requests. Named /team-requests,
// not /requests: that route already exists for an employee's OWN requests
// (D-068) — two different screens under the original's single overloaded
// "Requests" tab, split into distinct URLs since routing here is
// URL-based, not a client-side tab/mode switch.
const LABEL: Record<RequestType, string> = { add: "Add time", adjust: "Adjust time", delete: "Delete time" };

function tParse(t: string): number { if (!t) return 0; const p = t.split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
function fromRange(date: string, fromTime: string, toTime: string) {
  let d = tParse(toTime) - tParse(fromTime);
  if (d < 0) d += 1440;
  const durationSeconds = d * 60;
  const ft = String(fromTime).length === 5 ? fromTime : "0" + fromTime;
  const startMs = new Date(date + "T" + ft + ":00").getTime();
  return { durationSeconds, startMs, endMs: startMs + durationSeconds * 1000 };
}
// Minutes since local midnight for an epoch ms — same (browser-local) frame
// fromRange() above already uses, so this stays consistent with it rather
// than mixing in a second timezone assumption for just this one check.
function msToMin(ms: number): number { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }

export default function TeamRequestsPage() {
  const { me, allRequests: requests, allProjects: projects, allAssignments: assignments, insertSession, updateSession, removeSession, claimRequest, resetRequestToPending, logAudit, sessionsSince } = useData();
  const t = useT();
  const rLabel = (type: RequestType | null) => (type ? t("reqtype." + type) : "—");
  const aMap = new Map(assignments.map((a) => [a.id, a]));
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const projName = (aid: string | undefined) => { const a = aid ? aMap.get(aid) : undefined; return a ? pMap.get(a.projectId)?.name ?? "—" : "—"; };

  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const history = requests.filter((r) => r.status !== "pending").sort((a, b) => new Date(b.resolvedAt || 0).getTime() - new Date(a.resolvedAt || 0).getTime()).slice(0, 30);

  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const busyRef = useRef(busyIds);
  busyRef.current = busyIds;
  const setBusy = (id: string, on: boolean) => setBusyIds((prev) => { const n = new Set(prev); on ? n.add(id) : n.delete(id); return n; });

  async function accept(r: (typeof requests)[number]) {
    if (busyRef.current.has(r.id)) return;
    setBusy(r.id, true);
    try {
      const claimed = await claimRequest(r.id, { status: "approved", resolvedBy: me.id });
      if (!claimed) return;
      const p = r.payload as Record<string, unknown>;
      try {
        if (r.type === "add") {
          let d;
          if (p.fromTime && p.toTime) d = fromRange(p.date as string, p.fromTime as string, p.toTime as string);
          else { const dur = Math.round(((p.hours as number) || 0) * 3600); const s = Date.parse(p.date + "T12:00:00Z"); d = { durationSeconds: dur, startMs: s, endMs: s + dur * 1000 }; }
          // D-086: re-check for a conflict as of RIGHT NOW, not as of when the
          // employee submitted it — another one of their own entries could
          // have landed (a session tracked live, or a different request
          // approved) while this one sat pending. Only meaningful for a
          // fromTime/toTime request; an hours-only one has no range to check.
          if (p.fromTime && p.toTime) {
            const daySessions = await sessionsSince(p.date as string, p.date as string);
            const occupied: OccupiedRange[] = [
              ...daySessions
                .filter((s) => s.employeeUid === r.employeeUid && s.startMs != null)
                .map((s) => {
                  const startMin = msToMin(s.startMs!);
                  let endMin = msToMin(s.endMs ?? s.startMs!);
                  if (endMin < startMin) endMin = 1440;
                  return { startMin, endMin };
                }),
              ...requests
                .filter((other) => other.id !== r.id && other.status === "pending" && other.employeeUid === r.employeeUid && (other.type === "add" || other.type === "adjust"))
                .map((other) => other.payload as Record<string, unknown>)
                .filter((op) => op.date === p.date && typeof op.fromTime === "string" && typeof op.toTime === "string")
                .map((op) => {
                  const startMin = tParse(op.fromTime as string);
                  let endMin = tParse(op.toTime as string);
                  if (endMin < startMin) endMin = 1440;
                  return { startMin, endMin };
                }),
            ];
            let reqEndMin = tParse(p.toTime as string);
            const reqStartMin = tParse(p.fromTime as string);
            if (reqEndMin < reqStartMin) reqEndMin = 1440;
            if (rangeOverlapsAny(reqStartMin, reqEndMin, occupied)) {
              await resetRequestToPending(r.id).catch(() => {});
              alert(t("mgr.req.overlapOnAccept", {
                name: (p.employeeName as string) || "", date: p.date as string, from: p.fromTime as string, to: p.toTime as string,
              }));
              return;
            }
          }
          await insertSession({
            employeeUid: r.employeeUid,
            employeeName: p.employeeName as string,
            projectId: p.projectId as string,
            assignmentId: p.assignmentId as string,
            memo: p.reason ? "[Manual] " + p.reason : "[Time added]",
            weekOf: weekStartISO(p.date as string),
            date: p.date as string,
            startMs: d.startMs, endMs: d.endMs, durationSeconds: d.durationSeconds,
            keystrokes: 0, clicks: 0, activeSeconds: 0,
            manual: true, source: "manual", isLive: false,
          });
        } else if (r.type === "adjust") {
          if (p.fromTime && p.toTime) {
            const d = fromRange(p.date as string, p.fromTime as string, p.toTime as string);
            await updateSession(p.sessionId as string, { date: p.date as string, weekOf: weekStartISO(p.date as string), startMs: d.startMs, endMs: d.endMs, durationSeconds: d.durationSeconds, source: "adjusted" });
          } else {
            await updateSession(p.sessionId as string, { durationSeconds: Math.round(((p.hours as number) || 0) * 3600), source: "adjusted" });
          }
        } else if (r.type === "delete") {
          await removeSession(p.sessionId as string);
        }
        await logAudit("Request approved", LABEL[r.type as RequestType] + " · " + (p.employeeName || "") + " · " + p.date + (p.hours ? " · " + p.hours + "h" : ""));
      } catch (e) {
        // La solicitud vuelve a pendiente en los dos casos — se aprobó y no se pudo
        // aplicar, así que dejarla como aprobada mentiría sobre lo que hay en la tabla.
        await resetRequestToPending(r.id).catch(() => {});
        // 082: aprobar estas horas pisaría un tramo ya fichado. Es el caso que pagó a
        // Nick 0.5 h dos veces el 11 de julio, y ahora la base no deja aplicarlo.
        if (isOverlapError(e)) { alert(t("track.overlap")); return; }
        const err = e as { message?: string } | null;
        alert(t("mgr.req.applyFail", { e: err?.message || "unknown error" }));
      }
    } finally {
      setBusy(r.id, false);
    }
  }

  async function reject(r: (typeof requests)[number]) {
    if (busyRef.current.has(r.id)) return;
    setBusy(r.id, true);
    try {
      const p = r.payload as Record<string, unknown>;
      const claimed = await claimRequest(r.id, { status: "rejected", resolvedBy: me.id });
      if (!claimed) return;
      await logAudit("Request rejected", LABEL[r.type as RequestType] + " · " + (p.employeeName || "") + " · " + p.date);
    } finally {
      setBusy(r.id, false);
    }
  }

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

  return (
    <>
      <div className="card">
        <h2>{t("mgr.req.pendingTitle")}</h2>
        {pending.length === 0 ? <p className="muted">{t("mgr.req.noPending")}</p> : pending.map((r) => {
          const p = r.payload as Record<string, unknown>;
          return (
            <div className="box" key={r.id} style={{ marginBottom: 10 }}>
              <div className="between">
                <div>
                  <div style={{ fontWeight: 700 }}>{p.employeeName as string} · {rLabel(r.type)}</div>
                  <div className="small muted">
                    {projName(p.assignmentId as string)} · {p.date as string}
                    {r.type === "add" && (p.fromTime ? <> · {p.fromTime as string}–{p.toTime as string} (<b>{p.hours as number} h</b>)</> : <> · <b>{p.hours as number} h</b></>)}
                    {r.type === "adjust" && <> · {fmtClock((p.oldSeconds as number) || 0)} → {p.fromTime ? <>{p.fromTime as string}–{p.toTime as string} (<b>{p.hours as number} h</b>)</> : <b>{p.hours as number} h</b>}</>}
                    {p.reason ? <> · &quot;{p.reason as string}&quot;</> : null}
                  </div>
                </div>
                <div className="row">
                  <button className="btn-ok btn-sm" disabled={busyIds.has(r.id)} onClick={() => accept(r)}>{t("mgr.req.accept")}</button>
                  <button className="btn-danger btn-sm" disabled={busyIds.has(r.id)} onClick={() => reject(r)}>{t("mgr.req.reject")}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>{t("mgr.req.history")}</h2>
        {history.length === 0 ? <p className="muted">{t("mgr.req.noHistory")}</p> : (
          <table>
            <thead><tr><th>{t("mgr.asn.employee")}</th><th>{t("mgr.req.colType")}</th><th>{t("mgr.req.colDetail")}</th><th>{t("mgr.req.colStatus")}</th></tr></thead>
            <tbody>
              {history.map((r) => {
                const p = r.payload as Record<string, unknown>;
                return (
                  <tr key={r.id}>
                    <td>{p.employeeName as string}</td>
                    <td>{rLabel(r.type)}</td>
                    <td className="small muted">{projName(p.assignmentId as string)} · {p.date as string}{r.type !== "delete" && p.hours ? " · " + p.hours + " h" : ""}</td>
                    <td>{r.status === "approved" ? <span className="pill on">{t("mgr.req.approved")}</span> : <span className="pill off">{t("mgr.req.rejected")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
