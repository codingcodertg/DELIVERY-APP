// What is quietly going wrong right now. Ported from the deliveries app (ADR 0010).
// Framework-free (ADR 0006).
//
// Every one of these was originally found by hand, by querying the database during a review — an
// order eleven days past its date with nobody driving it, stops with no map pin that the optimizer
// silently skipped, deliveries recorded with no proof at all. None of them raised anything anywhere;
// they just sat. A problem nobody is told about is a problem nobody fixes, so each of those queries
// became something the board surfaces on its own.

import { todayISO } from "./business-time";

export type AttentionKind = "overdue_unassigned" | "no_pin" | "no_proof";

export interface AttentionOrder {
  id?: string;
  order_no?: number | null;
  stage?: string | null;
  assigned_driver?: string | null;
  delivery_date?: string | null;
  delivery_lat?: number | null;
  pod_delivered_at?: string | null;
  pod_received_by?: string | null;
  pod_signature?: string | null;
  pod_lat?: number | null;
  photos?: unknown[] | null;
}

export interface AttentionItem<T extends AttentionOrder = AttentionOrder> {
  kind: AttentionKind;
  delivery: T;
}

/** Stages where an order is live work that hasn't reached the customer. */
const OPEN = ["approved", "fulfilling", "ready", "picked_up"];

/**
 * Stages the route planner will build a truck around.
 *
 * Wider than OPEN by one: a PENDING order is schedulable, so it can be loaded into a route — and if
 * it has no coordinates the optimizer drops it without a word. One real order was exactly that:
 * pending, dated for tomorrow, a full address, and invisible to routing. OPEN did not cover it.
 */
const PLANNABLE = ["pending", "approved", "fulfilling", "ready"];

/**
 * Past its delivery date with no driver.
 *
 * The date must be BEFORE today, not merely today: an order dated today with no driver yet is normal
 * at 8am and would cry wolf every morning.
 */
export function overdueUnassigned<T extends AttentionOrder>(deliveries: T[], today: string = todayISO()): T[] {
  return deliveries.filter(
    (d) =>
      !!d.stage &&
      OPEN.includes(d.stage) &&
      !d.assigned_driver &&
      !!d.delivery_date &&
      d.delivery_date.slice(0, 10) < today
  );
}

/**
 * Live work with no coordinates — the optimizer skips these silently, so a stop can be scheduled,
 * loaded, and never routed. Measured against what can be PLANNED, not what is approved. Drafts are
 * excluded: they are not orders yet.
 */
export function missingPin<T extends AttentionOrder>(deliveries: T[]): T[] {
  return deliveries.filter((d) => !!d.stage && PLANNABLE.includes(d.stage) && d.delivery_lat == null);
}

/**
 * Delivered through the app with nothing to show for it.
 *
 * `pod_delivered_at` is what separates a real delivery from one marked in bulk during the backlog
 * import — those never had proof and never will, and flagging dozens of them would bury the ones
 * that matter.
 */
export function deliveredWithoutProof<T extends AttentionOrder>(deliveries: T[]): T[] {
  return deliveries.filter(
    (d) =>
      d.stage === "delivered" &&
      !!d.pod_delivered_at &&
      !d.pod_received_by &&
      !d.pod_signature &&
      d.pod_lat == null &&
      !d.photos?.length
  );
}

/**
 * Everything above, in the order it should be acted on.
 *
 * `proofRequired` reflects the settings: missing proof is only worth raising when the office asked
 * for proof in the first place. Otherwise the panel would spend every day complaining about a switch
 * its owner deliberately turned off — and a panel that is wrong daily is a panel nobody opens.
 */
export function attentionItems<T extends AttentionOrder>(
  deliveries: T[],
  today: string = todayISO(),
  proofRequired = false
): AttentionItem<T>[] {
  return [
    ...overdueUnassigned(deliveries, today).map((delivery) => ({ kind: "overdue_unassigned" as const, delivery })),
    ...missingPin(deliveries).map((delivery) => ({ kind: "no_pin" as const, delivery })),
    ...(proofRequired
      ? deliveredWithoutProof(deliveries).map((delivery) => ({ kind: "no_proof" as const, delivery }))
      : []),
  ];
}
