"use client";

import { Fragment, useState } from "react";
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

  const others = users.filter((u) => u.id !== me.id);

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

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
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("mgr.ppl.colName")}</th><th>{t("mgr.ppl.colCity")}</th><th>{t("mgr.ppl.colPayTo")}</th>
              <th>{t("mgr.ppl.colType")}</th><th>{t("mgr.ppl.colTracking")}</th><th>{t("mgr.ppl.colBreak")}</th><th>{t("mgr.ppl.colStatus")}</th><th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const inactive = u.active === false;
              return (
                <Fragment key={u.id}>
                <tr style={inactive ? { opacity: 0.55 } : undefined}>
                  <td className="nowrap">
                    {/* Presencial contra remoto de un vistazo (D-128). Son dos nóminas
                        distintas —asistencia contra tiempo cronometrado— y hasta ahora había
                        que abrir el desplegable de cada fila para saber cuál era cuál. */}
                    <span
                      title={effWorkerType(u) === "inhouse" ? "In-house" : "Remote"}
                      style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: 999,
                        marginRight: 8, verticalAlign: "middle",
                        background: effWorkerType(u) === "inhouse" ? "var(--tt-accent2)" : "var(--tt-accent)",
                      }}
                    />
                    {u.fullName}{u.id === me.id && <span className="muted">{t("mgr.ppl.you")}</span>}
                  </td>
                  <td className="muted">{u.city || "—"}</td>
                  <td className="small muted">{u.payMethod ? u.payMethod + (u.payDetails ? " · " + u.payDetails : "") : "—"}</td>
                  <td>
                    <select value={u.workerType || ""} style={{ width: "auto", minWidth: 120 }} onChange={(e) => setField(u.id, "workerType", e.target.value)}>
                      <option value="">{t("mgr.ppl.default")}</option>
                      <option value="remote">{t("track.remote")}</option>
                      <option value="inhouse">{t("track.inhouse")}</option>
                    </select>
                  </td>
                  <td>
                    <select value={u.trackMode || ""} style={{ width: "auto", minWidth: 150 }} onChange={(e) => setField(u.id, "trackMode", e.target.value)}>
                      <option value="">{t("mgr.ppl.default")}</option>
                      <option value="activity">{t("mgr.ppl.trackActivity")}</option>
                      <option value="inout">{t("mgr.ppl.trackInout")}</option>
                    </select>
                  </td>
                  <td>
                    <select value={u.breaksEnabled == null ? "" : (u.breaksEnabled ? "yes" : "no")} style={{ width: "auto", minWidth: 110 }} onChange={(e) => setBreaks(u.id, e.target.value)}>
                      <option value="">{t("mgr.ppl.default")}</option>
                      <option value="yes">{t("common.yes")}</option>
                      <option value="no">{t("common.no")}</option>
                    </select>
                  </td>
                  <td className="nowrap">
                    {inactive
                      ? <span className="pill off" title={t("mgr.ppl.pendingHint")}>{t("mgr.ppl.inactive")}</span>
                      : <span className="pill on">{t("mgr.ppl.active")}</span>}
                    {u.id !== me.id && (
                      <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleActive(u)}>
                        {inactive ? t("mgr.ppl.activate") : t("mgr.ppl.deactivate")}
                      </button>
                    )}
                  </td>
                  <td className="nowrap">
                    {/* La semana de esa persona, ahí mismo. Era "Today's Crew", que obligaba a
                        apuntarse el nombre, salir de aquí y buscarlo en otra pantalla. */}
                    <button className="btn-ghost btn-sm" onClick={() => setAbierta((x) => (x === u.id ? null : u.id))}>
                      {abierta === u.id ? "Hide week" : "📅 Week"}
                    </button>
                  </td>
                </tr>
                {abierta === u.id && (
                  <tr>
                    <td colSpan={8} style={{ background: "var(--tt-panel2)" }}>
                      <EmployeeWeek employeeId={u.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>{t("mgr.ppl.foot")}</p>
    </div>
  );
}
