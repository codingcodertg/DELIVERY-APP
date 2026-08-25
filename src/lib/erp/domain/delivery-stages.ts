// Delivery workflow stages — ported verbatim from deliveries-app's own source of truth (ADR 0010).
// Framework-free, matching lib/domain's contract (ADR 0006).
//
// The keys are the values already stored in deliveries.deliveries.stage for the 77 migrated orders,
// so these are not names chosen here — changing one renames nothing in the database, it just stops
// matching it. Labels differ from keys on purpose in three places the business named differently
// ("approved" shows as Programmed, "fulfilling" as Preparing); that mapping came across as-is.

export const DELIVERY_STAGES = [
  { key: "draft", label: "Draft", color: "#6b7686", group: "sales" },
  { key: "pending", label: "Pending Approval", color: "#e9a13b", group: "approval" },
  { key: "rejected", label: "Rejected", color: "#d64545", group: "approval" },
  { key: "approved", label: "Programmed", color: "#2456c9", group: "warehouse" },
  { key: "fulfilling", label: "Preparing", color: "#7c4dbc", group: "warehouse" },
  { key: "ready", label: "Ready", color: "#0f8a8a", group: "warehouse" },
  { key: "picked_up", label: "Picked Up", color: "#d1782e", group: "warehouse" },
  { key: "delivered", label: "Delivered", color: "#1f9d61", group: "done" },
  { key: "canceled", label: "Canceled", color: "#9aa3b0", group: "done" },
] as const;

export type DeliveryStage = (typeof DELIVERY_STAGES)[number]["key"];
export type DeliveryStageInfo = (typeof DELIVERY_STAGES)[number];

export function stageInfo(key: string): DeliveryStageInfo {
  return DELIVERY_STAGES.find((s) => s.key === key) ?? DELIVERY_STAGES[0];
}

/**
 * Which stage chips a role sees, in display order. Ported from ROLE_FILTER_STAGES.
 *
 * Warehouse deliberately sees a shorter list — the stages it actually acts on — rather than every
 * stage greyed out. A role not listed here (admin, logistics) gets all of them in canonical order.
 */
const ROLE_FILTER_STAGES: Record<string, DeliveryStage[]> = {
  warehouse: ["approved", "ready", "fulfilling", "picked_up", "delivered"],
  sales: ["pending", "draft", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"],
  manager: ["pending", "draft", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"],
  accounting: ["pending", "draft", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"],
  driver: ["ready", "picked_up", "delivered", "pending", "fulfilling"],
};

export function filterStagesFor(role: string | null | undefined): DeliveryStage[] {
  return (role && ROLE_FILTER_STAGES[role]) || DELIVERY_STAGES.map((s) => s.key);
}

/** Human order id. deliveries-app shows order_code ("FA100") and keeps order_no internal. */
export function orderLabel(o: { order_code?: string | null; order_no?: number | null }): string {
  return o.order_code || (o.order_no != null ? `#${o.order_no}` : "—");
}
