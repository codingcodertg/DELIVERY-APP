"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/recruiting/supabase/client";
import type {
  Attachment,
  StageHistory,
  QuestionSet,
  Candidate,
  Contact,
  CustomField,
  Job,
  Profile,
  Question,
  Settings,
  Stage,
  Template,
} from "@/lib/recruiting/types";
import { DEFAULT_SCALE } from "@/lib/recruiting/utils";
import { DEFAULT_STAGES } from "@/lib/recruiting/constants";
import type { Scorecard } from "@/lib/recruiting/scorecards";

interface DataState {
  ready: boolean;
  me: Profile | null;
  settings: Settings;
  roles: string[];
  questions: Question[];
  templates: Template[];
  customFields: CustomField[];
  recruiters: Profile[];
  candidates: Candidate[];
  contacts: Contact[];
  jobs: Job[];
  questionSets: QuestionSet[];
  addQuestionSet: (name: string) => Promise<void>;
  updateQuestionSet: (id: string, patch: Partial<QuestionSet>) => Promise<void>;
  deleteQuestionSet: (id: string) => Promise<void>;
  importScorecard: (sc: Scorecard) => Promise<number>;
  stages: Stage[];
  attachments: Attachment[];
  toast: string;
  notify: (msg: string) => void;
  // candidate CRUD
  addCandidate: (c: Partial<Candidate>) => Promise<Candidate | null>;
  updateCandidate: (id: string, patch: Partial<Candidate>) => Promise<void>;
  deleteCandidate: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  addContact: (candidateId: string, entry: Partial<Contact>) => Promise<void>;
  contactsFor: (candidateId: string) => Contact[];
  stageHistoryFor: (candidateId: string) => StageHistory[];
  // resume/CV attachments (Supabase Storage)
  uploadResume: (candidateId: string, file: File) => Promise<void>;
  removeResume: (candidateId: string) => Promise<void>;
  openResumeFile: (candidateId: string) => Promise<void>;
  // multiple attachments (#3)
  attachmentsFor: (candidateId: string) => Attachment[];
  addAttachment: (candidateId: string, file: File) => Promise<void>;
  removeAttachment: (attachmentId: string) => Promise<void>;
  openAttachment: (attachmentId: string) => Promise<void>;
  // settings CRUD
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  addQuestion: (q: Partial<Question>) => Promise<void>;
  updateQuestion: (id: string, patch: Partial<Question>) => Promise<void>;
  deleteQuestion: (id: string) => Promise<void>;
  duplicateQuestion: (id: string) => Promise<void>;
  reorderQuestions: (ids: string[]) => Promise<void>;
  addTemplate: (t: Partial<Template>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  addCustomField: (label: string) => Promise<void>;
  deleteCustomField: (id: string) => Promise<void>;
  // user management — role/avatar/delete retired D-053: user management for
  // recruiting now lives entirely in deliveries' own /users (see
  // updateUserRecruitingAccess in data-provider.tsx). updateUserName stays;
  // it has no other caller today either, but wasn't part of that unification.
  updateUserName: (userId: string, name: string) => Promise<void>;
  // jobs / requisitions
  addJob: (j: Partial<Job>) => Promise<void>;
  updateJob: (id: string, patch: Partial<Job>) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  // pipeline stages
  addStage: (s: Partial<Stage>) => Promise<void>;
  updateStage: (id: string, patch: Partial<Stage>) => Promise<void>;
  deleteStage: (id: string) => Promise<void>;
}

const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  app_name: "RECRUIT·HN",
  roles: ["Dispatcher", "Customer Service", "Sales"],
  scale: DEFAULT_SCALE,
};

export function DataProvider({ children, me }: { children: React.ReactNode; me: Profile | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [recruiters, setRecruiters] = useState<Profile[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [stageHistory, setStageHistory] = useState<StageHistory[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  // Refresh a near/already-expired token before reading — see the identical
  // comment in data-provider.tsx's reloadAll (D-081) for why: a stale token
  // doesn't error, it just makes every read look like it returned nothing.
  // Marcado cuando una carga se cae. El efecto de abajo lo mira para reintentar; sin él,
  // "no tener que refrescar" dependería de que el primer intento gane la carrera contra
  // la navegación que lo canceló.
  const loadFailedRef = useRef(false);
  const ensureSession = useCallback(async () => {
    // Best-effort only — see the identical comment in data-provider.tsx.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const nowSec = Math.floor(Date.now() / 1000);
      if (!session || !session.expires_at || session.expires_at - nowSec < 60) {
        await supabase.auth.refreshSession().catch(() => {});
      }
    } catch { /* ignore — reloadAll proceeds with whatever session exists */ }
  }, [supabase]);

  // Envuelto entero, y no solo ensureSession() (D-088). Aquel arreglo tapó UNA de las
  // formas de que reloadAll() muriera antes de setReady(true); las consultas de abajo
  // pueden hacer lo mismo. Un fetch cancelado a media navegación —y abrir la app o
  // cambiar de módulo ES una navegación— hace que Promise.all rechace, y la pantalla
  // se queda como estaba: vacía, sin error, hasta que alguien refresca a mano.
  //
  // Dos cosas, porque una sola no basta:
  //   · finally { setReady(true) } — nunca se queda colgada en "cargando";
  //   · un reintento marcado, que el efecto de recuperación dispara al volver el foco
  //     o la conexión. Sin eso, "no tener que refrescar" seguiría dependiendo de que
  //     el primer intento gane la carrera.
  const reloadAll = useCallback(async () => {
    try {
      await ensureSession();
      const [s, q, t, cf, p, c, co, j, st, at, sh, qs] = await Promise.all([
        supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
        supabase.from("questions").select("*").order("sort"),
        supabase.from("templates").select("*").order("created_at"),
        supabase.from("custom_fields").select("*").order("sort"),
        // profiles lives in `public`, not `recruiting` — this client defaults
        // to `recruiting`, so this one call overrides it explicitly. Selects
        // recruiting_role (not the deliveries `role` column — same bug class
        // as updateUserRole) and filters to people who actually have
        // recruiting access, so a deliveries-only driver/sales/warehouse user
        // never shows up as a "recruiter" here. ROLE_INFO only has entries for
        // admin|manager|recruiter, so a deliveries role leaking through here
        // would crash the Users page, not just show wrong data.
        supabase.schema("public").from("profiles")
          .select("id, full_name, recruiting_role, avatar_url")
          .not("recruiting_role", "is", null)
          .order("full_name"),
        supabase.from("candidates").select("*").order("created_at", { ascending: false }),
        supabase.from("contacts").select("*").order("created_at", { ascending: false }),
        supabase.from("jobs").select("*").order("created_at", { ascending: false }),
        supabase.from("stages").select("*").order("sort"),
        supabase.from("attachments").select("*").order("created_at", { ascending: false }),
        supabase.from("stage_history").select("*").order("entered_at", { ascending: true }),
        supabase.from("question_sets").select("*").order("created_at"),
      ]);
      if (s.data) setSettings(s.data as Settings);
      if (q.data) setQuestions(q.data as Question[]);
      if (t.data) setTemplates(t.data as Template[]);
      if (cf.data) setCustomFields(cf.data as CustomField[]);
      if (p.data) {
        // Map recruiting_role -> role: everything downstream (ROLE_INFO
        // lookups, the Users page role <select>, etc.) reads Profile.role and
        // means "role inside recruiting" when it does.
        setRecruiters(
          p.data.map((row: { id: string; full_name: string | null; recruiting_role: string; avatar_url: string | null }) => ({
            id: row.id,
            full_name: row.full_name,
            role: row.recruiting_role,
            avatar_url: row.avatar_url,
          })) as Profile[],
        );
      }
      if (c.data) setCandidates(c.data as Candidate[]);
      if (co.data) setContacts(co.data as Contact[]);
      if (j.data) setJobs(j.data as Job[]);
      if (st.data && st.data.length) setStages(st.data as Stage[]);
      if (at.data) setAttachments(at.data as Attachment[]);
      if (sh.data) setStageHistory(sh.data as StageHistory[]);
      if (qs.data) setQuestionSets(qs.data as QuestionSet[]);
      setReady(true);
      loadFailedRef.current = false;
    } catch {
      loadFailedRef.current = true;
    } finally {
      setReady(true);
    }
  }, [supabase, ensureSession]);

  // Recuperación de una carga fallida.
  //
  // El caso real es abrir la app o cambiar de módulo: el navegador cancela las peticiones
  // en vuelo, Promise.all rechaza y la pantalla se queda vacía. Antes solo se salía de ahí
  // refrescando a mano. Ahora se reintenta solo, tres veces con espera creciente, y además
  // al recuperar el foco, al volver a ser visible y al volver la conexión — porque el
  // primer reintento puede caer en el mismo mal momento.
  //
  // Solo si la última carga falló: no es un refresco periódico, es una segunda oportunidad.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stop = false;
    const retry = () => { if (!stop && loadFailedRef.current) void reloadAll(); };
    const timers = [400, 1500, 4000].map((ms) => setTimeout(retry, ms));
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      stop = true;
      timers.forEach(clearTimeout);
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [reloadAll]);


  useEffect(() => {
    reloadAll();
    // Realtime: any change on core tables triggers a lightweight reload.
    // Every table here lives in the `recruiting` schema EXCEPT profiles,
    // which is deliveries' shared identity table in `public` (see D-050) —
    // postgres_changes always needs the real schema regardless of the
    // client's default, unlike .from().
    const channel = supabase
      .channel("recruiting-realtime")
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "candidates" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "contacts" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "questions" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "templates" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "custom_fields" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "settings" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "jobs" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "stages" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "attachments" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "stage_history" }, reloadAll)
      .on("postgres_changes", { event: "*", schema: "recruiting", table: "question_sets" }, reloadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, reloadAll]);

  // ---------------- Candidate CRUD ----------------
  const addCandidate = useCallback<DataState["addCandidate"]>(
    async (c) => {
      const payload = { ...c, created_by: me?.id ?? null };
      const { data, error } = await supabase.from("candidates").insert(payload).select().single();
      if (error) {
        notify("Error: " + error.message);
        return null;
      }
      setCandidates((prev) => [data as Candidate, ...prev]);
      return data as Candidate;
    },
    [supabase, me, notify],
  );

  const updateCandidate = useCallback<DataState["updateCandidate"]>(
    async (id, patch) => {
      // stamp stage entry time whenever the status changes (for "days in stage")
      const finalPatch: Partial<Candidate> =
        patch.status !== undefined ? { ...patch, stage_changed_at: new Date().toISOString() } : patch;
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, ...finalPatch } : c)));
      const { error } = await supabase.from("candidates").update(finalPatch).eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const deleteCandidate = useCallback<DataState["deleteCandidate"]>(
    async (id) => {
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      const { error } = await supabase.from("candidates").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const toggleFavorite = useCallback<DataState["toggleFavorite"]>(
    async (id) => {
      const c = candidates.find((x) => x.id === id);
      if (!c) return;
      await updateCandidate(id, { favorite: !c.favorite });
    },
    [candidates, updateCandidate],
  );

  const addContact = useCallback<DataState["addContact"]>(
    async (candidateId, entry) => {
      const payload = { candidate_id: candidateId, created_by: me?.id ?? null, ...entry };
      const { data, error } = await supabase.from("contacts").insert(payload).select().single();
      if (error) {
        notify("Error: " + error.message);
        return;
      }
      setContacts((prev) => [data as Contact, ...prev]);
    },
    [supabase, me, notify],
  );

  const contactsFor = useCallback(
    (candidateId: string) => contacts.filter((c) => c.candidate_id === candidateId),
    [contacts],
  );
  const stageHistoryFor = useCallback(
    (candidateId: string) =>
      stageHistory
        .filter((h) => h.candidate_id === candidateId)
        .sort((a, b) => a.entered_at.localeCompare(b.entered_at)),
    [stageHistory],
  );

  // ---------------- Resume / CV (Supabase Storage) ----------------
  const uploadResume = useCallback<DataState["uploadResume"]>(
    async (candidateId, file) => {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${candidateId}/${Date.now()}_${safe}`;
      const { error } = await supabase.storage.from("resumes").upload(path, file, { upsert: true });
      if (error) {
        notify("Upload failed: " + error.message);
        return;
      }
      // remove any previous file to avoid orphans
      const prev = candidates.find((c) => c.id === candidateId)?.resume_path;
      if (prev && prev !== path) await supabase.storage.from("resumes").remove([prev]);
      // Attaching the CV *is* the proof we have their resume — flag it, instead of
      // making someone tick the box separately and forget.
      await updateCandidate(candidateId, { resume_path: path, resume_name: file.name, resume_passed: true });
      notify("CV attached ✓");
    },
    [supabase, candidates, updateCandidate, notify],
  );

  const removeResume = useCallback<DataState["removeResume"]>(
    async (candidateId) => {
      const c = candidates.find((x) => x.id === candidateId);
      if (c?.resume_path) await supabase.storage.from("resumes").remove([c.resume_path]);
      await updateCandidate(candidateId, { resume_path: null, resume_name: null });
      notify("CV removed");
    },
    [supabase, candidates, updateCandidate, notify],
  );

  const openResumeFile = useCallback<DataState["openResumeFile"]>(
    async (candidateId) => {
      const c = candidates.find((x) => x.id === candidateId);
      if (!c?.resume_path) return;
      const { data, error } = await supabase.storage
        .from("resumes")
        .createSignedUrl(c.resume_path, 60);
      if (error || !data) {
        notify("Could not open CV: " + (error?.message ?? "unknown"));
        return;
      }
      window.open(data.signedUrl, "_blank");
    },
    [supabase, candidates, notify],
  );

  // ---------------- Multiple attachments (#3) ----------------
  const attachmentsFor = useCallback(
    (candidateId: string) => attachments.filter((a) => a.candidate_id === candidateId),
    [attachments],
  );

  const addAttachment = useCallback<DataState["addAttachment"]>(
    async (candidateId, file) => {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${candidateId}/att_${Math.random().toString(36).slice(2, 8)}_${safe}`;
      const { error: upErr } = await supabase.storage.from("resumes").upload(path, file, { upsert: true });
      if (upErr) { notify("Upload failed: " + upErr.message); return; }
      const { error } = await supabase.from("attachments").insert({
        candidate_id: candidateId, path, name: file.name, created_by: me?.id ?? null,
      });
      if (error) { notify("Error: " + error.message); return; }
      reloadAll();
      notify("File attached ✓");
    },
    [supabase, me, notify, reloadAll],
  );

  const removeAttachment = useCallback<DataState["removeAttachment"]>(
    async (attachmentId) => {
      const a = attachments.find((x) => x.id === attachmentId);
      if (a) await supabase.storage.from("resumes").remove([a.path]);
      setAttachments((prev) => prev.filter((x) => x.id !== attachmentId));
      const { error } = await supabase.from("attachments").delete().eq("id", attachmentId);
      if (error) notify("Error: " + error.message);
      else notify("File removed");
    },
    [supabase, attachments, notify],
  );

  const openAttachment = useCallback<DataState["openAttachment"]>(
    async (attachmentId) => {
      const a = attachments.find((x) => x.id === attachmentId);
      if (!a) return;
      const { data, error } = await supabase.storage.from("resumes").createSignedUrl(a.path, 60);
      if (error || !data) { notify("Could not open file: " + (error?.message ?? "unknown")); return; }
      window.open(data.signedUrl, "_blank");
    },
    [supabase, attachments, notify],
  );

  // ---------------- Settings CRUD ----------------
  const saveSettings = useCallback<DataState["saveSettings"]>(
    async (patch) => {
      setSettings((prev) => ({ ...prev, ...patch }));
      const { error } = await supabase.from("settings").update(patch).eq("id", 1);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const addQuestion = useCallback<DataState["addQuestion"]>(
    async (q) => {
      const sort = questions.length;
      const { error } = await supabase.from("questions").insert({ sort, ...q });
      if (error) notify("Error: " + error.message);
      else reloadAll();
    },
    [supabase, questions.length, notify, reloadAll],
  );

  const updateQuestion = useCallback<DataState["updateQuestion"]>(
    async (id, patch) => {
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
      const { error } = await supabase.from("questions").update(patch).eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const deleteQuestion = useCallback<DataState["deleteQuestion"]>(
    async (id) => {
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      const { error } = await supabase.from("questions").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const duplicateQuestion = useCallback<DataState["duplicateQuestion"]>(
    async (id) => {
      const original = questions.find((q) => q.id === id);
      if (!original) return;
      // Make room for the copy right after the original: bump everything
      // after it (in the same set) up by one sort slot first.
      const toBump = questions.filter((q) => q.set_id === original.set_id && q.sort > original.sort);
      for (const q of toBump) {
        const { error } = await supabase.from("questions").update({ sort: q.sort + 1 }).eq("id", q.id);
        if (error) { notify("Error: " + error.message); return; }
      }
      const { error } = await supabase.from("questions").insert({
        text: original.text,
        text_es: original.text_es,
        category: original.category,
        role: original.role,
        active: original.active,
        weight: original.weight,
        scale: original.scale,
        set_id: original.set_id,
        sort: original.sort + 1,
      });
      if (error) { notify("Error: " + error.message); return; }
      reloadAll();
    },
    [supabase, questions, notify, reloadAll],
  );

  const reorderQuestions = useCallback<DataState["reorderQuestions"]>(
    async (ids) => {
      setQuestions((prev) => {
        const sortById = new Map(ids.map((id, i) => [id, i]));
        return prev.map((q) => (sortById.has(q.id) ? { ...q, sort: sortById.get(q.id)! } : q));
      });
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase.from("questions").update({ sort: i }).eq("id", ids[i]);
        if (error) { notify("Error: " + error.message); return; }
      }
    },
    [supabase, notify],
  );

  const addTemplate = useCallback<DataState["addTemplate"]>(
    async (t) => {
      const { error } = await supabase.from("templates").insert(t);
      if (error) notify("Error: " + error.message);
      else reloadAll();
    },
    [supabase, notify, reloadAll],
  );

  const deleteTemplate = useCallback<DataState["deleteTemplate"]>(
    async (id) => {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      const { error } = await supabase.from("templates").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const addCustomField = useCallback<DataState["addCustomField"]>(
    async (label) => {
      const sort = customFields.length;
      const { error } = await supabase.from("custom_fields").insert({ label, sort });
      if (error) notify("Error: " + error.message);
      else reloadAll();
    },
    [supabase, customFields.length, notify, reloadAll],
  );

  const deleteCustomField = useCallback<DataState["deleteCustomField"]>(
    async (id) => {
      setCustomFields((prev) => prev.filter((c) => c.id !== id));
      const { error } = await supabase.from("custom_fields").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const addJob = useCallback<DataState["addJob"]>(
    async (j) => {
      const { error } = await supabase.from("jobs").insert(j);
      if (error) notify("Error: " + error.message);
      else { reloadAll(); notify("Job created ✓"); }
    },
    [supabase, notify, reloadAll],
  );
  const updateJob = useCallback<DataState["updateJob"]>(
    async (id, patch) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
      const { error } = await supabase.from("jobs").update(patch).eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );
  const deleteJob = useCallback<DataState["deleteJob"]>(
    async (id) => {
      setJobs((prev) => prev.filter((j) => j.id !== id));
      const { error } = await supabase.from("jobs").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );

  const addQuestionSet = useCallback<DataState["addQuestionSet"]>(
    async (name) => {
      const isFirst = questionSets.length === 0;
      const { error } = await supabase.from("question_sets").insert({ name, is_default: isFirst });
      if (error) notify("Error: " + error.message);
      else { reloadAll(); notify("Question set added ✓"); }
    },
    [supabase, questionSets.length, notify, reloadAll],
  );
  const updateQuestionSet = useCallback<DataState["updateQuestionSet"]>(
    async (id, patch) => {
      // only one default at a time
      if (patch.is_default) {
        await supabase.from("question_sets").update({ is_default: false }).neq("id", id);
      }
      setQuestionSets((prev) => prev.map((s) => (patch.is_default ? { ...s, is_default: s.id === id } : s.id === id ? { ...s, ...patch } : s)));
      const { error } = await supabase.from("question_sets").update(patch).eq("id", id);
      if (error) {
        // 23505 = unique violation: only one set may claim a given position.
        if (error.code === "23505" && patch.role) {
          const taken = questionSets.find((s) => s.role === patch.role && s.id !== id);
          notify(`"${patch.role}" is already used by the "${taken?.name ?? "another"}" set. A position can only have one set.`);
        } else {
          notify("Error: " + error.message);
        }
        reloadAll(); // the optimistic patch above never landed — put it back
        return;
      }
      reloadAll();
    },
    [supabase, notify, reloadAll, questionSets],
  );
  const deleteQuestionSet = useCallback<DataState["deleteQuestionSet"]>(
    async (id) => {
      setQuestionSets((prev) => prev.filter((s) => s.id !== id));
      const { error } = await supabase.from("question_sets").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
      else reloadAll();
    },
    [supabase, notify, reloadAll],
  );

  const importScorecard = useCallback<DataState["importScorecard"]>(
    async (sc) => {
      // 1) Ensure the role exists on the settings row.
      const curRoles = settings.roles || [];
      if (!curRoles.includes(sc.role)) {
        const { error } = await supabase.from("settings").update({ roles: [...curRoles, sc.role] }).eq("id", 1);
        if (error) { notify("Error: " + error.message); return 0; }
      }
      // 2) Reuse the question set by name, or create it. Both the lookup and the
      // duplicate check hit the DB rather than local state: `questionSets` is
      // stale for the whole window between an import and the reload it triggers,
      // and trusting it there lets a second click create a same-named set and
      // import a second copy of every question.
      const { data: existing, error: findErr } = await supabase
        .from("question_sets")
        .select("id")
        .eq("name", sc.set_name)
        .maybeSingle();
      if (findErr) { notify("Error: " + findErr.message); return 0; }

      let setId = existing?.id as string | undefined;
      if (setId) {
        // Nothing in the schema stops duplicate question rows, so importing into
        // a set that already has questions would silently double it. Refuse.
        const { count, error } = await supabase
          .from("questions")
          .select("id", { count: "exact", head: true })
          .eq("set_id", setId);
        if (error) { notify("Error: " + error.message); return 0; }
        if ((count ?? 0) > 0) {
          notify(`"${sc.set_name}" already has ${count} questions — nothing imported.`);
          return 0;
        }
      } else {
        const { data, error } = await supabase
          .from("question_sets")
          .insert({ name: sc.set_name, role: sc.role, is_default: questionSets.length === 0 })
          .select("id")
          .single();
        if (error || !data) { notify("Error: " + (error?.message ?? "could not create set")); return 0; }
        setId = data.id as string;
      }
      // 3) Bulk-insert the questions.
      const base = questions.length;
      const rows = sc.items.map((it, i) => ({
        text: it.text_en,
        text_es: it.text_es,
        category: it.category_en,
        role: sc.role,
        active: true,
        set_id: setId,
        scale: it.scale,
        sort: base + i,
      }));
      const { error } = await supabase.from("questions").insert(rows);
      if (error) { notify("Error: " + error.message); return 0; }
      reloadAll();
      notify(`${rows.length} questions imported ✓`);
      return rows.length;
    },
    [supabase, settings.roles, questionSets, questions.length, notify, reloadAll],
  );

  const addStage = useCallback<DataState["addStage"]>(
    async (s) => {
      const key = (s.key || s.label || "stage").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Math.random().toString(36).slice(2, 6);
      // Place the new active stage right after the last active stage but before
      // the terminal (won/lost) stages. `sort` is an INTEGER column, so we shift
      // every stage at/after that slot down by one to make room (a fractional
      // sort like 3.5 would throw "invalid input syntax for type integer").
      const activeSorts = stages.filter((x) => x.type === "active").map((x) => x.sort);
      const newSort = activeSorts.length ? Math.max(...activeSorts) + 1 : 0;
      const toShift = stages.filter((x) => x.sort >= newSort);
      for (const st of toShift) {
        await supabase.from("stages").update({ sort: st.sort + 1 }).eq("id", st.id);
      }
      const { error } = await supabase.from("stages").insert({ key, type: "active", color: "#6b7686", sort: newSort, ...s });
      if (error) notify("Error: " + error.message);
      else { reloadAll(); notify("Stage added ✓"); }
    },
    [supabase, stages, notify, reloadAll],
  );
  const updateStage = useCallback<DataState["updateStage"]>(
    async (id, patch) => {
      setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)).sort((a, b) => a.sort - b.sort));
      const { error } = await supabase.from("stages").update(patch).eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, notify],
  );
  const deleteStage = useCallback<DataState["deleteStage"]>(
    async (id) => {
      const s = stages.find((x) => x.id === id);
      if (s && s.type !== "active") { notify("The Hired/Discarded stages can't be deleted"); return; }
      if (s && candidates.some((c) => c.status === s.key)) { notify("Move its candidates out first"); return; }
      setStages((prev) => prev.filter((x) => x.id !== id));
      const { error } = await supabase.from("stages").delete().eq("id", id);
      if (error) notify("Error: " + error.message);
    },
    [supabase, stages, candidates, notify],
  );

  const updateUserName = useCallback<DataState["updateUserName"]>(
    async (userId, name) => {
      const clean = name.trim();
      if (!clean) { notify("Name can't be empty"); return; }
      setRecruiters((prev) => prev.map((p) => (p.id === userId ? { ...p, full_name: clean } : p)));
      const { error } = await supabase.schema("public").from("profiles").update({ full_name: clean }).eq("id", userId);
      if (error) { notify("Error: " + error.message); reloadAll(); }
      else notify("Name updated ✓");
    },
    [supabase, notify, reloadAll],
  );

  const value: DataState = {
    ready,
    me,
    settings,
    roles: settings.roles || [],
    questions,
    templates,
    customFields,
    recruiters,
    candidates,
    contacts,
    jobs,
    stages,
    attachments,
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
    questionSets,
    addQuestionSet,
    updateQuestionSet,
    importScorecard,
    deleteQuestionSet,
    addStage,
    updateStage,
    deleteStage,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
