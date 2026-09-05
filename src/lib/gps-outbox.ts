// ============================================================
// GPS outbox — position fixes captured where there is no signal (G-22, D-NEXT).
//
// `pushLocation` used to INSERT and, on failure, return false: the fix was gone.
// The milestone outbox (src/lib/outbox.ts) is deliberately narrow — only the
// driver's picked-up / delivered — and stays that way; this is a SEPARATE queue
// under its own key, because fixes are many, small and disposable, and mixing
// them with milestones would make both harder to reason about.
//
// Each fix keeps the recorded_at the DEVICE stamped (not when it reached the
// server) and the id of the phone that captured it. Replay is in recorded_at
// order, stops at the first "still offline", drops what the server rejects
// (a rejection never succeeds on retry), and the queue has a hard cap so a
// phone in a dead zone all afternoon does not grow storage without a ceiling:
// beyond the cap the OLDEST fixes are dropped — a trail with a hole at the
// start is worth more than no trail, and the newest fix is the one the map
// needs.
//
// Pure: no React, no window. Storage access takes the Storage as a parameter so
// it can be tested with a fake.
// ============================================================

export const GPS_OUTBOX_KEY = "rtg_gps_outbox_v1";
/** Hard cap. ~170 fixes/day per driver (location-filter.ts) means this holds well over a week. */
export const GPS_OUTBOX_MAX = 2000;
/** Fixes per INSERT when replaying. */
export const GPS_FLUSH_BATCH = 200;

export interface QueuedFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  battery_pct: number | null;
  /** When the DEVICE took the fix — the queue never rewrites it. */
  recorded_at: string;
  /** Which phone captured it (device-id.ts). driver_locations has no such column
   * today, so it does not travel; it is kept for diagnostics and so a replay can
   * refuse fixes that are not this install's. */
  device_id: string | null;
}

/** Append one fix, keeping the queue under `max` by dropping the OLDEST. Does not mutate. */
export function enqueueFix(items: QueuedFix[], fix: QueuedFix, max: number = GPS_OUTBOX_MAX): QueuedFix[] {
  const next = [...items, fix];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Replay order: by recorded_at, oldest first, so the trail is written the way it was driven. */
export function orderedForFlush(items: QueuedFix[]): QueuedFix[] {
  return [...items].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

export type SendResult = "ok" | "offline" | "rejected";

/**
 * Replay in order, in batches. `send` writes one batch and says what happened:
 *  - "ok"       → batch is gone from the queue
 *  - "offline"  → stop here; this batch and everything after it stays queued
 *  - "rejected" → the server said no; the batch is dropped (retrying never helps)
 */
export async function flushFixes(
  items: QueuedFix[],
  send: (batch: QueuedFix[]) => Promise<SendResult>,
  batchSize: number = GPS_FLUSH_BATCH,
): Promise<{ remaining: QueuedFix[]; sent: number; dropped: number }> {
  const ordered = orderedForFlush(items);
  let sent = 0;
  let dropped = 0;
  let i = 0;
  while (i < ordered.length) {
    const batch = ordered.slice(i, i + batchSize);
    let r: SendResult;
    try { r = await send(batch); } catch { r = "offline"; }
    if (r === "offline") break;
    if (r === "ok") sent += batch.length; else dropped += batch.length;
    i += batch.length;
  }
  return { remaining: ordered.slice(i), sent, dropped };
}

// ---- storage ------------------------------------------------------------------------------

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const isFix = (x: unknown): x is QueuedFix =>
  !!x && typeof x === "object"
  && typeof (x as QueuedFix).lat === "number" && typeof (x as QueuedFix).lng === "number"
  && typeof (x as QueuedFix).recorded_at === "string";

/** Never throws: a corrupt queue must not brick the driver's app. */
export function loadGpsOutbox(storage: StorageLike): QueuedFix[] {
  try {
    const raw = storage.getItem(GPS_OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isFix) : [];
  } catch { return []; }
}

/** Never throws; an empty queue removes the key instead of leaving `[]` behind. */
export function saveGpsOutbox(storage: StorageLike, items: QueuedFix[]): void {
  try {
    if (items.length) storage.setItem(GPS_OUTBOX_KEY, JSON.stringify(items));
    else storage.removeItem(GPS_OUTBOX_KEY);
  } catch { /* storage full or blocked — the in-memory copy still works this session */ }
}
