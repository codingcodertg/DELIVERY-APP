import type {
  Attachment, Candidate, Contact, CustomField, Interview, Job, Profile, Question, QuestionSet, Settings, Stage,
  StageHistory, Template,
} from "./types";
import { DEFAULT_SETTINGS, DEFAULT_STAGES } from "./constants";
import { diaEnBrownsville } from "./hora-de-brownsville";

/**
 * La semilla del demo de RR. HH. (D-932): lo que ve quien abre /recruiting con `NEXT_PUBLIC_LOCAL_MODE=true`.
 *
 * Todo inventado: nombres, teléfonos (956) 555-01NN, correos en minúsculas; nada del dueño. Las fechas salen de `now`,
 * que se pasa como argumento, para que la prueba (`demo-data.test.ts`) las fije y nada dependa del reloj de la máquina.
 * El teléfono va en la forma estándar del hub (D-850, `telefonoEstandar`): «(956) 555-0101», que es la que el
 * proveedor pone al guardar; así una ficha de la semilla y una recién editada se ven igual.
 */
export interface SemillaRrhh {
  settings: Settings;
  stages: Stage[];
  recruiters: Profile[];
  jobs: Job[];
  questionSets: QuestionSet[];
  questions: Question[];
  templates: Template[];
  customFields: CustomField[];
  candidates: Candidate[];
  contacts: Contact[];
  stageHistory: StageHistory[];
  attachments: Attachment[];
}

/** El admin del demo: el mismo `u-admin` que Entregas (`DEMO_USERS`), para que las dos apps hablen de la misma persona. */
export const ADMIN_DEMO: Profile = { id: "u-admin", full_name: "You (Admin)", role: "admin", avatar_url: null, store: null };

const RECLUTADORES: Profile[] = [
  ADMIN_DEMO,
  { id: "u-rec", full_name: "Rosa Reclutadora", role: "recruiter", avatar_url: null, store: null },
  { id: "u-mgr", full_name: "Maria Manager", role: "manager", avatar_url: null, store: null },
];

/** `n` días antes de `now`, a la hora `hora` de Brownsville (UTC-6; en horario de verano sale una hora corrida, y para una
 *  muestra da igual); ISO completo. Sin get/set locales: la puerta de `hora-de-brownsville.test.ts` no deja usar la zona
 *  del aparato en RR. HH. */
const hace = (now: Date, dias: number, hora = 10, minuto = 0): string => {
  const d = new Date(now.getTime() - dias * 864e5);
  d.setUTCHours(hora + 6, minuto, 0, 0);
  return d.toISOString();
};
/** `n` días antes de `now`, solo la fecha (yyyy-mm-dd) en Brownsville. */
const dia = (now: Date, dias: number): string => diaEnBrownsville(new Date(now.getTime() - dias * 864e5));

const PREGUNTAS: { id: string; text: string; text_es: string; category: string }[] = [
  { id: "q-1", text: "Tell me about your last job and why you left.", text_es: "Cuéntame de tu último trabajo y por qué saliste.", category: "Experience" },
  { id: "q-2", text: "How do you handle an upset customer on the phone?", text_es: "¿Cómo manejas a un cliente molesto por teléfono?", category: "Customer Service" },
  { id: "q-3", text: "Are you available on Saturdays?", text_es: "¿Tienes disponibilidad los sábados?", category: "Availability" },
  { id: "q-4", text: "How comfortable are you with computers and spreadsheets?", text_es: "¿Qué tan cómodo te sientes con la computadora y las hojas de cálculo?", category: "Skills" },
  { id: "q-5", text: "Describe a time you had to coordinate several people at once.", text_es: "Describe una vez que tuviste que coordinar a varias personas a la vez.", category: "Teamwork" },
  { id: "q-6", text: "What salary are you expecting?", text_es: "¿Qué salario esperas?", category: "Wage" },
];

type Base = Pick<Candidate, "id" | "name" | "phone" | "email" | "role" | "location" | "status"> & Partial<Candidate>;

/** Un candidato con todos los campos que la tabla exige, a partir de lo que distingue a cada uno. */
function candidato(now: Date, registradoHace: number, c: Base): Candidate {
  return {
    home_location: c.location,
    source: "Indeed",
    alt_sources: [],
    reg_date: dia(now, registradoHace),
    notes: null,
    phone_date: null,
    inperson_date: null,
    resume_passed: false,
    favorite: false,
    photo: null,
    custom: {},
    prescreen: {},
    interview: null,
    follow_up: null,
    summary_sent: false,
    discard_reason: null,
    discard_source: null,
    resume_path: null,
    resume_name: null,
    offer_salary: null,
    offer_start_date: null,
    offer_status: "none",
    offer_notes: null,
    tags: [],
    extra_phones: [],
    extra_emails: [],
    pinned: false,
    archived: false,
    stage_changed_at: hace(now, registradoHace),
    job_id: null,
    assigned_recruiter: "u-rec",
    created_by: "u-admin",
    created_at: hace(now, registradoHace, 9),
    updated_at: hace(now, registradoHace, 9),
    ...c,
  };
}

/** La entrevista telefónica de Lucía: seis respuestas con nota, media sobre la escala 1-4. */
function entrevista(now: Date): Interview {
  const grados = [4, 3, 4, 3, 3, 4];
  const answers = Object.fromEntries(PREGUNTAS.map((q, i) => [q.id, { grade: grados[i], note: i === 0 ? "Three years dispatching for a freight company." : "" }]));
  const average = grados.reduce((a, b) => a + b, 0) / grados.length;
  return {
    answers,
    recruiterScore: 4,
    recommendation: "advance",
    generalNotes: "Clear communicator, available right away.",
    average,
    date: hace(now, 6, 11),
    questions: PREGUNTAS.map((q, i) => ({ text: q.text, weight: 1, grade: grados[i], note: answers[q.id].note, category: q.category })),
  };
}

export function semillaRrhh(now: Date): SemillaRrhh {
  const settings: Settings = { ...DEFAULT_SETTINGS, app_name: "RTG HR Management" };
  const stages = DEFAULT_STAGES.map((s) => ({ ...s }));

  const questionSets: QuestionSet[] = [
    { id: "qs-1", name: "General prescreen", is_default: true, role: null, created_at: hace(now, 60) },
  ];
  const questions: Question[] = PREGUNTAS.map((q, i) => ({
    id: q.id, text: q.text, text_es: q.text_es, category: q.category, role: "all", active: true, weight: 1, sort: i, set_id: "qs-1", scale: null,
  }));

  const jobs: Job[] = [
    { id: "j-1", title: "Dispatcher - Brownsville", role: "Dispatcher", status: "open", target_score: 3, openings: 1, notes: null, question_set_id: "qs-1", created_at: hace(now, 30) },
    { id: "j-2", title: "Sales Associate - McAllen", role: "Sales", status: "open", target_score: 3, openings: 2, notes: null, question_set_id: null, created_at: hace(now, 20) },
  ];

  const templates: Template[] = [
    { id: "t-1", label: "Invite to call", text: "Hi {name}, this is {recruiter} from RTG about the {role} position. When is a good time to call you?" },
    { id: "t-2", label: "Interview reminder", text: "Hi {name}, reminder of your interview tomorrow. Reply to this text if you need to reschedule." },
  ];

  const customFields: CustomField[] = [{ id: "cf-1", label: "Years of experience", sort: 0 }];

  const candidates: Candidate[] = [
    candidato(now, 1, { id: "c-1", name: "Ana Torres", phone: "(956) 555-0101", email: "ana.torres@example.com", role: "Dispatcher", location: "Brownsville", status: "registered", job_id: "j-1", custom: { "cf-1": "2" } }),
    candidato(now, 2, { id: "c-2", name: "Luis Herrera", phone: "(956) 555-0102", email: "luis.herrera@example.com", role: "Sales", location: "McAllen", status: "registered", job_id: "j-2", source: "Facebook" }),
    candidato(now, 5, { id: "c-3", name: "Lucía Ramírez", phone: "(956) 555-0103", email: "lucia.ramirez@example.com", role: "Dispatcher", location: "Brownsville", status: "phone", job_id: "j-1", favorite: true, phone_date: hace(now, 6, 11), stage_changed_at: hace(now, 4), interview: entrevista(now), resume_passed: true, prescreen: { tenure: "3 years", language: "English and Spanish", education: "High school" } }),
    candidato(now, 7, { id: "c-4", name: "Jorge Castillo", phone: "(956) 555-0104", email: "jorge.castillo@example.com", role: "Sales", location: "Pharr", status: "phone", job_id: "j-2", phone_date: hace(now, -1, 15), stage_changed_at: hace(now, 3), tags: ["call again"] }),
    candidato(now, 12, { id: "c-5", name: "María Fernández", phone: "(956) 555-0105", email: "maria.fernandez@example.com", role: "Customer Service", location: "Weslaco", status: "standby", stage_changed_at: hace(now, 8), follow_up: dia(now, -3), notes: "Finishes her current job at the end of the month." }),
    candidato(now, 15, { id: "c-6", name: "Carlos Mendoza", phone: "(956) 555-0106", email: "carlos.mendoza@example.com", role: "Dispatcher", location: "Brownsville", status: "inperson", job_id: "j-1", inperson_date: hace(now, -2, 9, 30), stage_changed_at: hace(now, 2), resume_passed: true }),
    candidato(now, 18, { id: "c-7", name: "Sofía Guerrero", phone: "(956) 555-0107", email: "sofia.guerrero@example.com", role: "Sales", location: "McAllen", status: "inperson", job_id: "j-2", inperson_date: hace(now, 1, 14), stage_changed_at: hace(now, 5), favorite: true }),
    candidato(now, 40, { id: "c-8", name: "Diego Salinas", phone: "(956) 555-0108", email: "diego.salinas@example.com", role: "Sales", location: "Edinburg", status: "hired", job_id: "j-2", stage_changed_at: hace(now, 10), offer_status: "accepted", offer_salary: "$14/h", offer_start_date: dia(now, -7) }),
    candidato(now, 25, { id: "c-9", name: "Patricia Vela", phone: "(956) 555-0109", email: null, role: "Customer Service", location: "Mission", status: "discarded", stage_changed_at: hace(now, 9), discard_reason: "Not available on weekends", discard_source: "recruiter", source: "Walk-in" }),
  ];

  const contacto = (id: string, candidate_id: string, dias: number, type: string, result: string | null, note: string | null, hora = 10): Contact =>
    ({ id, candidate_id, type, result, note, created_by: "u-rec", created_at: hace(now, dias, hora) });
  const contacts: Contact[] = [
    contacto("k-1", "c-3", 5, "Call", "No answer", null, 9),
    contacto("k-2", "c-3", 5, "SMS", "sent", "Hi Lucía, this is Rosa from RTG…", 9),
    contacto("k-3", "c-3", 4, "Call", "Answered", "Phone interview scheduled.", 16),
    contacto("k-4", "c-6", 14, "Call", "Answered", "Available any weekday.", 11),
    contacto("k-5", "c-6", 2, "In person", "Phone Interview → In Person Interview", "Scheduled at the Brownsville store.", 12),
    contacto("k-6", "c-8", 12, "Offer", "Extended", "Salary: $14/h", 10),
    contacto("k-7", "c-8", 10, "Offer", "Accepted", "", 15),
  ];

  const paso = (id: string, candidate_id: string, stage_key: string, dias: number): StageHistory =>
    ({ id, candidate_id, stage_key, entered_at: hace(now, dias), changed_by: "u-rec" });
  const stageHistory: StageHistory[] = [
    paso("h-1", "c-3", "registered", 5), paso("h-2", "c-3", "phone", 4),
    paso("h-3", "c-6", "registered", 15), paso("h-4", "c-6", "phone", 14), paso("h-5", "c-6", "inperson", 2),
    paso("h-6", "c-8", "registered", 40), paso("h-7", "c-8", "phone", 35), paso("h-8", "c-8", "inperson", 20), paso("h-9", "c-8", "hired", 10),
  ];

  return { settings, stages, recruiters: RECLUTADORES, jobs, questionSets, questions, templates, customFields, candidates, contacts, stageHistory, attachments: [] };
}
