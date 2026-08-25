// What a customer is shown when they open a tracking link. Ported from deliveries-app (ADR 0010).
//
// This is the only unauthenticated view of an order in the system, so the shape of what it exposes
// matters more than how it looks. Everything here is about deciding what NOT to say.

/** The journey as a customer experiences it. Internal stages are deliberately absent. */
export const PUBLIC_FLOW = ["approved", "fulfilling", "ready", "picked_up", "delivered"] as const;

export type PublicStage = (typeof PUBLIC_FLOW)[number];

/**
 * Customer-facing wording. "Picked Up" means something to a warehouse and nothing to a customer,
 * who wants to know it is on its way.
 */
export const PUBLIC_LABEL: Record<string, string> = {
  approved: "Order confirmed",
  fulfilling: "Being prepared",
  ready: "Ready to go",
  picked_up: "Out for delivery",
  delivered: "Delivered",
};

export function publicLabel(stage: string): string {
  return PUBLIC_LABEL[stage] ?? "In progress";
}

/** How far along the public flow this order is: -1 when it has not entered it yet. */
export function flowIndex(stage: string): number {
  return (PUBLIC_FLOW as readonly string[]).indexOf(stage);
}

export type PublicState =
  /** Confirmed and moving: show the progress bar. */
  | { kind: "tracking"; stage: PublicStage; step: number; total: number }
  /** Logged but not yet confirmed. A customer should not watch an order being approved. */
  | { kind: "pending" }
  /** Cancelled or rejected — say so plainly rather than showing a stalled bar. */
  | { kind: "closed" }
  | { kind: "unknown" };

/**
 * What state to render, from the internal stage.
 *
 * Anything before `approved` collapses to a single "we have it, not confirmed yet". The source
 * shows the same flow regardless, which means a customer watching a link can see an order sitting
 * in `pending` and infer it is being argued over internally. Whether it is approved is the
 * company's business until it is.
 */
export function publicState(stage: string | null | undefined): PublicState {
  const s = (stage ?? "").trim();
  if (!s) return { kind: "unknown" };
  if (s === "canceled" || s === "rejected") return { kind: "closed" };
  const i = flowIndex(s);
  if (i < 0) return { kind: "pending" };
  return { kind: "tracking", stage: s as PublicStage, step: i + 1, total: PUBLIC_FLOW.length };
}

/** Exactly the fields a tracking link may reveal. Anything not listed here is not public. */
export const PUBLIC_FIELDS = [
  "order_code",
  "order_no",
  "order_suffix",
  "stage",
  "account",
  "delivery_date",
  "delivery_windows",
  "delivery_address",
  "assigned_driver",
  "pod_received_by",
] as const;

export interface PublicOrder {
  order_code?: string | null;
  order_no?: number | null;
  order_suffix?: string | null;
  stage?: string | null;
  account?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
  delivery_address?: string | null;
  assigned_driver?: string | null;
  pod_received_by?: string | null;
}

/**
 * Strip a full order row down to what a link may show.
 *
 * An allow-list, and it has to be: the row carries the delivery fee, internal notes, the customer's
 * phone number, GPS traces and who approved it. A deny-list would leak whatever column is added
 * next, which is the failure this codebase has already met twice.
 */
export function toPublicOrder(row: Record<string, unknown>): PublicOrder {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_FIELDS) out[f] = row[f] ?? null;
  return out as PublicOrder;
}
