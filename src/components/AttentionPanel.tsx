"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { attentionItems, type AttentionKind } from "@/lib/attention";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// The things quietly going wrong, on the screen the office already opens.
//
// Every item here was found by querying the database during a review, not by
// the app saying anything: an order eleven days past its date with no driver,
// stops with no map pin that the optimizer skipped without a word, a delivery
// recorded with no proof of any kind. They were all just sitting there.
//
// Shows nothing at all when there is nothing wrong — a panel that is always
// on screen is a panel nobody reads.
// ============================================================

const STYLE: Record<AttentionKind, { icon: string; color: string; bg: string }> = {
  overdue_unassigned: { icon: "🚨", color: "var(--red)", bg: "#fdeaea" },
  no_fee:             { icon: "💸", color: "var(--red)", bg: "#fdeaea" },
  no_pin:             { icon: "📍", color: "#b9791a", bg: "#fff7ec" },
  no_proof:           { icon: "📋", color: "var(--gray)", bg: "var(--card-hover)" },
};

export function AttentionPanel({ onOpen }: { onOpen?: (d: Delivery) => void }) {
  const { deliveries, settings } = useData();
  const { t } = usePrefs();
  const [dismissed, setDismissed] = useState(false);

  // Missing proof is only a fault when proof was asked for. With both
  // switches off it is exactly what the settings say should happen.
  const proofRequired = settings.require_pod === true || settings.pod_signature_enabled === true;
  const items = useMemo(() => attentionItems(deliveries, undefined, proofRequired), [deliveries, proofRequired]);

  const label: Record<AttentionKind, { title: string; why: string }> = {
    overdue_unassigned: {
      title: t("Past its date with no driver", "Pasada de fecha y sin chofer"),
      why: t("Nobody is going to deliver this until someone assigns it.", "Nadie va a entregar esto hasta que alguien lo asigne."),
    },
    no_fee: {
      title: t("Going out with nothing charged", "Va a salir sin cobrar nada"),
      why: t("Blank or $0 delivery fee. Fix it before it ships — after that it is an invoicing problem.",
             "Tarifa de entrega vacía o en $0. Corríjala antes de que salga — después ya es un problema de facturación."),
    },
    no_pin: {
      title: t("Not on the map", "No está en el mapa"),
      why: t("The route optimizer skips these without saying so — it can be loaded and never routed.", "El optimizador las omite sin avisar — puede cargarse y nunca rutearse."),
    },
    no_proof: {
      title: t("Delivered with no proof", "Entregada sin comprobante"),
      why: t("No name, no signature, no photo, no location. Nothing to show if the customer disputes it.", "Sin nombre, sin firma, sin foto, sin ubicación. Nada que mostrar si el cliente lo reclama."),
    },
  };

  if (!items.length || dismissed) return null;

  const groups = (["overdue_unassigned", "no_fee", "no_pin", "no_proof"] as AttentionKind[])
    .map((kind) => ({ kind, rows: items.filter((i) => i.kind === kind).map((i) => i.delivery) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="card" style={{ borderColor: "var(--amber)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>⚠ {t("Needs attention", "Requiere atención")}</h2>
        <span className="count-tag">{items.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>
          {t("Hide", "Ocultar")}
        </button>
      </div>

      {groups.map(({ kind, rows }) => (
        <div key={kind} style={{ background: STYLE[kind].bg, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: STYLE[kind].color }}>
            {STYLE[kind].icon} {label[kind].title} <span className="count-tag">{rows.length}</span>
          </div>
          <div className="hint" style={{ marginTop: 2 }}>{label[kind].why}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {rows.slice(0, 12).map((d) => (
              <button
                key={d.id}
                className="chip"
                onClick={() => onOpen?.(d)}
                title={[d.account, d.delivery_address, d.delivery_date].filter(Boolean).join(" · ")}
              >
                #{orderLabel(d)}
                {d.delivery_date && <span className="cnt">{d.delivery_date.slice(5)}</span>}
              </button>
            ))}
            {rows.length > 12 && <span className="hint">+{rows.length - 12}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
