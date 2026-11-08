"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ctx, type DataState } from "@/lib/recruiting-data-provider";
import type {
  Attachment, Candidate, Contact, CustomField, Job, Profile, Question, QuestionSet, Settings, Stage, Template,
} from "@/lib/recruiting/types";
import type { Profile as PerfilDelHub } from "@/lib/types";
import { DEFAULT_SETTINGS, DEFAULT_STAGES } from "@/lib/recruiting/constants";
import { etapasEnIdioma } from "@/lib/recruiting/etapas-idioma";
import { estandarizaCandidato } from "@/lib/recruiting/formato";
import { nombreDelCv } from "@/lib/recruiting/nombre-del-cv";
import { bumpSort, sortByIds } from "@/lib/recruiting/sort-plan";
import { usePrefs } from "@/lib/prefs";
import { CLAVE_DEMO_RRHH } from "@/lib/recruiting/modo-demo";
import { semillaRrhh, type SemillaRrhh } from "@/lib/recruiting/demo-data";

// ============================================================
// MODO DEMO de RR. HH. (D-932) — sin base ni sesión. Todo vive en el navegador (memoria + localStorage), con la
// MISMA interfaz `DataState` y el MISMO contexto `Ctx` que el proveedor de Supabase: `useData()` no cambia en ninguna
// pantalla. Calcado de `local-data-provider.tsx` (Entregas). Nada de red: ni Supabase, ni Storage, ni /api.
// ============================================================

type Almacen = SemillaRrhh;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Lo que se pinta ANTES de leer localStorage: igual en el servidor y en el cliente, para que no haya desajuste de
 *  hidratación. La semilla de verdad entra en el primer efecto. */
const VACIO: Almacen = {
  settings: DEFAULT_SETTINGS, stages: DEFAULT_STAGES, recruiters: [], jobs: [], questionSets: [], questions: [], templates: [],
  customFields: [], candidates: [], contacts: [], stageHistory: [], attachments: [],
};

function cargar(): Almacen {
  try {
    const raw = window.localStorage.getItem(CLAVE_DEMO_RRHH);
    if (raw) return JSON.parse(raw) as Almacen;
  } catch { /* corrupto: se vuelve a sembrar */ }
  const s = semillaRrhh(new Date());
  window.localStorage.setItem(CLAVE_DEMO_RRHH, JSON.stringify(s));
  return s;
}

export function reiniciarDemoRrhh() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CLAVE_DEMO_RRHH);
  window.location.reload();
}

export function DemoDataProvider({ children, me, hub = null }: { children: React.ReactNode; me: Profile | null; hub?: PerfilDelHub | null }) {
  const [store, setStore] = useState<Almacen>(VACIO);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { lang, t } = usePrefs();
  const tRef = useRef(t);
  tRef.current = t;
  const tr = useCallback((en: string, es: string) => tRef.current(en, es), []);

  // Espejo de `store` que se actualiza EN EL ACTO con cada escritura: dos escrituras seguidas en el mismo tick (p. ej.
  // «cambiar de etapa» y «anotar el contacto») no se pisan, y lo que se guarda en localStorage es siempre lo último.
  const ref = useRef<Almacen>(VACIO);
  const escribe = useCallback((fn: (s: Almacen) => Almacen) => {
    const next = fn(ref.current);
    ref.current = next;
    setStore(next);
    try { window.localStorage.setItem(CLAVE_DEMO_RRHH, JSON.stringify(next)); } catch { /* lleno o bloqueado: sigue en memoria */ }
  }, []);

  useEffect(() => {
    const s = cargar();
    ref.current = s;
    setStore(s);
    setReady(true);
  }, []);

  // Los ficheros que se adjuntan en esta sesión: el `File` como object URL, en memoria. Al recargar se pierden (la
  // ficha conserva el nombre), y abrirlos avisa: el demo no tiene Storage.
  const archivos = useRef(new Map<string, string>());

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const ahora = () => new Date().toISOString();

  // ---------------- Candidatos ----------------
  const addCandidate = useCallback<DataState["addCandidate"]>(async (c) => {
    const iso = ahora();
    const nuevo: Candidate = {
      id: uid(), name: "", phone: "", email: null, role: null, location: null, home_location: null, source: null, alt_sources: [],
      reg_date: iso.slice(0, 10), notes: null, status: ref.current.stages[0]?.key ?? "registered", phone_date: null, inperson_date: null,
      resume_passed: false, favorite: false, photo: null, custom: {}, prescreen: {}, interview: null, follow_up: null, summary_sent: false,
      discard_reason: null, discard_source: null, resume_path: null, resume_name: null, offer_salary: null, offer_start_date: null,
      offer_status: "none", offer_notes: null, tags: [], extra_phones: [], extra_emails: [], pinned: false, archived: false,
      stage_changed_at: iso, job_id: null, assigned_recruiter: me?.id ?? null, created_by: me?.id ?? null, created_at: iso, updated_at: iso,
      ...estandarizaCandidato(c),
    };
    escribe((s) => ({
      ...s,
      candidates: [nuevo, ...s.candidates],
      stageHistory: [...s.stageHistory, { id: uid(), candidate_id: nuevo.id, stage_key: nuevo.status, entered_at: iso, changed_by: me?.id ?? null }],
    }));
    return nuevo;
  }, [escribe, me]);

  const updateCandidate = useCallback<DataState["updateCandidate"]>(async (id, patch) => {
    const iso = ahora();
    const cambiaEtapa = patch.status !== undefined;
    const finalPatch: Partial<Candidate> = estandarizaCandidato(cambiaEtapa ? { ...patch, stage_changed_at: iso } : patch);
    escribe((s) => {
      const antes = s.candidates.find((c) => c.id === id);
      const candidates = s.candidates.map((c) => (c.id === id ? { ...c, ...finalPatch, updated_at: iso } : c));
      const stageHistory = cambiaEtapa && antes && antes.status !== patch.status
        ? [...s.stageHistory, { id: uid(), candidate_id: id, stage_key: patch.status!, entered_at: iso, changed_by: me?.id ?? null }]
        : s.stageHistory;
      return { ...s, candidates, stageHistory };
    });
  }, [escribe, me]);

  const deleteCandidate = useCallback<DataState["deleteCandidate"]>(async (id) => {
    escribe((s) => ({
      ...s,
      candidates: s.candidates.filter((c) => c.id !== id),
      contacts: s.contacts.filter((k) => k.candidate_id !== id),
      stageHistory: s.stageHistory.filter((h) => h.candidate_id !== id),
      attachments: s.attachments.filter((a) => a.candidate_id !== id),
    }));
  }, [escribe]);

  const toggleFavorite = useCallback<DataState["toggleFavorite"]>(async (id) => {
    const c = ref.current.candidates.find((x) => x.id === id);
    if (c) await updateCandidate(id, { favorite: !c.favorite });
  }, [updateCandidate]);

  const addContact = useCallback<DataState["addContact"]>(async (candidateId, entry) => {
    const nuevo: Contact = { id: uid(), candidate_id: candidateId, type: entry.type ?? "Note", result: null, note: null, created_by: me?.id ?? null, created_at: ahora(), ...entry };
    escribe((s) => ({ ...s, contacts: [nuevo, ...s.contacts] }));
    return true;
  }, [escribe, me]);

  const contactsFor = useCallback((candidateId: string) => store.contacts.filter((c) => c.candidate_id === candidateId), [store.contacts]);
  const stageHistoryFor = useCallback(
    (candidateId: string) => store.stageHistory.filter((h) => h.candidate_id === candidateId).sort((a, b) => a.entered_at.localeCompare(b.entered_at)),
    [store.stageHistory],
  );

  // ---------------- CV y adjuntos (en memoria) ----------------
  const abre = useCallback((path: string | null | undefined) => {
    const url = path ? archivos.current.get(path) : undefined;
    if (url) window.open(url, "_blank");
    else notify(tr("Demo: the file is not kept after reloading the page.", "Demo: el archivo no se conserva al recargar la página."));
  }, [notify, tr]);

  const uploadResume = useCallback<DataState["uploadResume"]>(async (candidateId, file, candidateName) => {
    const nombre = nombreDelCv(candidateName ?? ref.current.candidates.find((c) => c.id === candidateId)?.name, file.name);
    const path = `demo/${candidateId}/${uid()}`;
    archivos.current.set(path, URL.createObjectURL(file));
    await updateCandidate(candidateId, { resume_path: path, resume_name: nombre, resume_passed: true });
    notify(tr("CV attached ✓", "CV adjuntado ✓"));
  }, [updateCandidate, notify, tr]);

  const removeResume = useCallback<DataState["removeResume"]>(async (candidateId) => {
    await updateCandidate(candidateId, { resume_path: null, resume_name: null });
    notify(tr("CV removed", "CV quitado"));
  }, [updateCandidate, notify, tr]);

  const openResumeFile = useCallback<DataState["openResumeFile"]>(async (candidateId) => {
    const c = ref.current.candidates.find((x) => x.id === candidateId);
    if (c?.resume_path) abre(c.resume_path);
  }, [abre]);

  // El enlace corto lo firma el servidor (D-593): en el demo no hay. `null` es lo que el botón ya sabe manejar.
  const resumeLink = useCallback<DataState["resumeLink"]>(async () => {
    notify(tr("Demo: the CV link needs the server.", "Demo: el enlace del CV necesita el servidor."));
    return null;
  }, [notify, tr]);

  const attachmentsFor = useCallback((candidateId: string) => store.attachments.filter((a) => a.candidate_id === candidateId), [store.attachments]);
  const addAttachment = useCallback<DataState["addAttachment"]>(async (candidateId, file) => {
    const path = `demo/${candidateId}/att_${uid()}`;
    archivos.current.set(path, URL.createObjectURL(file));
    const a: Attachment = { id: uid(), candidate_id: candidateId, path, name: file.name, created_by: me?.id ?? null, created_at: ahora() };
    escribe((s) => ({ ...s, attachments: [a, ...s.attachments] }));
    notify(tr("File attached ✓", "Archivo adjuntado ✓"));
  }, [escribe, me, notify, tr]);
  const removeAttachment = useCallback<DataState["removeAttachment"]>(async (attachmentId) => {
    escribe((s) => ({ ...s, attachments: s.attachments.filter((a) => a.id !== attachmentId) }));
    notify(tr("File removed", "Archivo quitado"));
  }, [escribe, notify, tr]);
  const openAttachment = useCallback<DataState["openAttachment"]>(async (attachmentId) => {
    abre(ref.current.attachments.find((a) => a.id === attachmentId)?.path);
  }, [abre]);

  // ---------------- Ajustes, preguntas, plantillas, campos ----------------
  const saveSettings = useCallback<DataState["saveSettings"]>(async (patch) => {
    escribe((s) => ({ ...s, settings: { ...s.settings, ...patch } as Settings }));
  }, [escribe]);

  const addQuestion = useCallback<DataState["addQuestion"]>(async (q) => {
    escribe((s) => ({ ...s, questions: [...s.questions, { id: uid(), text: "", text_es: null, category: null, role: "all", active: true, weight: 1, scale: null, set_id: null, sort: s.questions.length, ...q } as Question] }));
  }, [escribe]);
  const updateQuestion = useCallback<DataState["updateQuestion"]>(async (id, patch) => {
    escribe((s) => ({ ...s, questions: s.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  }, [escribe]);
  const deleteQuestion = useCallback<DataState["deleteQuestion"]>(async (id) => {
    escribe((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== id) }));
  }, [escribe]);
  const duplicateQuestion = useCallback<DataState["duplicateQuestion"]>(async (id) => {
    escribe((s) => {
      const original = s.questions.find((q) => q.id === id);
      if (!original) return s;
      const bumps = new Map(bumpSort(s.questions.filter((q) => q.set_id === original.set_id), original.sort, { inclusive: false }).map((b) => [b.id, b.sort]));
      const copia: Question = { ...original, id: uid(), sort: original.sort + 1 };
      const questions = [...s.questions.map((q) => (bumps.has(q.id) ? { ...q, sort: bumps.get(q.id)! } : q)), copia].sort((a, b) => a.sort - b.sort);
      return { ...s, questions };
    });
  }, [escribe]);
  const reorderQuestions = useCallback<DataState["reorderQuestions"]>(async (ids) => {
    const sortById = new Map(sortByIds(ids).map((p) => [p.id, p.sort]));
    escribe((s) => ({ ...s, questions: s.questions.map((q) => (sortById.has(q.id) ? { ...q, sort: sortById.get(q.id)! } : q)).sort((a, b) => a.sort - b.sort) }));
  }, [escribe]);

  const addTemplate = useCallback<DataState["addTemplate"]>(async (tpl) => {
    escribe((s) => ({ ...s, templates: [...s.templates, { id: uid(), label: "", text: "", ...tpl } as Template] }));
  }, [escribe]);
  const deleteTemplate = useCallback<DataState["deleteTemplate"]>(async (id) => {
    escribe((s) => ({ ...s, templates: s.templates.filter((x) => x.id !== id) }));
  }, [escribe]);
  const addCustomField = useCallback<DataState["addCustomField"]>(async (label) => {
    escribe((s) => ({ ...s, customFields: [...s.customFields, { id: uid(), label, sort: s.customFields.length } as CustomField] }));
  }, [escribe]);
  const deleteCustomField = useCallback<DataState["deleteCustomField"]>(async (id) => {
    escribe((s) => ({ ...s, customFields: s.customFields.filter((c) => c.id !== id) }));
  }, [escribe]);

  const updateUserName = useCallback<DataState["updateUserName"]>(async (userId, name) => {
    const clean = name.trim();
    if (!clean) { notify(tr("Name can't be empty", "El nombre no puede quedar vacío")); return; }
    escribe((s) => ({ ...s, recruiters: s.recruiters.map((p) => (p.id === userId ? { ...p, full_name: clean } : p)) }));
    notify(tr("Name updated ✓", "Nombre actualizado ✓"));
  }, [escribe, notify, tr]);

  // ---------------- Vacantes ----------------
  const addJob = useCallback<DataState["addJob"]>(async (j) => {
    escribe((s) => ({ ...s, jobs: [{ id: uid(), title: "", role: null, status: "open", target_score: null, openings: 1, notes: null, question_set_id: null, created_at: ahora(), ...j } as Job, ...s.jobs] }));
    notify(tr("Job created ✓", "Puesto creado ✓"));
  }, [escribe, notify, tr]);
  const updateJob = useCallback<DataState["updateJob"]>(async (id, patch) => {
    escribe((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
  }, [escribe]);
  const deleteJob = useCallback<DataState["deleteJob"]>(async (id) => {
    escribe((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) }));
  }, [escribe]);

  // ---------------- Grupos de preguntas ----------------
  const addQuestionSet = useCallback<DataState["addQuestionSet"]>(async (name) => {
    escribe((s) => ({ ...s, questionSets: [...s.questionSets, { id: uid(), name, is_default: s.questionSets.length === 0, role: null, created_at: ahora() } as QuestionSet] }));
    notify(tr("Question set added ✓", "Grupo de preguntas agregado ✓"));
  }, [escribe, notify, tr]);
  const updateQuestionSet = useCallback<DataState["updateQuestionSet"]>(async (id, patch) => {
    // Un puesto, un grupo: la base lo exige con una restricción única; aquí se comprueba a mano y se avisa igual.
    if (patch.role) {
      const taken = ref.current.questionSets.find((x) => x.role === patch.role && x.id !== id);
      if (taken) {
        notify(tr(`"${patch.role}" is already used by the "${taken.name}" set. A position can only have one set.`, `"${patch.role}" ya lo usa el grupo "${taken.name}". Un puesto solo puede tener un grupo.`));
        return;
      }
    }
    escribe((s) => ({
      ...s,
      questionSets: s.questionSets.map((x) => (patch.is_default ? { ...x, ...(x.id === id ? patch : {}), is_default: x.id === id } : x.id === id ? { ...x, ...patch } : x)),
    }));
  }, [escribe, notify, tr]);
  const deleteQuestionSet = useCallback<DataState["deleteQuestionSet"]>(async (id) => {
    escribe((s) => ({ ...s, questionSets: s.questionSets.filter((x) => x.id !== id) }));
  }, [escribe]);

  const importScorecard = useCallback<DataState["importScorecard"]>(async (sc) => {
    const s0 = ref.current;
    const existente = s0.questionSets.find((x) => x.name === sc.set_name);
    if (existente && s0.questions.some((q) => q.set_id === existente.id)) {
      const n = s0.questions.filter((q) => q.set_id === existente.id).length;
      notify(tr(`"${sc.set_name}" already has ${n} questions — nothing imported.`, `"${sc.set_name}" ya tiene ${n} preguntas — no se importó nada.`));
      return 0;
    }
    const setId = existente?.id ?? uid();
    const base = s0.questions.length;
    const rows: Question[] = sc.items.map((it, i) => ({
      id: uid(), text: it.text_en, text_es: it.text_es, category: it.category_en, role: sc.role, active: true, weight: 1, set_id: setId, scale: it.scale, sort: base + i,
    }));
    escribe((s) => ({
      ...s,
      settings: s.settings.roles.includes(sc.role) ? s.settings : { ...s.settings, roles: [...s.settings.roles, sc.role] },
      questionSets: existente ? s.questionSets : [...s.questionSets, { id: setId, name: sc.set_name, role: sc.role, is_default: s.questionSets.length === 0, created_at: ahora() }],
      questions: [...s.questions, ...rows],
    }));
    notify(tr(`${rows.length} questions imported ✓`, `${rows.length} preguntas importadas ✓`));
    return rows.length;
  }, [escribe, notify, tr]);

  // ---------------- Etapas ----------------
  const addStage = useCallback<DataState["addStage"]>(async (st) => {
    const key = (st.key || st.label || "stage").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Math.random().toString(36).slice(2, 6);
    escribe((s) => {
      const activeSorts = s.stages.filter((x) => x.type === "active").map((x) => x.sort);
      const newSort = activeSorts.length ? Math.max(...activeSorts) + 1 : 0;
      const bumps = new Map(bumpSort(s.stages.filter((x) => x.sort >= newSort), newSort, { inclusive: true }).map((b) => [b.id, b.sort]));
      const nueva: Stage = { id: uid(), key, label: st.label ?? key, type: "active", color: "#6b7686", sort: newSort, max_days: null, ...st };
      return { ...s, stages: [...s.stages.map((x) => (bumps.has(x.id) ? { ...x, sort: bumps.get(x.id)! } : x)), nueva].sort((a, b) => a.sort - b.sort) };
    });
    notify(tr("Stage added ✓", "Etapa agregada ✓"));
  }, [escribe, notify, tr]);
  const updateStage = useCallback<DataState["updateStage"]>(async (id, patch) => {
    escribe((s) => ({ ...s, stages: s.stages.map((x) => (x.id === id ? { ...x, ...patch } : x)).sort((a, b) => a.sort - b.sort) }));
  }, [escribe]);
  const deleteStage = useCallback<DataState["deleteStage"]>(async (id) => {
    const st = ref.current.stages.find((x) => x.id === id);
    if (st && st.type !== "active") { notify(tr("The Hired/Discarded stages can't be deleted", "Las etapas Contratado/Descartado no se pueden borrar")); return; }
    if (st && ref.current.candidates.some((c) => c.status === st.key)) { notify(tr("Move its candidates out first", "Primero mueve sus candidatos a otra etapa")); return; }
    escribe((s) => ({ ...s, stages: s.stages.filter((x) => x.id !== id) }));
  }, [escribe, notify, tr]);

  const stagesEnIdioma = useMemo(() => etapasEnIdioma(store.stages, lang), [store.stages, lang]);

  const value: DataState = {
    ready,
    me,
    hub,
    settings: store.settings,
    roles: store.settings.roles || [],
    questions: store.questions,
    templates: store.templates,
    customFields: store.customFields,
    recruiters: store.recruiters,
    candidates: store.candidates,
    contacts: store.contacts,
    jobs: store.jobs,
    questionSets: store.questionSets,
    addQuestionSet,
    updateQuestionSet,
    deleteQuestionSet,
    importScorecard,
    stages: stagesEnIdioma,
    stagesGuardadas: store.stages,
    attachments: store.attachments,
    toast,
    notify,
    addCandidate,
    updateCandidate,
    deleteCandidate,
    toggleFavorite,
    addContact,
    contactsFor,
    stageHistoryFor,
    uploadResume,
    removeResume,
    openResumeFile,
    resumeLink,
    attachmentsFor,
    addAttachment,
    removeAttachment,
    openAttachment,
    saveSettings,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    duplicateQuestion,
    reorderQuestions,
    addTemplate,
    deleteTemplate,
    addCustomField,
    deleteCustomField,
    updateUserName,
    addJob,
    updateJob,
    deleteJob,
    addStage,
    updateStage,
    deleteStage,
  };

  return (
    <Ctx.Provider value={value}>
      <div className="local-banner no-print">
        <span className="lb-tag">{t("LOCAL DEMO", "DEMO LOCAL")}</span>
        <span className="lb-text">{t("Data is saved in this browser only — no server.", "Los datos se guardan solo en este navegador — sin servidor.")}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => { if (confirm(t("Reset all demo data back to the starting sample?", "¿Restablecer los datos demo a la muestra inicial?"))) reiniciarDemoRrhh(); }}>
          {t("Reset data", "Restablecer")}
        </button>
      </div>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
