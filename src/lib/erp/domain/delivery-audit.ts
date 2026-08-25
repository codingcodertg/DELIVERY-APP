import { stageInfo } from "./delivery-stages";

/**
 * The audit feed: every recorded order event, searchable, so "who did what, when" can be answered
 * without opening each order one at a time.
 *
 * Filtering lives here rather than in the page because the search is the whole feature — a feed
 * that quietly drops matches is worse than no feed, and that is only provable in a test.
 */

export interface AuditEvent {
  id: string;
  delivery_id: string;
  kind: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AuditRow {
  id: string;
  deliveryId: string;
  /** The human order code, or null when the event outlived its order. */
  label: string | null;
  kind: string;
  action: string;
  by: string;
  at: string;
  note: string | null;
}

/**
 * `kind` is overloaded in the source data: three bookkeeping verbs plus every workflow stage. A
 * stage key is rendered with its own label so "picked_up" reads as "Picked up" here and on the board.
 */
export function actionLabel(kind: string): string {
  if (kind === "created") return "Created";
  if (kind === "edited") return "Edited";
  if (kind === "note") return "Note";
  const s = stageInfo(kind);
  return s.key === kind ? s.label : kind;
}

export interface AuditFilter {
  /** A stage/verb key, or "all". */
  kind?: string;
  /** Free text across order code, action, person and note. */
  q?: string;
}

export function auditRows(
  events: AuditEvent[],
  labelById: Map<string, string>,
  nameById: Map<string, string>,
  filter: AuditFilter = {}
): AuditRow[] {
  const kind = filter.kind ?? "all";
  const needle = (filter.q ?? "").trim().toLowerCase();

  return events
    .filter((e) => kind === "all" || e.kind === kind)
    .map((e) => ({
      id: e.id,
      deliveryId: e.delivery_id,
      label: labelById.get(e.delivery_id) ?? null,
      kind: e.kind,
      action: actionLabel(e.kind),
      // An event with no actor is the system acting — a trigger, an import — not an unknown person.
      by: e.created_by ? (nameById.get(e.created_by) ?? "—") : "system",
      at: e.created_at,
      note: e.note,
    }))
    .filter((r) => {
      if (!needle) return true;
      return (
        (r.label ?? "").toLowerCase().includes(needle) ||
        r.action.toLowerCase().includes(needle) ||
        r.by.toLowerCase().includes(needle) ||
        (r.note ?? "").toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** The distinct kinds present, for the filter dropdown — sorted so the list is stable. */
export function auditKinds(events: AuditEvent[]): string[] {
  return [...new Set(events.map((e) => e.kind))].sort();
}
