"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import { stageOf, CALL_AGAIN_TAG, recommendationOf, RECRUITER_MAX_SCORE } from "@/lib/recruiting/constants";
import type { Candidate } from "@/lib/recruiting/types";
import {
  avatarColor,
  fmtDate,
  fmtPct,
  initials,
  isOverdue,
  scoreColor,
  terminalKeys,
} from "@/lib/recruiting/utils";

export function CandidateRow({
  c,
  selected,
  onSelect,
}: {
  c: Candidate;
  /** Bulk-selection state. Omitted (undefined) hides the checkbox entirely. */
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
}) {
  const {
    recruiters, stages, updateCandidate, deleteCandidate, toggleFavorite, contactsFor,
    uploadResume, removeResume, openResumeFile, notify,
  } = useData();
  const ui = useUI();
  const { t, lang } = usePrefs();
  const [expanded, setExpanded] = useState(false);
  const term = terminalKeys(stages);
  const s = stageOf(stages, c.status);
  const avg = c.interview?.average ?? null;
  const rec = recommendationOf(c.interview?.recommendation);
  // discarded but nobody wrote down why — the manager will ask
  const missingReason = s.type === "lost" && !c.discard_reason;
  // an attached CV counts on its own, so candidates uploaded before the flag
  // existed read correctly without a backfill
  const hasResume = c.resume_passed || !!c.resume_name;
  const overdue = isOverdue(c, term);
  const inCompare = ui.compareIds.includes(c.id);
  const nContact = contactsFor(c.id).length;

  const changeStatus = async (ns: string) => {
    const target = stageOf(stages, ns);
    if (target.type === "lost") {
      ui.openDiscard(c.id, ns);
    } else {
      await updateCandidate(c.id, { status: ns });
    }
  };

  const firstActive = stages.find((st) => st.type === "active");
  const reactivate = async () => {
    if (!firstActive) return;
    if (!confirm(t(`Reactivate ${c.name} back to "${firstActive.label}"?`, `¿Reactivar a ${c.name} a "${firstActive.label}"?`))) return;
    await updateCandidate(c.id, { status: firstActive.key, discard_reason: null });
  };

  // Clicking anywhere on the card opens the profile — except on something that
  // already does its own thing (star, expand, status select, action buttons,
  // phone/text links), and except when the user was just selecting text.
  const openFromCard = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest("button, a, select, input, textarea, label")) return;
    if (window.getSelection()?.toString()) return;
    ui.openProfile(c.id);
  };

  return (
    <div
      className={"cand-row clickable" + (overdue ? " overdue" : "")}
      onClick={openFromCard}
      title={t("Open profile", "Abrir perfil")}
    >
      <div className="cand-head">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {onSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={(e) => onSelect(c.id, e.target.checked)}
              title={t("Select for bulk actions", "Seleccionar para acciones en lote")}
              style={{ width: 18, height: 18, marginTop: 10, flex: "0 0 auto", cursor: "pointer" }}
            />
          )}
          {c.photo ? (
            <div className="avatar" style={{ backgroundImage: `url(${c.photo})` }} />
          ) : (
            <div className="avatar" style={{ background: avatarColor(c.name) }}>{initials(c.name)}</div>
          )}
          <div>
            <div className="cand-name" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                className={"star" + (c.favorite ? " on" : "")}
                title={t("Favorite", "Favorito")}
                onClick={() => toggleFavorite(c.id)}
              >
                {c.favorite ? "★" : "☆"}
              </button>
              {c.pinned && <span title={t("Pinned", "Fijado")}>📌</span>}
              {c.archived && <span className="badge" style={{ background: "var(--track)", color: "var(--gray)" }}>🗄 {t("Archived", "Archivado")}</span>}
              <button
                onClick={() => setExpanded((v) => !v)}
                title={t("Show actions", "Mostrar acciones")}
                style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", fontWeight: 700, cursor: "pointer" }}
              >
                {expanded ? "▾" : "▸"}
              </button>
              <button
                onClick={() => ui.openProfile(c.id)}
                title={t("Open profile", "Abrir perfil")}
                style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", fontWeight: 700, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
              >
                {c.name}
              </button>
              {avg != null && (
                <span className="score-pct" style={{ color: scoreColor(avg) }} title={t("Interview score", "Puntaje de entrevista")}>
                  {fmtPct(avg)}
                </span>
              )}
              {rec && (
                <span className="sema" style={{ background: rec.color + "22", color: rec.color }} title={t("Recruiter's recommendation", "Recomendación del reclutador")}>
                  {rec.icon} {lang === "es" ? rec.es : rec.en}
                  {c.interview?.recruiterScore != null ? ` ${c.interview.recruiterScore}/${RECRUITER_MAX_SCORE}` : ""}
                </span>
              )}
              {missingReason && (
                <button
                  className="badge"
                  style={{ background: "var(--tint-red-strong)", color: "var(--red)", border: "1px solid var(--red)", cursor: "pointer" }}
                  onClick={() => ui.openDiscard(c.id, c.status)}
                  title={t("This candidate was discarded without a reason", "Este candidato se descartó sin motivo")}
                >
                  ⚠ {t("Add discard reason", "Agregar motivo")}
                </button>
              )}
              {c.summary_sent && <span className="sent-tag">✓ {t("sent", "enviado")}</span>}
              {c.alt_sources.length > 0 && (
                <span className="badge" style={{ background: "#e7f0ff", color: "var(--accent)" }} title={t("Also applied from: ", "También aplicó desde: ") + c.alt_sources.join(", ")}>
                  🔁 +{c.alt_sources.length}
                </span>
              )}
              <button
                className={"chip " + (hasResume ? "on" : "")}
                title={
                  c.resume_name
                    ? t(`Open CV — ${c.resume_name}`, `Abrir CV — ${c.resume_name}`)
                    : t("Passed the resume screen (applied on Indeed)", "Pasó el filtro de currículum (aplicó en Indeed)")
                }
                style={{ fontSize: 11, padding: "1px 8px" }}
                // with a file attached the chip opens it; without one it stays a
                // manual "saw it but didn't attach it" toggle
                onClick={() =>
                  c.resume_name
                    ? openResumeFile(c.id)
                    : updateCandidate(c.id, { resume_passed: !c.resume_passed })
                }
              >
                {hasResume ? "✓ " : ""}{t("Resume", "Currículum")}{c.resume_name ? " 📎" : ""}
              </button>
            </div>
            <div className="cand-meta">
              <span>💼 {c.role}</span>
              <span>🏪 {c.location || t("No store", "Sin tienda")}</span>
              {c.home_location && <span>🏠 {c.home_location}</span>}
              <span>📅 {fmtDate(c.reg_date)}</span>
              {c.interview && <span title={t("Phone interview done", "Entrevista telefónica hecha")} style={{ color: "var(--accent)", fontWeight: 600 }}>🎤 {fmtDate(c.interview.date)}</span>}
              {c.tags.map((tg) => (
                <span key={tg} className="tag" style={tg === CALL_AGAIN_TAG ? { background: "#fee2e2", color: "#b91c1c", fontWeight: 700 } : undefined}>
                  {tg === CALL_AGAIN_TAG ? "🔁 " : ""}{tg}
                </span>
              ))}
            </div>
          </div>
        </div>
        <span className="badge" style={{ background: s.color + "22", color: s.color }}>
          <span className="dot" style={{ background: s.color }} />
          {s.label}
        </span>
      </div>
      {expanded && (
      <div className="cand-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openProfile(c.id)}>👤 {t("Profile", "Perfil")}</button>
        <select
          className="btn-sm"
          style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}
          value={c.status}
          onChange={(e) => changeStatus(e.target.value)}
        >
          {stages.map((st) => (
            <option key={st.key} value={st.key}>{st.label}</option>
          ))}
        </select>
        {(s.type === "lost" || s.type === "won") && firstActive && (
          <button className="btn btn-sm" style={{ color: "var(--teal)", border: "1px solid var(--teal)" }} onClick={reactivate}>
            ♻ {t("Reactivate", "Reactivar")}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openSchedule(c.id)}>📅 {t("Schedule call", "Agendar llamada")}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openScheduleInPerson(c.id)}>🤝 {t("Schedule in-person", "Agendar presencial")}</button>
        <button className="btn btn-green btn-sm" onClick={() => ui.openMessage(c.id)}>💬 {t("Message", "Mensaje")}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openContact(c.id)}>📝 {t("Log", "Registro")}{nContact ? ` (${nContact})` : ""}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openTimeline(c.id)}>🕓 {t("Timeline", "Historial")}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openOffer(c.id)}>💼 {t("Offer", "Oferta")}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => ui.openInterview(c.id)}>
          🎤 {c.interview ? t("Edit interview", "Editar entrevista") : t("Start interview", "Iniciar entrevista")}
        </button>
        {c.interview && <button className="btn btn-green btn-sm" onClick={() => ui.openResume(c.id)}>📋 {t("Summary", "Resumen")}</button>}
        <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={() => ui.openEdit(c.id)}>✏️ {t("Edit", "Editar")}</button>
        {c.resume_name ? (
          <span style={{ display: "inline-flex", gap: 4 }}>
            <button className="btn btn-ghost btn-sm" title={c.resume_name} onClick={() => openResumeFile(c.id)}>
              📎 CV
            </button>
            <button className="btn btn-sm" style={{ color: "var(--gray)" }} title={t("Remove CV", "Quitar CV")} onClick={() => { if (confirm(t("Remove attached CV?", "¿Quitar el CV adjunto?"))) removeResume(c.id); }}>✕</button>
          </span>
        ) : (
          <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
            📎 {t("Attach CV", "Adjuntar CV")}
            <input
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadResume(c.id, f); e.target.value = ""; }}
            />
          </label>
        )}
        <button
          className={"btn btn-sm " + (inCompare ? "btn-primary" : "")}
          style={inCompare ? {} : { color: "var(--gray)" }}
          onClick={() => ui.toggleCompare(c.id)}
        >
          ⚖ {inCompare ? t("Selected", "Elegido") : t("Compare", "Comparar")}
        </button>
        <button className="btn btn-sm" style={{ color: c.pinned ? "var(--accent)" : "var(--gray)" }} title={t("Pin to top", "Fijar arriba")} onClick={() => updateCandidate(c.id, { pinned: !c.pinned })}>
          📌 {c.pinned ? t("Pinned", "Fijado") : t("Pin", "Fijar")}
        </button>
        {recruiters.length > 0 && (
          <select
            className="btn-sm"
            style={{ width: "auto", padding: "5px 8px", fontSize: 12 }}
            title={t("Reassign recruiter", "Reasignar reclutador")}
            value={c.assigned_recruiter ?? ""}
            onChange={(e) => updateCandidate(c.id, { assigned_recruiter: e.target.value || null })}
          >
            <option value="">🧑‍💼 {t("Unassigned", "Sin asignar")}</option>
            {recruiters.map((r) => <option key={r.id} value={r.id}>🧑‍💼 {r.full_name}</option>)}
          </select>
        )}
        <button
          className="btn btn-sm"
          style={{ color: "var(--gray)" }}
          title={c.archived
            ? t("Bring back to the active list", "Regresar a la lista activa")
            : t("Hide from the active list — find it again with the Archived filter", "Ocultar de la lista activa — se recupera con el filtro Archivados")}
          onClick={async () => {
            await updateCandidate(c.id, { archived: !c.archived });
            notify(c.archived ? t("Unarchived ✓", "Desarchivado ✓") : t("Archived ✓ — see the Archived filter", "Archivado ✓ — míralo en el filtro Archivados"));
          }}
        >
          🗄 {c.archived ? t("Unarchive", "Desarchivar") : t("Archive", "Archivar")}
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => { if (confirm(t("Delete ", "¿Eliminar a ") + c.name + "?")) deleteCandidate(c.id); }}
        >
          🗑
        </button>
      </div>
      )}
    </div>
  );
}
