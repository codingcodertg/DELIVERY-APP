import type { DriverShift } from "@/lib/types";

// ============================================================
// Shift outbox — clock in / clock out tapped where there is no signal (G-8, D-NEXT).
//
// `clockOut` used to fail loudly in a dead zone: the driver saw a red toast, the
// shift stayed open in the database and, worse, the GPS service kept reporting
// (LocationTracker follows the open shift). Owner's decision: the punch QUEUES.
//
// This is its own small queue rather than the milestone outbox (src/lib/outbox.ts,
// typed around deliveries) or the GPS one (fixes): a punch is a third shape, and
// the milestone outbox is deliberately narrow. What it shares with them is the
// pattern — localStorage, replay in order, stop at "still offline", drop what the
// server refuses.
//
// The overlay is the point: a queued "out" marks the open shift as ended LOCALLY
// the moment the driver taps, so the GPS stops right then (not when the network
// comes back); a queued "in" shows a local open shift so the day can start.
// Replay writes the timestamp the driver tapped, not the replay time.
//
// Pure: no React, no window.
// ============================================================

export const SHIFT_OUTBOX_KEY = "rtg_shift_outbox_v1";

export interface ShiftOp {
  /** Local id, so a replayed op can be removed without touching the others. */
  id: string;
  kind: "in" | "out";
  driverId: string;
  /** When the driver actually tapped — NOT when it reached the server. */
  at: string;
  /** The phone that tapped (device-id.ts); a queued "in" carries it to the row. */
  deviceId: string | null;
}

/** Append, keeping order. Does not mutate. */
export function enqueueShiftOp(items: ShiftOp[], op: ShiftOp): ShiftOp[] {
  return [...items, op];
}

/**
 * What the driver sees while the queue is waiting: queued ops applied over the server's
 * shifts, in the order they were tapped. "in" adds a local open shift (id `local-…`); "out"
 * closes that driver's open shift, real or local. A stray "out" with nothing open is ignored.
 */
export function applyShiftOutbox(shifts: DriverShift[], items: ShiftOp[]): DriverShift[] {
  if (!items.length) return shifts;
  let out = [...shifts];
  for (const op of [...items].sort((a, b) => a.at.localeCompare(b.at))) {
    if (op.kind === "in") {
      if (out.some((s) => s.driver_id === op.driverId && !s.ended_at)) continue; // already open
      out = [{ id: `local-${op.id}`, driver_id: op.driverId, started_at: op.at, ended_at: null, note: null, device_id: op.deviceId } as DriverShift, ...out];
    } else {
      out = out.map((s) => (s.driver_id === op.driverId && !s.ended_at ? { ...s, ended_at: op.at } : s));
    }
  }
  return out;
}

export type ApplyResult = "ok" | "offline" | "rejected";

/**
 * Replay in tap order. `apply` writes one op and says what happened: "ok" removes it,
 * "offline" stops here and keeps this and the rest, "rejected" drops it (retrying never helps).
 */
export async function flushShiftOps(
  items: ShiftOp[],
  apply: (op: ShiftOp) => Promise<ApplyResult>,
): Promise<{ remaining: ShiftOp[]; sent: number; dropped: number }> {
  const ordered = [...items].sort((a, b) => a.at.localeCompare(b.at));
  let sent = 0;
  let dropped = 0;
  let i = 0;
  for (; i < ordered.length; i++) {
    let r: ApplyResult;
    try { r = await apply(ordered[i]); } catch { r = "offline"; }
    if (r === "offline") break;
    if (r === "ok") sent++; else dropped++;
  }
  return { remaining: ordered.slice(i), sent, dropped };
}

// ---- storage ------------------------------------------------------------------------------

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const isOp = (x: unknown): x is ShiftOp =>
  !!x && typeof x === "object"
  && typeof (x as ShiftOp).id === "string" && ((x as ShiftOp).kind === "in" || (x as ShiftOp).kind === "out")
  && typeof (x as ShiftOp).driverId === "string" && typeof (x as ShiftOp).at === "string";

export function loadShiftOutbox(storage: StorageLike): ShiftOp[] {
  try {
    const raw = storage.getItem(SHIFT_OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOp) : [];
  } catch { return []; }
}

export function saveShiftOutbox(storage: StorageLike, items: ShiftOp[]): void {
  try {
    if (items.length) storage.setItem(SHIFT_OUTBOX_KEY, JSON.stringify(items));
    else storage.removeItem(SHIFT_OUTBOX_KEY);
  } catch { /* storage full or blocked — the in-memory copy still works this session */ }
}
