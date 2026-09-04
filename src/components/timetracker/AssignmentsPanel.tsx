"use client";

import { useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { APP_SETTINGS, money } from "@/lib/timetracker/helpers";

/**
 * Tarifas por proyecto: quién está asignado a qué, y a cuánto la hora.
 *
 * Ported (D-071) from timetracker-clean's manager/ManagerAssignments.jsx. Vivía entero en
 * `assignments/page.tsx`; se movió aquí tal cual cuando el Horario pasó a ser la otra sección
 * de esa misma pantalla (D-186). Lo único que se quitó es la comprobación de rol en cliente
 * ("Admins only."): la página ahora es de servidor y redirige antes de montar nada, así que
 * este componente solo se renderiza para un admin.
 *
 * OJO: la lista de personas de aquí es `allEmployees` del proveedor — TODO el que tiene
 * `timetracker_role`, sin filtro de tienda y sin excluir inactivos. La sección de Horario
 * usa OTRA lista, acotada por tienda (D-127). No se unifican a propósito: ver D-186.
 */
interface FormState { employeeUid: string; projectId: string; hourlyRate: string; overtimeRate: string; overtimeThreshold: string; weeklyLimit: string; paymentMethod: string }

export function AssignmentsPanel() {
  const { allEmployees: users, allProjects: projects, allAssignments: assignments, insertAssignment, updateAssignment, removeAssignment } = useData();
  const t = useT();
  const activeProjects = projects.filter((p) => !p.archived);
  const empty: FormState = { employeeUid: "", projectId: "", hourlyRate: "", overtimeRate: "", overtimeThreshold: "", weeklyLimit: "", paymentMethod: "" };
  const [f, setF] = useState<FormState>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const upd = <K extends keyof FormState>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));
  const methods = APP_SETTINGS.paymentMethods || [];

  function startEdit(a: (typeof assignments)[number]) {
    setEditId(a.id);
    setF({
      employeeUid: a.employeeUid, projectId: a.projectId,
      hourlyRate: String(a.hourlyRate ?? ""), overtimeRate: a.overtimeRate == null ? "" : String(a.overtimeRate),
      overtimeThreshold: a.overtimeThreshold == null ? "" : String(a.overtimeThreshold),
      weeklyLimit: a.weeklyLimit == null ? "" : String(a.weeklyLimit),
      paymentMethod: a.paymentMethod || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancel() { setEditId(null); setF(empty); setErr(""); }

  async function save() {
    setErr("");
    if (!f.employeeUid || !f.projectId) { setErr(t("mgr.asn.errPick")); return; }
    if (f.hourlyRate === "") { setErr(t("mgr.asn.errRate")); return; }
    const dup = assignments.find((a) => a.employeeUid === f.employeeUid && a.projectId === f.projectId && a.id !== editId);
    if (dup) { setErr(t("mgr.asn.errDup")); return; }
    const data = {
      employeeUid: f.employeeUid,
      projectId: f.projectId,
      hourlyRate: Number(f.hourlyRate) || 0,
      overtimeRate: f.overtimeRate === "" ? Number(f.hourlyRate) || 0 : Number(f.overtimeRate),
      overtimeThreshold: f.overtimeThreshold === "" ? null : Number(f.overtimeThreshold),
      weeklyLimit: f.weeklyLimit === "" ? null : Number(f.weeklyLimit),
      paymentMethod: f.paymentMethod || null,
    };
    try {
      if (editId) await updateAssignment(editId, data);
      else await insertAssignment(data);
      cancel();
    } catch (e) { const error = e as { message?: string } | null; setErr(error?.message || "Failed to save."); }
  }

  const pMap = new Map(projects.map((p) => [p.id, p]));
  const uMap = new Map(users.map((u) => [u.id, u]));

  return (
    <>
      <div className="card">
        <h2>{editId ? t("mgr.asn.editTitle") : t("mgr.asn.newTitle")}</h2>
        {err && <div className="banner err">{err}</div>}
        <div className="grid g2">
          <div>
            <label>{t("mgr.asn.employee")}</label>
            <select value={f.employeeUid} onChange={(e) => upd("employeeUid", e.target.value)}>
              <option value="">{t("mgr.asn.pick")}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.role === "admin" ? t("mgr.asn.managerSuffix") : ""}</option>)}
            </select>
          </div>
          <div>
            <label>{t("mgr.asn.project")}</label>
            <select value={f.projectId} onChange={(e) => upd("projectId", e.target.value)}>
              <option value="">{t("mgr.asn.pick")}</option>
              {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid g4" style={{ marginTop: 4 }}>
          <div><label>{t("mgr.asn.rate", { cur: APP_SETTINGS.currency })}</label><input type="number" value={f.hourlyRate} onChange={(e) => upd("hourlyRate", e.target.value)} placeholder="10" /></div>
          <div><label>{t("mgr.asn.otRate", { cur: APP_SETTINGS.currency })}</label><input type="number" value={f.overtimeRate} onChange={(e) => upd("overtimeRate", e.target.value)} placeholder="15" /></div>
          <div><label>{t("mgr.asn.otAfter")}</label><input type="number" value={f.overtimeThreshold} onChange={(e) => upd("overtimeThreshold", e.target.value)} placeholder="44" /></div>
          <div><label>{t("mgr.asn.weeklyLimit")}</label><input type="number" value={f.weeklyLimit} onChange={(e) => upd("weeklyLimit", e.target.value)} placeholder={t("mgr.asn.optional")} /></div>
        </div>
        <label style={{ marginTop: 4 }}>{t("mgr.asn.payMethod")}</label>
        <select value={f.paymentMethod} onChange={(e) => upd("paymentMethod", e.target.value)}>
          <option value="">{t("mgr.asn.none")}</option>
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={save}>{editId ? t("common.saveChanges") : t("mgr.asn.assign")}</button>
          {editId && <button className="btn-ghost" onClick={cancel}>{t("common.cancel")}</button>}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>{t("mgr.asn.foot")}</p>
      </div>

      <div className="card">
        <h2>{t("mgr.tab.assign")}</h2>
        {assignments.length === 0 ? <p className="muted">{t("mgr.asn.empty")}</p> : (
          <table>
            <thead>
              <tr>
                <th>{t("mgr.asn.employee")}</th><th>{t("mgr.asn.project")}</th><th className="right">{t("mgr.asn.colRate")}</th><th className="right">{t("mgr.asn.colOt")}</th>
                <th className="right">{t("mgr.asn.colOtAfter")}</th><th className="right">{t("mgr.asn.colLimit")}</th><th>{t("mgr.asn.colPay")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td>{uMap.get(a.employeeUid)?.fullName || "—"}</td>
                  <td>{pMap.get(a.projectId)?.name || "(deleted)"}</td>
                  <td className="right nowrap">{money(a.hourlyRate)}</td>
                  <td className="right nowrap">{money(a.overtimeRate)}</td>
                  <td className="right nowrap">{a.overtimeThreshold == null ? "—" : a.overtimeThreshold + "h"}</td>
                  <td className="right nowrap">{a.weeklyLimit == null ? "—" : a.weeklyLimit + "h"}</td>
                  <td className="small muted">{a.paymentMethod || "—"}</td>
                  <td className="right nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => startEdit(a)}>{t("common.edit")}</button>{" "}
                    <button className="btn-danger btn-sm" onClick={() => { if (confirm(t("mgr.asn.removeConfirm"))) removeAssignment(a.id); }}>{t("common.remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
