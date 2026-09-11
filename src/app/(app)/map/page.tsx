"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { driverNames, stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModalLazy";
import { MapView, type MapPoint, type MapLine } from "@/components/MapView";
import { cityFromAddress, deliveryRisk, fallbackDriverColor, fmtDate, fmtWindows, orderLabel, orderOwner, retentionFloorISO, seesAllHistory, shiftDateISO, todayISO } from "@/lib/utils";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { assignmentWarnings, autoAssign, recommendDriver, type AssignWarning } from "@/lib/dispatch";
import type { Delivery } from "@/lib/types";

const UNASSIGNED_COLOR = "#6b7686";
// Matches the Routes Manager default when a driver has no capacity set.
const DEFAULT_CAPACITY = 12;

export default function MapPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, addNote, notify, pushNotifs, ready, driverLocations, realRole } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [open, setOpen] = useState<Delivery | null>(null);

  // Clicking a pin toggles it in a multi-selection. One order selected → its
  // detail + assign panel; several → a bulk-assign panel. Selected orders'
  // pickup→dropoff routes are highlighted.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickupPt, setPickupPt] = useState<{ lat: number; lng: number } | null>(null);
  const [route, setRoute] = useState<{ positions: [number, number][]; miles: number; duration: string } | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  // Draw every unassigned order's pickup→dropoff route on the map, so a
  // dispatcher sees where the day's open work needs to go at a glance.
  const [showRoutes, setShowRoutes] = useState(true);
  // Cached pickup→dropoff geometry per order id (unassigned auto-routes + selected).
  const [routeCache, setRouteCache] = useState<Record<string, [number, number][]>>({});

  const canManageColors = me?.role === "manager" || me?.role === "admin";
  // Everyone who reaches this page except sales can dispatch (warehouse/driver
  // are blocked below); sales sees pins but can't assign.
  const canAssign = !!me && me.role !== "sales";

  // Unlike the Orders page, sales sees every delivery's point on the map —
  // full situational awareness of the day's dispatch activity. But the Map
  // view never opens the order detail modal for sales, even for their own
  // orders — clicking a pin or row is purely visual here; they still edit
  // their orders from the Orders page as usual.
  // La ventana también aquí (D-239): esta pantalla es un día de pedidos que un rol
  // no exento puede abrir, y su selector de fecha llegaba hasta donde uno quisiera.
  // Se acota el SELECTOR además de la lista: filtrar solo la lista dejaría un día
  // vacío sin explicación, y el `min` del campo dice por qué sin escribir un aviso.
  const veTodoElHistorial = seesAllHistory(realRole);
  const pisoFecha = retentionFloorISO();
  const fecha = veTodoElHistorial || date >= pisoFecha ? date : pisoFecha;

  const dayOrders = useMemo(() => {
    return deliveries.filter((d) => d.delivery_date === fecha && d.stage !== "canceled");
  }, [deliveries, fecha]);

  // Unassigned orders that have a delivery point — the ones we auto-route.
  const unassignedOrders = useMemo(
    () => dayOrders.filter((d) => !d.assigned_driver && d.delivery_lat != null && d.delivery_lng != null),
    [dayOrders],
  );

  // Currently multi-selected orders; `selected` is the single one (rich detail).
  const selectedList = useMemo(() => dayOrders.filter((d) => selectedIds.has(d.id)), [dayOrders, selectedIds]);
  const selected = selectedList.length === 1 ? selectedList[0] : null;
  const toggleSelect = (id: string) =>
    setSelectedIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelectedIds(new Set());

  const isMine = (d: Delivery) => me?.role !== "sales" || orderOwner(d) === me.id;

  const openPoint = (d: Delivery) => {
    if (me?.role !== "sales") setOpen(d);
  };

  // Geocode (and cache) any order on this date that has an address but no
  // point yet.
  const geocoding = useAutoGeocode(dayOrders, updateDelivery);
  // Every store as a big red landmark point, always shown on the map.
  const storeMarkers = useStoreMarkers(settings.stores);

  const colorFor = (driver: string | null) => {
    if (!driver) return UNASSIGNED_COLOR;
    return settings.driver_colors?.[driver] || fallbackDriverColor(driver);
  };

  // Drivers currently reporting from the road. Only office roles get these —
  // a salesperson has no business tracking staff.
  const liveDrivers = useMemo(() => {
    if (!canAssign) return [];
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    return driverLocations.flatMap((loc) => {
      const name = nameById.get(loc.driver_id);
      if (!name) return [];
      const ageMin = (Date.now() - new Date(loc.recorded_at).getTime()) / 60000;
      // Older than an hour isn't "live" any more; drop it rather than imply
      // the truck is still sitting there.
      if (ageMin > 60) return [];
      return [{
        driver: name,
        lat: loc.lat,
        lng: loc.lng,
        color: colorFor(name),
        accuracy_m: loc.accuracy_m,
        ageMin,
        label: `🚚 ${name} · ${ageMin < 1 ? t("now", "ahora") : t(`${Math.round(ageMin)} min ago`, `hace ${Math.round(ageMin)} min`)}`,
      }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocations, users, canAssign, settings.driver_colors]);

  // Best-effort pickup coordinates for an order: its own captured point, else
  // geocode the pickup address (or the sold-from store's address).
  const resolvePickup = async (d: Delivery): Promise<{ lat: number; lng: number } | null> => {
    if (d.pickup_lat != null && d.pickup_lng != null) return { lat: d.pickup_lat, lng: d.pickup_lng };
    const addr = (d.pickup_address || settings.stores.find((s) => s.name === d.store)?.address || d.store || "").trim();
    if (!addr) return null;
    try {
      const res = await fetch("/api/geocode-point", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr }) });
      if (!res.ok) return null;
      const p = await res.json();
      return typeof p?.lat === "number" && typeof p?.lng === "number" ? p : null;
    } catch { return null; }
  };

  // Resolve an order's pickup→dropoff road route (geometry + distance + time).
  const fetchOrderRoute = async (d: Delivery): Promise<{ pk: { lat: number; lng: number } | null; positions: [number, number][]; miles: number; duration: string } | null> => {
    if (d.delivery_lat == null || d.delivery_lng == null) return null;
    const pk = await resolvePickup(d);
    if (!pk) return { pk: null, positions: [], miles: 0, duration: "" };
    try {
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: [{ id: "p", lat: pk.lat, lng: pk.lng }, { id: "d", lat: d.delivery_lat, lng: d.delivery_lng }], roundtrip: false }),
      });
      const b = await res.json();
      if (res.ok && Array.isArray(b.geometry) && b.geometry.length) {
        return { pk, positions: (b.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]), miles: b.miles ?? 0, duration: b.duration_text || "" };
      }
    } catch { /* fall through */ }
    return { pk, positions: [], miles: 0, duration: "" };
  };

  // When exactly one order is selected, compute its route detail (distance/time)
  // and pickup pin for the panel.
  useEffect(() => {
    let cancelled = false;
    setRoute(null);
    setPickupPt(null);
    if (!selected) return;
    setRouteBusy(true);
    (async () => {
      const r = await fetchOrderRoute(selected);
      if (cancelled) return;
      setPickupPt(r?.pk ?? null);
      if (r && r.positions.length) {
        setRoute({ positions: r.positions, miles: r.miles, duration: r.duration });
        setRouteCache((prev) => ({ ...prev, [selected.id]: r.positions }));
      }
      setRouteBusy(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Fill in road routes (one at a time, throttled, cached) for the unassigned
  // pool (when enabled) plus every selected order, so all draw on the map.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const targets = [...(showRoutes ? unassignedOrders : []), ...selectedList];
      for (const d of targets) {
        if (cancelled) return;
        if (routeCache[d.id] || d.delivery_lat == null) continue;
        const r = await fetchOrderRoute(d);
        if (cancelled) return;
        if (r && r.positions.length) setRouteCache((prev) => ({ ...prev, [d.id]: r.positions }));
        await new Promise((res) => setTimeout(res, 120));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRoutes, unassignedOrders, selectedList]);

  // Assign (or unassign) a list of orders to one driver — logs an audit note per
  // order and notifies the driver in-app. Clears the selection when done.
  const assignOrders = async (orders: Delivery[], driver: string | null) => {
    if (!orders.length) return;
    setAssignBusy(true);
    const du = driver ? users.find((u) => u.role === "driver" && u.full_name === driver) : null;
    const notifs: { user_id: string; delivery_id: string; order_no: number; kind: string; message: string }[] = [];
    for (const d of orders) {
      const prev = d.assigned_driver;
      const ok = await updateDelivery(d.id, { assigned_driver: driver });
      if (!ok) continue;
      addNote(d.id, driver
        ? `Assigned to ${driver}${prev && prev !== driver ? ` (from ${prev})` : ""}`
        : `Unassigned${prev ? ` (was ${prev})` : ""}`);
      if (du) notifs.push({ user_id: du.id, delivery_id: d.id, order_no: d.order_no, kind: "assigned", message: `Order #${orderLabel(d)} was assigned to you${d.delivery_windows ? ` (${fmtWindows(d.delivery_windows)})` : ""}` });
    }
    if (notifs.length) await pushNotifs(notifs);
    setAssignBusy(false);
    clearSelection();
    notify(driver
      ? t(`${orders.length} order(s) assigned to ${driver}`, `${orders.length} orden(es) asignadas a ${driver}`)
      : t(`${orders.length} order(s) unassigned`, `${orders.length} orden(es) sin asignar`));
  };
  const assignDriver = (driver: string | null) => assignOrders(selectedList, driver);

  // Auto-assign only the selected (unassigned) loads across the drivers.
  const autoAssignSelected = async () => {
    const pool = selectedList.filter((d) => !d.assigned_driver && d.delivery_lat != null);
    if (!pool.length) { notify(t("Select unassigned loads to auto-assign.", "Seleccione cargas sin asignar.")); return; }
    const res = autoAssign(pool, drivers, capacityOf, { maxTripsPerDay: 2 });
    if (!res.assignments.length) { notify(t("Couldn't place the selected loads.", "No se pudieron colocar las cargas.")); return; }
    setAssignBusy(true);
    const byName = new Map(users.filter((u) => u.role === "driver").map((u) => [u.full_name, u]));
    const notifs: { user_id: string; delivery_id: string; order_no: number; kind: string; message: string }[] = [];
    for (const a of res.assignments) {
      const d = pool.find((x) => x.id === a.orderId)!;
      const ok = await updateDelivery(a.orderId, { assigned_driver: a.driver });
      if (!ok) continue;
      addNote(a.orderId, `Assigned to ${a.driver}`);
      const u = byName.get(a.driver);
      if (u) notifs.push({ user_id: u.id, delivery_id: a.orderId, order_no: d.order_no, kind: "assigned", message: `Order #${orderLabel(d)} was assigned to you${d.delivery_windows ? ` (${fmtWindows(d.delivery_windows)})` : ""}` });
    }
    if (notifs.length) await pushNotifs(notifs);
    setAssignBusy(false);
    clearSelection();
    notify(t(`Auto-assigned ${res.assignments.length} load(s)`, `Auto-asignadas ${res.assignments.length} carga(s)`));
  };

  const points: MapPoint[] = useMemo(
    () => {
      const pts: MapPoint[] = dayOrders
        .filter((d) => d.delivery_lat != null && d.delivery_lng != null)
        .map((d) => ({
          id: d.id,
          lat: d.delivery_lat!,
          lng: d.delivery_lng!,
          color: colorFor(d.assigned_driver),
          // Not your order (sales only): the label reveals nothing beyond
          // "there's a delivery here" — no account, no driver.
          label: isMine(d)
            ? `#${orderLabel(d)} — ${d.account || t("(no account)", "(sin cuenta)")} — ${d.assigned_driver || t("Unassigned", "Sin asignar")}`
            : t("Delivery", "Entrega"),
          // Dim everything that isn't selected once a selection exists.
          dimmed: selectedIds.size > 0 && !selectedIds.has(d.id),
        }));
      // A single selected order's pickup point, marked "P".
      if (selected && pickupPt) {
        pts.push({ id: "__pickup", lat: pickupPt.lat, lng: pickupPt.lng, color: "#111827", label: `${t("Pickup", "Recolección")}: ${selected.store || ""}`, badge: "P" });
      }
      return pts;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayOrders, settings.driver_colors, me, selectedIds, selected, pickupPt],
  );

  // Selected orders' routes in blue; the unassigned pool in gray (dimmed while
  // a selection is active).
  const lines: MapLine[] = useMemo(() => {
    const out: MapLine[] = [];
    const hasSel = selectedIds.size > 0;
    if (showRoutes) {
      for (const d of unassignedOrders) {
        if (selectedIds.has(d.id)) continue;
        const pos = routeCache[d.id];
        if (pos && pos.length) out.push({ id: `u:${d.id}`, color: UNASSIGNED_COLOR, positions: pos, dashed: true, dimmed: hasSel });
      }
    }
    for (const d of selectedList) {
      const pos = routeCache[d.id];
      if (pos && pos.length) out.push({ id: `s:${d.id}`, color: "#2456c9", positions: pos });
    }
    return out;
  }, [showRoutes, unassignedOrders, routeCache, selectedIds, selectedList]);

  // Zoom to the selected orders (their delivery points + any drawn routes).
  const fitTo = useMemo<[number, number][] | undefined>(() => {
    if (selectedList.length === 0) return undefined;
    const pts: [number, number][] = [];
    for (const d of selectedList) {
      if (d.delivery_lat != null && d.delivery_lng != null) pts.push([d.delivery_lat, d.delivery_lng]);
      const pos = routeCache[d.id];
      if (pos) pts.push(...pos);
    }
    return pts.length ? pts : undefined;
  }, [selectedList, routeCache]);

  const drivers = driverNames(users);
  const missingPoints = dayOrders.length - points.length;

  // Smart-assist for the selected order: a recommended driver, plus warnings
  // (window conflict / over capacity) for whoever is currently assigned.
  const capacityOf = (n: string) => settings.driver_capacity?.[n] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
  const recommendation = useMemo(
    () => (selected ? recommendDriver(selected, drivers, deliveries, capacityOf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, drivers, deliveries, settings.driver_capacity],
  );
  const currentWarnings = useMemo(
    () => (selected?.assigned_driver ? assignmentWarnings(selected, selected.assigned_driver, deliveries, capacityOf(selected.assigned_driver)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, deliveries, settings.driver_capacity],
  );
  const warnText = (w: AssignWarning) =>
    w.kind === "conflict"
      ? t(
          `Overlaps ${w.conflicts!.map((c) => `#${orderLabel(c)} (${fmtWindows(c.delivery_windows)})`).join(", ")}`,
          `Se traslapa con ${w.conflicts!.map((c) => `#${orderLabel(c)} (${fmtWindows(c.delivery_windows)})`).join(", ")}`,
        )
      : t(
          `Over capacity: ${w.used} + ${w.adding} > ${w.capacity} pallets`,
          `Sobre capacidad: ${w.used} + ${w.adding} > ${w.capacity} pallets`,
        );

  const riskChip = (risk: "overdue" | "at_risk" | null) => {
    if (!risk) return null;
    const over = risk === "overdue";
    return (
      <span className="sema" style={{ background: over ? "var(--red, #d64545)" : "var(--amber, #e9a13b)", color: "#fff", marginLeft: 6 }}>
        {over ? t("Overdue", "Atrasada") : t("At risk", "En riesgo")}
      </span>
    );
  };

  // From/To/pallets summary for this date — same "own orders only" boundary
  // as everything else on this page for sales.
  const cityNames = settings.stores.map((s) => s.name);
  const summaryRows = useMemo(
    () =>
      dayOrders
        .filter(isMine)
        .map((d) => ({
          id: d.id,
          order_no: d.order_no,
          label: orderLabel(d),
          from: d.store || "—",
          to: cityFromAddress(d.delivery_address, cityNames),
          pallets: d.actual_pallets ?? d.est_pallets ?? null,
          windows: d.delivery_windows || "",
          stage: d.stage,
          risk: deliveryRisk(d),
        }))
        .sort((a, b) => a.windows.localeCompare(b.windows) || a.order_no - b.order_no),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayOrders, me],
  );
  const totalPallets = summaryRows.reduce((sum, r) => sum + (r.pallets ?? 0), 0);

  if (!me) return null;
  if (me.role === "warehouse" || me.role === "driver") return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;

  return (
    <>
      <div className="page-head">
        <h2>{t("Delivery Map", "Mapa de Entregas")} <span className="count-tag">{points.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" onClick={() => setDate((d) => { const p = shiftDateISO(d, -1); return veTodoElHistorial || p >= pisoFecha ? p : d; })} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={fecha} min={veTodoElHistorial ? undefined : pisoFecha} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
            <button className="vt" onClick={() => setDate((d) => shiftDateISO(d, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {date !== todayISO() && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayISO())}>{t("Today", "Hoy")}</button>
          )}
          {canAssign && unassignedOrders.length > 0 && (
            <button
              className={"btn btn-sm " + (showRoutes ? "btn-primary" : "btn-ghost")}
              onClick={() => setShowRoutes((v) => !v)}
              title={t("Show each unassigned order's pickup→dropoff route", "Mostrar la ruta recolección→entrega de cada orden sin asignar")}
            >
              🧭 {t("Unassigned routes", "Rutas sin asignar")} ({unassignedOrders.length})
            </button>
          )}
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <MapView points={points} lines={lines} stores={storeMarkers} liveDrivers={liveDrivers} fitTo={fitTo} onPointClick={(id) => {
          if (id === "__pickup") return;
          const d = dayOrders.find((x) => x.id === id);
          if (!d) return;
          // Sales: pins are visual only. Everyone else: toggle it in the selection.
          if (canAssign) toggleSelect(d.id); else openPoint(d);
        }} />
      </div>

      {selected && canAssign && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>
              #{orderLabel(selected)} — {selected.account || t("(no account)", "(sin cuenta)")}{" "}
              <span className="sema" style={{ background: stageInfo(selected.stage).color, color: "#fff" }}>{stageLabel(selected.stage, lang)}</span>
              {riskChip(deliveryRisk(selected))}
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={clearSelection}>✕ {t("Close", "Cerrar")}</button>
          </div>
          <div className="detail-row"><span className="dk">{t("Route", "Ruta")}</span><span className="dv">{selected.store || "—"} → {cityFromAddress(selected.delivery_address, cityNames) || selected.delivery_address || "—"}</span></div>
          <div className="detail-row"><span className="dk">{t("Window", "Ventana")}</span><span className="dv">{fmtWindows(selected.delivery_windows)}</span></div>
          <div className="detail-row"><span className="dk">{t("Pallets", "Pallets")}</span><span className="dv">{selected.actual_pallets ?? selected.est_pallets ?? "—"}</span></div>
          <div className="detail-row">
            <span className="dk">{t("Pickup → Dropoff", "Recolección → Entrega")}</span>
            <span className="dv" style={{ fontWeight: 700 }}>
              {routeBusy
                ? t("Calculating…", "Calculando…")
                : route
                  ? `${route.miles} mi · ${route.duration}`
                  : t("Route unavailable", "Ruta no disponible")}
            </span>
          </div>
          {recommendation && recommendation.driver !== selected.assigned_driver && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5 }}>
                {t("Suggested", "Sugerido")}: <b>★ {recommendation.driver}</b>
                {recommendation.warnings.length === 0
                  ? <span className="sema" style={{ background: "var(--green)", color: "#fff", marginLeft: 8 }}>{t("clear", "sin conflictos")}</span>
                  : <span className="hint" style={{ marginLeft: 8 }}>{t("(best available)", "(mejor disponible)")}</span>}
              </span>
              <button className="btn btn-sm btn-primary" disabled={assignBusy} onClick={() => assignDriver(recommendation.driver)}>
                {t("Assign", "Asignar")}
              </button>
            </div>
          )}

          <div className="field" style={{ maxWidth: 320, marginTop: 10 }}>
            <label>{t("Assign driver", "Asignar chofer")}</label>
            <select value={selected.assigned_driver ?? ""} disabled={assignBusy} onChange={(e) => assignDriver(e.target.value || null)}>
              <option value="">{t("Unassigned", "Sin asignar")}</option>
              {drivers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {currentWarnings.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {currentWarnings.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--amber, #e9a13b) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--amber, #e9a13b) 45%, transparent)", fontSize: 13.5 }}>
                  <span aria-hidden>⚠️</span><span>{warnText(w)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(selected)}>{t("Open full order", "Abrir orden completa")}</button>
          </div>
        </div>
      )}

      {/* ---------- Multi-select panel ---------- */}
      {selectedList.length > 1 && canAssign && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>
              {selectedList.length} {t("loads selected", "cargas seleccionadas")}{" "}
              <span className="count-tag">{Math.round(selectedList.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0))} {t("pallets", "pallets")}</span>
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={clearSelection}>✕ {t("Clear", "Limpiar")}</button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>{t("Their routes are highlighted in blue. Assign all to one driver, or auto-assign the unassigned ones.", "Sus rutas se resaltan en azul. Asigne todas a un chofer, o auto-asigne las que estén sin asignar.")}</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            <select defaultValue="" disabled={assignBusy} style={{ width: "auto" }}
              onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) assignOrders(selectedList, v); }}>
              <option value="">{t("Assign all to…", "Asignar todas a…")}</option>
              {drivers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="btn btn-amber btn-sm" disabled={assignBusy} onClick={autoAssignSelected}>✨ {t("Auto-assign selected", "Auto-asignar selección")}</button>
            <button className="btn btn-ghost btn-sm" disabled={assignBusy} onClick={() => assignOrders(selectedList, null)}>{t("Unassign", "Quitar")}</button>
          </div>
        </div>
      )}

      {missingPoints > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t(
            `${missingPoints} order(s) on this date have no address to place on the map yet.`,
            `${missingPoints} orden(es) en esta fecha aún no tienen dirección para ubicar en el mapa.`,
          )}
        </div>
      )}

      <div className="card">
        <h2>📋 {t("Summary", "Resumen")} — {fmtDate(date)}</h2>
        {summaryRows.length === 0 ? (
          <div className="empty">{t("No orders on this date.", "Sin órdenes en esta fecha.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>{t("ID", "ID")}</th>
                  <th>{t("From", "Desde")}</th>
                  <th>{t("To", "Hasta")}</th>
                  <th>{t("Windows", "Ventanas")}</th>
                  <th>{t("Status", "Estado")}</th>
                  <th>{t("Pallets", "Pallets")}</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => {
                  const s = stageInfo(r.stage);
                  return (
                    <tr
                      key={r.id}
                      className={me.role === "sales" ? "" : "clickable"}
                      onClick={() => { const d = dayOrders.find((x) => x.id === r.id); if (d) openPoint(d); }}
                    >
                      <td className="ordno">#{r.label}</td>
                      <td>{r.from}</td>
                      <td>{r.to}</td>
                      <td>{r.windows || "—"}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(r.stage, lang)}</span>{riskChip(r.risk)}</td>
                      <td>{r.pallets ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ fontWeight: 700, textAlign: "right" }}>{t("Total pallets", "Total de pallets")}</td>
                  <td style={{ fontWeight: 700 }}>{totalPallets}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>🎨 {t("Driver colors", "Colores de chofer")}</h2>
        {!canManageColors && <p className="hint" style={{ marginTop: 0 }}>{t("Assigned by a manager or admin.", "Asignados por un gerente o administrador.")}</p>}
        {drivers.length === 0 ? (
          <div className="empty">{t("No one has the Driver role yet.", "Nadie tiene el rol de Chofer todavía.")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {drivers.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: colorFor(name), border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                {canManageColors && (
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(settings.driver_colors?.[name] || "") ? settings.driver_colors![name] : fallbackDriverColor(name)}
                    onChange={(e) => saveSettings({ driver_colors: { ...(settings.driver_colors ?? {}), [name]: e.target.value } })}
                    style={{ width: 28, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }}
                  />
                )}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", background: UNASSIGNED_COLOR, border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Unassigned", "Sin asignar")}</span>
            </div>
          </div>
        )}
      </div>

      {!ready && <div className="empty">{t("Loading…", "Cargando…")}</div>}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
