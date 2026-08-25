import { describe, it, expect } from "vitest";
import {
  canTransition,
  checkMove,
  availableMoves,
  hasCap,
  capsFor,
  canEditFields,
  LEGAL_TRANSITIONS,
} from "./delivery-workflow";

describe("canTransition — the workflow itself", () => {
  it("walks the happy path one step at a time", () => {
    expect(canTransition("draft", "pending")).toBe(true);
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("approved", "fulfilling")).toBe(true);
    expect(canTransition("fulfilling", "ready")).toBe(true);
    expect(canTransition("ready", "picked_up")).toBe(true);
    expect(canTransition("picked_up", "delivered")).toBe(true);
  });

  it("refuses to skip approval — the rule the whole guard exists for", () => {
    // An order must never reach the warehouse without being approved first.
    expect(canTransition("draft", "fulfilling")).toBe(false);
    expect(canTransition("draft", "delivered")).toBe(false);
    expect(canTransition("pending", "ready")).toBe(false);
  });

  it("allows draft -> approved structurally, and gates it on the store", () => {
    // Corrected against the database in v4_77: the source's guard trigger DOES permit this, but
    // only where the store approves its own orders. So the move is legal in the transition table
    // and refused by checkMove unless that store setting is on — the store decides, not the person.
    expect(canTransition("draft", "approved")).toBe(true);
    expect(checkMove("draft", "approved", "sales", null, false).ok).toBe(false);
    expect(checkMove("draft", "approved", "manager", null, false).ok).toBe(false);
    expect(checkMove("draft", "approved", "sales", null, true).ok).toBe(true);
  });

  it("treats canceled as terminal", () => {
    expect(LEGAL_TRANSITIONS.canceled).toEqual([]);
    expect(canTransition("canceled", "pending")).toBe(false);
  });

  it("lets the warehouse undo a delivery, but only back one step", () => {
    // This test used to assert delivered was terminal, on the reasoning that an order which arrived
    // is not un-arrived by editing a field. The database says otherwise and has all along: the
    // source's guard trigger permits warehouse delivered -> picked_up, because a delivery marked by
    // mistake has to be correctable by the people who marked it.
    expect(LEGAL_TRANSITIONS.delivered).toEqual(["picked_up"]);
    expect(checkMove("delivered", "picked_up", "warehouse").ok).toBe(true);
    expect(checkMove("delivered", "picked_up", "driver").ok).toBe(false);
    // One step back, not a free rewind.
    expect(canTransition("delivered", "ready")).toBe(false);
    expect(canTransition("delivered", "pending")).toBe(false);
  });

  it("allows the two deliberate reversals", () => {
    // A manager unlocking an approved order, and a driver putting back a load that never left.
    expect(canTransition("approved", "pending")).toBe(true);
    expect(canTransition("picked_up", "ready")).toBe(true);
  });

  it("is false for an unknown stage rather than throwing", () => {
    expect(canTransition("nonsense", "pending")).toBe(false);
  });
});

describe("capabilities", () => {
  it("gives a driver deliver and nothing else — notably not create", () => {
    // Orders are programmed by sales/office and dispatched by logistics; a driver delivers what is
    // assigned.
    expect(capsFor("driver")).toEqual(["deliver"]);
    expect(hasCap("driver", "create")).toBe(false);
  });

  it("gives accounting approve but not create", () => {
    // Creating an order commits the company to a delivery — a sales/office call.
    expect(hasCap("accounting", "approve")).toBe(true);
    expect(hasCap("accounting", "create")).toBe(false);
  });

  it("gives a catalog-only role nothing here", () => {
    expect(capsFor("staff")).toEqual([]);
    expect(capsFor(null)).toEqual([]);
    expect(capsFor("unknown-role")).toEqual([]);
  });

  it("honours an extra capability granted to an individual", () => {
    expect(hasCap("sales", "approve")).toBe(false);
    expect(hasCap("sales", "approve", ["approve"])).toBe(true);
  });

  it("does not duplicate a capability the role already has", () => {
    expect(capsFor("manager", ["approve"]).filter((c) => c === "approve")).toHaveLength(1);
  });
});

describe("checkMove — both gates", () => {
  it("passes when the move is legal and the capability is held", () => {
    expect(checkMove("pending", "approved", "manager")).toEqual({ ok: true });
  });

  it("distinguishes an illegal move from a forbidden one", () => {
    // These are different problems and deserve different messages: "not yet" vs "not you".
    expect(checkMove("draft", "delivered", "admin")).toEqual({ ok: false, reason: "illegal" });
    expect(checkMove("pending", "approved", "sales")).toEqual({ ok: false, reason: "forbidden" });
  });

  it("stops a capability from becoming a shortcut through the workflow", () => {
    // An admin holds every capability and still cannot skip approval.
    expect(checkMove("draft", "fulfilling", "admin").ok).toBe(false);
  });

  it("reports an unknown stage rather than guessing", () => {
    expect(checkMove("nonsense", "pending", "admin")).toEqual({ ok: false, reason: "unknown" });
  });

  it("lets warehouse fulfil but not approve", () => {
    expect(checkMove("approved", "fulfilling", "warehouse").ok).toBe(true);
    expect(checkMove("pending", "approved", "warehouse").ok).toBe(false);
  });

  it("lets a driver deliver but not cancel", () => {
    expect(checkMove("ready", "picked_up", "driver").ok).toBe(true);
    expect(checkMove("picked_up", "delivered", "driver").ok).toBe(true);
    expect(checkMove("draft", "canceled", "driver").ok).toBe(false);
  });
});

describe("availableMoves — what the UI should offer", () => {
  it("offers a manager the approval decision, and the way back", () => {
    // "draft" is the manager returning a submission to the rep rather than rejecting it outright —
    // recovered in v4_77 when the app's rules were checked against the database's.
    expect(availableMoves("pending", "manager").sort()).toEqual(["approved", "draft", "rejected"]);
  });

  it("offers a driver only their own step", () => {
    expect(availableMoves("ready", "driver")).toEqual(["picked_up"]);
    expect(availableMoves("picked_up", "driver").sort()).toEqual(["delivered", "ready"]);
  });

  it("offers nothing from a canceled order, to anyone", () => {
    expect(availableMoves("canceled", "admin")).toEqual([]);
    expect(availableMoves("canceled", "manager")).toEqual([]);
  });

  it("offers a delivered order back only to the floor", () => {
    expect(availableMoves("delivered", "warehouse")).toEqual(["picked_up"]);
    expect(availableMoves("delivered", "driver")).toEqual([]);
    expect(availableMoves("delivered", "sales")).toEqual([]);
  });

  it("offers nothing to a role with no capability here", () => {
    expect(availableMoves("pending", "staff")).toEqual([]);
  });

  it("never offers a move checkMove would refuse", () => {
    for (const from of Object.keys(LEGAL_TRANSITIONS)) {
      for (const role of ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"]) {
        for (const to of availableMoves(from, role)) {
          expect(checkMove(from, to, role).ok).toBe(true);
        }
      }
    }
  });
});

describe("canEditFields", () => {
  it("lets sales edit while pending or rejected, but not a saved draft", () => {
    // A saved draft must be submitted for approval before being touched again.
    expect(canEditFields("sales", "pending")).toBe(true);
    expect(canEditFields("sales", "rejected")).toBe(true);
    expect(canEditFields("sales", "draft")).toBe(false);
  });

  it("lets warehouse edit the stages it handles", () => {
    expect(canEditFields("warehouse", "approved")).toBe(true);
    expect(canEditFields("warehouse", "delivered")).toBe(true);
    expect(canEditFields("warehouse", "draft")).toBe(false);
  });

  it("lets admin and manager edit at any stage", () => {
    for (const s of Object.keys(LEGAL_TRANSITIONS)) {
      expect(canEditFields("admin", s)).toBe(true);
      expect(canEditFields("manager", s)).toBe(true);
    }
  });

  it("fails closed for an unknown role", () => {
    expect(canEditFields("staff", "pending")).toBe(false);
    expect(canEditFields(null, "pending")).toBe(false);
  });
});
