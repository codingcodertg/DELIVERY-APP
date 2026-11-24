"use client";

import { TablaEstandar } from "@/components/TablaEstandar";
import { useRef, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { fmtClock, weekStartISO } from "@/lib/timetracker/helpers";
import { nombreDeLinea, tiendaYPuesto } from "@/lib/timetracker/tienda-y-puesto";
import type { OccupiedRange } from "@/lib/timetracker/timeOverlap";
import { bloquesChocan, bloquesDeSolicitud, rangosDeBloques } from "@/lib/timetracker/dos-bloques";
import type { RequestType } from "@/lib/timetracker/types";
import { isOverlapError } from "@/lib/timetracker/overlap";
import { SeccionAusenciasFichaje, SeccionExcepcionesFichaje, useBandejaDeFichaje } from "@/components/timetracker/ClockinApprovals";
import { SeccionPlegable, useSeccionAbierta } from "@/components/timetracker/SeccionPlegable";

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
// «08:50–11:00 + 12:03–15:47»: los bloques de una solicitud, para leer de un vistazo.
function textoDeBloques(p: Record<string, unknown>): string {
  return bloquesDeSolicitud(p).map((b) => `${b.fromTime}–${b.toTime}`).join(" + ");
}

export default function TeamRequestsPage() {
  const { me, allRequests: requests, allProjects: projects, allAssignments: assignments, allEmployees, insertSession, updateSession, removeSession, claimRequest, resetRequestToPending, logAudit, sessionsSince, tiendas } = useData();
  const t = useT();
  // Claves literales, no construidas: D-202 borro reqtype.* como "muertas" porque la medicion solo
  // buscaba literales y esta clave se construia con "reqtype." + type; la cola ensenaba la clave cruda.
  // Con una clave por rama, la prueba de claves de D-187 las ve.
  const rLabel = (type: RequestType | null) =>
    type === "add" ? t("reqtype.add") : type === "adjust" ? t("reqtype.adjust") : type === "delete" ? t("reqtype.delete") : "—";
  const aMap = new Map(assignments.map((a) => [a.id, a]));
  const pMap = new Map(projects.map((p) => [p.id, p]));
  // Sin proyecto: el presencial pide tiempo sin él (D-493) y aquí sale su tienda y su puesto; el
  // remoto, «—» como siempre.
  const uMap = new Map(allEmployees.map((u) => [u.id, u]));
  const lang = getLang();
  // Una solicitud de presencial en varias tiendas (316) lleva la tienda, no proyecto: sale esa.
  const projName = (aid: string | undefined, uid: string, storeId?: string) => {
    const a = aid ? aMap.get(aid) : undefined;
    const tienda = !a && storeId ? tiendas.find((s) => s.id === storeId) : undefined;
    if (tienda) return tiendaYPuesto({ tienda: tienda.name, puesto: uMap.get(uid)?.puesto }, lang);
    return nombreDeLinea(a ? pMap.get(a.projectId)?.name : null, uMap.get(uid), lang, "—");
  };

  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const history = requests.filter((r) => r.status !== "pending").sort((a, b) => new Date(b.resolvedAt || 0).getTime() - new Date(a.resolvedAt || 0).getTime()).slice(0, 30);

  // Qué secciones están abiertas (D-NEXT, ayuda de Roberto, 24 nov 2026). Pendientes se abre
  // solo si hay algo que revisar; el historial empieza cerrado. Las de la bandeja de fichaje se
  // deciden dentro de sus propios componentes.
  const pendientes = useSeccionAbierta("pendientes", true, pending.length > 0);
  const historial = useSeccionAbierta("historial", false, history.length > 0);
  // Las dos colas de fichaje cargan una sola vez, aquí, y se reparten entre sus secciones. Solo
  // piden datos si quien mira es admin: la pantalla de abajo no se pinta para nadie más.
  const bandeja = useBandejaDeFichaje({ activa: me.role === "admin" });

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
      // Sesiones ya creadas por esta aprobación (dos bloques): si el segundo no cabe, se quitan.
      const creadas: string[] = [];
      try {
        if (r.type === "add") {
          // Una solicitud de dos bloques (mañana + después de comer) crea dos sesiones; una de un bloque, una.
          const bloques = bloquesDeSolicitud(p);
          let segmentos: { durationSeconds: number; startMs: number; endMs: number }[];
          if (bloques.length) segmentos = bloques.map((b) => fromRange(p.date as string, b.fromTime, b.toTime));
          else { const dur = Math.round(((p.hours as number) || 0) * 3600); const s = Date.parse(p.date + "T12:00:00Z"); segmentos = [{ durationSeconds: dur, startMs: s, endMs: s + dur * 1000 }]; }
          // D-086: re-check for a conflict as of RIGHT NOW, not as of when the
          // employee submitted it — another one of their own entries could
          // have landed (a session tracked live, or a different request
          // approved) while this one sat pending. Only meaningful for a
          // fromTime/toTime request; an hours-only one has no range to check.
          if (bloques.length) {
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
                .filter((op) => op.date === p.date)
                .flatMap((op) => rangosDeBloques(bloquesDeSolicitud(op))),
            ];
            // Cada bloque contra lo ocupado, y los dos bloques entre sí.
            if (bloquesChocan(bloques, occupied)) {
              await resetRequestToPending(r.id).catch(() => {});
              alert(t("mgr.req.overlapOnAccept", {
                name: (p.employeeName as string) || "", date: p.date as string, from: p.fromTime as string, to: p.toTime as string,
              }));
              return;
            }
          }
          for (const d of segmentos) {
            const creada = await insertSession({
              employeeUid: r.employeeUid,
              employeeName: p.employeeName as string,
              projectId: p.projectId as string,
              assignmentId: p.assignmentId as string,
              storeId: (p.storeId as string | undefined) ?? null,
              memo: p.reason ? "[Manual] " + p.reason : "[Time added]",
              weekOf: weekStartISO(p.date as string),
              date: p.date as string,
              startMs: d.startMs, endMs: d.endMs, durationSeconds: d.durationSeconds,
              keystrokes: 0, clicks: 0, activeSeconds: 0,
              manual: true, source: "manual", isLive: false,
            });
            creadas.push(creada.id);
          }
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
        // Si el primer bloque ya entró y el segundo falló, se quita el primero: la solicitud queda entera o no queda nada.
        for (const id of creadas) await removeSession(id).catch(() => {});
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

  if (me.role !== "admin") return <div className="card"><p className="muted">{t("common.adminsOnly")}</p></div>;

  return (
    <>
      <SeccionPlegable seccion="pendientes" titulo={t("mgr.req.pendingTitle")} cuenta={pending.length}
        abierta={pendientes.abierta} alternar={pendientes.alternar}>
        {pending.length === 0 ? <p className="muted">{t("mgr.req.noPending")}</p> : pending.map((r) => {
          const p = r.payload as Record<string, unknown>;
          return (
            <div className="box" key={r.id} style={{ marginBottom: 10 }}>
              <div className="between">
                <div>
                  <div style={{ fontWeight: 700 }}>{p.employeeName as string} · {rLabel(r.type)}</div>
                  <div className="small muted">
                    {projName(p.assignmentId as string, r.employeeUid, p.storeId as string | undefined)} · {p.date as string}
                    {r.type === "add" && (p.fromTime ? <> · {textoDeBloques(p)} (<b>{p.hours as number} h</b>)</> : <> · <b>{p.hours as number} h</b></>)}
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
      </SeccionPlegable>

      <SeccionAusenciasFichaje bandeja={bandeja} />

      <SeccionPlegable seccion="historial" titulo={t("mgr.req.history")} cuenta={history.length}
        abierta={historial.abierta} alternar={historial.alternar}>
        {history.length === 0 ? <p className="muted">{t("mgr.req.noHistory")}</p> : (
          <TablaEstandar id="tt-solicitudes-del-equipo" filas={history} claveDe={(r) => String(r.id)}
            columnas={[
              { key: "empleado", en: t("mgr.asn.employee"), es: t("mgr.asn.employee"), ancho: 200, fija: true, valor: (r) => (r.payload as Record<string, unknown>).employeeName as string },
              { key: "tipo", en: t("mgr.req.colType"), es: t("mgr.req.colType"), ancho: 150, valor: (r) => rLabel(r.type) },
              { key: "detalle", en: t("mgr.req.colDetail"), es: t("mgr.req.colDetail"), ancho: 380, clase: "small muted",
                valor: (r) => { const p = r.payload as Record<string, unknown>; return projName(p.assignmentId as string, r.employeeUid, p.storeId as string | undefined) + " · " + String(p.date) + (r.type === "add" && p.fromTime ? " · " + textoDeBloques(p) : "") + (r.type !== "delete" && p.hours ? " · " + String(p.hours) + " h" : ""); } },
              { key: "estado", en: t("mgr.req.colStatus"), es: t("mgr.req.colStatus"), ancho: 130, valor: (r) => (r.status === "approved" ? t("mgr.req.approved") : t("mgr.req.rejected")),
                celda: (r) => (r.status === "approved" ? <span className="pill on">{t("mgr.req.approved")}</span> : <span className="pill off">{t("mgr.req.rejected")}</span>) },
            ]} />
        )}
      </SeccionPlegable>

      {/* Las dos colas de fichaje, aquí y no en una pantalla nueva (fusión de vistas #2).
          Un gerente tenía que mirar en TRES sitios lo que es una sola pregunta: "¿qué me
          toca revisar?". Se añaden a la pantalla a la que ya venía, en vez de inventar una
          cuarta que también habría que acordarse de abrir.

          Siguen siendo tres decisiones distintas y se enseñan como tales: cambiar un
          registro de horas, conceder una ausencia, y dar por visto un fichaje raro. Juntar
          los botones habría sido fingir que son la misma. */}
      <SeccionExcepcionesFichaje bandeja={bandeja} />
    </>
  );
}
