// Parity between the application's workflow rules and the DATABASE's.
//
// v4_77 restores deliveries-app's guard_delivery_stage() trigger, which decides per role whether a
// stage move is allowed. It has been running in production against real orders for as long as the
// source app has existed, so where it and lib/domain/delivery-workflow.ts disagree, IT is right and
// the port is the bug.
//
// The `trigger()` function below is a line-by-line transcription of that SQL. This test walks every
// role x from x to x auto-approve combination and asserts the two agree, except for divergences
// listed explicitly below — the point being that a divergence has to be written down and justified,
// not discovered later by a user hitting a raw Postgres exception.
//
// Writing this test is what found four moves the first port had silently dropped (pending -> draft,
// ready -> fulfilling, delivered -> picked_up, and the auto-approve routes into approved).
import { test, expect } from "vitest";
import { checkMove } from "./delivery-workflow";

const ROLES = ["manager", "sales", "driver", "warehouse", "logistics", "accounting", "staff"];
const STAGES = [
  "draft",
  "pending",
  "approved",
  "fulfilling",
  "ready",
  "picked_up",
  "delivered",
  "canceled",
  "rejected",
];

/**
 * Transcription of deliveries.guard_delivery_stage() (v4_77), stage-change branch only.
 *
 * `admin` is deliberately not tested: the trigger returns NEW unconditionally for an admin, so the
 * database imposes no ceiling there and the application's own rules are the only limit. Comparing
 * them would assert that the app should let an admin jump draft -> delivered, which is exactly what
 * LEGAL_TRANSITIONS exists to prevent.
 */
function trigger(role: string, from: string, to: string, auto: boolean): boolean {
  if (["sales", "driver", "manager"].includes(role)) {
    if (from === "draft" && to === "pending") return true;
    if (from === "pending" && to === "draft") return true;
    if (from === "rejected" && to === "pending") return true;
    if (from === "draft" && to === "canceled") return true;
    if (from === "rejected" && to === "canceled") return true;
    if (["sales", "driver"].includes(role) && to === "approved" && ["draft", "pending"].includes(from) && auto)
      return true;
    if (role === "driver" && from === "ready" && to === "picked_up") return true;
    if (role === "driver" && from === "picked_up" && to === "delivered") return true;
    if (role === "driver" && from === "picked_up" && to === "ready") return true;
    if (role === "manager") {
      if (from === "pending" && to === "approved") return true;
      if (from === "pending" && to === "rejected") return true;
      if (from === "approved" && to === "pending") return true;
    }
    return false;
  }
  if (role === "warehouse") {
    return [
      ["approved", "fulfilling"],
      ["fulfilling", "ready"],
      ["ready", "picked_up"],
      ["picked_up", "delivered"],
      ["ready", "fulfilling"],
      ["picked_up", "ready"],
      ["delivered", "picked_up"],
    ].some(([f, t]) => f === from && t === to);
  }
  if (["accounting", "logistics"].includes(role)) {
    // v4_87: the approval decision, and only that.
    if (from === "pending" && to === "approved") return true;
    if (from === "pending" && to === "rejected") return true;
    if (from === "approved" && to === "pending") return true;
    return false;
  }
  // staff: the trigger's final `raise exception 'Not allowed'`.
  return false;
}

const key = (role: string, from: string, to: string) => `${role}:${from}->${to}`;

/**
 * RESOLVED — this set is deliberately empty.
 *
 * It used to list logistics and accounting approving, which deliveries-app's ROLE_CAPS granted and
 * guard_delivery_stage() refused: seven people getting a raw Postgres error every time they clicked
 * a button their app had always shown them. It sat here as a documented divergence because fixing it
 * meant deciding who may approve an order, which is a business question.
 *
 * The owner decided the roles keep the capability, and v4_87 widened the trigger to the three moves
 * a manager has — approve, reject, and unlock a pending order — and no further.
 *
 * Kept as an empty set rather than deleted, so the shape of the check stays visible: an entry here
 * is always a bug the app can hit, and the right number of them is zero.
 */
const APP_ALLOWS_DB_REFUSES = new Set<string>();

/**
 * KNOWN DIVERGENCE 2 — the database permits a move the app never offers.
 *
 * The trigger lets a driver open, submit and cancel orders. Neither app does: ROLE_CAPS gives the
 * driver role `deliver` only, deliberately — orders are programmed by sales or the office and
 * dispatched by logistics, and a driver delivers what is assigned.
 *
 * So the trigger is simply looser than the policy above it, which is the safe direction for a
 * backstop to err in, and matches the source app exactly. Not a lost capability: nothing in either
 * UI ever offered these.
 */
const DB_ALLOWS_APP_DECLINES = new Set([
  key("driver", "draft", "pending"),
  key("driver", "draft", "approved"),
  key("driver", "draft", "canceled"),
  key("driver", "pending", "draft"),
  key("driver", "pending", "approved"),
  key("driver", "rejected", "pending"),
  key("driver", "rejected", "canceled"),
]);

test("every stage move agrees with the database trigger, or is a listed divergence", () => {
  const unexpected: string[] = [];

  for (const auto of [false, true]) {
    for (const role of ROLES) {
      for (const from of STAGES) {
        for (const to of STAGES) {
          if (from === to) continue;
          const db = trigger(role, from, to, auto);
          const app = checkMove(from, to, role, null, auto).ok;
          if (db === app) continue;
          const k = key(role, from, to);
          if (app && !db && APP_ALLOWS_DB_REFUSES.has(k)) continue;
          if (db && !app && DB_ALLOWS_APP_DECLINES.has(k)) continue;
          unexpected.push(`auto=${auto} ${k} app=${app} db=${db}`);
        }
      }
    }
  }

  expect(unexpected).toEqual([]);
});

test("the listed divergences still exist — a stale exemption is worse than none", () => {
  // If one is fixed, this fails and the list has to be trimmed, so an exemption cannot quietly
  // outlive the problem it describes. That is not theoretical: it caught v4_87 resolving the
  // accounting/logistics one, which is why that assertion is gone rather than edited.
  expect(checkMove("draft", "pending", "driver").ok).toBe(false);
  expect(trigger("driver", "draft", "pending", false)).toBe(true);
});

test("accounting and logistics can now approve, in both the app and the database", () => {
  // v4_87. The app always said so; the database refused until then.
  for (const role of ["accounting", "logistics"]) {
    for (const [from, to] of [["pending", "approved"], ["pending", "rejected"], ["approved", "pending"]]) {
      expect(checkMove(from, to, role).ok, `${role} ${from}->${to} (app)`).toBe(true);
      expect(trigger(role, from, to, false), `${role} ${from}->${to} (db)`).toBe(true);
    }
    // And no further: approving is not a licence to work the floor.
    expect(trigger(role, "approved", "fulfilling", false)).toBe(false);
    expect(trigger(role, "ready", "picked_up", false)).toBe(false);
  }
});

// --- the four moves this parity check recovered ------------------------------
test("a rep can pull a submitted order back to draft", () => {
  expect(checkMove("pending", "draft", "sales").ok).toBe(true);
  expect(checkMove("pending", "draft", "manager").ok).toBe(true);
});

test("the warehouse can pull a staged load back onto the floor", () => {
  expect(checkMove("ready", "fulfilling", "warehouse").ok).toBe(true);
  // Not the driver: this is floor work, not a delivery decision.
  expect(checkMove("ready", "fulfilling", "driver").ok).toBe(false);
});

test("the warehouse can undo a delivery marked in error, and a driver cannot", () => {
  expect(checkMove("delivered", "picked_up", "warehouse").ok).toBe(true);
  expect(checkMove("delivered", "picked_up", "driver").ok).toBe(false);
});

test("cancelling an untouched order belongs to whoever opened it", () => {
  expect(checkMove("draft", "canceled", "sales").ok).toBe(true);
  expect(checkMove("rejected", "canceled", "sales").ok).toBe(true);
  // But not once it has been approved — that is an office decision.
  expect(checkMove("approved", "canceled", "sales").ok).toBe(false);
});

// --- auto-approve ------------------------------------------------------------
test("auto-approve lets a rep approve their own order, only where the store allows it", () => {
  expect(checkMove("pending", "approved", "sales", null, false).ok).toBe(false);
  expect(checkMove("pending", "approved", "sales", null, true).ok).toBe(true);
});

test("draft to approved is impossible without an auto-approving store", () => {
  // It skips submission AND approval, so no capability reaches it alone.
  expect(checkMove("draft", "approved", "sales", null, false).ok).toBe(false);
  expect(checkMove("draft", "approved", "manager", null, false).ok).toBe(false);
  expect(checkMove("draft", "approved", "sales", null, true).ok).toBe(true);
});

test("auto-approve gives an approver nothing extra", () => {
  // A manager can already approve; handing them draft -> approved would let them skip submission,
  // which the trigger does not allow either.
  expect(checkMove("draft", "approved", "manager", null, true).ok).toBe(false);
  expect(checkMove("pending", "approved", "manager", null, false).ok).toBe(true);
});

test("auto-approve is not a general override", () => {
  // It must not unlock anything beyond the two routes into approved.
  expect(checkMove("approved", "delivered", "sales", null, true).ok).toBe(false);
  expect(checkMove("pending", "rejected", "sales", null, true).ok).toBe(false);
  expect(checkMove("ready", "picked_up", "sales", null, true).ok).toBe(false);
});
