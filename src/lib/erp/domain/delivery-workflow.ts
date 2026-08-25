// Who may move an order where. Ported from the deliveries app (ADR 0010). Framework-free (ADR 0006).
//
// Two independent gates, and BOTH must pass:
//   1. Is the move itself legal?  (draft can reach pending; it can never reach delivered)
//   2. Does this person hold the capability that move requires?
//
// Keeping them apart is what stops "the manager can approve" quietly becoming "the manager can do
// anything": a capability grants a KIND of action, never a shortcut through the workflow.

export type Capability = "create" | "approve" | "fulfill" | "deliver" | "dashboard" | "settings" | "route_plan";

/**
 * What each role may do. A driver deliberately cannot create: orders are programmed by sales or the
 * office and dispatched by logistics — a driver only delivers what is assigned. Accounting reviews
 * and approves but does not open orders, because creating one commits the company to a delivery.
 */
export const ROLE_CAPS: Record<string, Capability[]> = {
  admin: ["create", "approve", "fulfill", "deliver", "dashboard", "settings", "route_plan"],
  manager: ["create", "approve", "dashboard"],
  sales: ["create"],
  warehouse: ["fulfill", "deliver"],
  driver: ["deliver"],
  logistics: ["route_plan", "approve"],
  accounting: ["approve"],
  // Catalog-only roles have no deliveries capabilities at all.
  staff: [],
};

/** Role capabilities plus any extra granted to this individual. */
export function capsFor(role: string | null | undefined, extra?: string[] | null): Capability[] {
  const base = (role && ROLE_CAPS[role]) || [];
  const add = (extra ?? []).filter((c): c is Capability => !base.includes(c as Capability));
  return [...base, ...add];
}

export function hasCap(role: string | null | undefined, cap: Capability, extra?: string[] | null): boolean {
  return capsFor(role, extra).includes(cap);
}

/**
 * The only legal stage moves.
 *
 * An order can never reach the warehouse (fulfilling/ready/delivered) without being approved first,
 * no matter how the transition is called. `canceled` is terminal.
 *
 * CHECKED AGAINST THE DATABASE, not written from intuition. v4_77 restores deliveries-app's
 * guard_delivery_stage() trigger, which has been enforcing these moves in production all along, and
 * delivery-workflow-parity.test.ts compares this table against a transcription of that trigger for
 * every role/from/to combination. Four moves were added as a direct result — the first port had
 * quietly dropped them:
 *
 *   pending -> draft           a rep pulling a submission back before anyone acts on it
 *   ready -> fulfilling        the warehouse pulling a staged load back onto the floor
 *   delivered -> picked_up     undoing a delivery marked by mistake
 *   draft/pending -> approved  at a store configured to approve its own orders
 *
 * `delivered` is therefore NOT terminal, which contradicts what this comment used to claim. The
 * trigger is authoritative: it is what production has been running against real orders.
 */
export const LEGAL_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending", "approved", "canceled"], // approved only at an auto-approving store
  pending: ["approved", "rejected", "draft"], // draft = pulling a submission back
  rejected: ["pending", "canceled"],
  approved: ["fulfilling", "pending"], // pending = a manager unlocking it again
  fulfilling: ["ready"],
  ready: ["picked_up", "fulfilling"], // collected, or pulled back onto the floor
  picked_up: ["delivered", "ready"], // delivered, or put back if it never left
  delivered: ["picked_up"], // the warehouse undoing a delivery marked in error
  canceled: [],
};

export function canTransition(from: string, to: string): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Can this move ride the store's auto-approve setting?
 *
 * Only the two routes into `approved` can, and they are not equivalent:
 *
 *   pending -> approved   a manager does this normally; auto-approve is an ALTERNATIVE route for
 *                         whoever created the order
 *   draft   -> approved   nobody does this normally. It skips submission AND approval, so an
 *                         auto-approving store is the only way it ever happens
 *
 * Treating the flag as a general override would turn a per-store convenience into a way around
 * approval entirely, which is why it is confined to these two.
 */
export function canRideAutoApprove(from: string, to: string): boolean {
  return to === "approved" && (from === "draft" || from === "pending");
}

/** A move that ONLY an auto-approving store can ever permit, whatever the person's capabilities. */
export function requiresAutoApprove(from: string, to: string): boolean {
  return from === "draft" && to === "approved";
}

/**
 * The capability a given move requires.
 *
 * Takes BOTH ends, because the destination alone is not enough to say who owns a move. Reaching
 * "ready" from "fulfilling" is the warehouse finishing a load; reaching it from "picked_up" is a
 * driver putting back a load that never left. Same destination, different job, different capability
 * — keying only on the destination would have told drivers they may not undo their own pickup.
 */
export function capabilityForMove(from: string, to: string): Capability | null {
  // Cancelling an order nobody has acted on is the owner withdrawing their own work, not an office
  // decision. Once approved, cancelling is an approval-level call.
  if (to === "canceled") return from === "draft" || from === "rejected" ? "create" : "approve";
  // Pulling a submission back to draft belongs to whoever submitted it.
  if (to === "draft") return "create";
  if (to === "pending") {
    // A manager unlocking an approved order is an approval decision; a rep submitting a draft or a
    // rejected order is not.
    return from === "approved" ? "approve" : "create";
  }
  if (to === "approved" || to === "rejected") return "approve";
  // Note draft -> approved never reaches here: checkMove settles it above, because no capability
  // grants it without the store's auto-approve setting.
  if (to === "ready") return from === "picked_up" ? "deliver" : "fulfill";
  // ready -> fulfilling is the warehouse pulling a load back; approved -> fulfilling is it starting.
  if (to === "fulfilling") return "fulfill";
  // delivered -> picked_up is the warehouse undoing a delivery, NOT a driver redoing their own stop.
  // "fulfill" keeps it to the floor supervisor, which is what the database trigger enforces.
  if (to === "picked_up") return from === "delivered" ? "fulfill" : "deliver";
  if (to === "delivered") return "deliver";
  return null;
}

export interface MoveCheck {
  ok: boolean;
  /** Why not — for the message the user actually sees. */
  reason?: "illegal" | "forbidden" | "unknown";
}

/**
 * May this person make this move? Both gates, in order, so the message can say which one failed:
 * "you can't do that yet" is a different problem from "you can't do that".
 */
export function checkMove(
  from: string,
  to: string,
  role: string | null | undefined,
  extra?: string[] | null,
  autoApprove = false
): MoveCheck {
  if (!LEGAL_TRANSITIONS[from]) return { ok: false, reason: "unknown" };
  if (!canTransition(from, to)) return { ok: false, reason: "illegal" };

  // Whoever opened the order may approve it themselves, but only where the store is configured for
  // it. This is the one place the store, rather than the person, decides.
  // Auto-approve exists for people who can OPEN an order but not approve one -- it saves a
  // salesperson waiting on a manager at a store that has decided it does not need the step. Someone
  // who already holds "approve" gains nothing from it and must not be handed draft -> approved,
  // which skips submission too; the database trigger draws the same line by naming only sales and
  // drivers in its auto branch.
  const viaAuto =
    canRideAutoApprove(from, to) &&
    autoApprove &&
    hasCap(role, "create", extra) &&
    !hasCap(role, "approve", extra);

  // draft -> approved skips submission AND approval. No capability reaches it on its own — an
  // auto-approving store is the only route, so without one it is not a permission problem to
  // explain, it is simply not a move that exists here.
  if (requiresAutoApprove(from, to)) {
    if (viaAuto) return { ok: true };
    return { ok: false, reason: autoApprove ? "forbidden" : "illegal" };
  }

  const cap = capabilityForMove(from, to);
  if (!cap) return { ok: false, reason: "unknown" };
  if (hasCap(role, cap, extra)) return { ok: true };
  if (viaAuto) return { ok: true };
  return { ok: false, reason: "forbidden" };
}

/** Every move this person could make from here — what the UI should offer, and nothing more. */
export function availableMoves(
  from: string,
  role: string | null | undefined,
  extra?: string[] | null,
  autoApprove = false
): string[] {
  return (LEGAL_TRANSITIONS[from] ?? []).filter(
    (to) => checkMove(from, to, role, extra, autoApprove).ok
  );
}

/** Can this role edit the order's data fields while it sits in `stage`? */
export function canEditFields(role: string | null | undefined, stage: string): boolean {
  if (role === "admin" || role === "manager") return true;
  // Sales may edit while Pending or Rejected — NOT once it is a saved draft. A new order is still
  // editable; a saved draft must be submitted for approval before being touched again.
  if (role === "sales") return stage === "pending" || stage === "rejected";
  if (role === "warehouse") return ["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(stage);
  if (role === "driver") return stage === "draft" || stage === "pending" || stage === "rejected";
  return false;
}
