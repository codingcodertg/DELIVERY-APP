import { describe, it, expect } from "vitest";
import {
  GPS_OUTBOX_KEY, GPS_OUTBOX_MAX, enqueueFix, orderedForFlush, flushFixes,
  loadGpsOutbox, saveGpsOutbox, type QueuedFix, type StorageLike,
} from "./gps-outbox";

// G-22 (D-200). Sin red, la fijación se perdía. Lo que se vigila: que se encole con su
// recorded_at nativo, que se reenvíe en orden, que el tope descarte las MÁS VIEJAS, y que un
// fallo a mitad del reenvío deje el resto en la cola sin desordenarlo.

const fix = (recorded_at: string, over: Partial<QueuedFix> = {}): QueuedFix => ({
  lat: 26.2, lng: -98.2, accuracy_m: 8, speed_mps: null, heading: null, battery_pct: 80,
  recorded_at, device_id: "dev-1", ...over,
});
const T = (i: number) => `2026-09-05T12:${String(i).padStart(2, "0")}:00.000Z`;

function fakeStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

describe("encolar", () => {
  it("añade al final sin mutar, y conserva el recorded_at del aparato", () => {
    const q0: QueuedFix[] = [];
    const q1 = enqueueFix(q0, fix(T(1)));
    const q2 = enqueueFix(q1, fix(T(2)));
    expect(q0).toHaveLength(0);
    expect(q2.map((f) => f.recorded_at)).toEqual([T(1), T(2)]);
  });

  it("el tope descarta las MÁS VIEJAS, nunca la última fijación", () => {
    let q: QueuedFix[] = [];
    for (let i = 0; i < 5; i++) q = enqueueFix(q, fix(T(i)), 3);
    expect(q.map((f) => f.recorded_at)).toEqual([T(2), T(3), T(4)]);
  });

  it("el tope por defecto es 2000", () => {
    expect(GPS_OUTBOX_MAX).toBe(2000);
    let q: QueuedFix[] = [];
    for (let i = 0; i < 2001; i++) q = enqueueFix(q, fix(`2026-09-05T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`));
    expect(q).toHaveLength(2000);
  });
});

describe("orden de reenvío", () => {
  it("por recorded_at, la más vieja primero, venga como venga", () => {
    const q = [fix(T(3)), fix(T(1)), fix(T(2))];
    expect(orderedForFlush(q).map((f) => f.recorded_at)).toEqual([T(1), T(2), T(3)]);
    expect(q[0].recorded_at).toBe(T(3)); // no muta
  });
});

describe("reenvío por lotes", () => {
  const cinco = [fix(T(1)), fix(T(2)), fix(T(3)), fix(T(4)), fix(T(5))];

  it("todo bien: se envía en orden y la cola queda vacía", async () => {
    const lotes: string[][] = [];
    const out = await flushFixes(cinco, async (b) => { lotes.push(b.map((f) => f.recorded_at)); return "ok"; }, 2);
    expect(lotes).toEqual([[T(1), T(2)], [T(3), T(4)], [T(5)]]);
    expect(out).toEqual({ remaining: [], sent: 5, dropped: 0 });
  });

  it("fallo de red a mitad: lo enviado se va, el resto se queda EN ORDEN para la próxima", async () => {
    let n = 0;
    const out = await flushFixes(cinco, async () => (++n === 2 ? "offline" : "ok"), 2);
    expect(out.sent).toBe(2);
    expect(out.remaining.map((f) => f.recorded_at)).toEqual([T(3), T(4), T(5)]);
  });

  it("una excepción del envío cuenta como sin red, no como rechazo", async () => {
    const out = await flushFixes(cinco, async () => { throw new Error("Failed to fetch"); }, 2);
    expect(out).toEqual({ remaining: orderedForFlush(cinco), sent: 0, dropped: 0 });
  });

  it("un rechazo del servidor descarta ese lote y sigue con el siguiente", async () => {
    let n = 0;
    const out = await flushFixes(cinco, async () => (++n === 1 ? "rejected" : "ok"), 2);
    expect(out).toEqual({ remaining: [], sent: 3, dropped: 2 });
  });

  it("cola vacía: no llama a nadie", async () => {
    let llamadas = 0;
    const out = await flushFixes([], async () => { llamadas++; return "ok"; });
    expect(llamadas).toBe(0);
    expect(out).toEqual({ remaining: [], sent: 0, dropped: 0 });
  });
});

describe("almacenamiento", () => {
  it("guarda y lee; una cola vacía quita la clave", () => {
    const s = fakeStorage();
    saveGpsOutbox(s, [fix(T(1))]);
    expect(loadGpsOutbox(s)).toHaveLength(1);
    saveGpsOutbox(s, []);
    expect(s.data[GPS_OUTBOX_KEY]).toBeUndefined();
  });

  it("JSON roto o entradas raras no revientan la app del chofer", () => {
    expect(loadGpsOutbox(fakeStorage({ [GPS_OUTBOX_KEY]: "{nope" }))).toEqual([]);
    expect(loadGpsOutbox(fakeStorage({ [GPS_OUTBOX_KEY]: JSON.stringify([null, { lat: "x" }, fix(T(1))]) }))).toHaveLength(1);
    expect(loadGpsOutbox({ getItem: () => { throw new Error("blocked"); }, setItem() {}, removeItem() {} })).toEqual([]);
  });
});
