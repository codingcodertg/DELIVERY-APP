"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import type { Candidate } from "@/lib/recruiting/types";
import { stageOf } from "@/lib/recruiting/constants";
import {
  fmtDate,
  fmtDateTime,
  isToday,
  outcomeDue,
  outcomeDueAt,
  rcCall,
  rcSms,
  sinceLabel,
  terminalKeys,
  todayISO,
} from "@/lib/recruiting/utils";

/** Daily action list — everything that needs a recruiter's attention right
 * now, pulled from data other tabs already track (interviews from Calendar,
 * overdue verdicts from Outcomes, follow_up/status from Candidates). Nothing
 * here is stored separately; it's all derived on read, same as those tabs. */
export default function TodayPage() {
  const { candidates, stages, ready, recruiters, addContact } = useData();
  const ui = useUI();
  const { t } = usePrefs();

  // outcomeDue's 3h grace threshold can tip over while this page sits open
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const active = candidates.filter((c) => !c.archived);
  const terminal = terminalKeys(stages);
  const today = todayISO();

  type Ev = { c: Candidate; kind: "phone" | "inperson"; at: string };
  const interviewsToday: Ev[] = active
    .flatMap((c) => [
      ...(c.phone_date && isToday(c.phone_date) ? [{ c, kind: "phone" as const, at: c.phone_date }] : []),
      ...(c.inperson_date && isToday(c.inperson_date) ? [{ c, kind: "inperson" as const, at: c.inperson_date }] : []),
    ])
    .sort((a, b) => a.at.localeCompare(b.at));

  const outcomesDue = active
    .filter((c) => outcomeDue(c, now))
    .sort((a, b) => (a.inperson_date || "").localeCompare(b.inperson_date || ""));

  const followUps = active
    .filter((c) => c.follow_up && c.follow_up <= today && !terminal.has(c.status))
    .sort((a, b) => (a.follow_up || "").localeCompare(b.follow_up || ""));

  const awaitingFirstCall = active
    .filter((c) => c.status === "registered" && !c.phone_date)
    .sort((a, b) => a.reg_date.localeCompare(b.reg_date));

  const recName = (id: string | null) => recruiters.find((r) => r.id === id)?.full_name ?? t("Unassigned", "Sin asignar");
  const nameBtn = (c: Candidate) => (
    <button
      onClick={() => ui.openProfile(c.id)}
      title={t("Open profile", "Abrir perfil")}
      style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
    >
      {c.name}
    </button>
  );

  const totalToday = interviewsToday.length + outcomesDue.length + followUps.length + awaitingFirstCall.length;

  return (
    <div>
      <div className="stat-pills">
        <div className="stat-pill">
          <b style={{ color: interviewsToday.length ? "var(--accent)" : undefined }}>{interviewsToday.length}</b>
          <span>{t("Interviews today", "Entrevistas hoy")}</span>
        </div>
        <div className="stat-pill">
          <b style={{ color: outcomesDue.length ? "var(--red)" : undefined }}>{outcomesDue.length}</b>
          <span>{t("Outcomes overdue", "Resultados atrasados")}</span>
        </div>
        <div className="stat-pill">
          <b style={{ color: followUps.length ? "var(--amber)" : undefined }}>{followUps.length}</b>
          <span>{t("Follow-ups due", "Seguimientos pendientes")}</span>
        </div>
        <div className="stat-pill">
          <b>{awaitingFirstCall.length}</b>
          <span>{t("Awaiting first call", "Esperando primera llamada")}</span>
        </div>
      </div>

      {ready && totalToday === 0 && (
        <div className="card"><div className="empty">{t("🎉 Nothing needs your attention today.", "🎉 Nada requiere tu atención hoy.")}</div></div>
      )}

      {interviewsToday.length > 0 && (
        <div className="card today-sec">
          <h2>📅 {t("Interviews today", "Entrevistas hoy")} <span className="cnt">{interviewsToday.length}</span></h2>
          {interviewsToday.map((ev) => (
            <div key={ev.c.id + ev.kind} className="mini-row">
              <div>
                {nameBtn(ev.c)} <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {ev.c.role}</span>
                <div style={{ fontSize: 12.5, marginTop: 2 }}>
                  <span style={{ color: ev.kind === "inperson" ? "var(--green-deep)" : "var(--accent)", fontWeight: 700 }}>
                    {ev.kind === "inperson" ? "🤝 " + t("In-person", "Presencial") : "☎ " + t("Phone call", "Llamada")} · {fmtDateTime(ev.at)}
                  </span>
                  <a className="link-tel" href={rcCall(ev.c.phone)} style={{ marginLeft: 10 }} onClick={() => addContact(ev.c.id, { type: "Call", result: "", note: "" })}>📞 {ev.c.phone}</a>
                  <a className="link-tel" href={rcSms(ev.c.phone)} style={{ marginLeft: 10 }} onClick={() => addContact(ev.c.id, { type: "SMS", result: "sent", note: "" })}>💬 {t("Text", "Texto")}</a>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ev.kind === "phone" && <button className="btn btn-primary btn-sm" onClick={() => ui.openInterview(ev.c.id)}>🎤 {t("Interview", "Entrevista")}</button>}
                {ev.kind === "inperson" && <button className="btn btn-primary btn-sm" onClick={() => ui.openOutcome(ev.c.id)}>🤝 {t("Record outcome", "Registrar resultado")}</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {outcomesDue.length > 0 && (
        <div className="card today-sec">
          <h2>⚠ {t("Outcomes overdue", "Resultados atrasados")} <span className="cnt">{outcomesDue.length}</span></h2>
          {outcomesDue.map((c) => {
            const dueAt = outcomeDueAt(c);
            return (
              <div key={c.id} className="mini-row warn">
                <div>
                  {nameBtn(c)} <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {c.role}</span>
                  <div style={{ fontSize: 12, marginTop: 3, color: "var(--red)", fontWeight: 700 }}>
                    ⚠ {t("Overdue by", "Atrasado por")} {sinceLabel(dueAt!, now)}
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => ui.openOutcome(c.id)}>🤝 {t("Record outcome", "Registrar resultado")}</button>
              </div>
            );
          })}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="card today-sec">
          <h2>⏰ {t("Follow-ups due", "Seguimientos pendientes")} <span className="cnt">{followUps.length}</span></h2>
          {followUps.map((c) => (
            <div key={c.id} className="mini-row">
              <div>
                {nameBtn(c)} <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {c.role} · {stageOf(stages, c.status).label}</span>
                <div style={{ fontSize: 12, marginTop: 3, color: c.follow_up! < today ? "var(--red)" : "var(--amber)", fontWeight: 700 }}>
                  {c.follow_up! < today ? "⚠ " + t("Was due", "Venció el") : t("Due", "Vence")} {fmtDate(c.follow_up)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <a className="btn btn-ghost btn-sm" href={rcCall(c.phone)} onClick={() => addContact(c.id, { type: "Call", result: "", note: "" })}>📞 {t("Call", "Llamar")}</a>
                <button className="btn btn-ghost btn-sm" onClick={() => ui.openEdit(c.id)}>✏️ {t("Edit", "Editar")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {awaitingFirstCall.length > 0 && (
        <div className="card today-sec">
          <h2>🆕 {t("Awaiting first call", "Esperando primera llamada")} <span className="cnt">{awaitingFirstCall.length}</span></h2>
          {awaitingFirstCall.map((c) => (
            <div key={c.id} className="mini-row">
              <div>
                {nameBtn(c)} <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {c.role} · {recName(c.assigned_recruiter)}</span>
                <div style={{ fontSize: 12, marginTop: 3, color: "var(--gray)" }}>{t("Registered", "Registrado")} {fmtDate(c.reg_date)}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <a className="btn btn-ghost btn-sm" href={rcCall(c.phone)} onClick={() => addContact(c.id, { type: "Call", result: "", note: "" })}>📞 {t("Call", "Llamar")}</a>
                <button className="btn btn-primary btn-sm" onClick={() => ui.openSchedule(c.id)}>📅 {t("Schedule", "Agendar")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
