"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { captureLocationSplit } from "@/lib/geo";
import { accionParada, escrituraRecogida, extraEntrega } from "@/lib/one-tap-stop";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { routeOrder, splitIntoTrips } from "@/lib/dispatch";
import { groupIntoLoads, hasManualLoads } from "@/lib/route-lanes";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { OrderModal } from "@/components/OrderModalLazy";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { fallbackDriverColor, fmtDate, fmtWindows, isOverdue, orderLabel, storeTag, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// "My route" — the driver's read-only copy of what logistics planned.
//
// Deliberately NOT the dispatcher's screen with the controls removed. A
// dispatcher is arranging a whole fleet at a desk; a driver is in a cab with
// one question at a time. So this leads with the NEXT stop, then shows the
// day's sequence to plan ahead, and never offers reordering, reassignment or
// optimisation — those stay logistics' job.
//
// What it does let them do is finish the work: each stop opens the same order
// screen they already use to pick up and deliver.
// ============================================================

const DEFAULT_CAPACITY = 12;

export default function MyRoutePage() {
  const { me, deliveries, settings, driverLocations, ready, setStage, updateDelivery, notify } = useData();
  const { t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // Un solo disparo por toque: mientras la escritura va, el botón queda deshabilitado. Guarda
  // el id y no un booleano para que se vea cuál es la parada que está guardándose.
  const [guardando, setGuardando] = useState<string | null>(null);

  const driverName = me?.full_name ?? "";

  // Today's work: everything assigned to this driver for today, plus anything
  // overdue that never went out — a slipped stop is still theirs to finish.
  const stops = useMemo(() => {
    if (!me) return [];
    const today = todayISO();
    const mine = deliveries.filter((d) => {
      if (d.assigned_driver !== driverName) return false;
      if (d.stage === "canceled" || d.stage === "rejected") return false;
      if (d.delivery_date === today) return true;
      return isOverdue(d);
    });
    return routeOrder(mine);
  }, [deliveries, me, driverName]);

  // Same truckload grouping the dispatcher sees, so the driver's "Trip 2" is
  // the dispatcher's "Trip 2" — by explicit load numbers when they were set,
  // otherwise split by what the truck holds.
  const trips = useMemo(() => {
    const capacity = settings.driver_capacity?.[driverName] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
    return hasManualLoads(stops) ? groupIntoLoads(stops) : splitIntoTrips(stops, capacity);
  }, [stops, settings.driver_capacity, settings.default_truck_capacity, driverName]);

  /**
   * El botón de «Siguiente parada» hace lo que dice (D-218).
   *
   * Antes decía «Recoger» / «Entregar» y solo abría la ficha: dos toques para lo que el chofer
   * pidió en uno. Qué acción toca lo decide `accionParada` (lib/one-tap-stop.ts), la misma regla
   * que usa la ficha, y lo que se escribe al recoger sale del mismo constructor, así que las dos
   * vías no pueden guardar cosas distintas.
   *
   * El GPS no bloquea: se espera lo poco que espera la ficha (`captureLocationSplit`) y, si no
   * llega, se guarda igual y la coordenada tardía se adjunta después en silencio. Un chofer en
   * un sótano no puede quedarse sin poder cerrar la parada.
   */
  const cerrarParada = async (d: Delivery) => {
    const accion = accionParada(d.stage, settings, d.photos);
    if (accion.kind === "pod" || accion.kind === "open") { setOpen(d); return; }
    if (guardando) return;
    setGuardando(d.id);
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    if (accion.kind === "pickup") {
      const escritura = escrituraRecogida({ pedido: d, me, gps, t });
      const ok = await setStage(d.id, "picked_up", escritura.note, escritura.extra);
      if (ok) {
        notify(t("Out for delivery", "En reparto"));
        if (!gps) void adjuntarTardio(d.id, eventual, "pickup");
      }
    } else {
      const ok = await setStage(d.id, "delivered", t("Delivered", "Entregado"), extraEntrega(gps));
      if (ok) {
        notify(t("Delivered", "Entregado"));
        if (!gps) void adjuntarTardio(d.id, eventual, "pod");
      }
    }
    setGuardando(null);
  };

  /** La coordenada que llegó tarde, puesta en silencio: el chofer ya siguió y no hay nada que
   *  pueda hacer al respecto. Mismo comportamiento que la ficha. */
  const adjuntarTardio = async (
    id: string,
    pendiente: Promise<{ lat: number; lng: number; at: string; accuracy?: number | null } | null>,
    tipo: "pickup" | "pod",
  ) => {
    const gps = await pendiente;
    if (!gps) return;
    await updateDelivery(id, tipo === "pickup"
      ? { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }
      : { pod_lat: gps.lat, pod_lng: gps.lng, pod_accuracy: gps.accuracy ?? null },
      { quiet: true });
  };

  const done = stops.filter((d) => d.stage === "delivered").length;
  // The one stop that matters right now: first in sequence still to finish.
  const next = stops.find((d) => d.stage !== "delivered") ?? null;

  const storeMarkers = useStoreMarkers(settings.stores);

  // Which truckload's drive is drawn, and what we know about it. Loaded on
  // demand — a driver asks for one trip at a time, and each ask costs a
  // routing call, so nothing is fetched until they tap.
  const [openTrip, setOpenTrip] = useState<number | null>(null);
  const [tripRoutes, setTripRoutes] = useState<Record<number, { positions: [number, number][]; miles: number; duration: string; traffic: boolean }>>({});
  const [tripBusy, setTripBusy] = useState<number | null>(null);
  const [tripError, setTripError] = useState<string | null>(null);

  /** Where this truckload is loaded — the order's own pickup, else its store. */
  const pickupFor = async (batch: Delivery[]): Promise<{ lat: number; lng: number } | null> => {
    const addr = batch.map((d) => (d.pickup_address || "").trim()).find(Boolean)
      ?? batch.map((d) => settings.stores.find((s) => s.name === d.store)?.address).find(Boolean)
      ?? "";
    if (!addr) return null;
    try {
      const res = await fetch("/api/geocode-point", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      if (!res.ok) return null;
      const p = await res.json();
      return typeof p?.lat === "number" && typeof p?.lng === "number" ? p : null;
    } catch { return null; }
  };

  const toggleTrip = async (ti: number, batch: Delivery[]) => {
    if (openTrip === ti) { setOpenTrip(null); return; }
    setOpenTrip(ti);
    setTripError(null);
    if (tripRoutes[ti]) return;                    // already drawn once today
    const withPin = batch.filter((d) => d.delivery_lat != null && d.delivery_lng != null);
    if (withPin.length === 0) {
      setTripError(t("These stops aren't on the map yet.", "Estas paradas aún no están en el mapa."));
      return;
    }
    setTripBusy(ti);
    try {
      const depot = await pickupFor(batch);
      const stopsForCall = [
        ...(depot ? [{ id: "__pickup__", lat: depot.lat, lng: depot.lng }] : []),
        ...withPin.map((d) => ({ id: d.id, lat: d.delivery_lat!, lng: d.delivery_lng! })),
      ];
      const res = await fetch("/api/optimize-route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stops: stopsForCall,
          roundtrip: !!depot,
          date: batch[0]?.delivery_date ?? todayISO(),
          // Draw the route they were ASSIGNED. Re-solving it here would show a
          // different order than the one they're following.
          optimize: false,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Route failed");
      setTripRoutes((prev) => ({
        ...prev,
        [ti]: {
          positions: ((b.geometry ?? []) as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]),
          miles: b.miles ?? 0,
          duration: b.duration_text || "",
          traffic: !!b.traffic,
        },
      }));
    } catch (e) {
      setTripError(e instanceof Error ? e.message : "Route failed");
    } finally {
      setTripBusy(null);
    }
  };

  // Only the open truckload is traced, so the map answers one question.
  const lines: MapLine[] = useMemo(() => {
    if (openTrip == null) return [];
    const r = tripRoutes[openTrip];
    if (!r || r.positions.length < 2) return [];
    return [{ id: `trip:${openTrip}`, color: "#2456c9", positions: r.positions }];
  }, [openTrip, tripRoutes]);

  // Numbered pins in visiting order. Colour carries state at a glance: done,
  // the one you're heading to, and the rest.
  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
    stops.forEach((d, i) => {
      if (d.delivery_lat == null || d.delivery_lng == null) return;
      const isDone = d.stage === "delivered";
      const isNext = next?.id === d.id;
      out.push({
        id: d.id,
        lat: d.delivery_lat,
        lng: d.delivery_lng,
        color: isDone ? "#1f9d61" : isNext ? "#d1782e" : "#6b7686",
        badge: String(i + 1),
        label: `${i + 1}. ${d.invoice_num || `#${orderLabel(d)}`}${d.delivery_address ? ` — ${d.delivery_address}` : ""}`,
        dimmed: isDone,
      });
    });
    return out;
  }, [stops, next]);

  // Their own truck, so they can see where they are against the plan.
  const liveDrivers = useMemo(() => {
    if (!me) return [];
    const loc = driverLocations.find((l) => l.driver_id === me.id);
    if (!loc) return [];
    const ageMin = (Date.now() - new Date(loc.recorded_at).getTime()) / 60000;
    if (ageMin > 60) return [];
    return [{
      driver: driverName,
      lat: loc.lat,
      lng: loc.lng,
      color: settings.driver_colors?.[driverName] || fallbackDriverColor(driverName),
      accuracy_m: loc.accuracy_m,
      ageMin,
      label: t("You are here", "Aquí estás"),
    }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocations, me, driverName, settings.driver_colors]);

  const fitTo = useMemo<[number, number][] | undefined>(() => {
    const pts = points.map((p) => [p.lat, p.lng] as [number, number]);
    return pts.length ? pts : undefined;
  }, [points]);

  const navigateTo = (d: Delivery) => {
    const dest = d.delivery_lat != null && d.delivery_lng != null
      ? `${d.delivery_lat},${d.delivery_lng}`
      : (d.delivery_address || "").trim();
    if (!dest) return;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`, "_blank", "noopener");
  };

  if (!me) return null;
  if (!canDeliver(me) || me.role === "warehouse") {
    return <div className="empty">{t("Not available for your role.", "No disponible para tu rol.")}</div>;
  }
  if (!ready) return <div className="empty">{t("Loading…", "Cargando…")}</div>;

  const pct = stops.length ? Math.round((done / stops.length) * 100) : 0;
  // Etiqueta y acción del botón salen de aquí: una sola decisión, no dos que se puedan
  // desincronizar. `open` (etapa que no es ready ni picked_up) solo abre el pedido.
  const accionSiguiente = accionParada(next?.stage, settings, next?.photos);

  return (
    <>
      <div className="page-head">
        <h2>🧭 {t("My route", "Mi ruta")}</h2>
        <span className="hint">{fmtDate(todayISO())}</span>
      </div>

      {stops.length === 0 ? (
        <div className="empty">
          {t("No stops assigned to you yet. Logistics will plan your route.",
             "Aún no tienes paradas asignadas. Logística planeará tu ruta.")}
        </div>
      ) : (
        <>
          {/* Progress first — "how much is left" is the question a driver asks
              themselves all day. */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontSize: 16 }}>
                {t(`${done} of ${stops.length} delivered`, `${done} de ${stops.length} entregadas`)}
              </b>
              <span className="hint">
                {trips.length > 1 ? t(`${trips.length} truckloads`, `${trips.length} viajes`) : t("1 truckload", "1 viaje")}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden", marginTop: 8 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--green)" }} />
            </div>
          </div>

          {/* The next stop, given its own card. Everything else on this screen
              is context; this is the thing to act on. */}
          {next && (
            <div className="card" style={{ marginBottom: 12, borderColor: "var(--accent)", borderWidth: 2 }}>
              <div className="section-label" style={{ marginTop: 0 }}>
                {t("Next stop", "Siguiente parada")} · {stops.indexOf(next) + 1}/{stops.length}
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {next.invoice_num || `#${orderLabel(next)}`}
              </div>
              <div style={{ marginTop: 2 }}>{next.delivery_address || t("(no address)", "(sin dirección)")}</div>
              <div className="hint" style={{ marginTop: 4 }}>
                {fmtWindows(next.delivery_windows)}
                {next.actual_pallets ?? next.est_pallets ? ` · ${next.actual_pallets ?? next.est_pallets} ${t("pallets", "pallets")}` : ""}
                {next.store ? ` · ${storeTag(next.store)}` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-primary" style={{ flex: "1 1 140px", justifyContent: "center" }} onClick={() => navigateTo(next)}>
                  🧭 {t("Navigate", "Navegar")}
                </button>
                {/* La etiqueta la decide la MISMA función que la acción, así que no puede
                    prometer una etapa que el botón no vaya a hacer. Las etapas que no son
                    `ready` ni `picked_up` (una parada asignada que el almacén aún no preparó)
                    siguen teniendo botón, pero dice «Ver orden»: quitarlo dejaría esa tarjeta
                    sin ninguna forma de abrir el pedido. */}
                <button
                  className="btn btn-green"
                  style={{ flex: "1 1 140px", justifyContent: "center" }}
                  disabled={guardando === next.id}
                  onClick={() => void cerrarParada(next)}
                >
                  {guardando === next.id
                    ? t("Saving…", "Guardando…")
                    : accionSiguiente.kind === "pickup" ? `🚚 ${t("Pick up", "Recoger")}`
                    : accionSiguiente.kind === "deliver" ? `✅ ${t("Deliver", "Entregar")}`
                    : accionSiguiente.kind === "pod" ? `✅ ${t("Delivery proof…", "Prueba de entrega…")}`
                    : `📋 ${t("Open order", "Ver orden")}`}
                </button>
              </div>
              {/* La salida cuando no se puede entregar: se descarga en una tienda del grupo y el
                  pedido vuelve a la lista (D-224). En su propia fila y no junto a «Entregar»:
                  es la excepción, no la acción normal, y el pulgar del chofer va al botón verde.
                  El control se enseña solo si procede —pedido en el camión y suyo—, así que aquí
                  no se repite ninguna condición. */}
              {me && (
                <div style={{ display: "flex", marginTop: 8 }}>
                  <LeaveAtStore pedido={next} me={me} style={{ flex: 1, justifyContent: "center" }} />
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
            <MapView
              points={points}
              lines={lines}
              stores={storeMarkers}
              liveDrivers={liveDrivers}
              fitTo={fitTo}
              height={280}
              onPointClick={(id) => { const d = stops.find((x) => x.id === id); if (d) setOpen(d); }}
            />
          </div>

          {/* The whole day in order, so they can plan ahead — grouped into the
              same truckloads logistics built. */}
          {trips.map((batch, ti) => {
            const startIdx = trips.slice(0, ti).reduce((n, b) => n + b.length, 0);
            const pallets = batch.reduce((n, d) => n + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0);
            return (
              <div className="card" key={ti} style={{ marginBottom: 12 }}>
                {/* Tapping the truckload traces THAT trip on the map and
                    reports what it costs in time and miles. One trip at a
                    time, because that's how it's driven. */}
                <button
                  onClick={() => void toggleTrip(ti, batch)}
                  className="section-label"
                  style={{
                    marginTop: 0, width: "100%", textAlign: "left", display: "flex",
                    alignItems: "center", gap: 8, flexWrap: "wrap", cursor: "pointer",
                    background: "none", border: "none", padding: 0,
                    color: openTrip === ti ? "var(--accent)" : undefined,
                  }}
                  aria-expanded={openTrip === ti}
                >
                  <span>{openTrip === ti ? "▾" : "▸"}</span>
                  <span>🚚 {t("Truckload", "Viaje")} {ti + 1} · {Math.round(pallets)} {t("pallets", "pallets")}</span>
                  {tripBusy === ti && <span className="hint">{t("measuring…", "midiendo…")}</span>}
                  {tripRoutes[ti] && (
                    <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>
                      · {tripRoutes[ti].miles} mi · {tripRoutes[ti].duration}
                      {tripRoutes[ti].traffic ? ` · ${t("with traffic", "con tráfico")}` : ""}
                    </span>
                  )}
                </button>
                {openTrip === ti && tripError && (
                  <div className="hint" style={{ color: "var(--amber)", marginBottom: 6 }}>⚠ {tripError}</div>
                )}
                {openTrip === ti && !tripRoutes[ti] && tripBusy !== ti && !tripError && (
                  <div className="hint" style={{ marginBottom: 6 }}>
                    {t("Tap again to hide the route.", "Toca de nuevo para ocultar la ruta.")}
                  </div>
                )}
                <div className="bar-list">
                  {batch.map((d, bi) => {
                    const n = startIdx + bi + 1;
                    const isDone = d.stage === "delivered";
                    const isNext = next?.id === d.id;
                    return (
                      <button
                        key={d.id}
                        className="acct-row"
                        onClick={() => setOpen(d)}
                        style={{
                          textAlign: "left", cursor: "pointer", alignItems: "flex-start",
                          background: isNext ? "var(--accent-soft)" : undefined,
                          opacity: isDone ? 0.6 : 1,
                        }}
                      >
                        <span style={{
                          flex: "0 0 26px", height: 26, borderRadius: "50%", display: "inline-flex",
                          alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12,
                          background: isDone ? "var(--green)" : isNext ? "var(--accent)" : "var(--line)",
                          color: isDone || isNext ? "#fff" : "var(--ink-soft)",
                        }}>
                          {isDone ? "✓" : n}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, display: "block" }}>
                            {d.invoice_num || `#${orderLabel(d)}`}
                          </span>
                          <span className="hint" style={{ display: "block" }}>
                            {d.delivery_address || t("(no address)", "(sin dirección)")}
                          </span>
                          <span className="hint" style={{ display: "block" }}>
                            {fmtWindows(d.delivery_windows)}
                            {d.order_type ? ` · ${d.order_type}` : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
