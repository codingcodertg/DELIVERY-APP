"use client";

import { use, useEffect, useState } from "react";
import { stageInfo } from "@/lib/constants";
import { fmtDate, fmtWindows } from "@/lib/utils";
import type { Delivery } from "@/lib/types";
import { guardaEncuestaLocal, leeEncuestasLocales, MAX_COMENTARIO, sePuedeCalificar, validaRespuesta } from "@/lib/encuesta";

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
  // La encuesta (D-418): `null` = no se enseña (no está entregada, o la base aún no la tiene).
  const [survey, setSurvey] = useState<{ answered: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (LOCAL_MODE) {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (raw) {
            const store = JSON.parse(raw) as { deliveries: Delivery[] };
            const found = store.deliveries.find((d) => d.id === id) ?? null;
            if (!cancelled) {
              setOrder(found);
              setSurvey(found && sePuedeCalificar(found.stage) ? { answered: leeEncuestasLocales(localStorage).some((f) => f.delivery_id === id) } : null);
            }
            return;
          }
        } catch { /* ignore */ }
        if (!cancelled) setOrder(null);
        return;
      }
      try {
        const res = await fetch(`/api/track/${id}`, { cache: "no-store" });
        const b = await res.json().catch(() => ({}));
        if (!cancelled) {
          setOrder((b.order as TrackOrder | null) ?? null);
          setSurvey((b.survey as { answered: boolean } | null | undefined) ?? null);
        }
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

            {sePuedeCalificar(order.stage) && survey && <Encuesta id={id} answered={survey.answered} />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * La encuesta de satisfacción (D-418, 151): 1-5 estrellas y un comentario opcional, una vez por orden. Sin login: la
 * guarda `/api/track/<id>/survey`, que comprueba todo antes de escribir. En el demo, en este navegador.
 */
function Encuesta({ id, answered }: { id: string; answered: boolean }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(answered ? "done" : "idle");
  const [error, setError] = useState("");

  const send = async () => {
    const v = validaRespuesta({ rating: stars, comment });
    if (!v.ok) { setState("error"); setError(v.error); return; }
    setState("sending");
    if (LOCAL_MODE) {
      guardaEncuestaLocal(localStorage, id, v.respuesta, new Date().toISOString());
      setState("done");
      return;
    }
    try {
      const res = await fetch(`/api/track/${id}/survey`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.respuesta) });
      const b = await res.json().catch(() => ({}));
      if (res.ok || b.already) { setState("done"); return; }
      setState("error");
      setError(typeof b.error === "string" ? b.error : "Something went wrong. Please try again.");
    } catch {
      setState("error");
      setError("Something went wrong. Please try again.");
    }
  };

  if (state === "done") {
    return <div className="card" data-encuesta="gracias" style={{ marginTop: 20 }}><b>Thank you for your feedback!</b></div>;
  }
  return (
    <div className="card" data-encuesta="formulario" style={{ marginTop: 20 }}>
      <b>How was your delivery?</b>
      <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 4, margin: "10px 0" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} data-estrella={n}
            onClick={() => setStars(n)}
            style={{ fontSize: 30, lineHeight: 1, background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: n <= stars ? "var(--amber)" : "var(--line)" }}>
            ★
          </button>
        ))}
      </div>
      <textarea value={comment} maxLength={MAX_COMENTARIO} rows={3} placeholder="Anything you'd like to tell us? (optional)"
        onChange={(e) => setComment(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      {state === "error" && <div className="hint" style={{ color: "var(--red)" }}>{error}</div>}
      <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={stars === 0 || state === "sending"} onClick={() => void send()}>
        {state === "sending" ? "Sending…" : "Send"}
      </button>
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
