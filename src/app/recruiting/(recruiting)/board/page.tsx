"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import { stageOf, CALL_AGAIN_TAG, recommendationOf, RECRUITER_MAX_SCORE } from "@/lib/recruiting/constants";
import type { Candidate } from "@/lib/recruiting/types";
import { avatarColor, fmtDateTime, fmtPct, initials, isOverdue, rcCall, rcSms, scoreColor, slaExceeded, terminalKeys } from "@/lib/recruiting/utils";

export default function BoardPage() {
  const { candidates, stages, updateCandidate, addContact, notify } = useData();
  const ui = useUI();
  const { t, lang } = usePrefs();
  const term = terminalKeys(stages);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const moveTo = async (c: Candidate, ns: string) => {
    if (c.status === ns) return;
    const from = stageOf(stages, c.status).label;
    const to = stageOf(stages, ns).label;
    if (stageOf(stages, ns).type === "lost") {
      ui.openDiscard(c.id, ns);
      return;
    }
    {
      const note = prompt(t(`Optional note for moving ${c.name} to ${to}:`, `Nota opcional al mover a ${c.name} a ${to}:`), "");
      if (note === null) return;
      await updateCandidate(c.id, { status: ns });
      await addContact(c.id, { type: "Stage", result: `${from} → ${to}`, note });
    }
    notify(t("Moved to ", "Movido a ") + to + " ✓");
  };

  const onDrop = (ns: string) => {
    const c = candidates.find((x) => x.id === dragId);
    if (c) moveTo(c, ns);
    setDragId(null);
    setOverCol(null);
  };

  return (
    <div>
      <div className="hint" style={{ marginBottom: 12 }}>{t("Drag a candidate card between columns to change their stage.", "Arrastra una tarjeta entre columnas para cambiar su etapa.")}</div>
      <div className="kb-board">
        {stages.map((s) => {
          const cs = candidates.filter((c) => c.status === s.key && !c.archived);
          return (
            <div
              key={s.key}
              className={"kb-col" + (overCol === s.key ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); if (overCol !== s.key) setOverCol(s.key); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
              onDrop={() => onDrop(s.key)}
            >
              <div className="kb-col-head">
                <span className="dot" style={{ background: s.color }} />
                {s.label}
                <span className="cnt">{cs.length}</span>
              </div>
              {cs.length === 0 && <div className="kb-empty">—</div>}
              {cs.map((c) => {
                const overdue = isOverdue(c, term);
                const sla = slaExceeded(c, stages);
                const avg = c.interview?.average ?? null;
                const rec = recommendationOf(c.interview?.recommendation);
                return (
                  <div
                    key={c.id}
                    className={"kb-card" + (dragId === c.id ? " dragging" : "") + (overdue || sla ? " overdue" : "")}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => (c.interview ? ui.openResume(c.id) : ui.openInterview(c.id))}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      {c.photo ? (
                        <div className="avatar sm" style={{ backgroundImage: `url(${c.photo})` }} />
                      ) : (
                        <div className="avatar sm" style={{ background: avatarColor(c.name) }}>{initials(c.name)}</div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); ui.openProfile(c.id); }}
                        title={t("Open profile", "Abrir perfil")}
                        style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer" }}
                      >
                        {c.favorite ? "★ " : ""}{c.name}
                      </button>
                    </div>
                    <div className="kb-meta">
                      {rec && (
                        <span className="sema" style={{ background: rec.color + "22", color: rec.color }} title={t("Recruiter's recommendation", "Recomendación del reclutador")}>
                          {rec.icon} {lang === "es" ? rec.es : rec.en}
                          {c.interview?.recruiterScore != null ? ` ${c.interview.recruiterScore}/${RECRUITER_MAX_SCORE}` : ""}
                        </span>
                      )}
                      <span>💼 {c.role}</span>
                      {c.location && <span>🏪 {c.location}</span>}
                      {c.home_location && <span>🏠 {c.home_location}</span>}
                      {c.tags.includes(CALL_AGAIN_TAG) && (
                        <span className="tag" style={{ background: "var(--tint-red-tag)", color: "var(--red-deep)", fontWeight: 700 }}>🔁 {CALL_AGAIN_TAG}</span>
                      )}
                      {c.phone_date && (
                        <span style={{ color: overdue ? "var(--red)" : "var(--accent)", fontWeight: 600 }}>
                          {overdue ? "⚠" : "☎"} {fmtDateTime(c.phone_date)}
                        </span>
                      )}
                      {avg != null && (
                        <span className="score-pct" style={{ color: scoreColor(avg) }} title={t("Interview score", "Puntaje de entrevista")}>
                          {fmtPct(avg)}
                        </span>
                      )}
                      {c.summary_sent && <span className="sent-tag">✓ {t("sent", "enviado")}</span>}
                    </div>
                    <div className="kb-meta" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                      <a className="link-tel" href={rcCall(c.phone)} onClick={() => addContact(c.id, { type: "Call", result: "", note: "" })}>📞 {t("Call", "Llamar")}</a>
                      <a className="link-tel" href={rcSms(c.phone)} onClick={() => addContact(c.id, { type: "SMS", result: "sent", note: "" })}>💬 {t("Text", "Texto")}</a>
                      <button className="link-tel" style={{ background: "none" }} onClick={() => ui.openMessage(c.id)}>✍️ {t("Msg", "Mensaje")}</button>
                      <button className="link-tel" style={{ background: "none" }} onClick={() => ui.openSchedule(c.id)} title={t("Schedule phone interview", "Programar entrevista telefónica")}>📅 {t("Schedule", "Agendar")}</button>
                      <button
                        className="link-tel"
                        style={{ background: "none", color: "var(--gray)" }}
                        title={t("Hide from the board — find it again with the Archived filter on Candidates", "Ocultar del tablero — se recupera con el filtro Archivados en Candidatos")}
                        onClick={async () => {
                          await updateCandidate(c.id, { archived: true });
                          notify(t("Archived ✓ — see the Archived filter", "Archivado ✓ — míralo en el filtro Archivados"));
                        }}
                      >
                        🗄 {t("Archive", "Archivar")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
