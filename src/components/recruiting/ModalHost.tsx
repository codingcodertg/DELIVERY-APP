"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageOf, LOCATIONS, CALL_AGAIN_TAG, RECOMMENDATIONS, recommendationOf, RECRUITER_MAX_SCORE } from "@/lib/recruiting/constants";
import type { Candidate, Contact, Interview, InterviewAnswer, RecruiterRecommendation } from "@/lib/recruiting/types";
import {
  avatarColor,
  fmtDate,
  fmtDateTime,
  fmtPct,
  initials,
  levelLabel,
  MAX_SCORE,
  mergeTemplate,
  normalizeName,
  OFFER_STATUS,
  qText,
  rcCall,
  rcSms,
  localDateTimeInput,
  scaleFor,
  scoreAverage,
  scoreColor,
  todayISO,
} from "@/lib/recruiting/utils";

interface UI {
  openProfile: (id: string) => void;
  openInterview: (id: string) => void;
  openResume: (id: string) => void;
  openSchedule: (id: string) => void;
  openScheduleInPerson: (id: string) => void;
  openDiscard: (id: string, stageKey: string) => void;
  openOutcome: (id: string) => void;
  openNewCandidate: () => void;
  openEdit: (id: string) => void;
  openMessage: (id: string) => void;
  openContact: (id: string) => void;
  openOffer: (id: string) => void;
  openTimeline: (id: string) => void;
  toggleCompare: (id: string) => void;
  compareIds: string[];
}

const Ctx = createContext<UI | null>(null);
export function useUI(): UI {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const { t } = usePrefs();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [inPersonId, setInPersonId] = useState<string | null>(null);
  const [discard, setDiscard] = useState<{ id: string; stageKey: string } | null>(null);
  const [outcomeId, setOutcomeId] = useState<string | null>(null);
  const [newCandidate, setNewCandidate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [msgId, setMsgId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [timelineId, setTimelineId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCmp, setShowCmp] = useState(false);

  const ui: UI = {
    openProfile: setProfileId,
    openInterview: setInterviewId,
    openResume: setResumeId,
    openSchedule: setScheduleId,
    openScheduleInPerson: setInPersonId,
    openDiscard: (id, stageKey) => setDiscard({ id, stageKey }),
    openOutcome: setOutcomeId,
    openNewCandidate: () => setNewCandidate(true),
    openEdit: setEditId,
    openMessage: setMsgId,
    openContact: setContactId,
    openOffer: setOfferId,
    openTimeline: setTimelineId,
    toggleCompare: (id) =>
      setCompareIds((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 3 ? ids : [...ids, id],
      ),
    compareIds,
  };

  return (
    <Ctx.Provider value={ui}>
      {children}
      {profileId && <ProfileModal id={profileId} close={() => setProfileId(null)} />}
      {scheduleId && <ScheduleModal id={scheduleId} kind="phone" close={() => setScheduleId(null)} />}
      {inPersonId && <ScheduleModal id={inPersonId} kind="inperson" close={() => setInPersonId(null)} />}
      {discard && <DiscardModal id={discard.id} stageKey={discard.stageKey} close={() => setDiscard(null)} />}
      {outcomeId && <OutcomeModal id={outcomeId} close={() => setOutcomeId(null)} />}
      {newCandidate && <NewCandidateModal close={() => setNewCandidate(false)} />}
      {editId && <EditModal id={editId} close={() => setEditId(null)} />}
      {interviewId && (
        <InterviewModal
          id={interviewId}
          close={() => setInterviewId(null)}
          openResume={setResumeId}
        />
      )}
      {resumeId && <ResumeModal id={resumeId} close={() => setResumeId(null)} />}
      {msgId && <MessageModal id={msgId} close={() => setMsgId(null)} />}
      {contactId && <ContactModal id={contactId} close={() => setContactId(null)} />}
      {offerId && <OfferModal id={offerId} close={() => setOfferId(null)} />}
      {timelineId && <TimelineModal id={timelineId} close={() => setTimelineId(null)} />}
      {showCmp && compareIds.length >= 2 && (
        <CompareModal ids={compareIds} close={() => setShowCmp(false)} clear={() => { setShowCmp(false); setCompareIds([]); }} />
      )}
      {compareIds.length > 0 && (
        <div className="compare-bar no-print">
          <span style={{ fontWeight: 700 }}>⚖ {compareIds.length} {t("selected", "seleccionados")}</span>
          <span style={{ opacity: 0.75, fontSize: 12 }}>
            {compareIds.length < 2 ? t("Pick at least 2 (up to 3) to compare", "Elige al menos 2 (hasta 3) para comparar") : t("Ready to compare", "Listo para comparar")}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={compareIds.length < 2}
              onClick={() => setShowCmp(true)}
            >
              {t("Compare", "Comparar")}
            </button>
            <button className="btn btn-sm" style={{ color: "#fff" }} onClick={() => setCompareIds([])}>
              {t("Clear", "Limpiar")}
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/* ---------------- Profile ---------------- */
function ProfileModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, stages, recruiters, jobs, customFields, contactsFor, stageHistoryFor, openResumeFile, attachmentsFor, openAttachment, addContact, updateCandidate, notify } = useData();
  const ui = useUI();
  const { t, lang } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  if (!c) return null;

  const s = stageOf(stages, c.status);
  const avg = c.interview?.average ?? null;
  const recName = recruiters.find((r) => r.id === c.assigned_recruiter)?.full_name ?? "—";
  const job = jobs.find((j) => j.id === c.job_id) ?? null;
  const history = stageHistoryFor(c.id);
  const nContact = contactsFor(c.id).length;
  const dayMs = 864e5;
  const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / dayMs));

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) =>
    value ? (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em" }}>{label}</div>
        <div style={{ fontSize: 14, wordBreak: "break-word" }}>{value}</div>
      </div>
    ) : null;

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          {c.photo ? (
            <div className="avatar" style={{ width: 60, height: 60, backgroundImage: `url(${c.photo})` }} />
          ) : (
            <div className="avatar" style={{ width: 60, height: 60, fontSize: 22, background: avatarColor(c.name) }}>{initials(c.name)}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {c.favorite && <span style={{ color: "var(--amber)" }}>★</span>}
              {c.name}
              <span className="badge" style={{ background: s.color + "22", color: s.color }}>
                <span className="dot" style={{ background: s.color }} />{s.label}
              </span>
            </h3>
            <div style={{ marginTop: 4, fontSize: 16 }}>
              {avg != null ? (
                <span className="score-pct" style={{ color: scoreColor(avg), fontSize: 18 }}>{fmtPct(avg)}</span>
              ) : (
                <span style={{ color: "var(--gray)", fontSize: 13 }}>{t("no score", "sin puntaje")}</span>
              )}
              {c.interview?.recruiterScore != null && (
                <span style={{ color: "var(--gray)", fontSize: 13, marginLeft: 8 }}>
                  · {t("recruiter", "reclutador")} {c.interview.recruiterScore}/{RECRUITER_MAX_SCORE}
                </span>
              )}
            </div>
            {recommendationOf(c.interview?.recommendation) && (
              <div style={{ marginTop: 6 }}>
                <span className="sema" style={{ background: recommendationOf(c.interview?.recommendation)!.color + "22", color: recommendationOf(c.interview?.recommendation)!.color }}>
                  {recommendationOf(c.interview?.recommendation)!.icon} {lang === "es" ? recommendationOf(c.interview?.recommendation)!.es : recommendationOf(c.interview?.recommendation)!.en}
                </span>
              </div>
            )}
            <div className="cand-meta" style={{ marginTop: 6 }}>
              <a className="link-tel" href={rcCall(c.phone)} onClick={() => addContact(c.id, { type: "Call", result: "", note: "" })}>📞 {t("Call", "Llamar")} {c.phone}</a>
              <a className="link-tel" href={rcSms(c.phone)} onClick={() => addContact(c.id, { type: "SMS", result: "sent", note: "" })}>💬 {t("Text", "Texto")}</a>
              {c.email && <a className="link-tel" href={"mailto:" + c.email}>✉️ {c.email}</a>}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line, #e5e7eb)" }}>
          <Field label={t("Position", "Puesto")} value={c.role} />
          <Field label={t("Location", "Ubicación")} value={c.location} />
          <Field label={t("Home location", "Residencia")} value={c.home_location} />
          <Field label={t("Source", "Fuente")} value={c.source} />
          {c.alt_sources.length > 0 && <Field label={t("Also applied from", "También aplicó desde")} value={c.alt_sources.join(", ")} />}
          <Field label={t("Registered", "Registrado")} value={fmtDate(c.reg_date)} />
          <Field label={t("Recruiter", "Reclutador")} value={recName} />
          {job && <Field label={t("Job opening", "Vacante")} value={job.title} />}
          {c.phone_date && <Field label={t("Phone interview", "Entrevista telefónica")} value={fmtDateTime(c.phone_date)} />}
          {c.inperson_date && <Field label={t("In-person interview", "Entrevista presencial")} value={fmtDateTime(c.inperson_date)} />}
          <Field
            label={t("Resume screen", "Filtro de CV")}
            value={
              c.resume_name
                ? t("✓ CV attached", "✓ CV adjunto")
                : c.resume_passed
                ? t("✓ Passed", "✓ Aprobado")
                : t("Not marked", "Sin marcar")
            }
          />
          {c.follow_up && <Field label={t("Follow-up", "Seguimiento")} value={fmtDate(c.follow_up)} />}
          {c.extra_phones.length > 0 && <Field label={t("Other phones", "Otros teléfonos")} value={c.extra_phones.join(", ")} />}
          {c.extra_emails.length > 0 && <Field label={t("Other emails", "Otros correos")} value={c.extra_emails.join(", ")} />}
          {c.offer_status !== "none" && <Field label={t("Offer", "Oferta")} value={`${OFFER_STATUS[c.offer_status].label}${c.offer_salary ? " · " + c.offer_salary : ""}`} />}
          {customFields.filter((cf) => c.custom?.[cf.id]).map((cf) => <Field key={cf.id} label={cf.label} value={c.custom[cf.id]} />)}
        </div>

        {c.tags.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12 }}>
            {c.tags.map((tg) => <span key={tg} className="tag">{tg}</span>)}
          </div>
        )}

        {c.notes && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase" }}>{t("Notes", "Notas")}</div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{c.notes}</div>
          </div>
        )}

        {s.type === "lost" && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {c.discard_reason ? (
              <span className="alert-tag">
                {t("Discard reason:", "Motivo de descarte:")} {c.discard_reason}
                {c.discard_source ? ` · ${c.discard_source === "manager" ? t("by Manager", "por Gerente") : t("by Recruiter", "por Reclutador")}` : ""}
              </span>
            ) : (
              // discarded with no reason on record — always offer to fill it in
              <>
                <span className="alert-tag">⚠ {t("Discarded with no reason on record", "Descartado sin motivo registrado")}</span>
                <button className="btn btn-danger btn-sm" onClick={() => ui.openDiscard(c.id, c.status)}>
                  📝 {t("Add reason", "Agregar motivo")}
                </button>
              </>
            )}
            {c.discard_reason && (
              <button className="btn btn-ghost btn-sm" onClick={() => ui.openDiscard(c.id, c.status)}>
                ✏️ {t("Edit reason", "Editar motivo")}
              </button>
            )}
          </div>
        )}

        {/* Files — resume/CV + extra attachments */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>📎 {t("Files", "Archivos")}</div>
          {!c.resume_name && attachmentsFor(c.id).length === 0 && (
            <div className="hint" style={{ margin: 0 }}>{t("No files attached. Add a CV from Edit.", "Sin archivos adjuntos. Agrega un CV desde Editar.")}</div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {c.resume_name && (
              <button className="btn btn-ghost btn-sm" onClick={() => openResumeFile(c.id)}>📎 {t("CV", "CV")}: {c.resume_name}</button>
            )}
            {attachmentsFor(c.id).map((a) => (
              <button key={a.id} className="btn btn-ghost btn-sm" onClick={() => openAttachment(a.id)}>📎 {a.name}</button>
            ))}
          </div>
        </div>

        {/* Stage timeline — date entered + days spent in each stage */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{t("Stage history", "Historial de etapas")}</div>
          {history.length === 0 && <div className="hint" style={{ margin: 0 }}>{t("No stage changes recorded yet.", "Aún no hay cambios de etapa registrados.")}</div>}
          {history.map((h, i) => {
            const st = stageOf(stages, h.stage_key);
            const next = history[i + 1];
            const days = daysBetween(h.entered_at, next ? next.entered_at : new Date().toISOString());
            const isCurrent = !next;
            return (
              <div key={h.id} className="log-row" style={{ alignItems: "center" }}>
                <span className="dot" style={{ background: st.color, flex: "0 0 10px" }} />
                <b style={{ flex: "0 0 160px" }}>{st.label}</b>
                <span style={{ flex: "0 0 150px", color: "var(--gray)" }}>{fmtDateTime(h.entered_at)}</span>
                <span style={{ flex: 1, fontWeight: 600, color: isCurrent ? st.color : "var(--gray)" }}>
                  {days}{t("d", "d")}{isCurrent ? " · " + t("current", "actual") : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* Activity timeline — inline, always visible */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>🕓 {t("Timeline", "Cronología")}{nContact ? ` (${nContact})` : ""}</div>
          <ActivityLog id={c.id} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => { close(); ui.openInterview(c.id); }}>🎤 {c.interview ? t("Edit interview", "Editar entrevista") : t("Start interview", "Iniciar entrevista")}</button>
          <button className="btn btn-ghost" onClick={() => { close(); ui.openSchedule(c.id); }}>📅 {t("Schedule call", "Agendar llamada")}</button>
          <button className="btn btn-ghost" onClick={() => { close(); ui.openScheduleInPerson(c.id); }}>🤝 {t("Schedule in-person", "Agendar presencial")}</button>
          {c.interview && <button className="btn btn-green" onClick={() => { close(); ui.openResume(c.id); }}>📋 {t("Summary", "Resumen")}</button>}
          <button className="btn btn-ghost" onClick={() => { close(); ui.openEdit(c.id); }}>✏️ {t("Edit", "Editar")}</button>
          {/* reversible, so no confirm — but say what happened, since the row
              vanishes from the default list the moment it is archived */}
          <button
            className="btn btn-ghost"
            title={c.archived
              ? t("Bring back to the active list", "Regresar a la lista activa")
              : t("Hide from the active list — find it again with the Archived filter", "Ocultar de la lista activa — se recupera con el filtro Archivados")}
            onClick={async () => {
              await updateCandidate(c.id, { archived: !c.archived });
              notify(c.archived ? t("Unarchived ✓", "Desarchivado ✓") : t("Archived ✓ — see the Archived filter", "Archivado ✓ — míralo en el filtro Archivados"));
              close();
            }}
          >
            🗄 {c.archived ? t("Unarchive", "Desarchivar") : t("Archive", "Archivar")}
          </button>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Schedule (phone or in-person) ---------------- */
function ScheduleModal({ id, kind, close }: { id: string; kind: "phone" | "inperson"; close: () => void }) {
  const { candidates, stages, updateCandidate, addContact, notify } = useData();
  const { t } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const existing = kind === "phone" ? c?.phone_date : c?.inperson_date;
  const [dt, setDt] = useState(existing ? existing.slice(0, 16) : "");
  if (!c) return null;
  const phone = kind === "phone";
  const title = phone ? t("Schedule phone interview", "Programar entrevista telefónica") : t("Schedule in-person interview", "Programar entrevista presencial");
  const label = phone ? t("Call date and time", "Fecha y hora de la llamada") : t("Interview date and time", "Fecha y hora de la entrevista");
  const inPersonStage = stages.find((s) => s.key === "inperson");

  const save = async () => {
    const iso = dt ? new Date(dt).toISOString() : null;
    if (phone) {
      await updateCandidate(c.id, { phone_date: iso, status: iso && c.status === "registered" ? "phone" : c.status });
      notify(t("Call scheduled ✓", "Llamada programada ✓"));
    } else {
      await updateCandidate(c.id, { inperson_date: iso, status: iso && inPersonStage ? "inperson" : c.status });
      if (iso) await addContact(c.id, { type: "In person", result: "Scheduled", note: fmtDateTime(iso) });
      notify(t("In-person interview scheduled ✓", "Entrevista presencial programada ✓"));
    }
    close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{phone ? "📅" : "🤝"} {title} — {c.name}</h3>
        <label>{label}</label>
        <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={save}>{t("Save", "Guardar")}</button>
          {existing && (
            <button
              className="btn btn-danger"
              onClick={async () => {
                await updateCandidate(c.id, phone ? { phone_date: null } : { inperson_date: null });
                close();
              }}
            >
              {t("Remove date", "Quitar fecha")}
            </button>
          )}
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>
            {t("Cancel", "Cancelar")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- New candidate (fast registration) ----------------
 * Deliberately short: only what the recruiter needs while the candidate is on
 * the phone. Email, source, job, tags, notes and custom fields are filled in
 * later from the profile. */
const NEW_CANDIDATE_SOURCE = "Indeed";

/** digits only, so "+504 9999-8888", "50499998888" and "9999 8888" compare alike */
const phoneDigits = (p: string | null) => (p || "").replace(/[^0-9]/g, "");

function NewCandidateModal({ close }: { close: () => void }) {
  const { candidates, roles, stages, me, addCandidate, addContact, notify, uploadResume } = useData();
  const { t } = usePrefs();
  const ui = useUI();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState(roles[0] || "");
  const [location, setLocation] = useState("TBD");
  const [homeLocation, setHomeLocation] = useState("");
  const [phoneDt, setPhoneDt] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [tenure, setTenure] = useState("");
  const [language, setLanguage] = useState("");
  const [education, setEducation] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const dirty =
    !!(name || phone || homeLocation || phoneDt || resume || tenure || language || education);

  // Live duplicate lookup on the phone field: catch the repeat applicant while
  // typing, instead of only warning at save time. Substring match so a partial
  // number already surfaces it; 4 digits before it starts, or every candidate
  // would match an empty-ish query.
  // The record we just created must never count as a duplicate of itself: the
  // moment addCandidate() lands, it shows up in `candidates` and would light up
  // the red block for a heartbeat before the modal closes. Ignore it, and hide
  // the whole warning while a save is in flight.
  const pool = candidates.filter((c) => c.id !== createdId);

  const typed = phoneDigits(phone);
  const phoneMatches =
    typed.length >= 4 && !saving
      ? pool.filter((c) => phoneDigits(c.phone).includes(typed)).slice(0, 6)
      : [];
  const exactDup = phoneMatches.find((c) => phoneDigits(c.phone) === typed);

  // Same check on the name, so a repeat applicant typed with a different number
  // is caught too.
  const typedName = normalizeName(name);
  const nameDup =
    typedName.length >= 3 && !saving ? pool.find((c) => normalizeName(c.name) === typedName) : undefined;

  // Hard stop: with a match on either field there is nothing to save, so the
  // save buttons are disabled and the only way forward is the existing profile.
  const blockingDup = exactDup ?? nameDup;

  // Losing a half-typed candidate to a stray backdrop click is the same bug the
  // interview modal already had; ask before throwing the form away.
  const guardedClose = () => {
    if (dirty && !confirm(t(
      "Discard this candidate? What you typed will be lost.",
      "¿Descartar este candidato? Se perderá lo que escribiste.",
    ))) return;
    close();
  };

  /** Throw away this form and jump to the person who already exists. No confirm:
   * the whole point is that there is nothing worth keeping — they are already
   * in the system. Closing first keeps the profile from opening underneath. */
  const openExisting = (existingId: string) => {
    close();
    ui.openProfile(existingId);
  };

  const save = async (thenInterview: boolean) => {
    if (saving) return;
    if (!name.trim() || !phone.trim()) {
      notify(t("Name and phone are required", "El nombre y el teléfono son obligatorios"));
      return;
    }
    setSaving(true);
    try {
      // Never create a second record for someone already in the system. Same
      // phone (digits only) or same name = the same person: log that they
      // applied again, keep anything they brought, and open their profile.
      const dup =
        candidates.find((c) => typed.length >= 4 && phoneDigits(c.phone) === typed) ??
        candidates.find((c) => name.trim() && normalizeName(c.name) === normalizeName(name));
      if (dup) {
        await addContact(dup.id, { type: "Note", note: t("Applied again", "Aplicó de nuevo") });
        if (resume) await uploadResume(dup.id, resume);
        notify(t("Already registered — opening their profile", "Ya estaba registrado — abriendo su perfil"));
        openExisting(dup.id);
        return;
      }

      const prescreen: Record<string, string> = {};
      if (tenure.trim()) prescreen.tenure = tenure.trim();
      if (language.trim()) prescreen.language = language.trim();
      if (education.trim()) prescreen.education = education.trim();

      const phoneIso = phoneDt ? new Date(phoneDt).toISOString() : null;
      const created = await addCandidate({
        status: phoneIso ? "phone" : "registered",
        favorite: false,
        custom: {},
        assigned_recruiter: me?.id ?? null,
        name: name.trim(),
        phone: phone.trim(),
        role: role || null,
        location: location || null,
        home_location: homeLocation.trim() || null,
        source: NEW_CANDIDATE_SOURCE,
        reg_date: todayISO(),
        prescreen,
        phone_date: phoneIso,
      });
      if (created) setCreatedId(created.id); // so it can't flag itself as a duplicate
      if (created && resume) await uploadResume(created.id, resume);
      notify(t("Candidate registered ✓", "Candidato registrado ✓"));
      close();
      if (created && thenInterview) ui.openInterview(created.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={guardedClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <h3>➕ {t("New candidate", "Nuevo candidato")}</h3>
        <div className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
          {t(
            "Only the essentials — email, source, tags and notes can be filled in later from the profile.",
            "Solo lo esencial — correo, fuente, etiquetas y notas se pueden llenar después desde el perfil.",
          )}
        </div>

        <div className="q-block">
          <div className="q-text">👤 {t("Basic details", "Datos básicos")}</div>
          <div className="grid g2">
            <div>
              <label>{t("Name *", "Nombre *")}</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Full name", "Nombre completo")}
                style={nameDup ? { borderColor: "var(--red)", outlineColor: "var(--red)" } : undefined}
              />
              {nameDup && !exactDup && (
                <div className="dup-hits">
                  <div className="dup-hits-head" style={{ color: "var(--red)" }}>
                    ⚠ {t("This name is already registered", "Este nombre ya está registrado")}
                  </div>
                  <div className="dup-hit">
                    <b>{nameDup.name}</b>
                    <span style={{ color: "var(--gray)" }}>{nameDup.phone}</span>
                    <span className="sema" style={{ background: stageOf(stages, nameDup.status).color + "22", color: stageOf(stages, nameDup.status).color, marginLeft: "auto" }}>
                      {stageOf(stages, nameDup.status).label}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => openExisting(nameDup.id)}>
                      👤 {t("Open profile", "Abrir perfil")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label>{t("Phone *", "Teléfono *")}</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+504..."
                style={exactDup ? { borderColor: "var(--red)", outlineColor: "var(--red)" } : undefined}
              />
              {phoneMatches.length > 0 && (
                <div className="dup-hits">
                  <div className="dup-hits-head" style={{ color: exactDup ? "var(--red)" : "var(--ink-soft)" }}>
                    {exactDup
                      ? "⚠ " + t("This phone is already registered", "Este teléfono ya está registrado")
                      : "🔍 " + t("Similar phone already registered", "Teléfono parecido ya registrado")}
                  </div>
                  {phoneMatches.map((m) => {
                    const st = stageOf(stages, m.status);
                    return (
                      <div key={m.id} className="dup-hit">
                        <b>{m.name}</b>
                        <span style={{ color: "var(--gray)" }}>{m.phone}</span>
                        {m.role && <span style={{ color: "var(--gray)" }}>· {m.role}</span>}
                        <span className="sema" style={{ background: st.color + "22", color: st.color, marginLeft: "auto" }}>{st.label}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => openExisting(m.id)}>
                          👤 {t("Open profile", "Abrir perfil")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <label>{t("Assigned role", "Puesto asignado")}</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => <option key={r}>{r}</option>)}
                {role && !roles.includes(role) && <option>{role}</option>}
              </select>
            </div>
            <div>
              <label>{t("Store", "Tienda")}</label>
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label>{t("Home location", "Lugar de residencia")}</label>
              <input value={homeLocation} onChange={(e) => setHomeLocation(e.target.value)} placeholder={t("City / neighborhood where they live", "Ciudad / colonia donde vive")} />
            </div>
          </div>
        </div>

        <div className="q-block">
          <div className="q-text">📅 {t("Interview & CV", "Entrevista y CV")}</div>
          <div className="grid g2">
            <div>
              <label>{t("Schedule call interview (optional)", "Programar entrevista por llamada (opcional)")}</label>
              <input type="datetime-local" value={phoneDt} onChange={(e) => setPhoneDt(e.target.value)} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {/* interviewing them on the spot is the common case — one click for it */}
                <button className="chip" onClick={() => setPhoneDt(localDateTimeInput())}>
                  🕐 {t("Right now", "Ahorita")}
                </button>
                <button className="chip" onClick={() => setPhoneDt(localDateTimeInput(new Date(Date.now() + 3600_000)))}>
                  {t("In 1 hour", "En 1 hora")}
                </button>
                <button className="chip" onClick={() => { const d = new Date(Date.now() + 864e5); d.setHours(9, 0, 0, 0); setPhoneDt(localDateTimeInput(d)); }}>
                  {t("Tomorrow 9:00", "Mañana 9:00")}
                </button>
                {phoneDt && (
                  <button className="chip" style={{ color: "var(--gray)" }} onClick={() => setPhoneDt("")}>
                    ✕ {t("Clear", "Quitar")}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label>{t("Resume / CV", "Currículum / CV")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
                  {resume ? "📎 " + resume.name : t("Upload CV", "Subir CV")}
                  <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" style={{ display: "none" }}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) setResume(file); e.target.value = ""; }} />
                </label>
                {resume && <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={() => setResume(null)}>{t("Remove", "Quitar")}</button>}
              </div>
            </div>
          </div>
        </div>

        <div className="q-block">
          <div className="q-text">❓ {t("Prescreen questions", "Preguntas de prescreening")}</div>
          <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
            {t(
              "Shown next to the matching question during the phone interview so you can compare.",
              "Se muestra junto a la pregunta correspondiente durante la entrevista telefónica para poder comparar.",
            )}
          </div>
          <div className="grid g3">
            <div>
              <label>{t("Tenure / job history", "Permanencia / historial laboral")}</label>
              <textarea rows={2} value={tenure} onChange={(e) => setTenure(e.target.value)} />
            </div>
            <div>
              <label>{t("Language skill", "Idioma")}</label>
              <textarea rows={2} value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
            <div>
              <label>{t("Education / certifications", "Educación / certificaciones")}</label>
              <textarea rows={2} value={education} onChange={(e) => setEducation(e.target.value)} />
            </div>
          </div>
        </div>

        {blockingDup && (
          <div className="dup-block">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              🚫 {t("Cannot continue — this candidate already exists", "No puedes continuar — este candidato ya existe")}
            </div>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}>
              <b>{blockingDup.name}</b> · {blockingDup.phone}
              {blockingDup.role ? ` · ${blockingDup.role}` : ""} · {stageOf(stages, blockingDup.status).label}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" onClick={() => openExisting(blockingDup.id)}>
                👤 {t("Open their profile", "Abrir su perfil")}
              </button>
              <span className="hint" style={{ margin: 0, alignSelf: "center" }}>
                {t("Change the name or phone if this is a different person.", "Cambia el nombre o el teléfono si es otra persona.")}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button className="btn btn-primary" disabled={saving || !!blockingDup} onClick={() => save(false)}>
            {saving ? t("Saving…", "Guardando…") : t("Save candidate", "Guardar candidato")}
          </button>
          <button className="btn btn-green" disabled={saving || !!blockingDup} onClick={() => save(true)}>
            🎤 {t("Save & start interview", "Guardar e iniciar entrevista")}
          </button>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={guardedClose}>{t("Cancel", "Cancelar")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- In-person outcome (hired / standby / discarded) ----------------
 * Recorded from the Outcomes tab once the interview has happened. Writing the
 * outcome is what moves the candidate out of the "inperson" stage, which is
 * exactly what clears them from that tab — no extra column involved. */
type OutcomeKind = "hired" | "standby" | "discarded";

function OutcomeModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, stages, updateCandidate, addContact, notify } = useData();
  const { t } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const [kind, setKind] = useState<OutcomeKind | null>(null);
  const [note, setNote] = useState("");
  const [source, setSource] = useState<"recruiter" | "manager">("recruiter");
  const [saving, setSaving] = useState(false);
  if (!c) return null;

  // stage keys are configurable, so resolve by type where possible
  const wonStage = stages.find((s) => s.type === "won");
  const lostStage = stages.find((s) => s.type === "lost");
  const standbyStage = stages.find((s) => s.key === "standby") ?? stages.find((s) => s.type === "active" && s.key !== "inperson");
  const target = kind === "hired" ? wonStage : kind === "standby" ? standbyStage : lostStage;

  const OPTIONS: { kind: OutcomeKind; icon: string; label: string; color: string; available: boolean }[] = [
    { kind: "hired", icon: "✅", label: t("Hired", "Contratado"), color: "var(--green)", available: !!wonStage },
    { kind: "standby", icon: "⏸", label: t("Standby", "En espera"), color: "var(--amber)", available: !!standbyStage },
    { kind: "discarded", icon: "🚫", label: t("Discarded", "Descartado"), color: "var(--red)", available: !!lostStage },
  ];

  const save = async () => {
    if (!kind || !target || saving) return;
    setSaving(true);
    const from = stageOf(stages, c.status).label;
    const patch: Partial<Candidate> = { status: target.key };
    if (kind === "discarded") {
      patch.discard_reason = note.trim() || null;
      patch.discard_source = source;
    }
    await updateCandidate(c.id, patch);
    const who = kind === "discarded" ? (source === "manager" ? t("Manager", "Gerente") : t("Recruiter", "Reclutador")) + ": " : "";
    await addContact(c.id, {
      type: "In person",
      result: `${from} → ${target.label}`,
      note: who + note.trim(),
    });
    notify(t("Outcome recorded ✓", "Resultado registrado ✓"));
    close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🤝 {t("In-person interview outcome", "Resultado de la entrevista presencial")} — {c.name}</h3>
        <div className="cand-meta" style={{ marginBottom: 14 }}>
          <span>💼 {c.role}</span>
          {c.inperson_date && <span>🤝 {fmtDateTime(c.inperson_date)}</span>}
        </div>

        <label>{t("What happened?", "¿Qué pasó?")}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {OPTIONS.filter((o) => o.available).map((o) => (
            <button
              key={o.kind}
              className={"chip " + (kind === o.kind ? "on" : "")}
              style={kind === o.kind ? { background: o.color, borderColor: o.color, color: "#fff" } : undefined}
              onClick={() => setKind(o.kind)}
            >
              {o.icon} {o.label}
            </button>
          ))}
        </div>

        {kind === "discarded" && (
          <>
            <label style={{ marginTop: 12 }}>{t("Decided by", "Decidido por")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={"chip " + (source === "recruiter" ? "on" : "")} onClick={() => setSource("recruiter")}>🧑‍💼 {t("Recruiter", "Reclutador")}</button>
              <button className={"chip " + (source === "manager" ? "on" : "")} onClick={() => setSource("manager")}>👔 {t("Manager", "Gerente")}</button>
            </div>
          </>
        )}

        <label style={{ marginTop: 12 }}>
          {kind === "discarded" ? t("Reason (for when the manager asks)", "Motivo (para cuando el gerente pregunte)") : t("Notes (optional)", "Notas (opcional)")}
        </label>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("How did the interview go?", "¿Cómo salió la entrevista?")}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-primary" disabled={!kind || saving} onClick={save}>
            {saving ? t("Saving…", "Guardando…") : t("Save outcome", "Guardar resultado")}
          </button>
          <button className="btn btn-ghost" onClick={() => { close(); }}>{t("Cancel", "Cancelar")}</button>
        </div>
        {!kind && <div className="hint">{t("Pick an outcome to continue.", "Elige un resultado para continuar.")}</div>}
      </div>
    </div>
  );
}

/* ---------------- Discard (reason + who decided) ---------------- */
function DiscardModal({ id, stageKey, close }: { id: string; stageKey: string; close: () => void }) {
  const { candidates, stages, updateCandidate, addContact, notify } = useData();
  const { t } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const [reason, setReason] = useState(c?.discard_reason ?? "");
  const [source, setSource] = useState<"recruiter" | "manager">((c?.discard_source as "recruiter" | "manager") || "recruiter");
  if (!c) return null;
  const from = stageOf(stages, c.status).label;
  const to = stageOf(stages, stageKey).label;

  // Already in the lost stage = we are filling in a reason that was left blank,
  // not discarding again. Changes the wording and keeps the log honest.
  const fillingIn = c.status === stageKey;

  const save = async () => {
    if (!reason.trim()) return; // a discard without a reason is what we are fixing
    await updateCandidate(c.id, { status: stageKey, discard_reason: reason.trim(), discard_source: source });
    const who = source === "manager" ? t("Manager", "Gerente") : t("Recruiter", "Reclutador");
    await addContact(c.id, {
      type: "Stage",
      result: fillingIn ? t("Discard reason added", "Motivo de descarte agregado") : `${from} → ${to}`,
      note: `${who}: ${reason.trim()}`,
    });
    notify(fillingIn ? t("Reason saved ✓", "Motivo guardado ✓") : t("Discarded ✓", "Descartado ✓"));
    close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {fillingIn ? "📝 " + t("Add discard reason", "Agregar motivo de descarte") : "🚫 " + t("Discard candidate", "Descartar candidato")} — {c.name}
        </h3>
        <label>{t("Reason * (for when the manager asks)", "Motivo * (para cuando el gerente pregunte)")}</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why is this candidate being discarded?", "¿Por qué se descarta este candidato?")} />
        <label style={{ marginTop: 10 }}>{t("Decided by", "Decidido por")}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={"chip " + (source === "recruiter" ? "on" : "")} onClick={() => setSource("recruiter")}>🧑‍💼 {t("Recruiter", "Reclutador")}</button>
          <button className={"chip " + (source === "manager" ? "on" : "")} onClick={() => setSource("manager")}>👔 {t("Manager", "Gerente")}</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-danger" disabled={!reason.trim()} onClick={save}>
            {fillingIn ? t("Save reason", "Guardar motivo") : t("Discard", "Descartar")}
          </button>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Cancel", "Cancelar")}</button>
          {!reason.trim() && (
            <span className="hint" style={{ margin: 0 }}>
              {t("Write a reason to continue.", "Escribe un motivo para continuar.")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Edit ---------------- */
function EditModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, updateCandidate, addContact, notify, roles, recruiters, customFields, jobs, uploadResume, removeResume, openResumeFile, attachmentsFor, addAttachment, removeAttachment, openAttachment } = useData();
  const { t } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const files = c ? attachmentsFor(c.id) : [];
  const [f, setF] = useState(() => ({
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    role: c?.role ?? "",
    location: c?.location ?? "",
    home_location: c?.home_location ?? "",
    source: c?.source ?? "",
    reg_date: c?.reg_date ?? "",
    notes: c?.notes ?? "",
    assigned_recruiter: c?.assigned_recruiter ?? "",
    job_id: c?.job_id ?? "",
    tags: (c?.tags ?? []).join(", "),
    extra_phones: (c?.extra_phones ?? []).join(", "),
    extra_emails: (c?.extra_emails ?? []).join(", "),
    custom: { ...(c?.custom ?? {}) } as Record<string, string>,
    prescreen: { tenure: "", language: "", education: "", age: "", ...(c?.prescreen ?? {}) },
  }));
  if (!c) return null;

  const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const saveEdit = async () => {
    const patch = {
      name: f.name, phone: f.phone, email: f.email, role: f.role, location: f.location || null,
      home_location: f.home_location || null, source: f.source,
      reg_date: f.reg_date, notes: f.notes, custom: f.custom,
      assigned_recruiter: f.assigned_recruiter || null,
      job_id: f.job_id || null,
      tags: splitList(f.tags),
      extra_phones: splitList(f.extra_phones),
      extra_emails: splitList(f.extra_emails),
      prescreen: Object.fromEntries(Object.entries(f.prescreen).filter(([, v]) => v.trim())),
    };
    // #3 change history: note which fields changed
    const changed: string[] = [];
    if (f.name !== c.name) changed.push("name");
    if (f.phone !== c.phone) changed.push("phone");
    if ((f.email || "") !== (c.email || "")) changed.push("email");
    if (f.role !== (c.role || "")) changed.push("role");
    if ((f.job_id || "") !== (c.job_id || "")) changed.push("job");
    if (f.assigned_recruiter !== (c.assigned_recruiter || "")) changed.push("recruiter");
    if (f.tags !== (c.tags ?? []).join(", ")) changed.push("tags");
    await updateCandidate(c.id, patch);
    if (changed.length) await addContact(c.id, { type: "Edit", result: "Updated", note: changed.join(", ") });
    notify(t("Saved ✓", "Guardado ✓"));
    close();
  };
  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>✏️ {t("Edit candidate", "Editar candidato")}</h3>
        <div className="grid g2">
          <div><label>{t("Name", "Nombre")}</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label>{t("Phone", "Teléfono")}</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label>{t("Email", "Correo")}</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div>
            <label>{t("Role", "Puesto")}</label>
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roles.map((r) => <option key={r}>{r}</option>)}
              {f.role && !roles.includes(f.role) && <option>{f.role}</option>}
            </select>
          </div>
          <div>
            <label>{t("Store / location", "Tienda / ubicación")}</label>
            <select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}>
              <option value="">—</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              {f.location && !LOCATIONS.includes(f.location) && <option value={f.location}>{f.location}</option>}
            </select>
          </div>
          <div><label>{t("Home location", "Lugar de residencia")}</label><input value={f.home_location} onChange={(e) => setF({ ...f, home_location: e.target.value })} placeholder={t("City / neighborhood where they live", "Ciudad / colonia donde vive")} /></div>
          <div><label>{t("Source", "Fuente")}</label><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
          <div><label>{t("Registration date", "Fecha de registro")}</label><input type="date" value={f.reg_date} onChange={(e) => setF({ ...f, reg_date: e.target.value })} /></div>
          <div>
            <label>{t("Recruiter", "Reclutador")}</label>
            <select value={f.assigned_recruiter} onChange={(e) => setF({ ...f, assigned_recruiter: e.target.value })}>
              <option value="">—</option>
              {recruiters.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
          </div>
          <div>
            <label>{t("Job opening", "Vacante")}</label>
            <select value={f.job_id} onChange={(e) => setF({ ...f, job_id: e.target.value })}>
              <option value="">—</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}{j.status === "closed" ? t(" (closed)", " (cerrada)") : ""}</option>)}
            </select>
          </div>
          {customFields.map((cf) => (
            <div key={cf.id}>
              <label>{cf.label}</label>
              <input
                value={f.custom[cf.id] ?? ""}
                onChange={(e) => setF({ ...f, custom: { ...f.custom, [cf.id]: e.target.value } })}
              />
            </div>
          ))}
        </div>
        <div className="grid g3" style={{ marginTop: 10 }}>
          <div><label>{t("Tags (comma-separated)", "Etiquetas (separadas por coma)")}</label><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder={t("bilingual, referral", "bilingüe, referido")} /></div>
          <div><label>{t("Extra phones (comma)", "Teléfonos extra (coma)")}</label><input value={f.extra_phones} onChange={(e) => setF({ ...f, extra_phones: e.target.value })} /></div>
          <div><label>{t("Extra emails (comma)", "Correos extra (coma)")}</label><input value={f.extra_emails} onChange={(e) => setF({ ...f, extra_emails: e.target.value })} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ fontWeight: 700 }}>{t("Prescreen answers (optional)", "Respuestas de prescreening (opcional)")}</label>
          <div className="grid g3">
            <div>
              <label>{t("Tenure / job history", "Permanencia / historial laboral")}</label>
              <textarea rows={2} value={f.prescreen.tenure} onChange={(e) => setF({ ...f, prescreen: { ...f.prescreen, tenure: e.target.value } })} />
            </div>
            <div>
              <label>{t("Language skill", "Idioma")}</label>
              <textarea rows={2} value={f.prescreen.language} onChange={(e) => setF({ ...f, prescreen: { ...f.prescreen, language: e.target.value } })} />
            </div>
            <div>
              <label>{t("Education / certifications", "Educación / certificaciones")}</label>
              <textarea rows={2} value={f.prescreen.education} onChange={(e) => setF({ ...f, prescreen: { ...f.prescreen, education: e.target.value } })} />
            </div>
            <div>
              <label>{t("Age capacity (reference only — never scored)", "Capacidad por edad (solo referencia — nunca se califica)")}</label>
              <textarea rows={2} value={f.prescreen.age} onChange={(e) => setF({ ...f, prescreen: { ...f.prescreen, age: e.target.value } })} />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>{t("Notes", "Notas")}</label>
          <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        <div style={{ marginTop: 10 }}>
          <label>{t("Resume / CV", "Currículum / CV")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {c.resume_name ? (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => openResumeFile(c.id)}>📎 {c.resume_name}</button>
                <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={() => { if (confirm(t("Remove attached CV?", "¿Quitar el CV adjunto?"))) removeResume(c.id); }}>{t("Remove", "Quitar")}</button>
              </>
            ) : (
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
                {t("Upload CV", "Subir CV")}
                <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" style={{ display: "none" }}
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadResume(c.id, file); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>{t("More files", "Más archivos")} ({files.length})</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1, textAlign: "left" }} onClick={() => openAttachment(a.id)}>📎 {a.name}</button>
                <button className="btn btn-sm" style={{ color: "var(--gray)" }} title={t("Remove", "Quitar")} onClick={() => { if (confirm(t("Remove ", "¿Quitar ") + a.name + "?")) removeAttachment(a.id); }}>✕</button>
              </div>
            ))}
            <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0, alignSelf: "flex-start" }}>
              ＋ {t("Add file", "Agregar archivo")}
              <input type="file" style={{ display: "none" }}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) addAttachment(c.id, file); e.target.value = ""; }} />
            </label>
          </div>
          <div className="hint">{t("Extra documents: cover letter, certificates, ID, portfolio…", "Documentos extra: carta de presentación, certificados, identificación, portafolio…")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" onClick={saveEdit}>{t("Save changes", "Guardar cambios")}</button>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>
            {t("Cancel", "Cancelar")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Interview ---------------- */
// Categories the recruiter already asked about at registration (see the
// candidate's `prescreen` field). Pinned first in the interview so the
// interviewer can re-ask and compare against what was captured then.
// "Age Capacity" is deliberately not here — it's shown as an unscored
// reference note instead of a graded question (age-discrimination risk).
const PRESCREEN_CATEGORIES = ["Tenure", "Language Skill", "Education / Certifications"];
const PRESCREEN_KEY_BY_CATEGORY: Record<string, string> = {
  "Tenure": "tenure",
  "Language Skill": "language",
  "Education / Certifications": "education",
};

/* ---- Interview drafts ----
 * An interview is filled in live, on a call, and used to be held only in React
 * state: any close — a stray click on the backdrop, a closed tab, a crash —
 * threw the whole thing away silently. Two real interviews were lost that way.
 * Every keystroke is now mirrored to localStorage and restored on reopen.
 *
 * localStorage (not a `candidates` column) on purpose: it needs no migration and
 * survives a crash or an offline moment, which is exactly when a draft matters.
 * The trade-off is that a draft does not follow you to another browser — a saved
 * interview does, and `save()` clears the draft, so this only affects work that
 * was never saved anywhere. */
const DRAFT_PREFIX = "recruit_interview_draft_";
type InterviewDraft = {
  answers: Record<string, InterviewAnswer>;
  notes: string;
  at: string;
  recruiterScore?: number | null;
  recommendation?: RecruiterRecommendation | null;
};

function readDraft(id: string): InterviewDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + id);
    if (!raw) return null;
    const d = JSON.parse(raw) as InterviewDraft;
    return d && typeof d === "object" && d.answers ? d : null;
  } catch { return null; }
}
function writeDraft(id: string, d: InterviewDraft) {
  try { localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(d)); } catch { /* ignore */ }
}
function clearDraft(id: string) {
  try { localStorage.removeItem(DRAFT_PREFIX + id); } catch { /* ignore */ }
}
// A draft only wins over the saved interview when it is newer. Otherwise it is
// leftover from before a save (possibly on another device) and is dropped, so a
// stale draft can never shadow a real saved interview.
function freshDraft(id: string, savedAt: string | undefined): InterviewDraft | null {
  const d = readDraft(id);
  if (!d) return null;
  if (savedAt && new Date(d.at).getTime() <= new Date(savedAt).getTime()) {
    clearDraft(id);
    return null;
  }
  return d;
}

function InterviewModal({ id, close, openResume }: { id: string; close: () => void; openResume: (id: string) => void }) {
  const { candidates, questions, jobs, questionSets, settings, stages, updateCandidate, addContact, notify } = useData();
  const { t, lang } = usePrefs();
  const ui = useUI();
  const c = candidates.find((x) => x.id === id);
  const lostStage = stages.find((s) => s.type === "lost");
  const qs = useMemo(() => {
    const job = jobs.find((j) => j.id === c?.job_id) ?? null;
    const defSet = questionSets.find((s) => s.is_default) ?? null;
    // Which set to interview from, in order of specificity:
    //   1. the set the candidate's job pins, if any;
    //   2. the set explicitly assigned to the candidate's position;
    //   3. a set holding questions tagged with their role — the implicit link,
    //      kept for sets whose position was never set;
    //   4. the default set, for positions that have no set of their own.
    // Note (3) must win over (4): the filter below requires a question to be in
    // the chosen set, so falling straight back to the default — as this once
    // did — silently dropped every role-specific question and showed only the
    // default set's generic ones, whatever the candidate's role.
    const roleSetId = c?.role
      ? (questionSets.find((s) => s.role === c.role)?.id ??
         questions.find((q) => q.active && q.role === c.role && q.set_id)?.set_id ??
         null)
      : null;
    const setId = job?.question_set_id ?? roleSetId ?? defSet?.id ?? null;
    const filtered = questions.filter(
      (q) => q.active && (q.role === "all" || q.role === c?.role) && (setId ? q.set_id === setId : true),
    );
    // Pin the prescreen-matched categories (Tenure, Language Skill, Education)
    // first, in that order, so the interviewer sees the registration-time
    // answer and re-asks it right away. Array.prototype.sort is stable, so
    // everything else keeps its original (DB `sort` column) order.
    return filtered.slice().sort((a, b) => {
      const ai = PRESCREEN_CATEGORIES.indexOf(a.category ?? "");
      const bi = PRESCREEN_CATEGORIES.indexOf(b.category ?? "");
      return (ai === -1 ? PRESCREEN_CATEGORIES.length : ai) - (bi === -1 ? PRESCREEN_CATEGORIES.length : bi);
    });
  }, [questions, c?.role, c?.job_id, jobs, questionSets]);
  // Restore a newer draft over the saved interview; see freshDraft above.
  const restored = useMemo(() => freshDraft(id, c?.interview?.date), [id, c?.interview?.date]);
  const [answers, setAnswers] = useState<Record<string, InterviewAnswer>>(
    () => restored?.answers ?? (c?.interview ? { ...c.interview.answers } : {}),
  );
  const [notes, setNotes] = useState(restored?.notes ?? c?.interview?.generalNotes ?? "");
  const [recruiterScore, setRecruiterScore] = useState<number | null>(
    restored?.recruiterScore ?? c?.interview?.recruiterScore ?? null,
  );
  const [recommendation, setRecommendation] = useState<RecruiterRecommendation | null>(
    restored?.recommendation ?? c?.interview?.recommendation ?? null,
  );
  const [draftAt, setDraftAt] = useState<string | null>(restored?.at ?? null);
  const [showRestored, setShowRestored] = useState(!!restored);
  // Unsaved edits made in THIS session. Starts false so merely opening a
  // candidate never writes a draft or triggers the leave warnings.
  const [dirty, setDirty] = useState(false);

  // Mirror every edit to localStorage. Skips the first run so opening the modal
  // is not itself treated as an edit.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const at = new Date().toISOString();
    writeDraft(id, { answers, notes, at, recruiterScore, recommendation });
    setDraftAt(at);
    setDirty(true);
  }, [answers, notes, recruiterScore, recommendation, id]);

  // Closing the tab / reloading mid-interview. The draft is already written, so
  // this is a second line of defence, not the save itself.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!c) return null;

  const setAns = (qid: string, patch: Partial<InterviewAnswer>) =>
    setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] ?? { grade: null, note: "" }), ...patch } }));
  const toggleSkip = (qid: string) =>
    setAnswers((a) => {
      const cur = a[qid] ?? { grade: null, note: "" };
      return { ...a, [qid]: { ...cur, skipped: !cur.skipped, grade: cur.skipped ? cur.grade : null } };
    });

  const avg = scoreAverage(answers, qs, settings);

  // Quick call-outcome logging (voicemail / no answer / etc.) — logs a contact and closes.
  // callAgain tags the candidate so failed calls stay visible until an interview is saved.
  const logOutcome = async (result: string, callAgain: boolean) => {
    await addContact(c.id, { type: "Call", result, note: "" });
    if (callAgain && !c.tags.includes(CALL_AGAIN_TAG)) {
      await updateCandidate(c.id, { tags: [...c.tags, CALL_AGAIN_TAG] });
    }
    notify(t("Logged: ", "Registrado: ") + result);
    close();
  };

  // Anything worth persisting? Opening the modal and immediately discarding the
  // candidate should not stamp them with an empty 0-score interview.
  const hasContent =
    notes.trim().length > 0 ||
    recruiterScore != null ||
    recommendation != null ||
    Object.values(answers).some((a) => a.grade != null || (a.note ?? "").trim().length > 0);

  /** Write the interview to the candidate. No toast, no close — callers decide. */
  const persistInterview = async () => {
    const interview: Interview = {
      answers,
      generalNotes: notes,
      average: avg, // null when nothing was graded — 0 would read as a real bad score
      recruiterScore,
      recommendation,
      date: new Date().toISOString(),
      questions: qs.map((q) => ({
        text: qText(q, lang),
        weight: q.weight || 1,
        grade: answers[q.id]?.grade ?? null,
        note: answers[q.id]?.note ?? "",
        category: q.category ?? null,
      })),
    };
    await updateCandidate(c.id, {
      interview,
      ...(c.tags.includes(CALL_AGAIN_TAG) ? { tags: c.tags.filter((tg) => tg !== CALL_AGAIN_TAG) } : {}),
    });
    // Saved for real — the draft has done its job.
    clearDraft(c.id);
    setDirty(false);
  };

  const save = async (thenResume: boolean) => {
    await persistInterview();
    notify(t("Interview saved ✓", "Entrevista guardada ✓"));
    close();
    if (thenResume) openResume(c.id);
  };

  /** Discard straight from the interview. Whatever was graded is saved first —
   * those answers are the evidence for the decision — then the normal discard
   * modal collects the reason and who decided. */
  const saveAndDiscard = async () => {
    if (!lostStage) return;
    if (hasContent) await persistInterview();
    else { clearDraft(c.id); setDirty(false); }
    close();
    ui.openDiscard(c.id, lostStage.key);
  };

  // The ONLY ways out of this modal are the buttons below. The backdrop no
  // longer closes it, and leaving with unsaved edits asks first.
  const guardedClose = () => {
    if (dirty && !confirm(t(
      "This interview is not saved. Your answers are kept as a draft and will be here when you reopen it — but they are NOT saved to the candidate yet. Close anyway?",
      "Esta entrevista no está guardada. Tus respuestas quedan como borrador y estarán aquí al reabrirla — pero AÚN NO se guardan en el candidato. ¿Cerrar de todos modos?",
    ))) return;
    close();
  };

  const discardDraft = () => {
    if (!confirm(t("Discard this draft and start from the saved interview?", "¿Descartar este borrador y partir de la entrevista guardada?"))) return;
    clearDraft(c.id);
    setAnswers(c.interview ? { ...c.interview.answers } : {});
    setNotes(c.interview?.generalNotes ?? "");
    setRecruiterScore(c.interview?.recruiterScore ?? null);
    setRecommendation(c.interview?.recommendation ?? null);
    setShowRestored(false);
    setDraftAt(null);
    // The state writes above re-run the autosave effect, which would immediately
    // recreate the draft we just cleared. Re-arm the first-run skip so it doesn't.
    first.current = true;
    setDirty(false);
  };

  return (
    /* No onClick on the overlay: a mis-click outside used to close this modal and
       silently discard the whole interview. Use the buttons at the bottom. */
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <h3>🎤 {t("Phone interview", "Entrevista telefónica")} — {c.name}</h3>
        {showRestored && (
          <div className="q-block" style={{ background: "var(--tint-warn)", border: "1px solid var(--tint-warn-line)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13 }}>
                <b>📝 {t("Draft restored", "Borrador restaurado")}</b>{" "}
                {t("— unsaved answers from ", "— respuestas sin guardar del ")}{restored ? fmtDateTime(restored.at) : ""}.{" "}
                {t("Review them and press Save.", "Revísalas y presiona Guardar.")}
              </span>
              <button className="btn btn-sm" style={{ color: "var(--gray)" }} onClick={discardDraft}>
                {t("Discard draft", "Descartar borrador")}
              </button>
            </div>
          </div>
        )}
        <div className="cand-meta" style={{ marginBottom: 10, alignItems: "center" }}>
          {/* Dial straight from the interview: this is where the call is actually
              made, so the RingCentral link belongs here and not only on the row. */}
          <a className="link-tel" href={rcCall(c.phone)} onClick={() => addContact(c.id, { type: "Call", result: "", note: "" })}>
            📞 {t("Call", "Llamar")} {c.phone}
          </a>
          <a className="link-tel" href={rcSms(c.phone)} onClick={() => addContact(c.id, { type: "SMS", result: "sent", note: "" })}>
            💬 {t("Text", "Texto")}
          </a>
          <span>💼 {c.role}</span>
          {c.phone_date && <span>📅 {fmtDateTime(c.phone_date)}</span>}
        </div>
        {/* Quick call outcome — log without scoring when the call didn't happen */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, alignSelf: "center" }}>{t("Didn't connect?", "¿No conectó?")}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => logOutcome(t("No answer", "Sin respuesta"), true)}>📵 {t("No answer", "Sin respuesta")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => logOutcome(t("Voicemail", "Buzón de voz"), true)}>📞 {t("Voicemail", "Buzón de voz")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => logOutcome(t("Wrong number", "Número equivocado"), false)}>❌ {t("Wrong number", "Número equivocado")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => logOutcome(t("Call back later", "Volver a llamar"), true)}>🔁 {t("Call back later", "Volver a llamar")}</button>
        </div>
        {qs.length === 0 && (
          <div className="empty">{t("No active questions for this role. Configure them in Settings.", "No hay preguntas activas para este puesto. Configúralas en Ajustes.")}</div>
        )}
        {c.prescreen?.age && (
          <div className="q-block" style={{ background: "var(--surface-soft)" }}>
            <div className="q-text" style={{ fontWeight: 700 }}>
              🎂 {t("Age capacity — from registration (reference only, not scored)", "Capacidad por edad — de registro (solo referencia, no se califica)")}
            </div>
            <div style={{ fontSize: 13 }}>{c.prescreen.age}</div>
          </div>
        )}
        {qs.map((q, i) => {
          const a = answers[q.id] || { grade: null, note: "" };
          const scale = scaleFor(q, settings);
          const prescreenKey = q.category ? PRESCREEN_KEY_BY_CATEGORY[q.category] : undefined;
          const prescreenAnswer = prescreenKey ? c.prescreen?.[prescreenKey] : undefined;
          return (
            <div key={q.id} className="q-block" style={{ opacity: a.skipped ? 0.55 : 1 }}>
              <div className="q-text" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>{q.category && <span className="badge" style={{ marginRight: 6, background: "var(--tint-indigo)", color: "var(--indigo)", fontWeight: 700 }}>🏷 {q.category}</span>}{i + 1}. {qText(q, lang)}{a.skipped && <span className="badge" style={{ marginLeft: 6, background: "var(--track)", color: "var(--gray)" }}>{t("Skipped", "Omitida")}</span>}</span>
                <button className="btn btn-sm" style={{ color: a.skipped ? "var(--accent)" : "var(--gray)" }} onClick={() => toggleSkip(q.id)}>
                  {a.skipped ? "↩ " + t("Un-skip", "Deshacer") : "⤼ " + t("Skip / N/A", "Omitir / N/A")}
                </button>
              </div>
              {prescreenAnswer && (
                <div style={{ background: "var(--surface-soft)", border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px", marginBottom: 8, fontSize: 12, color: "var(--gray)" }}>
                  <b>{t("From registration:", "De registro:")}</b> {prescreenAnswer}
                </div>
              )}
              {!a.skipped && (
                <>
                  <div className="grades" style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {scale.map((lvl) => {
                      const label = lang === "es" ? lvl.label_es : lvl.label_en;
                      const example = lang === "es" ? lvl.example_es : lvl.example_en;
                      return (
                        <button
                          key={lvl.value}
                          className={"grade-btn" + (a.grade === lvl.value ? " sel" : "")}
                          title={example}
                          onClick={() => setAns(q.id, { grade: lvl.value })}
                          style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 62, padding: "6px 8px", lineHeight: 1.15 }}
                        >
                          <b>{lvl.value}</b>
                          <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <input
                    placeholder={t("Answer note (optional)...", "Nota de la respuesta (opcional)...")}
                    value={a.note}
                    onChange={(e) => setAns(q.id, { note: e.target.value })}
                  />
                </>
              )}
            </div>
          );
        })}
        <div className="q-block">
          <div className="q-text">{t("General notes", "Notas generales")}</div>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("Overall impression, attitude, communication...", "Impresión general, actitud, comunicación...")}
          />
        </div>

        {/* The recruiter's own call, kept separate from the computed question average */}
        <div className="q-block" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
          <div className="q-text">🧑‍💼 {t("Your assessment", "Tu evaluación")}</div>

          <label>{t("Recruiter rating (1–5)", "Calificación del reclutador (1–5)")}</label>
          <div className="grades" style={{ marginBottom: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={"grade-btn" + (recruiterScore === n ? " sel" : "")}
                onClick={() => setRecruiterScore(recruiterScore === n ? null : n)}
                aria-pressed={recruiterScore === n}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 0 }}>
            {t(
              "Your own read of the call — separate from the question score above. Click again to clear.",
              "Tu propia lectura de la llamada — aparte del puntaje de las preguntas de arriba. Haz clic de nuevo para quitarla.",
            )}
          </div>

          <label style={{ marginTop: 12 }}>{t("Recommendation", "Recomendación")}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {RECOMMENDATIONS.map((r) => (
              <button
                key={r.id}
                className={"chip " + (recommendation === r.id ? "on" : "")}
                style={recommendation === r.id ? { background: r.color, borderColor: r.color, color: "#fff" } : undefined}
                onClick={() => setRecommendation(recommendation === r.id ? null : r.id)}
                aria-pressed={recommendation === r.id}
              >
                {r.icon} {lang === "es" ? r.es : r.en}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 12, color: "var(--gray)", fontWeight: 600 }}>{t("SCORE", "PUNTAJE")}</span>
            <br />
            <span className="avg-big" style={{ color: scoreColor(avg) }}>
              {fmtPct(avg)}
            </span>
            {avg != null && <span style={{ marginLeft: 8, fontSize: 13, color: "var(--gray)" }}>{levelLabel(avg, scaleFor(null, settings), lang)}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {draftAt && (
              <span style={{ fontSize: 11, color: "var(--gray)", fontWeight: 600 }} title={t("Kept on this device until you save", "Se guarda en este dispositivo hasta que guardes")}>
                {dirty ? "📝 " + t("Draft saved ", "Borrador guardado ") + fmtDateTime(draftAt) : ""}
              </span>
            )}
            <button className="btn btn-primary" onClick={() => save(false)}>{t("Save", "Guardar")}</button>
            <button className="btn btn-green" onClick={() => save(true)}>{t("Save and view summary", "Guardar y ver resumen")}</button>
            {lostStage && (
              <button
                className="btn btn-danger"
                onClick={saveAndDiscard}
                title={t("Saves whatever you graded, then asks for the discard reason", "Guarda lo que hayas calificado y luego pide el motivo del descarte")}
              >
                🚫 {t("Discard", "Descartar")}
              </button>
            )}
            <button className="btn" style={{ color: "var(--gray)" }} onClick={guardedClose}>{t("Close", "Cerrar")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Resume / Summary ---------------- */
function ResumeModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, stages, settings, questions, updateCandidate, notify } = useData();
  const { t } = usePrefs();
  const inPersonStage = stages.find((s) => s.key === "inperson");

  /** What the candidate answered about pay — the answer only, never the question,
   * which is a paragraph long. Found by the "Wage" category rather than by
   * matching wording, so it survives rewording and works per role.
   * `answers` is keyed by question id; the snapshot carries the category so
   * interviews whose question was later deleted still resolve. */
  const wageAnswer = (iv: Interview | null): string => {
    if (!iv) return "";
    const isWage = (cat?: string | null) => (cat || "").trim().toLowerCase() === "wage";
    const fromSnapshot = iv.questions.find((q) => isWage(q.category) && (q.note || "").trim());
    if (fromSnapshot) return (fromSnapshot.note || "").trim();
    const q = questions.find((x) => isWage(x.category) && (iv.answers[x.id]?.note || "").trim());
    return q ? (iv.answers[q.id]?.note || "").trim() : "";
  };
  const c = candidates.find((x) => x.id === id);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [view, setView] = useState<"full" | "short">("full");
  const it = c?.interview ?? null;

  // Compact 3-line version for texting/emailing the manager quickly.
  const shortText = useMemo(() => {
    if (!c || !it) return "";
    const L = lang === "en";
    const answered = it.questions.filter((p) => p.grade != null);
    const rating = levelLabel(it.average, scaleFor(null, settings), L ? "en" : "es");
    const best = answered.length ? [...answered].sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0))[0] : null;
    const worst = answered.length > 1 ? [...answered].sort((a, b) => (a.grade ?? 0) - (b.grade ?? 0))[0] : null;
    const l1 =
      (L ? "Scored " : "Obtuvo ") + fmtPct(it.average) +
      (rating ? ` (${rating})` : "") +
      (L ? " in the phone interview" : " en la entrevista telefónica") +
      (it.date ? ` (${fmtDate(it.date)}).` : ".");
    // Notes go in whole — they used to be cut at 110 characters, which is exactly
    // where the useful detail tends to start. Line breaks are kept as written.
    const noteBit = it.generalNotes ? it.generalNotes.trim() : "";
    const l2 = noteBit
      ? (L ? "Notes: " : "Notas: ") + noteBit
      : best
      ? (L ? "Strongest: " : "Punto fuerte: ") + `"${best.text}" (${best.grade}/${MAX_SCORE})` +
        (worst && worst !== best ? (L ? "; weakest: " : "; punto débil: ") + `"${worst.text}" (${worst.grade}/${MAX_SCORE}).` : ".")
      : L ? "No interview notes recorded." : "Sin notas de entrevista.";
    // the recruiter's own verdict outranks the computed one — say it first
    const rec = recommendationOf(it.recommendation);
    const lRec = rec
      ? (L ? "Recruiter: " : "Reclutador: ") + rec.icon + " " + (L ? rec.en : rec.es) +
        (it.recruiterScore != null ? ` (${it.recruiterScore}/${RECRUITER_MAX_SCORE})` : "")
      : it.recruiterScore != null
      ? (L ? "Recruiter rating: " : "Calificación del reclutador: ") + `${it.recruiterScore}/${RECRUITER_MAX_SCORE}`
      : null;
    const l3 =
      (L ? "Recommendation: " : "Recomendación: ") +
      (it.average == null
        ? L ? "no questions scored — not enough information ➖" : "sin preguntas calificadas — información insuficiente ➖"
        : it.average >= 3.5
        ? L ? "move to in-person interview ✅" : "pasar a entrevista presencial ✅"
        : it.average >= 2.5
        ? L ? "possible candidate, needs manager review ⚠️" : "candidato posible, requiere revisión del manager ⚠️"
        : L ? "not recommended ❌" : "no recomendado ❌");
    const pay = wageAnswer(it);
    const lPay = pay ? (L ? "Expected pay: " : "Sueldo esperado: ") + pay : null;
    const lines = [
      `${c.name} — ${c.role ?? ""}${c.home_location ? ` (${c.home_location})` : ""}`,
      l1, l2, ...(lPay ? [lPay] : []), ...(lRec ? [lRec] : []), l3,
    ];
    if (c.inperson_date) {
      lines.push((L ? "In-person interview scheduled: " : "Entrevista presencial agendada: ") + fmtDateTime(c.inperson_date) + " 🤝");
    }
    return lines.join("\n");
  }, [c, it, lang, settings]);

  const text = useMemo(() => {
    if (!c || !it) return "";
    const L = lang === "en";
    const lines: string[] = [];
    lines.push(L ? "📋 CANDIDATE SUMMARY" : "📋 RESUMEN DE CANDIDATO", "");
    lines.push((L ? "Name: " : "Nombre: ") + c.name);
    lines.push((L ? "Phone: " : "Teléfono: ") + c.phone);
    if (c.email) lines.push("Email: " + c.email);
    lines.push((L ? "Role: " : "Rol: ") + (c.role ?? ""));
    lines.push((L ? "Source: " : "Fuente: ") + (c.source ?? "Indeed"));
    if (c.phone_date) lines.push((L ? "Phone interview: " : "Entrevista telefónica: ") + fmtDateTime(c.phone_date));
    lines.push((L ? "Overall score: " : "Calificación general: ") + fmtPct(it.average));
    const rating = levelLabel(it.average, scaleFor(null, settings), L ? "en" : "es");
    if (rating) lines.push((L ? "Rating: " : "Clasificación: ") + rating);
    lines.push("", L ? "— Interview details —" : "— Detalle de la entrevista —");
    // Only answered questions — skipped/unanswered ones stay out of the summary.
    it.questions.filter((p) => p.grade != null).forEach((p, i) => {
      lines.push(i + 1 + ". " + p.text);
      lines.push("   " + (L ? "Score: " : "Nota: ") + p.grade + "/" + MAX_SCORE + (p.note ? " — " + p.note : ""));
    });
    const payFull = wageAnswer(it);
    if (payFull) lines.push("", (L ? "Expected pay: " : "Sueldo esperado: ") + payFull);
    if (it.generalNotes) lines.push("", (L ? "General notes: " : "Notas generales: ") + it.generalNotes.trim());
    const own = recommendationOf(it.recommendation);
    if (own || it.recruiterScore != null) {
      lines.push("");
      if (it.recruiterScore != null) {
        lines.push((L ? "Recruiter rating: " : "Calificación del reclutador: ") + `${it.recruiterScore}/${RECRUITER_MAX_SCORE}`);
      }
      if (own) lines.push((L ? "Recruiter says: " : "El reclutador dice: ") + own.icon + " " + (L ? own.en : own.es));
    }
    lines.push("");
    const rec =
      it.average == null
        ? L ? "No questions scored — not enough information to recommend ➖" : "Sin preguntas calificadas — información insuficiente para recomendar ➖"
        : it.average >= 3.5
        ? L ? "Recommended for in-person interview ✅" : "Recomendado para entrevista presencial ✅"
        : it.average >= 2.5
        ? L ? "Possible candidate, review with manager ⚠️" : "Candidato posible, revisar con el manager ⚠️"
        : L ? "Not recommended ❌" : "No recomendado ❌";
    lines.push((L ? "Recommendation: " : "Recomendación: ") + rec);
    return lines.join("\n");
  }, [c, it, lang, settings]);

  if (!c || !it) return null;
  const ratingLabel = levelLabel(it.average, scaleFor(null, settings), lang);
  const activeText = view === "short" ? shortText : text;

  const copy = () => {
    navigator.clipboard?.writeText(activeText);
    updateCandidate(c.id, { summary_sent: true });
    notify(t("Summary copied ✓", "Resumen copiado ✓"));
  };
  const email = () => {
    const subject = (lang === "en" ? "Candidate for " : "Candidato para ") + c.role + " — " + c.name;
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(activeText);
    updateCandidate(c.id, { summary_sent: true });
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          📋 {t("Summary", "Resumen")} — {c.name}{" "}
          {ratingLabel && it.average != null && <span className="sema" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>● {ratingLabel} · {fmtPct(it.average)}</span>}
          {recommendationOf(it.recommendation) && (
            <span className="sema" style={{ background: recommendationOf(it.recommendation)!.color + "22", color: recommendationOf(it.recommendation)!.color, marginLeft: 6 }}>
              {recommendationOf(it.recommendation)!.icon} {lang === "es" ? recommendationOf(it.recommendation)!.es : recommendationOf(it.recommendation)!.en}
              {it.recruiterScore != null ? ` · ${it.recruiterScore}/${RECRUITER_MAX_SCORE}` : ""}
            </span>
          )}
        </h3>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <button className={"chip " + (lang === "en" ? "on" : "")} onClick={() => setLang("en")}>English</button>
          <button className={"chip " + (lang === "es" ? "on" : "")} onClick={() => setLang("es")}>Español</button>
          <span style={{ width: 10 }} />
          <button className={"chip " + (view === "full" ? "on" : "")} onClick={() => setView("full")}>📋 {t("Full", "Completo")}</button>
          <button className={"chip " + (view === "short" ? "on" : "")} onClick={() => setView("short")}>⚡ {t("Short (for manager)", "Corto (para manager)")}</button>
        </div>
        <pre className="resume">{activeText}</pre>
        {c.summary_sent && <div className="sent-tag" style={{ marginTop: 10 }}>✓ {t("Marked as sent to manager", "Marcado como enviado al gerente")}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={copy}>📄 {t("Copy", "Copiar")}</button>
          <button className="btn btn-ghost" onClick={email}>✉️ {t("Send by email", "Enviar por correo")}</button>
          {inPersonStage && c.status !== "inperson" && (
            <button
              className="btn btn-green"
              onClick={() => { updateCandidate(c.id, { status: "inperson" }); notify(t("Moved to ", "Movido a ") + inPersonStage.label + " ✓"); }}
            >
              ➡ {t("Move to", "Mover a")} {inPersonStage.label}
            </button>
          )}
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Message / Templates ---------------- */
function MessageModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, templates, addContact, notify, me } = useData();
  const { t: tr } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const [tplId, setTplId] = useState<string | null>(templates[0]?.id ?? null);
  const recruiter = me?.full_name ?? "";
  const [msg, setMsg] = useState(() => {
    const t = templates[0];
    return c && t ? mergeTemplate(t.text, c, recruiter) : "";
  });
  if (!c) return null;

  const pick = (tid: string) => {
    const t = templates.find((x) => x.id === tid);
    setTplId(tid);
    setMsg(t ? mergeTemplate(t.text, c, recruiter) : "");
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>💬 {tr("Message", "Mensaje")} — {c.name}</h3>
        {templates.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {templates.map((t) => (
              <button key={t.id} className={"chip " + (tplId === t.id ? "on" : "")} onClick={() => pick(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <label>{tr("Message (edit before sending)", "Mensaje (edítalo antes de enviar)")}</label>
        <textarea rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div className="hint">{tr("Placeholders:", "Marcadores:")} {"{name} {role} {recruiter} {phone}"}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              window.location.href = rcSms(c.phone, msg);
              addContact(c.id, { type: "SMS", result: "sent", note: msg.slice(0, 80) });
              notify(tr("Text opened in RingCentral ✓", "Texto abierto en RingCentral ✓"));
              close();
            }}
          >
            💬 {tr("Send text (RingCentral)", "Enviar texto (RingCentral)")}
          </button>
          <button
            className="btn btn-green"
            onClick={() => {
              window.location.href = rcCall(c.phone);
              addContact(c.id, { type: "Call", result: "", note: "" });
            }}
          >
            📞 {tr("Call (RingCentral)", "Llamar (RingCentral)")}
          </button>
          <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(msg); notify(tr("Copied ✓", "Copiado ✓")); }}>
            📄 {tr("Copy", "Copiar")}
          </button>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{tr("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Contact log + follow-up ---------------- */
function ContactModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, addContact, updateCandidate, notify, contactsFor } = useData();
  const { t } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const [type, setType] = useState("Call");
  const [result, setResult] = useState("Answered");
  const [note, setNote] = useState("");
  const [fu, setFu] = useState(c?.follow_up ?? "");
  if (!c) return null;
  const history = contactsFor(c.id);

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>📝 {t("Contact log", "Registro de contacto")} — {c.name}</h3>
        <div className="grid g3">
          <div>
            <label>{t("Type", "Tipo")}</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {([["Call", "Llamada"], ["SMS", "SMS"], ["Email", "Correo"], ["In person", "En persona"]] as const).map(([v, es]) => <option key={v} value={v}>{t(v, es)}</option>)}
            </select>
          </div>
          <div>
            <label>{t("Result", "Resultado")}</label>
            <select value={result} onChange={(e) => setResult(e.target.value)}>
              {([["Answered", "Contestó"], ["No answer", "Sin respuesta"], ["Rescheduled", "Reprogramado"], ["Voicemail", "Buzón de voz"], ["Declined", "Rechazó"], ["Other", "Otro"]] as const).map(([v, es]) => <option key={v} value={v}>{t(v, es)}</option>)}
            </select>
          </div>
          <div><label>🔔 {t("Follow-up date", "Fecha de seguimiento")}</label><input type="date" value={fu} onChange={(e) => setFu(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>{t("Note", "Nota")}</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("What happened...", "Qué pasó...")} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await addContact(c.id, { type, result, note });
              if (fu !== (c.follow_up ?? "")) await updateCandidate(c.id, { follow_up: fu || null });
              notify(t("Contact logged ✓", "Contacto registrado ✓"));
              close();
            }}
          >
            {t("Save entry", "Guardar entrada")}
          </button>
          {c.follow_up && (
            <button className="btn btn-danger" onClick={() => { updateCandidate(c.id, { follow_up: null }); close(); }}>
              {t("Clear follow-up", "Quitar seguimiento")}
            </button>
          )}
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Close", "Cerrar")}</button>
        </div>
        {history.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <label>{t("History", "Historial")}</label>
            {history.map((e) => (
              <div key={e.id} className="log-row">
                <b style={{ flex: "0 0 130px" }}>{fmtDateTime(e.created_at)}</b>
                <span style={{ flex: "0 0 90px", fontWeight: 600 }}>{e.type}</span>
                <span style={{ flex: "0 0 100px", color: "var(--gray)" }}>{e.result}</span>
                <span style={{ flex: 1 }}>{e.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Offer / hire ---------------- */
function OfferModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, stages, updateCandidate, addContact, notify } = useData();
  const { t } = usePrefs();
  const wonKey = stages.find((s) => s.type === "won")?.key ?? "hired";
  const c = candidates.find((x) => x.id === id);
  const [salary, setSalary] = useState(c?.offer_salary ?? "");
  const [start, setStart] = useState(c?.offer_start_date ?? "");
  const [status, setStatus] = useState<Candidate["offer_status"]>(c?.offer_status ?? "none");
  const [notes, setNotes] = useState(c?.offer_notes ?? "");
  if (!c) return null;

  const save = async () => {
    const patch: Partial<Candidate> = {
      offer_salary: salary || null,
      offer_start_date: start || null,
      offer_status: status,
      offer_notes: notes || null,
    };
    // when the offer is accepted, move the candidate to Hired
    if (status === "accepted" && c.status !== wonKey) patch.status = wonKey;
    await updateCandidate(c.id, patch);
    if (status !== c.offer_status) {
      await addContact(c.id, { type: "Offer", result: OFFER_STATUS[status].label, note: salary ? "Salary: " + salary : "" });
    }
    notify(t("Offer saved ✓", "Oferta guardada ✓"));
    close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>💼 {t("Offer", "Oferta")} — {c.name}</h3>
        <div className="grid g2">
          <div><label>{t("Offered salary", "Salario ofrecido")}</label><input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder={t("e.g. L 18,000 / month", "p. ej. L 18,000 / mes")} /></div>
          <div><label>{t("Start date", "Fecha de inicio")}</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div>
            <label>{t("Offer status", "Estado de la oferta")}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as Candidate["offer_status"])}>
              <option value="none">{t("No offer", "Sin oferta")}</option>
              <option value="extended">{t("Offer extended", "Oferta enviada")}</option>
              <option value="accepted">{t("Offer accepted (→ Hired)", "Oferta aceptada (→ Contratado)")}</option>
              <option value="declined">{t("Offer declined", "Oferta rechazada")}</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label>{t("Notes", "Notas")}</label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Benefits, conditions, negotiation...", "Beneficios, condiciones, negociación...")} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" onClick={save}>{t("Save offer", "Guardar oferta")}</button>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Cancel", "Cancelar")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Activity timeline ---------------- */
function ActivityLog({ id }: { id: string }) {
  const { candidates, contactsFor, recruiters, addContact, me, notify } = useData();
  const { t } = usePrefs();
  const [note, setNote] = useState("");
  const c = candidates.find((x) => x.id === id);
  if (!c) return null;

  const authorName = (uid: string | null) =>
    uid ? recruiters.find((r) => r.id === uid)?.full_name ?? t("Someone", "Alguien") : null;

  type Event = { at: string; icon: string; title: string; detail?: string; who?: string | null };
  const events: Event[] = [];
  if (c.reg_date) events.push({ at: c.reg_date + "T00:00:00", icon: "📇", title: t("Registered", "Registrado"), detail: c.source ?? undefined, who: authorName(c.created_by) });
  if (c.phone_date) events.push({ at: c.phone_date, icon: "☎", title: t("Phone call scheduled", "Llamada programada"), detail: fmtDateTime(c.phone_date) });
  if (c.interview?.date)
    events.push({ at: c.interview.date, icon: "🎤", title: t("Interview completed", "Entrevista completada"), detail: t("Score ", "Puntaje ") + fmtPct(c.interview.average) });
  contactsFor(c.id).forEach((e: Contact) =>
    events.push({
      at: e.created_at,
      icon: e.type === "Stage" ? "🔀" : e.type === "Offer" ? "💼" : e.type === "Note" ? "🗒" : "📝",
      title: e.type + (e.result ? " — " + e.result : ""),
      detail: e.note ?? undefined,
      who: authorName(e.created_by),
    }),
  );
  if (c.offer_status && c.offer_status !== "none")
    events.push({ at: c.updated_at, icon: "💼", title: OFFER_STATUS[c.offer_status].label, detail: c.offer_salary ?? undefined });

  events.sort((a, b) => b.at.localeCompare(a.at));

  const addNote = async () => {
    if (!note.trim()) return;
    await addContact(c.id, { type: "Note", note: note.trim(), created_by: me?.id ?? null });
    setNote("");
    notify(t("Note added ✓", "Nota agregada ✓"));
  };

  return (
    <>
        <div style={{ marginBottom: 14 }}>
          <label>{t("Add a note", "Agregar una nota")}</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("What happened? (visible to the whole team, with your name)", "¿Qué pasó? (visible para todo el equipo, con tu nombre)")} />
          <div style={{ marginTop: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={addNote} disabled={!note.trim()}>{t("Add note", "Agregar nota")}</button>
          </div>
        </div>

        {events.length === 0 && <div className="empty">{t("No activity yet.", "Aún no hay actividad.")}</div>}
        {events.map((e, i) => (
          <div key={i} className="log-row">
            <span style={{ flex: "0 0 24px", fontSize: 16 }}>{e.icon}</span>
            <b style={{ flex: "0 0 140px" }}>{fmtDateTime(e.at)}</b>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.title}</div>
              {e.detail && <div style={{ color: "var(--gray)" }}>{e.detail}</div>}
              {e.who && <div style={{ color: "var(--gray)", fontSize: 11 }}>— {e.who}</div>}
            </div>
          </div>
        ))}
    </>
  );
}

function TimelineModal({ id, close }: { id: string; close: () => void }) {
  const { candidates } = useData();
  const { t } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  if (!c) return null;
  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🕓 {t("Timeline", "Cronología")} — {c.name}</h3>
        <ActivityLog id={id} />
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Close", "Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Compare ---------------- */
function CompareModal({ ids, close, clear }: { ids: string[]; close: () => void; clear: () => void }) {
  const { candidates, customFields, recruiters, stages, settings } = useData();
  const { t, lang } = usePrefs();
  const cs = ids.map((id) => candidates.find((c) => c.id === id)).filter(Boolean) as Candidate[];
  const recName = (rid: string | null) => recruiters.find((r) => r.id === rid)?.full_name ?? "—";
  const rows: [string, (c: Candidate) => string][] = [
    [t("Role", "Puesto"), (c) => c.role ?? "—"],
    [t("Location", "Ubicación"), (c) => c.location ?? "—"],
    [t("Home location", "Residencia"), (c) => c.home_location ?? "—"],
    [t("Status", "Estado"), (c) => stageOf(stages, c.status).label],
    [t("Score", "Puntaje"), (c) => fmtPct(c.interview?.average)],
    [t("Rating", "Clasificación"), (c) => levelLabel(c.interview?.average, scaleFor(null, settings), lang) ?? "—"],
    [t("Source", "Fuente"), (c) => c.source ?? "—"],
    [t("Phone", "Teléfono"), (c) => c.phone],
    [t("Registered", "Registrado"), (c) => fmtDate(c.reg_date)],
    [t("Recruiter", "Reclutador"), (c) => recName(c.assigned_recruiter)],
    ...customFields.map((cf) => [cf.label, (c: Candidate) => c.custom?.[cf.id] ?? "—"] as [string, (c: Candidate) => string]),
  ];
  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <h3>⚖ {t("Compare candidates", "Comparar candidatos")}</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="cmp-tbl">
            <thead>
              <tr>
                <th></th>
                {cs.map((c) => <th key={c.id}>{c.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => (
                <tr key={label}>
                  <td className="rowh">{label}</td>
                  {cs.map((c) => <td key={c.id}>{fn(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn" style={{ color: "var(--gray)" }} onClick={close}>{t("Close", "Cerrar")}</button>
          <button className="btn btn-danger" onClick={clear}>{t("Clear selection", "Limpiar selección")}</button>
        </div>
      </div>
    </div>
  );
}
