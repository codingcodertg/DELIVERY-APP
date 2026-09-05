import { describe, it, expect } from "vitest";
import {
  SHIFT_OUTBOX_KEY, enqueueShiftOp, applyShiftOutbox, flushShiftOps, loadShiftOutbox, saveShiftOutbox,
  type ShiftOp, type StorageLike,
} from "./shift-outbox";
import type { DriverShift } from "./types";

// G-8 (D-NEXT). El fichaje de salida sin red no encolaba: el turno seguía abierto y el GPS
// seguía reportando. Lo que se vigila: que una salida encolada cierre el turno LOCALMENTE al
// momento (eso es lo que apaga el GPS), que una entrada encolada abra uno local, que el reenvío
// vaya en el orden en que se tocó y se pare en el primer "sin red", y que se escriba la hora del
// toque y no la del reenvío.

const shift = (id: string, driver_id: string, started_at: string, ended_at: string | null = null): DriverShift =>
  ({ id, driver_id, started_at, ended_at, note: null, device_id: "dev-1" } as DriverShift);
const op = (kind: "in" | "out", at: string, driverId = "d1"): ShiftOp => ({ id: `op-${kind}-${at}`, kind, driverId, at, deviceId: "dev-1" });
const T = (h: number) => `2026-09-05T${String(h).padStart(2, "0")}:00:00.000Z`;

function fakeStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

describe("lo que ve el chofer mientras la cola espera", () => {
  it("una salida encolada cierra el turno abierto al momento, con la hora del toque", () => {
    const shifts = [shift("s1", "d1", T(8))];
    const out = applyShiftOutbox(shifts, [op("out", T(17))]);
    expect(out[0].ended_at).toBe(T(17));
    expect(shifts[0].ended_at).toBeNull(); // no muta
  });

  it("una entrada encolada abre un turno local; si ya hay uno abierto, no duplica", () => {
    const out = applyShiftOutbox([], [op("in", T(8))]);
    expect(out).toHaveLength(1);
    expect(out[0].id.startsWith("local-")).toBe(true);
    expect(out[0].started_at).toBe(T(8));
    expect(out[0].ended_at).toBeNull();
    expect(applyShiftOutbox([shift("s1", "d1", T(7))], [op("in", T(8))])).toHaveLength(1);
  });

  it("entrada y salida encoladas en el mismo apagón: el turno local queda cerrado", () => {
    const out = applyShiftOutbox([], [op("out", T(17)), op("in", T(8))]); // desordenadas a propósito
    expect(out).toHaveLength(1);
    expect(out[0].started_at).toBe(T(8));
    expect(out[0].ended_at).toBe(T(17));
  });

  it("una salida sin turno abierto no inventa nada, y no toca a otro chofer", () => {
    const shifts = [shift("s1", "d2", T(8))];
    expect(applyShiftOutbox(shifts, [op("out", T(17), "d1")])).toEqual(shifts);
    expect(applyShiftOutbox(shifts, [])).toBe(shifts);
  });
});

describe("reenvío", () => {
  it("en el orden en que se tocó; se para en el primer sin red y deja el resto", async () => {
    const items = [op("out", T(17)), op("in", T(8))];
    const vistos: string[] = [];
    const out = await flushShiftOps(items, async (o) => { vistos.push(o.kind); return o.kind === "in" ? "ok" : "offline"; });
    expect(vistos).toEqual(["in", "out"]);
    expect(out.sent).toBe(1);
    expect(out.remaining.map((o) => o.kind)).toEqual(["out"]);
  });

  it("una excepción cuenta como sin red; un rechazo descarta esa op y sigue", async () => {
    const items = [op("in", T(8)), op("out", T(17))];
    expect((await flushShiftOps(items, async () => { throw new Error("Failed to fetch"); })).remaining).toHaveLength(2);
    const out = await flushShiftOps(items, async (o) => (o.kind === "in" ? "rejected" : "ok"));
    expect(out).toEqual({ remaining: [], sent: 1, dropped: 1 });
  });

  it("enqueueShiftOp añade al final sin mutar", () => {
    const q0: ShiftOp[] = [];
    const q1 = enqueueShiftOp(q0, op("in", T(8)));
    expect(q0).toHaveLength(0);
    expect(q1).toHaveLength(1);
  });
});

describe("almacenamiento", () => {
  it("guarda y lee; vacía quita la clave; JSON roto no revienta", () => {
    const s = fakeStorage();
    saveShiftOutbox(s, [op("in", T(8))]);
    expect(loadShiftOutbox(s)).toHaveLength(1);
    saveShiftOutbox(s, []);
    expect(s.data[SHIFT_OUTBOX_KEY]).toBeUndefined();
    expect(loadShiftOutbox(fakeStorage({ [SHIFT_OUTBOX_KEY]: "{nope" }))).toEqual([]);
    expect(loadShiftOutbox(fakeStorage({ [SHIFT_OUTBOX_KEY]: JSON.stringify([{ kind: "sideways" }, op("out", T(17))]) }))).toHaveLength(1);
  });
});
