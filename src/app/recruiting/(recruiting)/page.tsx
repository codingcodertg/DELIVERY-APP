"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { useUI } from "@/components/recruiting/ModalHost";
import { CandidateRow } from "@/components/recruiting/CandidateRow";
import type { Candidate } from "@/lib/recruiting/types";
import { downloadCSV, fmtDate, fmtPct, normalizeName, telClean, toCSV, todayISO } from "@/lib/recruiting/utils";
import { stageOf } from "@/lib/recruiting/constants";

export default function CandidatesPage() {
  const { candidates, roles, me, jobs, recruiters, stages, addCandidate, updateCandidate, addContact, deleteCandidate, notify } = useData();
  const { t } = usePrefs();
  const ui = useUI();

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const [onlyInterviewed, setOnlyInterviewed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [showCsv, setShowCsv] = useState(false);
  const [csv, setCsv] = useState("");
  // bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // #26 saved filters (views) — persisted in the browser
  type SavedView = { name: string; filter: string; onlyFav: boolean; onlyInterviewed?: boolean; showArchived: boolean; tagFilter: string; jobFilter: string; search: string };
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("recruit_saved_views");
      if (raw) setViews(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  const persistViews = (next: SavedView[]) => {
    setViews(next);
    try { localStorage.setItem("recruit_saved_views", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const saveView = () => {
    const name = prompt(t("Name this view (e.g. 'My overdue Sales'):", "Nombra esta vista (p. ej. 'Mis Ventas atrasadas'):"));
    if (!name || !name.trim()) return;
    const v: SavedView = { name: name.trim(), filter, onlyFav, onlyInterviewed, showArchived, tagFilter, jobFilter, search };
    persistViews([...views.filter((x) => x.name !== v.name), v]);
    notify(t("View saved ✓", "Vista guardada ✓"));
  };
  const applyView = (v: SavedView) => {
    setFilter(v.filter); setOnlyFav(v.onlyFav); setOnlyInterviewed(v.onlyInterviewed ?? false); setShowArchived(v.showArchived);
    setTagFilter(v.tagFilter); setJobFilter(v.jobFilter); setSearch(v.search);
  };
  const deleteView = (name: string) => persistViews(views.filter((x) => x.name !== name));

  const dupOf = (phone: string, email: string, name?: string) =>
    candidates.find(
      (c) =>
        (phone && telClean(c.phone) === telClean(phone)) ||
        (email && (c.email || "").toLowerCase() === email.toLowerCase()) ||
        (name && normalizeName(c.name) === normalizeName(name)),
    );

  const allTags = Array.from(new Set(candidates.flatMap((c) => c.tags))).sort();

  const base = (extra: Partial<Candidate>): Partial<Candidate> => ({
    status: "registered",
    favorite: false,
    custom: {},
    prescreen: {},
    assigned_recruiter: me?.id ?? null,
    ...extra,
  });

  const parseLine = (l: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };

  const importCsv = async () => {
    const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!rows.length) { notify(t("Nothing to import", "Nada que importar")); return; }
    const first = parseLine(rows[0]).map((x) => x.toLowerCase());
    const hasHeader = first.some((h) => ["name", "nombre", "phone", "telefono", "email"].includes(h));
    const body = hasHeader ? rows.slice(1) : rows;
    let added = 0;
    let dups = 0;
    const seen = new Set<string>();
    for (const l of body) {
      const [name, phone, email, role, source, homeLocation] = parseLine(l);
      if (!name || !phone) continue;
      const key = telClean(phone);
      if (dupOf(phone, email) || seen.has(key)) { dups++; continue; }
      seen.add(key);
      await addCandidate(
        base({
          name,
          phone,
          email: email || null,
          role: role || roles[0] || null,
          source: source || "Indeed",
          home_location: homeLocation || null,
        }),
      );
      added++;
    }
    setCsv("");
    setShowCsv(false);
    notify(t(`${added} imported${dups ? `, ${dups} duplicates skipped` : ""} ✓`, `${added} importados${dups ? `, ${dups} duplicados omitidos` : ""} ✓`));
  };

  const list = candidates
    .filter((c) => showArchived ? c.archived : !c.archived)
    .filter((c) => filter === "all" || c.status === filter)
    .filter((c) => !onlyFav || c.favorite)
    .filter((c) => !onlyInterviewed || !!c.interview)
    .filter((c) => !tagFilter || c.tags.includes(tagFilter))
    .filter((c) => !jobFilter || c.job_id === jobFilter)
    .filter(
      (c) =>
        !search ||
        (c.name + c.phone + (c.email || "") + (c.role || "") + (c.home_location || "") + c.tags.join(" ")).toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      onlyInterviewed
        ? (b.interview?.date || "").localeCompare(a.interview?.date || "") // most recent interview first
        : Number(b.pinned) - Number(a.pinned), // pinned first
    );

  const recName = (id: string | null) => recruiters.find((r) => r.id === id)?.full_name ?? "";
  const exportRows = (rows0: Candidate[]) => {
    const headers = ["Name", "Phone", "Email", "Role", "Home location", "Source", "Status", "Score", "Registered", "Recruiter", "Job", "Tags", "Follow-up", "Offer status", "Offer salary"];
    const rows = rows0.map((c) => [
      c.name, c.phone, c.email, c.role, c.home_location, c.source, stageOf(stages, c.status).label,
      fmtPct(c.interview?.average, ""),
      fmtDate(c.reg_date), recName(c.assigned_recruiter),
      jobs.find((j) => j.id === c.job_id)?.title ?? "", c.tags.join("; "),
      c.follow_up ? fmtDate(c.follow_up) : "", c.offer_status, c.offer_salary,
    ]);
    downloadCSV(`candidates_${todayISO()}.csv`, toCSV(headers, rows));
    notify(t("Exported ", "Exportadas ") + rows.length + t(" rows ✓", " filas ✓"));
  };
  const exportCsv = () => exportRows(list);

  // Counted over the same set the list shows, so clicking a pill never lands on
  // a different number than the pill promised.
  const countPool = candidates.filter((c) => (showArchived ? c.archived : !c.archived));
  /* ---- bulk actions -------------------------------------------------------
   * Applied one by one: the data layer exposes per-candidate calls, and a
   * selection here is a handful of rows, not a whole table. Anything that
   * cannot be undone asks first. */
  const toggleSelect = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());
  const selectedList = list.filter((c) => selected.has(c.id));
  const allShownSelected = list.length > 0 && list.every((c) => selected.has(c.id));

  const runBulk = async (label: string, fn: (c: Candidate) => Promise<void>) => {
    if (busy || !selectedList.length) return;
    setBusy(true);
    try {
      for (const c of selectedList) await fn(c);
      notify(`${label}: ${selectedList.length} ✓`);
      clearSelection();
    } finally {
      setBusy(false);
    }
  };

  const bulkArchive = (archived: boolean) =>
    runBulk(
      archived ? t("Archived", "Archivados") : t("Unarchived", "Desarchivados"),
      (c) => updateCandidate(c.id, { archived }),
    );

  const bulkStage = async (key: string) => {
    if (!key) return;
    const target = stages.find((s) => s.key === key);
    if (!target) return;
    // a lost stage needs a reason on record — ask once and apply it to all
    let reason: string | null = null;
    if (target.type === "lost") {
      reason = prompt(t(
        `Reason for discarding these ${selectedList.length} candidates (required):`,
        `Motivo para descartar a estos ${selectedList.length} candidatos (obligatorio):`,
      ));
      if (!reason || !reason.trim()) return;
    }
    await runBulk(t("Moved", "Movidos"), async (c) => {
      await updateCandidate(c.id, {
        status: key,
        ...(reason ? { discard_reason: reason.trim(), discard_source: "recruiter" as const } : {}),
      });
      await addContact(c.id, {
        type: "Stage",
        result: `${stageOf(stages, c.status).label} → ${target.label}`,
        note: reason ? `${t("Recruiter", "Reclutador")}: ${reason.trim()}` : "",
      });
    });
  };

  const bulkDelete = async () => {
    if (!confirm(t(
      `Permanently delete ${selectedList.length} candidates? This cannot be undone — archive them instead if you just want them out of the way.`,
      `¿Eliminar permanentemente a ${selectedList.length} candidatos? Esto no se puede deshacer — archívalos si solo quieres quitarlos de en medio.`,
    ))) return;
    await runBulk(t("Deleted", "Eliminados"), (c) => deleteCandidate(c.id));
  };

  const counts: Record<string, number> = {};
  stages.forEach((s) => (counts[s.key] = countPool.filter((c) => c.status === s.key).length));

  return (
    <div>
      <div className="stat-pills">
        <button
          className={"stat-pill" + (filter === "all" ? " on" : "")}
          onClick={() => setFilter("all")}
          title={t("Show all candidates", "Mostrar todos los candidatos")}
        >
          <b>{countPool.length}</b>
          <span>{t("All", "Todos")}</span>
        </button>
        {stages.map((s) => (
          // click filters the list to this stage; click again to clear
          <button
            key={s.key}
            className={"stat-pill" + (filter === s.key ? " on" : "")}
            style={filter === s.key ? { borderColor: s.color, boxShadow: `inset 0 -3px 0 ${s.color}` } : undefined}
            onClick={() => setFilter(filter === s.key ? "all" : s.key)}
            title={t(`Show only: ${s.label}`, `Mostrar solo: ${s.label}`)}
          >
            <b style={{ color: s.color }}>{counts[s.key]}</b>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>➕ {t("Register candidate", "Registrar candidato")}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCsv((v) => !v)}>📥 {t("Import CSV", "Importar CSV")}</button>
            {/* popup form instead of an inline expander */}
            <button className="btn btn-primary btn-sm" onClick={() => ui.openNewCandidate()}>
              ＋ {t("New candidate", "Nuevo candidato")}
            </button>
          </div>
        </div>
        {showCsv && (
          <div style={{ marginTop: 12, padding: 12, background: "var(--paper)", borderRadius: 10 }}>
            <label>{t("Paste rows: name, phone, email, role, source, home location (one per line)", "Pega filas: nombre, teléfono, correo, puesto, fuente, residencia (una por línea)")}</label>
            <textarea rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="John Doe, +50499998888, john@mail.com, Sales, Indeed, Houston TX" />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={importCsv}>{t("Import", "Importar")}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowCsv(false); setCsv(""); }}>{t("Cancel", "Cancelar")}</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>👥 {t("Candidates", "Candidatos")} ({list.length})</h2>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}>⬇ {t("Export CSV", "Exportar CSV")}</button>
        </div>
        <div className="filters" style={{ marginTop: 12 }}>
          <button className={"chip " + (filter === "all" ? "on" : "")} onClick={() => setFilter("all")}>{t("All", "Todos")}</button>
          {stages.map((s) => (
            <button key={s.key} className={"chip " + (filter === s.key ? "on" : "")} onClick={() => setFilter(s.key)}>{s.label}</button>
          ))}
          <button className={"chip " + (onlyFav ? "on" : "")} onClick={() => setOnlyFav((v) => !v)}>★ {t("Favorites", "Favoritos")}</button>
          <button className={"chip " + (onlyInterviewed ? "on" : "")} onClick={() => setOnlyInterviewed((v) => !v)}>🎤 {t("Interviewed", "Entrevistados")}</button>
          <button className={"chip " + (showArchived ? "on" : "")} onClick={() => setShowArchived((v) => !v)}>🗄 {t("Archived", "Archivados")}</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input placeholder={t("🔍 Search by name, phone, role, tag...", "🔍 Buscar por nombre, teléfono, puesto, etiqueta...")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 220px" }} />
          {allTags.length > 0 && (
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ flex: "0 0 auto", width: "auto" }}>
              <option value="">🏷 {t("All tags", "Todas las etiquetas")}</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {jobs.length > 0 && (
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} style={{ flex: "0 0 auto", width: "auto" }}>
              <option value="">📌 {t("All jobs", "Todas las vacantes")}</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "var(--gray)", fontWeight: 700 }}>⭐ {t("Saved views:", "Vistas guardadas:")}</span>
          {views.length === 0 && <span style={{ fontSize: 12, color: "var(--gray)" }}>{t("none yet", "ninguna aún")}</span>}
          {views.map((v) => (
            <span key={v.name} className="chip" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <button onClick={() => applyView(v)} style={{ background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit" }}>{v.name}</button>
              <button onClick={() => deleteView(v.name)} title={t("Delete view", "Eliminar vista")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}>✕</button>
            </span>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={saveView}>＋ {t("Save current", "Guardar actual")}</button>
        </div>
        {list.length === 0 && <div className="empty">{t("No candidates here yet.", "Aún no hay candidatos aquí.")}</div>}
        <div className="bulk-bar">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(list.map((c) => c.id)) : new Set())}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
            {t("Select all shown", "Seleccionar todos los mostrados")}
          </label>

          {selected.size > 0 && (
            <>
              {/* count what will actually be acted on: rows the current filter
                  hides are excluded, so the number can never overstate */}
              <b style={{ fontSize: 13 }}>{selectedList.length} {t("selected", "seleccionados")}</b>
              {selected.size > selectedList.length && (
                <span className="hint" style={{ margin: 0 }}>
                  ({selected.size - selectedList.length} {t("hidden by the filter — not affected", "ocultos por el filtro — no se tocan")})
                </span>
              )}
              <select
                className="btn-sm"
                style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}
                value=""
                disabled={busy}
                onChange={(e) => { const v = e.target.value; e.target.value = ""; bulkStage(v); }}
              >
                <option value="">{t("Move to stage…", "Mover a etapa…")}</option>
                {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              {showArchived ? (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => bulkArchive(false)}>
                  ♻ {t("Unarchive", "Desarchivar")}
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => bulkArchive(true)}>
                  🗄 {t("Archive", "Archivar")}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => exportRows(selectedList)}>
                ⬇ {t("Export", "Exportar")}
              </button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={bulkDelete}>
                🗑 {t("Delete", "Eliminar")}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={clearSelection}>
                {t("Clear", "Limpiar")}
              </button>
              {busy && <span className="hint" style={{ margin: 0 }}>{t("Working…", "Trabajando…")}</span>}
            </>
          )}
        </div>
        {list.map((c) => (
          <CandidateRow key={c.id} c={c} selected={selected.has(c.id)} onSelect={toggleSelect} />
        ))}
      </div>
    </div>
  );
}
