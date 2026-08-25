import { describe, it, expect } from "vitest";
import { actionLabel, auditKinds, auditRows, type AuditEvent } from "./delivery-audit";

const ev = (over: Partial<AuditEvent> & { id: string }): AuditEvent => ({
  delivery_id: "d1",
  kind: "note",
  note: null,
  created_by: "u1",
  created_at: "2026-08-01T10:00:00Z",
  ...over,
});

const labels = new Map([["d1", "FA100"], ["d2", "FA101"]]);
const names = new Map([["u1", "Nick Huerta"], ["u2", "Ana Reyes"]]);

describe("actionLabel", () => {
  it("names the three bookkeeping verbs", () => {
    expect(actionLabel("created")).toBe("Created");
    expect(actionLabel("edited")).toBe("Edited");
    expect(actionLabel("note")).toBe("Note");
  });

  it("renders a stage key with the same label the board uses", () => {
    expect(actionLabel("picked_up")).toBe("Picked Up");
    expect(actionLabel("approved")).toBe("Programmed");
  });

  it("passes an unrecognised kind through instead of mislabelling it as Draft", () => {
    // stageInfo() falls back to DELIVERY_STAGES[0], so a naive version would call this "Draft".
    expect(actionLabel("teleported")).toBe("teleported");
  });
});

describe("auditRows", () => {
  it("sorts newest first", () => {
    const rows = auditRows(
      [
        ev({ id: "a", created_at: "2026-08-01T10:00:00Z" }),
        ev({ id: "b", created_at: "2026-08-03T10:00:00Z" }),
        ev({ id: "c", created_at: "2026-08-02T10:00:00Z" }),
      ],
      labels,
      names
    );
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("attributes an actorless event to the system, not to an unknown person", () => {
    const [row] = auditRows([ev({ id: "a", created_by: null })], labels, names);
    expect(row.by).toBe("system");
  });

  it("shows a dash for an actor who is no longer a known user", () => {
    const [row] = auditRows([ev({ id: "a", created_by: "ghost" })], labels, names);
    expect(row.by).toBe("—");
  });

  it("leaves the label null when the event outlived its order", () => {
    const [row] = auditRows([ev({ id: "a", delivery_id: "gone" })], labels, names);
    expect(row.label).toBeNull();
  });

  it("filters by kind", () => {
    const rows = auditRows(
      [ev({ id: "a", kind: "note" }), ev({ id: "b", kind: "delivered" })],
      labels,
      names,
      { kind: "delivered" }
    );
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("searches order code, action, person and note — all four", () => {
    const events = [
      ev({ id: "code", delivery_id: "d2" }),
      ev({ id: "action", kind: "delivered" }),
      ev({ id: "person", created_by: "u2" }),
      ev({ id: "note", note: "left at the side gate" }),
    ];
    const only = (q: string) => auditRows(events, labels, names, { q }).map((r) => r.id);
    expect(only("FA101")).toEqual(["code"]);
    expect(only("delivered")).toEqual(["action"]);
    expect(only("Ana")).toEqual(["person"]);
    expect(only("side gate")).toEqual(["note"]);
  });

  it("searches case-insensitively", () => {
    const rows = auditRows([ev({ id: "a", note: "Left At Gate" })], labels, names, { q: "left at gate" });
    expect(rows).toHaveLength(1);
  });

  it("matches the rendered action label, not the raw key", () => {
    // Somebody searching the feed types what they can see. "picked_up" is never on screen.
    const rows = auditRows([ev({ id: "a", kind: "picked_up" })], labels, names, { q: "picked up" });
    expect(rows).toHaveLength(1);
  });

  it("combines kind and text rather than letting either win alone", () => {
    const events = [
      ev({ id: "a", kind: "delivered", note: "gate" }),
      ev({ id: "b", kind: "delivered", note: "front" }),
      ev({ id: "c", kind: "note", note: "gate" }),
    ];
    expect(auditRows(events, labels, names, { kind: "delivered", q: "gate" }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("auditKinds", () => {
  it("lists each kind once, sorted", () => {
    const kinds = auditKinds([
      ev({ id: "a", kind: "note" }),
      ev({ id: "b", kind: "created" }),
      ev({ id: "c", kind: "note" }),
    ]);
    expect(kinds).toEqual(["created", "note"]);
  });
});
