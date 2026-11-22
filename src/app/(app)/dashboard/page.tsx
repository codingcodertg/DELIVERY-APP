"use client";

import { useEffect, useMemo, useState } from "react";
import { AttentionPanel } from "@/components/AttentionPanel";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import {
  approvalTurnaroundMs, driverKpis, driverQualityKpis, driverShiftKpis, inDateRange, salesRepStatsThisMonth,
} from "@/lib/analytics";
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
import type { Delivery } from "@/lib/types";
import { redondeaDinero, sumaDinero, sumaMillas } from "@/lib/totales";
import { alcanceDelPanel, choferesDelPanel, ordenesDelPanel } from "@/lib/panel-por-tienda";
import { millasPorTienda, paradasDeMillas } from "@/lib/millas-por-tienda";
import { TituloPlegable } from "@/components/TituloPlegable";
import { esTraslado, separaTraslados } from "@/lib/traslados-de-chofer";
import { ResumenDeChoferes } from "@/components/ResumenDeChoferes";
import { TablaDinamica } from "@/components/TablaDinamica";
import { HoyDelPanel } from "@/components/panel/HoyDelPanel";
import { IndicadoresDelPanel } from "@/components/panel/IndicadoresDelPanel";
import { TendenciaDelPanel } from "@/components/panel/TendenciaDelPanel";
import { ComparacionDelPanel } from "@/components/panel/ComparacionDelPanel";
import { OrderModal } from "@/components/OrderModalLazy";
import { periodoAnterior, resumenDelPeriodo, seriePorPeriodo } from "@/lib/panel-resumen";
import "./panel.css";

/** Las secciones del Panel (D-1127). */
const SECCIONES = [
  { key: "resumen", en: "📊 Summary", es: "📊 Resumen" },
  { key: "explorar", en: "🧮 Pivot tables", es: "🧮 Tablas dinámicas" },
  { key: "choferes", en: "🚚 Drivers", es: "🚚 Choferes" },
  { key: "tiendas", en: "🏬 Stores & accounts", es: "🏬 Tiendas y cuentas" },
] as const;

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
  const [from, setFrom] = useState(daysAgoISO(30));
  // G-16: the provider keeps DELIVERIES_WINDOW_DAYS of orders; a range that starts earlier asks
  // for the rest on demand (idempotent, no-op when already loaded).
  useEffect(() => { void ensureDeliveriesSince(from); }, [from, ensureDeliveriesSince]);
  const [to, setTo] = useState(todayISO());
  const [rangeMode, setRangeMode] = useState<RangeMode>("custom");
  // Las tablas de choferes (detalle) se ven solo si se pide: el resumen de arriba es lo que se lee.
  const [verDetalles, setVerDetalles] = useState(false);

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
  const alcanceBase = useMemo(() => alcanceDelPanel(me, settings.stores), [me, settings.stores]);
  // Quien ve todas (admin, logística) puede mirar UNA tienda: ve lo mismo que vería su gerente (D-1127).
  const [tiendaElegida, setTiendaElegida] = useState("");
  const alcance = useMemo(
    () => (alcanceBase.tipo === "todas" && tiendaElegida ? alcanceDelPanel({ role: "manager", store: tiendaElegida, permissions: [] }, settings.stores) : alcanceBase),
    [alcanceBase, tiendaElegida, settings.stores],
  );
  const delPanel = useMemo(
    () => ordenesDelPanel(deliveries, alcance, settings.order_type_rules),
    [deliveries, alcance, settings.order_type_rules],
  );
  const misChoferes = useMemo(() => choferesDelPanel(alcance, users), [alcance, users]);

  // Everything below is scoped to the selected delivery-date range.
  const scoped = useMemo(() => inDateRange(delPanel, from, to), [delPanel, from, to]);
  // Entregas a cliente del rango: lo que cuenta como entrega en puntualidad, calidad y tiempos (los traslados, aparte).
  const clientesDelRango = useMemo(
    () => separaTraslados(scoped, settings.order_type_rules).clientes,
    [scoped, settings.order_type_rules],
  );

  // El resumen (D-1127): el periodo, el periodo anterior (misma duración, justo antes) y la serie para la gráfica.
  const hoyISO = todayISO();
  const anterior = useMemo(() => periodoAnterior(from, to, rangeMode === "month"), [from, to, rangeMode]);
  useEffect(() => { void ensureDeliveriesSince(anterior.from); }, [anterior.from, ensureDeliveriesSince]);
  const resumen = useMemo(() => resumenDelPeriodo(scoped, hoyISO), [scoped, hoyISO]);
  const resumenAnterior = useMemo(() => resumenDelPeriodo(inDateRange(delPanel, anterior.from, anterior.to), hoyISO), [delPanel, anterior, hoyISO]);
  const serie = useMemo(
    () => seriePorPeriodo(scoped, from, to, (d) => esTraslado(d.order_type, settings.order_type_rules), hoyISO),
    [scoped, from, to, settings.order_type_rules, hoyISO],
  );
  const variasTiendas = alcance.tipo === "todas" || (alcance.tipo === "tiendas" && alcance.nombres.length > 1);
  const [vista, setVista] = useState<(typeof SECCIONES)[number]["key"]>("resumen");
  const [abierta, setAbierta] = useState<Delivery | null>(null);
  const textoDeRango = (a: string, b: string) => {
    const f = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", year: a.slice(0, 4) === b.slice(0, 4) ? undefined : "numeric" });
    return a === b ? f(a) : `${f(a)} – ${f(b)}`;
  };

  const drivers = useMemo(
    () => driverKpis(
      scoped,
      (n) => settings.driver_capacity?.[n] ?? DEFAULT_CAPACITY,
      { fuelPrice: settings.fuel_price, mpg: settings.fleet_mpg, base: settings.cost_per_delivery },
      settings.order_type_rules,
    ),
    [scoped, settings.driver_capacity, settings.fuel_price, settings.fleet_mpg, settings.cost_per_delivery, settings.order_type_rules],
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
    return driverShiftKpis(shiftScoped, activas, (id) => nameById.get(id), Date.now(), (d) => !esTraslado(d.order_type, settings.order_type_rules));
  }, [shifts, users, scoped, deliveries, misChoferes, from, to, settings.order_type_rules]);

  // Timing + quality KPIs (Tier 1) over the scoped deliveries.
  const quality = useMemo(() => driverQualityKpis(clientesDelRango), [clientesDelRango]);


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
  // Millas y reparto del gas por tienda (D-738): paradas de las órdenes entregadas/recogidas del rango,
  // y la Intertienda la paga la tienda que recibe. Las reglas, en `millas-por-tienda.ts`.
  const gas = useMemo(
    () => millasPorTienda(paradasDeMillas(scoped, settings.stores, settings.order_type_rules)),
    [scoped, settings.stores, settings.order_type_rules],
  );
  const turnaround = useMemo(() => approvalTurnaroundMs(scoped, events), [scoped, events]);
  // Not scoped to the from/to range picker above — this is always "this
  // calendar month", regardless of what range is selected elsewhere on the page.
  const repStats = useMemo(() => salesRepStatsThisMonth(delPanel, users), [delPanel, users]);

  if (!me) return null;


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
      "Driver", "Customer orders", "Customer delivered", "Transfers", "Transfers delivered", "On-time %", "Avg delay (min)", "Stops/route", "Miles",
      "Revenue", "$/mi", "Pallet util %", "Fuel", "Cost/delivery", 
      "On-clock (min)", "Active (min)", "Idle (min)", "Active %", "Deliveries/hr",
      "Drive→pickup (min)", "Transit (min)", "Dwell (min)", "POD compliance %",
      "Redeliveries", "Redelivery %", "Short loads", "GPS checked", "GPS off",
    ];
    const rows = [...names].map((name) => {
      const p = perf.get(name); const i = idl.get(name); const q = qual.get(name);
      return [
        name, p?.orders ?? "", p?.delivered ?? "", p?.transfers ?? "", p?.transfersDelivered ?? "", p?.onTimePct ?? "", p?.avgDelayMin ?? "", p?.avgStops ?? "", p?.miles ?? "",
        p?.revenue ?? "", p?.revPerMile ?? "", p?.utilizationPct ?? "", p?.fuelCost ?? "", p?.costPerDelivery ?? "",
        i?.onClockMin ?? "", i?.activeMin ?? "", i?.idleMin ?? "", i?.activePct ?? "", i?.perActiveHr ?? "",
        q?.avgDriveToPickupMin ?? "", q?.avgTransitMin ?? "", q?.avgDwellMin ?? "", q?.podCompliancePct ?? "",
        q?.redeliveries ?? "", q?.redeliveryPct ?? "", q?.shortLoads ?? "", q?.podGpsChecked ?? "", q?.podGpsFar ?? "",
      ];
    });
    downloadCSV(`driver_stats_${from}_to_${to}.csv`, toCSV(headers, rows));
  };


  // Tablas de choferes y tienda: `TablaEstandar` (▾ ⚙ mover y anchos). Mismos números y formatos que antes.
  const num1 = (n: number) => n.toLocaleString(lang === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const tiempoDe = (min: number | null | undefined) => (min == null ? "—" : fmtDuration(min * 60_000));
  const pctTexto = (v: number | null) => (v == null ? "—" : `${num1(v)} %`);

  return (
    <div className="panel-app">
      {/* Above the KPIs on purpose: these are the things nothing else would
          have told anyone about. Renders nothing when the board is healthy. */}
      <AttentionPanel deliveries={delPanel} onOpen={(d) => setAbierta(d)} />
      <div className="page-head">
        <h2>{t("Dashboard", "Panel")}</h2>
        {me?.role === "admin" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={exportRange} disabled={!scoped.length}>⬇ {t("Export range", "Exportar rango")}</button>
            <button className="btn btn-ghost btn-sm" onClick={exportDrivers} disabled={!drivers.length && !idle.length}>⬇ {t("Export driver stats", "Exportar stats de choferes")}</button>
          </div>
        )}
      </div>

      {/* Una sola fila de filtros, arriba de todo lo que acotan: el periodo y (quien ve todas) la tienda. */}
      <div className="panel-filtros" data-panel-filtros>
        <button className={"btn btn-sm " + (from === todayISO() && to === todayISO() ? "btn-primary" : "btn-ghost")} onClick={today}>{t("Today", "Hoy")}</button>
        <button className={"btn btn-sm " + (rangeMode === "week" && from === startOfWeekISO() ? "btn-primary" : "btn-ghost")} onClick={thisWeek}>{t("This week", "Esta semana")}</button>
        <button className={"btn btn-sm " + (rangeMode === "month" && from === startOfMonthISO() ? "btn-primary" : "btn-ghost")} onClick={thisMonth}>{t("This month", "Este mes")}</button>
        <button className="btn btn-ghost btn-sm" onClick={lastMonth}>{t("Last month", "Mes pasado")}</button>
        <button className={"btn btn-sm " + (rangeMode === "custom" && from === daysAgoISO(30) && to === todayISO() ? "btn-primary" : "btn-ghost")} onClick={() => setRange(daysAgoISO(30), todayISO(), "custom")}>{t("Last 30 days", "Últimos 30 días")}</button>
        <span className="sep" />
        <button className="btn btn-ghost btn-sm" onClick={() => step(-1)} title={t("Previous period", "Período anterior")} aria-label={t("Previous period", "Período anterior")}>◀</button>
        <input type="date" value={from} max={to} aria-label={t("From", "Desde")} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setRangeMode("custom"); } }} />
        <span className="hint" style={{ margin: 0 }}>→</span>
        <input type="date" value={to} min={from} max={todayISO()} aria-label={t("To", "Hasta")} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setRangeMode("custom"); } }} />
        <button className="btn btn-ghost btn-sm" onClick={() => step(1)} title={t("Next period", "Período siguiente")} aria-label={t("Next period", "Período siguiente")}>▶</button>
        {alcanceBase.tipo === "todas" && (
          <>
            <span className="sep" />
            <select value={tiendaElegida} onChange={(e) => setTiendaElegida(e.target.value)} aria-label={t("Store", "Tienda")} data-panel-tienda>
              <option value="">{t("All stores", "Todas las tiendas")}</option>
              {settings.stores.map((st) => <option key={st.name} value={st.name}>{st.name}</option>)}
            </select>
          </>
        )}
      </div>

      {alcance.tipo === "tiendas" && (
        <p className="hint" data-panel-tiendas style={{ marginTop: -4, marginBottom: 12 }}>
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
          {/* Las secciones (D-1127): el Resumen cabe en una pantalla; lo demás, a un clic, con los mismos filtros. */}
          <div className="panel-secciones">
            <div className="viewtoggle" role="tablist" data-panel-secciones>
              {SECCIONES.map((sec) => (
                <button key={sec.key} role="tab" aria-selected={vista === sec.key} className={"vt " + (vista === sec.key ? "on" : "")} onClick={() => setVista(sec.key)}>{t(sec.en, sec.es)}</button>
              ))}
            </div>
          </div>

          {vista === "resumen" && (
            <>
              <HoyDelPanel ordenes={delPanel} onAbrir={setAbierta} />
              <h3 className="hint" style={{ margin: "4px 2px 8px", fontSize: 13, fontWeight: 700 }}>{t("The period", "El periodo")}: {textoDeRango(from, to)}</h3>
              <IndicadoresDelPanel actual={resumen} anterior={resumenAnterior} cubetas={serie.cubetas} rangoAnterior={textoDeRango(anterior.from, anterior.to)} />
              {turnaround.avgMs != null && (
                <p className="hint" data-panel-aprobacion style={{ margin: "-6px 2px 14px" }}>
                  {t("Average time to approve an order", "Tiempo promedio para aprobar una orden")}: <b>{fmtDuration(turnaround.avgMs)}</b> ({turnaround.count} {t("approved", "aprobadas")})
                </p>
              )}
              <TendenciaDelPanel cubetas={serie.cubetas} grano={serie.grano} />
              {variasTiendas && <ComparacionDelPanel ordenes={scoped} hoy={todayISO()} por="tienda" id="dash-por-tienda" titulo={t("Stores compared", "Comparación entre tiendas")} />}
            </>
          )}

          {vista === "choferes" && (
            <>
          {/* ---------- Resumen de choferes: una tarjeta por chofer, ocho cifras, mes elegible (junta 2026-11-19) ---------- */}
          <ResumenDeChoferes ordenes={delPanel} choferesIds={misChoferes?.ids ?? null} />
          <div style={{ display: "flex", justifyContent: "center", margin: "0 0 16px" }}>
            <button className="btn btn-ghost" onClick={() => setVerDetalles((v) => !v)} aria-expanded={verDetalles} data-detalles-choferes>
              {verDetalles ? t("Hide driver details ▴", "Ocultar detalles de choferes ▴") : t("Show driver details ▾", "Ver detalles de choferes ▾")}
            </button>
          </div>
          {verDetalles && (
            <>
          {/* ---------- Driver & fleet KPIs ---------- */}
          <div className="card">
            <TituloPlegable>🚚 {t("Driver & fleet KPIs", "KPIs de choferes y flota")}</TituloPlegable>
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
                    { key: "ordenes", en: "Customer deliveries", es: "Entregas a clientes", ancho: 150, numerico: true, valor: (d) => d.orders },
                    { key: "entregadas", en: "Delivered", es: "Entregadas", ancho: 110, numerico: true, valor: (d) => d.delivered },
                    { key: "traslados", en: "Transfers", es: "Traslados", ancho: 110, numerico: true, valor: (d) => d.transfers, celda: (d) => (
                      <span title={t(`${d.transfersDelivered} delivered`, `${d.transfersDelivered} entregados`)}>{d.transfers || "—"}</span>
                    ) },
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
                    traslados: drivers.reduce((s, d) => s + d.transfers, 0),
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
          <PuntualidadPorChofer desde={from} hasta={to} entregasDelPanel={clientesDelRango} eventos={events} usuarios={users} />

          {/* ---------- Reportes de choferes: ruta planeada vs real, estimado vs real, tiempo por parada (D-907) ---------- */}
          {/* Mismo rango que el Panel. El permiso de verdad lo comprueba /api/driver-reports; aquí solo se esconde la tarjeta. */}
          {puedeVerReportesDeChoferes(me) && <ReportesDeChoferes desde={from} hasta={to} />}

          {/* ---------- Driver idle time (shift clock) ---------- */}
          <div className="card">
            <TituloPlegable>⏱️ {t("Driver idle time", "Tiempo inactivo de choferes")}</TituloPlegable>
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

            </>
          )}
            </>
          )}

          {vista === "tiendas" && (
            <>
              {!variasTiendas && <ComparacionDelPanel ordenes={scoped} hoy={todayISO()} por="tienda" id="dash-por-tienda" titulo={t("Your store in the period", "Su tienda en el periodo")} />}
              {/* Solo entregas a clientes: en un traslado la «cuenta» es otra tienda, y no es un cliente. */}
              <ComparacionDelPanel ordenes={clientesDelRango} hoy={todayISO()} por="cuenta" id="dash-por-cuenta" tope={10} titulo={t("Top accounts (customer deliveries)", "Cuentas principales (entregas a clientes)")} />
          {/* ---------- Millas y gas por tienda (D-738) ---------- */}
          <div className="card" data-panel-millas-por-tienda>
            <TituloPlegable>⛽ {t("Miles & fuel share by store", "Millas y gas por tienda")}</TituloPlegable>
            <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
              {t(
                "Delivered or picked-up orders in the range, grouped into stops (same day, driver and destination). Store-to-store orders count for the store that receives. Miles are Google's store → destination.",
                "Órdenes entregadas o recogidas del rango, juntadas por parada (mismo día, chofer y destino). Las Intertiendas cuentan para la tienda que recibe. Millas de Google tienda → destino.",
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
                  { key: "mi-cli", en: "Customer mi", es: "Cliente mi", ancho: 120, numerico: true, valor: (f) => f.millasCliente, celda: (f) => num1(f.millasCliente) },
                  { key: "n-cli", en: "Customer #", es: "Cliente #", ancho: 110, numerico: true, valor: (f) => f.ordenesCliente },
                  { key: "mi-inter", en: "Intertienda mi", es: "Intertienda mi", ancho: 120, numerico: true, valor: (f) => f.millasIntertienda, celda: (f) => num1(f.millasIntertienda) },
                  { key: "n-inter", en: "Intertienda #", es: "Intertienda #", ancho: 110, numerico: true, valor: (f) => f.ordenesIntertienda },
                  { key: "mi-otro", en: "Other mi", es: "Otro mi", ancho: 120, numerico: true, valor: (f) => f.millasOtro, celda: (f) => num1(f.millasOtro) },
                  { key: "n-otro", en: "Other #", es: "Otro #", ancho: 110, numerico: true, valor: (f) => f.ordenesOtro },
                  { key: "gas", en: "% of fuel", es: "% del gas", ancho: 110, numerico: true, valor: (f) => f.pctGas, celda: (f) => <strong>{pctTexto(f.pctGas)}</strong> },
                ]}
                totales={{
                  tienda: t("Total", "Total"),
                  paradas: <strong>{gas.total.paradas}</strong>,
                  ordenes: <strong>{gas.total.ordenes}</strong>,
                  millas: <strong>{num1(gas.total.millas)}</strong>,
                  "mi-cli": <strong>{num1(gas.total.millasCliente)}</strong>,
                  "n-cli": <strong>{gas.total.ordenesCliente}</strong>,
                  "mi-inter": <strong>{num1(gas.total.millasIntertienda)}</strong>,
                  "n-inter": <strong>{gas.total.ordenesIntertienda}</strong>,
                  "mi-otro": <strong>{num1(gas.total.millasOtro)}</strong>,
                  "n-otro": <strong>{gas.total.ordenesOtro}</strong>,
                  gas: <strong>{pctTexto(gas.total.pctGas)}</strong>,
                }} />

            )}
          </div>

          {/* ---------- Satisfacción del cliente: la encuesta de la página de seguimiento (D-418, 151) ---------- */}
          {/* Mismas órdenes que el resto del Panel (`scoped`): sus tiendas y su rango. Solo admin, logística y gerentes. */}
          <EncuestaDelPanel desde={from} entregasDelPanel={scoped} />

          {/* ---------- Sales rep performance, this month ---------- */}
          <div className="card">
            <TituloPlegable>🧑‍💼 {t("Users — this month", "Usuarios — este mes")}</TituloPlegable>
            {repStats.length === 0 ? (
              <div className="empty">{t("No orders logged this month.", "Sin órdenes registradas este mes.")}</div>
            ) : (
              <TablaEstandar id="dash-usuarios-mes" sinCaja data-tabla="dash-usuarios-mes" filas={repStats} claveDe={(r) => r.rep}
                columnas={[
                  { key: "usuario", en: "User", es: "Usuario", ancho: 180, fija: true, valor: (r) => r.rep, celda: (r) => <strong>{r.rep}</strong> },
                  { key: "entregas", en: "Deliveries", es: "Entregas", ancho: 110, numerico: true, valor: (r) => r.deliveries },
                  { key: "cobrado", en: "Charged total", es: "Total cobrado", ancho: 130, numerico: true, valor: (r) => r.chargedTotal, celda: (r) => fmtMoney(r.chargedTotal) },
                  { key: "promedio", en: "Avg $/delivery", es: "Prom. $/entrega", ancho: 140, numerico: true, valor: (r) => r.avgPerDelivery, celda: (r) => fmtMoney(r.avgPerDelivery) },
                  { key: "millas", en: "Miles", es: "Millas", ancho: 100, numerico: true, valor: (r) => r.miles, celda: (r) => num1(r.miles) },
                  { key: "dolarmi", en: "$/mi", es: "$/mi", ancho: 100, numerico: true, valor: (r) => r.revPerMile, celda: (r) => (r.revPerMile == null ? "—" : <strong>{fmtMoney(r.revPerMile)}</strong>) },
                ]} />
            )}
          </div>
            </>
          )}

          {vista === "explorar" && <TablaDinamica ordenes={scoped} clientes={clientesDelRango} usuarios={users} />}
        </>
      )}
      {abierta && <OrderModal me={me} existing={abierta} startEditing={false} onClose={() => setAbierta(null)} />}
    </div>
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
