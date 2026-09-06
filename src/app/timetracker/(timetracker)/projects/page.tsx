"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { APP_SETTINGS, DAYS, money } from "@/lib/timetracker/helpers";
import type { Assignment, Employee, Project } from "@/lib/timetracker/types";
import { Modal } from "@/components/timetracker/Modal";

// Ported (D-071) from timetracker-clean's manager/ManagerProjects.jsx —
// create/edit projects, browse active + archived, per-project stats.
//
// D-NEXT (pedido del dueño: "el crear proyecto también que sea un botón"): el formulario de crear /
// editar ya no ocupa sitio permanente arriba; vive en la ventana de D-187 (Modal) y se abre con un
// botón junto al título de la lista, como en Asignaciones (D-187) y en los ajustes de Nómina (D-192).
// Editar abre la misma ventana rellena. Mismos campos, misma validación, misma llamada de guardado.
const PERIODS = ["weekly", "biweekly", "monthly"] as const;
const perKey = (v: string) => ({ weekly: "mgr.proj.weekly", biweekly: "mgr.proj.biweekly", monthly: "mgr.proj.monthly" } as Record<string, string>)[v] || "mgr.proj.weekly";

interface FormState { name: string; client: string; location: string; payPeriod: string; category: string; positions: string; weekStartDay: string }

export default function ManagerProjectsPage() {
  const { me, allProjects: projects, allAssignments: assignments, allEmployees: users, insertProject, updateProject } = useData();
  const t = useT();
  const periodLabel = (v: string) => t(perKey(v));
  const empty: FormState = { name: "", client: "", location: "", payPeriod: APP_SETTINGS.payPeriod || "weekly", category: "", positions: "", weekStartDay: "" };
  const [f, setF] = useState<FormState>(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const upd = <K extends keyof FormState>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));

  const uMap = new Map(users.map((u) => [u.id, u]));
  const assignedTo = (pid: string) => assignments.filter((a) => a.projectId === pid).map((a) => uMap.get(a.employeeUid)).filter((u): u is Employee => !!u);
  const posText = (p: Project) => (p.positions && p.positions.length ? p.positions.join(", ") : "");

  function startNew() { setEditId(null); setF(empty); setAbierta(true); }
  function startEdit(p: Project) {
    setEditId(p.id);
    setF({
      name: p.name || "", client: p.client || "", location: p.location || "",
      payPeriod: p.payPeriod || "weekly", category: p.category || "", positions: posText(p),
      weekStartDay: p.weekStartDay == null ? "" : String(p.weekStartDay),
    });
    // Antes hacía scrollTo(0) para llegar al formulario de arriba; la ventana va encima de donde
    // se está, así que ya no hace falta.
    setAbierta(true);
  }
  function cancel() { setAbierta(false); setEditId(null); setF(empty); }

  async function save() {
    if (f.name.trim().length < 2) return;
    const positions = f.positions.split(",").map((s) => s.trim()).filter(Boolean);
    const data: Partial<Project> = {
      name: f.name.trim(), client: f.client.trim(), location: f.location.trim(),
      payPeriod: f.payPeriod as Project["payPeriod"], category: f.category.trim(), positions,
      weekStartDay: f.weekStartDay === "" ? null : Number(f.weekStartDay),
    };
    if (editId) await updateProject(editId, data);
    else await insertProject({ ...data, archived: false });
    cancel();
  }

  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const cats = new Map<string, Project[]>();
  active.forEach((p) => { const c = p.category || t("mgr.proj.uncategorized"); if (!cats.has(c)) cats.set(c, []); cats.get(c)!.push(p); });
  const catNames = Array.from(cats.keys()).sort();

  function ProjectRow({ p }: { p: Project }) {
    const people = assignedTo(p.id);
    const pos = posText(p);
    return (
      <div className="box" style={{ marginTop: 8 }}>
        <div className="between">
          <div>
            <div style={{ fontWeight: 700 }}>
              {p.name} {p.category ? <span className="chip" style={{ marginLeft: 4 }}>{p.category}</span> : null}
            </div>
            <div className="small muted">
              {p.client ? p.client + " · " : ""}{p.location || "—"} · {periodLabel(p.payPeriod || "weekly")}
            </div>
            {pos ? <div className="small muted">{t("mgr.proj.positionsLabel", { pos })}</div> : null}
            <div className="small" style={{ marginTop: 2 }}>
              {t("mgr.proj.assigned")} {people.length ? people.map((u) => u.fullName).join(", ") : <span className="muted">{t("mgr.proj.nobody")}</span>}
            </div>
          </div>
          <div className="row">
            <button className="btn-ghost btn-sm" onClick={() => setOpenId(openId === p.id ? null : p.id)}>{openId === p.id ? t("common.hide") : t("common.stats")}</button>
            <button className="btn-ghost btn-sm" onClick={() => startEdit(p)}>{t("common.edit")}</button>
            <button className="btn-ghost btn-sm" onClick={() => updateProject(p.id, { archived: !p.archived })}>{p.archived ? t("common.restore") : t("common.archive")}</button>
          </div>
        </div>
        {openId === p.id && <ProjectStats project={p} assignments={assignments} />}
      </div>
    );
  }

  if (me.role !== "admin") return <div className="card"><p className="muted">{t("mgr.proj.adminsOnly")}</p></div>;

  return (
    <>
      {abierta && (
      <Modal title={editId ? t("mgr.proj.editTitle") : t("mgr.proj.newTitle")} onClose={cancel}>
        <div className="grid g2">
          <div><label>{t("mgr.proj.name")}</label><input value={f.name} onChange={(e) => upd("name", e.target.value)} placeholder={t("mgr.proj.namePh")} /></div>
          <div><label>{t("mgr.proj.client")}</label><input value={f.client} onChange={(e) => upd("client", e.target.value)} placeholder={t("mgr.proj.clientPh")} /></div>
        </div>
        <div className="grid g2">
          <div>
            <label>{t("mgr.proj.location")}</label>
            <input list="tt-locations" value={f.location} onChange={(e) => upd("location", e.target.value)} placeholder={t("mgr.proj.locationPh")} />
            <datalist id="tt-locations">{(APP_SETTINGS.locations || []).map((l) => <option key={l.name} value={l.name} />)}</datalist>
          </div>
          <div><label>{t("mgr.proj.category")}</label><input value={f.category} onChange={(e) => upd("category", e.target.value)} placeholder={t("mgr.proj.categoryPh")} /></div>
        </div>
        <div className="grid g2">
          <div>
            <label>{t("mgr.proj.payPeriod")}</label>
            <select value={f.payPeriod} onChange={(e) => upd("payPeriod", e.target.value)}>
              {PERIODS.map((v) => <option key={v} value={v}>{t(perKey(v))}</option>)}
            </select>
          </div>
          <div><label>{t("mgr.proj.positions")}</label><input value={f.positions} onChange={(e) => upd("positions", e.target.value)} placeholder={t("mgr.proj.positionsPh")} /></div>
        </div>
        <div className="grid g2">
          <div>
            <label>{t("mgr.proj.weekStart")}</label>
            <select value={f.weekStartDay} onChange={(e) => upd("weekStartDay", e.target.value)}>
              <option value="">{t("mgr.proj.useDefault")}</option>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div />
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={cancel}>{t("common.cancel")}</button>
          <button onClick={save}>{editId ? t("mgr.proj.saveChanges") : t("mgr.proj.create")}</button>
        </div>
      </Modal>
      )}

      <div className="card">
        <div className="between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{t("mgr.proj.listTitle")}</h2>
          <button onClick={startNew}>{t("mgr.proj.newBtn")}</button>
        </div>
        {active.length === 0 ? <p className="muted">{t("mgr.proj.noneActive")}</p> : catNames.map((c) => (
          <div key={c} style={{ marginBottom: 14 }}>
            <div className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>{c}</div>
            {cats.get(c)!.map((p) => <ProjectRow key={p.id} p={p} />)}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="between">
          <h2 style={{ margin: 0 }}>{t("mgr.proj.archiveTitle")} {archived.length ? "(" + archived.length + ")" : ""}</h2>
          <button className="btn-ghost btn-sm" onClick={() => setShowArchive((v) => !v)}>{showArchive ? t("common.hide") : t("common.show")}</button>
        </div>
        {showArchive && (archived.length === 0
          ? <p className="muted" style={{ marginTop: 10 }}>{t("mgr.proj.noneArchived")}</p>
          : <div style={{ marginTop: 10 }}>{archived.map((p) => <ProjectRow key={p.id} p={p} />)}</div>)}
      </div>
    </>
  );
}

function ProjectStats({ project, assignments }: { project: Project; assignments: Assignment[] }) {
  const { sessionsByProject } = useData();
  const t = useT();
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof sessionsByProject>> | null>(null);
  useEffect(() => {
    let live = true;
    sessionsByProject(project.id).then((rows) => { if (live) setSessions(rows); }).catch(() => { if (live) setSessions([]); });
    return () => { live = false; };
  }, [project.id, sessionsByProject]);

  const aMap = new Map(assignments.map((a) => [a.id, a]));
  if (sessions === null) return <div className="small muted" style={{ marginTop: 8 }}>{t("mgr.proj.loadingStats")}</div>;

  let sec = 0, spent = 0;
  sessions.forEach((s) => {
    sec += s.durationSeconds || 0;
    const a = s.assignmentId ? aMap.get(s.assignmentId) : undefined;
    const rate = a ? Number(a.hourlyRate || 0) : 0;
    spent += ((s.durationSeconds || 0) / 3600) * rate;
  });
  return (
    <div className="grid g3" style={{ marginTop: 10 }}>
      <div className="stat"><div className="n">{(sec / 3600).toFixed(2)} h</div><div className="l">{t("mgr.proj.hoursLogged")}</div></div>
      <div className="stat"><div className="n">{money(spent)}</div><div className="l">{t("mgr.proj.moneySpent")}</div></div>
      <div className="stat"><div className="n">{sessions.length}</div><div className="l">{t("mgr.proj.entries")}</div></div>
    </div>
  );
}
