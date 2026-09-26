import type { Delivery, Stage } from "@/lib/types";

// ============================================================
// Outbox — deliveries completed where there's no signal.
//
// The Valley has dead zones, and a driver who marks a stop delivered in one
// used to lose it: the write failed, a red toast appeared, and if they'd
// already pulled away the work was simply gone.
//
// So a milestone that can't reach the server is written HERE instead —
// localStorage, so it survives the app being killed — and replayed the moment
// there's a connection. Until then it's layered over the server's copy, so the
// driver sees the stop as done and doesn't try to complete it twice.
//
// Deliberately narrow: only the driver's milestones (picked up / delivered)
// queue. Everything else still fails loudly, because a rep editing an order or
// an admin changing settings can see the error and retry — a driver at a
// tailgate can't.
// ============================================================

export const OUTBOX_KEY = "rtg_outbox_v1";

export interface OutboxItem {
  /** Local id, so a replay can be removed without touching the others. */
  id: string;
  deliveryId: string;
  /** The stage this milestone moves the order to. */
  stage: Stage;
  /** Columns written alongside the stage (POD, GPS, pallet count…). */
  patch: Partial<Delivery>;
  /** Audit note, replayed with the stage change. */
  note?: string;
  /** The event kind when it is not the stage itself («received», «dropped_at_store»). Replayed as-is. */
  kind?: string;
  /** When the driver actually did it — NOT when it reached the server. */
  at: string;
  /** Failed replays, so a permanently broken item can be spotted. */
  tries: number;
}

/**
 * Is this failure "no signal" rather than "the server said no"?
 *
 * The distinction matters: a network drop should be retried forever, but a
 * rejection (no permission, illegal transition) never will succeed, and
 * queueing it would hide a real problem behind a spinner that never resolves.
 */
export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = (
    typeof err === "string" ? err
    : err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message)
    : ""
  ).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||          // Safari's wording
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

export function loadOutbox(): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    // A corrupt queue must not brick the app — better to lose the queue than
    // to leave a driver staring at a broken screen.
    return [];
  }
}

export function saveOutbox(items: OutboxItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked — the in-memory copy still works this session */
  }
}

/**
 * Layer queued milestones over the server's rows.
 *
 * Applied newest-last so that if a driver picked up AND delivered the same
 * order while offline, the row ends up delivered rather than flickering back.
 */
export function applyOutbox(deliveries: Delivery[], items: OutboxItem[]): Delivery[] {
  if (!items.length) return deliveries;
  const byDelivery = new Map<string, OutboxItem[]>();
  for (const it of items) {
    const list = byDelivery.get(it.deliveryId) ?? [];
    list.push(it);
    byDelivery.set(it.deliveryId, list);
  }
  return deliveries.map((d) => {
    const queued = byDelivery.get(d.id);
    if (!queued) return d;
    let out = d;
    for (const it of [...queued].sort((a, b) => a.at.localeCompare(b.at))) {
      out = { ...out, ...it.patch, stage: it.stage };
    }
    return out;
  });
}

/** Ids with something still waiting to be sent — drives the "pending" mark. */
export function pendingIds(items: OutboxItem[]): Set<string> {
  return new Set(items.map((i) => i.deliveryId));
}
