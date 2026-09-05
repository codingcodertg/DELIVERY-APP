"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { roleLabel, stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModal";
import { driverKpis, driverQualityKpis } from "@/lib/analytics";
import { fmtDate, fmtMoney, isOverdue, orderLabel, orderOwner, shiftDateISO, todayISO, yesterdayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// Matches the Routes Manager / Dashboard default when a driver has no capacity set.
const DEFAULT_CAPACITY = 12;

// ============================================================
// "Summary" — every signed-in user gets this, whatever their role.
// A quick look at their own work: orders they logged, or runs assigned to
// them if they're a driver, plus the most recent ones.
// ============================================================

export default function SummaryPage() {
  const { me, users, deliveries, settings, ensureDeliveriesSince } = useData();
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // Admins can pull up any one person's numbers; everyone else only ever sees
  // their own. Empty = me.
  const [viewUserId, setViewUserId] = useState("");

  // Whose work the page is reporting on.
  const subject = useMemo(
    () => (me?.role === "admin" && viewUserId ? users.find((u) => u.id === viewUserId) ?? me : me),
    [me, users, viewUserId],
  );
  const isSelf = !!subject && !!me && subject.id === me.id;

  // A driver's work is what's assigned to them; a sales rep's is what they
  // own (theirs, plus anything an office/admin/driver assigned to them);
  // everyone else's is what they personally logged.
  const mine = useMemo(() => {
    if (!subject) return [];
    // A driver's summary is only yesterday + today.
    if (subject.role === "driver") {
      const days = new Set([todayISO(), yesterdayISO()]);
      return deliveries.filter((d) => (d.assigned_driver === subject.full_name || d.created_by === subject.id) && d.delivery_date != null && days.has(d.delivery_date));
    }
    if (subject.role === "sales") return deliveries.filter((d) => orderOwner(d) === subject.id);
    return deliveries.filter((d) => d.created_by === subject.id);
  }, [deliveries, subject]);

  const stats = useMemo(() => {
    const active = mine.filter((d) => !["delivered", "canceled", "rejected"].includes(d.stage));
    return {
      total: mine.length,
      active: active.length,
      delivered: mine.filter((d) => d.stage === "delivered").length,
      overdue: mine.filter(isOverdue).length,
      fees: Math.round(mine.filter((d) => d.stage !== "canceled").reduce((s, d) => s + (d.delivery_fee ?? 0), 0) * 100) / 100,
    };
  }, [mine]);

  const recent = useMemo(() => [...mine].sort((a, b) => b.order_no - a.order_no).slice(0, 8), [mine]);

  // ---- Driver performance ----
  // The card above is deliberately just yesterday+today (what's on the truck
  // now). Performance needs a longer look-back to mean anything, so it runs
  // over its own window across every run assigned to this driver.
  const [days, setDays] = useState(30);
  // G-16: ask for older orders when the chosen span reaches past the provider's window.
  useEffect(() => { void ensureDeliveriesSince(shiftDateISO(todayISO(), -days)); }, [days, ensureDeliveriesSince]);
  const perf = useMemo(() => {
    if (subject?.role !== "driver") return null;
    const from = shiftDateISO(todayISO(), -days);
    const runs = deliveries.filter(
      (d) => d.assigned_driver === subject.full_name && d.delivery_date != null && d.delivery_date >= from && d.delivery_date <= todayISO(),
    );
    if (!runs.length) return { empty: true as const };
    const capacityOf = (n: string) => settings.driver_capacity?.[n] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
    const k = driverKpis(runs, capacityOf, {
      fuelPrice: settings.fuel_price, mpg: settings.fleet_mpg, base: settings.cost_per_delivery,
    })[0];
    const q = driverQualityKpis(runs)[0];
    return k ? { empty: false as const, k, q } : { empty: true as const };
  }, [subject, deliveries, days, settings]);

  if (!me) return null;

  return (
    <>
      <div className="page-head">
        <h2>{t("Summary", "Resumen")}</h2>
        {/* Admin-only: report on any one person instead of yourself. */}
        {me.role === "admin" && (
          <select value={viewUserId} onChange={(e) => setViewUserId(e.target.value)} style={{ width: "auto", maxWidth: 260 }} title={t("Whose numbers to show", "De quién mostrar los números")}>
            <option value="">👤 {t("Me", "Yo")} ({me.full_name})</option>
            {[...users]
              .filter((u) => u.id !== me.id)
              .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""))
              .map((u) => <option key={u.id} value={u.id}>{u.full_name} — {roleLabel(u.role, lang)}</option>)}
          </select>
        )}
      </div>

      {/* ---------- Their numbers ---------- */}
      <div className="card">
        <h2>
          📊 {subject?.role === "driver"
            ? (isSelf ? t("My deliveries", "Mis entregas") : t(`${subject.full_name} — deliveries`, `${subject.full_name} — entregas`))
            : (isSelf ? t("My orders", "Mis órdenes") : t(`${subject?.full_name} — orders`, `${subject?.full_name} — órdenes`))}
        </h2>
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <div className="kpi"><b>{stats.total}</b><span>{t("Total", "Total")}</span></div>
          <div className="kpi"><b style={{ color: "var(--accent)" }}>{stats.active}</b><span>{t("In progress", "En curso")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)" }}>{stats.delivered}</b><span>{t("Delivered", "Entregadas")}</span></div>
          <div className="kpi"><b style={{ color: stats.overdue ? "var(--red)" : undefined }}>{stats.overdue}</b><span>{t("Overdue", "Atrasadas")}</span></div>
          {subject?.role !== "driver" && (
            <div className="kpi"><b style={{ color: "var(--green)", fontSize: 17 }}>{fmtMoney(stats.fees)}</b><span>{t("Fees charged", "Cobros")}</span></div>
          )}
        </div>
      </div>

      {/* ---------- Driver performance ---------- */}
      {perf && (
        <div className="card">
          <div className="page-head" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>🚚 {isSelf ? t("My performance", "Mi desempeño") : t("Performance", "Desempeño")}</h2>
            <div className="viewtoggle">
              {[7, 30, 90].map((n) => (
                <button key={n} className={"vt " + (days === n ? "on" : "")} onClick={() => setDays(n)}>
                  {n} {t("days", "días")}
                </button>
              ))}
            </div>
          </div>
          {perf.empty ? (
            <div className="empty">{t("No runs in this period.", "Sin viajes en este periodo.")}</div>
          ) : (
            <>
              <div className="kpi-grid" style={{ marginBottom: 0 }}>
                <div className="kpi"><b style={{ color: "var(--green)" }}>{perf.k.delivered}</b><span>{t("Delivered", "Entregadas")}</span></div>
                <div className="kpi">
                  <b style={{ color: perf.k.onTimePct == null ? undefined : perf.k.onTimePct >= 90 ? "var(--green)" : perf.k.onTimePct >= 75 ? "var(--amber)" : "var(--red)" }}>
                    {perf.k.onTimePct == null ? "—" : `${Math.round(perf.k.onTimePct)}%`}
                  </b>
                  <span>{t("On time", "A tiempo")}</span>
                </div>
                <div className="kpi"><b>{perf.k.routes}</b><span>{t("Days worked", "Días trabajados")}</span></div>
                <div className="kpi"><b>{perf.k.avgStops.toFixed(1)}</b><span>{t("Stops per day", "Paradas por día")}</span></div>
                <div className="kpi"><b>{Math.round(perf.k.miles)}</b><span>{t("Miles driven", "Millas recorridas")}</span></div>
                <div className="kpi"><b>{Math.round(perf.k.pallets)}</b><span>{t("Pallets moved", "Pallets movidos")}</span></div>
                <div className="kpi">
                  <b>{perf.k.utilizationPct == null ? "—" : `${Math.round(perf.k.utilizationPct)}%`}</b>
                  <span>{t("Truck used", "Uso del camión")}</span>
                </div>
              </div>
              {perf.q && (
                <div className="hint" style={{ marginTop: 10, lineHeight: 1.7 }}>
                  {perf.q.avgTransitMin != null && <>⏱ {t("Avg transit", "Tránsito prom.")}: <b>{Math.round(perf.q.avgTransitMin)} min</b> · </>}
                  {perf.q.avgDwellMin != null && <>{t("Avg time at stop", "Tiempo prom. en parada")}: <b>{Math.round(perf.q.avgDwellMin)} min</b> · </>}
                  {perf.q.podCompliancePct != null && <>{t("Proof of delivery", "Prueba de entrega")}: <b>{Math.round(perf.q.podCompliancePct)}%</b></>}
                  {perf.q.redeliveries > 0 && <> · <span style={{ color: "var(--red)" }}>{t("Re-deliveries", "Reentregas")}: <b>{perf.q.redeliveries}</b></span></>}
                </div>
              )}
              <div className="hint" style={{ marginTop: 6 }}>
                {t("“On time” counts deliveries completed within the promised delivery window.",
                   "“A tiempo” cuenta las entregas completadas dentro de la ventana prometida.")}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- Recent work ---------- */}
      <div className="card">
        <h2>🕑 {t("Recent", "Recientes")}</h2>
        {recent.length === 0 ? (
          <div className="empty">{t("Nothing logged yet.", "Nada registrado aún.")}</div>
        ) : (
          <div className="bar-list">
            {recent.map((d) => (
              <button key={d.id} className="acct-row" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(d)}>
                <span className="ordno">#{orderLabel(d)}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.account || t("(no account)", "(sin cuenta)")}
                </span>
                <span className="hint">{fmtDate(d.delivery_date)}</span>
                <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
