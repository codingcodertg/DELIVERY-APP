"use client";

import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { recommendationOf, RECRUITER_MAX_SCORE } from "@/lib/recruiting/constants";
import { cuentaDeContestadas, filasDeLaEntrevista, notasDeLaPresencial } from "@/lib/recruiting/entrevista-hecha";
import { fmtDateTime, fmtPct, levelLabel, MAX_SCORE, scaleFor, scoreColor } from "@/lib/recruiting/utils";

/**
 * La entrevista ya hecha, para leerla: todas las preguntas con su calificación y lo que se anotó,
 * las notas generales, y lo que quedó de la presencial. No edita nada; para cambiarla está «Editar entrevista».
 */
export function InterviewViewModal({ id, close, edit }: { id: string; close: () => void; edit: (id: string) => void }) {
  const { candidates, settings, contactsFor } = useData();
  const { t, lang } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  if (!c) return null;
  const it = c.interview ?? null;
  const filas = filasDeLaEntrevista(it);
  const { contestadas, total } = cuentaDeContestadas(filas);
  const presencial = notasDeLaPresencial(contactsFor(c.id));
  const rec = recommendationOf(it?.recommendation);
  const nivel = it ? levelLabel(it.average, scaleFor(null, settings), lang) : null;
  const etiqueta = { fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase" as const, margin: "14px 0 6px" };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-entrevista-hecha>
        <h3>👁 {t("Interview", "Entrevista")} — {c.name}</h3>
        <div style={{ color: "var(--gray)", fontSize: 12.5, marginBottom: 8 }}>{c.role}</div>

        {!it && presencial.length === 0 && (
          <div style={{ color: "var(--gray)" }}>{t("No interview has been saved for this candidate yet.", "Todavía no hay una entrevista guardada de este candidato.")}</div>
        )}

        {it && (
          <>
            <div style={etiqueta}>☎ {t("Phone interview", "Entrevista por teléfono")} · {fmtDateTime(it.date)}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <span className="sema" style={{ background: "var(--accent-soft)", color: scoreColor(it.average) }}>
                ● {it.average == null ? t("Not scored", "Sin calificar") : `${nivel ?? ""} · ${fmtPct(it.average)}`}
              </span>
              {rec && (
                <span className="sema" style={{ background: rec.color + "22", color: rec.color }}>
                  {rec.icon} {lang === "es" ? rec.es : rec.en}
                </span>
              )}
              {it.recruiterScore != null && (
                <span className="sema" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  {t("Recruiter", "Reclutador")}: {it.recruiterScore}/{RECRUITER_MAX_SCORE}
                </span>
              )}
              <span className="sema" style={{ background: "var(--accent-soft)", color: "var(--gray)" }}>
                {contestadas}/{total} {t("answered", "contestadas")}
              </span>
            </div>

            {filas.map((f, i) => (
              <div key={i} className="cand-row" style={{ opacity: f.sinContestar ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 600 }}>
                    {i + 1}. {f.text}
                    {f.category && <span style={{ color: "var(--gray)", fontWeight: 400, fontSize: 12 }}> · {f.category}</span>}
                  </div>
                  <div style={{ fontWeight: 700, whiteSpace: "nowrap", color: scoreColor(f.grade) }}>
                    {f.grade != null ? `${f.grade}/${MAX_SCORE}` : f.sinContestar ? t("Not answered", "Sin contestar") : t("No score", "Sin calificación")}
                  </div>
                </div>
                {f.note && <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{f.note}</div>}
              </div>
            ))}

            {(it.generalNotes ?? "").trim() && (
              <>
                <div style={etiqueta}>📝 {t("General notes", "Notas generales")}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{it.generalNotes.trim()}</div>
              </>
            )}
          </>
        )}

        {presencial.length > 0 && (
          <>
            <div style={etiqueta}>🤝 {t("In-person interview", "Entrevista presencial")}</div>
            {presencial.map((k) => (
              <div key={k.id} className="cand-row">
                <div style={{ color: "var(--gray)", fontSize: 12 }}>{fmtDateTime(k.created_at)}{k.result ? ` · ${k.result}` : ""}</div>
                {(k.note ?? "").trim() && <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{(k.note ?? "").trim()}</div>}
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {it && <button className="btn btn-ghost" onClick={() => { close(); edit(c.id); }}>🎤 {t("Edit interview", "Editar entrevista")}</button>}
          <button className="btn btn-ghost" onClick={close}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}
