import type { Profile, Stage } from "@/lib/types";

// ============================================================
// Role-targeted, in-app notifications.
//
// A stage transition fans out to the people who need to act next:
//   → pending    managers          "an order needs approval"
//   → approved   warehouse + sales "approved — fulfill it" / "your order was approved"
//   → rejected   sales             "your order was rejected (reason)"
//   → ready      sales             "your order is ready"
//   → delivered  sales             "your order was delivered"
//
// The same logic drives both the Supabase and local providers, so the
// two stay in lock-step. The actor is never notified about their own action.
// ============================================================

export interface AppNotification {
  id: string;
  user_id: string;          // recipient
  delivery_id: string | null;
  order_no: number | null;
  kind: string;             // pending / approved / rejected / ready / delivered
  message: string;
  read: boolean;
  created_at: string;
}

/** A notification about to be created (id/read/created_at supplied by the store). */
export type NotifSeed = Pick<AppNotification, "user_id" | "delivery_id" | "order_no" | "kind" | "message">;

export function notificationsForStage(args: {
  stage: Stage;
  order_no: number | null;
  order_code?: string | null;
  delivery_id: string | null;
  creatorId: string | null;
  actorId: string | null;
  users: Profile[];
  reason?: string | null;
}): NotifSeed[] {
  const { stage, order_no, order_code, delivery_id, creatorId, actorId, users, reason } = args;
  const seeds: NotifSeed[] = [];
  const label = order_code ? `#${order_code}` : (order_no != null ? `#${order_no}` : "");

  const push = (userId: string | null | undefined, kind: string, message: string) => {
    if (!userId || userId === actorId) return;          // never notify the actor
    if (seeds.some((s) => s.user_id === userId && s.kind === kind)) return; // de-dupe
    seeds.push({ user_id: userId, delivery_id, order_no, kind, message });
  };

  const withRole = (role: Profile["role"]) => users.filter((u) => u.role === role);

  switch (stage) {
    case "pending":
      for (const m of withRole("manager")) push(m.id, "pending", `Order ${label} is awaiting your approval`);
      break;
    case "approved":
      for (const w of withRole("warehouse")) push(w.id, "approved", `Order ${label} was approved — ready to prepare`);
      push(creatorId, "approved", `Your order ${label} was approved`);
      break;
    case "rejected":
      push(creatorId, "rejected", `Your order ${label} was rejected${reason ? `: ${reason}` : ""}`);
      break;
    case "ready":
      push(creatorId, "ready", `Order ${label} is ready for delivery`);
      break;
    case "picked_up":
      push(creatorId, "picked_up", `Order ${label} was picked up — out for delivery`);
      break;
    case "delivered":
      push(creatorId, "delivered", `Order ${label} was delivered`);
      break;
    default:
      break;
  }
  return seeds;
}

// ---- Assignment ------------------------------------------------------------
// Stage changes tell people an order MOVED. Being handed the work is a
// different event entirely, and it was the one nobody was told about: a
// dispatcher could build a driver's whole day and the driver would only find
// out by opening the app and looking.

/** The kind used for "a stop was assigned to you". */
export const ASSIGNED_KIND = "assigned";

/**
 * El aviso de que una solicitud de ayuda ya está atendida (D-301).
 *
 * Vive aquí, con el otro `kind`, porque el vocabulario de la campana es de la campana: quien pinta el
 * punto (`NotificationBell`) necesita la clave sin tener que saber nada de solicitudes de ayuda.
 */
export const AYUDA_ATENDIDA_KIND = "ayuda_atendida";

/**
 * Tell a driver a stop is theirs.
 *
 * Returns null when there's nobody to tell — an unassignment, a driver name
 * that doesn't match a real user (Routes Manager allows temporary lanes), or
 * the driver assigning it to themselves, which happens when they claim an
 * unowned order at pickup.
 */
export function assignmentNotification(args: {
  driverName: string | null | undefined;
  order_no: number | null;
  order_code?: string | null;
  delivery_id: string | null;
  delivery_date?: string | null;
  users: Profile[];
  actorId: string | null;
}): NotifSeed | null {
  const { driverName, order_no, order_code, delivery_id, delivery_date, users, actorId } = args;
  if (!driverName) return null;
  const driver = users.find((u) => u.role === "driver" && u.full_name === driverName);
  if (!driver || driver.id === actorId) return null;
  const label = order_code ? `#${order_code}` : (order_no != null ? `#${order_no}` : "");
  const when = delivery_date ? ` for ${delivery_date}` : "";
  return {
    user_id: driver.id,
    delivery_id,
    order_no,
    kind: ASSIGNED_KIND,
    message: `Stop ${label} was assigned to you${when}`,
  };
}
