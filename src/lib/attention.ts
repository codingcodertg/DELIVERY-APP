import type { Delivery } from "@/lib/types";
import { todayISO } from "@/lib/utils";

// ============================================================
// What is quietly going wrong right now.
//
// Every one of these was found by hand, by querying the database during a
// review — an order eleven days past its date with nobody driving it, stops
// with no map pin that the optimizer silently skipped, deliveries recorded
// with no proof at all. None of them raised anything anywhere; they just sat.
//
// A problem nobody is told about is a problem nobody fixes, so this turns each
// of those queries into something the board shows on its own.
// ============================================================

export type AttentionKind = "overdue_unassigned" | "no_pin" | "no_proof" | "no_fee";

export interface AttentionItem {
  kind: AttentionKind;
  delivery: Delivery;
}

/** Stages where an order is live work that hasn't reached the customer. */
const OPEN: Delivery["stage"][] = ["approved", "fulfilling", "ready", "picked_up"];

/**
 * Stages Routes Manager will plan a truck around (see ROUTE_STAGES).
 *
 * Wider than OPEN by one: a PENDING order is schedulable, so it can be loaded
 * into a route — and if it has no coordinates the optimizer drops it without a
 * word. FQ503 was exactly that: pending, dated for tomorrow, a full Weslaco
 * address, and invisible to routing. OPEN didn't cover it.
 */
const PLANNABLE: Delivery["stage"][] = ["pending", "approved", "fulfilling", "ready"];

/**
 * Past its delivery date with no driver.
 *
 * The date has to be BEFORE today, not merely today: an order dated today with
 * no driver is normal at 8am and would cry wolf every morning.
 */
export function overdueUnassigned(deliveries: Delivery[], today: string = todayISO()): Delivery[] {
  return deliveries.filter((d) =>
    OPEN.includes(d.stage) &&
    !d.assigned_driver &&
    !!d.delivery_date &&
    d.delivery_date.slice(0, 10) < today);
}

/**
 * Live work with no coordinates.
 *
 * The route optimizer skips these without a word, so a stop can be scheduled,
 * loaded and never routed. Measured against what Routes Manager can PLAN, not
 * what is approved: a pending order is schedulable too. Drafts are excluded —
 * they aren't orders yet.
 */
export function missingPin(deliveries: Delivery[]): Delivery[] {
  return deliveries.filter((d) => PLANNABLE.includes(d.stage) && d.delivery_lat == null);
}

/**
 * Delivered through the app with nothing to show for it.
 *
 * `pod_delivered_at` is what separates a real delivery from one marked in bulk
 * during the backlog import — those never had proof and never will, and
 * flagging 35 of them would bury the ones that matter.
 *
 * ONLY meaningful when the office actually asks for proof. With signatures and
 * `require_pod` both off, a delivery with nothing attached is the configured
 * outcome, not a fault — flagging it would be the app arguing with a setting
 * its owner chose, every single day, until they stopped reading the panel.
 * See `attentionItems`.
 */
export function deliveredWithoutProof(deliveries: Delivery[]): Delivery[] {
  return deliveries.filter((d) =>
    d.stage === "delivered" &&
    !!d.pod_delivered_at &&
    !d.pod_received_by &&
    !d.pod_signature &&
    d.pod_lat == null &&
    !(d.photos?.length));
}

/**
 * Stages where the fee can still be fixed.
 *
 * Not `delivered`: once it is delivered the fee is an invoicing problem, and a
 * panel that keeps shouting about orders nobody can change any more is a panel
 * that gets hidden. Not `draft` either — it isn't an order yet.
 */
const BILLABLE: Delivery["stage"][] = ["pending", "approved", "fulfilling", "ready", "picked_up"];

/**
 * A customer delivery going out with **nothing charged for it**.
 *
 * This is the failure D-143/D-146 were built around, and the one the fee dialog
 * did NOT catch: it only warned when the amount disagreed with the price list,
 * so an EMPTY fee — the worst case, a delivery invoiced for free — passed
 * without a word. A wrong number is at least a number somebody typed; a blank
 * one usually means nobody looked.
 *
 * Zero counts as nothing. It is a legitimate value (a courtesy delivery, a
 * redelivery the company eats), which is exactly why it has to be *seen and
 * confirmed* rather than assumed: from outside, a deliberate $0 and a forgotten
 * one look identical.
 *
 * **A todos los tipos, sin excepción** (D-148). La primera versión solo miraba los
 * tipos cuyo documento requerido es la factura, siguiendo a `required.ts`. Andrés lo
 * corrigió: también un traslado entre tiendas mueve un camión, y si sale sin tarifa
 * quiere verlo. Aquí no se decide si cobrar o no —eso es negocio— solo se dice en voz
 * alta que **no se cobró**, y confirmarlo lo calla.
 */
export function noFeeCharged(deliveries: Delivery[]): Delivery[] {
  return deliveries.filter((d) =>
    BILLABLE.includes(d.stage) &&
    (d.delivery_fee == null || Number(d.delivery_fee) === 0));
}

/**
 * Everything above, in the order it should be acted on.
 *
 * `proofRequired` reflects the settings: missing proof is only worth raising
 * when the office asked for proof in the first place. Otherwise the panel
 * would spend every day complaining about a switch its owner deliberately
 * turned off, and a panel that is wrong daily is a panel nobody opens.
 */
export function attentionItems(
  deliveries: Delivery[],
  today: string = todayISO(),
  proofRequired = false,
): AttentionItem[] {
  return [
    ...overdueUnassigned(deliveries, today).map((delivery) => ({ kind: "overdue_unassigned" as const, delivery })),
    ...noFeeCharged(deliveries).map((delivery) => ({ kind: "no_fee" as const, delivery })),
    ...missingPin(deliveries).map((delivery) => ({ kind: "no_pin" as const, delivery })),
    ...(proofRequired
      ? deliveredWithoutProof(deliveries).map((delivery) => ({ kind: "no_proof" as const, delivery }))
      : []),
  ];
}
