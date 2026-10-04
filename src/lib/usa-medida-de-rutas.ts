"use client";

import { useEffect, useRef, useState } from "react";
import { serviceMin, RELOAD_MIN } from "@/lib/trip-timing";
import { MEDIDA_FALLIDA, cuerpoDeLaMedida, firmaDeLaMedida, siguienteMedida, type EstadoDeLaMedida } from "@/lib/medida-de-ruta";
import { minutosEnCadaParada } from "@/lib/optimiza-la-ruta";
import type { ParadaDeLaLista } from "@/lib/lista-unica";
import type { NamedLocation } from "@/lib/types";

/**
 * La MEDIDA de las rutas del día —millas, horas, trazo y la llegada estimada de cada parada—, para las dos pantallas que
 * las pintan: el Gestor de Rutas y «Ruta de hoy» (D-NEXT).
 *
 * Todo esto vivía dentro de `routes/page.tsx` (D-437, D-443, D-456, D-461). Se sacó tal cual, sin cambiar una regla, cuando
 * el dueño pidió el mapa del Gestor en la pestaña «Mapa» para todos: dos pantallas con dos copias de la medida acabarían
 * dando millas distintas para la misma ruta. Lo que NO cambió:
 *   · mide la ruta TAL COMO ESTÁ, en el orden de la lista (`optimize: false`); no reordena ni escribe nada;
 *   · UNA llamada a `/api/optimize-route` por ruta con paradas y por FORMA de la ruta; una a la vez;
 *   · volver a una forma ya medida la repinta sin llamar; una medida que falló no se reintenta sola (`reintentaLaMedida`).
 */

/** The day's routes are timed from this clock, with a reload buffer at each pickup stop (RELOAD_MIN). */
export const DAY_START_MIN = 8 * 60; // 08:00

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

export function fmtClock(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** A route's traced path, split so the run and the empty drive back to the
 * base can be styled differently (solid vs dashed). Since D-443 a route is
 * ONE list, so there is one trace per driver. */
export interface TripTrace {
  delivery: [number, number][];
  ret: [number, number][];
}

/** What the route actually costs. Wheel time alone understates the day:
 * six stops spend over an hour standing still being unloaded, and that time
 * is already programmed per order (delivery_duration). */
export interface TripStat {
  miles: number;
  /** Time behind the wheel, pickup out and back. */
  driveMin: number;
  /** Time parked, unloading — the sum of this load's stop durations. */
  serviceMin: number;
  /** driveMin + serviceMin: the truck is busy this long. */
  totalMin: number;
  stops: number;
  /** Leaves the pickup / back at the pickup, "HH:MM". */
  start: string;
  end: string;
}

/** Lo medido de la ruta de un chofer TAL COMO ESTÁ (D-437): no reordena ni se guarda, solo se pinta. */
export interface MedidaDeLaRuta {
  miles: number;
  seconds: number;
  traces: TripTrace[];
  /** The whole list (D-443: one per driver), or `null` if it couldn't be measured. */
  stat: TripStat | null;
  /** Whole day: driving + unloading + reloading at each pickup stop. */
  dayMinutes: number;
  /** Estimated arrival time per stop id, "HH:MM". */
  etas: Record<string, string>;
}

/** Lo que el panel «Choferes y rutas» y la tarjeta pintan de una ruta medida. */
export interface InfoDeRuta { miles: number; duration_text: string; minutes: number; dayMinutes: number; dayText: string }

/** Lo que hace falta de una orden para medir su ruta. `Delivery` lo cumple, y la parada mínima de «Ruta de hoy» también. */
export interface OrdenMedida {
  id: string;
  route_seq?: number | null;
  load_no?: number | null;
  pickup_seq?: number | string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  delivery_date?: string | null;
  delivery_duration?: string | null;
  pickup_duration?: string | null;
}

type Coords = { lat: number; lng: number };
export type ProveedorDeRuta = { provider: string; traffic: boolean };

/**
 * Mide UNA lista: la base (si hay), cada recogida en su tienda (con la recarga, `RELOAD_MIN`), cada entrega, y vuelta a la
 * base. Una recogida en una tienda sin coordenadas en Ajustes, o una entrega sin pin, no se miden (no se inventa un punto).
 * `pide` es `fetch`; se pasa para poder probarla sin red.
 */
export async function mideLaLista<T extends OrdenMedida>(e: {
  lista: readonly ParadaDeLaLista[]; ordenes: readonly T[]; base: [number, number] | null;
  coordsDeTienda: (nombre: string | null) => Coords | null; fecha: string;
  pide: (url: string, init: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}): Promise<{ medida: MedidaDeLaRuta; proveedor: ProveedorDeRuta | null }> {
  const { lista, base: depot } = e;
  const byId = new Map(e.ordenes.map((d) => [d.id, d]));
  // Lo que el camión pasa parado en cada parada, contado como el optimizador y el motor (D-461): las recogidas seguidas en
  // la misma tienda son UNA visita. Hasta aquí cada fila P sumaba la recarga entera.
  const parado = minutosEnCadaParada(lista, lista.map((p) => (p.tipo === "D" ? serviceMin(byId.get(p.orden)?.delivery_duration) : p.ordenes.reduce((n, id) => n + serviceMin(byId.get(id)?.pickup_duration), 0))), RELOAD_MIN);
  // Los puntos en el orden de la lista. El id de una recogida es «P:» + su puesto en la lista (así sale su hora estimada).
  const puntos: { id: string; lat: number; lng: number; servicio: number }[] = [];
  lista.forEach((p, i) => {
    if (p.tipo === "D") {
      const d = byId.get(p.orden);
      if (d?.delivery_lat != null && d.delivery_lng != null) puntos.push({ id: d.id, lat: d.delivery_lat, lng: d.delivery_lng, servicio: parado[i] });
    } else {
      const c = e.coordsDeTienda(p.tienda);
      if (c) puntos.push({ id: `P:${i}`, lat: c.lat, lng: c.lng, servicio: parado[i] });
    }
  });
  const vacia: MedidaDeLaRuta = { miles: 0, seconds: 0, traces: [], stat: null, dayMinutes: 0, etas: {} };
  // Sin nada que medir (sin pins, o un solo punto sin base de la que salir): se queda sin números.
  if (!puntos.length || (puntos.length < 2 && !depot)) return { medida: vacia, proveedor: null };
  const res = await e.pide("/api/optimize-route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The run's own date drives PREDICTIVE traffic: a route planned tonight
    // for tomorrow gets tomorrow-morning conditions, not tonight's empty roads.
    body: JSON.stringify(cuerpoDeLaMedida(puntos.map(({ id, lat, lng }) => ({ id, lat, lng })), depot, e.ordenes[0]?.delivery_date ?? e.fecha)),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(data.error || "Route measurement failed");
  const proveedor: ProveedorDeRuta | null = data.provider ? { provider: data.provider, traffic: !!data.traffic } : null;
  const legs = (data.legs ?? []) as number[];

  // Split the loop geometry into the run and the empty drive back to the base. The return leg starts at the last stop,
  // so find where the path is closest to it (searching from the end) and cut there.
  const geom = ((data.geometry ?? []) as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
  const ultimo = depot ? puntos[puntos.length - 1] : undefined;
  let traces: TripTrace[];
  if (ultimo && geom.length > 2) {
    let cut = geom.length - 1, best = Infinity;
    for (let k = geom.length - 1; k >= 1; k--) {
      const dLat = geom[k][0] - ultimo.lat, dLng = geom[k][1] - ultimo.lng;
      const d2 = dLat * dLat + dLng * dLng;
      if (d2 < best) { best = d2; cut = k; }
    }
    traces = [{ delivery: geom.slice(0, cut + 1), ret: geom.slice(cut) }];
  } else {
    traces = [{ delivery: geom, ret: [] }];
  }

  // Walk the legs into per-stop arrival clocks. With a depot the route is [depot, s1, …, sN] so leg k drives INTO stop
  // k; without one the first stop is the start (no lead-in drive).
  const etas: Record<string, string> = {};
  let clock = DAY_START_MIN;
  let servicio = 0;
  puntos.forEach((p, j) => {
    if (depot || j > 0) clock += (legs[depot ? j : j - 1] ?? 0) / 60;
    etas[p.id] = fmtClock(clock);
    clock += p.servicio;
    servicio += p.servicio;
  });
  if (depot) clock += (legs[puntos.length] ?? 0) / 60;  // empty drive back to the base
  const driveMin = data.duration_seconds / 60;
  const stat: TripStat = {
    miles: Math.round(data.miles * 10) / 10, driveMin, serviceMin: servicio, totalMin: driveMin + servicio,
    stops: puntos.length, start: fmtClock(DAY_START_MIN), end: fmtClock(clock),
  };
  return { medida: { miles: Math.round(data.miles * 10) / 10, seconds: data.duration_seconds, traces, stat, dayMinutes: stat.totalMin, etas }, proveedor };
}

/** La forma de la ruta que se mide (D-456): la de `firmaDeLaMedida` —fecha, paradas, puestos, pines— MÁS la lista tal como
 *  se pinta. La misma ruta guardada da otra lista si cambia la capacidad del camión (sin posición guardada, las recogidas se
 *  cortan por lo que cabe) o si llega el plan publicado, y la llegada de cada recogida va por su puesto EN la lista: una
 *  medida guardada de la lista de antes pondría las horas en la fila que no es. */
export function firmaDeLaForma(fecha: string, clave: string, stops: readonly OrdenMedida[], lista: readonly ParadaDeLaLista[]): string {
  return `${firmaDeLaMedida(fecha, clave, stops)}|${lista.map((p) => (p.tipo === "P" ? `P${p.ordenes.join("+")}` : `D${p.orden}`)).join(",")}`;
}

export interface EntradaDeLaMedida<T extends OrdenMedida> {
  /** El día que se mira. Cambiarlo tira todo lo pintado. */
  date: string;
  /** Las paradas PENDIENTES de cada ruta, en su orden. */
  porChofer: ReadonlyMap<string, T[]>;
  /** Las rutas que hay que tener medidas, en orden de prioridad. */
  rutasAMedir: readonly string[];
  /** ¿Esta ruta se mide ahora? (para decir «calculando…» o «—»). */
  seMide: (clave: string) => boolean;
  /** La lista de la ruta tal como se pinta (`lecturaDe(clave, stops).paradas`). */
  listaDe: (clave: string, stops: T[]) => readonly ParadaDeLaLista[];
  /** La tienda base del chofer (D-461), o `null`. */
  tiendaBaseDe: (clave: string) => NamedLocation | null;
  /** Las coordenadas de una tienda de recogida, de Ajustes (sin llamar a nadie). */
  coordsDeTienda: (nombre: string | null) => Coords | null;
  /** Las rutas cuya base se busca de antemano, para pintar su «P» antes de medir. */
  conParadas: readonly string[];
  /** Lo que, al cambiar, puede cambiar la lista sin que cambien las órdenes: el plan publicado, la capacidad, las tiendas. */
  invalida: readonly [unknown, unknown, unknown, unknown];
  /** Buscar la dirección de la base de cada ruta (`/api/geocode-point`): «siempre» (el Gestor, como hasta ahora) o solo si
   *  la tienda base no tiene coordenadas en Ajustes. */
  buscaBases?: "siempre" | "si_falta";
}

export function useMedidaDeRutas<T extends OrdenMedida>(e: EntradaDeLaMedida<T>) {
  const { date, porChofer: byDriver, tiendaBaseDe } = e;
  // La ruta que se está midiendo ahora (una a la vez, D-437).
  const [midiendo, setMidiendo] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, InfoDeRuta>>({});
  // What the whole list costs, per driver (D-443: one per driver; until then, one per truckload).
  const [routeStats, setRouteStats] = useState<Record<string, TripStat | null>>({});
  const [routeLines, setRouteLines] = useState<Record<string, TripTrace[]>>({});
  const [routeEtas, setRouteEtas] = useState<Record<string, Record<string, string>>>({});
  const [depotCoords, setDepotCoords] = useState<Record<string, [number, number]>>({});
  // Which router actually answered last — so the page can say whether the
  // mileage/ETAs account for traffic (Google) or are free-flow (OSRM fallback).
  const lastProviderRef = useRef<ProveedorDeRuta | null>(null);
  const [routerInfo, setRouterInfo] = useState<ProveedorDeRuta | null>(null);

  // A newly-viewed date invalidates any measured summary/trace from before.
  useEffect(() => { setRouteInfo({}); setRouteStats({}); setRouteLines({}); setRouteEtas({}); }, [date]);

  const pickupAddressFor = (laneKey: string): string | null => (tiendaBaseDe(laneKey)?.address ?? "").trim() || null;

  // Geocode (and cache, keyed by the address string) a pickup/depot address.
  // «Ruta de hoy» pregunta por cada dirección UNA vez por visita, conteste o no: cuatro rutas que salen de la misma tienda
  // son una llamada, y una dirección que no se encuentra no se vuelve a pedir cada vez que se relee el día.
  const basesPedidas = useRef(new Map<string, Promise<[number, number] | null>>());
  const getDepotCoords = (address: string | null): Promise<[number, number] | null> => {
    const key = (address ?? "").trim();
    if (e.buscaBases !== "si_falta") return buscaLaBase(key);
    const ya = basesPedidas.current.get(key);
    if (ya) return ya;
    const pedida = buscaLaBase(key);
    basesPedidas.current.set(key, pedida);
    return pedida;
  };
  const buscaLaBase = async (key: string): Promise<[number, number] | null> => {
    if (!key) return null;
    if (depotCoords[key]) return depotCoords[key];
    try {
      const res = await fetch("/api/geocode-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: key }),
      });
      if (!res.ok) return null;
      const point = await res.json();
      const coords: [number, number] = [point.lat, point.lng];
      setDepotCoords((p) => ({ ...p, [key]: coords }));
      return coords;
    } catch {
      return null;
    }
  };

  // La base (la tienda del chofer, `tiendaBaseDe`): sus coordenadas de Ajustes si las tiene; si no, las que la pantalla ya
  // buscó para pintar la «P».
  const baseDeLaRuta = (laneKey: string): { lat: number; lng: number } | null => {
    const tienda = tiendaBaseDe(laneKey);
    if (!tienda) return null;
    if (tienda.lat != null && tienda.lng != null) return { lat: tienda.lat, lng: tienda.lng };
    const c = depotCoords[(tienda.address || "").trim()];
    return c ? { lat: c[0], lng: c[1] } : null;
  };

  // A driver's stops changed, so any earlier measured summary/trace is stale —
  // drop it rather than show a route that no longer matches. (It's measured again, in the NEW order.)
  const clearRouteFor = (driver: string) => {
    setRouteInfo((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteStats((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteLines((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteEtas((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
  };

  /** Mide la ruta de un chofer TAL COMO ESTÁ —su lista, la que pinta la tabla—. NO reordena ni escribe nada (D-437). */
  const mideLaRuta = async (laneKey: string, stopList: T[]): Promise<MedidaDeLaRuta> => {
    // La base del chofer (D-461): sus coordenadas de Ajustes; sin ellas, las de su dirección.
    const base = baseDeLaRuta(laneKey);
    const depot: [number, number] | null = base ? [base.lat, base.lng] : await getDepotCoords(pickupAddressFor(laneKey));
    const r = await mideLaLista({ lista: e.listaDe(laneKey, stopList), ordenes: stopList, base: depot, coordsDeTienda: e.coordsDeTienda, fecha: date, pide: (url, init) => fetch(url, init) });
    if (r.proveedor) lastProviderRef.current = r.proveedor;
    return r.medida;
  };

  /** Pinta lo medido en la tarjeta y el mapa. Solo pinta: la ruta no se toca. */
  const pintaLaMedida = (driver: string, m: MedidaDeLaRuta) => {
    setRouteInfo((p) => ({ ...p, [driver]: { miles: m.miles, duration_text: fmtMinutes(m.seconds / 60), minutes: m.seconds / 60, dayMinutes: m.dayMinutes, dayText: fmtMinutes(m.dayMinutes) } }));
    setRouteStats((p) => ({ ...p, [driver]: m.stat }));
    setRouteLines((p) => ({ ...p, [driver]: m.traces }));
    setRouteEtas((p) => ({ ...p, [driver]: m.etas }));
  };

  // Lo último que se pinta, para no pintar una medida que llega tarde: si la ruta cambió mientras se medía (una flecha
  // a mitad), esa medida es de la forma de antes y se tira; la nueva forma se mide aparte.
  const formaActual = useRef({ date, byDriver });
  formaActual.current = { date, byDriver };
  const firmaDe = (clave: string, stops: T[]): string => firmaDeLaForma(date, clave, stops, e.listaDe(clave, stops));
  const firmaAhora = useRef(firmaDe);
  firmaAhora.current = firmaDe;
  // De qué forma de la ruta es cada medida pintada. Si la ruta cambia por donde sea —también cuando se le QUITAN paradas
  // desde otra ruta (el tablero y «Asignar» solo limpiaban la de destino)—, lo pintado se tira: así una ruta que se quedó
  // vacía no conserva sus millas ni su línea (Julio, D-437).
  const firmaPintada = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const k of Object.keys(routeInfo)) {
      if (firmaPintada.current[k] !== firmaDe(k, byDriver.get(k) ?? [])) clearRouteFor(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, routeInfo, date, e.invalida[0], e.invalida[1], e.invalida[2]]);
  // Las medidas de esta visita, por forma de la ruta (D-456): volver a una forma ya medida —deshacer, subir y bajar la misma
  // parada— la repinta de aquí, sin llamar a nadie. Una forma cuya medida falló queda como `MEDIDA_FALLIDA` y no se vuelve a
  // pedir sola: la tarjeta lo dice y ofrece «↻» (`reintentaLaMedida`, una llamada por pulsación).
  const medidas = useRef(new Map<string, MedidaDeLaRuta | typeof MEDIDA_FALLIDA>());
  const [reintentos, setReintentos] = useState(0);
  const mide = async (driver: string, stops: T[]) => {
    setMidiendo(driver);
    const firma = firmaDe(driver, stops);
    try {
      const m = await mideLaRuta(driver, stops);
      medidas.current.set(firma, m);
      if (firmaAhora.current(driver, formaActual.current.byDriver.get(driver) ?? []) === firma) { firmaPintada.current[driver] = firma; pintaLaMedida(driver, m); }
    } catch {
      // Sin medida (sin sesión, sin red, el proveedor caído): la tarjeta se queda sin millas y la columna «Llegada» dice
      // «sin medida». No se reintenta en bucle: esa forma queda apuntada como fallida hasta que alguien pulse «↻».
      medidas.current.set(firma, MEDIDA_FALLIDA);
    } finally {
      setMidiendo(null);
      setRouterInfo(lastProviderRef.current);
    }
  };

  /** «↻» de una ruta cuya medida falló: olvida el fallo de ESA forma y la pide otra vez. Una llamada por pulsación. */
  const reintentaLaMedida = (clave: string) => {
    medidas.current.delete(firmaDe(clave, byDriver.get(clave) ?? []));
    setReintentos((n) => n + 1);
  };

  // Resolve every driver's pickup point up front, so the map can show each
  // as its loop's start/end pin even before a route's been measured.
  useEffect(() => {
    for (const clave of e.conParadas) {
      // «Ruta de hoy» no busca la dirección de una base que ya tiene su punto en Ajustes: una llamada menos por base.
      if (e.buscaBases === "si_falta" && baseDeLaRuta(clave)) continue;
      getDepotCoords(pickupAddressFor(clave));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, e.invalida[3]]);

  // Una a la vez, en el orden de `rutasAMedir`. Cada FORMA de la ruta se pide una sola vez (`firmaDe`); lo ya medido se
  // repinta de `medidas` sin llamar; lo que falló no se reintenta solo (`siguienteMedida`).
  //   · Llamadas: al cargar un día, UNA por ruta con paradas; por cada cambio, UNA por ruta cuya forma cambió (dos si una
  //     orden pasa de un chofer a otro), y NINGUNA si se vuelve a una forma ya medida.
  const queMedir = e.rutasAMedir.join("\u0001");
  useEffect(() => {
    const rutas = e.rutasAMedir.map((clave) => ({ clave, firma: firmaDe(clave, byDriver.get(clave) ?? []) }));
    const pintadas = Object.fromEntries(Object.keys(routeInfo).map((k) => [k, firmaPintada.current[k]]));
    const que = siguienteMedida<MedidaDeLaRuta>(rutas, pintadas, medidas.current);
    for (const r of que.repinta) { firmaPintada.current[r.clave] = r.firma; pintaLaMedida(r.clave, r.medida); }
    if (midiendo == null && que.pide) void mide(que.pide.clave, byDriver.get(que.pide.clave) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queMedir, routeInfo, midiendo, byDriver, date, reintentos, e.invalida[0], e.invalida[1], e.invalida[2]]);

  /** En qué está la medida de una ruta, para que la columna «Llegada» diga algo en vez de «—». */
  const estadoDeLaMedida = (clave: string, stops: T[]): EstadoDeLaMedida => {
    const firma = firmaDe(clave, stops);
    if (routeInfo[clave] && firmaPintada.current[clave] === firma) return "medida";
    if (medidas.current.get(firma) === MEDIDA_FALLIDA) return "fallo";
    return e.seMide(clave) ? "calculando" : "sin_pedir";
  };

  return { midiendo, routeInfo, routeStats, routeLines, routeEtas, depotCoords, routerInfo, getDepotCoords, baseDeLaRuta, pickupAddressFor, clearRouteFor, reintentaLaMedida, estadoDeLaMedida };
}
