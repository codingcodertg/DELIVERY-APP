"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { DEFAULT_SCALE } from "@/lib/recruiting/utils";
import type { ScaleLevel } from "@/lib/recruiting/types";
import { SCORECARDS } from "@/lib/recruiting/scorecards";

// Moves an array item and renumbers `value` 1..N to match the new order —
// used for both the global 1–4 scale and each question's custom scale.
function moveAndRenumber<T extends { value: number }>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((lvl, i) => ({ ...lvl, value: i + 1 }));
}

export default function QuestionsPage() {
  const {
    settings, roles, questions, questionSets, me,
    saveSettings, addQuestion, updateQuestion, deleteQuestion, duplicateQuestion, reorderQuestions,
    addQuestionSet, updateQuestionSet, deleteQuestionSet, importScorecard, notify,
  } = useData();
  const { t, lang } = usePrefs();
  const isAdmin = me?.role === "admin";
  const moveQuestion = (from: number, to: number) => {
    if (to < 0 || to >= setQuestions.length) return;
    const reordered = setQuestions.slice();
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    reorderQuestions(reordered.map((x) => x.id));
  };

  /* ---------- global scale editor ---------- */
  const [scale, setScale] = useState<ScaleLevel[]>(() => (settings.scale && settings.scale.length ? settings.scale : DEFAULT_SCALE));
  const setLevel = (idx: number, patch: Partial<ScaleLevel>) =>
    setScale((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const saveScale = () => { saveSettings({ scale }); notify(t("Scale saved ✓", "Escala guardada ✓")); };

  /* ---------- question sets ---------- */
  const defaultSet = questionSets.find((s) => s.is_default) ?? questionSets[0] ?? null;
  const [activeSetId, setActiveSetId] = useState<string | null>(defaultSet?.id ?? null);
  const activeSet = questionSets.find((s) => s.id === activeSetId) ?? defaultSet;
  const [newSet, setNewSet] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState("");

  /* ---------- questions of the active set ---------- */
  const setQuestions = useMemo(
    () => questions.filter((q) => (activeSet ? q.set_id === activeSet.id : !q.set_id)).sort((a, b) => a.sort - b.sort),
    [questions, activeSet],
  );
  const [qEn, setQEn] = useState("");
  const [qEs, setQEs] = useState("");
  const [qRole, setQRole] = useState("all");

  const addQ = () => {
    if (!qEn.trim() && !qEs.trim()) return;
    addQuestion({ text: qEn.trim() || qEs.trim(), text_es: qEs.trim() || null, role: qRole, active: true, set_id: activeSet?.id ?? null });
    setQEn(""); setQEs("");
    notify(t("Question added ✓", "Pregunta agregada ✓"));
  };

  /* ---------- bulk import ---------- */
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");

  // Split one line into cells: tab-separated (Google Sheets paste) or comma (CSV, quote-aware).
  const splitCells = (line: string): string[] => {
    if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
    const out: string[] = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim().replace(/^"|"$/g, ""));
  };

  const runImport = () => {
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { notify(t("Nothing to import", "Nada que importar")); return; }
    // Skip a header row if the first cell looks like a header.
    const first = splitCells(lines[0]).map((c) => c.toLowerCase());
    const hasHeader = first.some((c) => ["english", "inglés", "ingles", "spanish", "español", "espanol", "question", "pregunta", "role", "puesto"].includes(c));
    const body = hasHeader ? lines.slice(1) : lines;
    let n = 0;
    for (const line of body) {
      const [en, es, role] = splitCells(line);
      if (!en && !es) continue;
      const r = (role || "").trim();
      addQuestion({
        text: (en || es).trim(),
        text_es: (es || "").trim() || null,
        role: r && roles.includes(r) ? r : "all",
        active: true,
        set_id: activeSet?.id ?? null,
      });
      n++;
    }
    setImportText(""); setShowImport(false);
    notify(`${n} ${t("questions imported ✓", "preguntas importadas ✓")}`);
  };

  const toggleOverride = (qid: string, on: boolean) =>
    updateQuestion(qid, { scale: on ? (settings.scale && settings.scale.length ? settings.scale : DEFAULT_SCALE) : null });

  return (
    <div>
      {/* ---------- Scoring scale ---------- */}
      <div className="card">
        <h2>🎚️ {t("Scoring scale (1–4)", "Escala de calificación (1–4)")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          {t("Every question is scored on this 1–4 scale. Define what each number means, with an example, in both languages. Shown to the interviewer on each question.", "Cada pregunta se califica en esta escala 1–4. Define qué significa cada número, con un ejemplo, en ambos idiomas. Se muestra al entrevistador en cada pregunta.")}
        </div>
        {!isAdmin && <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>{t("Only an admin can edit the scale.", "Solo un administrador puede editar la escala.")}</div>}
        {isAdmin && <div className="hint" style={{ marginTop: -4, marginBottom: 4 }}>{t("Use ▲▼ to reorder — the number updates to match.", "Usa ▲▼ para reordenar — el número se actualiza.")}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {scale.map((lvl, i) => (
            <div
              key={lvl.value}
              className="q-block"
              style={{ display: "grid", gridTemplateColumns: "20px 34px 1fr 1fr", gap: 8, alignItems: "start" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", paddingTop: 2 }}>
                {isAdmin && <>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", lineHeight: 1.2 }} disabled={i === 0} onClick={() => setScale((s) => moveAndRenumber(s, i, i - 1))} title={t("Move up", "Subir")}>▲</button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", lineHeight: 1.2 }} disabled={i === scale.length - 1} onClick={() => setScale((s) => moveAndRenumber(s, i, i + 1))} title={t("Move down", "Bajar")}>▼</button>
                </>}
              </div>
              <div style={{ fontWeight: 800, fontSize: 20, color: "var(--accent)", textAlign: "center" }}>{lvl.value}</div>
              <div>
                <label>🇬🇧 {t("Label", "Etiqueta")}</label>
                <input disabled={!isAdmin} value={lvl.label_en} onChange={(e) => setLevel(i, { label_en: e.target.value })} />
                <label style={{ marginTop: 6 }}>🇬🇧 {t("Example", "Ejemplo")}</label>
                <input disabled={!isAdmin} value={lvl.example_en} onChange={(e) => setLevel(i, { example_en: e.target.value })} />
              </div>
              <div>
                <label>🇪🇸 {t("Label", "Etiqueta")}</label>
                <input disabled={!isAdmin} value={lvl.label_es} onChange={(e) => setLevel(i, { label_es: e.target.value })} />
                <label style={{ marginTop: 6 }}>🇪🇸 {t("Example", "Ejemplo")}</label>
                <input disabled={!isAdmin} value={lvl.example_es} onChange={(e) => setLevel(i, { example_es: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={saveScale}>{t("Save scale", "Guardar escala")}</button>
            <button className="btn btn-ghost" onClick={() => setScale(DEFAULT_SCALE)}>{t("Reset to default", "Restablecer")}</button>
          </div>
        )}
      </div>

      {/* ---------- Question sets / banks ---------- */}
      <div className="card">
        <h2>📚 {t("Question sets (banks / templates)", "Conjuntos de preguntas (bancos / plantillas)")}</h2>
        <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
          {t("Group questions into sets. Mark one as the default. Attach a set to an open position in Settings → Job openings; interviews for candidates on that job use its set.", "Agrupa preguntas en conjuntos. Marca uno como predeterminado. Asigna un conjunto a una vacante en Ajustes → Vacantes; las entrevistas de candidatos en esa vacante usan su conjunto.")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {questionSets.map((s) => (
            <button
              key={s.id}
              className={"chip " + (activeSet?.id === s.id ? "on" : "")}
              onClick={() => { setActiveSetId(s.id); setRenaming(false); }}
            >
              {s.is_default ? "★ " : ""}{s.name} ({questions.filter((q) => q.set_id === s.id).length})
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder={t("New set name (e.g. Sales screening)…", "Nombre del conjunto (p. ej. Filtro de Ventas)…")} value={newSet} onChange={(e) => setNewSet(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newSet.trim()) { addQuestionSet(newSet.trim()); setNewSet(""); } }} />
          <button className="btn btn-primary" onClick={() => { if (newSet.trim()) { addQuestionSet(newSet.trim()); setNewSet(""); } }}>{t("Add set", "Agregar conjunto")}</button>
        </div>

        {/* ---------- Ready-made scorecards ---------- */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line, #e5e7eb)" }}>
          <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
            {t("Ready-made scorecards — one click loads a full role set with bilingual questions and a custom 1–4 rubric per question. Creates the role and set if needed.", "Escalas listas — un clic carga un conjunto completo para un puesto, con preguntas bilingües y una escala 1–4 propia por pregunta. Crea el puesto y el conjunto si hace falta.")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SCORECARDS.map((sc) => (
              // Wrap in a span so the tooltip fires: browsers suppress hover/title
              // events on a disabled <button>, so a non-admin would get no feedback.
              <span
                key={sc.set_name}
                title={isAdmin ? undefined : t("Only an admin can load scorecards.", "Solo un administrador puede cargar escalas.")}
                style={{ display: "inline-block", cursor: isAdmin ? undefined : "not-allowed" }}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!isAdmin}
                  onClick={async () => {
                    if (!confirm(t(`Load the "${sc.set_name}" scorecard? This adds ${sc.items.length} questions (role "${sc.role}").`, `¿Cargar la escala "${sc.set_name}"? Agrega ${sc.items.length} preguntas (puesto "${sc.role}").`))) return;
                    const n = await importScorecard(sc);
                    if (n > 0) { const s = questionSets.find((x) => x.name === sc.set_name); if (s) setActiveSetId(s.id); }
                  }}
                >
                  📋 {t("Load", "Cargar")} “{sc.set_name}” ({sc.items.length})
                </button>
              </span>
            ))}
          </div>
        </div>

        {activeSet && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line, #e5e7eb)" }}>
            {renaming ? (
              <>
                <input value={rename} autoFocus onChange={(e) => setRename(e.target.value)} style={{ width: 220 }}
                  onKeyDown={(e) => { if (e.key === "Enter") { updateQuestionSet(activeSet.id, { name: rename.trim() || activeSet.name }); setRenaming(false); } }} />
                <button className="btn btn-primary btn-sm" onClick={() => { updateQuestionSet(activeSet.id, { name: rename.trim() || activeSet.name }); setRenaming(false); }}>{t("Save", "Guardar")}</button>
                <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={() => setRenaming(false)}>{t("Cancel", "Cancelar")}</button>
              </>
            ) : (
              <>
                <b style={{ fontSize: 15 }}>{activeSet.name}</b>
                {activeSet.is_default && <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{t("Default", "Predeterminado")}</span>}
                <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                  <span className="hint" style={{ margin: 0 }}>{t("Position:", "Puesto:")}</span>
                  <select
                    value={activeSet.role ?? ""}
                    disabled={!isAdmin}
                    title={isAdmin ? undefined : t("Only an admin can change this.", "Solo un administrador puede cambiar esto.")}
                    onChange={(e) => updateQuestionSet(activeSet.id, { role: e.target.value || null })}
                    style={{ width: "auto" }}
                  >
                    <option value="">{t("— General (any position) —", "— General (cualquier puesto) —")}</option>
                    {roles.map((r) => {
                      // A position can only have one set, so show which are spoken for.
                      const taken = questionSets.find((s) => s.role === r && s.id !== activeSet.id);
                      return (
                        <option key={r} value={r} disabled={!!taken}>
                          {r}{taken ? ` — ${t("used by", "usado por")} “${taken.name}”` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <button className="btn btn-ghost btn-sm" onClick={() => { setRename(activeSet.name); setRenaming(true); }}>✏️ {t("Rename", "Renombrar")}</button>
                {!activeSet.is_default && <button className="btn btn-ghost btn-sm" onClick={() => updateQuestionSet(activeSet.id, { is_default: true })}>★ {t("Make default", "Hacer predeterminado")}</button>}
                {!activeSet.is_default && questionSets.length > 1 && (
                  <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(t("Delete this set? Its questions become unassigned.", "¿Eliminar este conjunto? Sus preguntas quedan sin asignar."))) { deleteQuestionSet(activeSet.id); setActiveSetId(defaultSet?.id ?? null); } }}>🗑 {t("Delete", "Eliminar")}</button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ---------- Questions in the active set ---------- */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>❓ {t("Questions in", "Preguntas en")} “{activeSet?.name ?? "—"}”</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport((v) => !v)} disabled={!activeSet}>📥 {t("Import from sheet", "Importar de hoja")}</button>
        </div>
        <div className="hint" style={{ marginTop: 4, marginBottom: 10 }}>
          {t("Enter each question in both languages. The interview shows whichever matches the active language.", "Escribe cada pregunta en ambos idiomas. La entrevista muestra la que coincide con el idioma activo.")}
        </div>
        {showImport && (
          <div style={{ padding: 12, background: "var(--paper)", borderRadius: 10, marginBottom: 12 }}>
            <label>{t("Paste from Google Sheets / Excel / CSV", "Pega desde Google Sheets / Excel / CSV")}</label>
            <div className="hint" style={{ marginTop: 2, marginBottom: 6 }}>
              {t("One question per line, columns: English → Spanish → role (role optional). Copy-paste straight from a spreadsheet (tabs) or paste CSV. A header row is auto-detected.", "Una pregunta por línea, columnas: Inglés → Español → puesto (puesto opcional). Copia y pega directo de una hoja (tabuladores) o pega CSV. Se detecta una fila de encabezado.")}
            </div>
            <textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)}
              placeholder={"English\tSpanish\tRole\nTell me about your experience\tCuéntame sobre tu experiencia\tSales"} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={runImport}>{t("Import into this set", "Importar a este conjunto")}</button>
              <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={() => { setShowImport(false); setImportText(""); }}>{t("Cancel", "Cancelar")}</button>
            </div>
          </div>
        )}
        <div className="grid g2" style={{ marginBottom: 10 }}>
          <div><label>🇬🇧 {t("Question (English)", "Pregunta (inglés)")}</label><input value={qEn} onChange={(e) => setQEn(e.target.value)} placeholder={t("Type in English…", "Escribe en inglés…")} /></div>
          <div><label>🇪🇸 {t("Question (Spanish)", "Pregunta (español)")}</label><input value={qEs} onChange={(e) => setQEs(e.target.value)} placeholder={t("Type in Spanish…", "Escribe en español…")} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: "0 0 220px" }}>
            <label>{t("Applies to", "Aplica a")}</label>
            <select value={qRole} onChange={(e) => setQRole(e.target.value)}>
              <option value="all">{t("All roles", "Todos los puestos")}</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={addQ} disabled={!activeSet}>{t("Add question", "Agregar pregunta")}</button>
        </div>

        <div style={{ marginTop: 16 }}>
          {setQuestions.length === 0 && <div className="empty">{t("No questions in this set yet.", "Aún no hay preguntas en este conjunto.")}</div>}
          {setQuestions.length > 1 && <div className="hint" style={{ marginBottom: 8 }}>{t("Use ▲▼ to reorder.", "Usa ▲▼ para reordenar.")}</div>}
          {setQuestions.map((q, i) => (
            <div
              key={q.id}
              className="q-block"
              style={{ opacity: q.active ? 1 : 0.5 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 20px", display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-start", paddingTop: 2 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", lineHeight: 1.2 }} disabled={i === 0} onClick={() => moveQuestion(i, i - 1)} title={t("Move up", "Subir")}>▲</button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", lineHeight: 1.2 }} disabled={i === setQuestions.length - 1} onClick={() => moveQuestion(i, i + 1)} title={t("Move down", "Bajar")}>▼</button>
                </div>
                <div style={{ flex: "1 1 320px" }}>
                  <div className="q-text" style={{ marginBottom: 4, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                    {q.category && <span className="badge" style={{ background: "var(--tint-indigo)", color: "var(--indigo)", fontWeight: 700 }}>🏷 {q.category}</span>}
                    <span>{i + 1}. {lang === "es" ? (q.text_es?.trim() || q.text) : q.text}</span>
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "var(--gray)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 2 }}>🏷 {t("Tag / dimension", "Etiqueta / dimensión")}</div>
                    <input style={{ width: "100%", maxWidth: 260, fontSize: 12, padding: "4px 8px" }} defaultValue={q.category ?? ""} placeholder={t("e.g. Trust Level", "p. ej. Confianza")}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (q.category ?? "")) updateQuestion(q.id, { category: v || null }); }} />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                    <div style={{ flex: "1 1 200px" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--gray)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 2 }}>🇬🇧 English</div>
                      <input style={{ width: "100%", fontSize: 12, padding: "4px 8px" }} defaultValue={q.text} placeholder={t("English text", "Texto en inglés")}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== q.text) updateQuestion(q.id, { text: v }); }} />
                    </div>
                    <div style={{ flex: "1 1 200px" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--gray)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 2 }}>🇪🇸 Español</div>
                      <input style={{ width: "100%", fontSize: 12, padding: "4px 8px" }} defaultValue={q.text_es ?? ""} placeholder={t("Spanish text", "Texto en español")}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (q.text_es ?? "")) updateQuestion(q.id, { text_es: v || null }); }} />
                    </div>
                  </div>
                  <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{q.role === "all" ? t("All roles", "Todos los puestos") : q.role}</span>
                  {!q.text_es && <span className="badge" style={{ marginLeft: 6, background: "var(--tint-red-soft)", color: "var(--red)" }}>⚠ {t("no Spanish", "sin español")}</span>}
                  <label style={{ marginLeft: 8, display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12, textTransform: "none", margin: 0 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={!!(q.scale && q.scale.length)} onChange={(e) => toggleOverride(q.id, e.target.checked)} />
                    {t("Custom scale", "Escala propia")}
                  </label>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => duplicateQuestion(q.id)} title={t("Duplicate — inserts a copy right after this question", "Duplicar — inserta una copia justo después de esta pregunta")}>⧉ {t("Duplicate", "Duplicar")}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => updateQuestion(q.id, { active: !q.active })}>{q.active ? t("Deactivate", "Desactivar") : t("Activate", "Activar")}</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteQuestion(q.id)}>🗑</button>
                </div>
              </div>
              {q.scale && q.scale.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="hint" style={{ margin: 0 }}>{t("Custom scale labels for this question (use ▲▼ to reorder):", "Etiquetas de escala propias para esta pregunta (usa ▲▼ para reordenar):")}</div>
                  {q.scale.map((lvl, li) => (
                    <div
                      key={`${li}-${lvl.label_en}-${lvl.label_es}`}
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", lineHeight: 1.2 }} disabled={li === 0} onClick={() => updateQuestion(q.id, { scale: moveAndRenumber(q.scale!, li, li - 1) })} title={t("Move up", "Subir")}>▲</button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", lineHeight: 1.2 }} disabled={li === q.scale!.length - 1} onClick={() => updateQuestion(q.id, { scale: moveAndRenumber(q.scale!, li, li + 1) })} title={t("Move down", "Bajar")}>▼</button>
                      <b style={{ width: 20, textAlign: "center" }}>{lvl.value}</b>
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--gray)" }}>🇬🇧</span>
                      <input style={{ fontSize: 12, padding: "3px 6px" }} defaultValue={lvl.label_en} placeholder={t("English", "Inglés")}
                        onBlur={(e) => { const next = q.scale!.map((x, j) => j === li ? { ...x, label_en: e.target.value } : x); updateQuestion(q.id, { scale: next }); }} />
                      <span style={{ fontSize: 10, fontWeight: 800, color: "var(--gray)" }}>🇪🇸</span>
                      <input style={{ fontSize: 12, padding: "3px 6px" }} defaultValue={lvl.label_es} placeholder={t("Spanish", "Español")}
                        onBlur={(e) => { const next = q.scale!.map((x, j) => j === li ? { ...x, label_es: e.target.value } : x); updateQuestion(q.id, { scale: next }); }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
