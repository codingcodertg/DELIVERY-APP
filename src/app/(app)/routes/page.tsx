"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { PlanDelDia } from "@/components/PlanDelDia";
import { choferesEnVivo, etiquetaEnVivo } from "@/lib/choferes-en-vivo";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canPlanRoutes } from "@/lib/constants";
import { parseWindow, splitIntoTrips, unavailableDriverNames } from "@/lib/dispatch";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { OrderModal } from "@/components/OrderModalLazy";
import { DispatchBoard, type BoardColumn } from "@/components/DispatchBoard";
import { GanttTimeline, type GanttRow } from "@/components/GanttTimeline";
import { printRouteManifest } from "@/lib/manifest";
import { fallbackDriverColor, fmtDate, fmtMoney, fmtWindows, isOverdue, orderLabel, shiftDateISO, todayISO } from "@/lib/utils";
import { serviceMin, tripTiming, dayMinutes, RELOAD_MIN } from "@/lib/trip-timing";
import { cuerpoDeLaMedida, firmaDeLaMedida, pintaElTrazoDelPlan } from "@/lib/medida-de-ruta";
import { driverOf, groupIntoLoads, hasManualLoads, loadNoOf, nextLoadFor as nextLoadForPure, orderLaneKey as orderLaneKeyPure, planMerge } from "@/lib/route-lanes";
import { COLUMN_WIDTHS, anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { liveDriverNames, trackingGaps } from "@/lib/tracking-health";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { cuentasSinAsignar, filasSinAsignar, ordenesDelDia, pendientesDeOtrosDias, sinAsignarDelGestor, type ChipSinAsignar, type ModoDelGestor } from "@/lib/ordenes-del-dia";
import { eleccionVigente, opcionesDeConductor } from "@/lib/elige-conductor";
import { PANEL_SIN_ASIGNAR, TODOS_LOS_CHOFERES, estaPlegada, filtroVigente, guardaFiltroDeChofer, leeFiltroDeChofer, pasaElFiltroDeChofer } from "@/lib/vista-del-gestor";
import { esProvisional, etiquetaDeLaParada, filasDelViaje, lecturaParaLasFilas } from "@/lib/route-plan/lectura-de-ruta";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { puntosDelTrazoPublicado } from "@/lib/route-plan/trazo-del-plan";
import { usePlanPublicadoDelGestor } from "@/lib/route-plan/usePlanPublicado";
import { nombraLaOrden } from "@/lib/route-plan/etiqueta";
import {
  COLUMNAS_DEL_GESTOR_POR_DEFECTO, LLAVE_DE_ANCHOS_DE_PARADAS, alternaColumna, anchoDePartida, anchoDePartidaDeParada, claveDelOrdenEnElNavegador,
  columnaDeOrdenes, columnasDeLaTabla, columnasDePlantillaDelGestor, columnasDelSelector, preferenciasDelGestorAlLeer, fotoDePlantillaDelGestor,
  mueveEnElGestor, ordenDePlantillaDelGestor, ordenDelGestorEnElNavegador, restableceOrdenDelGestor, seMueveEnElGestor, siembraAnchosDeParadas,
  tieneOrdenPropio, type TablaDelGestor,
} from "@/lib/routes-columns";
import { borraPlantilla, claveDePlantillasEnElNavegador, guardaPlantilla, persistePlantillas, plantillasDelNavegador, textoDelRechazo } from "@/lib/plantillas-de-columnas";
import { ORDER_COLUMNS } from "@/components/OrdersTable";
import { idsRecibidasPorAlmacen } from "@/lib/recibir";
import { motivosDeAnulacion } from "@/lib/cancel-reasons";
import { CLAVE_DE_COLUMNAS_DEL_GESTOR, guardaColumnas, leeColumnas, valorDeColumnas, type ClienteDePrefs, type ColumnasPorRol, type PlantillaDeColumnas } from "@/lib/user-prefs";
import { createClient } from "@/lib/supabase/client";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { etiquetaDelGestor, textoQueAbreLaOrden, valorDelGestor } from "@/lib/valores-del-gestor";
import { ciudadDeEntrega, ciudadesConocidas } from "@/lib/ciudad-de-entrega";
import { celdaPropiaDelPlan } from "@/lib/route-plan/celdas-del-plan";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
import type { Delivery, DriverIncident, Profile } from "@/lib/types";
import { abanicoDeMarcas } from "@/lib/abanico-de-marcas";
import { aLaDecima, palletsDeLaOrden, sumaPallets } from "@/lib/pallets";
import { sumaDinero } from "@/lib/totales";
import { altoMaximoDeCaja } from "@/lib/barra-superior";
import { BarraSuperior, useCajasPorClave } from "@/components/BarraSuperior";
import { CerrarAviso } from "@/components/CerrarAviso";
import { avisoDelHueco, escrituraDelHueco, mejorLugar, separaPorRequisitos, type ParadaDeRuta } from "@/lib/mejor-lugar";
import {
  anota, barrasDeLaRuta, choquesAlVolver, descartaElDeArriba, escriturasHacia, fotoDe, fotoDeFilas, fotoTrasReordenar,
  HISTORIAL_VACIO, objetivoDe, planDeSoltar, porQueNoSuelta, sellosDe, textoDeChoques, textoDePrevia, trasVolver,
  type Destino, type Direccion, type FilaFresca, type Historial, type ParadaDelGantt, type RutaDelGantt,
} from "@/lib/arrastre-de-paradas";
import { cabeEnElViaje, hechasDelChofer, inicioDeLaSecuencia, planDeCambioDeViaje, planDeDividirEnDos, planDeFlecha, planDeUnirViajes } from "@/lib/mover-parada";
import { useRequisitosDelCamion } from "@/lib/usa-requisitos";
import { useZonasDeChofer } from "@/lib/usa-zonas";
import { esDeSuZona } from "@/lib/zonas";
import { fraseDeFaltan } from "@/lib/requisitos";
import { CANDADOS_SIN_LEER, cargaCandados, dondeViveElCandado, estaBloqueada, pulsaCandado, quienBloqueo, type ClienteDeCandados, type EstadoDeCandados, type OpcionesDeCandados } from "@/lib/rutas-bloqueadas";
import { AVISOS_DEL_GESTOR, cierraAviso, guardaAvisosOcultos, leeAvisosOcultos, type AvisoDelGestor } from "@/lib/avisos-ocultos";

// ============================================================
// Logistics Manager tool: assign the day's approved-but-undelivered orders
// to a driver and arrange each driver's stops.
//
// Desde D-NEXT el orden AUTOMÁTICO de una ruta sale de un solo sitio: «🧭 Armar las rutas del día» (el motor: planifica
// en borrador, se ajusta y se publica). Aquí ya no hay «Optimizar ruta», «Optimizar todas las rutas», «✨ Auto-asignar»,
// «Reagrupar por zona» ni «Simular»: el dueño, 2026-09-28, «Quitar los dos; solo Armar rutas». A mano quedan asignar,
// «📍 Mejor lugar», las flechas, el selector de viaje, unir/dividir viajes y el arrastre de «📅 Horario». La pantalla
// MIDE la ruta de un chofer elegido (millas, horas, trazo) en el orden guardado, sin reordenarla (`medida-de-ruta.ts`).
//
// Each driver's truck has a pallet capacity. When their assigned stops add
// up to more than it can carry in one load, the route is split into
// several round trips — out to a batch of stops, back to the driver's home
// store to reload, out again — rather than one trip that assumes an
// infinitely large truck.
//
// The page is driven by a driver switcher: pick one driver to see just
// their pins, routes and truckloads (or "All" for the whole day at once).
// ============================================================

const UNASSIGNED_COLOR = "#6b7686";
// Distinct colors for multiple selected unassigned loads (route + pin).
const SEL_PALETTE = ["#2456c9", "#0f8a8a", "#d1782e", "#7c4dbc", "#1f9d61", "#d64545", "#e9a13b"];
// Orders that can be scheduled/assigned here. Logistics can plan ANY order that
// isn't already out the door (picked_up/delivered) or off the board
// (rejected/canceled) — so an order still in draft/pending, not yet approved or
// prepared, can be dropped onto a route ahead of time. The warehouse still has
// to get it ready before it actually ships; this just lets dispatch pre-plan it.
// Drafts are excluded: a draft hasn't been submitted, so it isn't an order yet
// — planning a truck around one is planning around something nobody has
// committed to. Pending and unprepared orders DO belong here, which was the
// actual point of D-004: dispatch shouldn't have to wait for the warehouse.
const ROUTE_STAGES: Delivery["stage"][] = ["pending", "approved", "fulfilling", "ready"];
// Used whenever a driver has no capacity set yet in Settings.
const DEFAULT_CAPACITY = 12;

// The day's routes are timed from this clock, with a reload buffer added at
// the pickup between truckloads. Service (unload) time per stop comes from
// the order's own delivery_duration.
const DAY_START_MIN = 8 * 60; // 08:00

function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

function fmtClock(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hx = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Truckload 1 keeps the driver's own color; later truckloads rotate the HUE
// far away (not a lighter shade), so each loop is an unmistakably different
// color from the driver's and from each other.
const HUE_OFFSETS = [150, 60, 240, 300, 120, 30, 210];

/** A distinctly different color per truckload. */
function tripColor(base: string, index: number): string {
  if (index === 0) return base;
  const [h, s] = hexToHsl(base);
  return hslToHex(h + HUE_OFFSETS[(index - 1) % HUE_OFFSETS.length], Math.max(0.6, s), 0.45);
}

/** One truckload's traced path, split so the delivery run and the empty
 * drive back to the pickup can be styled differently (solid vs dashed). */
interface TripTrace {
  delivery: [number, number][];
  ret: [number, number][];
}

/** What one truckload actually costs. Wheel time alone understates the day:
 * a load of six stops spends over an hour standing still being unloaded, and
 * that time is already programmed per order (delivery_duration). */
interface TripStat {
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

/** Lo medido de la ruta de un chofer TAL COMO ESTÁ (D-NEXT): no reordena ni se guarda, solo se pinta. */
interface MedidaDeLaRuta {
  miles: number;
  seconds: number;
  traces: TripTrace[];
  trips: number;
  /** Per-truckload breakdown, by the truckload's position (`null`: a truckload that couldn't be measured). */
  tripStats: (TripStat | null)[];
  /** Whole day: driving + unloading + reloading between truckloads. */
  dayMinutes: number;
  /** Estimated arrival time per stop id, "HH:MM". */
  etas: Record<string, string>;
}

export default function RoutesPage() {
  const { me, users, deliveries, settings, saveSettings, updateDelivery, reorderStops, addNote, notify, availability, ready, incidents, addIncident, removeIncident, driverLocations, shifts, events, teaching } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [date, setDate] = useState(todayISO());
  // "All dates" ignores the date filter so every routable order (and the routes
  // built on them) shows regardless of delivery date — handy when a route was
  // built for another day and seems to have vanished.
  const [allDates, setAllDates] = useState(false);
  // Ver APARTE lo atrasado y lo sin fecha: sustituye la vista del día, no se suma a ella.
  const [soloPendientes, setSoloPendientes] = useState(false);
  // Layout: full-width route cards (see all info) and a collapsible map/driver
  // panel so the route detail can use the whole screen.
  const [wideRoutes, setWideRoutes] = useState(true);
  const [showTop, setShowTop] = useState(true);
  // La tabla de paradas tenía un botón para abrir y cerrar la dirección (D-346 la hizo nacer abierta). Desde D-408 esa
  // columna enseña solo la ciudad, que cabe siempre: el botón se fue con la dirección.
  // Excel-style resizable columns, remembered per table. Tighter defaults (and
  // bumped keys, so they replace older wide ones) so the route + truckload
  // tables fit the screen without horizontal scrolling. Columns are still
  // draggable from here.
  // Anchos por CLAVE de columna, no por posición: las columnas de esta tabla ahora se eligen (D-331). La de «Programadas»
  // (`rtg_routes_sched4`) se fue con su pestaña (D-376).
  const poolCols = useColWidthMap("rtg_routes_pool4", 100);
  // Las que vienen de Órdenes nacen con el ancho de Órdenes (D-376): con 100 px la etapa salía «Program…», y allí entera.
  const anchoEnSinAsignar = (clave: string) => poolCols.widthOf(`g_${clave}`, anchoDePartida(clave, COLUMN_WIDTHS));
  // Los anchos de la tabla de PARADAS, por CLAVE desde D-410: sus columnas ahora se mueven, y un ancho por posición se
  // quedaría en el puesto mientras la columna se va. Antes vivían en `rtg_routes_stops8` (por posición) y en
  // `rtg_routes_stops_extra1` (las de Órdenes, D-376); `siembraAnchosDeParadas` los hereda UNA vez, antes de que el hook
  // lea la llave nueva — por eso va en un inicializador de estado justo delante, que corre antes en el primer render.
  useState(() => { if (typeof window !== "undefined") siembraAnchosDeParadas(window.localStorage); return 0; });
  const stopCols = useColWidthMap(LLAVE_DE_ANCHOS_DE_PARADAS, 100);
  const anchoDeParada = (clave: string) => stopCols.widthOf(clave, anchoDePartidaDeParada(clave, COLUMN_WIDTHS));
  const asaDeParada = (clave: string) => stopCols.startResize(clave, anchoDePartidaDeParada(clave, COLUMN_WIDTHS));
  // Qué columnas ve esta persona en el Gestor. Nace con el defecto —todas, con la FACTURA— y se guarda por persona en
  // `user_prefs` (`routes_columns`). Aquí no hay nada en el navegador que sembrar.
  const [colsGestor, setColsGestor] = useState<string[]>([...COLUMNAS_DEL_GESTOR_POR_DEFECTO]);
  const prefsDelGestor = useRef<ColumnasPorRol | null>(null);
  // El ORDEN de las columnas (D-410), la mitad `_orden` de la misma fila, como en Órdenes: la `ref` es lo leído de todos
  // los roles (lo que se escribe); el estado, la lista de ESTE rol (`null` = las dos tablas en su orden de partida).
  const ordenDelGestor = useRef<ColumnasPorRol>({});
  const [ordenGestor, setOrdenGestor] = useState<string[] | null>(null);
  // Las plantillas (D-394): la `ref` es lo leído (lo que se escribe); el estado, lo que pinta el menú.
  const plantillasDelGestor = useRef<PlantillaDeColumnas[]>([]);
  const [plantillasGestor, setPlantillasGestor] = useState<PlantillaDeColumnas[]>([]);
  // El selector, junto a la tabla de paradas y solo con SUS columnas (D-346).
  // Y otra vez en «Sin asignar» (D-349): logística aterriza ahí y el único ⚙ estaba en «Programadas». Desde D-376, con
  // «Programadas» fuera, son los dos únicos.
  // Cada ⚙ lleva su propio estado desde D-379 (`SelectorDeColumnas`): el de paradas se pinta una vez por chofer y
  // colgaba de un solo estado y una sola `ref` de la página — abría todos a la vez y cerraba el menú al pulsar una casilla.
  useEffect(() => {
    if (!me || SIN_BASE) return;
    let vivo = true;
    const rol = me.role;
    void leeColumnas(createClient() as unknown as ClienteDePrefs, me.id, CLAVE_DE_COLUMNAS_DEL_GESTOR).then((leido) => {
      if (!vivo || !leido.leida) return;
      prefsDelGestor.current = leido.columnas;
      ordenDelGestor.current = leido.orden;
      plantillasDelGestor.current = leido.plantillas;
      setPlantillasGestor(leido.plantillas);
      // Quien guardó las suyas antes de D-346 recibe las columnas nuevas (la dirección, las de paradas). Y desde D-434, quien
      // no había pasado por la tanda del plan lo recibe con las columnas y el ORDEN de partida, y se guarda ya, una vez.
      const al = preferenciasDelGestorAlLeer(leido.columnas[rol], leido.orden[rol]);
      setOrdenGestor(al.orden);
      if (al.columnas) setColsGestor(al.columnas);
      if (al.escribe && al.columnas) {
        prefsDelGestor.current = { ...leido.columnas, [rol]: al.columnas };
        const orden: ColumnasPorRol = { ...leido.orden };
        if (al.orden) orden[rol] = al.orden; else delete orden[rol];
        ordenDelGestor.current = orden;
        void escribeElGestor();
      }
    });
    return () => { vivo = false; };
  }, [me?.id, me?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  // Las PLANTILLAS del Gestor (D-394), las mismas que en Órdenes: el dueño, «logistic manager needs to have the same
  // template as in order view». Van en la misma fila (`routes_columns`), como cuarta mitad; aquí no hay orden ni anchos en
  // la base, así que una plantilla del Gestor es solo QUÉ columnas se ven. Las dos ⚙ (Sin asignar y paradas) comparten la
  // lista de columnas, así que comparten también las plantillas. (La `ref` y el estado, arriba, junto a `prefsDelGestor`.)
  useEffect(() => {
    // El demo no tiene base: sus plantillas viven en este navegador.
    if (!SIN_BASE) return;
    plantillasDelGestor.current = plantillasDelNavegador((k) => { try { return localStorage.getItem(k); } catch { return null; } }, CLAVE_DE_COLUMNAS_DEL_GESTOR);
    setPlantillasGestor(plantillasDelGestor.current);
  }, []);
  // Y su orden (D-410), también en este navegador y por rol, como hace Promos (`rtg_promos_orden_<rol>`, D-385).
  useEffect(() => {
    if (!SIN_BASE || !me) return;
    try { setOrdenGestor(ordenDelGestorEnElNavegador(localStorage.getItem(claveDelOrdenEnElNavegador(me.role)))); } catch { setOrdenGestor(null); }
  }, [me?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  // La fila se escribe ENTERA, por un solo sitio y con las mitades leídas: marcar una casilla no borra las plantillas ni
  // el orden, y mover una columna no borra las columnas ni las plantillas (D-394, D-410).
  const escribeElGestor = () => guardaColumnas(createClient() as unknown as ClienteDePrefs, me!.id, prefsDelGestor.current ?? {}, CLAVE_DE_COLUMNAS_DEL_GESTOR, ordenDelGestor.current, {}, plantillasDelGestor.current);
  // El orden de ESTE rol cambia: se pinta, y se guarda en la base (si se pudo leer) o, en el demo, en este navegador.
  // `null` borra el del rol: sin orden propio manda el de partida, y una columna futura entra donde diga el código.
  const ponOrdenDelGestor = (next: string[] | null) => {
    setOrdenGestor(next);
    if (!me) return;
    if (SIN_BASE) { try { if (next) localStorage.setItem(claveDelOrdenEnElNavegador(me.role), JSON.stringify(next)); else localStorage.removeItem(claveDelOrdenEnElNavegador(me.role)); } catch { /* sin navegador */ } return; }
    if (prefsDelGestor.current === null) return;
    const todos: ColumnasPorRol = { ...ordenDelGestor.current };
    if (next) todos[me.role] = next; else delete todos[me.role];
    ordenDelGestor.current = todos;
    void escribeElGestor();
  };
  // Las flechas de cada ⚙ (D-410): el mismo `mueveColumna` de Órdenes, dentro de SU tabla.
  const moverEn = (tabla: TablaDelGestor) => ({
    seMueve: (clave: string, delta: -1 | 1) => seMueveEnElGestor(tabla, ordenGestor, clave, delta, colsGestor),
    onMueve: (clave: string, delta: -1 | 1) => ponOrdenDelGestor(mueveEnElGestor(tabla, ordenGestor, clave, delta, colsGestor)),
    ordenPropio: tieneOrdenPropio(tabla, ordenGestor),
    onRestablece: () => ponOrdenDelGestor(restableceOrdenDelGestor(tabla, ordenGestor)),
  });
  const alternaColumnaDelGestor = (key: string) => {
    const next = alternaColumna(colsGestor, key);
    setColsGestor(next);
    // La base solo si se pudo leer: no se escribe a ciegas encima de lo que haya.
    if (!me || SIN_BASE || prefsDelGestor.current === null) return;
    const todas: ColumnasPorRol = { ...prefsDelGestor.current, [me.role]: next };
    prefsDelGestor.current = todas;
    void escribeElGestor();
  };
  // Aplicar: la foto, o «Por defecto» (`null`) — lo que trae la app. Desde D-410 también el ORDEN: el de la foto, o el
  // de partida si la plantilla no traía (las de antes) o si es «Default». Columnas y orden van en UNA escritura.
  const aplicaPlantillaDelGestor = (p: PlantillaDeColumnas | null) => {
    const next = p ? columnasDePlantillaDelGestor(p.v) : [...COLUMNAS_DEL_GESTOR_POR_DEFECTO];
    const orden = p ? ordenDePlantillaDelGestor(p.o) : null;
    setColsGestor(next);
    if (me && !SIN_BASE && prefsDelGestor.current !== null) prefsDelGestor.current = { ...prefsDelGestor.current, [me.role]: next };
    ponOrdenDelGestor(orden);
  };
  const destinoDelGestor = {
    sinBase: SIN_BASE,
    guardaEnElNavegador: (lista: PlantillaDeColumnas[]) => localStorage.setItem(claveDePlantillasEnElNavegador(CLAVE_DE_COLUMNAS_DEL_GESTOR), JSON.stringify(lista)),
    baseLeida: prefsDelGestor.current !== null,
    filaCon: (lista: PlantillaDeColumnas[]) => valorDeColumnas({ visibles: prefsDelGestor.current ?? {}, orden: ordenDelGestor.current, plantillas: lista }),
    escribe: async (lista: PlantillaDeColumnas[]) => {
      const antes = plantillasDelGestor.current;
      plantillasDelGestor.current = lista;
      const ok = await escribeElGestor();
      if (!ok) plantillasDelGestor.current = antes;
      return ok;
    },
  };
  const cambiaPlantillasDelGestor = async (lista: PlantillaDeColumnas[], crece: boolean): Promise<string | null> => {
    const problema = await persistePlantillas(lista, crece, destinoDelGestor, t);
    if (problema) return problema;
    plantillasDelGestor.current = lista;
    setPlantillasGestor(lista);
    return null;
  };
  const propsDePlantillas = {
    plantillas: plantillasGestor,
    onAplicar: aplicaPlantillaDelGestor,
    onGuardar: (nombre: string) => {
      const r = guardaPlantilla(plantillasDelGestor.current, nombre, fotoDePlantillaDelGestor(colsGestor, ordenGestor));
      return r.ok ? cambiaPlantillasDelGestor(r.lista, true) : Promise.resolve(textoDelRechazo(r.motivo, t));
    },
    onBorrar: (nombre: string) => cambiaPlantillasDelGestor(borraPlantilla(plantillasDelGestor.current, nombre), false),
  };
  const colsSinAsignar = columnasDeLaTabla("sinAsignar", colsGestor, ordenGestor);
  // La tabla de paradas: el número de parada y la factura, fijos delante; las elegidas, en el orden de la persona (D-410;
  // hasta aquí, puestos fijos y las de Órdenes detrás, D-346/D-376); y las acciones, fijas al final.
  const colsParadas = columnasDeLaTabla("paradas", colsGestor, ordenGestor);
  const columnasDeParadas = 3 + colsParadas.length;
  // Which drivers are highlighted on the map / focused in the tables. Empty
  // set = "no drivers selected" → everything shown at full strength (like
  // OptimoRoute). Selecting some highlights them and dims the rest.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // El FILTRO de chofer (D-393), distinto de `selected`: aquel resalta y atenúa; este esconde a los demás en la lista de
  // choferes, en las tarjetas de «Rutas» y en el mapa. «Todos» es el defecto. Se recuerda por persona en este navegador;
  // lo que manda en cada momento es `filtroChofer` (más abajo), que vuelve a «Todos» si ese chofer ya no está.
  const [filtroGuardado, setFiltroGuardado] = useState<string>(TODOS_LOS_CHOFERES);
  useEffect(() => {
    if (!me?.id) return;
    setFiltroGuardado(leeFiltroDeChofer((k) => window.localStorage.getItem(k), me.id));
  }, [me?.id]);
  const eligeFiltroDeChofer = (chofer: string) => {
    setFiltroGuardado(chofer);
    // Lo marcado en el panel se suelta: un chofer escondido y marcado seguiría contando para «Unir» sin verse.
    setSelected(new Set());
    if (me?.id) guardaFiltroDeChofer(() => window.localStorage, me.id, chofer);
  };
  // Los avisos que esta persona cerró con su ✕ (D-400): cerrados para siempre en este navegador, hasta que pulse
  // «Mostrar avisos ocultos». `null` = aún no se ha leído lo guardado: mientras, no se pinta ninguno, para que un aviso
  // cerrado no parpadee al recargar.
  const [avisosOcultos, setAvisosOcultos] = useState<Set<AvisoDelGestor> | null>(null);
  useEffect(() => {
    if (!me?.id) return;
    setAvisosOcultos(leeAvisosOcultos((k) => window.localStorage.getItem(k), me.id));
  }, [me?.id]);
  const oculto = (id: AvisoDelGestor) => avisosOcultos == null || avisosOcultos.has(id);
  const cierraAvisoDelGestor = (id: AvisoDelGestor) => {
    const nuevos = cierraAviso(avisosOcultos ?? new Set(), id);
    setAvisosOcultos(nuevos);
    if (me?.id) guardaAvisosOcultos(() => window.localStorage, me.id, nuevos);
  };
  // Con la barra «Armar las rutas» cerrada, la ACCIÓN no se pierde: el botón «🧭 Armar rutas» de la cabecera la trae,
  // desplegada, para esta visita (sin volver a abrirla para siempre).
  const [planTraidoAMano, setPlanTraidoAMano] = useState(false);
  const muestraAvisosOcultos = () => {
    setAvisosOcultos(new Set());
    setPlanTraidoAMano(false);
    if (me?.id) guardaAvisosOcultos(() => window.localStorage, me.id, new Set());
  };
  // Sin «scheduled» desde D-376: la pestaña «Programadas» repetía, en una lista, las órdenes que ya salen en la ruta de
  // su chofer. El dueño: «en gestor de rutas el view programados es innecesario, quítalo».
  // «Incidencias» ya no es pestaña (D-NEXT): el dueño, «incidencias que sea un boton». Es un botón junto a las pestañas que
  // abre una ventana sobre el Gestor. La pestaña no se guardaba en ningún sitio: no hay preferencia vieja que recoger.
  const [tab, setTab] = useState<"routes" | "orders" | "board" | "timeline">("routes");
  const [incidenciasAbiertas, setIncidenciasAbiertas] = useState(false);
  useEffect(() => {
    if (!incidenciasAbiertas) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setIncidenciasAbiertas(false); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [incidenciasAbiertas]);
  // La ruta que se está midiendo ahora (una a la vez, D-NEXT).
  const [midiendo, setMidiendo] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<Record<string, { miles: number; duration_text: string; trips: number; minutes: number; dayMinutes: number; dayText: string }>>({});
  // Per-truckload numbers, keyed by driver then load index.
  const [routeTrips, setRouteTrips] = useState<Record<string, (TripStat | null)[]>>({});
  const [routeLines, setRouteLines] = useState<Record<string, TripTrace[]>>({});
  const [routeEtas, setRouteEtas] = useState<Record<string, Record<string, string>>>({});
  const [depotCoords, setDepotCoords] = useState<Record<string, [number, number]>>({});
  // Asignando desde el recuadro («Asignar», «📍 Mejor lugar», «Nueva ruta»): sus botones se apagan mientras tanto.
  const [asignando, setAsignando] = useState(false);
  // Multi-select + search + saved filter for the unassigned pool.
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  // El chofer pulsado en «Elige conductor para N órdenes» (D-395). `null`: nada pulsado (manda el filtro, si hay).
  const [conductorPulsado, setConductorPulsado] = useState<string | null>(null);
  // 🔒 Rutas bloqueadas (D-411): por día y por ruta. Desde D-414, en la base (`route_locks`, 149) si tiene la tabla —lo ve
  // todo logística y lo respeta «Planificar el día»—; si no, en ESTE navegador, como antes, y el botón lo dice. De dónde se
  // lee y dónde se escribe lo decide `rutas-bloqueadas.ts`, no la pantalla.
  // Se lee tras montar (no en el inicializador), para que el HTML del servidor y el primer pintado del navegador coincidan.
  // Y otra vez al volver a la pestaña (foco o visibilidad): sin tiempo real, lo que puso otra persona se ve al volver.
  const [candados, setCandados] = useState<EstadoDeCandados>(CANDADOS_SIN_LEER);
  const bloqueos = candados.bloqueos;
  const opcionesDeCandados = (): OpcionesDeCandados => ({
    sinBase: SIN_BASE, cliente: () => createClient() as unknown as ClienteDeCandados,
    navegador: (() => { try { return window.localStorage; } catch { return null; } })(), hoy: todayISO(),
  });
  useEffect(() => {
    let vivo = true;
    const lee = () => { void cargaCandados(opcionesDeCandados()).then((e) => { if (vivo) setCandados(e); }); };
    lee();
    const alVolver = () => { if (document.visibilityState === "visible") lee(); };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; window.removeEventListener("focus", alVolver); document.removeEventListener("visibilitychange", alVolver); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Las líneas de lo último que colocó «📍 Mejor lugar» (D-411), hasta que se cierran.
  const [avisoMejorLugar, setAvisoMejorLugar] = useState<string[] | null>(null);
  // Drag-and-drop in the Routes tab: which order is being dragged, and which
  // lane card is currently under the cursor (for the drop highlight).
  // (Row drag-and-drop was removed from the Routes tab — stops are reordered
  // with the ↑/↓ arrows, and orders are assigned from the "Assign to…" picker.)
  const [orderSearch, setOrderSearch] = useState("");
  // «Este día» es el defecto (D-331/D-359); «Todas» es lo sin chofer de cualquier día (D-393).
  const [poolFilter, setPoolFilter] = useState<ChipSinAsignar>("dia");
  // Cached pickup→dropoff geometry for selected unassigned loads (drawn on the map).
  const [selRouteCache, setSelRouteCache] = useState<Record<string, [number, number][]>>({});
  // Geocoded pickup coords per selected load — lets us show a pickup "P" pin and
  // a straight PU→DEL line immediately, before (or if) the road geometry loads.
  const [selPickup, setSelPickup] = useState<Record<string, [number, number]>>({});
  const [err, setErr] = useState<string | null>(null);
  // Which router actually answered last — so the page can say whether the
  // mileage/ETAs account for traffic (Google) or are free-flow (OSRM fallback).
  const lastProviderRef = useRef<{ provider: string; traffic: boolean } | null>(null);
  // Las cajas de «Sin asignar» y de las paradas de cada chofer, que mueve también su barra de arriba (D-398).
  // Las de paradas van una por chofer (se pintan dentro del `.map`), por eso van por clave.
  const cajaSinAsignarRef = useRef<HTMLDivElement>(null);
  const cajaDeParadas = useCajasPorClave();
  // El mapa y los choferes son `sticky` arriba; una caja de alto normal quedaría con su cabecera debajo de
  // ellos. Se mide el panel y las cajas se acortan a lo que queda libre (`altoMaximoDeCaja`).
  const panelFijoRef = useRef<HTMLDivElement>(null);
  const [altoPanelFijo, setAltoPanelFijo] = useState(0);
  useEffect(() => {
    const el = panelFijoRef.current;
    if (!showTop || !el) { setAltoPanelFijo(0); return; }
    const mide = () => setAltoPanelFijo(Math.round(el.getBoundingClientRect().height));
    mide();
    const ro = new ResizeObserver(mide);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTop]);
  const estiloDeCaja = { border: "none", maxHeight: altoMaximoDeCaja(altoPanelFijo) } as const;
  const [routerInfo, setRouterInfo] = useState<{ provider: string; traffic: boolean } | null>(null);
  // Which panels are collapsed — the unassigned pool ("__unassigned__") and
  // each driver (by name), so a busy board can be folded down to just the
  // one being worked on.
  // Desde D-393 las tarjetas de chofer NACEN plegadas, para todos y siempre (el dueño: «DEFAULT ALL COLLAPSE IN
  // ROUTES»). Lo que se guarda aquí son las que la persona ha pulsado en esta visita; nada de esto va al navegador ni a
  // la base. Qué nace cómo lo decide `estaPlegada`.
  const [alternadas, setAlternadas] = useState<Set<string>>(new Set());
  const isCollapsed = (id: string) => estaPlegada(id, alternadas);
  const toggleCollapse = (id: string) =>
    setAlternadas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // A newly-viewed date invalidates any measured summary/trace from before.
  useEffect(() => { setRouteInfo({}); setRouteTrips({}); setRouteLines({}); setRouteEtas({}); setErr(null); }, [date]);

  const focusOnly = (name: string) => setSelected(new Set([name]));
  const toggleDriver = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // CADA DÍA ES APARTE (D-331). Viendo hoy, esta lista arrastraba también lo atrasado y lo que no tenía fecha,
  // mezclado con lo del día en la tabla, los totales, las rutas y el mapa. El dueño lo rechazó. Ahora el día es
  // SOLO su fecha; lo atrasado y lo sin fecha se cuenta aparte y se ve aparte (`soloPendientes`), nunca dentro de
  // un día que no es el suyo. Qué entra lo decide `ordenesDelDia`, que tiene sus pruebas.
  // El plan PUBLICADO de la fecha que se mira, leído una vez por fecha: para las etiquetas P/D de las rutas que escribió.
  // Viendo «todas» o las pendientes no hay UNA fecha, así que no hay plan con el que comparar.
  // `publicaciones` sube cada vez que «Plan del día» publica: sin eso, recién publicado, aquí seguiría el plan de la carga.
  const [publicaciones, setPublicaciones] = useState(0);
  const rutasPublicadas = usePlanPublicadoDelGestor(allDates || soloPendientes ? null : date, publicaciones);
  const paradasPublicadasDe = (chofer: string | null | undefined) => rutasPublicadas?.find((r) => r.chofer === chofer)?.paradas ?? null;
  // La línea del plan PUBLICADO de cada chofer, por calles y en el orden del plan (D-352). Se pide al seleccionar al
  // chofer, una vez por chofer y fecha, y manda sobre el trazo medido de la tarjeta, que no conoce las recogidas.
  const [trazosDelPlan, setTrazosDelPlan] = useState<Record<string, [number, number][]>>({});
  useEffect(() => { setTrazosDelPlan({}); }, [date, rutasPublicadas]);
  useEffect(() => {
    if (!rutasPublicadas) return;
    for (const chofer of selected) {
      if (trazosDelPlan[chofer] !== undefined) continue;
      const paradas = paradasPublicadasDe(chofer);
      // Ni se pide (Google cuesta) si ya no hay nada que pintar: sin pendientes, o la ruta ya no es la publicada (D-NEXT).
      if (!paradas || !sigueSuPlan(chofer)) continue;
      const puntos = puntosDelTrazoPublicado(paradas, deliveries, settings.stores ?? []);
      if (puntos.length < 2) { setTrazosDelPlan((p) => ({ ...p, [chofer]: [] })); continue; }
      setTrazosDelPlan((p) => ({ ...p, [chofer]: [] }));
      void fetch("/api/optimize-route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: puntos, roundtrip: false, optimize: false, date }),
      }).then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data?.geometry)) return;
        const geom = (data.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
        setTrazosDelPlan((p) => ({ ...p, [chofer]: geom }));
      }).catch(() => undefined);
    }
  }, [selected, rutasPublicadas, trazosDelPlan, deliveries, settings.stores, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const modo: ModoDelGestor = soloPendientes ? "pendientes" : allDates ? "todas" : "dia";
  const dayOrders = useMemo(() => ordenesDelDia(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);
  const pendientes = useMemo(() => pendientesDeOtrosDias(deliveries, ROUTE_STAGES), [deliveries]);

  // Lo único que logística cambia en una orden atrasada o sin fecha: ponerle su día. Entonces pasa a ESE día.
  // The one thing logistics can change on a carried-forward order: push its
  // delivery date up to today, or leave it — either way it's on this list.
  const reschedule = (id: string, delivery_date: string) => updateDelivery(id, { delivery_date });

  const geocoding = useAutoGeocode(dayOrders, updateDelivery);
  // Every store as a big red landmark point, always shown on the route map.
  const storeMarkers = useStoreMarkers(settings.stores);

  // On-shift drivers whose phone has gone quiet. Recomputed on a timer so the
  // warning appears as the gap opens, not only when something else rerenders.
  const [healthTick, setHealthTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setHealthTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const trackingIssues = useMemo(
    () => trackingGaps(users, shifts, driverLocations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, driverLocations, healthTick],
  );
  // Drivers on shift AND reporting — drives the LIVE tag. Recomputed on the
  // same minute tick so the tag clears by itself when a phone goes quiet, not
  // only when a new position happens to arrive.
  const liveNames = useMemo(
    () => liveDriverNames(users, shifts, driverLocations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, driverLocations, healthTick],
  );
  // Set by tapping a driver's LIVE tag: frame the map on where they are right
  // now. Cleared as soon as anything else takes over the map, so it's a
  // one-shot "show me" rather than a mode to get stuck in.
  const [locateDriver, setLocateDriver] = useState<string | null>(null);
  useEffect(() => { setLocateDriver(null); }, [selected, selectedOrders]);
  // The order opened from a stop's ID — the dispatcher wants the order itself,
  // not just its pin.
  const [openOrder, setOpenOrder] = useState<Delivery | null>(null);

  // Where each driver's phone last reported from, so the dispatcher can see
  // the fleet against the routes they planned.
  const liveDrivers = useMemo(() => {
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    // Misma regla que el mapa de despacho y que la ruta del día de Almacén (D-289). El color se
    // pasa como estaba aquí: esta pantalla no usa `colorDeChofer`.
    const color = (n: string) => settings.driver_colors?.[n] || fallbackDriverColor(n);
    return choferesEnVivo(driverLocations, nameById, color).map((c) => ({ ...c, label: etiquetaEnVivo(c, t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocations, users, settings.driver_colors]);

  const drivers = useMemo(() => users.filter((u) => u.role === "driver"), [users]);
  const realDriverNames = useMemo(() => new Set(drivers.map((d) => d.full_name)), [drivers]);
  const isRealDriver = (name: string) => realDriverNames.has(name);

  // "Route buckets" — build routes before a real driver exists. Each bucket is a
  // pseudo-driver (its name lives in assigned_driver) so the whole route
  // machinery works on it; later the route is handed to an actual driver.
  const bucketNames = useMemo(
    () => (settings.route_buckets ?? []).filter((n) => !drivers.some((d) => d.full_name === n)),
    [settings.route_buckets, drivers],
  );
  const isBucket = (name: string) => bucketNames.includes(name);

  // ---- Loads: a driver can run several routes in a day, each a separate
  // truckload/trip. A "lane" is one such load (or a route bucket). The pure
  // lane logic (keys, grouping, merge) lives in lib/route-lanes for testing;
  // these thin wrappers bind it to this page's `isBucket` / `dayOrders`. ----
  const orderLaneKey = (d: Delivery) => orderLaneKeyPure(d, isBucket);

  interface Lane { id: string; key: string; driver: string; load: number; label: string; isBucket: boolean; store: string | null; }
  // Lanes = each real driver's load(s) + each bucket, used everywhere we DISPLAY
  // or build routes.
  const lanes = useMemo<Lane[]>(() => {
    const out: Lane[] = [];
    const seen = new Set<string>();
    const add = (l: Lane) => { if (!seen.has(l.key)) { seen.add(l.key); out.push(l); } };
    // One lane / card per driver and per temp driver. Loads are truckload
    // sections INSIDE the card (see groupIntoLoads), not separate lanes.
    for (const dr of drivers) add({ id: dr.id, key: dr.full_name, driver: dr.full_name, load: 1, label: dr.full_name, isBucket: false, store: dr.store ?? null });
    for (const n of bucketNames) add({ id: `bucket:${n}`, key: n, driver: n, load: 1, label: n, isBucket: true, store: null });
    // Safety net: any assigned group in the day's orders that DIDN'T match a
    // current driver or temp driver still gets a lane — so its route always
    // shows and is counted (e.g. a retired temp driver, or a removed driver).
    for (const d of dayOrders) {
      const key = orderLaneKey(d);
      if (!key || seen.has(key)) continue;
      const bucket = isBucket(d.assigned_driver || "");
      add({ id: `orphan:${key}`, key, driver: key, load: 1, label: key, isBucket: bucket, store: null });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, dayOrders, bucketNames, t]);
  // El filtro de chofer que manda ahora (D-393): lo guardado si esa ruta sigue en la pantalla; si no, «Todos».
  const filtroChofer = filtroVigente(filtroGuardado, lanes.map((l) => l.key));
  const pasaFiltro = (ruta: string | null | undefined) => pasaElFiltroDeChofer(filtroChofer, ruta);
  const lanesDelFiltro = lanes.filter((l) => pasaFiltro(l.key));

  // The next free load number for a driver (1 if they have no work yet).
  const nextLoadFor = (driver: string) => nextLoadForPure(dayOrders, driver);
  // Desde qué puesto se numera la ruta de un chofer al moverla a mano: tras lo que ya recogió o entregó en esas fechas, que
  // el Gestor no enseña pero «Mi ruta» sí (D-433, `inicioDeLaSecuencia`).
  // Lo ya recogido o entregado de esa ruta en las fechas de sus paradas: no se pinta, pero sí cuenta para numerar y para
  // saber si la ruta sigue siendo la publicada (D-433, `lecturaConLoHecho`).
  const hechasDeLaRuta = (laneKey: string, stops: Delivery[]) =>
    hechasDelChofer(deliveries, laneKey, new Set(stops.map((s) => s.delivery_date ?? null)));
  const inicioDeLaRuta = (laneKey: string, stops: Delivery[]) => inicioDeLaSecuencia(hechasDeLaRuta(laneKey, stops));
  // La parada recién movida se resalta un momento, para que se vea a dónde fue (D-433).
  const [recienMovida, setRecienMovida] = useState<string | null>(null);
  const senalaLaMovida = (id: string) => {
    setRecienMovida(id);
    setTimeout(() => setRecienMovida((x) => (x === id ? null : x)), 2500);
  };
  // El selector «Viaje N» de una parada (D-433): la pasa al final de otro viaje del mismo chofer, o a uno nuevo. Qué se
  // escribe lo decide `planDeCambioDeViaje`: la ruta ENTERA —puesto y viaje de cada parada—, no solo la movida. Antes se
  // escribía la movida con `route_seq: null`, y una ruta con una parada sin puesto se lee a medias (D-336): la movida salía
  // «—» y desaparecían todas las filas de recogida de la tarjeta. Y a un viaje donde no cabe, no: se dice cuánto lleva.
  const moveStopToLoad = async (d: Delivery, destino: number) => {
    const driver = d.assigned_driver;
    if (!driver) return;
    const stops = byDriver.get(driver) ?? [];
    const capacidad = capacityFor(driverOf(driver));
    const trips = buildTrips(stops, capacidad);
    const plan = planDeCambioDeViaje(trips, d.id, destino, capacidad, inicioDeLaRuta(driver, stops));
    if (!plan.ok) {
      if (plan.motivo === "no_cabe") {
        notify(t(
          `#${orderLabel(d)} doesn't fit in truckload ${plan.viaje}: it already carries ${plan.carga} of ${plan.capacidad} pallets and this stop is ${plan.pallets}. Nothing was moved — use “New truckload”.`,
          `#${orderLabel(d)} no cabe en el viaje ${plan.viaje}: ya lleva ${plan.carga} de ${plan.capacidad} pallets y esta parada son ${plan.pallets}. No se movió nada — use «Nuevo viaje».`,
        ));
      }
      return;
    }
    clearRouteFor(driver);
    // Hand-placed (`load_auto: false`): the truckloads are a person's call from here on.
    const ok = await reorderStops(plan.ids, plan.loadNoById, false, plan.desde);
    if (!ok) return;
    senalaLaMovida(d.id);
    notify(plan.excede
      ? t(`Moved to a new truckload ${plan.viaje} — on its own it's already over the truck's ${capacidad} pallets.`, `Movido a un viaje nuevo, el ${plan.viaje} — sola ya pasa los ${capacidad} pallets del camión.`)
      : plan.nuevo
        ? t(`Moved to a new truckload ${plan.viaje}`, `Movido a un viaje nuevo, el ${plan.viaje}`)
        : t(`Moved to truckload ${plan.viaje}`, `Movido al viaje ${plan.viaje}`));
    // Entra en deshacer/rehacer como las flechas (D-417).
    const antes = fotoDe(trips.flat().map(aParadaDelGantt));
    await anotaMovimiento({ en: `#${orderLabel(d)} → truckload ${plan.viaje}`, es: `#${orderLabel(d)} → viaje ${plan.viaje}` }, [driver], antes, fotoTrasReordenar(antes, plan.ids, plan.loadNoById, plan.desde));
  };
  // Split a lane's stops into truckloads: by the dispatcher's manual load
  // numbers when set, otherwise automatically by truck capacity.
  const buildTrips = (stops: Delivery[], capacity: number): Delivery[][] =>
    hasManualLoads(stops) ? groupIntoLoads(stops) : splitIntoTrips(stops, capacity);
  // «🔗 Unir viajes» y «✂ Dividir en 2» (D-NEXT): la ruta ENTERA en el orden que se ve, con su viaje nuevo, numerada tras
  // lo ya hecho (como las flechas, D-433). Antes dejaban `route_seq: null` para que «Optimizar» rehiciera el orden; sin
  // Optimizar, eso tiraba el orden puesto a mano. «Reagrupar por zona» (borraba los viajes y optimizaba) se quitó.
  const combineLoads = async (laneKey: string) => {
    const stops = byDriver.get(laneKey) ?? [];
    const plan = planDeUnirViajes(buildTrips(stops, capacityFor(driverOf(laneKey))), inicioDeLaRuta(laneKey, stops));
    clearRouteFor(laneKey);
    if (!(await reorderStops(plan.ids, plan.loadNoById, false, plan.desde))) return;
    notify(t("Combined into one truckload", "Unido en un solo viaje"));
  };
  const splitLoads = async (laneKey: string) => {
    const stops = byDriver.get(laneKey) ?? [];
    const plan = planDeDividirEnDos(buildTrips(stops, capacityFor(driverOf(laneKey))), inicioDeLaRuta(laneKey, stops));
    if (!plan) return;
    clearRouteFor(laneKey);
    if (!(await reorderStops(plan.ids, plan.loadNoById, false, plan.desde))) return;
    notify(t("Split into 2 truckloads", "Dividido en 2 viajes"));
  };
  // Friendly display name for a lane key.
  const laneLabel = (key: string) => lanes.find((l) => l.key === key)?.label ?? key;
  // 🔒 (D-411): ¿esta ruta está bloqueada en el día que se mira? Desde D-NEXT lo mira «📍 Mejor lugar» (y el arrastre al
  // nombre de un chofer, que es Mejor lugar); «Armar las rutas del día» lo lee en el servidor (D-414). A mano (flechas,
  // «Asignar») no se mira. Optimizar, Auto-asignar, Simular y el dibujo que optimizaba, que también lo miraban, se quitaron.
  const bloqueada = (laneKey: string) => estaBloqueada(bloqueos, date, laneKey);
  const alternaCandado = async (laneKey: string) => {
    const r = await pulsaCandado(candados, date, laneKey, opcionesDeCandados());
    setCandados(r.estado);
    if (r.error) { notify(t(`🔒 Couldn't save the lock for ${laneLabel(laneKey)}: ${r.error}`, `🔒 No se pudo guardar el candado de ${laneLabel(laneKey)}: ${r.error}`)); return; }
    const donde = dondeViveElCandado(r.estado);
    notify(r.bloqueada
      ? t(`🔒 ${laneLabel(laneKey)} locked: Build routes and Best fit leave this route alone (arrows still work). ${donde.en}`, `🔒 ${laneLabel(laneKey)} bloqueada: Armar rutas y Mejor lugar no tocan esta ruta (las flechas sí). ${donde.es}`)
      : t(`🔓 ${laneLabel(laneKey)} unlocked. ${donde.en}`, `🔓 ${laneLabel(laneKey)} desbloqueada. ${donde.es}`));
  };
  // Quién la bloqueó (solo con el candado compartido), para el título del botón.
  const bloqueadaPor = (laneKey: string) => { const id = quienBloqueo(candados.quien, date, laneKey); return id ? users.find((u) => u.id === id)?.full_name ?? null : null; };

  // Merge every checked lane's stops into ONE route (the first checked lane, in
  // panel order). The other lanes' orders take on the target's identity
  // (driver + load, or bucket); emptied buckets are removed. The moved stops
  // carry no sequence yet, so they read after the target's own (arrows fix that).
  const mergeSelectedLanes = async () => {
    const plan = planMerge(lanes, selected, byDriver);
    if (!plan) return;
    for (const id of plan.moveIds) await updateDelivery(id, plan.patch);
    for (const b of plan.removeBuckets) removeBucket(b);
    clearRouteFor(plan.targetKey);
    setSelected(new Set([plan.targetKey]));
    notify(t(`Merged ${plan.moveIds.length} stop(s) into ${laneLabel(plan.targetKey)}`, `${plan.moveIds.length} parada(s) unidas en ${laneLabel(plan.targetKey)}`));
  };

  // Create a temp driver / route bucket. An optional custom name is used as-is
  // (de-duplicated); otherwise auto-names "Route N".
  const addBucket = (customName?: string): string => {
    const existing = settings.route_buckets ?? [];
    const taken = (nm: string) => existing.includes(nm) || drivers.some((d) => d.full_name === nm);
    let name = (customName ?? "").trim();
    if (name) {
      let base = name, k = 2;
      while (taken(name)) { name = `${base} ${k++}`; }
    } else {
      let n = 1;
      while (taken(`Route ${n}`)) n++;
      name = `Route ${n}`;
    }
    saveSettings({ route_buckets: [...existing, name] });
    notify(t(`Added ${name}`, `${name} agregada`));
    return name;
  };
  const removeBucket = (name: string) => {
    return saveSettings({ route_buckets: (settings.route_buckets ?? []).filter((b) => b !== name) });
  };
  // Rename a temp driver: move its orders onto the new name and update the list.
  const renameBucket = async (oldName: string) => {
    const nm = window.prompt(t("Rename temp driver:", "Renombrar chofer temp:"), oldName);
    if (nm === null) return;
    const newName = nm.trim();
    if (!newName || newName === oldName) return;
    if ((settings.route_buckets ?? []).includes(newName) || drivers.some((d) => d.full_name === newName)) {
      notify(t("That name is already taken.", "Ese nombre ya está en uso."));
      return;
    }
    for (const d of [...(byDriver.get(oldName) ?? [])]) await updateDelivery(d.id, { assigned_driver: newName });
    saveSettings({ route_buckets: (settings.route_buckets ?? []).map((b) => (b === oldName ? newName : b)) });
    notify(t(`Renamed to ${newName}`, `Renombrado a ${newName}`));
  };
  // Hand a whole bucket's route to a real driver as a distinct LOAD (keeping its
  // saved sequence), then retire the bucket. If the driver already has
  // work, this becomes their next load — so one driver can carry several routes.
  const assignRouteToDriver = async (bucket: string, driver: string) => {
    if (!driver) return;
    const stops = byDriver.get(bucket) ?? [];
    const load = nextLoadFor(driver);
    for (const d of stops) {
      await updateDelivery(d.id, { assigned_driver: driver, load_no: load });
      addNote(d.id, `Route "${bucket}" assigned to ${driver} as load ${load}`);
    }
    removeBucket(bucket);
    notify(t(`Route "${bucket}" (${stops.length} stop(s)) → ${driver}, load ${load}`, `Ruta "${bucket}" (${stops.length} parada(s)) → ${driver}, carga ${load}`));
  };
  // Delete a whole route/load: unassign every stop (back to the pool) and, if
  // it was a bucket, retire it.
  const clearLane = async (laneKey: string) => {
    const stops = deliveries.filter((d) => (d.assigned_driver || "") === laneKey);
    // Confirm first — this sends every stop back to Unassigned (and removes the
    // route if it's a temp route).
    const ok = await confirmAction(
      t(`Clear ${laneLabel(laneKey)}? Its ${stops.length} order(s) go back to Unassigned.`,
        `¿Vaciar ${laneLabel(laneKey)}? Sus ${stops.length} orden(es) vuelven a Sin asignar.`),
      { danger: true, confirmLabel: t("Clear route", "Vaciar ruta") },
    );
    if (!ok) return;
    // Clear EVERY order on this lane across ALL dates, not just the day in view,
    // so a stop left on another date can't rebuild the route on reload. Await all
    // writes (and the bucket removal) so the cleared state is fully persisted.
    await Promise.all(stops.map((d) => updateDelivery(d.id, { assigned_driver: null, route_seq: null, load_no: null })));
    stops.forEach((d) => addNote(d.id, `Unassigned (was ${laneKey})`));
    if (isBucket(laneKey)) await removeBucket(laneKey);
    await Promise.all(stops.map((d) => updateDelivery(d.id, { assigned_driver: null, route_seq: null, load_no: null })));
    stops.forEach((d) => addNote(d.id, `Unassigned (was ${laneKey})`));
    if (isBucket(laneKey)) await removeBucket(laneKey);
    clearRouteFor(laneKey);
    notify(t(`Cleared ${stops.length} stop(s) from ${laneLabel(laneKey)}`, `${stops.length} parada(s) quitadas de ${laneLabel(laneKey)}`));
  };
  // Drivers on vacation/sick/maintenance for the selected day — flagged «off today» in «Elige conductor».
  const unavailableToday = useMemo(
    () => unavailableDriverNames(availability, new Map(users.map((u) => [u.id, u.full_name])), date),
    [availability, users, date],
  );
  const colorFor = (driver: string | null) => (driver ? settings.driver_colors?.[driver] || fallbackDriverColor(driver) : UNASSIGNED_COLOR);
  // A driver's own capacity, else the fleet-wide default, else the built-in.
  const capacityFor = (driver: string) => settings.driver_capacity?.[driver] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
  // Requisitos del camión (D-418): «Mejor lugar» no le da a un chofer una orden que pide algo que su camión no tiene.
  const { faltanA } = useRequisitosDelCamion();
  // Zonas preferidas (D-421): en «Elige conductor», los de la zona de lo marcado salen primero. Solo sugerencia.
  const zonasDeChofer = useZonasDeChofer();
  const setCapacity = (driver: string, capacity: number) => {
    clearRouteFor(driver);
    saveSettings({ driver_capacity: { ...(settings.driver_capacity ?? {}), [driver]: capacity } });
  };

  // A driver's route is a loop from the PICKUP point (where they load the
  // truck), out to the deliveries, and back to the pickup to reload for the
  // next truckload. The pickup is taken from the orders themselves (their
  // pickup_address / sold-from store), falling back to the driver's own
  // home store — whichever we can resolve.
  const pickupAddressFor = (laneKey: string): string | null => {
    const driver = driverOf(laneKey);
    const stops = byDriver.get(laneKey) ?? [];
    const counts = new Map<string, number>();
    for (const d of stops) {
      const a = (d.pickup_address || "").trim();
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
    if (best) return best;
    // No pickup address on the orders — fall back to a sold-from store's
    // address, then the driver's assigned home store.
    for (const d of stops) {
      const addr = settings.stores.find((s) => s.name === d.store)?.address;
      if (addr) return addr;
    }
    const profile = users.find((u) => u.full_name === driver);
    return profile?.store ? (settings.stores.find((s) => s.name === profile.store)?.address ?? null) : null;
  };

  // Geocode (and cache, keyed by the address string) a pickup/depot address.
  const getDepotCoords = async (address: string | null): Promise<[number, number] | null> => {
    const key = (address ?? "").trim();
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

  // Lo del día sin chofer. Es lo que cuentan el resumen, la pestaña y el tablero (y contaba «Auto-asignar», quitado en
  // D-NEXT): el DÍA, sea cual sea el chip de la tabla. Hasta D-393 el chip «Atrasadas» cambiaba también esta lista, y con él el «Sin programar» del
  // resumen y lo que «Auto-asignar» repartía; con un chip «Todas» de cualquier día, «Programadas» habría salido negativo.
  const unassigned = useMemo(() => sinAsignarDelGestor(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);
  // Las filas de la TABLA «Sin asignar», según su chip (D-359 «Atrasadas», D-393 «Todas»), y el número de cada chip,
  // que sale de la misma función: el número es el de las filas que enseña (patrón de D-380/D-384).
  const filasDelChip = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter), [deliveries, date, modo, poolFilter]);
  const cuentasDeChips = useMemo(() => cuentasSinAsignar(deliveries, date, modo, ROUTE_STAGES, orderSearch), [deliveries, date, modo, orderSearch]);

  // Draw each selected unassigned load's pickup→dropoff route on the map
  // (throttled, cached), so pressing loads shows where they go.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const chosen = dayOrders.filter((d) => selectedOrders.has(d.id) && d.delivery_lat != null && d.delivery_lng != null);
      for (const d of chosen) {
        if (cancelled) return;
        const addr = (d.pickup_address || settings.stores.find((s) => s.name === d.store)?.address || d.store || "").trim();
        const pk = await getDepotCoords(addr);
        if (cancelled) return;
        if (!pk) continue;
        // Record the pickup point right away so the "P" pin + straight PU→DEL
        // line appear on selection, even while the road geometry is still loading.
        setSelPickup((p) => (p[d.id] && p[d.id][0] === pk[0] && p[d.id][1] === pk[1] ? p : { ...p, [d.id]: pk }));
        if (selRouteCache[d.id]) continue;
        try {
          const res = await fetch("/api/optimize-route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stops: [{ id: "p", lat: pk[0], lng: pk[1] }, { id: "d", lat: d.delivery_lat, lng: d.delivery_lng }], roundtrip: false }),
          });
          const b = await res.json();
          if (!cancelled && res.ok && Array.isArray(b.geometry) && b.geometry.length) {
            const positions = (b.geometry as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
            setSelRouteCache((p) => ({ ...p, [d.id]: positions }));
          }
        } catch { /* skip */ }
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrders, dayOrders]);

  // A distinct color per selected load (shared by its pickup pin + route),
  // whether the load is assigned or still in the pool.
  const selColorById = useMemo(() => {
    const m = new Map<string, string>();
    dayOrders.filter((d) => selectedOrders.has(d.id)).forEach((d, i) => m.set(d.id, SEL_PALETTE[i % SEL_PALETTE.length]));
    return m;
  }, [dayOrders, selectedOrders]);

  // How many of the selected loads are still in the pool — the bulk-assign
  // controls act on these only (a selected assigned load is just a map view).
  const poolSelectedCount = useMemo(
    () => filasDelChip.reduce((n, d) => n + (selectedOrders.has(d.id) ? 1 : 0), 0),
    [filasDelChip, selectedOrders],
  );
  // Sin nada marcado el recuadro se va, y lo que se pulsó en él se olvida: la próxima tanda vuelve a preguntar (D-395).
  useEffect(() => { if (poolSelectedCount === 0) setConductorPulsado(null); }, [poolSelectedCount]);

  // Search + saved filter over the unassigned pool. La misma función que da el número de cada chip (D-393).
  const unassignedShown = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter, orderSearch), [deliveries, date, modo, poolFilter, orderSearch]);

  // Each driver's stops for the day, in their current sequence (saved
  // order first, unsequenced ones after — same rule as the Driver page).
  // Keyed by LANE (driver+load, or bucket), so each of a driver's loads is its
  // own route.
  const byDriver = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of dayOrders) {
      const key = orderLaneKey(d);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.route_seq != null && b.route_seq != null) return a.route_seq - b.route_seq;
        if (a.route_seq != null) return -1;
        if (b.route_seq != null) return 1;
        return a.order_no - b.order_no;
      });
    }
    return map;
  }, [dayOrders]);
  // ¿Se pinta la línea del plan publicado de esta ruta? Solo con paradas pendientes y si sigue siendo la publicada
  // (D-NEXT, `pintaElTrazoDelPlan`): la de Julio, vacío, seguía en el mapa.
  const sigueSuPlan = (laneKey: string): boolean => {
    const stops = byDriver.get(laneKey) ?? [];
    const paradas = paradasPublicadasDe(laneKey);
    if (!paradas) return false;
    const lectura = lecturaConLoHecho(buildTrips(stops, capacityFor(driverOf(laneKey))), paradas, hechasDeLaRuta(laneKey, stops));
    return pintaElTrazoDelPlan(stops.length, lectura.fuente);
  };

  // «Elige conductor para N órdenes» (D-395): todos los choferes y rutas temporales, con los números del panel
  // «Choferes y rutas» (📦 paradas y pallets/capacidad); el del filtro de arriba, primero y ya elegido.
  const opcionesDelRecuadro = opcionesDeConductor({
    rutas: [
      ...drivers.map((u) => ({ clave: u.full_name, etiqueta: u.full_name, esRuta: false })),
      ...bucketNames.map((n) => ({ clave: n, etiqueta: n, esRuta: true })),
    ],
    paradasDe: (k) => (byDriver.get(k) ?? []).length,
    palletsDe: (k) => sumaPallets(byDriver.get(k) ?? []),
    capacidadDe: (k) => capacityFor(k),
    noDisponibles: unavailableToday,
    filtro: filtroChofer,
    enSuZona: (k) => esDeSuZona(k, filasDelChip.filter((d) => selectedOrders.has(d.id)), zonasDeChofer, settings.stores ?? []),
  });
  const conductorElegido = eleccionVigente(conductorPulsado, opcionesDelRecuadro);

  // Ordenar y filtrar por columna en «Sin asignar» (D-360), con el menú de Órdenes. El valor de cada columna lo decide
  // `valorDelGestor`; las que vienen de Órdenes (D-376) toman el valor, la celda y la etiqueta de la columna de Órdenes,
  // con el mismo contexto con que Órdenes las llama (idioma, traducción y motivos de anulación).
  // `recibidas`: la columna de Etapa pinta «Received» en las que recibió almacén (D-409), como en Órdenes.
  const recibidas = useMemo(() => idsRecibidasPorAlmacen(events), [events]);
  const ctxDeOrdenes = useMemo(() => ({ lang, t, motivos: motivosDeAnulacion(settings), recibidas }), [lang, t, settings, recibidas]);
  const deOrdenes = useMemo(() => ({ catalogo: ORDER_COLUMNS, ctx: ctxDeOrdenes }), [ctxDeOrdenes]);
  // Las ciudades conocidas para leer una dirección escrita sin comas (D-423, `ciudadDeEntrega`): las que salen limpias de
  // las órdenes cargadas y de las tiendas, y las zonas de los choferes. La misma lista para la celda, el orden y el filtro.
  const ciudadesQueSeConocen = useMemo(
    () => [...ciudadesConocidas([...deliveries.map((d) => d.delivery_address), ...(settings.stores ?? []).map((s) => s.address)]), ...[...zonasDeChofer.values()].flat()],
    [deliveries, settings.stores, zonasDeChofer],
  );
  const valorDelGestorAqui = useCallback((clave: string, d: Delivery) => valorDelGestor(clave, d, deOrdenes, ciudadesQueSeConocen), [deOrdenes, ciudadesQueSeConocen]);
  const ordenSinAsignar = useOrdenYFiltro(unassignedShown, valorDelGestorAqui);
  // Las cabeceras con menú son las del catálogo (la fecha se lista formateada, y el costo como dinero). El ID fijo que iba
  // delante se quitó (D-408): el dueño, «routes manager doesn't need to see id».
  const menuSinAsignar: ColumnaConMenu[] = colsSinAsignar.map((c) => ({ ...c, etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));
  /** La celda de una columna que el Gestor toma de Órdenes: la MISMA función que pinta Órdenes, o nada si no viene de allí. */
  const celdaDeOrdenes = (clave: string, d: Delivery) => columnaDeOrdenes(clave, ORDER_COLUMNS)?.cell(d, ctxDeOrdenes);
  /** La celda de la tabla del plan (D-434): sus dos columnas propias —tipo de cliente y ciudad de recogida— y, las demás, la de
   *  Órdenes. La ciudad se lee con las mismas tiendas y ciudades conocidas que el resto del Gestor. */
  const celdaDelPlan = (clave: string, d: Delivery) =>
    celdaPropiaDelPlan(clave, d, { reglas: settings.order_type_rules, tiendas: settings.stores ?? [], conocidas: ciudadesQueSeConocen, es: lang === "es" }) ?? celdaDeOrdenes(clave, d);
  /** Las pastillas (la etapa, «Tarde») bajan de línea en vez de cortarse, como en Órdenes (D-364). */
  const clasePastillas = (clave: string) => (columnaDeOrdenes(clave, ORDER_COLUMNS)?.pastillas ? "td-pastillas" : undefined);
  // Pulsar el ID o la factura abre la orden entera, como en la tabla de paradas por chofer (D-360). Para el
  // dueño «still pending the clicking on the ID or invoice # to view the full order details».
  const abreLaOrden = (d: Delivery) => ({
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpenOrder(d); },
    style: { cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 } as const,
    title: t("Open this order", "Abrir esta orden"),
  });
  // Sin la columna del ID (D-408), el enlace que abre la orden es la FACTURA, en «Sin asignar» y en las paradas. Una orden
  // sin factura enseña su código en gris (`textoQueAbreLaOrden`), para que ninguna fila se quede sin nada que pulsar.
  const enlaceALaOrden = (d: Delivery) => {
    const { texto, esFactura } = textoQueAbreLaOrden(d);
    const gesto = abreLaOrden(d);
    return <span {...gesto} data-abre-la-orden style={esFactura ? gesto.style : { ...gesto.style, color: "var(--gray)" }}>{texto}</span>;
  };

  // Columns for the drag-and-drop board: the unassigned pool, then one per driver.
  const boardColumns: BoardColumn[] = useMemo(() => {
    const cols: BoardColumn[] = [
      { key: "__unassigned__", title: t("Unassigned", "Sin asignar"), color: UNASSIGNED_COLOR, orders: unassigned },
    ];
    for (const u of lanes) {
      const orders = byDriver.get(u.key) ?? [];
      const pallets = sumaPallets(orders);
      cols.push({ key: u.key, title: u.label, color: colorFor(u.driver), orders, sub: `${pallets}/${capacityFor(u.driver)}` });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unassigned, lanes, byDriver, settings.driver_colors, settings.driver_capacity, lang]);

  // Print a driver's route for the selected day, in its saved stop sequence
  // (route_seq when planned, else by order number).
  const printManifestFor = (laneKey: string) => {
    const stops = [...(byDriver.get(laneKey) ?? [])].sort(
      (a, b) => (a.route_seq ?? 9999) - (b.route_seq ?? 9999) || a.order_no - b.order_no,
    );
    const label = lanes.find((l) => l.key === laneKey)?.label ?? driverOf(laneKey);
    printRouteManifest(label, stops, settings, lang, fmtDate(date));
  };

  // «📅 Horario» (D-417): cada ruta del día en su orden y sus viajes (`buildTrips`, lo mismo que la tabla de paradas), con
  // cada parada a su hora ESTIMADA (la de «📍 Mejor lugar»: línea recta, sin llamar a Google). Es lo que pinta la línea de
  // tiempo y lo que lee el arrastre: se suelta sobre lo mismo que se ve.
  // La base: las coordenadas de la tienda en Ajustes si las tiene; si no, las que la pantalla ya buscó para pintar la «P».
  const baseDeLaRuta = (laneKey: string): { lat: number; lng: number } | null => {
    const direccion = (pickupAddressFor(laneKey) ?? "").trim();
    const tienda = settings.stores.find((s) => (s.address || "").trim() === direccion && s.lat != null && s.lng != null);
    if (tienda) return { lat: tienda.lat!, lng: tienda.lng! };
    const c = depotCoords[direccion];
    return c ? { lat: c[0], lng: c[1] } : null;
  };
  const aParadaDelGantt = (x: Delivery): ParadaDelGantt => ({
    id: x.id, lat: x.delivery_lat, lng: x.delivery_lng, pallets: palletsDeLaOrden(x),
    ventana: parseWindow(x.delivery_windows), servicioMin: serviceMin(x.delivery_duration),
    assigned_driver: x.assigned_driver ?? null, route_seq: x.route_seq ?? null, load_no: x.load_no ?? null,
  });
  const rutasDelGantt: RutaDelGantt[] = lanes.map((l) => {
    const stops = byDriver.get(l.key) ?? [];
    const capacidad = capacityFor(driverOf(l.key));
    return {
      clave: l.key, viajes: buildTrips(stops, capacidad).map((v) => v.map(aParadaDelGantt)), manual: hasManualLoads(stops),
      capacidad, bloqueada: bloqueada(l.key), base: baseDeLaRuta(l.key),
    };
  });
  // Una fila por ruta, también las vacías: se puede soltar una parada en un chofer que aún no tiene nada.
  const ganttRows: GanttRow[] = rutasDelGantt.map((r) => {
    const l = lanes.find((x) => x.key === r.clave)!;
    return {
      key: r.clave, title: l.label, color: colorFor(l.driver), orders: byDriver.get(r.clave) ?? [],
      barras: barrasDeLaRuta(r.viajes, r.base, DAY_START_MIN), bloqueada: r.bloqueada,
    };
  });

  // A driver's stops changed, so any earlier measured summary/trace is stale —
  // drop it rather than show a route that no longer matches. (With the driver
  // selected it's measured again, in the NEW order: see `mideLaRuta`.)
  const clearRouteFor = (driver: string) => {
    setRouteInfo((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    // Regrouping the loads renumbers them, so per-truckload figures would be
    // attached to the wrong load — drop them with the rest.
    setRouteTrips((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteLines((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
    setRouteEtas((p) => { const { [driver]: _drop, ...rest } = p; return rest; });
  };
  const assignTo = (id: string, driver: string) => {
    clearRouteFor(driver);
    // A plain (dropdown / drag) assignment always lands on the driver's first
    // load; multi-load assignment goes through assignRouteToDriver.
    return updateDelivery(id, { assigned_driver: driver || null, route_seq: null, load_no: null });
  };
  const unassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    if (d) { const k = orderLaneKey(d); if (k) clearRouteFor(k); }
    return updateDelivery(id, { assigned_driver: null, route_seq: null, load_no: null });
  };

  // Assign an order onto a lane (a driver or temp driver) — used by the board's
  // drag-and-drop onto a column. Lands on the lane's first truckload.
  const assignToLane = async (id: string, laneKey: string) => {
    const d = dayOrders.find((x) => x.id === id);
    clearRouteFor(laneKey);
    await updateDelivery(id, { assigned_driver: laneKey, route_seq: null, load_no: null });
    addNote(id, `Moved to ${laneKey}${d?.assigned_driver ? ` (from ${d.assigned_driver})` : ""}`);
  };

  // A single manual (re)assignment — assign + write an audit note.
  const manualAssign = (id: string, driver: string) => {
    const d = dayOrders.find((x) => x.id === id);
    assignTo(id, driver);
    addNote(id, `Assigned to ${driver}${d?.assigned_driver && d.assigned_driver !== driver ? ` (from ${d.assigned_driver})` : ""}`);
  };
  const manualUnassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    unassign(id);
    if (d?.assigned_driver) addNote(id, `Unassigned (was ${d.assigned_driver})`);
  };

  // Drag-and-drop on the board: move an order to a driver column, or back to
  // the unassigned pool.
  const boardMove = (orderId: string, columnKey: string) => {
    const d = dayOrders.find((x) => x.id === orderId);
    if (!d) return;
    if (columnKey === "__unassigned__") { if (d.assigned_driver) manualUnassign(orderId); }
    else if (orderLaneKey(d) !== columnKey) assignToLane(orderId, columnKey);
  };

  /** Mide la ruta de un chofer TAL COMO ESTÁ —sus viajes y su orden, los que pinta la tabla (`buildTrips`)— para las millas,
   * las horas por viaje, la llegada estimada de cada parada y el trazo del mapa. NO reordena ni escribe nada (D-NEXT).
   * Hasta D-NEXT esto era `computeRoute` + `applyPlan` («Optimizar»): pedía a Google el MEJOR orden, reagrupaba los viajes
   * por zona y lo guardaba. Ahora pide el camino en el orden guardado (`cuerpoDeLaMedida`, `optimize: false`). */
  const mideLaRuta = async (laneKey: string, stopList: Delivery[]): Promise<MedidaDeLaRuta> => {
    const depot = await getDepotCoords(pickupAddressFor(laneKey));
    const batches = buildTrips(stopList, capacityFor(driverOf(laneKey)))
      .map((b) => b.filter((d) => d.delivery_lat != null && d.delivery_lng != null));
    const byId = new Map(stopList.map((d) => [d.id, d]));

    let miles = 0;
    let seconds = 0;
    const traces: TripTrace[] = [];
    const tripStats: (TripStat | null)[] = [];
    const etas: Record<string, string> = {};
    let clock = DAY_START_MIN; // arrival clock, continuous across truckloads

    for (const batch of batches) {
      // Sin nada que medir en este viaje (sin pins, o una sola parada sin base de la que salir): se queda sin números.
      if (!batch.length || (batch.length < 2 && !depot)) { tripStats.push(null); continue; }
      const tripStart = clock;
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The run's own date drives PREDICTIVE traffic: a route planned tonight
        // for tomorrow gets tomorrow-morning conditions, not tonight's empty roads.
        body: JSON.stringify(cuerpoDeLaMedida(batch.map((d) => ({ id: d.id, lat: d.delivery_lat!, lng: d.delivery_lng! })), depot, batch[0]?.delivery_date ?? date)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Route measurement failed");
      if (data.provider) lastProviderRef.current = { provider: data.provider, traffic: !!data.traffic };
      // En el orden guardado: el de la llamada, no el que devuelva el proveedor.
      const stopIds = batch.map((d) => d.id);
      const legs = (data.legs ?? []) as number[];
      miles += data.miles;
      seconds += data.duration_seconds;

      // Split the loop geometry into the delivery run and the empty drive back
      // to the pickup. The return leg starts at the last stop, so find where
      // the path is closest to it (searching from the end) and cut there.
      const geom = ((data.geometry ?? []) as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]);
      const lastStop = depot && stopIds.length ? byId.get(stopIds[stopIds.length - 1]) : undefined;
      if (lastStop?.delivery_lat != null && lastStop.delivery_lng != null && geom.length > 2) {
        let cut = geom.length - 1, best = Infinity;
        for (let k = geom.length - 1; k >= 1; k--) {
          const dLat = geom[k][0] - lastStop.delivery_lat, dLng = geom[k][1] - lastStop.delivery_lng;
          const d2 = dLat * dLat + dLng * dLng;
          if (d2 < best) { best = d2; cut = k; }
        }
        traces.push({ delivery: geom.slice(0, cut + 1), ret: geom.slice(cut) });
      } else {
        traces.push({ delivery: geom, ret: [] });
      }

      // Walk the legs into per-stop arrival clocks. With a depot the trip is
      // [depot, s1, …, sN] so leg k drives INTO stop k; without one the first
      // stop is the start (no lead-in drive).
      for (let j = 0; j < stopIds.length; j++) {
        if (depot || j > 0) clock += (legs[depot ? j : j - 1] ?? 0) / 60;
        etas[stopIds[j]] = fmtClock(clock);
        const stop = byId.get(stopIds[j]);
        if (stop) clock += serviceMin(stop.delivery_duration);
      }
      if (depot) clock += (legs[stopIds.length] ?? 0) / 60;  // empty drive back to pickup

      const timing = tripTiming(data.duration_seconds / 60, stopIds.map((id) => byId.get(id)?.delivery_duration));
      tripStats.push({
        miles: Math.round(data.miles * 10) / 10,
        ...timing,
        stops: stopIds.length,
        start: fmtClock(tripStart),
        end: fmtClock(clock),
      });

      if (depot) clock += RELOAD_MIN;   // reload for the next load
    }

    const medidos = tripStats.filter((s): s is TripStat => s != null);
    return {
      miles: Math.round(miles * 10) / 10,
      seconds,
      traces,
      trips: batches.length,
      tripStats,
      // The reload between loads is real time too, but it isn't part of any
      // single truckload — so it only shows up in the day total.
      dayMinutes: depot ? dayMinutes(medidos) : medidos.reduce((n, s) => n + s.totalMin, 0),
      etas,
    };
  };

  /** Pinta lo medido en la tarjeta y el mapa. Solo pinta: la ruta no se toca. */
  const pintaLaMedida = (driver: string, m: MedidaDeLaRuta) => {
    setRouteInfo((p) => ({ ...p, [driver]: { miles: m.miles, duration_text: fmtMinutes(m.seconds / 60), trips: m.trips, minutes: m.seconds / 60, dayMinutes: m.dayMinutes, dayText: fmtMinutes(m.dayMinutes) } }));
    setRouteTrips((p) => ({ ...p, [driver]: m.tripStats }));
    setRouteLines((p) => ({ ...p, [driver]: m.traces }));
    setRouteEtas((p) => ({ ...p, [driver]: m.etas }));
  };

  // Lo último que se pinta, para no pintar una medida que llega tarde: si la ruta cambió mientras se medía (una flecha
  // a mitad), esa medida es de la forma de antes y se tira; la nueva forma se mide aparte.
  const formaActual = useRef({ date, byDriver });
  formaActual.current = { date, byDriver };
  // De qué forma de la ruta es cada medida pintada. Si la ruta cambia por donde sea —también cuando se le QUITAN paradas
  // desde otra ruta (el tablero y «Asignar» solo limpiaban la de destino)—, lo pintado se tira: así una ruta que se quedó
  // vacía no conserva sus millas ni su línea (Julio, D-NEXT).
  const firmaPintada = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const k of Object.keys(routeInfo)) {
      if (firmaPintada.current[k] !== firmaDeLaMedida(date, k, byDriver.get(k) ?? [])) clearRouteFor(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, routeInfo, date]);
  const mide = async (driver: string, stops: Delivery[]) => {
    setMidiendo(driver);
    const firma = firmaDeLaMedida(date, driver, stops);
    try {
      const m = await mideLaRuta(driver, stops);
      const ahora = formaActual.current;
      if (firmaDeLaMedida(ahora.date, driver, ahora.byDriver.get(driver) ?? []) === firma) { firmaPintada.current[driver] = firma; pintaLaMedida(driver, m); }
    } catch {
      // Sin medida (sin sesión, sin red): la tarjeta se queda sin millas. No se avisa: nadie pidió medir, y la ruta está
      // igual. No se reintenta en bucle: esa forma de la ruta ya se pidió (`firmaDeLaMedida`).
    } finally {
      setMidiendo(null);
      setRouterInfo(lastProviderRef.current);
    }
  };

  const toggleOrder = (id: string) =>
    setSelectedOrders((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelectedOrders(new Set());

  // Assign every checked order to one driver.
  const bulkAssign = async (driver: string) => {
    // Lo marcado en la TABLA, con su chip: con «Todas» o «Atrasadas» se marcan órdenes de otros días (D-359, D-393).
    const ids = filasDelChip.filter((d) => selectedOrders.has(d.id)).map((d) => d.id);
    if (!ids.length || !driver) return;
    setAsignando(true);
    try { for (const id of ids) await assignTo(id, driver); } finally { setAsignando(false); }
    clearSelection();
    notify(t(`Assigned ${ids.length} order(s) to ${driver}`, `Asignadas ${ids.length} orden(es) a ${driver}`));
  };

  // «📍 Mejor lugar» (D-411): cada orden marcada entra SOLA en el hueco más barato de la ruta del elegido, sin
  // reoptimizar nada más. Una detrás de otra: la segunda ya ve a la primera dentro. El hueco lo decide `mejorLugar`
  // (estimación en línea recta, sin llamar a Google ni a OSRM); lo que se escribe, `escrituraDelHueco`.
  const colocaEnElMejorLugar = async (laneKey: string) => {
    if (bloqueada(laneKey)) {
      notify(t(`🔒 ${laneLabel(laneKey)} is locked — Best fit leaves it alone. Unlock it, or use “Assign”.`, `🔒 ${laneLabel(laneKey)} está bloqueada — Mejor lugar no la toca. Desbloquéela, o use «Asignar».`));
      return;
    }
    // El filtro de chofer válido (D-418): lo que su camión no puede llevar ni se coloca ni se asigna al final.
    const { pueden: marcadas, no: sinCamion } = separaPorRequisitos(filasDelChip.filter((d) => selectedOrders.has(d.id)), (d) => faltanA(d, laneKey));
    const noEnEn = sinCamion.map((x) => `#${orderLabel(x.orden)}: ${fraseDeFaltan(x.faltan, "en")}`).join(", ");
    const noEnEs = sinCamion.map((x) => `#${orderLabel(x.orden)}: ${fraseDeFaltan(x.faltan, "es")}`).join(", ");
    if (!marcadas.length) {
      if (sinCamion.length) notify(t(`Not placed — ${laneLabel(laneKey)}'s truck lacks what they need: ${noEnEn}.`, `Sin colocar — el camión de ${laneLabel(laneKey)} no tiene lo que piden: ${noEnEs}.`));
      return;
    }
    const delDia = new Set(dayOrders.map((d) => d.id));
    const capacidad = capacityFor(driverOf(laneKey));
    // La base: la de la ruta; con la ruta vacía, la recogida de la primera orden. Las coordenadas de la tienda de
    // Ajustes si las tiene (gratis); si no, las que ya buscó la pantalla para pintar la «P».
    const direccion = (((byDriver.get(laneKey) ?? []).length ? pickupAddressFor(laneKey) : (marcadas[0].pickup_address || pickupAddressFor(laneKey))) ?? "").trim();
    const tienda = settings.stores.find((s) => (s.address || "").trim() === direccion && s.lat != null && s.lng != null);
    const coords = tienda ? [tienda.lat!, tienda.lng!] as [number, number] : await getDepotCoords(direccion || null);
    const base = coords ? { lat: coords[0], lng: coords[1] } : null;
    const aParada = (x: Delivery): ParadaDeRuta => ({
      id: x.id, lat: x.delivery_lat, lng: x.delivery_lng, pallets: palletsDeLaOrden(x),
      ventana: parseWindow(x.delivery_windows), servicioMin: serviceMin(x.delivery_duration),
    });
    let paradas: Delivery[] = [...(byDriver.get(laneKey) ?? [])];
    const colocadas: { en: string; es: string }[] = [];
    const aMano: string[] = [];
    setAsignando(true);
    try {
      for (const d of marcadas) {
        // De otro día (chip «Todas»), o sin pin: se asigna como «Asignar», al final, y se dice.
        const r = delDia.has(d.id)
          ? mejorLugar({ viajes: buildTrips(paradas, capacidad).map((v) => v.map(aParada)), nueva: aParada(d), base, capacidad, inicioMin: DAY_START_MIN })
          : null;
        if (!r || !r.ok) {
          await assignTo(d.id, laneKey);
          aMano.push(orderLabel(d));
          if (delDia.has(d.id)) paradas = [...paradas, { ...d, assigned_driver: laneKey, route_seq: null, load_no: null }];
          continue;
        }
        const viajes = buildTrips(paradas, capacidad);
        const w = escrituraDelHueco(viajes, d.id, r.hueco, hasManualLoads(paradas));
        clearRouteFor(laneKey);
        await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: w.ids.indexOf(d.id), load_no: w.loadNoDeLaNueva });
        await reorderStops(w.ids, w.loadNoById);
        const delViaje = viajes[r.hueco.viaje] ?? [];
        const aviso = avisoDelHueco({
          orden: orderLabel(d), ruta: laneLabel(laneKey), hueco: r.hueco,
          totalDelViaje: delViaje.length + 1,
          anterior: r.hueco.puesto > 0 ? orderLabel(delViaje[r.hueco.puesto - 1]) : null,
          siguienteParada: delViaje[r.hueco.puesto] ? orderLabel(delViaje[r.hueco.puesto]) : null,
          huecosMirados: r.huecosMirados, alternativa: r.siguiente, masCorto: r.masCorto,
        });
        colocadas.push(aviso);
        addNote(d.id, `Best fit: ${aviso.en}`);
        const porId = new Map([...paradas, d].map((x) => [x.id, x]));
        paradas = w.ids.map((id, i) => ({
          ...porId.get(id)!, assigned_driver: laneKey, route_seq: i,
          load_no: w.loadNoById ? w.loadNoById[id] : (id === d.id ? w.loadNoDeLaNueva : porId.get(id)!.load_no),
        }));
      }
    } finally {
      setAsignando(false);
    }
    clearSelection();
    const extraEn = (aMano.length ? ` Assigned at the end (no pin or another day): #${aMano.join(", #")}.` : "") + (sinCamion.length ? ` Not placed — the truck lacks what they need: ${noEnEn}.` : "");
    const extraEs = (aMano.length ? ` Asignadas al final (sin pin o de otro día): #${aMano.join(", #")}.` : "") + (sinCamion.length ? ` Sin colocar — el camión no tiene lo que piden: ${noEnEs}.` : "");
    notify(t(colocadas.map((a) => a.en).join(" · ") + extraEn, colocadas.map((a) => a.es).join(" · ") + extraEs));
    setAvisoMejorLugar([...colocadas.map((a) => t(a.en, a.es)), ...(aMano.length || sinCamion.length ? [t(extraEn.trim(), extraEs.trim())] : [])]);
  };

  // Manual nudge — hand-arrange a load's stops with the ↑/↓ arrows, whether or
  // not the route has a saved order yet. `index` is the position in the DISPLAYED
  // order (the flattened truckloads), so we rebuild that exact order here rather
  // than byDriver's sequence — otherwise, with manual truckloads, the two orders
  // differ and the arrow would move the wrong row.
  const move = async (laneKey: string, index: number, dir: -1 | 1) => {
    const stops = byDriver.get(laneKey) ?? [];
    const trips = buildTrips(stops, capacityFor(driverOf(laneKey)));
    const item = trips.flat()[index];
    // Qué se escribe lo decide `planDeFlecha` (D-433): la secuencia entera en el orden nuevo y, con viajes puestos a mano,
    // el viaje de cada parada por posición —cada viaje conserva su tamaño, y la que pasa del borde entra de verdad en el de
    // al lado; si no, la pantalla la reagruparía por `load_no` y la flecha parecería rota—. Numerada DESPUÉS de lo que el
    // chofer ya recogió o entregó ese día (`inicioDeLaRuta`), que no sale aquí pero sí en «Mi ruta».
    const plan = item ? planDeFlecha(trips, index, dir, hasManualLoads(stops), inicioDeLaRuta(laneKey, stops)) : null;
    if (!plan) return;
    // The traced path/distance were computed for the old order — a manual
    // nudge no longer matches them, so drop them rather than mislead.
    clearRouteFor(laneKey);
    const { ids, loadNoById, desde } = plan;
    // One guarded operation for the whole new sequence: the list updates
    // locally right away and is held there until every write lands, so a
    // realtime refetch can't snap the stop back to where it was.
    const ok = await reorderStops(ids, loadNoById, undefined, desde);
    // Las flechas también entran en deshacer/rehacer (D-417): Ctrl+Z tras una flecha la deshace, y un arrastre anterior
    // no se deshace pisando la flecha (su comprobación lo vería cambiado).
    if (ok) {
      // Se VE a dónde fue (D-433): la etiqueta P/D es de la posición —la primera entrega es D1 la haga quien la haga—, así
      // que tras la flecha la fila de arriba sigue diciendo «D1». La movida se resalta y se dice su puesto.
      senalaLaMovida(item.id);
      const viaje = plan.viaje ? t(`, truckload ${plan.viaje}`, `, viaje ${plan.viaje}`) : "";
      notify(t(`#${orderLabel(item)} → stop ${plan.puesto + 1} of ${plan.total}${viaje}`, `#${orderLabel(item)} → parada ${plan.puesto + 1} de ${plan.total}${viaje}`));
      const antes = fotoDe(trips.flat().map(aParadaDelGantt));
      await anotaMovimiento({ en: `#${orderLabel(item)} ${dir < 0 ? "up" : "down"}`, es: `#${orderLabel(item)} ${dir < 0 ? "arriba" : "abajo"}` }, [laneKey], antes, fotoTrasReordenar(antes, ids, loadNoById, desde));
    }
  };

  // ---- Deshacer / rehacer (D-417) -------------------------------------------------------------------------------
  // Los movimientos a mano de ESTA sesión y de ESTE día: arrastrar en «📅 Horario» y las flechas ↑ ↓ de parada. Deshacer
  // es otra escritura en la base (los mismos campos que las flechas: `assigned_driver`, `route_seq`, `load_no`), y antes
  // de escribir se lee lo que hay AHORA: si otra persona tocó algo de lo que se va a escribir, no se escribe nada.
  const [historial, setHistorial] = useState<Historial>(HISTORIAL_VACIO);
  const [moviendo, setMoviendo] = useState(false);
  useEffect(() => { setHistorial(HISTORIAL_VACIO); }, [date]);
  const deliveriesRef = useRef(deliveries);
  deliveriesRef.current = deliveries;
  /** Lo que hay ahora de estas paradas. Con base, leído de la base en este momento (no lo de la pantalla, que puede ir
   * por detrás del tiempo real); sin base (demo) o en modo práctica, lo que la pantalla tiene, que es la verdad ahí. */
  const leeFilasFrescas = async (ids: string[]): Promise<FilaFresca[] | null> => {
    if (SIN_BASE || teaching) {
      await new Promise((r) => setTimeout(r, 60)); // que el demo pinte lo que acaba de escribir
      const quiero = new Set(ids);
      return deliveriesRef.current.filter((d) => quiero.has(d.id)).map((d) => ({
        id: d.id, assigned_driver: d.assigned_driver ?? null, route_seq: d.route_seq ?? null, load_no: d.load_no ?? null, updated_at: d.updated_at ?? null,
      }));
    }
    const { data, error } = await createClient().from("deliveries").select("id, assigned_driver, route_seq, load_no, updated_at").in("id", ids);
    if (error || !data) return null;
    return data as FilaFresca[];
  };
  const anotaMovimiento = async (etiqueta: { en: string; es: string }, rutas: string[], antes: ReturnType<typeof fotoDe>, despues: ReturnType<typeof fotoDe>) => {
    const sellos = sellosDe(await leeFilasFrescas(Object.keys(despues)));
    setHistorial((h) => anota(h, { etiqueta, rutas, antes, despues, sellos }));
  };
  const vuelve = async (dir: Direccion) => {
    const pila = dir === "deshacer" ? historial.deshacer : historial.rehacer;
    const m = pila[pila.length - 1];
    if (!m || moviendo) return;
    setMoviendo(true);
    try {
      const objetivo = objetivoDe(m, dir);
      const ids = Object.keys(objetivo);
      const filas = await leeFilasFrescas(ids);
      if (!filas) { notify(t("Couldn't read the route to check it — nothing was written.", "No se pudo leer la ruta para comprobarla — no se escribió nada.")); return; }
      const miembros = Object.fromEntries(m.rutas.map((r) => [r, (byDriver.get(r) ?? []).map((d) => d.id)]));
      const choques = choquesAlVolver(m, dir, filas, miembros);
      const nombre = (id: string) => { const d = deliveriesRef.current.find((x) => x.id === id); return d ? orderLabel(d) : id.slice(0, 6); };
      if (choques.length) {
        setHistorial((h) => descartaElDeArriba(h, dir));
        const a = textoDeChoques(choques, nombre, dir);
        notify(t(a.en, a.es));
        return;
      }
      m.rutas.forEach((r) => clearRouteFor(r));
      for (const e of escriturasHacia(objetivo, fotoDeFilas(filas))) {
        if (!(await updateDelivery(e.id, e.parche))) return; // el proveedor ya avisó; el movimiento se queda donde estaba
      }
      const sellos = sellosDe(await leeFilasFrescas(ids));
      setHistorial((h) => trasVolver(h, dir, sellos));
      notify(dir === "deshacer" ? t(`Undone: ${m.etiqueta.en}`, `Deshecho: ${m.etiqueta.es}`) : t(`Redone: ${m.etiqueta.en}`, `Rehecho: ${m.etiqueta.es}`));
    } finally {
      setMoviendo(false);
    }
  };
  // Ctrl+Z / Ctrl+Y (y Ctrl+Mayús+Z, y ⌘ en Mac), salvo escribiendo en un campo o con una orden abierta.
  const vuelveRef = useRef(vuelve);
  vuelveRef.current = vuelve;
  const hayOrdenAbierta = useRef(false);
  hayOrdenAbierta.current = !!openOrder;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || hayOrdenAbierta.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); void vuelveRef.current("deshacer"); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); void vuelveRef.current("rehacer"); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // Soltar una parada en «📅 Horario» (D-417). Qué se escribe lo decide `planDeSoltar` (lo mismo que las flechas y que
  // «📍 Mejor lugar»); la vista previa mientras se arrastra es ese mismo plan, sin escribir.
  const previaDeSoltar = (movida: string, destino: Destino) => planDeSoltar(rutasDelGantt, movida, destino, DAY_START_MIN);
  const sueltaEnLaLinea = async (movida: string, destino: Destino) => {
    if (moviendo) return;
    const plan = previaDeSoltar(movida, destino);
    if (!plan.ok) {
      if (plan.motivo !== "sin_cambio") { const p = porQueNoSuelta(plan.motivo); notify(t(p.en, p.es)); }
      return;
    }
    const d = dayOrders.find((x) => x.id === movida);
    if (!d) return;
    setMoviendo(true);
    try {
      clearRouteFor(plan.destino);
      if (plan.origen !== plan.destino) {
        clearRouteFor(plan.origen);
        if (!(await updateDelivery(movida, plan.parcheDeLaMovida))) return;
      }
      if (!(await reorderStops(plan.ids, plan.loadNoById))) return;
      const nombre = (id: string) => { const x = dayOrders.find((o) => o.id === id); return x ? orderLabel(x) : id.slice(0, 6); };
      const previa = textoDePrevia(plan.previa, nombre);
      const cambio = plan.origen !== plan.destino ? ` (from ${laneLabel(plan.origen)})` : "";
      const cambioEs = plan.origen !== plan.destino ? ` (desde ${laneLabel(plan.origen)})` : "";
      const en = `#${orderLabel(d)} → ${laneLabel(plan.destino)}${cambio}, truckload ${plan.viaje + 1}, stop ${plan.puesto + 1} of ${plan.totalDelViaje}${plan.porNombre ? " (Best fit)" : ""}: ${previa.en} (straight-line estimate)`;
      const es = `#${orderLabel(d)} → ${laneLabel(plan.destino)}${cambioEs}, viaje ${plan.viaje + 1}, parada ${plan.puesto + 1} de ${plan.totalDelViaje}${plan.porNombre ? " (Mejor lugar)" : ""}: ${previa.es} (estimación en línea recta)`;
      addNote(movida, `Timeline: ${en}`);
      notify(t(en, es));
      await anotaMovimiento({ en: `#${orderLabel(d)} → ${laneLabel(plan.destino)}`, es: `#${orderLabel(d)} → ${laneLabel(plan.destino)}` },
        plan.origen === plan.destino ? [plan.destino] : [plan.origen, plan.destino], plan.antes, plan.despues);
    } finally {
      setMoviendo(false);
    }
  };

  // Move a WHOLE truckload up/down within a driver's day, so the dispatcher
  // can say which load goes out first. The new order is stamped as explicit
  // load numbers (not just a sequence), otherwise a lane that was auto-split by
  // capacity would just re-derive the original grouping on the next render.
  const moveTrip = async (laneKey: string, index: number, dir: -1 | 1) => {
    const stops = byDriver.get(laneKey) ?? [];
    const trips = buildTrips(stops, capacityFor(driverOf(laneKey)));
    const j = index + dir;
    if (j < 0 || j >= trips.length) return;
    const next = [...trips];
    const [moved] = next.splice(index, 1);
    next.splice(j, 0, moved);
    clearRouteFor(laneKey);
    const loadNoById: Record<string, number | null> = {};
    next.forEach((batch, ti) => batch.forEach((d) => { loadNoById[d.id] = ti + 1 > 1 ? ti + 1 : null; }));
    await reorderStops(next.flat().map((d) => d.id), loadNoById, undefined, inicioDeLaRuta(laneKey, stops));
    notify(t(`Truckload moved to position ${j + 1}`, `Viaje movido a la posición ${j + 1}`));
  };

  const focused = selected.size > 0;
  const isDim = (driver: string | null) => focused && !!driver && !selected.has(driver);

  // Resolve every driver's pickup point up front, so the map can show each
  // as its loop's start/end pin even before a route's been measured.
  useEffect(() => {
    for (const u of lanes) {
      if ((byDriver.get(u.key) ?? []).length) getDepotCoords(pickupAddressFor(u.key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDriver, settings.stores]);

  // Elegir un chofer MIDE su ruta (D-NEXT): millas, horas y trazo, en el orden guardado, sin tocarla. Hasta D-NEXT la
  // OPTIMIZABA y escribía el orden nuevo; y como cada cambio borra la medida (`clearRouteFor`), una flecha con el chofer
  // elegido volvía a optimizar y deshacía la flecha. Ahora un cambio solo vuelve a MEDIR. Una a la vez; cada forma de la
  // ruta una sola vez (`firmaDeLaMedida`): si falla, no se reintenta en bucle. Con candado 🔒 también: medir no la toca.
  const medidasPedidas = useRef(new Set<string>());
  useEffect(() => {
    if (midiendo != null) return;
    for (const name of selected) {
      const stops = byDriver.get(name) ?? [];
      if (!stops.length || routeInfo[name]) continue;
      const firma = firmaDeLaMedida(date, name, stops);
      if (medidasPedidas.current.has(firma)) continue;
      medidasPedidas.current.add(firma);
      void mide(name, stops);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, routeInfo, midiendo, byDriver, date]);

  // The whole day is always on the map — a driver focus dims the rest rather
  // than hiding it, so the full picture stays visible.
  const points: MapPoint[] = useMemo(() => {
    // Color each assigned stop by its TRUCKLOAD (matching the route line),
    // so the map groups stops into the same colors as their loop.
    const stopColor = new Map<string, string>();
    for (const u of lanes) {
      const stops = byDriver.get(u.key) ?? [];
      buildTrips(stops, capacityFor(u.driver)).forEach((batch, ti) => {
        const c = tripColor(colorFor(u.driver), ti);
        for (const d of batch) stopColor.set(d.id, c);
      });
    }

    const pts: MapPoint[] = [];
    // Pickup / base pins first, so a stop that sits right on the pickup still
    // draws on top of the "P" instead of being hidden behind it.
    for (const u of lanes) {
      if (!(byDriver.get(u.key) ?? []).length) continue;
      // Con un chofer elegido en el filtro (D-393), el mapa enseña solo lo suyo: su base, sus P, sus paradas y sus líneas.
      if (!pasaFiltro(u.key)) continue;
      const addr = (pickupAddressFor(u.key) ?? "").trim();
      const coords = addr ? depotCoords[addr] : undefined;
      if (!coords) continue;
      pts.push({
        id: `__depot__${u.id}`,
        lat: coords[0],
        lng: coords[1],
        color: colorFor(u.driver),
        badge: "P",
        label: `${t("Pickup / base", "Recolección / base")} (${u.label}) — ${addr}`,
        dimmed: isDim(u.key) || selectedOrders.size > 0,
      });
    }
    const selActive = selectedOrders.size > 0;
    // Las etiquetas P/D de cada ruta (D-334): las entregas pasan de «1, 2, 3» a «D1, D2…», y cada tienda donde la ruta
    // recoge lleva su «P1·P2», del color del chofer — que es lo que distingue una ruta de otra cuando hay varias a la vista.
    const dDeTodas = new Map<string, string>();
    for (const [laneKey, list] of byDriver) {
      if (!list.some((d) => d.route_seq != null)) continue;
      if (!pasaFiltro(laneKey)) continue;
      const lectura = lecturaConLoHecho(buildTrips(list, capacityFor(driverOf(laneKey))), paradasPublicadasDe(list[0].assigned_driver), hechasDeLaRuta(laneKey, list));
      for (const [id, etiqueta] of lectura.etiquetaDe) dDeTodas.set(id, etiqueta);
      for (const p of [...lectura.previas.values()].flat()) {
        if (p.tipo !== "P" || !p.lugar) continue;
        const tienda = (settings.stores ?? []).find((s) => s.name.trim().toLowerCase() === p.lugar!.trim().toLowerCase());
        if (tienda?.lat == null || tienda.lng == null) continue;
        pts.push({
          id: `__pd__${laneKey}__${p.etiquetas[0]}`, lat: tienda.lat, lng: tienda.lng, color: colorFor(list[0].assigned_driver),
          badge: p.etiquetas.join("·"), label: `${list[0].assigned_driver} — ${t("Pick up", "Recoger")} ${p.etiquetas.join("·")} · ${p.lugar}`,
          dimmed: isDim(laneKey) || selActive,
        });
      }
    }
    for (const d of dayOrders) {
      if (d.delivery_lat == null || d.delivery_lng == null) continue;
      if (!d.assigned_driver) {
        const sel = selectedOrders.has(d.id);
        // Lo sin chofer tampoco es de ese chofer: con el filtro puesto no sale, salvo que se haya marcado a propósito.
        if (!sel && filtroChofer !== TODOS_LOS_CHOFERES) continue;
        pts.push({
          id: d.id,
          lat: d.delivery_lat,
          lng: d.delivery_lng,
          color: sel ? (selColorById.get(d.id) ?? "#2456c9") : UNASSIGNED_COLOR,
          badge: sel ? "D" : undefined,
          label: `#${orderLabel(d)} — ${sel ? t("Delivery", "Entrega") : t("Unassigned", "Sin asignar")}`,
          dimmed: sel ? false : (focused || selActive),
        });
        continue;
      }
      const sel = selectedOrders.has(d.id);
      const laneKey = orderLaneKey(d)!;
      if (!sel && !pasaFiltro(laneKey)) continue;
      const list = byDriver.get(laneKey) ?? [];
      const idx = list.findIndex((x) => x.id === d.id);
      const badge = d.route_seq != null ? (dDeTodas.get(d.id) ?? String(idx + 1)) : undefined;
      const loadTag = !isBucket(d.assigned_driver) && loadNoOf(d) > 1 ? ` · ${t("Load", "Carga")} ${loadNoOf(d)}` : "";
      pts.push({
        id: d.id,
        lat: d.delivery_lat,
        lng: d.delivery_lng,
        // A selected assigned stop pops in its own selection color, un-dimmed,
        // marked "D" so it pairs with its "P" pickup pin.
        color: sel ? (selColorById.get(d.id) ?? "#2456c9") : (stopColor.get(d.id) ?? colorFor(d.assigned_driver)),
        badge: sel ? "D" : badge,
        label: `#${orderLabel(d)} — ${d.assigned_driver}${loadTag}${badge ? ` (${t("Stop", "Parada")} ${badge})` : ""}`,
        dimmed: sel ? false : (isDim(laneKey) || selActive),
      });
    }
    // Pickup ("P") pin for each selected load (assigned or pool), in its own
    // color, so the PU→DEL pairing is visible even before the road route loads.
    for (const d of dayOrders) {
      if (!selectedOrders.has(d.id)) continue;
      const pk = selPickup[d.id];
      if (!pk) continue;
      pts.push({
        id: `__selpk__${d.id}`,
        lat: pk[0],
        lng: pk[1],
        color: selColorById.get(d.id) ?? "#2456c9",
        badge: "P",
        label: `#${orderLabel(d)} — ${t("Pickup", "Recolección")}`,
        dimmed: false,
      });
    }
    // Lo último: las marcas que caen en el MISMO punto se abren en abanico (D-367). Solo aquí, en el Gestor, que es donde
    // se ven todas las rutas a la vez y donde se midió que 18 pares se tapaban. Las otras seis pantallas que montan un mapa
    // no pasan `offset`, así que pintan igual que antes. La casita de la tienda no entra: no es de nadie y es el punto fijo.
    const abanico = abanicoDeMarcas(pts);
    return abanico.size ? pts.map((p) => { const o = abanico.get(p.id); return o ? { ...p, offset: o } : p; }) : pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOrders, byDriver, settings.driver_colors, settings.driver_capacity, selected, selectedOrders, selColorById, selPickup, filtroChofer, depotCoords, lanes, rutasPublicadas, deliveries]);

  // Every measured driver's routes are always drawn; a focus just dims the
  // others. Clicking a route focuses its driver (see onLineClick below).
  const lines: MapLine[] = useMemo(() => {
    // Con el filtro de chofer (D-393), solo las líneas de ese chofer. Y solo de quien tiene paradas (D-NEXT): una ruta que
    // se quedó vacía no deja su línea en el mapa.
    const entries = Object.entries(routeLines).filter(([driver]) => pasaFiltro(driver) && (byDriver.get(driver)?.length ?? 0) > 0);
    // Fan the routes out with a small perpendicular offset each, so where two
    // run along the same road they sit side by side rather than on top of
    // each other. Centered so the spread stays close to the actual road.
    const total = entries.reduce((n, [, trips]) => n + trips.length, 0);
    const spacing = 5;
    const center = (total - 1) / 2;
    const out: MapLine[] = [];
    let idx = 0;
    // Con plan publicado y su trazo ya pedido, la línea es la del plan (D-352) y no la medida de la tarjeta — mientras la
    // ruta SIGA siendo la publicada y le queden paradas (`sigueSuPlan`, D-NEXT). Si no, la del plan no se pinta.
    const conSuPlan = new Set(Object.entries(trazosDelPlan).filter(([driver, geom]) => geom.length > 1 && pasaFiltro(driver) && sigueSuPlan(driver)).map(([d]) => d));
    for (const driver of conSuPlan) {
      out.push({ id: `plan:${driver}`, color: colorFor(driverOf(driver)), positions: trazosDelPlan[driver], dimmed: isDim(driver), offset: 0 });
    }
    for (const [driver, trips] of entries) {
      if (conSuPlan.has(driver)) continue;
      trips.forEach((trace, i) => {
        const color = tripColor(colorFor(driverOf(driver)), i);
        const dimmed = isDim(driver);
        const offset = (idx - center) * spacing;
        // Delivery run: solid. Empty drive back to the pickup: dashed, and
        // pushed to its own parallel offset so that when it retraces the
        // outbound road the dashes sit BESIDE the solid line (and stay
        // visible) instead of landing on top of the same-color run.
        out.push({ id: `line:${driver}#${i}`, color, positions: trace.delivery, dimmed, offset });
        if (trace.ret.length > 1) out.push({ id: `ret:${driver}#${i}`, color, positions: trace.ret, dimmed, dashed: true, offset: offset + 7 });
        idx++;
      });
    }
    // Selected loads (assigned or pool): each in its own color — the "go" leg
    // solid (pickup→dropoff) and the "return" leg dashed (dropoff→pickup),
    // offset so it sits beside the outbound line. When the road geometry isn't
    // ready (or fails to load), fall back to a straight pickup→dropoff line so
    // the PU→DEL pairing is ALWAYS shown, never just the dot.
    for (const d of dayOrders) {
      if (!selectedOrders.has(d.id)) continue;
      const color = selColorById.get(d.id) ?? "#2456c9";
      const pos = selRouteCache[d.id];
      if (pos && pos.length) {
        out.push({ id: `sel:${d.id}`, color, positions: pos });
        out.push({ id: `selret:${d.id}`, color, positions: [...pos].reverse(), dashed: true, offset: 6 });
      } else {
        const pk = selPickup[d.id];
        if (pk && d.delivery_lat != null && d.delivery_lng != null) {
          out.push({ id: `selstraight:${d.id}`, color, positions: [pk, [d.delivery_lat, d.delivery_lng]], dashed: true });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLines, trazosDelPlan, byDriver, rutasPublicadas, deliveries, selected, settings.driver_colors, selectedOrders, selRouteCache, selPickup, selColorById, dayOrders, filtroChofer]);

  const onLineClick = (id: string) => {
    const m = id.match(/^(?:line|ret):(.+)#\d+$/);
    if (m) focusOnly(m[1]);
  };

  // What the map frames: the selected drivers' stops + pickups when any are
  // focused, otherwise the whole day.
  const fitTo: [number, number][] = useMemo(() => {
    // "Where is this driver right now" beats everything else: the dispatcher
    // asked a direct question and wants the answer centred, not averaged in
    // with a day's worth of stops. A small box around the point, so the map
    // zooms IN on the truck instead of framing a single coordinate.
    if (locateDriver) {
      const loc = driverLocations.find((l) => {
        const u = users.find((x) => x.id === l.driver_id);
        return u?.full_name === locateDriver;
      });
      if (loc) {
        const pad = 0.004; // ≈ 400 m, so the truck sits in a readable frame
        return [
          [loc.lat - pad, loc.lng - pad],
          [loc.lat + pad, loc.lng + pad],
        ];
      }
    }
    // Selected unassigned loads take priority — frame them + their routes.
    if (selectedOrders.size > 0) {
      const pts: [number, number][] = [];
      for (const d of dayOrders) {
        if (!selectedOrders.has(d.id)) continue;
        if (d.delivery_lat != null && d.delivery_lng != null) pts.push([d.delivery_lat, d.delivery_lng]);
        const pk = selPickup[d.id];
        if (pk) pts.push(pk); // keep the pickup end in frame too
        const pos = selRouteCache[d.id];
        if (pos) pts.push(...pos);
      }
      if (pts.length) return pts;
    }
    if (!focused) return points.map((p) => [p.lat, p.lng] as [number, number]);
    const ids = new Set<string>();
    for (const key of selected) {
      for (const d of byDriver.get(key) ?? []) ids.add(d.id);
      const lane = lanes.find((l) => l.key === key);
      if (lane) ids.add(`__depot__${lane.id}`);
    }
    return points.filter((p) => ids.has(p.id)).map((p) => [p.lat, p.lng] as [number, number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selected, selectedOrders, selRouteCache, selPickup, dayOrders, locateDriver, driverLocations, users]);

  if (!me) return null;
  if (!canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

  const withStops = lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0);
  // Route cards always show every route that has stops, PLUS any lane you've
  // checked (even an empty one you're filling). Checking loads to merge, or
  // focusing a driver on the map, never makes the other routes disappear.
  // Con el filtro de chofer (D-393), solo la suya.
  // Desde D-NEXT, solo las que tienen paradas: una marcada ☑ sin paradas sacaba una tarjeta entera «0 paradas» (Julio). Esa
  // tarjeta no era destino de nada —se asigna desde «Sin asignar», el recuadro o el tablero, y se arrastra en «Horario»,
  // que sí pinta las rutas vacías—; renombrar o quitar una ruta temporal vacía sigue en el panel. Las marcadas vacías se
  // nombran en una línea (`marcadasSinParadas`).
  const shownDrivers = lanesDelFiltro.filter((u) => (byDriver.get(u.key) ?? []).length > 0);
  const marcadasSinParadas = lanesDelFiltro.filter((u) => selected.has(u.key) && (byDriver.get(u.key) ?? []).length === 0);
  const scheduledCount = dayOrders.length - unassigned.length;
  // El motor nuevo (D-320) es para quien puede publicar, y con un día concreto. Con su barra cerrada (D-400), la cabecera
  // lleva el botón que la trae.
  const puedeArmarRutas = !allDates && !soloPendientes && !!me && ["admin", "logistics"].includes(me.role);
  const barraDeArmarRutas = puedeArmarRutas && (!oculto(AVISOS_DEL_GESTOR.armarRutas) || planTraidoAMano);

  return (
    <>
      <div className="page-head">
        <h2>{t("Routes Manager", "Gestor de Rutas")} <span className="count-tag">{dayOrders.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Con qué chofer se trabaja (D-393). «Todos» es el defecto; se recuerda por persona. */}
          <select
            aria-label={t("Driver to work with", "Chofer con el que trabajar")}
            title={t("Show only this driver's card, routes and map — remembered for you", "Ver solo la tarjeta, las rutas y el mapa de este chofer — se recuerda para usted")}
            value={filtroChofer}
            onChange={(e) => eligeFiltroDeChofer(e.target.value)}
            data-filtro-de-chofer
            style={{ width: "auto", fontWeight: filtroChofer !== TODOS_LOS_CHOFERES ? 700 : undefined }}
          >
            <option value={TODOS_LOS_CHOFERES}>🚚 {t("All drivers", "Todos los choferes")}</option>
            {lanes.map((l) => <option key={l.key} value={l.key}>{l.isBucket ? "🧭 " : ""}{l.label}</option>)}
          </select>
          <div className="viewtoggle">
            <button className="vt" disabled={allDates} onClick={() => setDate((d) => shiftDateISO(d, -1))} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={date} disabled={allDates} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
            <button className="vt" disabled={allDates} onClick={() => setDate((d) => shiftDateISO(d, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {/* D-428: atajos de fecha, siempre a la vista; el día que se mira sale marcado. */}
          {!allDates && ([[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")], [1, t("Tomorrow", "Mañana")]] as const).map(([dias, etiqueta]) => {
            const dia = shiftDateISO(todayISO(), dias);
            return (
              <button key={dias} data-atajo-fecha={dias} className={"btn btn-sm " + (date === dia ? "btn-primary" : "btn-ghost")}
                aria-pressed={date === dia} onClick={() => setDate(dia)}>{etiqueta}</button>
            );
          })}
          <button
            className={"btn btn-sm " + (allDates ? "btn-primary" : "btn-ghost")}
            onClick={() => { setSoloPendientes(false); setAllDates((v) => !v); }}
            title={t("Show routable orders from every date, not just the selected day", "Mostrar órdenes de todas las fechas, no solo el día elegido")}
          >
            🗓 {allDates ? t("All dates ✓", "Todas ✓") : t("All dates", "Todas")}
          </button>
          {/* Aquí iban «✨ Auto-asignar» y «🧭 Optimizar todas las rutas»: se quitaron en D-NEXT («Quitar los dos; solo Armar
              rutas»). Lo automático es «Armar las rutas del día», la barra de justo debajo; con la barra cerrada (D-400),
              este botón la trae, y es el primario de la cabecera. */}
          {puedeArmarRutas && avisosOcultos != null && !barraDeArmarRutas && (
            <button className="btn btn-primary btn-sm" data-traer-armar-rutas onClick={() => setPlanTraidoAMano(true)}
              title={t("Build today's routes automatically — you closed its bar; this brings it back for this visit", "Armar las rutas del día automáticamente — cerró su barra; esto la trae para esta visita")}>
              🧭 {t("Build routes", "Armar rutas")}
            </button>
          )}
          {geocoding > 0 && <span className="hint">{t("Locating addresses…", "Ubicando direcciones…")}</span>}
          {/* Says plainly whether the distances/ETAs just computed account for
              traffic, so nobody trusts free-flow numbers thinking otherwise. */}
          {routerInfo && (
            routerInfo.traffic ? (
              <span className="sema" style={{ background: "var(--green)", color: "#fff" }}
                title={t("Distances and ETAs come from Google Maps with traffic for the run's departure time", "Distancias y tiempos vienen de Google Maps con tráfico para la hora de salida")}>
                🚦 {t("Google · with traffic", "Google · con tráfico")}
              </span>
            ) : (
              <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}
                title={t("Google Routes is unavailable, so these are free-flow estimates from the free router", "Google Routes no está disponible, así que son estimados sin tráfico del router gratuito")}>
                ⚠ {t("No traffic data", "Sin datos de tráfico")}
              </span>
            )
          )}
        </div>
      </div>

      {/* El motor nuevo (D-320): planifica en BORRADOR y publica. Convive con todo lo de abajo, que sigue
          igual: «sustituye al actual» se cumple al final, no el primer día. Solo para quien puede publicar
          (admin y logística), y con una fecha concreta: «todas las fechas» no es un día que planificar.
          Sus columnas (D-429) son las de Órdenes: la misma lista, el mismo orden guardado, las mismas plantillas y las mismas
          flechas que «Sin asignar» y paradas — la tercera tabla de la fila `routes_columns`. */}
      {barraDeArmarRutas && (
        <PlanDelDia date={date} onPublicado={() => setPublicaciones((n) => n + 1)} naceAbierto={planTraidoAMano}
          onCerrar={() => { setPlanTraidoAMano(false); cierraAvisoDelGestor(AVISOS_DEL_GESTOR.armarRutas); }}
          onAbrirOrden={(id) => { const d = deliveries.find((x) => x.id === id.split("#")[0]); if (d) setOpenOrder(d); }}
          columnas={{
            lista: columnasDeLaTabla("plan", colsGestor, ordenGestor), celda: celdaDelPlan, clase: clasePastillas,
            selector: (
              <SelectorDeColumnas
                columnas={columnasDelSelector("plan", ordenGestor)}
                elegidas={colsGestor} onAlterna={alternaColumnaDelGestor} t={t}
                rotulo={(c) => (lang === "es" ? c.es : c.en).replace(/^[^:]+: /, "")}
                titulo={t("Plan columns", "Columnas del plan")} nota={t("Saved for you. Applies to every route.", "Se guarda para usted. Vale para todas las rutas.")}
                plantillas={propsDePlantillas}
                mover={moverEn("plan")}
              />
            ),
          }} />
      )}

      {/* ---------- Drivers who stopped reporting ----------
           No amount of Android hardening is bulletproof: a battery manager, a
           flat battery or no signal will still cut the feed. Surfacing it here
           means a truck goes "not reporting" instead of quietly vanishing. */}
      {trackingIssues.length > 0 && !oculto(AVISOS_DEL_GESTOR.choferesSinSenal) && (
        <div className="card" style={{ marginBottom: 14, background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <b style={{ color: "var(--amber-text)" }}>
            📡 {t(`${trackingIssues.length} driver(s) on shift aren't reporting their location`,
                  `${trackingIssues.length} chofer(es) en turno no están reportando su ubicación`)}
          </b>
          <CerrarAviso aviso={AVISOS_DEL_GESTOR.choferesSinSenal} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.choferesSinSenal)} />
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {trackingIssues.map((g) => `${g.driver} (${g.quietForMin == null ? t("no fix yet", "sin señal aún") : t(`${g.quietForMin} min`, `${g.quietForMin} min`)})`).join(" · ")}
            {" — "}
            {t("their phone may have paused the app to save battery, or lost signal.",
               "su teléfono pudo pausar la app para ahorrar batería, o perdió señal.")}
          </div>
        </div>
      )}

      {/* ---------- Why-is-it-empty helper ---------- */}
      {dayOrders.length === 0 && !oculto(AVISOS_DEL_GESTOR.diaVacio) && (() => {
        const otherDates = deliveries.filter((d) => ROUTE_STAGES.includes(d.stage) && d.delivery_date !== date).length;
        return (
          <div className="card" style={{ marginBottom: 14, background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <b style={{ color: "var(--amber-text)" }}>⚠ {allDates ? t("No schedulable orders at all.", "No hay órdenes para programar.") : t("No schedulable orders for this date.", "No hay órdenes para programar en esta fecha.")}</b>
            <CerrarAviso aviso={AVISOS_DEL_GESTOR.diaVacio} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.diaVacio)} />
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {allDates
                ? t("Any order that isn't delivered or canceled can be scheduled here — even before it's approved or prepared.", "Cualquier orden que no esté entregada o cancelada se puede programar aquí — incluso antes de aprobarse o prepararse.")
                : t(`Any order with delivery date ${fmtDate(date)} shows here (except delivered/canceled ones) — you can plan it even before it's approved.`,
                    `Cualquier orden con fecha de entrega ${fmtDate(date)} aparece aquí (menos entregadas/canceladas) — puedes planearla incluso antes de aprobarse.`)}
              {!allDates && otherDates > 0 && " " + t(`${otherDates} schedulable order(s) sit on other dates — tap "All dates" or use the ◀ ▶ arrows.`,
                                                      `${otherDates} orden(es) programables están en otras fechas — toque "Todas" o use las flechas ◀ ▶.`)}
            </div>
          </div>
        );
      })()}

      {/* ---------- Stats strip (each tile jumps to the matching view) ---------- */}
      <div className="card" style={{ display: "flex", padding: 0, overflow: "hidden", marginBottom: 14 }}>
        {([
          // Sin pestaña «Programadas» (D-376), la cuenta se queda —cuántas tienen chofer— y lleva a las rutas, que es
          // donde está cada una: en la tarjeta de su chofer.
          { n: scheduledCount, label: t("Scheduled", "Programadas"), target: "routes" as const },
          { n: unassigned.length, label: t("Unscheduled", "Sin programar"), accent: true, target: "orders" as const },
          { n: dayOrders.length, label: t("Total", "Total"), target: "board" as const },
          { n: withStops.length, label: t("Routes", "Rutas"), target: "routes" as const },
        ]).map((s, i) => (
          <button
            key={i}
            onClick={() => setTab(s.target)}
            title={t("Show", "Mostrar") + " " + s.label}
            style={{
              flex: 1, textAlign: "center", padding: "12px 8px", cursor: "pointer",
              border: "none", borderLeft: i ? "1px solid var(--line)" : undefined,
              background: tab === s.target ? "var(--accent-soft)" : "transparent",
              borderBottom: tab === s.target ? "3px solid var(--accent)" : "3px solid transparent",
            }}
          >
            <div style={{ fontFamily: "Archivo, sans-serif", fontSize: 22, fontWeight: 800, color: s.accent && s.n > 0 ? "var(--amber)" : "var(--text)" }}>{s.n}</div>
            <div className="hint" style={{ marginTop: 0 }}>{s.label}</div>
          </button>
        ))}
      </div>

      {soloPendientes ? (
        <div className="hint" style={{ marginBottom: 8 }}>
          <b>{t("Viewing overdue and undated orders only", "Viendo solo órdenes expiradas y sin fecha")}</b> — {t("they belong to no day until you give them one. Set a date and the order moves to that day.", "no son de ningún día hasta que se les pone uno. Póngale fecha y la orden pasa a ese día.")}{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => setSoloPendientes(false)}>{t("Back to the day", "Volver al día")}</button>
        </div>
      ) : (pendientes.atrasadas.length + pendientes.sinFecha.length > 0) && !oculto(AVISOS_DEL_GESTOR.atrasadas) && (
        <div className="hint" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{t(`${pendientes.atrasadas.length} overdue order(s) · ${pendientes.sinFecha.length} with no date`, `${pendientes.atrasadas.length} orden(es) expiradas · ${pendientes.sinFecha.length} sin fecha`)}
          {" — "}{t("not part of this day.", "no son de este día.")}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setAllDates(false); setSoloPendientes(true); }}>{t("View them", "Verlas")}</button>
          <CerrarAviso aviso={AVISOS_DEL_GESTOR.atrasadas} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.atrasadas)} />
        </div>
      )}

      {err && <div className="hint" style={{ color: "var(--red)", marginBottom: 8 }}>⚠ {err}</div>}

      {/* ---------- Layout toolbar ---------- */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <button className={"btn btn-sm " + (showTop ? "btn-ghost" : "btn-primary")} onClick={() => setShowTop((v) => !v)}
          title={t("Show or hide the map + driver panel to free up space", "Mostrar u ocultar el mapa y el panel para ganar espacio")}>
          🗺 {showTop ? t("Hide map & drivers", "Ocultar mapa y choferes") : t("Show map & drivers", "Mostrar mapa y choferes")}
        </button>
        {tab === "routes" && (
          <button className="btn btn-ghost btn-sm" onClick={() => setWideRoutes((v) => !v)}
            title={t("Toggle full-width route cards vs a compact grid", "Alternar tarjetas de ruta a ancho completo o cuadrícula compacta")}>
            {wideRoutes ? "▦ " + t("Grid", "Cuadrícula") : "▭ " + t("Wide", "Ancho")}
          </button>
        )}
        {/* Lo cerrado con las ✕ de los avisos (D-400) se recupera aquí, todo junto. Solo sale si hay algo cerrado. */}
        {avisosOcultos != null && avisosOcultos.size > 0 && (
          <button className="btn btn-ghost btn-sm" data-mostrar-avisos-ocultos onClick={muestraAvisosOcultos}
            title={t("Show again the notices you closed on this screen", "Volver a mostrar los avisos que cerró en esta pantalla")}>
            👁 {t(`Show hidden notices (${avisosOcultos.size})`, `Mostrar avisos ocultos (${avisosOcultos.size})`)}
          </button>
        )}
      </div>

      {/* ---------- Driver panel + map ---------- */}
      {showTop && (<>
      {/* Sticky so the driver pool (and map) stay visible while you scroll the
          route cards below and build routes. Capped height + own scroll so it
          never takes over the screen. */}
      <div ref={panelFijoRef} style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8, position: "sticky", top: 6, zIndex: 5, background: "var(--paper)", paddingBottom: 6 }}>
        <div className="card" style={{ flex: "1 1 250px", maxWidth: 340, margin: 0, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(60vh, 520px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <b style={{ flex: 1 }}>🚚 {t("Drivers & routes", "Choferes y rutas")}</b>
            {selected.size >= 2 && (
              <button className="btn btn-primary btn-sm" onClick={mergeSelectedLanes}
                title={t("Combine the checked routes into one (merges into the top-most checked one)", "Combinar las rutas marcadas en una (se unen en la primera marcada)")}>
                🔀 {t("Merge", "Unir")} ({selected.size})
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => addBucket()} title={t("Add a numbered route (Route 1, Route 2…) to build on, then hand it to a driver later", "Agrega una ruta numerada (Ruta 1, Ruta 2…) para armar, y entrégala a un chofer después")}>＋ {t("Route", "Ruta")}</button>
            {focused && <button className="notif-clear" onClick={() => setSelected(new Set())}>{t("Show all", "Mostrar todos")}</button>}
          </div>
          {lanes.length === 0 ? (
            <div className="empty">{t("No drivers yet — tap “＋ Route” to build a route without one.", "Aún sin choferes — toca “＋ Ruta” para armar una ruta sin uno.")}</div>
          ) : (
            <div style={{ maxHeight: 470, overflowY: "auto" }}>
              {lanesDelFiltro.map((u) => {
                const stops = byDriver.get(u.key) ?? [];
                const info = routeInfo[u.key];
                const on = selected.has(u.key);
                const bucket = u.isBucket;
                const needsDriver = !isRealDriver(u.driver);
                // Load vs truck capacity — a filled bar the dispatcher can read
                // at a glance; over capacity turns red (the day needs a reload trip).
                const pallets = sumaPallets(stops);
                const cap = capacityFor(u.driver);
                const pct = cap > 0 ? Math.min(100, (pallets / cap) * 100) : 0;
                const over = pallets > cap;
                return (
                  <div
                    key={u.id}
                    onClick={() => focusOnly(u.key)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: "1px solid var(--line)", cursor: "pointer", background: on ? "var(--accent-soft)" : undefined }}
                  >
                    <input type="checkbox" checked={on} onClick={(e) => e.stopPropagation()} onChange={() => toggleDriver(u.key)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorFor(u.driver), flex: "0 0 auto", border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        {u.label}
                        {/* Clocked in AND reporting right now. Driven by the
                            realtime location feed, so it appears and clears on
                            its own — no refresh. */}
                        {liveNames.has(u.driver) && (
                          <button
                            className="sema live-tag"
                            // Tapping the NAME shows their route; tapping this
                            // answers the other question — where are they now.
                            onClick={(e) => { e.stopPropagation(); setLocateDriver(u.driver); }}
                            title={t("Show where this driver is right now", "Ver dónde está este chofer ahora")}
                          >
                            {t("LIVE", "EN VIVO")}
                          </button>
                        )}
                        {needsDriver && <span className="sema" style={{ background: "var(--accent)", color: "#fff", fontSize: 10 }}>🧭 {t("route", "ruta")}</span>}
                        {bloqueada(u.key) && <span data-candado-en-el-panel title={t("Locked for this day", "Bloqueada este día")}>🔒</span>}
                        {bucket && (
                          <button className="notif-clear" title={t("Rename temp driver", "Renombrar chofer temp")}
                            onClick={(e) => { e.stopPropagation(); renameBucket(u.key); }}>✏</button>
                        )}
                        {bucket && (
                          <button className="notif-clear" title={t("Remove this route", "Quitar esta ruta")}
                            onClick={(e) => { e.stopPropagation(); clearLane(u.key); }}>✕</button>
                        )}
                      </div>
                      <div className="hint" style={{ marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>📦 {stops.length}</span>
                        {/* Travel time & miles only appear once a route has been calculated. */}
                        {info && <span>⏱ {info.duration_text}</span>}
                        {info && <span>⇥ {info.miles} mi</span>}
                      </div>
                      {/* Capacity meter: pallets loaded vs the truck's capacity. */}
                      <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: over ? "var(--red)" : "var(--green)" }} />
                        </div>
                        <span className="hint" style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--red)" : undefined }}>
                          {pallets}/{cap}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card" style={{ flex: "3 1 460px", margin: 0, padding: 0, overflow: "hidden" }}>
          <MapView points={points} lines={lines} stores={storeMarkers} liveDrivers={liveDrivers.filter((c) => pasaFiltro(c.driver))} onLineClick={onLineClick} fitTo={fitTo} height={430} onPointClick={(id) => {
            // Click any order pin (assigned or pool) to toggle its PU→DEL view.
            const d = dayOrders.find((x) => x.id === id);
            if (d) toggleOrder(d.id);
          }} />
        </div>
      </div>
      {!oculto(AVISOS_DEL_GESTOR.ayudaDelMapa) && (
      <div className="hint" style={{ marginTop: 4, marginBottom: 14, display: "flex", alignItems: "flex-start", gap: 8 }}><span>
        {t(
          "Every route is on the map at once. Click a route or a driver to highlight it (the rest dim and the map zooms in); check drivers to compare several. Each route loops from the pickup point (P) out and back; the dashed part is the drive back.",
          "Todas las rutas están en el mapa a la vez. Haz clic en una ruta o un chofer para resaltarla (el resto se atenúa y el mapa hace zoom); marca varios choferes para comparar. Cada ruta hace un ciclo desde el punto de recolección (P) y regresa; lo punteado es el regreso.",
        )}</span>
        <CerrarAviso aviso={AVISOS_DEL_GESTOR.ayudaDelMapa} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.ayudaDelMapa)} />
      </div>
      )}
      </>)}

      {/* ---------- Tabs ---------- */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div className="viewtoggle">
        <button className={"vt " + (tab === "routes" ? "on" : "")} onClick={() => setTab("routes")}>🧭 {t("Routes", "Rutas")} ({withStops.filter((u) => pasaFiltro(u.key)).length})</button>
        <button className={"vt " + (tab === "orders" ? "on" : "")} onClick={() => setTab("orders")}>📦 {t("Unassigned", "Sin asignar")} ({unassigned.length})</button>
        <button className={"vt " + (tab === "board" ? "on" : "")} onClick={() => setTab("board")}>🗂 {t("Board", "Tablero")}</button>
        <button className={"vt " + (tab === "timeline" ? "on" : "")} onClick={() => setTab("timeline")}>📅 {t("Timeline", "Horario")}</button>
      </div>
        {/* Deshacer / rehacer los movimientos a mano de esta sesión (D-417): arrastrar en «Horario» y las flechas. */}
        {(tab === "timeline" || historial.deshacer.length > 0 || historial.rehacer.length > 0) && (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <button className="btn btn-ghost btn-sm" data-deshacer disabled={moviendo || !historial.deshacer.length} onClick={() => void vuelve("deshacer")}
              title={historial.deshacer.length ? t(`Undo: ${historial.deshacer[historial.deshacer.length - 1].etiqueta.en} (Ctrl+Z)`, `Deshacer: ${historial.deshacer[historial.deshacer.length - 1].etiqueta.es} (Ctrl+Z)`) : undefined}>
              ↶ {t("Undo", "Deshacer")}
            </button>
            <button className="btn btn-ghost btn-sm" data-rehacer disabled={moviendo || !historial.rehacer.length} onClick={() => void vuelve("rehacer")}
              title={historial.rehacer.length ? t(`Redo: ${historial.rehacer[historial.rehacer.length - 1].etiqueta.en} (Ctrl+Y)`, `Rehacer: ${historial.rehacer[historial.rehacer.length - 1].etiqueta.es} (Ctrl+Y)`) : undefined}>
              ↷ {t("Redo", "Rehacer")}
            </button>
          </span>
        )}
        {/* ⚠ Incidencias (D-NEXT): un botón, a la derecha de las pestañas, que abre la ventana. Ámbar si hay alguna
            registrada (las incidencias no tienen estado «abierta»: se registran y se borran). */}
        <button className={"btn btn-sm " + (incidents.length ? "btn-amber" : "btn-ghost")} data-abrir-incidencias
          style={{ marginLeft: "auto" }} aria-haspopup="dialog" onClick={() => setIncidenciasAbiertas(true)}>
          ⚠ {t("Incidents", "Incidencias")} ({incidents.length})
        </button>
      </div>

      {incidenciasAbiertas && (
        <div className="overlay" data-ventana-incidencias onClick={(e) => { if (e.target === e.currentTarget) setIncidenciasAbiertas(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={t("Driver incidents", "Incidencias de choferes")} style={{ maxWidth: 820 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>⚠ {t("Driver incidents", "Incidencias de choferes")}</h3>
              <button className="btn btn-sm" data-cerrar-incidencias onClick={() => setIncidenciasAbiertas(false)} aria-label={t("Close", "Cerrar")}>✕</button>
            </div>
            <DriverIncidents me={me} drivers={drivers} deliveries={deliveries} incidents={incidents} addIncident={addIncident} removeIncident={removeIncident} confirmAction={confirmAction} notify={notify} t={t} enVentana />
          </div>
        </div>
      )}

      {/* ---------- Day timeline (Gantt) ---------- */}
      {tab === "timeline" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Each driver's day in route order: every stop at its estimated arrival (straight-line estimate, leaving at 08:00), its window as the thin line underneath; ⚠ = late.",
              "El día de cada chofer en el orden de su ruta: cada parada a su llegada estimada (en línea recta, saliendo a las 08:00), y su ventana en la raya fina de abajo; ⚠ = tarde.")}
            {modo === "dia" && <> {t("Drag a stop to another slot or driver, or onto a driver's name for 📍 Best fit. Ctrl+Z undoes.", "Arrastre una parada a otro hueco o chofer, o al nombre de un chofer para 📍 Mejor lugar. Ctrl+Z deshace.")}</>}
          </p>
          {ganttRows.every((r) => r.barras.length === 0)
            ? <div className="empty">{t("No assigned orders to show yet.", "Aún no hay órdenes asignadas.")}</div>
            : <GanttTimeline rows={ganttRows} t={t}
                arrastre={modo === "dia" ? { inicioMin: DAY_START_MIN, previa: previaDeSoltar, suelta: (id, destino) => void sueltaEnLaLinea(id, destino), ocupado: moviendo } : undefined} />}
        </div>
      )}

      {/* ---------- Drag-and-drop board ---------- */}
      {tab === "board" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Drag an order card onto a driver to assign it, or back to Unassigned to remove it.", "Arrastre una tarjeta a un chofer para asignarla, o de vuelta a Sin asignar para quitarla.")}
          </p>
          <DispatchBoard columns={boardColumns} onMove={boardMove} t={t} lang={lang} onPrint={printManifestFor} />
        </div>
      )}

      {/* ---------- Unassigned pool ---------- */}
      {tab === "orders" && (
      <div className="card" style={{ margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => toggleCollapse(PANEL_SIN_ASIGNAR)}>
          <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Collapse", "Contraer")}>{isCollapsed(PANEL_SIN_ASIGNAR) ? "▸" : "▾"}</button>
          <h2 style={{ margin: 0 }}>📦 {t("Unassigned orders", "Órdenes sin asignar")}</h2>
          <span className="count-tag">{unassigned.length}</span>
        </div>
        {!isCollapsed(PANEL_SIN_ASIGNAR) && <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
          <input
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder={t("Search # / customer / address / phone…", "Buscar # / cliente / dirección / teléfono…")}
            style={{ maxWidth: 300 }}
          />
          <SelectorDeColumnas
            columnas={columnasDelSelector("sinAsignar", ordenGestor)}
            elegidas={colsGestor} onAlterna={alternaColumnaDelGestor} t={t} alLado="izquierda"
            rotulo={(c) => (lang === "es" ? c.es : c.en)}
            titulo={t("Show and order columns", "Mostrar y ordenar columnas")} nota={t("Saved for you.", "Se guarda para usted.")}
            plantillas={propsDePlantillas}
            mover={moverEn("sinAsignar")}
          />
          {/* Chips de «Sin asignar» (D-393): «Este día» es el antiguo «Todas»; «Todas» es de cualquier día. Cada uno
              lleva su número, que sale de la misma función que sus filas. */}
          {(["dia", "todas", "overdue", "windowed", "noloc"] as const).map((f) => (
            <button
              key={f}
              className={"btn btn-sm " + (poolFilter === f ? "btn-primary" : "btn-ghost")}
              onClick={() => setPoolFilter(f)}
              data-chip-sin-asignar={f}
              title={f === "todas" ? t("Unassigned orders from any day — past, future or undated", "Órdenes sin asignar de cualquier día — pasadas, futuras o sin fecha") : undefined}
            >
              {f === "dia" ? (modo === "dia" ? t("This day", "Este día") : modo === "todas" ? t("All dates", "Todas las fechas") : t("Overdue & undated", "Expiradas y sin fecha"))
                : f === "todas" ? t("All", "Todas")
                : f === "overdue" ? t("Overdue", "Expiradas")
                : f === "windowed" ? t("Windowed", "Con ventana")
                : t("No location", "Sin ubicación")} ({cuentasDeChips[f]})
            </button>
          ))}
          {selectedOrders.size > 0 && (
            <>
              <span className="count-tag">{selectedOrders.size} {t("selected", "seleccionadas")}</span>
              <button className="btn btn-ghost btn-sm" onClick={clearSelection}>{t("Clear", "Limpiar")}</button>
            </>
          )}
        </div>
        {filasDelChip.length === 0 ? (
          <div className="empty">{poolFilter === "dia"
            ? t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.")
            : t("No unassigned orders with this filter.", "Ninguna orden sin asignar con este filtro.")}</div>
        ) : unassignedShown.length === 0 ? (
          <div className="empty">{t("No unassigned orders match your search.", "Ninguna orden sin asignar coincide con la búsqueda.")}</div>
        ) : (
          <>
          <FiltrosPuestos estado={ordenSinAsignar} columnas={menuSinAsignar} lang={lang} t={t} />
          <BarraSuperior caja={cajaSinAsignarRef} />
          <div className="tbl-scroll tbl-fit tbl-caja" ref={cajaSinAsignarRef} style={estiloDeCaja}>
            <table className="orders tbl-resize" style={anchoDeTabla([28, ...colsSinAsignar.map((c) => anchoEnSinAsignar(c.key)), 116])}>
              <colgroup>
                <col style={{ width: 28 }} />
                {colsSinAsignar.map((c) => <col key={c.key} style={{ width: anchoEnSinAsignar(c.key) }} />)}
                <col style={{ width: 116 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label={t("Select all", "Seleccionar todo")}
                      // «Seleccionar todo» es lo que se VE: con un filtro de columna puesto (D-360), solo esas filas.
                      checked={ordenSinAsignar.visibles.length > 0 && ordenSinAsignar.visibles.every((d) => selectedOrders.has(d.id))}
                      onChange={(e) => setSelectedOrders((s) => {
                        const n = new Set(s);
                        if (e.target.checked) ordenSinAsignar.visibles.forEach((d) => n.add(d.id));
                        else ordenSinAsignar.visibles.forEach((d) => n.delete(d.id));
                        return n;
                      })}
                    />
                  </th>
                  {/* Cada cabecera abre el menú de ordenar y filtrar (D-360); el tirador del ancho sigue en su sitio. */}
                  {menuSinAsignar.map((c) => <th key={c.key}><CabeceraConMenu estado={ordenSinAsignar} col={c} lang={lang} t={t} /><span className="col-resizer" onMouseDown={poolCols.startResize(`g_${c.key}`, anchoDePartida(c.key, COLUMN_WIDTHS))} /></th>)}
                  <th>{t("Assign to", "Asignar a")}</th>
                </tr>
              </thead>
              <tbody>
                {ordenSinAsignar.visibles.length === 0 && (
                  <tr><td colSpan={colsSinAsignar.length + 2} className="empty">{t("No rows match the current filters.", "Ninguna fila coincide con los filtros actuales.")}</td></tr>
                )}
                {ordenSinAsignar.visibles.map((d) => {
                  return (
                    <tr key={d.id} className={selectedOrders.has(d.id) ? "row-selected" : ""} onClick={() => toggleOrder(d.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <input type="checkbox" checked={selectedOrders.has(d.id)} readOnly aria-label={`#${orderLabel(d)}`} />
                        {selectedOrders.has(d.id) && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: selColorById.get(d.id), marginLeft: 5, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />}
                      </td>
                      {/* La factura abre la orden y NO selecciona la fila: `stopPropagation` en `abreLaOrden`. */}
                      {colsSinAsignar.map((c) => (
                        <td key={c.key} className={clasePastillas(c.key)} onClick={c.key === "date" ? (e) => e.stopPropagation() : undefined}>
                          {/* Las que vienen de Órdenes (D-376) —etapa, tipo, SO, PO, costo, contacto— con la celda de Órdenes. */}
                          {c.deOrdenes ? celdaDeOrdenes(c.key, d)
                            : c.key === "invoice" ? enlaceALaOrden(d)
                            : c.key === "account" ? (d.account || "—")
                            : c.key === "address" ? <span title={d.delivery_address || undefined}>{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || "—"}</span>
                            : c.key === "pickup" ? <span title={d.pickup_address || undefined}>{d.pickup_name || d.pickup_address || "—"}</span>
                            : c.key === "store" ? (d.store || "—")
                            : c.key === "pallets" ? (d.actual_pallets ?? d.est_pallets ?? "—")
                            : c.key === "date" ? <DateCell d={d} date={date} onChange={reschedule} t={t} />
                            : c.key === "windows" ? fmtWindows(d.delivery_windows)
                            : "—"}
                        </td>
                      ))}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                          {/* Assign is ALWAYS available. «🔮 Simular», que salía al lado con un chofer elegido, se quitó en D-NEXT:
                              reoptimizaba la ruta entera y la escribía. «📍 Mejor lugar» mete la orden sin mover las demás. */}
                          <select defaultValue="" onChange={(e) => {
                            const v = e.target.value; e.currentTarget.value = "";
                            if (!v) return;
                            const target = v === "__newroute__" ? addBucket() : v;
                            // If this row is part of a multi-selection, assign the WHOLE selection.
                            if (selectedOrders.has(d.id) && selectedOrders.size > 1) bulkAssign(target);
                            else manualAssign(d.id, target);
                          }} style={{ width: "auto" }}>
                            <option value="">{t("Assign to…", "Asignar a…")}</option>
                            {drivers.length > 0 && (
                              <optgroup label={t("Drivers", "Choferes")}>
                                {drivers.map((u) => <option key={u.id} value={u.full_name}>{u.full_name}</option>)}
                              </optgroup>
                            )}
                            <optgroup label={t("Temp drivers / routes", "Choferes temp / rutas")}>
                              {bucketNames.map((n) => <option key={n} value={n}>🧭 {n}</option>)}
                              <option value="__newroute__">＋ {t("New route…", "Nueva ruta…")}</option>
                            </optgroup>
                          </select>
                          {/* La sugerencia de chofer («💡 nombre») que salía aquí se quitó (D-346), por pedido del dueño. */}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <MenuDeColumnaAbierto estado={ordenSinAsignar} columnas={menuSinAsignar} lang={lang} t={t} />
          </>
        )}
        {/* «Elige conductor para N órdenes» (D-395): sustituye al antiguo desplegable «Asignar selección a…» y al botón
            «Auto-asignar selección» de la barra de arriba (ya no hay Auto-asignar, D-NEXT). Va DESPUÉS de la tabla y pegado al borde de abajo de la ventana
            (`sticky`): arriba de la tabla quedaba debajo del mapa, que también es `sticky`, en cuanto se bajaba a marcar
            una fila. Mientras se baja cubre las filas que pasan por detrás, pero al final de la tabla vuelve a su sitio,
            así que ninguna fila queda tapada para siempre. */}
        {/* Lo que hizo «📍 Mejor lugar» (D-411): dónde entró cada orden y por qué. Se queda hasta cerrarlo o marcar otra
            cosa —el aviso de abajo dura 2,6 s y esto es lo que hay que leer—, en el sitio del recuadro, que ya se fue. */}
        {avisoMejorLugar && poolSelectedCount === 0 && (
          <div className="card" data-aviso-mejor-lugar role="status"
            style={{ position: "sticky", bottom: 8, zIndex: 6, margin: "10px 0 0", padding: "10px 14px", border: "2px solid var(--green)", display: "flex", gap: 10, alignItems: "flex-start", maxWidth: "100%", boxSizing: "border-box" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              {avisoMejorLugar.map((linea, i) => <div key={i} style={{ marginTop: i ? 4 : 0 }}>📍 {linea}</div>)}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={t("Close", "Cerrar")} onClick={() => setAvisoMejorLugar(null)}>✕</button>
          </div>
        )}
        {poolSelectedCount > 0 && (
          <div className="card" data-elige-conductor role="group" aria-label={t(`Choose a driver for ${poolSelectedCount} orders`, `Elige conductor para ${poolSelectedCount} órdenes`)}
            style={{ position: "sticky", bottom: 8, zIndex: 6, margin: "10px 0 0", padding: "12px 14px", border: "2px solid var(--accent)", background: "var(--accent-soft)", maxWidth: "100%", boxSizing: "border-box" }}>
            <b style={{ display: "block", fontSize: 15, marginBottom: 8 }}>
              👉 {poolSelectedCount === 1
                ? t("Choose a driver for 1 order", "Elige conductor para 1 orden")
                : t(`Choose a driver for ${poolSelectedCount} orders`, `Elige conductor para ${poolSelectedCount} órdenes`)}
            </b>
            {opcionesDelRecuadro.length === 0 ? (
              <div className="hint" data-sin-choferes style={{ marginBottom: 8 }}>
                {t("No drivers or routes available. Use “New route” to build one without a driver.", "No hay choferes ni rutas disponibles. Use «Nueva ruta» para armar una sin chofer.")}
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 10, maxHeight: 132, overflowY: "auto" }}>
                {opcionesDelRecuadro.map((o) => (
                  <label key={o.clave} style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer", fontSize: 14, fontWeight: o.clave === conductorElegido ? 700 : 500, color: "var(--text)", textTransform: "none", letterSpacing: "normal", minWidth: 0 }}>
                    <input type="radio" name="elige-conductor" value={o.clave} checked={o.clave === conductorElegido}
                      onChange={() => setConductorPulsado(o.clave)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorFor(o.clave), flex: "0 0 auto", boxShadow: "0 0 0 1px var(--line)" }} />
                    <span>{o.esRuta ? "🧭 " : ""}{o.etiqueta}{bloqueada(o.clave) ? " 🔒" : ""}</span>
                    <span className="hint" data-carga-del-conductor>
                      ({o.paradas === 1 ? t("1 stop", "1 parada") : t(`${o.paradas} stops`, `${o.paradas} paradas`)} · {o.pallets}/{o.capacidad} {t("pallets", "pallets")})
                    </span>
                    {o.delFiltro && <span className="sema" style={{ fontSize: 10, background: "var(--card)", color: "var(--accent)", border: "1px solid var(--accent)" }}>{t("filter", "filtro")}</span>}
                    {o.enSuZona && <span className="sema" data-su-zona title={t("Some checked order is in this driver's preferred zone", "Alguna orden marcada es de la zona preferida de este chofer")} style={{ fontSize: 10, background: "var(--card)", color: "var(--green, var(--accent))", border: "1px solid var(--green, var(--accent))" }}>{t("their zone", "su zona")}</span>}
                    {o.noDisponible && <span className="sema" style={{ fontSize: 10, background: "var(--red-chip-bg)", color: "var(--red-chip-text)" }}>{t("off today", "no disponible")}</span>}
                  </label>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn-primary" data-asignar-al-elegido disabled={!conductorElegido || asignando}
                onClick={() => { if (conductorElegido) bulkAssign(conductorElegido); }}>
                {t("Assign", "Asignar")}
              </button>
              {/* «📍 Mejor lugar» (D-411): la orden entra sola en el hueco más barato de esa ruta, sin reoptimizar el
                  resto. Con la ruta bloqueada 🔒 se apaga, y la línea de al lado dice por qué. */}
              <button className="btn btn-primary" data-mejor-lugar disabled={!conductorElegido || asignando || (!!conductorElegido && bloqueada(conductorElegido))}
                title={t("Put each checked order in the cheapest slot of this driver's route, without reoptimizing the rest", "Poner cada orden marcada en el hueco más barato de la ruta de este chofer, sin reoptimizar lo demás")}
                onClick={() => { if (conductorElegido) void colocaEnElMejorLugar(conductorElegido); }}>
                📍 {t("Best fit", "Mejor lugar")}
              </button>
              {conductorElegido && bloqueada(conductorElegido) && (
                <span className="hint" data-mejor-lugar-bloqueada style={{ color: "var(--red-chip-text)" }}>
                  🔒 {t(`${laneLabel(conductorElegido)}'s route is locked: Best fit won't touch it (“Assign” still adds at the end).`, `La ruta de ${laneLabel(conductorElegido)} está bloqueada: Mejor lugar no la toca («Asignar» sí la añade al final).`)}
                </span>
              )}
              <button className="btn btn-ghost btn-sm" data-nueva-ruta-del-recuadro disabled={asignando} onClick={() => bulkAssign(addBucket())}>＋ {t("New route", "Nueva ruta")}</button>
              {/* «✨ Auto-asignar las marcadas» iba aquí; se quitó en D-NEXT. Repartir automático es «Armar las rutas del día». */}
            </div>
          </div>
        )}
        </>}
      </div>
      )}

      {/* ---------- Per-driver routes ---------- */}
      {tab === "routes" && (
      <div style={{ display: "grid", gridTemplateColumns: wideRoutes ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(440px, 1fr))", gap: 14, alignItems: "start" }}>
      {shownDrivers.length === 0 && (
        <div className="card" style={{ margin: 0 }}>
          <div className="empty">{t("No routes yet — assign orders to drivers in the Unassigned tab, or use “Build routes”.", "Aún sin rutas — asigna órdenes a los choferes en la pestaña Sin asignar, o usa «Armar rutas».")}</div>
        </div>
      )}
      {marcadasSinParadas.length > 0 && (
        <div className="hint" data-marcadas-sin-paradas style={{ gridColumn: "1 / -1", margin: 0 }}>
          {t(`No stops this day: ${marcadasSinParadas.map((u) => u.label).join(", ")}`, `Sin paradas este día: ${marcadasSinParadas.map((u) => u.label).join(", ")}`)}
        </div>
      )}
      {shownDrivers.map((u) => {
        const stops = byDriver.get(u.key) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.key];
        const capacity = capacityFor(u.driver);
        const trips = buildTrips(stops, capacity);
        // La misma ruta, leída como P1, P2… D1, D2… (D-334). No cambia nada de lo asignado: es solo cómo se LEE.
        // Con plan publicado y la ruta tal como el plan la dejó, mandan SUS etiquetas y SU secuencia; si se tocó después,
        // la lectura derivada, y se avisa (D-335). Se decide por chofer.
        const lectura = lecturaConLoHecho(trips, paradasPublicadasDe(u.driver), hechasDeLaRuta(u.key, stops));
        const dDe = lectura.etiquetaDe;
        // Nadie la ordenó: su P/D sale igual, provisional y en gris (D-379). A medias, no: D-336.
        const provisional = esProvisional(stops);
        // A load a person pinned (by hand), as opposed to one «Armar rutas» or the truck's capacity made.
        const pinnedLoads = stops.some((d) => (d.load_no ?? 1) > 1 && !d.load_auto);
        const isC = isCollapsed(u.key);
        const bucket = u.isBucket;
        // A route that isn't on a real driver (a bucket, or one recovered under
        // a stale name) can be handed to a driver.
        const needsDriver = !isRealDriver(u.driver);
        // Stops whose measured ETA lands after the delivery window closes —
        // surfaced as a banner so the dispatcher acts before dispatch, not just
        // as a red cell buried in the table.
        const lateStops = stops.filter((d) => {
          const eta = routeEtas[u.key]?.[d.id];
          const win = parseWindow(d.delivery_windows);
          const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
          return etaMin != null && win != null && etaMin > win[1];
        });
        // Tapping anywhere on the card that isn't a stop row drops the
        // single-stop focus, so the map goes back to this driver's whole day.
        // That's the "tap outside" way back out.
        return (
          <div className="card" key={u.id} style={{ margin: 0 }} onClick={() => setSelectedOrders((prev) => (prev.size ? new Set() : prev))}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} onClick={() => toggleCollapse(u.key)} title={t("Collapse", "Contraer")}>{isC ? "▸" : "▾"}</button>
              <span
                onClick={() => focusOnly(u.key)}
                title={t("Show this route on the map", "Mostrar esta ruta en el mapa")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.driver), border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
                <h2 style={{ margin: 0 }}>{u.label}</h2>
                <span className="hint" style={{ fontSize: 12 }}>🗺</span>
              </span>
              {needsDriver && <span className="sema" style={{ background: "var(--accent)", color: "#fff" }}>🧭 {t("route (no driver)", "ruta (sin chofer)")}</span>}
              {bucket && <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Rename temp driver", "Renombrar chofer temp")} onClick={() => renameBucket(u.key)}>✏</button>}
              <span className="count-tag">{stops.length} {t("stops", "paradas")}</span>
              {stops.length > 0 && trips.length > 1 && (
                <span className="sema" style={{ background: "var(--amber)", color: "#fff" }}>{trips.length} {t("truckloads", "viajes")}</span>
              )}
              {/* Says who decided the grouping: a person (by hand) or the system («Armar rutas», or the truck's capacity).
                  Hasta D-NEXT decía también qué podía cambiar «Optimizar», que ya no existe. */}
              {stops.length > 0 && trips.length > 1 && (
                pinnedLoads ? (
                  <span className="sema" style={{ background: "var(--card-hover)", color: "var(--ink-soft)" }}
                    title={t("You grouped these truckloads by hand. “Combine loads” puts them back into one.", "Usted agrupó estos viajes a mano. «Unir viajes» los vuelve a juntar en uno.")}>
                    📌 {t("loads pinned by you", "viajes fijados por usted")}
                  </span>
                ) : (
                  <span className="sema" style={{ background: "var(--card-hover)", color: "var(--ink-soft)" }}
                    title={t("The truckloads came from “Build routes” or from the truck's capacity, not from a person.", "Los viajes salieron de «Armar rutas» o de la capacidad del camión, no de una persona.")}>
                    🧩 {t("grouped automatically", "agrupado automáticamente")}
                  </span>
                )
              )}
              {info && (
                <span
                  className="hint"
                  style={{ marginTop: 0 }}
                  title={t(
                    `${info.duration_text} driving; the rest is unloading and reloading between truckloads`,
                    `${info.duration_text} manejando; el resto es descarga y recarga entre viajes`,
                  )}
                >
                  · {info.miles} mi · {info.dayText} {t("day", "jornada")} ({info.duration_text} {t("drive", "manejo")})
                </span>
              )}
              {/* Measured against the WHOLE day. Judging an 8-hour shift on
                  wheel time alone hid every route that only busts the day
                  once you count unloading. */}
              {info && info.dayMinutes > 8 * 60 && (
                <span className="sema" style={{ background: "var(--red)", color: "#fff" }} title={t("Driving, unloading and reloading run past an 8-hour day", "Manejo, descarga y recarga pasan de una jornada de 8 horas")}>
                  ⚠ {t("over 8 h day", "más de 8 h")}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--gray)" }}>
                🚚 {t("Truck capacity", "Capacidad del camión")}
                <input
                  type="number" min={1} value={capacity}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setCapacity(u.driver, v); }}
                  style={{ width: 60 }}
                />
                {t("plt", "trm")}
              </label>
              {/* 🔒 (D-411): por ruta y por día. Bloqueada, ni «Armar rutas» ni «Mejor lugar» la tocan; las flechas y
                  «Asignar» sí. (Optimizar, Auto-asignar y Simular, que también la respetaban, se quitaron en D-NEXT.) */}
              <button className={bloqueada(u.key) ? "btn btn-amber btn-sm" : "btn btn-ghost btn-sm"} data-candado={u.key}
                data-candado-fuente={candados.fuente} aria-pressed={bloqueada(u.key)}
                title={`${bloqueada(u.key)
                  ? t(`Locked for this day${bloqueadaPor(u.key) ? ` by ${bloqueadaPor(u.key)}` : ""}: Build routes and Best fit leave it alone. Click to unlock.`, `Bloqueada este día${bloqueadaPor(u.key) ? ` por ${bloqueadaPor(u.key)}` : ""}: Armar rutas y Mejor lugar no la tocan. Pulse para desbloquear.`)
                  : t("Lock this route for this day, so Build routes and Best fit leave it alone (arrows still work).", "Bloquear esta ruta este día, para que Armar rutas y Mejor lugar no la toquen (las flechas sí).")} ${t(dondeViveElCandado(candados).en, dondeViveElCandado(candados).es)}`}
                onClick={(e) => { e.stopPropagation(); void alternaCandado(u.key); }}>
                {bloqueada(u.key) ? `🔒 ${t("Locked", "Bloqueada")}` : `🔓 ${t("Lock", "Bloquear")}`}
              </button>
              {/* «🧭 Optimizar ruta» iba aquí; se quitó en D-NEXT. El orden lo deciden «Armar las rutas del día», «Mejor
                  lugar», las flechas y el arrastre. */}
              {needsDriver && (
                <select
                  defaultValue=""
                  disabled={stops.length === 0 || drivers.length === 0}
                  title={t("Hand this whole route to a driver", "Entregar toda esta ruta a un chofer")}
                  onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) assignRouteToDriver(u.key, v); }}
                  style={{ width: "auto" }}
                >
                  <option value="">👤 {t("Assign route to…", "Asignar ruta a…")}</option>
                  {drivers.map((dv) => <option key={dv.id} value={dv.full_name}>{dv.full_name}</option>)}
                </select>
              )}
              {/* «🧩 Reagrupar por zona» iba antes de «Unir viajes»: borraba los viajes y OPTIMIZABA. Se quitó en D-NEXT. */}
              {hasManualLoads(stops) ? (
                <button className="btn btn-ghost btn-sm" data-unir-viajes title={t("Merge all truckloads back into one, keeping the order", "Unir todos los viajes en uno, en el mismo orden")}
                  onClick={() => combineLoads(u.key)}>🔗 {t("Combine loads", "Unir viajes")}</button>
              ) : trips.length === 1 && stops.length >= 2 && (
                <button className="btn btn-ghost btn-sm" data-dividir-en-dos title={t("Split this truckload into two, keeping the order", "Dividir este viaje en dos, en el mismo orden")}
                  onClick={() => splitLoads(u.key)}>✂ {t("Split into 2", "Dividir en 2")}</button>
              )}
              {stops.length > 0 && (
                <button className="btn btn-danger btn-sm" title={t("Clear this route — send every stop back to Unassigned", "Vaciar esta ruta — devolver todas las paradas a Sin asignar")}
                  onClick={() => clearLane(u.key)}>🗑 {t("Clear", "Vaciar")}</button>
              )}
            </div>
            {!isC && <>
            {lateStops.length > 0 && (
              <div className="card" style={{ marginBottom: 8, background: "var(--red-soft)", borderColor: "var(--red)" }}>
                <b style={{ color: "var(--red)" }}>⚠️ {t(`${lateStops.length} stop(s) will miss their delivery window`, `${lateStops.length} parada(s) no llegarán a tiempo a su ventana`)}</b>
                <div className="hint" style={{ marginTop: 2 }}>
                  {lateStops.slice(0, 6).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}`).join(", ")}{lateStops.length > 6 ? "…" : ""}
                  {" — "}{t("reorder the stops or move some to another driver.", "reordene las paradas o mueva algunas a otro chofer.")}
                </div>
              </div>
            )}
            {info && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("Total (loop from pickup and back)", "Total (ciclo desde recolección y regreso)")}: <b>{info.miles} mi</b> · <b>{info.dayText}</b> {t("on the clock", "de jornada")} ({info.duration_text} {t("driving", "manejando")})
                {info.trips > 1 && ` · ${info.trips} ${t("round trips back to pickup to reload", "viajes de ida y vuelta a recolección para recargar")}`}
              </div>
            )}
            {trips.length > 1 && (() => {
              const load = sumaPallets(stops);
              return (
                <div className="hint" style={{ marginBottom: 8, color: "var(--accent)" }}>
                  💡 {t(
                    `This is over the ${capacity}-pallet truck capacity (${load} on board), so it reloads at the pickup between loads. Raise the truck capacity to ${load} or more to carry it all in one trip (drop → drop).`,
                    `Supera la capacidad de ${capacity} pallets del camión (${load} a bordo), por eso recarga en la recolección entre cargas. Sube la capacidad a ${load} o más para llevar todo en un solo viaje (parada → parada).`,
                  )}
                </div>
              );
            })()}
            {!u.store && stops.length > 0 && trips.length > 1 && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t(
                  "This driver has no home store assigned (Users), so trips can't be anchored to a depot — the miles are measured as open routes instead of round trips.",
                  "Este chofer no tiene tienda asignada (Usuarios), así que los viajes no pueden anclarse a un depósito — las millas se miden como rutas abiertas en vez de viajes de ida y vuelta.",
                )}
              </div>
            )}
            {stops.length > 0 && !sequenced && (
              <div className="hint" style={{ marginBottom: 8 }}>
                {t("No saved order yet — set it with the ↑/↓ arrows or 📍 Best fit, or plan the day with “Build routes”.", "Aún sin orden guardado — póngalo con las flechas ↑/↓ o 📍 Mejor lugar, o planifique el día con «Armar rutas».")}
                {provisional && <> {t("The grey P/D labels follow the current order.", "Las etiquetas P/D en gris siguen el orden de ahora.")}</>}
              </div>
            )}
            {missingPins > 0 && (() => {
              const noPin = stops.filter((d) => d.delivery_lat == null);
              return (
                <div className="card" style={{ marginBottom: 8, background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
                  <b style={{ color: "var(--amber-text)" }}>📍 {t(`${missingPins} stop(s) aren't on the map yet, so the route skips them.`, `${missingPins} parada(s) aún no están en el mapa, así que la ruta las omite.`)}</b>
                  <div className="hint" style={{ marginTop: 2 }}>
                    {noPin.map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}${d.delivery_address ? "" : " — " + t("no delivery address", "sin dirección de entrega")}`).join(", ")}
                    {" — "}{t("give each a valid delivery address (or drop a map pin) on the Orders page so it geocodes.", "dé a cada una una dirección de entrega válida (o coloque un pin) en Órdenes para que se ubique.")}
                  </div>
                </div>
              );
            })()}
            {stops.length > 0 && (
              <div style={{ textAlign: "right" }}>
                <SelectorDeColumnas
                  columnas={columnasDelSelector("paradas", ordenGestor)}
                  elegidas={colsGestor} onAlterna={alternaColumnaDelGestor} t={t}
                  rotulo={(c) => (lang === "es" ? c.es : c.en).replace(/^[^:]+: /, "")}
                  titulo={t("Stop columns", "Columnas de paradas")} nota={t("Saved for you. Applies to every route.", "Se guarda para usted. Vale para todas las rutas.")}
                  plantillas={propsDePlantillas}
                  mover={moverEn("paradas")}
                />
              </div>
            )}
            {stops.length > 0 && (
              <>
              <BarraSuperior caja={cajaDeParadas(u.key)} />
              <div className="tbl-scroll tbl-fit tbl-caja" ref={cajaDeParadas(u.key)} style={estiloDeCaja}>
                {/* Address stays on one line (narrow by default) with an
                    expand/contract toggle, so Windows + the action arrows never
                    get pushed off the right edge. Width pinned to the column
                    sum; columns still draggable. */}
                <table className="orders tbl-resize" style={{ width: ["_n", "_factura", ...colsParadas.map((c) => c.key), "_acciones"].reduce((sum, k) => sum + anchoDeParada(k), 0) }}>
                  {/* Número de parada y factura, las elegidas en el orden de la persona (D-410), y las acciones al final.
                      Todo por CLAVE: el ancho viaja con la columna cuando se mueve. */}
                  <colgroup>
                    <col style={{ width: anchoDeParada("_n") }} />
                    <col style={{ width: anchoDeParada("_factura") }} />
                    {colsParadas.map((c) => <col key={c.key} style={{ width: anchoDeParada(c.key) }} />)}
                    <col style={{ width: anchoDeParada("_acciones") }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>#<span className="col-resizer" onMouseDown={asaDeParada("_n")} /></th>
                      <th>{t("Invoice #", "Factura #")}<span className="col-resizer" onMouseDown={asaDeParada("_factura")} /></th>
                      {/* El rótulo es el del catálogo sin su «Paradas: » (el de Órdenes, para las que vienen de allí). */}
                      {colsParadas.map((c) => <th key={c.key} title={c.key === "p_pallets" ? t("Pallets on this stop", "Pallets de esta parada") : undefined}>{(lang === "es" ? c.es : c.en).replace(/^[^:]+: /, "")}<span className="col-resizer" onMouseDown={asaDeParada(c.key)} /></th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((batch, ti) => {
                      const startIdx = trips.slice(0, ti).reduce((n, b) => n + b.length, 0);
                      // A la décima (D-355): los pallets llevan fracciones (0.03) y la suma en coma flotante salía «7.569999999999999».
                      const load = sumaPallets(batch);
                      const free = aLaDecima(Math.max(0, capacity - load));
                      const tColor = tripColor(colorFor(u.driver), ti);
                      const ts = routeTrips[u.key]?.[ti];
                      const doneN = batch.filter((d) => d.stage === "delivered").length;
                      // A stop with no pallet figure adds 0 to the total, so
                      // the load looks lighter than it is — say so rather than
                      // let a truck get planned on an undercount.
                      const noCount = batch.filter((d) => d.actual_pallets == null && d.est_pallets == null).length;
                      const estimated = batch.some((d) => d.actual_pallets == null && d.est_pallets != null);
                      return (
                        <Fragment key={ti}>
                          <tr>
                            <td colSpan={columnasDeParadas} style={{ background: "var(--card-hover)", fontWeight: 700, fontSize: 12 }}>
                              <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: tColor, marginRight: 7, verticalAlign: "-1px", boxShadow: "0 0 0 1px var(--line)" }} />
                              🚚 {t("Truckload", "Viaje")} {ti + 1} — {estimated ? "~" : ""}{load}/{capacity} {t("pallets", "pallets")}
                              {noCount > 0 && (
                                <span style={{ color: "var(--amber)", marginLeft: 6, fontWeight: 600 }}
                                  title={t("These stops have no pallet count, so the load total is lower than reality.", "Estas paradas no tienen conteo de pallets, así que el total del viaje es menor que la realidad.")}>
                                  ⚠ {noCount} {t("without a count", "sin conteo")}
                                </span>
                              )}
                              {/* Capacity bar: fills with the load, turns red when over. */}
                              <span title={`${load}/${capacity}`} style={{ display: "inline-block", width: 84, height: 7, borderRadius: 999, background: "var(--line)", verticalAlign: "middle", margin: "0 8px", overflow: "hidden" }}>
                                <span style={{ display: "block", height: "100%", width: `${Math.min(100, capacity > 0 ? (load / capacity) * 100 : 0)}%`, background: load > capacity ? "var(--red)" : tColor }} />
                              </span>
                              · {t("loads at pickup ↺", "carga en recolección ↺")}
                              {free > 0 && <span style={{ color: "var(--green)", marginLeft: 6 }}>({free} {t("free", "libres")})</span>}
                              {load > capacity && <span style={{ color: "var(--red)", marginLeft: 6 }}>⚠ {t("over capacity", "sobre capacidad")}</span>}
                              {/* What THIS load costs: the drive plus the time
                                  the truck stands still being unloaded, which
                                  each order already carries as its duration. */}
                              {ts && (
                                <span
                                  style={{ marginLeft: 8, fontWeight: 600, color: "var(--ink-soft)" }}
                                  title={t(
                                    `${ts.miles} mi · ${fmtMinutes(ts.driveMin)} driving + ${fmtMinutes(ts.serviceMin)} unloading at ${ts.stops} stops`,
                                    `${ts.miles} mi · ${fmtMinutes(ts.driveMin)} manejando + ${fmtMinutes(ts.serviceMin)} descargando en ${ts.stops} paradas`,
                                  )}
                                >
                                  ⇥ {ts.miles} mi · ⏱ {fmtMinutes(ts.totalMin)}
                                  <span style={{ fontWeight: 400, color: "var(--gray)" }}>
                                    {" "}({fmtMinutes(ts.driveMin)} {t("drive", "manejo")} + {fmtMinutes(ts.serviceMin)} {t("unload", "descarga")}) · {ts.start}–{ts.end}
                                  </span>
                                </span>
                              )}
                              {/* Progress fills in as stops get delivered. */}
                              {doneN > 0 && (
                                <span className="sema" style={{ marginLeft: 8, background: doneN === batch.length ? "var(--green)" : "var(--green-soft)", color: doneN === batch.length ? "#fff" : "var(--green)" }}>
                                  {doneN === batch.length ? `✓ ${t("load delivered", "viaje entregado")}` : `${doneN}/${batch.length} ${t("delivered", "entregadas")}`}
                                </span>
                              )}
                              {/* Reorder whole truckloads — which load goes out first. */}
                              {trips.length > 1 && (
                                <span style={{ float: "right", display: "inline-flex", gap: 3 }}>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }}
                                    disabled={ti === 0} onClick={() => moveTrip(u.key, ti, -1)}
                                    title={t("Move this truckload earlier", "Adelantar este viaje")}>↑</button>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }}
                                    disabled={ti === trips.length - 1} onClick={() => moveTrip(u.key, ti, 1)}
                                    title={t("Move this truckload later", "Retrasar este viaje")}>↓</button>
                                </span>
                              )}
                            </td>
                          </tr>
                          {/* Las filas que INFORMAN (recogidas, u otra carga de una orden repartida) van justo ANTES de la entrega
                              a la que preceden —donde el plan las puso—, no todas en cabeza del viaje (`filasDelViaje`).
                              No llevan flechas: en una ruta manual solo se decide el orden de las entregas. */}
                          {sequenced && ti === 0 && lectura.cambioTrasPublicar && (
                            <tr><td colSpan={columnasDeParadas} className="hint" style={{ color: "var(--amber-text)" }}>⚠ {t("This route changed after the plan was published: the P/D labels were recalculated.", "Esta ruta cambió desde que se publicó el plan: las etiquetas P/D se recalcularon.")}</td></tr>
                          )}
                          {filasDelViaje(lecturaParaLasFilas(lectura, sequenced, provisional), batch, ti === trips.length - 1).map((f) => {
                            if (f.clase === "informa") { const p = f.fila; return (
                            <tr key={`${p.tipo}-${ti}-${p.etiquetas[0]}`}>
                              <td className={provisional ? "etiqueta-provisional" : undefined} style={{ borderLeft: `4px solid ${tColor}`, fontWeight: 700 }}>{p.etiquetas.join("·")}</td>
                              <td colSpan={columnasDeParadas - 1}>
                                {p.tipo === "P" ? t("Pick up at", "Recoger en") : t("Deliver another load of", "Entregar otra carga de")} {p.tipo === "P" && <b>{p.lugar ?? t("(no store on the order)", "(la orden no dice la tienda)")}</b>}
                                {" — "}{p.ordenes.map((id) => nombraLaOrden(deliveries, id, lang === "es")).join(" · ")}
                                <span className="hint" style={{ margin: 0 }}> · {p.sinConteo ? "~" : ""}{p.aBordo} {t("pallets on board", "pallets a bordo")}</span>
                              </td>
                            </tr>
                          ); }
                            const d = f.orden, bi = f.indice;
                            const i = startIdx + bi;
                            // Flag a stop whose measured ETA lands after its window closes.
                            const eta = routeEtas[u.key]?.[d.id];
                            const win = parseWindow(d.delivery_windows);
                            const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
                            const late = etaMin != null && win != null && etaMin > win[1];
                            // Stops are reordered with the ↑/↓ arrows only —
                            // row dragging was removed on request.
                            //
                            // Three levels of detail, by where you tap:
                            //   the invoice → open the order itself (the ID until D-408)
                            //   the row  → isolate this stop on the map, with its route
                            //   outside  → back to the driver's whole day
                            const isolated = selectedOrders.has(d.id) && selectedOrders.size === 1;
                            return (
                              <tr
                                key={d.id}
                                // Delivered stops tint green, so the route
                                // visibly fills in over the day. Isolating a
                                // stop still wins — that's a deliberate pick.
                                className={`clickable${d.stage === "delivered" && !isolated ? " row-done" : ""}`}
                                style={isolated ? { background: "var(--accent-soft)" } : recienMovida === d.id ? { background: "var(--amber-soft)", outline: "2px solid var(--amber)", outlineOffset: -2 } : undefined}
                                data-recien-movida={recienMovida === d.id ? "" : undefined}
                                // Stop here: without this the click also reaches
                                // the card's "tap outside" handler, which sees a
                                // selection already set and clears it — so moving
                                // from one stop to the next took two clicks.
                                onClick={(e) => { e.stopPropagation(); setSelectedOrders(isolated ? new Set() : new Set([d.id])); }}
                                title={t("Show this stop on the map", "Ver esta parada en el mapa")}
                              >
                                {(() => {
                                  const e = etiquetaDeLaParada(d, dDe, i + 1, provisional);
                                  return (
                                    <td className={e.provisional ? "etiqueta-provisional" : undefined} style={{ borderLeft: `4px solid ${tColor}`, fontWeight: 700 }}
                                      title={e.provisional ? t("Provisional: follows the current order, none saved yet", "Provisional: sigue el orden de ahora, aún sin orden guardado") : undefined}
                                    >{e.texto}</td>
                                  );
                                })()}
                                {/* Solo la factura, subrayada: abre la orden (D-408). Antes (D-379) el código de la orden iba
                                    arriba, subrayado, y la factura debajo en pequeño; el código era lo que se pulsaba. */}
                                <td className="ordno">{enlaceALaOrden(d)}</td>
                                {/* Cada celda por su CLAVE, en el orden de la persona (D-410). Las cinco de siempre se pintan
                                    a su manera; las que vienen de Órdenes (D-376), con la celda de Órdenes. */}
                                {colsParadas.map((c) => {
                                  switch (c.key) {
                                    case "p_type": return <td key={c.key} title={d.order_type || undefined}>{d.order_type || "—"}</td>;
                                    // Where the truckload's pallet total comes from. An estimate is marked so nobody
                                    // plans capacity on a guess thinking it's counted.
                                    case "p_pallets": return (
                                      <td key={c.key} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                        {d.actual_pallets != null ? (
                                          <b title={t("Counted", "Contado")}>{d.actual_pallets}</b>
                                        ) : d.est_pallets != null ? (
                                          <span style={{ color: "var(--gray)" }} title={t("Estimate — not counted yet", "Estimado — aún sin contar")}>~{d.est_pallets}</span>
                                        ) : (
                                          <span style={{ color: "var(--amber)" }} title={t("No pallet count — this stop adds nothing to the load total", "Sin conteo de pallets — esta parada no suma al total del viaje")}>—</span>
                                        )}
                                      </td>
                                    );
                                    case "p_address": return <td key={c.key} title={d.delivery_address || undefined}>{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || "—"}</td>;
                                    case "p_eta": return (
                                      <td key={c.key} style={{ fontWeight: 600, color: late ? "var(--red)" : undefined }} title={late ? t("ETA is after the delivery window", "La llegada es después de la ventana") : undefined}>
                                        {eta ?? "—"}{late ? " ⚠️" : ""}
                                      </td>
                                    );
                                    case "p_windows": return <td key={c.key}>{fmtWindows(d.delivery_windows)}</td>;
                                    default: return <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, d)}</td>;
                                  }
                                })}
                                {/* Reordering and moving loads are edits, not
                                    "show me this" — they must not also hijack
                                    the map to this one stop. */}
                                <td onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 3, justifyContent: "flex-end", alignItems: "center", overflow: "visible" }}>
                                  {/* Hand-arrange the stops — works even before the route has a saved order. */}
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} disabled={i === 0} onClick={() => move(u.key, i, -1)} title={t("Move up", "Subir")}>↑</button>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} disabled={i === stops.length - 1} onClick={() => move(u.key, i, 1)} title={t("Move down", "Bajar")}>↓</button>
                                  {/* Move this stop to another truckload/pickup of the same driver. */}
                                  <select
                                    // Show the truckload this stop is ACTUALLY in (ti+1 = the
                                    // section it's rendered under), not its raw load_no — which
                                    // stays 1 for all when the split is auto (by capacity).
                                    value={ti + 1}
                                    title={t("Move to another truckload", "Mover a otro viaje")}
                                    onChange={(e) => { const v = e.target.value; moveStopToLoad(d, v === "__new__" ? trips.length + 1 : Number(v)); }}
                                    style={{ width: "auto", padding: "2px 4px", fontSize: 12 }}
                                  >
                                    {/* Los viajes que se PINTAN (D-433): antes salían tantos como el `load_no` más alto, y con
                                        números saltados («1» y «3») se ofrecía un «Viaje 2» que no era ninguno. El que no
                                        cabe lo dice ya en la lista; elegirlo no mueve nada y explica por qué. */}
                                    {Array.from({ length: trips.length }, (_, k) => k + 1).map((n) => (
                                      <option key={n} value={n}>{t("Truckload", "Viaje")} {n}{n !== ti + 1 && !cabeEnElViaje(trips, d.id, n, capacity).cabe ? t(" — won't fit", " — no cabe") : ""}</option>
                                    ))}
                                    <option value="__new__">＋ {t("New truckload", "Nuevo viaje")}</option>
                                  </select>
                                  <button className="btn btn-danger btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} onClick={() => unassign(d.id)} title={t("Unassign", "Quitar asignación")}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
            </>}
          </div>
        );
      })}
      </div>
      )}

      {!ready && <div className="empty">{t("Loading…", "Cargando…")}</div>}

      {openOrder && <OrderModal me={me} existing={openOrder} startEditing={false} onClose={() => setOpenOrder(null)} />}
    </>
  );
}

/** Delivery date cell: plain text for an order due on the day being viewed;
 * an editable date input (with a "Late" flag) for one carried forward from
 * a past date that was never delivered — the one field logistics can change
 * here, and only here. Leaving it alone still dispatches it today. */
function DateCell({
  d, date, onChange, t,
}: {
  d: Delivery;
  date: string;
  onChange: (id: string, delivery_date: string) => void;
  t: (en: string, es: string) => string;
}) {
  // «Atrasada» lo decide la orden, no el día que se mira (D-354). Antes solo salía cuando la fecha de la orden no
  // era la del selector: mirando AYER, una orden de ayer sin entregar salía como una fecha cualquiera. El dueño, con
  // captura: «estas son de ayer y no están delivered y no me sale el cuadro de que están late».
  const vencida = isOverdue(d);
  if (d.delivery_date === date && !vencida) return <>{fmtDate(d.delivery_date)}</>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {vencida && <span className="sema" style={{ background: "var(--red)", color: "#fff" }}>{t("Late", "Expirada")}</span>}
      <input
        type="date"
        value={d.delivery_date ?? ""}
        onChange={(e) => e.target.value && onChange(d.id, e.target.value)}
        style={{ width: "auto" }}
      />
    </div>
  );
}

// ============================================================
// Driver incident log — the logistics manager records something a driver did
// that cost the company money (a wasted round trip, damage, inefficiency from a
// bad attitude). Each entry has a driver, date, description, and estimated cost,
// and can optionally be tied to a specific order. Only reachable from the Routes
// Manager (logistics/admin), so it's gated by the page's own role access.
// ============================================================
function DriverIncidents({
  me, drivers, deliveries, incidents, addIncident, removeIncident, confirmAction, notify, t, enVentana = false,
}: {
  /** Dentro de la ventana de «⚠ Incidencias» (D-NEXT): sin su tarjeta ni su título, que pone la ventana. */
  enVentana?: boolean;
  me: Profile;
  drivers: Profile[];
  deliveries: Delivery[];
  incidents: DriverIncident[];
  addIncident: (inc: Omit<DriverIncident, "id" | "created_at" | "created_by">) => Promise<boolean>;
  removeIncident: (id: string) => Promise<void>;
  confirmAction: (message: string, opts?: { danger?: boolean; confirmLabel?: string }) => Promise<boolean>;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const [driver, setDriver] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);

  // Orders you can attach an incident to: the chosen driver's, most recent first.
  const attachable = useMemo(
    () => deliveries
      .filter((d) => !driver || d.assigned_driver === driver)
      .sort((a, b) => (b.delivery_date ?? "").localeCompare(a.delivery_date ?? ""))
      .slice(0, 60),
    [deliveries, driver],
  );

  const submit = async () => {
    if (!driver) { notify(t("Choose a driver.", "Elija un chofer.")); return; }
    if (!description.trim()) { notify(t("Describe what happened.", "Describa lo que pasó.")); return; }
    setBusy(true);
    const ok = await addIncident({
      driver_name: driver,
      delivery_id: orderId || null,
      incident_date: date || todayISO(),
      description: description.trim(),
      cost: Math.max(0, Number(cost) || 0),
    });
    setBusy(false);
    if (ok) {
      notify(t("Incident recorded", "Incidencia registrada"));
      setDescription(""); setCost(""); setOrderId("");
    }
  };

  const del = async (inc: DriverIncident) => {
    const ok = await confirmAction(
      t(`Delete this incident for ${inc.driver_name}?`, `¿Eliminar esta incidencia de ${inc.driver_name}?`),
      { danger: true, confirmLabel: t("Delete", "Eliminar") },
    );
    if (ok) await removeIncident(inc.id);
  };

  // Total logged cost per driver, for a quick at-a-glance tally.
  const totals = useMemo(() => {
    // El coste es dinero: se junta lo de cada chofer y el total sale de `sumaDinero` (D-363).
    const m = new Map<string, { count: number; suyos: typeof incidents }>();
    for (const inc of incidents) {
      const cur = m.get(inc.driver_name) ?? { count: 0, suyos: [] as typeof incidents };
      cur.count += 1; cur.suyos.push(inc);
      m.set(inc.driver_name, cur);
    }
    return [...m.entries()]
      .map(([name, v]) => [name, { count: v.count, cost: sumaDinero(v.suyos, (i) => Number(i.cost)) }] as const)
      .sort((a, b) => b[1].cost - a[1].cost);
  }, [incidents]);

  const grandTotal = sumaDinero(incidents, (i) => Number(i.cost));
  const codeFor = (id: string | null) => {
    if (!id) return null;
    const d = deliveries.find((x) => x.id === id);
    return d ? orderLabel(d) : null;
  };

  return (
    <div className={enVentana ? undefined : "card"} style={{ margin: 0 }}>
      {!enVentana && <h3 style={{ marginTop: 0 }}>⚠ {t("Driver incidents", "Incidencias de choferes")}</h3>}
      <p className="hint" style={{ marginTop: 0 }}>
        {t(
          "Log anything a driver did that cost the company money — a wasted round trip, damage, or lost time. Used to review performance; only the logistics manager and admins see this.",
          "Registre cualquier cosa que un chofer haya hecho que le costó dinero a la empresa — un viaje repetido, daños o tiempo perdido. Se usa para evaluar el desempeño; solo lo ven el gerente de logística y administradores.",
        )}
      </p>

      {/* ---- New incident ---- */}
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field">
          <label>{t("Driver", "Chofer")}</label>
          <select value={driver} onChange={(e) => { setDriver(e.target.value); setOrderId(""); }}>
            <option value="">{t("Choose…", "Elegir…")}</option>
            {drivers.map((d) => <option key={d.id} value={d.full_name}>{d.full_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t("Date", "Fecha")}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>{t("What happened", "Qué pasó")}</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("e.g. Left to a delivery before planning the day and had to drive back to the same area for the next stop.", "ej. Salió a una entrega sin planear el día y tuvo que regresar a la misma zona para la siguiente parada.")}
        />
      </div>
      <div className="grid g2" style={{ gap: 10 }}>
        <div className="field">
          <label>{t("Estimated cost ($)", "Costo estimado ($)")}</label>
          <input type="number" min={0} step="1" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
        </div>
        <div className="field">
          <label>{t("Related order (optional)", "Orden relacionada (opcional)")}</label>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">{t("None", "Ninguna")}</option>
            {attachable.map((d) => (
              <option key={d.id} value={d.id}>#{orderLabel(d)} · {d.account || "—"}{d.delivery_date ? ` · ${fmtDate(d.delivery_date)}` : ""}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "…" : t("Record incident", "Registrar incidencia")}</button>
      </div>

      {/* ---- Per-driver tally ---- */}
      {totals.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="section-label" style={{ marginTop: 0 }}>{t("Cost by driver", "Costo por chofer")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {totals.map(([name, v]) => (
              <span key={name} className="sema" style={{ background: "var(--red-chip-bg)", color: "var(--red-chip-text)", border: "1px solid var(--red-chip-line)" }}>
                {name}: {fmtMoney(v.cost)} · {v.count}
              </span>
            ))}
            <span className="sema" style={{ background: "#3a2a00", color: "#ffd98a" }}>{t("Total", "Total")}: {fmtMoney(grandTotal)}</span>
          </div>
        </div>
      )}

      {/* ---- Log ---- */}
      <div style={{ marginTop: 18 }}>
        <div className="section-label" style={{ marginTop: 0 }}>{t("Log", "Registro")} ({incidents.length})</div>
        {incidents.length === 0 ? (
          <div className="hint">{t("No incidents recorded.", "Sin incidencias registradas.")}</div>
        ) : (
          <div className="tbl-scroll">
            <table className="orders">
              <thead>
                <tr>
                  <th>{t("Date", "Fecha")}</th>
                  <th>{t("Driver", "Chofer")}</th>
                  <th>{t("What happened", "Qué pasó")}</th>
                  <th>{t("Order", "Orden")}</th>
                  <th style={{ textAlign: "right" }}>{t("Cost", "Costo")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr key={inc.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(inc.incident_date)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{inc.driver_name}</td>
                    <td>{inc.description}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{codeFor(inc.delivery_id) ? `#${codeFor(inc.delivery_id)}` : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{fmtMoney(Number(inc.cost) || 0)}</td>
                    <td style={{ textAlign: "right" }}>
                      {(me.role === "admin" || inc.created_by === me.id) && (
                        <button className="btn btn-sm btn-ghost" onClick={() => del(inc)} title={t("Delete", "Eliminar")}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
