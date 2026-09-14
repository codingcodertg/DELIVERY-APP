export type StatusId =
  | "registered"
  | "phone"
  | "standby"
  | "inperson"
  | "hired"
  | "discarded";

export type UserRole = "admin" | "manager" | "recruiter";

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  avatar_url?: string | null;
}

export interface Attachment {
  id: string;
  candidate_id: string;
  path: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface ScaleLevel {
  value: number; // 1..4
  label_en: string;
  label_es: string;
  example_en: string;
  example_es: string;
  /** True when this scale runs "bad at high values" (e.g. a risk scale where
   * 1 = No Risk and 4 = Affecting) instead of the default 1=worst..4=best.
   * Same on every level of a given scale; scoreAverage() flips the grade
   * before summing so mixed-direction scales still average correctly. */
  descending?: boolean;
}

export interface QuestionSet {
  id: string;
  name: string;
  is_default: boolean;
  /** Position this set interviews for. An interview uses the set whose role
   * matches the candidate's. null = a general set, used for positions that
   * have no set of their own. */
  role?: string | null;
  created_at: string;
}

export interface Question {
  id: string;
  text: string; // English text (source language)
  text_es?: string | null; // Spanish translation; falls back to `text` when empty
  category?: string | null; // scoring dimension / tag (e.g. "Trust Level"), shown as a badge
  role: string; // "all" or a role name
  active: boolean;
  weight: number; // legacy — no longer used in scoring
  sort: number;
  set_id?: string | null; // which question set/bank this belongs to
  scale?: ScaleLevel[] | null; // per-question scale override; null = use global
}

export interface Template {
  id: string;
  label: string;
  text: string;
}

export interface CustomField {
  id: string;
  label: string;
  sort: number;
}

export interface Settings {
  id: number;
  app_name: string;
  roles: string[];
  /** Departamentos que se pueden elegir en el expediente, para el directorio (D-NEXT). */
  departments?: string[];
  scale?: ScaleLevel[]; // global interview scoring scale (1..4)
}

export interface InterviewAnswer {
  grade: number | null;
  note: string;
  skipped?: boolean; // marked N/A — excluded from the average
}

export interface InterviewQuestionSnapshot {
  text: string;
  weight: number;
  grade: number | null;
  note: string;
  /** Scoring dimension the question belonged to (e.g. "Wage"), copied at save
   * time so the summary can still find it if the question is later edited or
   * deleted. Absent on interviews saved before this was recorded. */
  category?: string | null;
}

/** The recruiter's call at the end of the phone interview. */
export type RecruiterRecommendation = "advance" | "second_opinion" | "reject";

export interface Interview {
  answers: Record<string, InterviewAnswer>;
  /** Recruiter's own 1–5 gut rating of the call. Deliberately separate from
   * `average`, which is computed from the scored questions on a 1–4 scale.
   * Optional: interviews saved before this existed simply don't carry it. */
  recruiterScore?: number | null;
  /** Whether the recruiter wants to advance, get a second opinion, or reject. */
  recommendation?: RecruiterRecommendation | null;
  generalNotes: string;
  /** null when no question was graded. Never 0 — grades start at 1, so a 0 here
   * only ever meant "nothing scored" and made an unscored interview read as the
   * worst possible one. Legacy 0s are cleaned by 21_interview_null_average.sql. */
  average: number | null;
  date: string; // ISO
  questions: InterviewQuestionSnapshot[];
}

export interface Candidate {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: string | null;
  location: string | null; // store / branch
  home_location: string | null; // where the candidate lives
  source: string | null;
  alt_sources: string[]; // other sites/places they also applied from
  reg_date: string; // yyyy-mm-dd
  notes: string | null;
  status: string; // pipeline stage key (see stages table)
  phone_date: string | null; // ISO
  inperson_date: string | null; // ISO — scheduled in-person interview
  resume_passed: boolean; // ✓ passed the resume screen / applied on Indeed
  favorite: boolean;
  photo: string | null;
  custom: Record<string, string>;
  // Free-text answers the recruiter jots down at registration time, shown
  // next to the matching scored question in the interview modal for
  // comparison. Keys: tenure, language, education, age. "age" is reference
  // only — deliberately never scored (see 19_prescreen.sql).
  prescreen: Record<string, string>;
  interview: Interview | null;
  follow_up: string | null; // yyyy-mm-dd
  summary_sent: boolean;
  discard_reason: string | null;
  discard_source: string | null; // 'recruiter' | 'manager'
  resume_path: string | null;
  resume_name: string | null;
  offer_salary: string | null;
  offer_start_date: string | null;
  offer_status: "none" | "extended" | "accepted" | "declined";
  offer_notes: string | null;
  tags: string[];
  extra_phones: string[];
  extra_emails: string[];
  pinned: boolean;
  archived: boolean;
  stage_changed_at: string;
  job_id: string | null;
  assigned_recruiter: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type StageType = "active" | "won" | "lost";

export interface Stage {
  id: string;
  key: string;
  label: string;
  color: string; // hex
  type: StageType;
  sort: number;
  max_days: number | null; // SLA
}

export interface Job {
  id: string;
  title: string;
  role: string | null;
  status: "open" | "closed";
  target_score: number | null;
  openings: number;
  notes: string | null;
  question_set_id?: string | null; // question set/template to use for this position
  created_at: string;
}

export interface StageHistory {
  id: string;
  candidate_id: string;
  stage_key: string;
  entered_at: string; // ISO
  changed_by: string | null;
}

export interface Contact {
  id: string;
  candidate_id: string;
  type: string;
  result: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}
