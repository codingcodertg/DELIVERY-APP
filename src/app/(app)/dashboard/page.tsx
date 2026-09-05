"use client";

import { useEffect, useMemo, useState } from "react";
import { AttentionPanel } from "@/components/AttentionPanel";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel, STAGES } from "@/lib/constants";
import {
  approvalTurnaroundMs, computeKpis, countByStage, deliveryTrend, driverKpis, driverQualityKpis, driverShiftKpis,
  groupVolume, inDateRange, overdueOrders, salesRepStatsThisMonth,
} from "@/lib/analytics";
import { Sparkline } from "@/components/Sparkline";

// Matches the Routes Manager / Map default when a driver has no capacity set.
const DEFAULT_CAPACITY = 12;
import {
  daysBetween, downloadCSV, endOfMonthISO, endOfWeekISO, fmtDate, fmtDuration, fmtMoney,
  shiftDateISO, shiftMonthISO, startOfMonthISO, startOfWeekISO, toCSV, todayISO, deliveryColumns, orderLabel,
} from "@/lib/utils";
import type { Stage } from "@/lib/types";

// Default the date-range to the last 30 days.
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Which quick-range is active — governs how the ◀ / ▶ arrows step the range:
// a week steps by 7 days, a month steps by a calendar month (so it lands on
// real month boundaries instead of drifting), a custom range steps by its
// own exact length.
type RangeMode = "week" | "month" | "custom";

export default function DashboardPage() {
  const { me, users, deliveries, events, settings, shifts, ready, ensureDeliveriesSince } = useData();
  const { lang, t } = usePrefs();
  const router = useRouter();
  const [from, setFrom] = useState(daysAgoISO(30));
  // G-16: the provider keeps DELIVERIES_WINDOW_DAYS of orders; a range that starts earlier asks
  // for the rest on demand (idempotent, no-op when already loaded).
  useEffect(() => { void ensureDeliveriesSince(from); }, [from, ensureDeliveriesSince]);
  const [to, setTo] = useState(todayISO());
  const [rangeMode, setRangeMode] = useState<RangeMode>("custom");

  const setRange = (f: string, tt: string, mode: RangeMode) => {
    setFrom(f);
    setTo(tt > todayISO() ? todayISO() : tt);
    setRangeMode(mode);
  };

  const today = () => setRange(todayISO(), todayISO(), "custom");
  const thisWeek = () => setRange(startOfWeekISO(), endOfWeekISO(), "week");
  const thisMonth = () => setRange(startOfMonthISO(), endOfMonthISO(), "month");
  const lastMonth = () => {
    const anchor = shiftMonthISO(startOfMonthISO(), -1);
    setRange(startOfMonthISO(new Date(anchor + "T12:00:00")), endOfMonthISO(new Date(anchor + "T12:00:00")), "month");
  };

  const step = (dir: 1 | -1) => {
    if (rangeMode === "month") {
      const nextFrom = shiftMonthISO(from, dir);
      setRange(startOfMonthISO(new Date(nextFrom + "T12:00:00")), endOfMonthISO(new Date(nextFrom + "T12:00:00")), "month");
    } else if (rangeMode === "week") {
      setRange(shiftDateISO(from, dir * 7), shiftDateISO(to, dir * 7), "week");
    } else {
      const span = daysBetween(to, from) + 1; // inclusive day count
      setRange(shiftDateISO(from, dir * span), shiftDateISO(to, dir * span), "custom");
    }
  };

  // Everything below is scoped to the selected delivery-date range.
  const scoped = useMemo(() => inDateRange(deliveries, from, to), [deliveries, from, to]);

  const kpis = useMemo(() => computeKpis(scoped), [scoped]);
  const stageCounts = useMemo(() => countByStage(scoped, STAGES.map((s) => s.key) as Stage[]), [scoped]);
  const drivers = useMemo(
    () => driverKpis(
      scoped,
      (n) => settings.driver_capacity?.[n] ?? DEFAULT_CAPACITY,
      { fuelPrice: settings.fuel_price, mpg: settings.fleet_mpg, base: settings.cost_per_delivery },
    ),
    [scoped, settings.driver_capacity, settings.fuel_price, settings.fleet_mpg, settings.cost_per_delivery],
  );
  // Idle-time KPIs: shifts started within the range, active time from the
  // scoped deliveries. driver_id → name so shifts line up with assigned_driver.
  const idle = useMemo(() => {
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    const shiftScoped = shifts.filter((s) => {
      const day = s.started_at.slice(0, 10);
      return day >= from && day <= to;
    });
    return driverShiftKpis(shiftScoped, scoped, (id) => nameById.get(id));
  }, [shifts, users, scoped, from, to]);

  // Timing + quality KPIs (Tier 1) over the scoped deliveries.
  const quality = useMemo(() => driverQualityKpis(scoped), [scoped]);

  // Delivery trend over the range (for the sparklines).
  const trend = useMemo(() => deliveryTrend(scoped, from, to), [scoped, from, to]);

  // Peer ranking: position each driver by on-time %, then rating, then orders
  // (nulls sink). Used for the rank badge in the performance table.
  const rankByDriver = useMemo(() => {
    const ranked = [...drivers].sort((a, b) =>
      (b.onTimePct ?? -1) - (a.onTimePct ?? -1) ||
      (b.avgCsat ?? -1) - (a.avgCsat ?? -1) ||
      b.orders - a.orders,
    );
    return new Map(ranked.map((d, i) => [d.driver, i + 1]));
  }, [drivers]);

  // Fleet roll-up across the drivers in range.
  const fleet = useMemo(() => {
    const avg = (vals: (number | null)[]) => {
      const v = vals.filter((x): x is number => x != null);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    const revenue = drivers.reduce((s, d) => s + d.revenue, 0);
    const miles = drivers.reduce((s, d) => s + d.miles, 0);
    const fuel = drivers.reduce((s, d) => s + (d.fuelCost ?? 0), 0);
    const anyFuel = drivers.some((d) => d.fuelCost != null);
    const avgUtil = avg(drivers.map((d) => d.utilizationPct));
    const avgOnTime = avg(drivers.map((d) => d.onTimePct));
    const avgCostPer = avg(drivers.map((d) => d.costPerDelivery));
    const avgCsat = avg(drivers.map((d) => d.avgCsat));
    const totalIdleMin = idle.reduce((s, d) => s + d.idleMin, 0);
    const avgPerActiveHr = avg(idle.map((d) => d.perActiveHr));
    const avgPod = avg(quality.map((d) => d.podCompliancePct));
    const totalRedeliveries = quality.reduce((s, d) => s + d.redeliveries, 0);
    const totalGpsOff = quality.reduce((s, d) => s + d.podGpsFar, 0);
    return {
      revenue: Math.round(revenue * 100) / 100,
      revPerMile: miles > 0 ? Math.round((revenue / miles) * 100) / 100 : null,
      fuelCost: anyFuel ? Math.round(fuel * 100) / 100 : null,
      avgCostPer: avgCostPer == null ? null : Math.round(avgCostPer * 100) / 100,
      avgUtil: avgUtil == null ? null : Math.round(avgUtil),
      avgOnTime: avgOnTime == null ? null : Math.round(avgOnTime),
      avgCsat: avgCsat == null ? null : Math.round(avgCsat * 10) / 10,
      totalIdleMin,
      avgPerActiveHr: avgPerActiveHr == null ? null : Math.round(avgPerActiveHr * 10) / 10,
      avgPod: avgPod == null ? null : Math.round(avgPod),
      totalRedeliveries,
      totalGpsOff,
    };
  }, [drivers, idle, quality]);
  const stores = useMemo(() => groupVolume(scoped, "store"), [scoped]);
  const accounts = useMemo(() => groupVolume(scoped, "account").slice(0, 8), [scoped]);
  const turnaround = useMemo(() => approvalTurnaroundMs(scoped, events), [scoped, events]);
  const overdue = useMemo(() => overdueOrders(scoped), [scoped]);
  // Not scoped to the from/to range picker above — this is always "this
  // calendar month", regardless of what range is selected elsewhere on the page.
  const repStats = useMemo(() => salesRepStatsThisMonth(deliveries, users), [deliveries, users]);

  if (!me) return null;

  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));
  const maxStore = Math.max(1, ...stores.map((s) => s.total));

  const exportRange = () => {
    if (!scoped.length) return;
    const headers = deliveryColumns(scoped[0]).map(([h]) => h).concat("Stage");
    const data = scoped.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`deliveries_${from}_to_${to}.csv`, toCSV(headers, data));
  };

  // One row per driver merging performance + idle + timing/quality KPIs.
  const exportDrivers = () => {
    const names = new Set<string>([...drivers.map((d) => d.driver), ...idle.map((d) => d.driver), ...quality.map((d) => d.driver)]);
    if (!names.size) return;
    const perf = new Map(drivers.map((d) => [d.driver, d]));
    const idl = new Map(idle.map((d) => [d.driver, d]));
    const qual = new Map(quality.map((d) => [d.driver, d]));
    const headers = [
      "Driver", "Orders", "Delivered", "On-time %", "Avg delay (min)", "Stops/route", "Miles",
      "Revenue", "$/mi", "Pallet util %", "Fuel", "Cost/delivery", 
      "On-clock (min)", "Active (min)", "Idle (min)", "Active %", "Deliveries/hr",
      "Drive→pickup (min)", "Transit (min)", "Dwell (min)", "POD compliance %",
      "Redeliveries", "Redelivery %", "Short loads", "GPS checked", "GPS off",
    ];
    const rows = [...names].map((name) => {
      const p = perf.get(name); const i = idl.get(name); const q = qual.get(name);
      return [
        name, p?.orders ?? "", p?.delivered ?? "", p?.onTimePct ?? "", p?.avgDelayMin ?? "", p?.avgStops ?? "", p?.miles ?? "",
        p?.revenue ?? "", p?.revPerMile ?? "", p?.utilizationPct ?? "", p?.fuelCost ?? "", p?.costPerDelivery ?? "",
        i?.onClockMin ?? "", i?.activeMin ?? "", i?.idleMin ?? "", i?.activePct ?? "", i?.perActiveHr ?? "",
        q?.avgDriveToPickupMin ?? "", q?.avgTransitMin ?? "", q?.avgDwellMin ?? "", q?.podCompliancePct ?? "",
        q?.redeliveries ?? "", q?.redeliveryPct ?? "", q?.shortLoads ?? "", q?.podGpsChecked ?? "", q?.podGpsFar ?? "",
      ];
    });
    downloadCSV(`driver_stats_${from}_to_${to}.csv`, toCSV(headers, rows));
  };

  const openOrder = (id: string) => router.push(`/?order=${id}`);

  return (
    <>
      {/* Above the KPIs on purpose: these are the things nothing else would
          have told anyone about. Renders nothing when the board is healthy. */}
      <AttentionPanel onOpen={(d) => openOrder(d.id)} />
      <div className="page-head">
        <h2>{t("Dashboard", "Panel")}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => step(-1)} title={t("Previous period", "Período anterior")}>◀</button>
          <label style={{ margin: 0, textTransform: "none", letterSpacing: 0 }}>
            {t("From", "Desde")}
            <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setRangeMode("custom"); }} style={{ width: 150, marginTop: 2 }} />
          </label>
          <label style={{ margin: "0 0 0 10px", textTransform: "none", letterSpacing: 0 }}>
            {t("To", "Hasta")}
            <input type="date" value={to} min={from} max={todayISO()} onChange={(e) => { setTo(e.target.value); setRangeMode("custom"); }} style={{ width: 150, marginTop: 2 }} />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => step(1)} title={t("Next period", "Período siguiente")}>▶</button>
          <span style={{ width: 1, height: 24, background: "var(--line)", margin: "0 2px" }} />
          <button className={"btn btn-sm " + (from === todayISO() && to === todayISO() ? "btn-primary" : "btn-ghost")} onClick={today}>{t("Today", "Hoy")}</button>
          <button className={"btn btn-sm " + (rangeMode === "week" && from === startOfWeekISO() ? "btn-primary" : "btn-ghost")} onClick={thisWeek}>{t("This week", "Esta semana")}</button>
          <button className={"btn btn-sm " + (rangeMode === "month" && from === startOfMonthISO() ? "btn-primary" : "btn-ghost")} onClick={thisMonth}>{t("This month", "Este mes")}</button>
          <button className="btn btn-ghost btn-sm" onClick={lastMonth}>{t("Last month", "Mes pasado")}</button>
          {me?.role === "admin" && <>
            <button className="btn btn-ghost" onClick={exportRange} disabled={!scoped.length}>⬇ {t("Export range", "Exportar rango")}</button>
            <button className="btn btn-ghost" onClick={exportDrivers} disabled={!drivers.length && !idle.length}>⬇ {t("Export driver stats", "Exportar stats de choferes")}</button>
          </>}
        </div>
      </div>

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : (
        <>
          {/* ---------- KPI tiles ---------- */}
          <div className="kpi-grid">
            <Kpi n={kpis.total} label={t("Orders", "Órdenes")} />
            <Kpi n={kpis.pending} label={t("Pending approval", "Pendientes")} tone="amber" />
            <Kpi n={kpis.inWarehouse} label={t("In warehouse", "En almacén")} tone="purple" />
            <Kpi n={kpis.outForDelivery} label={t("Out for delivery", "En reparto")} tone="accent" />
            <Kpi n={kpis.delivered} label={t("Delivered", "Entregadas")} tone="green" />
            <Kpi n={kpis.overdue} label={t("Overdue", "Atrasadas")} tone={kpis.overdue ? "red" : undefined} />
            <Kpi n={kpis.totalPallets} label={t("Pallets", "Pallets")} />
            <Kpi n={kpis.totalMiles} label={t("Route miles", "Millas")} />
            <Kpi n={fmtMoney(kpis.totalFees)} label={t("Fees charged", "Cobros de entrega")} tone="green" small />
            <Kpi n={kpis.onTimePct == null ? "—" : `${kpis.onTimePct}%`} label={t("On-time", "A tiempo")} tone={kpis.onTimePct != null && kpis.onTimePct < 80 ? "amber" : "green"} />
            <Kpi n={turnaround.avgMs == null ? "—" : fmtDuration(turnaround.avgMs)} label={t("Avg approval", "Aprob. prom.")} small />
          </div>

          <div className="dash-cols">
            {/* ---------- Orders by stage ---------- */}
            <div className="card">
              <h2>📦 {t("Orders by stage", "Órdenes por etapa")}</h2>
              <div className="bar-list">
                {stageCounts.map((s) => {
                  const info = stageInfo(s.stage);
                  return (
                    <div className="bar-row" key={s.stage}>
                      <span className="bar-label">{stageLabel(s.stage, lang)}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(s.count / maxStage) * 100}%`, background: info.color }} />
                      </span>
                      <span className="bar-num">{s.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ---------- Store volume ---------- */}
            <div className="card">
              <h2>🏬 {t("Volume by store", "Volumen por tienda")}</h2>
              {stores.length === 0 ? (
                <div className="empty">{t("No orders in this range.", "No hay órdenes en este rango.")}</div>
              ) : (
                <div className="bar-list">
                  {stores.map((s) => (
                    <div className="bar-row" key={s.key}>
                      <span className="bar-label">{s.key}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(s.total / maxStore) * 100}%`, background: "var(--accent)" }} />
                      </span>
                      <span className="bar-num">{s.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ---------- Trends ---------- */}
          <div className="card">
            <h2>📈 {t("Trends", "Tendencias")}</h2>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              {t("Delivery volume, on-time rate and rating across the selected range.", "Volumen de entregas, puntualidad y calificación en el rango seleccionado.")}
            </p>
            {trend.every((p) => p.delivered === 0) ? (
              <div className="empty">{t("No deliveries in this range.", "Sin entregas en este rango.")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <TrendRow label={t("Deliveries", "Entregas")} values={trend.map((p) => p.delivered)} last={trend[trend.length - 1]?.delivered ?? null} color="var(--accent)" />
                <TrendRow label={t("On-time %", "A tiempo %")} values={trend.map((p) => p.onTimePct)} last={trend[trend.length - 1]?.onTimePct ?? null} suffix="%" color="var(--green)" />
              </div>
            )}
          </div>

          {/* ---------- Driver & fleet KPIs ---------- */}
          <div className="card">
            <h2>🚚 {t("Driver & fleet KPIs", "KPIs de choferes y flota")}</h2>
            {drivers.length === 0 ? (
              <div className="empty">{t("No drivers assigned in this range.", "No hay choferes asignados en este rango.")}</div>
            ) : (
              <>
                <div className="kpi-grid" style={{ marginBottom: 16 }}>
                  <Kpi n={fmtMoney(fleet.revenue)} label={t("Fleet revenue", "Ingresos de flota")} tone="green" small />
                  <Kpi n={fleet.revPerMile == null ? "—" : fmtMoney(fleet.revPerMile)} label={t("Revenue / mile", "Ingreso / milla")} small />
                  <Kpi n={fleet.fuelCost == null ? "—" : fmtMoney(fleet.fuelCost)} label={t("Fuel cost", "Costo combustible")} tone="amber" small />
                  <Kpi n={fleet.avgCostPer == null ? "—" : fmtMoney(fleet.avgCostPer)} label={t("Cost / delivery", "Costo / entrega")} small />
                  <Kpi n={fleet.avgOnTime == null ? "—" : `${fleet.avgOnTime}%`} label={t("Avg on-time", "A tiempo prom.")} tone={fleet.avgOnTime != null && fleet.avgOnTime < 80 ? "amber" : "green"} />
                  <Kpi n={fleet.avgUtil == null ? "—" : `${fleet.avgUtil}%`} label={t("Avg utilization", "Utilización prom.")} tone={fleet.avgUtil != null && fleet.avgUtil > 100 ? "red" : "accent"} />
                  <Kpi n={fleet.avgPerActiveHr == null ? "—" : fleet.avgPerActiveHr} label={t("Deliveries / active hr", "Entregas / hora activa")} tone="accent" small />
                  <Kpi n={fleet.totalIdleMin ? fmtDuration(fleet.totalIdleMin * 60_000) : "—"} label={t("Total idle time", "Tiempo inactivo total")} tone={fleet.totalIdleMin > 0 ? "amber" : undefined} small />
                  <Kpi n={fleet.avgPod == null ? "—" : `${fleet.avgPod}%`} label={t("POD compliance", "Comprobante entrega")} tone={fleet.avgPod != null && fleet.avgPod < 90 ? "amber" : "green"} small />
                  <Kpi n={fleet.totalRedeliveries || "—"} label={t("Redeliveries", "Reenvíos")} tone={fleet.totalRedeliveries > 0 ? "red" : undefined} small />
                  <Kpi n={fleet.totalGpsOff || "—"} label={t("GPS-off deliveries", "Entregas GPS lejos")} tone={fleet.totalGpsOff > 0 ? "red" : undefined} small />
                </div>
                <div className="tbl-scroll" style={{ border: "none" }}>
                  <table className="orders" style={{ minWidth: 760, fontVariantNumeric: "tabular-nums" }}>
                    <thead>
                      <tr>
                        <th>{t("Driver", "Chofer")}</th>
                        <th>{t("Orders", "Órdenes")}</th>
                        <th>{t("Delivered", "Entregadas")}</th>
                        <th>{t("On-time", "A tiempo")}</th>
                        <th>{t("Avg delay", "Retraso prom.")}</th>
                        <th>{t("Stops/route", "Paradas/ruta")}</th>
                        <th>{t("Miles", "Millas")}</th>
                        <th>{t("Revenue", "Ingresos")}</th>
                        <th>{t("$/mi", "$/mi")}</th>
                        <th>{t("Util.", "Util.")}</th>
                        <th>{t("Fuel", "Comb.")}</th>
                        <th>{t("Cost/del", "Costo/ent")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((d) => {
                        const rank = rankByDriver.get(d.driver);
                        return (
                        <tr key={d.driver}>
                          <td style={{ fontWeight: 700 }}>
                            {rank != null && (
                              <span className="sema" title={t("On-time rank vs peers", "Ranking de puntualidad vs pares")} style={{ marginRight: 6, background: rank === 1 ? "var(--green)" : "var(--line)", color: rank === 1 ? "#fff" : "var(--muted)" }}>#{rank}</span>
                            )}
                            {d.driver}
                          </td>
                          <td>{d.orders}</td>
                          <td>{d.delivered}</td>
                          <td style={d.onTimePct != null && fleet.avgOnTime != null ? (d.onTimePct >= fleet.avgOnTime ? { color: "var(--green)", fontWeight: 700 } : { color: "var(--amber)", fontWeight: 700 }) : undefined} title={fleet.avgOnTime != null ? `${t("Fleet avg", "Prom. flota")} ${fleet.avgOnTime}%` : undefined}>{d.onTimePct == null ? "—" : `${d.onTimePct}%`}</td>
                          <td style={d.avgDelayMin ? { color: "var(--red)" } : undefined}>{d.avgDelayMin == null ? "—" : `${d.avgDelayMin}m`}</td>
                          <td>{d.avgStops}</td>
                          <td>{d.miles}</td>
                          <td>{fmtMoney(d.revenue)}</td>
                          <td>{d.revPerMile == null ? "—" : fmtMoney(d.revPerMile)}</td>
                          <td style={d.utilizationPct != null && d.utilizationPct > 100 ? { color: "var(--red)", fontWeight: 700 } : undefined}>{d.utilizationPct == null ? "—" : `${d.utilizationPct}%`}</td>
                          <td>{d.fuelCost == null ? "—" : fmtMoney(d.fuelCost)}</td>
                          <td>{d.costPerDelivery == null ? "—" : fmtMoney(d.costPerDelivery)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                        <td>{t("Fleet avg", "Prom. flota")}</td>
                        <td>{drivers.reduce((s, d) => s + d.orders, 0)}</td>
                        <td>{drivers.reduce((s, d) => s + d.delivered, 0)}</td>
                        <td>{fleet.avgOnTime == null ? "—" : `${fleet.avgOnTime}%`}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{Math.round(drivers.reduce((s, d) => s + d.miles, 0) * 10) / 10}</td>
                        <td>{fmtMoney(fleet.revenue)}</td>
                        <td>{fleet.revPerMile == null ? "—" : fmtMoney(fleet.revPerMile)}</td>
                        <td>{fleet.avgUtil == null ? "—" : `${fleet.avgUtil}%`}</td>
                        <td>{fleet.fuelCost == null ? "—" : fmtMoney(fleet.fuelCost)}</td>
                        <td>{fleet.avgCostPer == null ? "—" : fmtMoney(fleet.avgCostPer)}</td>
                        
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* ---------- Driver idle time (shift clock) ---------- */}
          <div className="card">
            <h2>⏱️ {t("Driver idle time", "Tiempo inactivo de choferes")}</h2>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              {t(
                "On-clock time from the shift clock, minus time actively out on a delivery (from departure/pickup → delivered).",
                "Tiempo en turno del reloj, menos el tiempo activo en reparto (desde salida/recogida → entregado).",
              )}
            </p>
            {idle.length === 0 ? (
              <div className="empty">{t("No shifts clocked in this range.", "Sin turnos registrados en este rango.")}</div>
            ) : (
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 560, fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr>
                      <th>{t("Driver", "Chofer")}</th>
                      <th>{t("On-clock", "En turno")}</th>
                      <th>{t("Active", "Activo")}</th>
                      <th>{t("Idle", "Inactivo")}</th>
                      <th>{t("Active %", "% Activo")}</th>
                      <th>{t("Deliv/hr", "Entr/h")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {idle.map((d) => (
                      <tr key={d.driver}>
                        <td style={{ fontWeight: 700 }}>{d.driver}</td>
                        <td>{fmtDuration(d.onClockMin * 60_000)}</td>
                        <td>{fmtDuration(d.activeMin * 60_000)}</td>
                        <td style={d.activePct != null && d.activePct < 50 ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{fmtDuration(d.idleMin * 60_000)}</td>
                        <td style={d.activePct != null && d.activePct < 50 ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{d.activePct == null ? "—" : `${d.activePct}%`}</td>
                        <td>{d.perActiveHr == null ? "—" : d.perActiveHr}</td>
                        <td>{d.open && <span className="sema" style={{ background: "var(--green)", color: "#fff" }}>{t("On the clock", "En turno")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- Driver timing & quality (Tier 1) ---------- */}
          <div className="card">
            <h2>🎯 {t("Driver timing & quality", "Tiempos y calidad de choferes")}</h2>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              {t(
                "Leg times (from driver stamps), first-attempt success, proof-of-delivery capture, and rating response.",
                "Tiempos por tramo (de marcas del chofer), éxito al primer intento, captura de comprobante y respuesta de calificación.",
              )}
            </p>
            {quality.length === 0 ? (
              <div className="empty">{t("No driver orders in this range.", "Sin órdenes de chofer en este rango.")}</div>
            ) : (
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 860, fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr>
                      <th>{t("Driver", "Chofer")}</th>
                      <th title={t("Departure → pickup", "Salida → recogida")}>{t("Drive→pickup", "A recoger")}</th>
                      <th title={t("Pickup → delivered", "Recogida → entregado")}>{t("Transit", "Tránsito")}</th>
                      <th title={t("Arrived → delivered (service time)", "Llegada → entregado (tiempo de servicio)")}>{t("Dwell", "En parada")}</th>
                      <th title={t("Deliveries with a signature or photo", "Entregas con firma o foto")}>{t("POD %", "% Comp.")}</th>
                      <th title={t("Second-attempt deliveries", "Entregas en segundo intento")}>{t("Redeliv.", "Reenvíos")}</th>
                      <th title={t("Loaded fewer pallets than ordered", "Cargó menos pallets de las pedidas")}>{t("Short loads", "Carga corta")}</th>
                      <th title={t("Deliveries stamped far from the destination address", "Entregas marcadas lejos de la dirección de destino")}>{t("GPS off", "GPS lejos")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quality.map((d) => (
                      <tr key={d.driver}>
                        <td style={{ fontWeight: 700 }}>{d.driver}</td>
                        <td>{d.avgDriveToPickupMin == null ? "—" : fmtDuration(d.avgDriveToPickupMin * 60_000)}</td>
                        <td>{d.avgTransitMin == null ? "—" : fmtDuration(d.avgTransitMin * 60_000)}</td>
                        <td>{d.avgDwellMin == null ? "—" : fmtDuration(d.avgDwellMin * 60_000)}</td>
                        <td style={d.podCompliancePct != null && d.podCompliancePct < 90 ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{d.podCompliancePct == null ? "—" : `${d.podCompliancePct}%`}</td>
                        <td style={d.redeliveries ? { color: "var(--red)", fontWeight: 700 } : undefined}>{d.redeliveries || "—"}{d.redeliveryPct ? ` (${d.redeliveryPct}%)` : ""}</td>
                        <td style={d.shortLoads ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{d.shortLoads || "—"}</td>
                        <td style={d.podGpsFar ? { color: "var(--red)", fontWeight: 700 } : undefined} title={d.podGpsChecked ? `${d.podGpsFar}/${d.podGpsChecked} ${t("checked", "verificadas")}` : t("no GPS data yet", "sin datos GPS aún")}>{d.podGpsChecked === 0 ? "—" : (d.podGpsFar || "0")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- Sales rep performance, this month ---------- */}
          <div className="card">
            <h2>🧑‍💼 {t("Sales reps — this month", "Vendedores — este mes")}</h2>
            {repStats.length === 0 ? (
              <div className="empty">{t("No orders logged this month.", "Sin órdenes registradas este mes.")}</div>
            ) : (
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th>{t("Sales rep", "Vendedor")}</th>
                      <th>{t("Deliveries", "Entregas")}</th>
                      <th>{t("Charged total", "Total cobrado")}</th>
                      <th>{t("Avg $/delivery", "Prom. $/entrega")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repStats.map((r) => (
                      <tr key={r.rep}>
                        <td style={{ fontWeight: 700 }}>{r.rep}</td>
                        <td>{r.deliveries}</td>
                        <td>{fmtMoney(r.chargedTotal)}</td>
                        <td>{fmtMoney(r.avgPerDelivery)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- Top accounts ---------- */}
          <div className="dash-cols">
            <div className="card">
              <h2>🏢 {t("Top accounts", "Cuentas principales")}</h2>
              {accounts.length === 0 ? (
                <div className="empty">{t("No accounts in this range.", "No hay cuentas en este rango.")}</div>
              ) : (
                <div className="bar-list">
                  {accounts.map((a) => (
                    <div className="bar-row" key={a.key}>
                      <span className="bar-label">{a.key}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(a.total / Math.max(1, accounts[0].total)) * 100}%`, background: "var(--teal)" }} />
                      </span>
                      <span className="bar-num">{a.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ---------- Overdue list ---------- */}
            <div className="card">
              <h2 style={{ color: overdue.length ? "var(--red)" : undefined }}>
                ⏰ {t("Overdue orders", "Órdenes atrasadas")} {overdue.length > 0 && <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{overdue.length}</span>}
              </h2>
              {overdue.length === 0 ? (
                <div className="empty">✅ {t("Nothing overdue. Nice.", "Nada atrasado. ¡Bien!")}</div>
              ) : (
                <div className="bar-list">
                  {overdue.slice(0, 8).map((d) => (
                    <button key={d.id} className="overdue-row" onClick={() => openOrder(d.id)}>
                      <span className="ordno">#{orderLabel(d)}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.account || t("(no account)", "(sin cuenta)")}</span>
                      <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
                      <span style={{ color: "var(--red)", fontWeight: 700 }}>{fmtDate(d.delivery_date)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ n, label, tone, small }: { n: number | string; label: string; tone?: "amber" | "green" | "red" | "accent" | "purple"; small?: boolean }) {
  const color =
    tone === "amber" ? "var(--amber)" :
    tone === "green" ? "var(--green)" :
    tone === "red" ? "var(--red)" :
    tone === "accent" ? "var(--accent)" :
    tone === "purple" ? "var(--purple)" : "var(--text)";
  return (
    <div className="kpi">
      <b style={{ color, fontSize: small ? 17 : undefined }}>{n}</b>
      <span>{label}</span>
    </div>
  );
}

// One labelled sparkline row: metric name · sparkline · latest value.
function TrendRow({ label, values, last, suffix = "", color }: {
  label: string; values: (number | null)[]; last: number | null; suffix?: string; color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="hint" style={{ width: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}><Sparkline values={values} color={color} width={220} /></div>
      <b style={{ width: 64, textAlign: "right", flexShrink: 0, color, fontVariantNumeric: "tabular-nums" }}>
        {last == null ? "—" : `${last}${suffix}`}
      </b>
    </div>
  );
}
