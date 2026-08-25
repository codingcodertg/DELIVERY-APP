// Time adjustment requests: what an employee is asking for, and what approving it means.
// Ported from the Time Tracker app (ADR 0010).

export type RequestType = "add" | "adjust" | "delete";
export type RequestStatus = "pending" | "approved" | "rejected";

export interface TimeRequestPayload {
  date?: string | null;
  hours?: number | null;
  fromTime?: string | null;
  toTime?: string | null;
  reason?: string | null;
  projectId?: string | null;
  assignmentId?: string | null;
  employeeName?: string | null;
  sessionId?: string | null;
}

export interface TimeRequest {
  id: string;
  employee_uid: string;
  type: string;
  status: string;
  payload?: TimeRequestPayload | null;
  created_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
}

export const REQUEST_LABEL: Record<RequestType, string> = {
  add: "Add time",
  adjust: "Adjust time",
  delete: "Remove time",
};

/**
 * How many hours approving this request would move.
 *
 * Signed: removing time is negative, so a list of requests can be totalled and mean something. An
 * `adjust` counts as its stated hours because the payload carries the NEW figure, not the change —
 * the difference is only knowable against the session it points at, which this does not load.
 */
export function hoursDelta(r: TimeRequest): number {
  const h = Number(r.payload?.hours ?? 0) || 0;
  return r.type === "delete" ? -h : h;
}

/** Only a pending request can be resolved. Anything else has already been decided by someone. */
export function isResolvable(r: TimeRequest): boolean {
  return r.status === "pending";
}

/**
 * A one-line description of what is being asked, for a list where the payload is not visible.
 *
 * Falls back through what the payload actually has rather than assuming a shape: older requests
 * carry only a date and hours, newer ones a time range too, and both must read sensibly.
 */
export function describeRequest(r: TimeRequest): string {
  const p = r.payload ?? {};
  const label = REQUEST_LABEL[r.type as RequestType] ?? r.type;
  const when = p.date ?? "unknown date";
  const span = p.fromTime && p.toTime ? ` ${p.fromTime}–${p.toTime}` : "";
  const hours = p.hours != null ? ` (${p.hours}h)` : "";
  return `${label} · ${when}${span}${hours}`;
}

export interface RequestSummary {
  pending: number;
  approved: number;
  rejected: number;
  pendingHours: number;
}

export function summarise(requests: TimeRequest[]): RequestSummary {
  const out: RequestSummary = { pending: 0, approved: 0, rejected: 0, pendingHours: 0 };
  for (const r of requests) {
    if (r.status === "pending") {
      out.pending++;
      out.pendingHours += hoursDelta(r);
    } else if (r.status === "approved") out.approved++;
    else if (r.status === "rejected") out.rejected++;
  }
  return out;
}

/** Pending first — they are the only ones anybody can act on — then newest within each group. */
export function sortForReview<T extends TimeRequest>(requests: T[]): T[] {
  const rank = (s: string) => (s === "pending" ? 0 : 1);
  return [...requests].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
}
