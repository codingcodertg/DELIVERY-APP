"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import type { Candidate } from "@/lib/recruiting/types";
import {
  awaitingOutcome,
  fmtDateTime,
  OUTCOME_GRACE_HOURS,
  outcomeDue,
  outcomeDueAt,
  rcCall,
  rcSms,
  sinceLabel,
} from "@/lib/recruiting/utils";

/** Candidates who sat an in-person interview and are waiting on a verdict.
 * Three hours after the interview the row turns red and counts as overdue —
 * recording the outcome (hired / standby / discarded) moves them out of the
 * in-person stage, which is what removes them from this tab. */
export default function OutcomesPage() {
  const { candidates, ready, stages, addContact } = useData();
  const ui = useUI();
  const { t } = usePrefs();
  // resolved by type, not key, so renaming the stage in Settings can't break it
  const lostStage = stages.find((s) => s.type === "lost");

  // the 3h threshold passes while the page is open, so re-evaluate on a timer
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const waiting = candidates.filter(awaitingOutcome);
  const due = waiting
    .filter((c) => outcomeDue(c, now))
    .sort((a, b) => (a.inperson_date || "").localeCompare(b.inperson_date || ""));
  const upcoming = waiting
    .filter((c) => !outcomeDue(c, now))
    .sort((a, b) => (a.inperson_date || "").localeCompare(b.inperson_date || ""));

  const Row = ({ c, warn }: { c: Candidate; warn?: boolean }) => {
    const dueAt = outcomeDueAt(c);
    return (
      <div className={"mini-row" + (warn ? " warn" : "")}>
        <div>
          <button
            onClick={() => ui.openProfile(c.id)}
            title={t("Open profile", "Abrir perfil")}
            style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
          >
            {c.name}
          </button>{" "}
          <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {c.role}</span>
          {c.location && <span style={{ color: "var(--gray)", fontSize: 12.5 }}> · 📍 {c.location}</span>}
          <div style={{ fontSize: 12.5, marginTop: 2 }}>
            <a className="link-tel" href={rcCall(c.phone)} onClick={() => addContact(c.id, { type: "Call", result: "", note: "" })}>📞 {c.phone}</a>
            <a className="link-tel" href={rcSms(c.phone)} style={{ marginLeft: 10 }} onClick={() => addContact(c.id, { type: "SMS", result: "sent", note: "" })}>💬 {t("Text", "Texto")}</a>
            <span style={{ color: "var(--green-deep)", fontWeight: 700, marginLeft: 10 }}>🤝 {fmtDateTime(c.inperson_date)}</span>
          </div>
          <div style={{ fontSize: 12, marginTop: 3, color: warn ? "var(--red)" : "var(--gray)", fontWeight: warn ? 700 : 500 }}>
            {warn
              ? `⚠ ${t("Outcome overdue by", "Resultado atrasado por")} ${sinceLabel(dueAt!, now)}`
              : `${t("Outcome due", "Resultado debido")} ${fmtDateTime(dueAt ? dueAt.toISOString() : null)}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => ui.openOutcome(c.id)}>
            🤝 {t("Record outcome", "Registrar resultado")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => ui.openScheduleInPerson(c.id)}>
            📅 {t("Reschedule", "Reagendar")}
          </button>
          {/* shortcut past the outcome picker for the common "they're out" case */}
          {lostStage && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => ui.openDiscard(c.id, lostStage.key)}
              title={t("Discard without picking an outcome first", "Descartar sin elegir un resultado primero")}
            >
              🚫 {t("Discard", "Descartar")}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="card" style={{ background: "var(--brand-surface)", color: "#fff", border: "none" }}>
        <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
          {t("In-person interviews", "Entrevistas presenciales")}
        </div>
        <div className="display" style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>
          {t("Waiting on a verdict", "Esperando un veredicto")}
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
          <div>
            <b className="display" style={{ fontSize: 24, color: due.length ? "#ff8a8a" : "#fff" }}>{due.length}</b>
            <div style={{ fontSize: 11, opacity: 0.8 }}>{t("Outcome overdue", "Resultado atrasado")}</div>
          </div>
          <div>
            <b className="display" style={{ fontSize: 24 }}>{upcoming.length}</b>
            <div style={{ fontSize: 11, opacity: 0.8 }}>{t("Not due yet", "Aún no vence")}</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 10 }}>
          {t(
            `The outcome is due ${OUTCOME_GRACE_HOURS} hours after the interview starts.`,
            `El resultado vence ${OUTCOME_GRACE_HOURS} horas después de que inicia la entrevista.`,
          )}
        </div>
      </div>

      {!ready && <div className="card"><div className="empty">{t("Loading…", "Cargando…")}</div></div>}
      {ready && !waiting.length && (
        <div className="card">
          <div className="empty">
            {t("🎉 No in-person interviews waiting on an outcome.", "🎉 Ninguna entrevista presencial esperando resultado.")}
          </div>
        </div>
      )}

      {due.length > 0 && (
        <div className="card today-sec">
          <h2>⚠ {t("Outcome overdue", "Resultado atrasado")} <span className="cnt">{due.length}</span></h2>
          {due.map((c) => <Row key={c.id} c={c} warn />)}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="card today-sec">
          <h2>🤝 {t("Interviewed / scheduled", "Entrevistados / agendados")} <span className="cnt">{upcoming.length}</span></h2>
          {upcoming.map((c) => <Row key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}
