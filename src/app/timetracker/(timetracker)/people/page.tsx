"use client";

import { useState } from "react";
import { TablaEstandar } from "@/components/TablaEstandar";
import { soloActivos } from "@/lib/baja";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { effWorkerType } from "@/lib/timetracker/helpers";
import { EmployeeWeek } from "@/components/timetracker/EmployeeWeek";

// Ported (D-071) from timetracker-clean's manager/ManagerPeople.jsx — but
// deliberately SMALLER than the original. Role changes, account creation,
// and account deletion are NOT here: those are identity/access-lifecycle
// actions, and D-053/D-057 already established that this container handles
// those from the hub's Users dialog (/home/users), not from inside a
// module — recruiting doesn't manage its own users either. Only what's
// genuinely module-specific stays: worker type, tracking mode, breaks, and
// the "active" (onboarding) toggle — timetracker.employee_settings fields
// that have no meaning to deliveries or recruiting. Renaming someone and
// pay info are self-service only (My Account, D-069); a manager can't edit
// either from here, matching the original's own boundary (its table never
// exposed payMethod/payDetails as editable, only as a read column).
export default function ManagerPeoplePage() {
  // Qué fila tiene la semana abierta. Una sola: abrir doce a la vez sería pedir doce semanas
  // para mirar una, y la pantalla dejaría de leerse.
  const [abierta, setAbierta] = useState<string | null>(null);
  const { me, allEmployees: users, updateEmployeeSettings } = useData();
  const t = useT();

  const setField = (uid: string, field: "workerType" | "trackMode", val: string) => {
    updateEmployeeSettings(uid, { [field]: val || null });
  };
  const setBreaks = (uid: string, val: string) => {
    updateEmployeeSettings(uid, { breaksEnabled: val === "" ? null : val === "yes" });
  };
  const toggleActive = (u: (typeof users)[number]) => {
    if (u.id === me.id) { alert(t("mgr.ppl.noSelfDeactivate")); return; }
    updateEmployeeSettings(u.id, { active: u.active === false });
  };

  // D-707: el de baja ya no sale aquí; sus horas siguen en nómina y reportes (la lista completa del proveedor).
  const activos = soloActivos(users);
  const others = activos.filter((u) => u.id !== me.id);

  if (me.role !== "admin") return <div className="card"><p className="muted">{t("common.adminsOnly")}</p></div>;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.tab.people")}</h2>
        {/* Un color sin leyenda es un adorno; con ella es un dato. */}
        <span className="small muted">
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "var(--tt-accent2)", marginRight: 5 }} />
          In-house
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "var(--tt-accent)", margin: "0 5px 0 12px" }} />
          Remote
        </span>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Names, pay info, module access and account status are managed from the hub&apos;s Users
        page — this screen is only each employee&apos;s tracking setup.
      </p>
      {others.length === 0 && <div className="banner info">{t("mgr.ppl.onlyUser")}</div>}
      <TablaEstandar id="tt-personas" filas={activos} claveDe={(u) => u.id} anchoDeAcciones={130}
        claseDeFila={(u) => (u.active === false ? "atenuado" : undefined)}
        columnas={[
          { key: "nombre", en: t("mgr.ppl.colName"), es: t("mgr.ppl.colName"), ancho: 240, fija: true, clase: "nowrap", valor: (u) => u.fullName,
            // Presencial contra remoto de un vistazo (D-128). Son dos nóminas distintas.
            celda: (u) => (
              <>
                <span
                  title={effWorkerType(u) === "inhouse" ? "In-house" : "Remote"}
                  style={{
                    display: "inline-block", width: 8, height: 8, borderRadius: 999,
                    marginRight: 8, verticalAlign: "middle",
                    background: effWorkerType(u) === "inhouse" ? "var(--tt-accent2)" : "var(--tt-accent)",
                  }}
                />
                {u.fullName}{u.id === me.id && <span className="muted">{t("mgr.ppl.you")}</span>}
              </>
            ) },
          { key: "ciudad", en: t("mgr.ppl.colCity"), es: t("mgr.ppl.colCity"), ancho: 140, clase: "muted", valor: (u) => u.city || null },
          { key: "pagar", en: t("mgr.ppl.colPayTo"), es: t("mgr.ppl.colPayTo"), ancho: 220, clase: "small muted",
            valor: (u) => (u.payMethod ? u.payMethod + (u.payDetails ? " · " + u.payDetails : "") : null) },
          { key: "tipo", en: t("mgr.ppl.colType"), es: t("mgr.ppl.colType"), ancho: 170, valor: (u) => u.workerType || null,
            celda: (u) => (
              <select value={u.workerType || ""} style={{ width: "auto", minWidth: 120 }} onChange={(e) => setField(u.id, "workerType", e.target.value)}>
                <option value="">{t("mgr.ppl.default")}</option>
                <option value="remote">{t("track.remote")}</option>
                <option value="inhouse">{t("track.inhouse")}</option>
              </select>
            ) },
          { key: "seguimiento", en: t("mgr.ppl.colTracking"), es: t("mgr.ppl.colTracking"), ancho: 190, valor: (u) => u.trackMode || null,
            celda: (u) => (
              <select value={u.trackMode || ""} style={{ width: "auto", minWidth: 150 }} onChange={(e) => setField(u.id, "trackMode", e.target.value)}>
                <option value="">{t("mgr.ppl.default")}</option>
                <option value="activity">{t("mgr.ppl.trackActivity")}</option>
                <option value="inout">{t("mgr.ppl.trackInout")}</option>
              </select>
            ) },
          { key: "descansos", en: t("mgr.ppl.colBreak"), es: t("mgr.ppl.colBreak"), ancho: 150, valor: (u) => (u.breaksEnabled == null ? null : u.breaksEnabled ? "yes" : "no"),
            celda: (u) => (
              <select value={u.breaksEnabled == null ? "" : (u.breaksEnabled ? "yes" : "no")} style={{ width: "auto", minWidth: 110 }} onChange={(e) => setBreaks(u.id, e.target.value)}>
                <option value="">{t("mgr.ppl.default")}</option>
                <option value="yes">{t("common.yes")}</option>
                <option value="no">{t("common.no")}</option>
              </select>
            ) },
          { key: "estado", en: t("mgr.ppl.colStatus"), es: t("mgr.ppl.colStatus"), ancho: 260, clase: "nowrap", valor: (u) => (u.active === false ? t("mgr.ppl.inactive") : t("mgr.ppl.active")),
            celda: (u) => (
              <>
                {u.active === false
                  ? <span className="pill off" title={t("mgr.ppl.pendingHint")}>{t("mgr.ppl.inactive")}</span>
                  : <span className="pill on">{t("mgr.ppl.active")}</span>}
                {u.id !== me.id && (
                  <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleActive(u)}>
                    {u.active === false ? t("mgr.ppl.activate") : t("mgr.ppl.deactivate")}
                  </button>
                )}
              </>
            ) },
        ]}
        // La semana de esa persona, ahí mismo: abajo de la tabla (una fila desplegable no cabe en el estándar).
        acciones={(u) => (
          <button className="btn-ghost btn-sm" onClick={() => setAbierta((x) => (x === u.id ? null : u.id))}>
            {abierta === u.id ? "Hide week" : "📅 Week"}
          </button>
        )} />
      {abierta !== null && activos.some((u) => u.id === abierta) && (
        <div className="box" style={{ marginTop: 10, background: "var(--tt-panel2)" }}>
          <EmployeeWeek employeeId={abierta} />
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>{t("mgr.ppl.foot")}</p>
    </div>
  );
}
