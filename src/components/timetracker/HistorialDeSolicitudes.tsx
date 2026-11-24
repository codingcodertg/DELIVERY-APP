"use client";

import { TablaEstandar } from "@/components/TablaEstandar";
import { useData } from "@/lib/timetracker-data-provider";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { nombreDeLinea, tiendaYPuesto } from "@/lib/timetracker/tienda-y-puesto";
import { bloquesDeSolicitud } from "@/lib/timetracker/dos-bloques";
import type { RequestType } from "@/lib/timetracker/types";
import { SeccionPlegable, useSeccionAbierta } from "@/components/timetracker/SeccionPlegable";

// Historial de solicitudes ya decididas (aprobadas o rechazadas), movido desde
// Time Tracker → Solicitudes (team-requests) a Auditoría (2026-11-24, pedido del dueño: las
// solicitudes de fichaje ya están en Auditoría, así que el historial va con ellas). Misma tabla,
// mismas columnas y mismo id de TablaEstandar (`tt-solicitudes-del-equipo`), porque la gente
// guardó sus columnas con ese id. Empieza cerrado, como antes.
// Lo que se repite de team-requests (rótulo del tipo, proyecto o tienda y puesto, bloques de
// horas) es copia a propósito: son pocas líneas y así cada pantalla se lee sola.

function textoDeBloques(p: Record<string, unknown>): string {
  return bloquesDeSolicitud(p).map((b) => `${b.fromTime}–${b.toTime}`).join(" + ");
}

export function HistorialDeSolicitudes() {
  const { allRequests: requests, allProjects: projects, allAssignments: assignments, allEmployees, tiendas } = useData();
  const t = useT();
  const lang = getLang();

  const rLabel = (type: RequestType | null) =>
    type === "add" ? t("reqtype.add") : type === "adjust" ? t("reqtype.adjust") : type === "delete" ? t("reqtype.delete") : "—";
  const aMap = new Map(assignments.map((a) => [a.id, a]));
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const uMap = new Map(allEmployees.map((u) => [u.id, u]));
  // Sin proyecto: el presencial pide tiempo sin él (D-493) y aquí sale su tienda y su puesto; el
  // remoto, «—» como siempre.
  const projName = (aid: string | undefined, uid: string, storeId?: string) => {
    const a = aid ? aMap.get(aid) : undefined;
    const tienda = !a && storeId ? tiendas.find((s) => s.id === storeId) : undefined;
    if (tienda) return tiendaYPuesto({ tienda: tienda.name, puesto: uMap.get(uid)?.puesto }, lang);
    return nombreDeLinea(a ? pMap.get(a.projectId)?.name : null, uMap.get(uid), lang, "—");
  };

  const history = requests.filter((r) => r.status !== "pending").sort((a, b) => new Date(b.resolvedAt || 0).getTime() - new Date(a.resolvedAt || 0).getTime()).slice(0, 30);

  // El historial empieza cerrado aunque tenga filas; cada persona recuerda su elección.
  const historial = useSeccionAbierta("historial", false, history.length > 0);

  return (
    <SeccionPlegable seccion="historial" titulo={t("mgr.req.historyTitle")} cuenta={history.length}
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
  );
}
