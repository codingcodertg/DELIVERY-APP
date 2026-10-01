"use client";

import { useState } from "react";
import { stageInfo, stageLabel } from "@/lib/constants";
import { fmtWindows } from "@/lib/utils";
import { facturaYId } from "@/lib/route-plan/etiqueta";
import type { Delivery } from "@/lib/types";

export interface BoardColumn {
  /** "__unassigned__" for the pool, otherwise the driver's full name. */
  key: string;
  title: string;
  color: string;
  orders: Delivery[];
  /** Small right-aligned note in the header, e.g. a pallet load. */
  sub?: string;
}

/** A Trello-style dispatch board: an Unassigned column plus one per driver.
 * Drag an order card between columns to (re)assign or unassign it. Uses native
 * HTML5 drag-and-drop — no dependencies. */
export function DispatchBoard({
  columns, onMove, t, lang, onPrint,
}: {
  columns: BoardColumn[];
  onMove: (orderId: string, columnKey: string) => void;
  t: (en: string, es: string) => string;
  lang: "en" | "es";
  /** When set, driver columns show a 🖨 button that prints their route. */
  onPrint?: (columnKey: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="dboard">
      {columns.map((col) => (
        <div
          key={col.key}
          className={"dboard-col" + (over === col.key ? " over" : "")}
          onDragOver={(e) => { e.preventDefault(); if (over !== col.key) setOver(col.key); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((k) => (k === col.key ? null : k)); }}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain") || dragId;
            setOver(null);
            setDragId(null);
            if (id) onMove(id, col.key);
          }}
        >
          <div className="dboard-head">
            <span className="dboard-dot" style={{ background: col.color }} />
            <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.title}</b>
            <span className="count-tag">{col.orders.length}</span>
            {col.sub && <span className="hint" style={{ marginLeft: "auto" }}>{col.sub}</span>}
            {onPrint && col.key !== "__unassigned__" && col.orders.length > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: col.sub ? 6 : "auto", padding: "2px 7px", lineHeight: 1 }}
                title={t("Print this route", "Imprimir esta ruta")}
                onClick={(e) => { e.stopPropagation(); onPrint(col.key); }}
              >🖨</button>
            )}
          </div>
          <div className="dboard-body">
            {col.orders.length === 0 ? (
              <div className="dboard-empty">{t("Drop orders here", "Suelte órdenes aquí")}</div>
            ) : col.orders.map((d) => (
              <div
                key={d.id}
                className={"dboard-card" + (dragId === d.id ? " dragging" : "")}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; setDragId(d.id); }}
                onDragEnd={() => { setDragId(null); setOver(null); }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                  {/* D-456: la factura primero y el ID al lado; sin factura, el ID en gris. */}
                  {(() => { const n = facturaYId(d); return (
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <b className="ordno" data-factura={n.esFactura ? "" : undefined} style={n.esFactura ? undefined : { color: "var(--gray)" }}>{n.principal}</b>
                      {n.id && <span className="hint" data-id-de-la-orden style={{ margin: "0 0 0 6px", fontSize: 11 }}>{n.id}</span>}
                    </span>
                  ); })()}
                  <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
                </div>
                <div style={{ fontSize: 13, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.account || t("(no account)", "(sin cuenta)")}
                </div>
                <div className="hint" style={{ marginTop: 2 }}>
                  {(d.actual_pallets ?? d.est_pallets ?? "—")} {t("pallets", "pallets")}{d.delivery_windows ? ` · ${fmtWindows(d.delivery_windows)}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
