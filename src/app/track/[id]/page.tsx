"use client";

import { use, useEffect, useState } from "react";
import { stageInfo } from "@/lib/constants";
import { fmtDate, fmtWindows } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// Public, read-only delivery tracking page (#25). A customer opens
// /track/<order-id> to see their delivery's status — no login.
//
// Local demo mode reads the browser's localStorage store. In Supabase mode it
// calls /api/track/<id>, which returns ONLY the non-sensitive status fields
// (via the service-role client, server-side).
// ============================================================

const LS_KEY = "rtg_deliveries_local_v13";
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// Only the fields the public page shows.
type TrackOrder = Pick<
  Delivery,
  "order_no" | "order_code" | "stage" | "account" | "delivery_date" | "delivery_windows" | "delivery_address" | "assigned_driver" | "pod_received_by"
>;

// The public-facing journey (internal-only stages are collapsed out).
const PUBLIC_FLOW = ["approved", "fulfilling", "ready", "picked_up", "delivered"] as const;

// Customer-friendly labels (hide internal wording like "Picked Up").
const PUBLIC_LABEL: Record<string, string> = {
  approved: "Order confirmed",
  fulfilling: "Being prepared",
  ready: "Ready to go",
  picked_up: "Out for delivery",
  delivered: "Delivered",
};
const publicLabel = (stage: string) => PUBLIC_LABEL[stage] ?? stageInfo(stage).label;

export default function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15 passes route params as a promise. A client component cannot be async, so it
  // unwraps with React.use() instead of await.
  const { id } = use(params);
  const [order, setOrder] = useState<TrackOrder | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (LOCAL_MODE) {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (raw) {
            const store = JSON.parse(raw) as { deliveries: Delivery[] };
            if (!cancelled) setOrder(store.deliveries.find((d) => d.id === id) ?? null);
            return;
          }
        } catch { /* ignore */ }
        if (!cancelled) setOrder(null);
        return;
      }
      try {
        const res = await fetch(`/api/track/${id}`, { cache: "no-store" });
        const b = await res.json().catch(() => ({}));
        if (!cancelled) setOrder((b.order as TrackOrder | null) ?? null);
      } catch {
        if (!cancelled) setOrder(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const currentIdx = order ? PUBLIC_FLOW.indexOf(order.stage as (typeof PUBLIC_FLOW)[number]) : -1;

  return (
    <div className="auth-wrap" style={{ alignItems: "flex-start", paddingTop: 60 }}>
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <h1>RDZ<span>·</span>Tracking</h1>
        <p className="hint" style={{ marginBottom: 20 }}>Live status of your delivery</p>

        {order === undefined && <div className="empty">Loading…</div>}
        {order === null && <div className="empty">We couldn’t find that delivery. Please check your link.</div>}

        {order && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: "Archivo, sans-serif", fontWeight: 800, fontSize: 24 }}>#{order.order_code || order.order_no}</div>
                {order.account && <div className="hint">{order.account}</div>}
              </div>
              <span className="sema" style={{ background: stageInfo(order.stage).color, color: "#fff", fontSize: 13 }}>
                {publicLabel(order.stage)}
              </span>
            </div>

            {order.stage === "canceled" || order.stage === "rejected" ? (
              <div className="card" style={{ background: "#fef6f6", borderColor: "var(--red)" }}>
                This order is not currently scheduled for delivery. Please contact us for details.
              </div>
            ) : (
              <div className="track-flow">
                {PUBLIC_FLOW.map((stage, i) => {
                  const info = stageInfo(stage);
                  const done = currentIdx >= 0 && i <= currentIdx;
                  return (
                    <div key={stage} className={"track-step " + (done ? "done" : "")}>
                      <span className="track-dot" style={{ background: done ? info.color : "var(--line)" }}>{done ? "✓" : ""}</span>
                      <span className="track-label">{publicLabel(stage)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              {order.delivery_date && <Row k="Delivery date" v={fmtDate(order.delivery_date)} />}
              {order.delivery_windows && <Row k="Time window" v={fmtWindows(order.delivery_windows)} />}
              {order.delivery_address && <Row k="Delivery to" v={order.delivery_address} />}
              {order.assigned_driver && <Row k="Driver" v={order.assigned_driver} />}
              {order.pod_received_by && <Row k="Received by" v={order.pod_received_by} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="detail-row">
      <span className="dk">{k}</span>
      <span className="dv">{v}</span>
    </div>
  );
}
