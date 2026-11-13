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
import { PuntualidadPorChofer } from "@/components/PuntualidadPorChofer";
import { ReportesDeChoferes } from "@/components/ReportesDeChoferes";
import { puedeVerReportesDeChoferes } from "@/lib/reportes-choferes/permiso";
import { EncuestaDelPanel } from "@/components/EncuestaDelPanel";
import { TablaEstandar } from "@/components/TablaEstandar";

// Matches the Routes Manager / Map default when a driver has no capacity set.
const DEFAULT_CAPACITY = 12;
import {
  daysBetween, downloadCSV, endOfMonthISO, endOfWeekISO, fmtDate, fmtDuration, fmtMoney,
  shiftDateISO, shiftMonthISO, startOfMonthISO, startOfWeekISO, toCSV, todayISO, deliveryColumns, orderLabel,
} from "@/lib/utils";
import type { Stage } from "@/lib/types";
import { redondeaDinero, sumaDinero, sumaMillas } from "@/lib/totales";
import { alcanceDelPanel, choferesDelPanel, ordenesDelPanel } from "@/lib/panel-por-tienda";
import { millasPorTienda, paradasDeMillas } from "@/lib/millas-por-tienda";

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

  // De qué tiendas son las cifras (D-396): el gerente, las suyas y las de su grupo; admin y logística,
  // todas. TODO lo de abajo bebe de `delPanel`, nunca de `deliveries` a secas: una sola tarjeta que
  // leyera la lista entera volvería a enseñarle la empresa al gerente.
  const alcance = useMemo(() => alcanceDelPanel(me, settings.stores), [me, settings.stores]);
  const delPanel = useMemo(
    () => ordenesDelPanel(deliveries, alcance, settings.order_type_rules),
    [deliveries, alcance, settings.order_type_rules],
  );
  const misChoferes = useMemo(() => choferesDelPanel(alcance, users), [alcance, users]);

  // Everything below is scoped to the selected delivery-date range.
  const scoped = useMemo(() => inDateRange(delPanel, from, to), [delPanel, from, to]);

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
      return day >= from && day <= to && (!misChoferes || misChoferes.ids.has(s.driver_id));
    });
    // Con corte, el tiempo activo de SUS choferes sale de todas sus entregas del rango (ver `choferesDelPanel`).
    const activas = misChoferes
      ? inDateRange(deliveries, from, to).filter((d) => !!d.assigned_driver && misChoferes.nombres.has(d.assigned_driver))
      : scoped;
    return driverShiftKpis(shiftScoped, activas, (id) => nameById.get(id));
  }, [shifts, users, scoped, deliveries, misChoferes, from, to]);

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
    // Suma de segundo nivel: lo que ya venía redondeado por chofer. Misma magnitud, misma unidad.
    const revenue = sumaDinero(drivers, (d) => d.revenue);
    const miles = sumaMillas(drivers, (d) => d.miles);
    const fuel = sumaDinero(drivers, (d) => d.fuelCost);
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
      revenue,
      revPerMile: miles > 0 ? redondeaDinero(revenue / miles) : null,
      fuelCost: anyFuel ? fuel : null,
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
  // Millas y reparto del gas por tienda (D-738): paradas de las órdenes entregadas/recogidas del rango,
  // y la Intertienda la paga la tienda que recibe. Las reglas, en `millas-por-tienda.ts`.
  const gas = useMemo(
    () => millasPorTienda(paradasDeMillas(scoped, settings.stores, settings.order_type_rules)),
    [scoped, settings.stores, settings.order_type_rules],
  );
  const accounts = useMemo(() => groupVolume(scoped, "account").slice(0, 8), [scoped]);
  const turnaround = useMemo(() => approvalTurnaroundMs(scoped, events), [scoped, events]);
  const overdue = useMemo(() => overdueOrders(scoped), [scoped]);
  // Not scoped to the from/to range picker above — this is always "this
  // calendar month", regardless of what range is selected elsewhere on the page.
  const repStats = useMemo(() => salesRepStatsThisMonth(delPanel, users), [delPanel, users]);

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

  // Tablas de choferes y tienda: `TablaEstandar` (▾ ⚙ mover y anchos). Mismos números y formatos que antes.
  const num1 = (n: number) => n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const tiempoDe = (min: number | null | undefined) => (min == null ? "—" : fmtDuration(min * 60_000));
  const estDe = (f: { paradasEstimadas: number; millasEstimadas: number; paradasSinDato: number }) => (
    <span title={f.paradasSinDato ? t(`${f.paradasSinDato} stop(s) without data (0 mi)`, `${f.paradasSinDato} parada(s) sin dato (0 mi)`) : undefined}>
      {f.paradasEstimadas === 0 ? "—" : `${num1(f.millasEstimadas)} (${f.paradasEstimadas})`}
      {f.paradasSinDato > 0 && <span style={{ color: "var(--amber)", fontWeight: 700 }}> ⚠️</span>}
    </span>
  );
  const pctTexto = (v: number | null) => (v == null ? "—" : `${num1(v)} %`);

  return (
    <>
      {/* Above the KPIs on purpose: these are the things nothing else would
          have told anyone about. Renders nothing when the board is healthy. */}
      <AttentionPanel deliveries={delPanel} onOpen={(d) => openOrder(d.id)} />
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

      {alcance.tipo === "tiendas" && (
        <p className="hint" data-panel-tiendas style={{ marginTop: -6, marginBottom: 12 }}>
          🏬 {t("Showing only", "Solo se muestra")}: <b>{alcance.nombres.join(" + ")}</b>
        </p>
      )}

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : alcance.tipo === "sin-tienda" ? (
        // Sin tienda no se le enseña la empresa (D-237): un campo vacío no amplía lo que se ve.
        <div className="card" data-panel-sin-tienda>
          <h2>🏬 {t("No store assigned", "Sin tienda asignada")}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {t(
              "The dashboard shows the figures of your store. Your profile has no store yet — ask an admin to assign one in Users.",
              "El panel enseña las cifras de su tienda. Su perfil todavía no tiene tienda: pida a un admin que se la asigne en Usuarios.",
            )}
          </p>
        </div>
      ) : (
        <>
          {/* ---------- KPI tiles ---------- */}
          <div className="kpi-grid">
            <Kpi n={kpis.total} label={t("Orders", "Órdenes")} />
            <Kpi n={kpis.pending} label={t("Pending approval", "Pendientes")} tone="amber" />
            <Kpi n={kpis.inWarehouse} label={t("In warehouse", "En almacén")} tone="purple" />
            <Kpi n={kpis.outForDelivery} label={t("Out for delivery", "En reparto")} tone="accent" />
            <Kpi n={kpis.delivered} label={t("Delivered", "Entregadas")} tone="green" />
            <Kpi n={kpis.overdue} label={t("Overdue", "Expiradas")} tone={kpis.overdue ? "red" : undefined} />
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

          {/* ---------- Millas y gas por tienda (D-738) ---------- */}
          <div className="card" data-panel-millas-por-tienda>
            <h2>⛽ {t("Miles & fuel share by store", "Millas y gas por tienda")}</h2>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              {t(
                "Delivered or picked-up orders in the range, grouped into stops (same day, driver and destination). Store-to-store orders count for the store that receives. Miles are Google's store → destination; «est.» = straight line × 1.3 when Google's figure is missing or not believable.",
                "Órdenes entregadas o recogidas del rango, juntadas por parada (mismo día, chofer y destino). Las Intertiendas cuentan para la tienda que recibe. Millas de Google tienda → destino; «est.» = línea recta × 1,3 cuando falta o no es creíble.",
              )}
            </p>
            {gas.filas.length === 0 ? (
              <div className="empty">{t("No delivered orders in this range.", "Sin órdenes entregadas en este rango.")}</div>
            ) : (
              <TablaEstandar id="dash-millas-tienda" sinCaja data-tabla="dash-millas-tienda" filas={gas.filas} claveDe={(f) => f.tienda}
                columnas={[
                  { key: "tienda", en: "Store", es: "Tienda", ancho: 180, fija: true, valor: (f) => f.tienda, celda: (f) => <strong>{f.tienda}</strong> },
                  { key: "paradas", en: "Stops", es: "Paradas", ancho: 90, numerico: true, valor: (f) => f.paradas },
                  { key: "ordenes", en: "Orders", es: "Órdenes", ancho: 90, numerico: true, valor: (f) => f.ordenes },
                  { key: "millas", en: "Miles", es: "Millas", ancho: 100, numerico: true, valor: (f) => f.millas, celda: (f) => num1(f.millas) },
                  { key: "est", en: "Of which est.", es: "De ellas est.", ancho: 150, numerico: true, valor: (f) => f.millasEstimadas, celda: (f) => estDe(f) },
                  { key: "gas", en: "% of fuel", es: "% del gas", ancho: 110, numerico: true, valor: (f) => f.pctGas, celda: (f) => <strong>{pctTexto(f.pctGas)}</strong> },
                ]}
                totales={{
                  tienda: t("Total", "Total"),
                  paradas: <strong>{gas.total.paradas}</strong>,
                  ordenes: <strong>{gas.total.ordenes}</strong>,
                  millas: <strong>{num1(gas.total.millas)}</strong>,
                  est: <strong>{estDe(gas.total)}</strong>,
                  gas: <strong>{pctTexto(gas.total.pctGas)}</strong>,
                }} />

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
                <TablaEstandar id="dash-kpis-choferes" sinCaja data-tabla="dash-kpis-choferes" filas={drivers} claveDe={(d) => d.driver}
                  columnas={[
                    { key: "chofer", en: "Driver", es: "Chofer", ancho: 180, fija: true, valor: (d) => d.driver, celda: (d) => {
                      const rank = rankByDriver.get(d.driver);
                      return (
                        <strong>
                          {rank != null && (
                            <span className="sema" title={t("On-time rank vs peers", "Ranking de puntualidad vs pares")} style={{ marginRight: 6, background: rank === 1 ? "var(--green)" : "var(--line)", color: rank === 1 ? "#fff" : "var(--muted)" }}>#{rank}</span>
                          )}
                          {d.driver}
                        </strong>
                      );
                    } },
                    { key: "ordenes", en: "Orders", es: "Órdenes", ancho: 90, numerico: true, valor: (d) => d.orders },
                    { key: "entregadas", en: "Delivered", es: "Entregadas", ancho: 110, numerico: true, valor: (d) => d.delivered },
                    { key: "atiempo", en: "On-time", es: "A tiempo", ancho: 100, numerico: true, valor: (d) => d.onTimePct, celda: (d) => (
                      <span style={d.onTimePct != null && fleet.avgOnTime != null ? (d.onTimePct >= fleet.avgOnTime ? { color: "var(--green)", fontWeight: 700 } : { color: "var(--amber)", fontWeight: 700 }) : undefined} title={fleet.avgOnTime != null ? `${t("Fleet avg", "Prom. flota")} ${fleet.avgOnTime}%` : undefined}>{d.onTimePct == null ? "—" : `${d.onTimePct}%`}</span>
                    ) },
                    { key: "retraso", en: "Avg delay", es: "Retraso prom.", ancho: 110, numerico: true, valor: (d) => d.avgDelayMin, celda: (d) => (
                      <span style={d.avgDelayMin ? { color: "var(--red)" } : undefined}>{d.avgDelayMin == null ? "—" : `${d.avgDelayMin}m`}</span>
                    ) },
                    { key: "paradas", en: "Stops/route", es: "Paradas/ruta", ancho: 110, numerico: true, valor: (d) => d.avgStops },
                    { key: "millas", en: "Miles", es: "Millas", ancho: 90, numerico: true, valor: (d) => d.miles },
                    { key: "ingresos", en: "Revenue", es: "Ingresos", ancho: 110, numerico: true, valor: (d) => d.revenue, celda: (d) => fmtMoney(d.revenue) },
                    { key: "dolarmi", en: "$/mi", es: "$/mi", ancho: 90, numerico: true, valor: (d) => d.revPerMile, celda: (d) => (d.revPerMile == null ? "—" : fmtMoney(d.revPerMile)) },
                    { key: "util", en: "Util.", es: "Util.", ancho: 90, numerico: true, valor: (d) => d.utilizationPct, celda: (d) => (
                      <span style={d.utilizationPct != null && d.utilizationPct > 100 ? { color: "var(--red)", fontWeight: 700 } : undefined}>{d.utilizationPct == null ? "—" : `${d.utilizationPct}%`}</span>
                    ) },
                    { key: "comb", en: "Fuel", es: "Comb.", ancho: 100, numerico: true, valor: (d) => d.fuelCost, celda: (d) => (d.fuelCost == null ? "—" : fmtMoney(d.fuelCost)) },
                    { key: "costo", en: "Cost/del", es: "Costo/ent", ancho: 110, numerico: true, valor: (d) => d.costPerDelivery, celda: (d) => (d.costPerDelivery == null ? "—" : fmtMoney(d.costPerDelivery)) },
                  ]}
                  totales={{
                    chofer: t("Fleet avg", "Prom. flota"),
                    ordenes: drivers.reduce((s, d) => s + d.orders, 0),
                    entregadas: drivers.reduce((s, d) => s + d.delivered, 0),
                    atiempo: fleet.avgOnTime == null ? "—" : `${fleet.avgOnTime}%`,
                    retraso: "—",
                    paradas: "—",
                    millas: sumaMillas(drivers, (d) => d.miles),
                    ingresos: fmtMoney(fleet.revenue),
                    dolarmi: fleet.revPerMile == null ? "—" : fmtMoney(fleet.revPerMile),
                    util: fleet.avgUtil == null ? "—" : `${fleet.avgUtil}%`,
                    comb: fleet.fuelCost == null ? "—" : fmtMoney(fleet.fuelCost),
                    costo: fleet.avgCostPer == null ? "—" : fmtMoney(fleet.avgCostPer),
                  }} />
              </>
            )}
          </div>

          {/* ---------- Puntualidad por chofer, contra la ventana (D-414) ---------- */}
          {/* Justo debajo de los KPIs de choferes: mismo rango, y su «A tiempo» mide otra cosa, así que se leen juntos. */}
          <PuntualidadPorChofer desde={from} hasta={to} entregasDelPanel={scoped} eventos={events} usuarios={users} />

          {/* ---------- Reportes de choferes: ruta planeada vs real, estimado vs real, tiempo por parada (D-907) ---------- */}
          {/* Mismo rango que el Panel. El permiso de verdad lo comprueba /api/driver-reports; aquí solo se esconde la tarjeta. */}
          {puedeVerReportesDeChoferes(me) && <ReportesDeChoferes desde={from} hasta={to} />}

          {/* ---------- Satisfacción del cliente: la encuesta de la página de seguimiento (D-418, 151) ---------- */}
          {/* Mismas órdenes que el resto del Panel (`scoped`): sus tiendas y su rango. Solo admin, logística y gerentes. */}
          <EncuestaDelPanel desde={from} entregasDelPanel={scoped} />

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
              <TablaEstandar id="dash-ociosidad" sinCaja data-tabla="dash-ociosidad" filas={idle} claveDe={(d) => d.driver}
                columnas={[
                  { key: "chofer", en: "Driver", es: "Chofer", ancho: 180, fija: true, valor: (d) => d.driver, celda: (d) => <strong>{d.driver}</strong> },
                  { key: "enturno", en: "On-clock", es: "En turno", ancho: 110, numerico: true, valor: (d) => d.onClockMin, celda: (d) => fmtDuration(d.onClockMin * 60_000) },
                  { key: "activo", en: "Active", es: "Activo", ancho: 110, numerico: true, valor: (d) => d.activeMin, celda: (d) => fmtDuration(d.activeMin * 60_000) },
                  { key: "inactivo", en: "Idle", es: "Inactivo", ancho: 110, numerico: true, valor: (d) => d.idleMin, celda: (d) => (
                    <span style={d.activePct != null && d.activePct < 50 ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{fmtDuration(d.idleMin * 60_000)}</span>
                  ) },
                  { key: "pctactivo", en: "Active %", es: "% Activo", ancho: 100, numerico: true, valor: (d) => d.activePct, celda: (d) => (
                    <span style={d.activePct != null && d.activePct < 50 ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{d.activePct == null ? "—" : `${d.activePct}%`}</span>
                  ) },
                  { key: "entrh", en: "Deliv/hr", es: "Entr/h", ancho: 100, numerico: true, valor: (d) => d.perActiveHr, celda: (d) => (d.perActiveHr == null ? "—" : d.perActiveHr) },
                  { key: "reloj", en: "Status", es: "Estado", ancho: 130, valor: (d) => (d.open ? t("On the clock", "En turno") : null), celda: (d) => (d.open ? <span className="sema" style={{ background: "var(--green)", color: "#fff" }}>{t("On the clock", "En turno")}</span> : null) },
                ]} />
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
              <TablaEstandar id="dash-calidad-choferes" sinCaja data-tabla="dash-calidad-choferes" filas={quality} claveDe={(d) => d.driver}
                columnas={[
                  { key: "chofer", en: "Driver", es: "Chofer", ancho: 180, fija: true, valor: (d) => d.driver, celda: (d) => <strong>{d.driver}</strong> },
                  { key: "acargar", en: "Drive→pickup", es: "A recoger", ancho: 120, numerico: true, valor: (d) => d.avgDriveToPickupMin, celda: (d) => tiempoDe(d.avgDriveToPickupMin) },
                  { key: "transito", en: "Transit", es: "Tránsito", ancho: 110, numerico: true, valor: (d) => d.avgTransitMin, celda: (d) => tiempoDe(d.avgTransitMin) },
                  { key: "parada", en: "Dwell", es: "En parada", ancho: 110, numerico: true, valor: (d) => d.avgDwellMin, celda: (d) => tiempoDe(d.avgDwellMin) },
                  { key: "pod", en: "POD %", es: "% Comp.", ancho: 100, numerico: true, valor: (d) => d.podCompliancePct, celda: (d) => (
                    <span style={d.podCompliancePct != null && d.podCompliancePct < 90 ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{d.podCompliancePct == null ? "—" : `${d.podCompliancePct}%`}</span>
                  ) },
                  { key: "reenvios", en: "Redeliv.", es: "Reenvíos", ancho: 110, numerico: true, valor: (d) => d.redeliveries, celda: (d) => (
                    <span style={d.redeliveries ? { color: "var(--red)", fontWeight: 700 } : undefined}>{d.redeliveries || "—"}{d.redeliveryPct ? ` (${d.redeliveryPct}%)` : ""}</span>
                  ) },
                  { key: "cargacorta", en: "Short loads", es: "Carga corta", ancho: 110, numerico: true, valor: (d) => d.shortLoads, celda: (d) => (
                    <span style={d.shortLoads ? { color: "var(--amber)", fontWeight: 700 } : undefined}>{d.shortLoads || "—"}</span>
                  ) },
                  { key: "gpslejos", en: "GPS off", es: "GPS lejos", ancho: 100, numerico: true, valor: (d) => d.podGpsFar, celda: (d) => (
                    <span style={d.podGpsFar ? { color: "var(--red)", fontWeight: 700 } : undefined} title={d.podGpsChecked ? `${d.podGpsFar}/${d.podGpsChecked} ${t("checked", "verificadas")}` : t("no GPS data yet", "sin datos GPS aún")}>{d.podGpsChecked === 0 ? "—" : (d.podGpsFar || "0")}</span>
                  ) },
                ]} />
            )}
          </div>

          {/* ---------- Sales rep performance, this month ---------- */}
          <div className="card">
            <h2>🧑‍💼 {t("Users — this month", "Usuarios — este mes")}</h2>
            {repStats.length === 0 ? (
              <div className="empty">{t("No orders logged this month.", "Sin órdenes registradas este mes.")}</div>
            ) : (
              <TablaEstandar id="dash-usuarios-mes" sinCaja data-tabla="dash-usuarios-mes" filas={repStats} claveDe={(r) => r.rep}
                columnas={[
                  { key: "usuario", en: "User", es: "Usuario", ancho: 180, fija: true, valor: (r) => r.rep, celda: (r) => <strong>{r.rep}</strong> },
                  { key: "entregas", en: "Deliveries", es: "Entregas", ancho: 110, numerico: true, valor: (r) => r.deliveries },
                  { key: "cobrado", en: "Charged total", es: "Total cobrado", ancho: 130, numerico: true, valor: (r) => r.chargedTotal, celda: (r) => fmtMoney(r.chargedTotal) },
                  { key: "promedio", en: "Avg $/delivery", es: "Prom. $/entrega", ancho: 140, numerico: true, valor: (r) => r.avgPerDelivery, celda: (r) => fmtMoney(r.avgPerDelivery) },
                ]} />
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
                ⏰ {t("Overdue orders", "Órdenes expiradas")} {overdue.length > 0 && <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{overdue.length}</span>}
              </h2>
              {overdue.length === 0 ? (
                <div className="empty">✅ {t("Nothing overdue. Nice.", "Nada expirado. ¡Bien!")}</div>
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
