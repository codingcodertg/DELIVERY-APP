"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { fmtPct, pctToScore } from "@/lib/recruiting/utils";
import { createClient } from "@/lib/recruiting/supabase/client";

export default function SettingsPage() {
  const { t } = usePrefs();
  const {
    settings, roles, templates, customFields, recruiters, me, jobs, candidates, stages, questionSets,
    saveSettings,
    addTemplate, deleteTemplate, addCustomField, deleteCustomField, notify,
    addJob, updateJob, deleteJob, addStage, updateStage, deleteStage,
  } = useData();
  const supabase = createClient();
  const [stageLabel, setStageLabel] = useState("");

  const moveStage = (idx: number, dir: -1 | 1) => {
    const a = stages[idx];
    const b = stages[idx + dir];
    if (!a || !b) return;
    updateStage(a.id, { sort: b.sort });
    updateStage(b.id, { sort: a.sort });
  };

  // job / requisition form
  const [jTitle, setJTitle] = useState("");
  const [jRole, setJRole] = useState(roles[0] ?? "");
  const [jOpenings, setJOpenings] = useState(1);
  const [jTarget, setJTarget] = useState("");
  const [jSet, setJSet] = useState("");
  const jobCount = (jobId: string) => candidates.filter((c) => c.job_id === jobId && !c.archived).length;

  // account: display name + password
  const [displayName, setDisplayName] = useState(me?.full_name ?? "");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const saveName = async () => {
    if (!me) return;
    // profiles lives in public, not recruiting (this client defaults to recruiting).
    const { error } = await supabase.schema("public").from("profiles").update({ full_name: displayName.trim() }).eq("id", me.id);
    notify(error ? "Error: " + error.message : t("Name saved ✓", "Nombre guardado ✓"));
  };
  const changePassword = async () => {
    if (pw1.length < 6) { notify(t("Password must be at least 6 characters", "La contraseña debe tener al menos 6 caracteres")); return; }
    if (pw1 !== pw2) { notify(t("Passwords don't match", "Las contraseñas no coinciden")); return; }
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    if (error) { notify("Error: " + error.message); return; }
    setPw1(""); setPw2(""); notify(t("Password changed ✓", "Contraseña cambiada ✓"));
  };

  const [appName, setAppName] = useState(settings.app_name);
  const [newRole, setNewRole] = useState("");
  const [cfLabel, setCfLabel] = useState("");
  const [tplLabel, setTplLabel] = useState("");
  const [tplText, setTplText] = useState("");

  const addRole = () => {
    const r = newRole.trim();
    if (!r || roles.includes(r)) return;
    saveSettings({ roles: [...roles, r] });
    setNewRole("");
  };
  const removeRole = (r: string) => saveSettings({ roles: roles.filter((x) => x !== r) });

  return (
    <div>
      <div className="card">
        <h2>👤 {t("My account", "Mi cuenta")}</h2>
        <div className="grid g2">
          <div>
            <label>{t("Display name", "Nombre visible")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("Your name", "Tu nombre")} />
              <button className="btn btn-primary" onClick={saveName}>{t("Save", "Guardar")}</button>
            </div>
          </div>
        </div>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <div><label>{t("New password", "Nueva contraseña")}</label><input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="••••••••" /></div>
          <div><label>{t("Confirm password", "Confirmar contraseña")}</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" /></div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-primary" onClick={changePassword}>{t("Change password", "Cambiar contraseña")}</button>
          </div>
        </div>
        <div className="hint">{t("Your password updates immediately — no email needed while you're signed in.", "Tu contraseña se actualiza de inmediato — no se necesita correo mientras estés conectado.")}</div>
      </div>

      <div className="card">
        <h2>🏷️ {t("App name", "Nombre de la app")}</h2>
        {me?.role === "admin" ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 240px" }}>
                <label>{t("Name shown at the top", "Nombre mostrado arriba")}</label>
                <input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="RECRUIT·HN"
                  onKeyDown={(e) => e.key === "Enter" && saveSettings({ app_name: appName.trim() || "RECRUIT·HN" })} />
              </div>
              <button className="btn btn-primary" onClick={() => { saveSettings({ app_name: appName.trim() || "RECRUIT·HN" }); notify(t("Name updated ✓", "Nombre actualizado ✓")); }}>{t("Save name", "Guardar nombre")}</button>
            </div>
            <div className="hint">{t("Shown in the app's top bar (synced for the whole team).", "Se muestra en la barra superior (sincronizado para todo el equipo).")}</div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{settings.app_name}</div>
            <div className="hint">{t("Only an admin can change the app name.", "Solo un administrador puede cambiar el nombre de la app.")}</div>
          </>
        )}
      </div>

      <div className="card">
        <h2>💼 {t("Roles", "Puestos")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {roles.map((r) => (
            <span key={r} className="chip on" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {r}
              <button style={{ color: "#fff", fontWeight: 800 }} onClick={() => removeRole(r)}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder={t("New role...", "Nuevo puesto...")} value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRole()} />
          <button className="btn btn-primary" onClick={addRole}>{t("Add", "Agregar")}</button>
        </div>
      </div>

      <div className="card">
        <h2>❓ {t("Interview questions", "Preguntas de entrevista")}</h2>
        <div className="hint" style={{ marginTop: -6 }}>
          {t("Questions, scoring scale, and question sets now live in the dedicated Questions tab.", "Las preguntas, la escala de calificación y los conjuntos de preguntas ahora están en la pestaña Preguntas.")}
        </div>
        <a className="btn btn-ghost btn-sm" href="/recruiting/questions" style={{ marginTop: 8, display: "inline-block" }}>❓ {t("Open Questions", "Abrir Preguntas")}</a>
      </div>

      <div className="card">
        <h2>🪜 {t("Pipeline stages", "Etapas del proceso")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          {t("Rename, recolor, reorder, and set an SLA (max days) per stage. You can add your own active stages (e.g. \"Assessment\"). The Hired & Discarded stages are fixed.", "Renombra, cambia color, reordena y define un SLA (días máx.) por etapa. Puedes agregar tus propias etapas activas (p. ej. \"Evaluación\"). Las etapas Contratado y Descartado son fijas.")}
        </div>
        {stages.map((s, i) => (
          <div key={s.id} className="cand-row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input type="color" value={s.color} onChange={(e) => updateStage(s.id, { color: e.target.value })} style={{ width: 34, height: 30, padding: 2 }} title="Color" />
            <input value={s.label} onChange={(e) => updateStage(s.id, { label: e.target.value })} style={{ flex: "1 1 160px" }} />
            <span className="sema" style={{ background: s.color + "22", color: s.color }}>{s.type}</span>
            {s.type === "active" && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, margin: 0, textTransform: "none", fontSize: 12 }}>
                SLA
                <input type="number" min={0} value={s.max_days ?? ""} placeholder="—" onChange={(e) => updateStage(s.id, { max_days: e.target.value ? Number(e.target.value) : null })} style={{ width: 60 }} />
                d
              </label>
            )}
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveStage(i, -1)}>↑</button>
              <button className="btn btn-ghost btn-sm" disabled={i === stages.length - 1} onClick={() => moveStage(i, 1)}>↓</button>
              {s.type === "active" && <button className="btn btn-danger btn-sm" onClick={() => deleteStage(s.id)}>🗑</button>}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input placeholder={t("New stage name (e.g. Assessment)...", "Nombre de nueva etapa (p. ej. Evaluación)...")} value={stageLabel} onChange={(e) => setStageLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && stageLabel.trim() && (addStage({ label: stageLabel.trim() }), setStageLabel(""))} />
          <button className="btn btn-primary" onClick={() => { if (stageLabel.trim()) { addStage({ label: stageLabel.trim() }); setStageLabel(""); } }}>{t("Add stage", "Agregar etapa")}</button>
        </div>
      </div>

      <div className="card">
        <h2>📌 {t("Job openings (requisitions)", "Vacantes (requisiciones)")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          {t("Open positions you're hiring for. Assign candidates to a job and set a target score (the \"ideal profile\" minimum) to see how each candidate compares.", "Posiciones abiertas que estás contratando. Asigna candidatos a una vacante y define un puntaje objetivo (el mínimo del \"perfil ideal\") para ver cómo se compara cada candidato.")}
        </div>
        {jobs.map((j) => (
          <div key={j.id} className="cand-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <b>{j.title}</b>{" "}
              <span className="sema" style={{ background: j.status === "open" ? "var(--tint-green)" : "var(--tint-neutral)", color: j.status === "open" ? "var(--green)" : "var(--gray)" }}>
                {j.status === "open" ? t("Open", "Abierta") : t("Closed", "Cerrada")}
              </span>
              <div className="cand-meta">
                {j.role && <span>💼 {j.role}</span>}
                <span>🎯 {j.openings} {t(j.openings !== 1 ? "openings" : "opening", j.openings !== 1 ? "vacantes" : "vacante")}</span>
                {j.target_score != null && <span>🎯 {t("target", "objetivo")} {fmtPct(Number(j.target_score))}</span>}
                {j.question_set_id && <span>📚 {questionSets.find((s) => s.id === j.question_set_id)?.name ?? "—"}</span>}
                <span>👥 {jobCount(j.id)} {t("candidates", "candidatos")}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => updateJob(j.id, { status: j.status === "open" ? "closed" : "open" })}>
                {j.status === "open" ? t("Close", "Cerrar") : t("Reopen", "Reabrir")}
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(t("Delete job ", "¿Eliminar vacante ") + j.title + "?")) deleteJob(j.id); }}>🗑</button>
            </div>
          </div>
        ))}
        <div className="grid g3" style={{ marginTop: 10 }}>
          <div><label>{t("Title", "Título")}</label><input value={jTitle} onChange={(e) => setJTitle(e.target.value)} placeholder={t("e.g. Dispatcher - Night shift", "p. ej. Despachador - Turno nocturno")} /></div>
          <div>
            <label>{t("Role", "Puesto")}</label>
            <select value={jRole} onChange={(e) => setJRole(e.target.value)}>
              <option value="">—</option>
              {roles.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="grid g2" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label>{t("Openings", "Vacantes")}</label><input type="number" min={1} value={jOpenings} onChange={(e) => setJOpenings(Number(e.target.value))} /></div>
            <div><label>{t("Target %", "Objetivo %")}</label><input type="number" min={25} max={100} step={5} value={jTarget} onChange={(e) => setJTarget(e.target.value)} placeholder="75" /></div>
          </div>
          <div>
            <label>📚 {t("Question set", "Conjunto de preguntas")}</label>
            <select value={jSet} onChange={(e) => setJSet(e.target.value)}>
              <option value="">{t("Default set", "Conjunto predeterminado")}</option>
              {questionSets.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_default ? t(" (default)", " (predeterminado)") : ""}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => {
            if (!jTitle.trim()) return;
            addJob({ title: jTitle.trim(), role: jRole || null, openings: jOpenings, target_score: jTarget ? pctToScore(Number(jTarget)) : null, question_set_id: jSet || null, status: "open" });
            setJTitle(""); setJTarget(""); setJOpenings(1); setJSet("");
          }}>{t("Add job", "Agregar vacante")}</button>
        </div>
      </div>

      <div className="card">
        <h2>🧑‍💼 {t("Recruiters", "Reclutadores")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          {t("Recruiters are the people signed into this workspace. Invite a teammate by having them create an account on the login screen.", "Los reclutadores son las personas conectadas a este espacio. Invita a un compañero pidiéndole que cree una cuenta en la pantalla de inicio de sesión.")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {recruiters.length === 0 && <span className="hint" style={{ margin: 0 }}>{t("No recruiters yet.", "Aún no hay reclutadores.")}</span>}
          {recruiters.map((r) => (
            <span key={r.id} className="chip on">{r.full_name}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>🧩 {t("Custom fields", "Campos personalizados")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>{t("Extra fields shown in the registration form and comparison (e.g. \"Years of experience\").", "Campos adicionales que se muestran en el formulario de registro y en la comparación (p. ej. \"Años de experiencia\").")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {customFields.map((cf) => (
            <span key={cf.id} className="chip on" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {cf.label}
              <button style={{ color: "#fff", fontWeight: 800 }} onClick={() => deleteCustomField(cf.id)}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder={t("Field label...", "Nombre del campo...")} value={cfLabel} onChange={(e) => setCfLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cfLabel.trim() && (addCustomField(cfLabel.trim()), setCfLabel(""))} />
          <button className="btn btn-primary" onClick={() => { if (cfLabel.trim()) { addCustomField(cfLabel.trim()); setCfLabel(""); } }}>{t("Add", "Agregar")}</button>
        </div>
      </div>

      <div className="card">
        <h2>💬 {t("Message templates", "Plantillas de mensaje")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>{t("Use placeholders", "Usa los marcadores")} {"{name} {role} {recruiter} {phone}"} — {t("they auto-fill when you send a message.", "se completan solos al enviar un mensaje.")}</div>
        {templates.map((t) => (
          <div key={t.id} className="tpl-item">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <b>{t.label}</b>
              <button className="btn btn-danger btn-sm" onClick={() => deleteTemplate(t.id)}>🗑</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--gray)", marginTop: 4 }}>{t.text}</div>
          </div>
        ))}
        <div className="grid g2" style={{ marginTop: 10 }}>
          <div><label>{t("Label", "Etiqueta")}</label><input value={tplLabel} onChange={(e) => setTplLabel(e.target.value)} placeholder={t("e.g. Invite to call", "p. ej. Invitar a llamada")} /></div>
          <div><label>{t("Message", "Mensaje")}</label><input value={tplText} onChange={(e) => setTplText(e.target.value)} placeholder={t("Hi {name}, ...", "Hola {name}, ...")} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => { if (tplLabel.trim() && tplText.trim()) { addTemplate({ label: tplLabel.trim(), text: tplText.trim() }); setTplLabel(""); setTplText(""); notify(t("Template added ✓", "Plantilla agregada ✓")); } }}>{t("Add template", "Agregar plantilla")}</button>
        </div>
      </div>
    </div>
  );
}
