"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { choferesEnVivo, etiquetaEnVivo } from "@/lib/choferes-en-vivo";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModalLazy";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { MapLegend } from "@/components/MapLegend";
import { PanelDeChoferes } from "@/components/PanelDeChoferes";
import { COLOR_SIN_ASIGNAR, colorDeChofer, leyendaDelMapa } from "@/lib/map-legend";
import { fallbackDriverColor, fmtDate, fmtWindows, orderLabel, orderOwner, retentionFloorISO, seesAllHistory, shiftDateISO, todayISO } from "@/lib/utils";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { liveDriverNames } from "@/lib/tracking-health";
import { driverOf } from "@/lib/route-lanes";
import { hechasQueSePintan, horaReal } from "@/lib/hechas-del-gestor";
import { hechasDelChofer } from "@/lib/mover-parada";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { usePlanPublicadoDelGestor } from "@/lib/route-plan/usePlanPublicado";
import { tiendaBaseDelChofer } from "@/lib/optimizar-desde-el-gestor";
import { useBasesDeChofer } from "@/lib/usa-bases";
import { useMedidaDeRutas } from "@/lib/usa-medida-de-rutas";
import { carrilesDelDia, cargaDelPanel, enAbanico, encuadreDeLasRutas, lineasDeLasRutas, puntosDeLasRutas, rutaDeLaLinea, rutasPorChofer } from "@/lib/mapa-de-rutas";
import { pendientesDelDia, rangoDeRutasDelDia, rotuloDeLaParada, type ParadaDelDia } from "@/lib/rutas-del-dia";
import { useRutasDelDia } from "@/lib/usa-rutas-del-dia";
import { aLaDecima, palletsDeLaOrden } from "@/lib/pallets";
import type { Delivery } from "@/lib/types";

// Matches the Routes Manager default when a driver has no capacity set.
const DEFAULT_CAPACITY = 12;

// ============================================================
// «Ruta de hoy» / «Today's route» (D-NEXT). Antes, «Mapa».
//
// El dueño, 2026-10-04, con la captura del bloque de arriba del Gestor de Rutas: «este mapa lo quiero en el map view que ya
// esta y que todos los puedan ver y se lo cambias de map a today's route». Y sobre qué ve cada rol: «si rutas completas pero
// solo ver nada mas».
//
// Qué es: el panel «Choferes y rutas» y el mapa del Gestor —cada ruta del día en el color de su chofer, con sus pines P/D en
// el orden de su lista, lo hecho con ✓, las millas, las horas y la carga—, para TODOS los roles del módulo de entregas y de
// SOLO LECTURA: aquí no se asigna, no se mueve, no se optimiza, no se vacía y no hay «＋ Ruta». Eso sigue en el Gestor.
//
// No es una copia del Gestor: las dos pantallas llaman a lo mismo (`lib/mapa-de-rutas`, `lib/usa-medida-de-rutas`,
// `PanelDeChoferes`, y la lectura de la ruta de siempre: `lecturaConLoHecho` sobre `lista-unica`).
//
// De dónde salen las paradas: de `rutas_del_dia(fecha)` (migración 160), que da a cualquier rol las rutas enteras con lo
// mínimo de cada parada — sin cliente, sin dirección, sin factura (`lib/rutas-del-dia`). Esta pantalla no enseña de una orden
// nada que no venga de ahí. Sin la 160, cada quien ve lo que su RLS ya le dejaba leer.
//
// Lo que tenía «Mapa» y se quedó: el selector de día (con la ventana de D-239), los choferes en vivo, la leyenda, el resumen
// del día y los colores de chofer. Lo que se fue: asignar desde el mapa (una orden o varias) y la ruta punteada de cada orden
// sin chofer, que costaba una llamada de mapas por orden.
// ============================================================
export default function MapPage() {
  const { me, users, deliveries, settings, saveSettings, ready, driverLocations, shifts, realRole } = useData();
  const { lang, t } = usePrefs();
  const [date, setDate] = useState(todayISO());
  const [open, setOpen] = useState<Delivery | null>(null);
  // Las rutas marcadas en el panel: se resaltan, y el resto se atenúa. Vacío = todas a la vista.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // La parada cuyo pin (o fila) se pulsó: su rótulo sale bajo el mapa.
  const [elegida, setElegida] = useState<string | null>(null);
  // «EN VIVO»: dónde está ese chofer ahora.
  const [locateDriver, setLocateDriver] = useState<string | null>(null);
  useEffect(() => { setLocateDriver(null); }, [selected]);

  const canManageColors = me?.role === "manager" || me?.role === "admin";
  // Los camiones en vivo, para todos menos ventas: un vendedor no tiene por qué seguir al personal (regla de antes de
  // esta pantalla). A quien la RLS de `driver_locations` no le deja leerlos, sencillamente no le llegan.
  const veCamiones = !!me && me.role !== "sales";

  // La ventana también aquí (D-239), y el ±7 de la función: el selector no llega a un día que no se pueda leer.
  const veTodoElHistorial = seesAllHistory(realRole, me?.permissions);
  const pisoFecha = retentionFloorISO();
  const rango = rangoDeRutasDelDia(todayISO());
  const primerDia = veTodoElHistorial || pisoFecha < rango.min ? rango.min : pisoFecha;
  const fecha = date < primerDia ? primerDia : date > rango.max ? rango.max : date;

  // Las paradas del día: de la función (rutas enteras) o, sin ella, lo que esta persona ya podía leer.
  const { paradas, origen } = useRutasDelDia(fecha);
  useEffect(() => { setElegida(null); setSelected(new Set()); }, [fecha]);

  // Lo pendiente y lo ya hecho: lo que el Gestor llama `dayOrders` y `hechasPintadas` (D-459).
  const dayOrders = useMemo(() => pendientesDelDia(paradas), [paradas]);
  const hechasPintadas = useMemo(() => hechasQueSePintan(paradas, fecha, "dia"), [paradas, fecha]);

  // Every store as a big red landmark point, always shown on the map.
  const storeMarkers = useStoreMarkers(settings.stores);

  // En `colorDeChofer` desde D-274, para que la leyenda lea el mismo color que se pinta. Es la misma cuenta del Gestor.
  const colorFor = (driver: string | null) => colorDeChofer(settings.driver_colors, driver);
  const capacityFor = (driver: string) => settings.driver_capacity?.[driver] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;

  const drivers = useMemo(() => users.filter((u) => u.role === "driver"), [users]);
  const bucketNames = useMemo(
    () => (settings.route_buckets ?? []).filter((n) => !drivers.some((d) => d.full_name === n)),
    [settings.route_buckets, drivers],
  );
  const lanes = useMemo(() => carrilesDelDia(drivers, bucketNames, dayOrders, hechasPintadas.keys()), [drivers, bucketNames, dayOrders, hechasPintadas]);
  const byDriver = useMemo(() => rutasPorChofer(dayOrders), [dayOrders]);

  // La MISMA lectura que el Gestor (`lecturaDe`): la lista única, con el plan publicado si esta persona puede leerlo y la
  // ruta lo sigue, y contando lo ya hecho (D-433).
  const rutasPublicadas = usePlanPublicadoDelGestor(fecha, 0);
  const paradasPublicadasDe = (chofer: string) => rutasPublicadas?.find((r) => r.chofer === chofer)?.paradas ?? null;
  const lecturaDe = (laneKey: string, stops: ParadaDelDia[]) =>
    lecturaConLoHecho(stops, capacityFor(driverOf(laneKey)), paradasPublicadasDe(laneKey), hechasDelChofer(paradas, laneKey, new Set(stops.map((s) => s.delivery_date ?? null))));

  // La base de cada ruta (D-461) y las tiendas de recogida: de Ajustes; si esta persona no las tiene, el punto que trae la parada.
  const basesDeChofer = useBasesDeChofer();
  const tiendaBaseDe = (laneKey: string) => tiendaBaseDelChofer(driverOf(laneKey), basesDeChofer, users, settings.stores ?? []);
  const coordsDeTienda = (nombre: string | null): { lat: number; lng: number } | null => {
    const n = (nombre ?? "").trim().toLowerCase();
    if (!n) return null;
    const s = (settings.stores ?? []).find((x) => x.name.trim().toLowerCase() === n);
    if (s?.lat != null && s.lng != null) return { lat: s.lat, lng: s.lng };
    const p = paradas.find((x) => (x.store ?? "").trim().toLowerCase() === n && x.store_lat != null && x.store_lng != null);
    return p ? { lat: p.store_lat!, lng: p.store_lng! } : null;
  };

  // Las millas, las horas, el trazo y la llegada de cada parada: la medida del Gestor (D-456/D-461), sin una llamada de más.
  // UNA llamada a `/api/optimize-route` por ruta con paradas pendientes al abrir el día; ninguna al releer si la ruta no cambió.
  const conParadas = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0).map((u) => u.key);
  const rutasAMedir = [...conParadas.filter((k) => selected.has(k)), ...conParadas.filter((k) => !selected.has(k))];
  const { routeInfo, routeLines, routeEtas, baseDeLaRuta, pickupAddressFor, reintentaLaMedida, estadoDeLaMedida } = useMedidaDeRutas<ParadaDelDia>({
    date: fecha, porChofer: byDriver, rutasAMedir, seMide: (clave) => conParadas.includes(clave),
    listaDe: (clave, stops) => lecturaDe(clave, stops).paradas,
    tiendaBaseDe, coordsDeTienda, conParadas, buscaBases: "si_falta",
    invalida: [rutasPublicadas, settings.driver_capacity, settings.default_truck_capacity, settings.stores],
  });

  const focused = selected.size > 0;
  const isDim = (driver: string | null) => focused && !!driver && !selected.has(driver);
  const focusOnly = (name: string) => setSelected(new Set([name]));
  const toggleDriver = (name: string) =>
    setSelected((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });

  // La etiqueta P/D de cada entrega y su llegada estimada, para el rótulo y el resumen.
  const etiquetaDe = useMemo(() => {
    const m = new Map<string, string>();
    for (const [laneKey, list] of byDriver) {
      if (!list.some((d) => d.route_seq != null)) continue;
      for (const [id, etiqueta] of lecturaDe(laneKey, list).etiquetaDe) m.set(id, etiqueta);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, rutasPublicadas, settings.driver_capacity, settings.default_truck_capacity, paradas]);
  const llegadaDe = (p: ParadaDelDia) => (p.assigned_driver ? routeEtas[p.assigned_driver]?.[p.id] ?? null : null);

  // Los mismos puntos que el Gestor (`puntosDeLasRutas`), sin lo marcado ☑, que aquí no existe.
  const points: MapPoint[] = useMemo(
    () => enAbanico(puntosDeLasRutas<ParadaDelDia>({
      carriles: lanes, porChofer: byDriver, delDia: dayOrders, hechas: hechasPintadas,
      pasaFiltro: () => true, soloUnChofer: false, enfocado: focused, atenuada: isDim,
      colorDe: colorFor, colorSinChofer: COLOR_SIN_ASIGNAR,
      baseDe: (clave) => {
        const base = baseDeLaRuta(clave);
        return base ? { coords: [base.lat, base.lng], direccion: tiendaBaseDe(clave)?.name ?? (pickupAddressFor(clave) ?? "") } : null;
      },
      lecturaDe, coordsDeTienda, t,
      // Lo único que se añade al rótulo: la ciudad, los pallets y la llegada. No hay cliente ni dirección que enseñar.
      detalleDe: (d) => [d.delivery_city, `${palletsDeLaOrden(d)} ${t("pallets", "pallets")}`, llegadaDe(d) ? `${t("ETA", "llegada")} ${llegadaDe(d)}` : ""].filter(Boolean).join(" · "),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lanes, byDriver, dayOrders, hechasPintadas, selected, settings.driver_colors, settings.driver_capacity, settings.stores, rutasPublicadas, routeEtas, basesDeChofer, users, lang],
  );

  // Las líneas medidas de cada ruta. La del plan publicado (D-352) no se pide aquí: sería otra llamada de mapas por chofer
  // marcado, y la línea medida ya recorre esa misma lista.
  const lines: MapLine[] = useMemo(
    () => lineasDeLasRutas({
      trazos: routeLines, trazosDelPlan: {}, tieneParadas: (clave) => (byDriver.get(clave)?.length ?? 0) > 0,
      pasaFiltro: () => true, sigueSuPlan: () => false, colorDe: colorFor, atenuada: isDim,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeLines, byDriver, selected, settings.driver_colors],
  );

  // Drivers currently reporting from the road.
  const liveDrivers = useMemo(() => {
    if (!veCamiones) return [];
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    // La regla de qué cuenta como «en vivo» vive en `choferesEnVivo` (D-289).
    return choferesEnVivo(driverLocations, nameById, colorFor).map((c) => ({ ...c, label: etiquetaEnVivo(c, t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocations, users, veCamiones, settings.driver_colors]);
  const liveNames = useMemo(() => (veCamiones ? liveDriverNames(users, shifts, driverLocations) : new Set<string>()), [veCamiones, users, shifts, driverLocations]);

  const fitTo = useMemo<[number, number][]>(() => {
    if (locateDriver) {
      const loc = driverLocations.find((l) => users.find((x) => x.id === l.driver_id)?.full_name === locateDriver);
      if (loc) {
        const pad = 0.004; // ≈ 400 m, so the truck sits in a readable frame
        return [[loc.lat - pad, loc.lng - pad], [loc.lat + pad, loc.lng + pad]];
      }
    }
    return encuadreDeLasRutas(points, selected, byDriver, lanes);
  }, [points, selected, byDriver, lanes, locateDriver, driverLocations, users]);

  // Qué significa cada cosa del mapa (D-274), con el mismo `colorFor` que pinta los puntos.
  const conPunto = paradas.filter((d) => d.delivery_lat != null && d.delivery_lng != null);
  const leyenda = leyendaDelMapa({
    choferes: conPunto.map((d) => d.assigned_driver),
    coloresDeChofer: settings.driver_colors,
    rutasSinChofer: false,
    puedeAsignar: false,
    rutasDelDia: { camiones: veCamiones },
  });
  const missingPoints = paradas.length - conPunto.length;

  // El rótulo de la parada pulsada. La orden entera solo se abre si esta persona YA puede leerla (está entre las que le
  // carga su RLS) y no es un vendedor mirando la de otro: «solo ver, nada más».
  const paradaElegida = elegida ? paradas.find((p) => p.id === elegida) ?? null : null;
  const ordenLegible = (id: string): Delivery | null => {
    const d = deliveries.find((x) => x.id === id);
    if (!d || !me) return null;
    return me.role !== "sales" || orderOwner(d) === me.id ? d : null;
  };

  // El resumen del día: cada parada con su chofer, su P/D, de dónde sale, a qué ciudad va y cuándo llega.
  const resumen = useMemo(
    () => [...paradas].sort((a, b) =>
      (a.assigned_driver ? 0 : 1) - (b.assigned_driver ? 0 : 1)
      || (a.assigned_driver ?? "").localeCompare(b.assigned_driver ?? "")
      || (a.route_seq ?? 1e9) - (b.route_seq ?? 1e9) || a.order_no - b.order_no),
    [paradas],
  );
  const totalPallets = aLaDecima(resumen.reduce((sum, r) => sum + palletsDeLaOrden(r), 0));

  if (!me) return null;

  return (
    <>
      <div className="page-head">
        <h2>{t("Today's route", "Ruta de hoy")} <span className="count-tag" data-paradas-del-dia>{paradas.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" data-dia-anterior disabled={fecha <= primerDia} onClick={() => setDate(shiftDateISO(fecha, -1))} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={fecha} min={primerDia} max={rango.max} onChange={(e) => setDate(e.target.value || todayISO())} style={{ width: "auto" }} />
            <button className="vt" data-dia-siguiente disabled={fecha >= rango.max} onClick={() => setDate(shiftDateISO(fecha, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {fecha !== todayISO() && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(todayISO())}>{t("Today", "Hoy")}</button>
          )}
          <span className="hint" style={{ margin: 0 }}>{t("View only — routes are built in the Routes Manager.", "Solo lectura — las rutas se arman en el Gestor de Rutas.")}</span>
        </div>
      </div>

      {/* Sin la función (falta la migración 160) cada quien ve solo lo que ya podía leer. Se le dice a quien puede arreglarlo. */}
      {(origen === "sin_funcion" || origen === "error") && me.role === "admin" && (
        <div className="hint" data-aviso-sin-160 style={{ marginBottom: 8 }}>
          {origen === "sin_funcion"
            ? t("Migration 160 (rutas_del_dia) isn't applied yet: each role sees only the orders it could already read, so drivers and warehouse get partial routes.",
                "La migración 160 (rutas_del_dia) aún no está aplicada: cada rol ve solo las órdenes que ya podía leer, así que choferes y almacén ven rutas parciales.")
            : t("The day's routes couldn't be read; showing only the orders you can already read.", "No se pudieron leer las rutas del día; se enseñan solo las órdenes que usted ya puede leer.")}
        </div>
      )}

      <div data-ruta-de-hoy style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
        <PanelDeChoferes
          t={t}
          sinRutas={lanes.length === 0}
          vacio={t("No drivers yet.", "Aún sin choferes.")}
          hayMarcadas={focused}
          onMuestraTodos={() => setSelected(new Set())}
          onEnfoca={focusOnly}
          onAlterna={toggleDriver}
          onUbica={veCamiones ? (clave) => setLocateDriver(driverOf(clave)) : undefined}
          filas={lanes.map((u) => {
            const stops = byDriver.get(u.key) ?? [];
            return {
              id: u.id, clave: u.key, etiqueta: u.label, color: colorFor(u.driver), paradas: stops.length, info: routeInfo[u.key],
              carga: cargaDelPanel(lecturaDe(u.key, stops), capacityFor(u.driver)), marcada: selected.has(u.key), enVivo: liveNames.has(u.driver),
            };
          })}
          extrasDe={(clave) => {
            const estado = estadoDeLaMedida(clave, byDriver.get(clave) ?? []);
            if (estado === "calculando") return <span className="hint" data-medida="calculando" style={{ margin: 0, fontWeight: 400 }}>⏳</span>;
            if (estado === "fallo") return (
              <button className="notif-clear" data-reintentar-medida={clave} title={t("Not measured — retry", "Sin medida — reintentar")}
                onClick={(e) => { e.stopPropagation(); reintentaLaMedida(clave); }}>↻</button>
            );
            return null;
          }}
        />
        <div className="card" style={{ flex: "3 1 460px", minWidth: 0, margin: 0, padding: 0, overflow: "hidden" }}>
          <MapView points={points} lines={lines} stores={storeMarkers} liveDrivers={liveDrivers} fitTo={fitTo} height={430}
            onLineClick={(id) => { const ruta = rutaDeLaLinea(id); if (ruta) focusOnly(ruta); }}
            onPointClick={(id) => {
              // Solo las paradas tienen rótulo: la base y las recogidas ya lo dicen todo al pasar por encima.
              const orden = id.startsWith("__hecha__") ? id.slice("__hecha__".length) : id;
              if (paradas.some((p) => p.id === orden)) setElegida((x) => (x === orden ? null : orden));
            }} />
          <MapLegend elementos={leyenda} />
        </div>
      </div>

      {paradaElegida && (() => {
        const r = rotuloDeLaParada(paradaElegida, { etiqueta: etiquetaDe.get(paradaElegida.id), llegada: llegadaDe(paradaElegida), horaReal: horaReal(paradaElegida, "D") }, t);
        const legible = ordenLegible(paradaElegida.id);
        return (
          <div className="card" data-rotulo-de-parada={paradaElegida.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>
                {r.titulo}{" "}
                <span className="sema" style={{ background: stageInfo(paradaElegida.stage).color, color: "#fff" }}>{stageLabel(paradaElegida.stage, lang)}</span>
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setElegida(null)}>✕ {t("Close", "Cerrar")}</button>
            </div>
            {r.datos.map((x) => (
              <div className="detail-row" key={x.clave} data-dato={x.clave}><span className="dk">{x.nombre}</span><span className="dv">{x.valor}</span></div>
            ))}
            {legible && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" data-abrir-orden onClick={() => setOpen(legible)}>{t("Open full order", "Abrir orden completa")}</button>
              </div>
            )}
          </div>
        );
      })()}

      {missingPoints > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t(
            `${missingPoints} order(s) on this date have no address to place on the map yet.`,
            `${missingPoints} orden(es) en esta fecha aún no tienen dirección para ubicar en el mapa.`,
          )}
        </div>
      )}

      <div className="card">
        <h2>📋 {t("Summary", "Resumen")} — {fmtDate(fecha)}</h2>
        {resumen.length === 0 ? (
          <div className="empty">{origen == null ? t("Loading…", "Cargando…") : t("No orders on this date.", "Sin órdenes en esta fecha.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" data-resumen-del-dia style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>{t("Driver", "Chofer")}</th>
                  <th>{t("Stop", "Parada")}</th>
                  <th>{t("ID", "ID")}</th>
                  <th>{t("From", "Desde")}</th>
                  <th>{t("To", "Hasta")}</th>
                  <th>{t("Windows", "Ventanas")}</th>
                  <th>{t("Arrival", "Llegada")}</th>
                  <th>{t("Status", "Estado")}</th>
                  <th>{t("Pallets", "Pallets")}</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => {
                  const s = stageInfo(r.stage);
                  const hecha = r.stage === "delivered";
                  return (
                    <tr key={r.id} className="clickable" onClick={() => { setElegida(r.id); if (r.assigned_driver) focusOnly(r.assigned_driver); }}
                      style={elegida === r.id ? { background: "var(--accent-soft)" } : undefined}>
                      <td>
                        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: colorFor(r.assigned_driver), marginRight: 6 }} />
                        {r.assigned_driver || t("Unassigned", "Sin asignar")}
                      </td>
                      <td>{hecha ? "✓" : etiquetaDe.get(r.id) ?? "—"}</td>
                      <td className="ordno">#{orderLabel(r)}</td>
                      <td>{r.store || "—"}</td>
                      <td>{r.delivery_city || "—"}</td>
                      <td>{fmtWindows(r.delivery_windows)}</td>
                      <td>{hecha ? horaReal(r, "D") ?? "✓" : llegadaDe(r) ?? "—"}</td>
                      <td><span className="sema" style={{ background: s.color, color: "#fff" }}>{stageLabel(r.stage, lang)}</span></td>
                      <td>{r.actual_pallets ?? r.est_pallets ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} style={{ fontWeight: 700, textAlign: "right" }}>{t("Total pallets", "Total de pallets")}</td>
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
            {drivers.map(({ full_name: name }) => (
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
              <span style={{ width: 16, height: 16, borderRadius: "50%", background: COLOR_SIN_ASIGNAR, border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)" }} />
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
