"use client";

import { useMemo, useState } from "react";
import { SecurityLog } from "@/components/SecurityLog";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { fmtDateTime, orderLabel } from "@/lib/utils";

// ============================================================
// Audit log — a read-only, searchable feed of every recorded order event
// (creation, stage transitions, notes) across all orders. Managers/admins use
// it to answer "who did what, when" without opening each order.
// ============================================================

function actionLabel(kind: string, lang: "en" | "es"): string {
  if (kind === "created") return lang === "es" ? "Creada" : "Created";
  if (kind === "edited") return lang === "es" ? "Editada" : "Edited";
  if (kind === "note") return lang === "es" ? "Nota" : "Note";
  const s = stageInfo(kind);
  return s.key === kind ? stageLabel(kind, lang) : kind;
}

export default function AuditPage() {
  const { me, events, deliveries, users, ready } = useData();
  const { lang, t } = usePrefs();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");

  const codeById = useMemo(() => new Map(deliveries.map((d) => [d.id, orderLabel(d)])), [deliveries]);
  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name])), [users]);

  const kinds = useMemo(() => Array.from(new Set(events.map((e) => e.kind))).sort(), [events]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events
      .filter((e) => (kind === "all" || e.kind === kind))
      .map((e) => ({
        id: e.id,
        delivery_id: e.delivery_id,
        label: codeById.get(e.delivery_id) ?? null,
        kind: e.kind,
        by: e.created_by ? nameById.get(e.created_by) ?? "—" : t("system", "sistema"),
        at: e.created_at,
        note: e.note,
      }))
      .filter((r) => {
        if (!needle) return true;
        return (
          String(r.label ?? "").toLowerCase().includes(needle) ||
          actionLabel(r.kind, lang).toLowerCase().includes(needle) ||
          (r.by || "").toLowerCase().includes(needle) ||
          (r.note || "").toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [events, kind, q, codeById, nameById, lang, t]);

  if (!me) return null;
  if (me.role !== "admin" && me.role !== "manager") {
    return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;
  }

  return (
    <>
      {/* The provider keeps a bounded window of order history in memory (EVENTS_WINDOW),
          so this feed can be showing less than everything. Say so rather than let a search
          come back empty and look like the event never happened. */}
      {events.length >= 1000 && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {t(
            "Showing the most recent 1,000 events. Older activity exists but is not searched here.",
            "Mostrando los 1.000 eventos más recientes. Hay actividad más antigua que no se busca aquí."
          )}
        </div>
      )}
      <div className="page-head">
        <h2>{t("Audit log", "Registro de auditoría")} <span className="count-tag">{rows.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder={t("Search order / action / person / note…", "Buscar orden / acción / persona / nota…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: "auto" }}>
            <option value="all">{t("All actions", "Todas las acciones")}</option>
            {kinds.map((k) => <option key={k} value={k}>{actionLabel(k, lang)}</option>)}
          </select>
        </div>
      </div>

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{t("No activity recorded yet.", "Aún no hay actividad registrada.")}</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>{t("When", "Cuándo")}</th>
                  <th>{t("Order", "Orden")}</th>
                  <th>{t("Action", "Acción")}</th>
                  <th>{t("By", "Por")}</th>
                  <th>{t("Note", "Nota")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={r.label ? "clickable" : ""}
                    onClick={() => r.label && router.push(`/?order=${r.delivery_id}`)}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.at)}</td>
                    <td className="ordno">{r.label ? `#${r.label}` : "—"}</td>
                    <td><span className="sema" style={{ background: stageInfo(r.kind).color, color: "#fff" }}>{actionLabel(r.kind, lang)}</span></td>
                    <td>{r.by}</td>
                    <td style={{ color: "var(--gray)" }}>{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    
      {/* Order history is above; this is the other kind of "who did what" —
          who changed someone's access. Admin-only, and it renders nothing for
          anyone else. */}
      <SecurityLog />
    </>
  );
}
