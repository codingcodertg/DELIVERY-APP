"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { useSoloLectura } from "@/lib/gestor/solo-lectura";
import { PlanDelDia } from "@/components/PlanDelDia";
import { choferesEnVivo, etiquetaEnVivo } from "@/lib/choferes-en-vivo";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canPlanRoutes } from "@/lib/constants";
import { parseWindow, unavailableDriverNames } from "@/lib/dispatch";
import { MapView, type MapLine, type MapPoint } from "@/components/MapView";
import { OrderModal } from "@/components/OrderModalLazy";
import { DispatchBoard, type BoardColumn } from "@/components/DispatchBoard";
import { GanttTimeline, type GanttRow } from "@/components/GanttTimeline";
import { printRouteManifest } from "@/lib/manifest";
import { fallbackDriverColor, fmtDate, fmtMoney, fmtWindows, isOverdue, orderLabel, retentionFloorISO, seesAllHistory, shiftDateISO, todayISO } from "@/lib/utils";
import { MapLegend } from "@/components/MapLegend";
import { colorDeChofer, leyendaDelMapa } from "@/lib/map-legend";
import { useRutasDelDia } from "@/lib/usa-rutas-del-dia";
import { rangoDeRutasDelDia } from "@/lib/rutas-del-dia";
import { ordenesDeRutaDeHoy, ordenLegible } from "@/lib/gestor/ordenes-de-ruta-de-hoy";
import { guardaMarcados, leeMarcados, marcadosVigentes, pasaElFiltro, soloAlgunos, unicoMarcado } from "@/lib/gestor/filtro-de-choferes";
import { rutasConOrdenes } from "@/lib/gestor/rutas-visibles";
import { esTiendaRtg } from "@/lib/gestor/recogida-en-tienda";
import { alternaDesplegada, claseDeTarjeta, conAcciones, conCabecera, conCuerpo, desplegadaVigente, type ModoDeTarjeta } from "@/lib/gestor/cuadricula";
import { serviceMin } from "@/lib/trip-timing";
import { pintaElTrazoDelPlan, textoDeLaLlegada, type MotivoSinLlegada } from "@/lib/medida-de-ruta";
import { DAY_START_MIN, useMedidaDeRutas } from "@/lib/usa-medida-de-rutas";
import { carrilesDelDia, cargaDelPanel, encuadreDeLasRutas, lineasDeLasRutas, puntosDeLasRutas, rutaDeLaLinea, rutasPorChofer, type CarrilDeRuta } from "@/lib/mapa-de-rutas";
import { PanelDeChoferes } from "@/components/PanelDeChoferes";
import { optimizaLaLista } from "@/lib/optimiza-la-ruta";
import { avisoDeOptimizar, entradaDeOptimizar, puntosDeLaEntrada, tiemposDeLaRuta, tiendaBaseDelChofer, type TiemposPedidos } from "@/lib/optimizar-desde-el-gestor";
import { esVentanaDura } from "@/lib/route-settings";
import { useBasesDeChofer } from "@/lib/usa-bases";
import { useAjustesDeChofer } from "@/lib/usa-ajustes-de-chofer";
import { entradaDelDia } from "@/lib/route-plan/entrada";
import { entradaDelReparto, reparteEntre, type Reparto } from "@/lib/route-engine";
import { ajustesConBaseDelPerfil, choferesParaRepartir, etiquetaDelReparto, listaDeLasParadas, matrizDelGestor, movimientosDelReparto, paradasDeLaLista, puntosDelReparto, resumenDelReparto, textoDeNoRepartir } from "@/lib/reparto-desde-el-gestor";
import type { Foto } from "@/lib/arrastre-de-paradas";
import { driverOf, orderLaneKey as orderLaneKeyPure, planMerge } from "@/lib/route-lanes";
import { COLUMN_WIDTHS, anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { liveDriverNames, trackingGaps } from "@/lib/tracking-health";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { cuentasSinAsignar, filasSinAsignar, ordenesDelDia, pendientesDeOtrosDias, sinAsignarDelGestor, type ChipSinAsignar, type ModoDelGestor } from "@/lib/ordenes-del-dia";
import { cuentasDeTodas, filasDeTodas, todasDelGestor } from "@/lib/todas-del-gestor";
import { eleccionVigente, opcionesDeConductor } from "@/lib/elige-conductor";
import { PANEL_DE_TODAS, PANEL_SIN_ASIGNAR, estaPlegada } from "@/lib/vista-del-gestor";
import { esProvisional, esProvisionalLaFila, type FilaDeLaRuta, type LecturaDeRuta } from "@/lib/route-plan/lectura-de-ruta";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { puntosDelTrazoPublicado } from "@/lib/route-plan/trazo-del-plan";
import { usePlanPublicadoDelGestor } from "@/lib/route-plan/usePlanPublicado";
import { facturaYId, nombraLaOrden } from "@/lib/route-plan/etiqueta";
import {
  COLUMNAS_DEL_GESTOR_POR_DEFECTO, LLAVE_DE_ANCHOS_DE_PARADAS, alternaColumna, anchoDePartida, anchoDePartidaDeParada, claveDelOrdenEnElNavegador,
  columnaDeOrdenes, columnasDeLaTabla, columnasDePlantillaDelGestor, columnasDelSelector, columnasDelSelectorDeTodas, columnasDeTodas, preferenciasDelGestorAlLeer, fotoDePlantillaDelGestor,
  mueveEnElGestor, ordenDePlantillaDelGestor, ordenDelGestorEnElNavegador, restableceOrdenDelGestor, seMueveEnElGestor, siembraAnchosDeParadas,
  seVeEnLaRecogida, sinLaFacturaDelPlan, tieneOrdenPropio, type ColumnaDelGestor, type TablaDelGestor,
} from "@/lib/routes-columns";
import { borraPlantilla, claveDePlantillasEnElNavegador, guardaPlantilla, persistePlantillas, plantillasDelNavegador, textoDelRechazo } from "@/lib/plantillas-de-columnas";
import { ORDER_COLUMNS } from "@/components/OrdersTable";
import { idsRecibidasPorAlmacen } from "@/lib/recibir";
import { marcasDeParadas } from "@/lib/acciones-parada";
import { motivosDeAnulacion } from "@/lib/cancel-reasons";
import { CLAVE_DE_COLUMNAS_DEL_GESTOR, guardaColumnas, leeColumnas, valorDeColumnas, type ClienteDePrefs, type ColumnasPorRol, type PlantillaDeColumnas } from "@/lib/user-prefs";
import { createClient } from "@/lib/supabase/client";
import { useOrdenYFiltro, type OrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { etiquetaDelGestor, textoQueAbreLaOrden, valorDelGestor } from "@/lib/valores-del-gestor";
import { ciudadDeEntrega, ciudadesConocidas } from "@/lib/ciudad-de-entrega";
import { AVISO_SOLO_CIUDAD, ordenSoloCiudad } from "@/lib/solo-ciudad";
import { AvisoSoloCiudad } from "@/components/AvisoSoloCiudad";
import { celdaPropiaDelPlan, claseDeLaFilaDelPlan } from "@/lib/route-plan/celdas-del-plan";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
import type { Delivery, DriverIncident, Profile } from "@/lib/types";
import { abanicoDeMarcas } from "@/lib/abanico-de-marcas";
import { palletsDeLaOrden, sumaPallets } from "@/lib/pallets";
import { sumaDinero } from "@/lib/totales";
import { altoMaximoDeCaja } from "@/lib/barra-superior";
import { BarraSuperior, useCajasPorClave } from "@/components/BarraSuperior";
import { CerrarAviso } from "@/components/CerrarAviso";
import { avisoDelHueco, escrituraDelHueco, mejorLugar, separaPorRequisitos, type ParadaDeRuta } from "@/lib/mejor-lugar";
import {
  anota, barrasDeLaRuta, botonDeVolver, choquesAlVolver, descartaElDeArriba, escriturasHacia, fotoDe, fotoDeFilas, fotoTrasReordenar,
  HISTORIAL_VACIO, objetivoDe, planDeSoltar, porQueNoSuelta, sellosDe, textoDeChoques, textoDePrevia, trasVolver,
  type Destino, type Direccion, type FilaFresca, type Historial, type ParadaDelGantt, type RutaDelGantt,
} from "@/lib/arrastre-de-paradas";
import { ETAPAS_HECHAS, hechasDelChofer, inicioDeLaSecuencia } from "@/lib/mover-parada";
import { filasConLoHecho, hechasQueSePintan, horaReal, resumenDeEntregas, type FilaPintada } from "@/lib/hechas-del-gestor";
import { textoDelEstadoDelPlan, type EstadoDelPlan } from "@/lib/route-plan/estado-del-plan";
import {
  cabeEnElPuesto, cambiosDeLaLista, cuentaDePallets, escrituraDeLaLista, gruposDeMismoLugar, listaConEntregasEn, listaConOrdenesEn, llevaEnLaLista, mueveEnLaLista, numeroDePallets,
  textoDeLaCuenta, textoDelExceso, tienePosicionDeRecogida, type FilaDeCuenta, type ParadaDeLaLista,
} from "@/lib/lista-unica";
import { alRepartir, cargaDe, etiquetaDeCarga, hermanasDe, laOtraCarga, restoPropuesto, sePuedenJuntar, sePuedePartir } from "@/lib/cargas-partidas";
import { useRequisitosDelCamion } from "@/lib/usa-requisitos";
import { useZonasDeChofer } from "@/lib/usa-zonas";
import { esDeSuZona, zonaDeLaRecogida } from "@/lib/zonas";
import { fraseDeFaltan } from "@/lib/requisitos";
import { CANDADOS_SIN_LEER, cargaCandados, dondeViveElCandado, estaBloqueada, pulsaCandado, quienBloqueo, type ClienteDeCandados, type EstadoDeCandados, type OpcionesDeCandados } from "@/lib/rutas-bloqueadas";
import { AVISOS_DEL_GESTOR, cierraAviso, guardaAvisosOcultos, leeAvisosOcultos, type AvisoDelGestor } from "@/lib/avisos-ocultos";

// ============================================================
// Logistics Manager tool: assign the day's approved-but-undelivered orders
// to a driver and arrange each driver's stops.
//
// Desde D-437 el orden AUTOMÁTICO de una ruta sale de un solo sitio: «🧭 Armar las rutas del día» (el motor: planifica
// en borrador, se ajusta y se publica). Aquí ya no hay «Optimizar ruta», «Optimizar todas las rutas», «✨ Auto-asignar»,
// «Reagrupar por zona» ni «Simular»: el dueño, 2026-09-28, «Quitar los dos; solo Armar rutas». A mano quedan asignar,
// «📍 Mejor lugar», las flechas, «Pasar a…» y el arrastre de «📅 Horario». La pantalla MIDE la ruta de un chofer elegido
// (millas, horas, trazo) en el orden guardado, sin reordenarla (`medida-de-ruta.ts`).
//
// D-456 (el dueño, 2026-10-01) trae de vuelta tres cosas que decisiones anteriores habían quitado, y una nueva:
//   · la FACTURA nombra la orden en todas las tablas, con el ID al lado (D-444 la había cambiado por el ID en las paradas);
//   · ARRASTRAR filas: una de «Sin asignar» a un chofer del panel (la asigna), y una parada dentro de su lista o a la de otro
//     chofer (la mueve). D-007 lo había quitado; las flechas se quedan;
//   · «🧭 Optimizar» en cada tarjeta: reordena SOLO esa ruta (`optimiza-la-ruta.ts`). D-437 lo había quitado;
//     desde D-461 busca el mejor orden POR CALLES y mirando las ventanas, saliendo de la base del chofer;
//   · la llegada estimada SIEMPRE: se miden todas las rutas con paradas, no solo las marcadas, y la celda dice por qué falta.
//
// SIN VIAJES desde D-443 (el dueño, 2026-09-28: «SI ELIMINA VIAJES»). La ruta de un chofer es UNA lista de paradas
// —recogidas (P) y entregas (D) intercaladas— y el camión puede recoger, entregar una parte, volver a recoger y seguir,
// siempre que no lleve más pallets de los que le caben. Qué lista sale de lo guardado, cómo se mueve una parada y la cuenta
// de pallets de cada una viven en `lib/lista-unica`; aquí solo se pinta y se escribe. Se fueron: «Viaje N» / «＋ Nuevo
// viaje» (D-433), «Dividir en 2» / «Unir viajes» (D-437), «Ver un viaje» (D-441), la cabecera y la raya de cada viaje, sus
// flechas, y sus colores.
//
// D-481 (el dueño, 2026-10-06, seis pedidos de un dictado):
//   · «Ruta de hoy» (/map) ES esta pantalla con `soloLectura`: las mismas tarjetas, tablas, mapa, Cuadrícula y Horario, y
//     ningún botón ni acción (nada se asigna, se mueve, se optimiza ni se vacía). Sus órdenes salen de `useRutasDelDia`
//     (D-467) y se completan con lo que la persona ya lee (`lib/gestor/ordenes-de-ruta-de-hoy`).
//   · El filtro de chofer son las CASILLAS del panel (`lib/gestor/filtro-de-choferes`): marcar uno enseña solo a ese. El
//     desplegable «Todos los choferes» (D-393/D-459) se fue.
//   · En «▦ Cuadrícula», las tarjetas compactas arriba y, al pulsar un nombre, su tabla desplegada abajo a tamaño normal;
//     los botones de acción solo en la desplegada (`lib/gestor/cuadricula`).
//   · Un chofer sin órdenes ese día no sale en el panel ni en las tarjetas (`lib/gestor/rutas-visibles`).
//   · El pin del mapa nombra la orden por su factura (`lib/gestor/nombre-en-el-mapa`), y una recogida en una tienda de RTG
//     no lleva burbuja «P1» (`lib/gestor/recogida-en-tienda`).
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
/** En solo lectura no se ubica ninguna dirección: nada se escribe desde «Ruta de hoy». */
const SIN_ORDENES: Delivery[] = [];

// El reloj del día (`DAY_START_MIN`), los tipos de la medida y `fmtMinutes`/`fmtClock` viven en `lib/usa-medida-de-rutas`
// desde D-467: la medida la comparten esta pantalla y «Ruta de hoy».

/** La celda «Llegada» cuando aún no hay hora (D-456): el motivo, pequeño y en gris, en dos renglones si hace falta. */
const ESTILO_SIN_LLEGADA = { color: "var(--gray)", fontSize: 11, whiteSpace: "normal", lineHeight: 1.15 } as const;

export default function RoutesPage() {
  // «Ruta de hoy» (/map) monta ESTA pantalla dentro de `SoloLectura` (D-481): sin botones ni acciones. Va por contexto y no
  // por prop porque Next no deja a una página declarar props propias.
  const soloLectura = useSoloLectura();
  const { me, users, deliveries: deliveriesLeidas, settings, saveSettings, updateDelivery, reorderStops, partirCarga, reparteCargas, juntarCargas, addNote, notify, availability, ready, incidents, addIncident, removeIncident, driverLocations, shifts, events, teaching, realRole } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [fechaElegida, setDate] = useState(todayISO());
  // «Ruta de hoy» (`soloLectura`, D-481) acota el día como lo acotaba su pantalla de antes (D-467/D-469): la ventana de
  // D-239 y el ±7 de la función `rutas_del_dia`. El Gestor no acota: ve cualquier fecha.
  const veTodoElHistorial = seesAllHistory(realRole, me?.permissions);
  const pisoFecha = retentionFloorISO();
  const rango = rangoDeRutasDelDia(todayISO());
  const primerDia = veTodoElHistorial || pisoFecha < rango.min ? rango.min : pisoFecha;
  const fecha = fechaElegida < primerDia ? primerDia : fechaElegida > rango.max ? rango.max : fechaElegida;
  const date = soloLectura ? fecha : fechaElegida;
  // Las paradas de «Ruta de hoy» (D-467, `useRutasDelDia`: con la 160, las rutas enteras de cualquier rol): solo en solo
  // lectura; el Gestor pinta lo que ya lee. Cada parada se completa con la orden entera si esta persona ya la tiene.
  const { paradas: paradasDeHoy, origen: origenDeHoy } = useRutasDelDia(date, soloLectura);
  const deliveries = useMemo(() => (soloLectura ? ordenesDeRutaDeHoy(paradasDeHoy, deliveriesLeidas) : deliveriesLeidas), [soloLectura, paradasDeHoy, deliveriesLeidas]);
  // Los camiones en vivo, para todos menos ventas (regla de «Ruta de hoy», D-467; al Gestor ventas no entra).
  const veCamiones = me?.role !== "sales";
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
  // «Todas» (D-462): las mismas que «Sin asignar» —elegidas, orden, plantillas y ⚙ compartidos— con el chofer delante y
  // la etapa siempre. Los anchos también son los mismos (`anchoEnSinAsignar`): son las mismas columnas.
  const colsTodas = columnasDeTodas(colsGestor, ordenGestor);
  // La tabla de paradas: el número de parada y la factura, fijos delante; las elegidas, en el orden de la persona (D-410;
  // hasta aquí, puestos fijos y las de Órdenes detrás, D-346/D-376); y las acciones, fijas al final.
  const colsParadas = columnasDeLaTabla("paradas", colsGestor, ordenGestor);
  // #, factura, la cuenta de pallets (D-443), las elegidas y las acciones.
  const columnasDeParadas = 4 + colsParadas.length;
  // Which drivers are highlighted on the map / focused in the tables. Empty
  // set = "no drivers selected" → everything shown at full strength (like
  // OptimoRoute). Selecting some highlights them and dims the rest.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Lo marcado ES el filtro (D-481, c). El dueño, 2026-10-06: «so when clickin the checkbox just show the driver dont show
  // any other drivers and the checkbox, remove the all driver dropdown». Hasta aquí había un desplegable «Todos los choferes»
  // (D-393/D-459) que escondía, y las casillas solo resaltaban. Ahora marcar un chofer enseña SOLO a ese (su fila, su
  // tarjeta, su ruta en el mapa); sin ninguno marcado se ven todos. Se recuerda por persona en este navegador, como aquel.
  const marcadosLeidos = useRef(false);
  useEffect(() => {
    if (!me?.id) return;
    setSelected(new Set(leeMarcados((k) => window.localStorage.getItem(k), me.id)));
    marcadosLeidos.current = true;
  }, [me?.id]);
  useEffect(() => {
    if (!me?.id || !marcadosLeidos.current) return;
    guardaMarcados(() => window.localStorage, me.id, selected);
  }, [selected, me?.id]);
  // «▦ Cuadrícula» (D-481, e): la ruta cuyo nombre se pulsó, desplegada abajo. `null`: ninguna.
  const [desplegada, setDesplegada] = useState<string | null>(null);
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
  // «🧭 Armar rutas» es UN botón, en la cabecera (D-459). El dueño, 2026-10-01: «el boton de build routes solo ahi dejalo
  // no quiero que siga aparecieron el otro dialog que se abrees inecesario». Hasta aquí había además una tarjeta plegada
  // («Armar las rutas del día automáticamente ▸ · Borrador v2», cerrable con ✕, D-400) que repetía el botón. Ahora el botón
  // abre y cierra el panel del plan, y lo que la tarjeta decía plegada —«Borrador vN», «Publicado vN», «N sin plan»— va en
  // una pastilla a su lado (`estadoPlan`, que le cuenta `PlanDelDia`).
  const [planAbierto, setPlanAbierto] = useState(false);
  const [estadoPlan, setEstadoPlan] = useState<EstadoDelPlan | null>(null);
  const muestraAvisosOcultos = () => {
    setAvisosOcultos(new Set());
    if (me?.id) guardaAvisosOcultos(() => window.localStorage, me.id, new Set());
  };
  // Sin «scheduled» desde D-376: la pestaña «Programadas» repetía, en una lista, las órdenes que ya salen en la ruta de
  // su chofer. El dueño: «en gestor de rutas el view programados es innecesario, quítalo».
  // «Incidencias» ya no es pestaña (D-437): el dueño, «incidencias que sea un boton». Es un botón junto a las pestañas que
  // abre una ventana sobre el Gestor. La pestaña no se guardaba en ningún sitio: no hay preferencia vieja que recoger.
  // «Todas» (D-462): todas las órdenes del día, con chofer o sin él, en una tabla. El dueño, 2026-10-02: «agrega el tab
  // donde se mire la lista de todas las ordenes para ese dia asignanada o no que ahi esten».
  const [tab, setTab] = useState<"routes" | "orders" | "todas" | "board" | "timeline">("routes");
  const [incidenciasAbiertas, setIncidenciasAbiertas] = useState(false);
  useEffect(() => {
    if (!incidenciasAbiertas) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setIncidenciasAbiertas(false); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [incidenciasAbiertas]);
  // La medida de cada ruta (millas, horas, trazo, llegadas) y las bases ya buscadas: `useMedidaDeRutas`, más abajo (D-467).
  // Asignando desde el recuadro («Asignar», «📍 Mejor lugar», «Nueva ruta»): sus botones se apagan mientras tanto.
  const [asignando, setAsignando] = useState(false);
  // Multi-select + search + saved filter for the unassigned pool.
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  // Lo marcado con la casilla en las TARJETAS de ruta (D-474, «Asignar a…» varios choferes). Aparte de `selectedOrders`
  // a propósito: en la tarjeta, pulsar una fila aísla ESA parada en el mapa (una sola), y pulsar fuera lo quita; una marca
  // para repartir tiene que sobrevivir a eso. Lo que se reparte es la unión de las dos (`seleccionDelReparto`).
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [elegidosDelReparto, setElegidosDelReparto] = useState<Set<string>>(new Set());
  const [repartoAbierto, setRepartoAbierto] = useState(false);
  const [repartiendo, setRepartiendo] = useState(false);
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
  // Lo mismo para la pestaña «Todas» (D-462): su buscador y su chip, aparte de los de «Sin asignar».
  const [busquedaDeTodas, setBusquedaDeTodas] = useState("");
  const [chipDeTodas, setChipDeTodas] = useState<ChipSinAsignar>("dia");
  // Cached pickup→dropoff geometry for selected unassigned loads (drawn on the map).
  const [selRouteCache, setSelRouteCache] = useState<Record<string, [number, number][]>>({});
  // Geocoded pickup coords per selected load — lets us show a pickup "P" pin and
  // a straight PU→DEL line immediately, before (or if) the road geometry loads.
  const [selPickup, setSelPickup] = useState<Record<string, [number, number]>>({});
  const [err, setErr] = useState<string | null>(null);
  // Las cajas de «Sin asignar» y de las paradas de cada chofer, que mueve también su barra de arriba (D-398).
  // Las de paradas van una por chofer (se pintan dentro del `.map`), por eso van por clave.
  const cajaSinAsignarRef = useRef<HTMLDivElement>(null);
  const cajaDeTodasRef = useRef<HTMLDivElement>(null);
  const cajaDeParadas = useCajasPorClave();
  // El mapa y los choferes son `sticky` arriba; una caja de alto normal quedaría con su cabecera debajo de
  // ellos. Se mide el panel y las cajas se acortan a lo que queda libre (`altoMaximoDeCaja`).
  const panelFijoRef = useRef<HTMLDivElement>(null);
  const [altoPanelFijo, setAltoPanelFijo] = useState(0);
  useEffect(() => {
    const el = panelFijoRef.current;
    if (!showTop || !el) { setAltoPanelFijo(0); return; }
    // Solo fijo en pantalla ancha (D-481, `.panel-fijo-del-gestor`): en el teléfono el panel y el mapa miden más que la
    // pantalla, y fijos tapaban todo lo de abajo. Sin fijar, las cajas no tienen que dejarle sitio.
    const mide = () => setAltoPanelFijo(getComputedStyle(el).position === "sticky" ? Math.round(el.getBoundingClientRect().height) : 0);
    mide();
    const ro = new ResizeObserver(mide);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTop]);
  const estiloDeCaja = { border: "none", maxHeight: altoMaximoDeCaja(altoPanelFijo) } as const;
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

  // A newly-viewed date invalidates any measured summary/trace from before (that part lives in `useMedidaDeRutas`).
  useEffect(() => { setErr(null); }, [date]);

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
    if (!rutasPublicadas || soloLectura) return;
    for (const chofer of selected) {
      if (trazosDelPlan[chofer] !== undefined) continue;
      const paradas = paradasPublicadasDe(chofer);
      // Ni se pide (Google cuesta) si ya no hay nada que pintar: sin pendientes, o la ruta ya no es la publicada (D-437).
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
  // Lo ya HECHO de cada chofer ese día —recogido o entregado— SIGUE en su lista (D-459). El dueño, 2026-10-01: «right now
  // when the order gets delivered it desapears frm the logistic manager view so don't do that». Hasta aquí solo se pintaba
  // lo pendiente (`ROUTE_STAGES`) y lo hecho contaba para comparar con el plan y para numerar, sin verse (D-433). Se pinta
  // viendo UN día; `dayOrders`, `byDriver` y todo lo que mueve o mide la ruta siguen siendo solo lo pendiente.
  const hechasPintadas = useMemo(() => hechasQueSePintan(deliveries, date, modo), [deliveries, date, modo]);
  const hechasDe = (laneKey: string): Delivery[] => hechasPintadas.get(laneKey) ?? [];

  // Lo único que logística cambia en una orden atrasada o sin fecha: ponerle su día. Entonces pasa a ESE día.
  // The one thing logistics can change on a carried-forward order: push its
  // delivery date up to today, or leave it — either way it's on this list.
  const reschedule = (id: string, delivery_date: string) => updateDelivery(id, { delivery_date });

  const geocoding = useAutoGeocode(soloLectura ? SIN_ORDENES : dayOrders, updateDelivery);
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
    () => (veCamiones ? liveDriverNames(users, shifts, driverLocations) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, driverLocations, healthTick, veCamiones],
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
    if (!veCamiones) return [];
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    // Misma regla que el mapa de despacho y que la ruta del día de Almacén (D-289). El color se
    // pasa como estaba aquí: esta pantalla no usa `colorDeChofer`.
    const color = (n: string) => settings.driver_colors?.[n] || fallbackDriverColor(n);
    return choferesEnVivo(driverLocations, nameById, color).map((c) => ({ ...c, label: etiquetaEnVivo(c, t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocations, users, settings.driver_colors, veCamiones]);

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

  type Lane = CarrilDeRuta;
  // Lanes = each real driver's load(s) + each bucket, used everywhere we DISPLAY or build routes. One lane / card per
  // driver and per temp driver, plus (safety net) any assigned group that matches neither, plus whoever already
  // delivered everything (D-459). La regla vive en `carrilesDelDia` (lib/mapa-de-rutas), que comparte «Ruta de hoy».
  const lanes = useMemo<Lane[]>(
    () => carrilesDelDia(drivers, bucketNames, dayOrders, hechasPintadas.keys()),
    [drivers, dayOrders, bucketNames, hechasPintadas],
  );
  // El filtro de chofer que manda ahora (D-481): lo marcado en el panel, si esas rutas siguen en la pantalla; vacío = todos.
  const filtroChofer = useMemo(() => marcadosVigentes(selected, lanes.map((l) => l.key)), [selected, lanes]);
  const pasaFiltro = (ruta: string | null | undefined) => pasaElFiltro(filtroChofer, ruta);
  const lanesDelFiltro = lanes.filter((l) => pasaFiltro(l.key));

  // Desde qué puesto se numera la ruta de un chofer al moverla a mano: tras lo que ya recogió o entregó en esas fechas, que
  // el Gestor no enseña pero «Mi ruta» sí (D-433, `inicioDeLaSecuencia`).
  // Lo ya recogido o entregado de esa ruta en las fechas de sus paradas: no se pinta, pero sí cuenta para numerar y para
  // saber si la ruta sigue siendo la publicada (D-433, `lecturaConLoHecho`).
  const hechasDeLaRuta = (laneKey: string, stops: Delivery[]) =>
    hechasDelChofer(deliveries, laneKey, new Set(stops.map((s) => s.delivery_date ?? null)));
  const inicioDeLaRuta = (laneKey: string, stops: Delivery[]) => inicioDeLaSecuencia(hechasDeLaRuta(laneKey, stops));
  // La parada recién movida se resalta un momento, para que se vea a dónde fue (D-433). La clave es la de su fila
  // (`claveDeLaFila`): el id de la orden en una entrega, «P:» y sus órdenes en una recogida.
  const [recienMovida, setRecienMovida] = useState<string | null>(null);
  const senalaLaMovida = (clave: string) => {
    setRecienMovida(clave);
    setTimeout(() => setRecienMovida((x) => (x === clave ? null : x)), 2500);
  };

  // ---- La lista única (D-443) -------------------------------------------------------------------------------------
  // ¿La base guarda dónde va cada recogida (migración 154)? Sin la columna, las recogidas salen de la regla de siempre
  // (`listaDelChofer`) y sus flechas se apagan: mover una recogida no se podría guardar.
  const hayRecogidaGuardada = useMemo(() => tienePosicionDeRecogida(deliveries), [deliveries]);
  /** La ruta de un chofer como la pinta la tabla, la lee el mapa y la mueven las flechas: UNA lista (lib/lista-unica). Con
   *  plan publicado y la ruta tal como el plan la dejó, las paradas y etiquetas del plan (D-335); si no, lo guardado. */
  const lecturaDe = (laneKey: string, stops: Delivery[]): LecturaDeRuta =>
    lecturaConLoHecho(stops, capacityFor(driverOf(laneKey)), paradasPublicadasDe(laneKey), hechasDeLaRuta(laneKey, stops));
  /** Las entregas en el orden de la lista. */
  const entregasDeLaLista = (lista: readonly ParadaDeLaLista[], stops: readonly Delivery[]): Delivery[] => {
    const porId = new Map(stops.map((d) => [d.id, d]));
    return lista.flatMap((p) => (p.tipo === "D" && porId.has(p.orden) ? [porId.get(p.orden)!] : []));
  };
  /** Escribe la lista ENTERA de un chofer: el puesto de cada entrega (tras lo ya hecho), la posición de cada recogida si la
   *  base la guarda, y el viaje viejo vacío. Anota el movimiento para deshacer (D-417). Devuelve si se escribió. */
  const guardaLaLista = async (laneKey: string, stops: Delivery[], lista: readonly ParadaDeLaLista[], etiqueta: { en: string; es: string }, traidas: readonly Delivery[] = []): Promise<boolean> => {
    const desde = inicioDeLaRuta(laneKey, stops);
    const e = escrituraDeLaLista(lista, desde);
    const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;
    clearRouteFor(laneKey);
    // Las que LLEGAN de otra ruta (arrastradas, D-456; `stops` ya las trae) cambian de chofer antes de numerar la lista, como
    // al soltar en «📅 Horario». La ruta de la que salen pierde su medida, y para deshacer cuentan las dos rutas.
    const origenes = [...new Set(traidas.map((d) => orderLaneKey(d)).filter((k): k is string => !!k && k !== laneKey))];
    const quedanEnOrigen = origenes.flatMap((k) => (byDriver.get(k) ?? []).filter((x) => !traidas.some((y) => y.id === x.id)));
    for (const d of traidas) {
      if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: desde + e.ids.indexOf(d.id), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) }))) return false;
    }
    origenes.forEach((k) => clearRouteFor(k));
    // One guarded operation for the whole new sequence: the list updates locally right away and is held there until every
    // write lands, so a realtime refetch can't snap the stop back to where it was.
    const ok = await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas);
    if (!ok) return false;
    const antes = fotoDe([...stops, ...quedanEnOrigen].map(aParadaDelGantt));
    const despues = fotoTrasReordenar(antes, e.ids, e.loadNoById, desde, recogidas);
    for (const d of traidas) despues[d.id] = { ...despues[d.id], assigned_driver: laneKey };
    await anotaMovimiento(etiqueta, [laneKey, ...origenes], antes, despues);
    return true;
  };
  /** La fila de la Base (D-443): la ruta sale de ella con 0 a bordo y vuelve con lo que quede, que tiene que ser 0. */
  const filaDeLaBase = (laneKey: string, cual: "salida" | "regreso", f: FilaDeCuenta, noCuadra: boolean) => (
    <tr key={`base-${cual}`} data-base={cual}>
      <td style={{ fontWeight: 700 }} title={t("Base", "Base")} aria-label={t("Base", "Base")}>🏠</td>
      <td className="hint" style={{ margin: 0 }}>{cual === "salida" ? t("Base: leaves", "Base: salida") : t("Base: returns", "Base: regreso")}</td>
      <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12, color: noCuadra ? "var(--red)" : undefined, fontWeight: noCuadra ? 700 : undefined }}>
        {/* Solo cuántos van a bordo (D-444): «0». Sin «libres» ni «/ capacidad»: el dueño, «no quiero que pongas libre». */}
        {numeroDePallets(f.despues)}
        {noCuadra && <div data-no-cuadra>⚠ {t("doesn’t come back empty: the count doesn’t add up", "no vuelve vacío: la cuenta no cuadra")}</div>}
      </td>
      <td colSpan={colsParadas.length} className="hint" style={{ margin: 0 }}>{pickupAddressFor(laneKey) ?? t("(no base: the driver has no store)", "(sin base: el chofer no tiene tienda)")}</td>
      <td className="celda-acciones" />
    </tr>
  );
  /** La clave de una fila de la lista, para resaltarla y para la `key` de React. */
  const claveDeLaFila = (p: ParadaDeLaLista | FilaDeLaRuta) => (p.tipo === "D" ? p.orden : `P:${p.ordenes.join(",")}`);
  /**
   * ↑ / ↓ de CUALQUIER parada de la lista, P o D (D-443). Qué pasa lo decide `mueveEnLaLista`: cambia con su vecina salvo
   * que una entrega quede antes que su recogida —entonces no mueve nada y se dice por qué—. La capacidad no bloquea: la
   * cuenta avisa en la parada que se pase. Con candado 🔒 también, como las flechas de siempre (D-411).
   */
  /** «No se movió»: la orden cuya entrega quedaría antes que su recogida. Lo dicen igual las flechas y el arrastre. */
  const avisaDeLaPrecedencia = (stops: readonly Delivery[], lectura: LecturaDeRuta, orden: string) => {
    const o = stops.find((x) => x.id === orden);
    const n = o ? facturaYId(o).principal : "";
    const d = lectura.filas.find((f) => f.tipo === "D" && f.orden === orden)?.etiqueta ?? "";
    notify(t(
      `Not moved: ${d} ${n} would be delivered before it's picked up. A delivery always goes after its pickup.`,
      `No se movió: ${d} ${n} se entregaría antes de recogerla. Una entrega va siempre después de su recogida.`,
    ));
  };
  const mueveParada = async (laneKey: string, indice: number, dir: -1 | 1) => {
    const stops = byDriver.get(laneKey) ?? [];
    const lectura = lecturaDe(laneKey, stops);
    const p = lectura.paradas[indice];
    if (!p) return;
    const etiquetaDe = (i: number) => lectura.filas.find((f) => f.indice === i)?.etiqueta ?? "";
    if (p.tipo === "P" && !hayRecogidaGuardada) {
      notify(t("Moving a pickup needs the database update (migration 154). Deliveries can be moved; pickups follow the usual rule.", "Mover una recogida necesita la actualización de la base (migración 154). Las entregas sí se mueven; las recogidas siguen la regla de siempre."));
      return;
    }
    const r = mueveEnLaLista(lectura.paradas, indice, dir);
    if (!r.ok) {
      if (r.motivo === "precedencia") avisaDeLaPrecedencia(stops, lectura, r.orden);
      return;
    }
    const nombre = p.tipo === "D" ? (() => { const o = stops.find((x) => x.id === p.orden); return o ? facturaYId(o).principal : ""; })() : (p.tienda ?? t("(no store)", "(sin tienda)"));
    const etiqueta = etiquetaDe(indice);
    if (!(await guardaLaLista(laneKey, stops, r.paradas, { en: `${etiqueta} ${nombre} ${dir < 0 ? "up" : "down"}`, es: `${etiqueta} ${nombre} ${dir < 0 ? "arriba" : "abajo"}` }))) return;
    senalaLaMovida(claveDeLaFila(p));
    notify(t(`${etiqueta} ${nombre} → stop ${indice + dir + 1} of ${r.paradas.length}`, `${etiqueta} ${nombre} → parada ${indice + dir + 1} de ${r.paradas.length}`));
  };
  /** «Pasar a…» (D-443, en cada fila P y D): las órdenes de la parada, enteras —recogida y entrega—, a la ruta de otro chofer.
   *  Entran al final de su lista, sin puesto, como «Asignar» (`assignToLane`), y se dice. */
  // D-459: entra en deshacer/rehacer, como las flechas. La foto lleva las DOS rutas —la de salida y la de llegada—, así
  // que deshacer devuelve la orden a su chofer y a su puesto de una vez: no puede quedar a medias.
  const pasaA = async (origen: string, ids: readonly string[], destino: string) => {
    if (!destino || !ids.length || moviendo) return;
    const afectadas = [...(byDriver.get(origen) ?? []), ...(byDriver.get(destino) ?? [])];
    const antes = fotoDe(afectadas.map(aParadaDelGantt));
    const despues = { ...antes };
    for (const id of ids) if (antes[id]) despues[id] = { ...antes[id], assigned_driver: destino, route_seq: null, load_no: null };
    const nombre = afectadas.filter((d) => ids.includes(d.id)).map((d) => facturaYId(d).principal).join(" · ");
    setMoviendo(true);
    try {
      for (const id of ids) await assignToLane(id, destino);
      await anotaMovimiento({ en: `${nombre} → ${laneLabel(destino)}`, es: `${nombre} → ${laneLabel(destino)}` }, [origen, destino], antes, despues);
    } finally {
      setMoviendo(false);
    }
    notify(t(`${ids.length} order(s) → ${laneLabel(destino)} (at the end of its list)`, `${ids.length} orden(es) → ${laneLabel(destino)} (al final de su lista)`));
  };
  // ---- ARRASTRAR (D-456) -------------------------------------------------------------------------------------------
  // El dueño, 2026-10-01: «When trying to build the routes manually do the drag option». D-007 (2026-08-12) lo había quitado
  // («no ocupo arrastrar, elimina eso, solo con las flechas»), y además tenía un fallo: pulsar una flecha arrancaba el
  // arrastre de la fila y el clic no se registraba. Vuelve, con las flechas en su sitio, y ese fallo no puede volver: un
  // arrastre que empieza con el dedo o el ratón sobre un botón, un desplegable, un campo o el enlace de la orden se CANCELA
  // (`pulsadoEnControl`), y el clic llega a su control. Es el arrastre del navegador (HTML5), sin dependencias.
  //   · una fila de «Sin asignar» → un chofer del panel «Choferes y rutas»: la asigna (lo mismo que «Asignar a…»);
  //   · una parada → otra fila de su lista: pasa a ese puesto (`llevaEnLaLista`: lo mismo que las flechas, de varios puestos);
  //   · una parada → la tarjeta, el panel o una fila de OTRO chofer: la orden entera pasa a su lista, en ese puesto o al final.
  // Se guarda por `guardaLaLista`, como las flechas, y se deshace con Ctrl+Z. La capacidad avisa, no bloquea.
  type Arrastrado = { tipo: "orden"; id: string } | { tipo: "parada"; ruta: string; indice: number };
  const [arrastrado, setArrastrado] = useState<Arrastrado | null>(null);
  // Sobre qué se está pasando: «ruta:<chofer>» (su tarjeta o su fila del panel) o «fila:<chofer>:<puesto>».
  const [sobre, setSobre] = useState<string | null>(null);
  const pulsadoEnControl = useRef(false);
  const filaArrastrable = (a: Arrastrado) => {
    const mira = (e: React.MouseEvent | React.TouchEvent) => {
      pulsadoEnControl.current = !!(e.target as HTMLElement).closest("button, select, input, textarea, a, label, [data-abre-la-orden], .col-resizer");
    };
    return {
      draggable: true,
      onMouseDown: mira,
      onTouchStart: mira,
      onDragStart: (e: React.DragEvent) => {
        if (pulsadoEnControl.current) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", a.tipo === "orden" ? a.id : `${a.ruta}#${a.indice}`);
        e.dataTransfer.effectAllowed = "move";
        setArrastrado(a);
      },
      onDragEnd: () => { setArrastrado(null); setSobre(null); },
    };
  };
  const claveDeSoltar = (ruta: string, indice: number | null) => (indice == null ? `ruta:${ruta}` : `fila:${ruta}:${indice}`);
  /** Lo que hace de un elemento un sitio donde soltar. Sin nada arrastrándose no pone manejadores: no estorba a nada. */
  const sueltaAqui = (ruta: string, indice: number | null) => {
    if (!arrastrado) return {};
    const clave = claveDeSoltar(ruta, indice);
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (sobre !== clave) setSobre(clave); },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); void sueltaEnLaRuta(ruta, indice); },
    };
  };
  const sueltaEnLaRuta = async (destino: string, indice: number | null) => {
    const a = arrastrado;
    setArrastrado(null);
    setSobre(null);
    if (!a || moviendo) return;
    if (a.tipo === "orden") {
      const d = deliveries.find((x) => x.id === a.id);
      if (!d) return;
      // Si la fila arrastrada es una de varias marcadas, van todas: lo mismo que hace su desplegable «Asignar a…».
      if (selectedOrders.has(a.id) && poolSelectedCount > 1) { await bulkAssign(destino); return; }
      manualAssign(a.id, destino);
      notify(t(`${facturaYId(d).principal} → ${laneLabel(destino)} (at the end of its list)`, `${facturaYId(d).principal} → ${laneLabel(destino)} (al final de su lista)`));
      return;
    }
    const stops = byDriver.get(a.ruta) ?? [];
    const lectura = lecturaDe(a.ruta, stops);
    const p = lectura.paradas[a.indice];
    if (!p) return;
    const etiqueta = lectura.filas.find((f) => f.indice === a.indice)?.etiqueta ?? "";
    const ids = p.tipo === "P" ? p.ordenes : [p.orden];
    const movidas = stops.filter((d) => ids.includes(d.id));
    const nombre = movidas.map((d) => facturaYId(d).principal).join(" · ");
    /** «⚠ se pasa en N parada(s)»: la capacidad avisa, no bloquea. */
    const avisoDeExceso = (lista: readonly ParadaDeLaLista[], suyas: readonly Delivery[], ruta: string) => {
      const n = cuentaDePallets(cambiosDeLaLista(lista, suyas), capacityFor(driverOf(ruta))).totales.paradasConExceso;
      return n > 0 ? { en: ` ⚠ over capacity at ${n} stop(s).`, es: ` ⚠ se pasa de la capacidad en ${n} parada(s).` } : { en: "", es: "" };
    };
    setMoviendo(true);
    try {
      if (a.ruta === destino) {
        // Sobre la tarjeta o el panel de su propio chofer no hay puesto que tomar.
        if (indice == null) return;
        if (p.tipo === "P" && !hayRecogidaGuardada) { notify(t("Moving a pickup needs the database update (migration 154).", "Mover una recogida necesita la actualización de la base (migración 154).")); return; }
        const r = llevaEnLaLista(lectura.paradas, a.indice, indice);
        if (!r.ok) { if (r.motivo === "precedencia") avisaDeLaPrecedencia(stops, lectura, r.orden); return; }
        if (!(await guardaLaLista(destino, stops, r.paradas, { en: `${etiqueta} ${nombre} → stop ${indice + 1}`, es: `${etiqueta} ${nombre} → parada ${indice + 1}` }))) return;
        senalaLaMovida(claveDeLaFila(p));
        const ex = avisoDeExceso(r.paradas, stops, destino);
        notify(t(`${etiqueta} ${nombre} → stop ${indice + 1} of ${r.paradas.length}.${ex.en}`, `${etiqueta} ${nombre} → parada ${indice + 1} de ${r.paradas.length}.${ex.es}`));
        return;
      }
      // A la lista de OTRO chofer: la orden entera (su recogida y su entrega), en el puesto donde se suelta o al final.
      if (!movidas.length) return;
      const suyas = byDriver.get(destino) ?? [];
      const todas = [...suyas, ...movidas];
      const lista = listaConOrdenesEn(lecturaDe(destino, suyas).paradas, movidas, indice);
      if (!(await guardaLaLista(destino, todas, lista, { en: `${nombre} → ${laneLabel(destino)}`, es: `${nombre} → ${laneLabel(destino)}` }, movidas))) return;
      for (const d of movidas) addNote(d.id, `Dragged to ${destino} (from ${a.ruta})`);
      senalaLaMovida(movidas[0].id);
      const ex = avisoDeExceso(lista, todas, destino);
      notify(t(`${nombre} → ${laneLabel(destino)}${indice == null ? " (at the end of its list)" : `, stop ${indice + 1}`}.${ex.en}`, `${nombre} → ${laneLabel(destino)}${indice == null ? " (al final de su lista)" : `, parada ${indice + 1}`}.${ex.es}`));
    } finally {
      setMoviendo(false);
    }
  };

  // ---- «🧭 Optimizar» una ruta (D-456, rehecho en D-461) ---------------------------------------------------------
  // El dueño, 2026-10-01: «have the optimize option for every route when selecting a driver and optimize it». D-437 lo había
  // quitado. Vuelve POR RUTA: reordena solo las paradas de esa tarjeta —recogidas y entregas—. Y el 2026-10-02, con el primero
  // en la calle: «sigamos trabajando en el alrgoritmo de optimizar ruta porque sigue muy mal ineficente». Aquel decidía en
  // línea recta, sin mirar ventanas, y salía de la tienda de recogida más repetida en vez de la base del chofer. Ahora:
  //   · sale de la BASE del chofer (`baseDeLaRuta`) y vuelve a ella;
  //   · mide POR CALLES: una petición de matriz por pulsación (`/api/route-matrix`), y ninguna si esta forma de la ruta ya se
  //     pidió (`tiemposPedidos`). Si no contesta, estima en línea recta y el aviso lo dice;
  //   · el orden lo decide `optimizaLaLista`: primero que el camión no se pase, después que ninguna entrega llegue fuera de
  //     su ventana, y después la jornada más corta. Exacto si la ruta es pequeña; si no, lo mejor que encuentra;
  //   · se guarda por `guardaLaLista` (Ctrl+Z lo deshace) y la medida de siempre pone las llegadas. Con candado 🔒 no
  //     optimiza, y lo dice. El aviso dice lo ganado (`avisoDeOptimizar`).
  const [optimizando, setOptimizando] = useState<string | null>(null);
  const tiemposPedidos = useRef(new Map<string, TiemposPedidos>());
  const optimizaLaRuta = async (laneKey: string) => {
    if (optimizando != null || moviendo) return;
    if (bloqueada(laneKey)) {
      notify(t(`🔒 ${laneLabel(laneKey)} is locked — Optimize leaves it alone. Unlock it first.`, `🔒 ${laneLabel(laneKey)} está bloqueada — Optimizar no la toca. Desbloquéela primero.`));
      return;
    }
    const stops = byDriver.get(laneKey) ?? [];
    const lista = lecturaDe(laneKey, stops).paradas;
    const base = baseDeLaRuta(laneKey);
    const entrada = entradaDeOptimizar({
      lista, ordenes: stops, base, capacidad: capacityFor(driverOf(laneKey)), coordsDeTienda,
      esEstrecha: (ventana) => esVentanaDura(ventana, settings), salidaMin: DAY_START_MIN,
    });
    setOptimizando(laneKey);
    try {
      const tiempos = await tiemposDeLaRuta(puntosDeLaEntrada(entrada), tiemposPedidos.current, (puntos) =>
        fetch("/api/route-matrix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ puntos }) }));
      const r = optimizaLaLista({ ...entrada, tiempos: tiempos?.tiempos ?? null });
      const porId = new Map(stops.map((d) => [d.id, d]));
      const aviso = avisoDeOptimizar({
        ruta: laneLabel(laneKey), r, tiempos, hayBase: !!base, pallets: numeroDePallets, sinRecogidas: !hayRecogidaGuardada,
        nombreDe: (id) => { const d = porId.get(id); return d ? facturaYId(d).principal : id.slice(0, 6); },
      });
      // Si no hay nada mejor no se escribe: no hay nada que guardar ni que deshacer.
      if (r.cambio && !(await guardaLaLista(laneKey, stops, r.paradas, { en: `Optimize ${laneLabel(laneKey)}`, es: `Optimizar ${laneLabel(laneKey)}` }))) return;
      notify(t(aviso.en, aviso.es));
    } finally {
      setOptimizando(null);
    }
  };

  // Friendly display name for a lane key.
  const laneLabel = (key: string) => lanes.find((l) => l.key === key)?.label ?? key;
  // 🔒 (D-411): ¿esta ruta está bloqueada en el día que se mira? Desde D-437 lo mira «📍 Mejor lugar» (y el arrastre al
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
  // Hand a whole bucket's route to a real driver, keeping its saved sequence, then retire the bucket. Until D-443 it went
  // in as the driver's next LOAD (`load_no`); with no trips, the bucket's list goes AFTER the driver's own list, in one list.
  const assignRouteToDriver = async (bucket: string, driver: string) => {
    if (!driver) return;
    const stops = byDriver.get(bucket) ?? [];
    const suyas = byDriver.get(driver) ?? [];
    const lista = [...lecturaDe(driver, suyas).paradas, ...lecturaDe(bucket, stops).paradas];
    for (const d of stops) {
      await updateDelivery(d.id, { assigned_driver: driver, load_no: null });
      addNote(d.id, `Route "${bucket}" assigned to ${driver}, after their own stops`);
    }
    await guardaLaLista(driver, [...suyas, ...stops], lista, { en: `Route ${bucket} → ${driver}`, es: `Ruta ${bucket} → ${driver}` });
    removeBucket(bucket);
    notify(t(`Route "${bucket}" (${stops.length} stop(s)) → ${driver}, after their own stops`, `Ruta "${bucket}" (${stops.length} parada(s)) → ${driver}, detrás de sus paradas`));
  };
  // Delete a whole route/load: unassign every stop (back to the pool) and, if
  // it was a bucket, retire it.
  const clearLane = async (laneKey: string) => {
    // Lo ya recogido o entregado NO se vacía (D-459): su puesto es fijo (D-433), sigue en la lista de su chofer, y
    // «devolver a Sin asignar» una orden entregada le quitaba quién la entregó. Hasta aquí Vaciar se las llevaba todas.
    const stops = deliveries.filter((d) => (d.assigned_driver || "") === laneKey && !ETAPAS_HECHAS.has(d.stage));
    const nombreDeLaRuta = laneLabel(laneKey);
    // La foto para deshacer (D-459): Vaciar es el error más caro de arreglar a mano, una orden cada vez.
    const antes = fotoDe(stops.map(aParadaDelGantt));
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
    const despues = Object.fromEntries(Object.entries(antes).map(([id, e]) => [id, { ...e, assigned_driver: null, route_seq: null, load_no: null }]));
    await anotaMovimiento({ en: `Clear ${nombreDeLaRuta}`, es: `Vaciar ${nombreDeLaRuta}` }, [laneKey], antes, despues);
    notify(t(`Cleared ${stops.length} stop(s) from ${laneLabel(laneKey)}`, `${stops.length} parada(s) quitadas de ${laneLabel(laneKey)}`));
  };
  // Drivers on vacation/sick/maintenance for the selected day — flagged «off today» in «Elige conductor».
  const unavailableToday = useMemo(
    () => unavailableDriverNames(availability, new Map(users.map((u) => [u.id, u.full_name])), date),
    [availability, users, date],
  );
  // En `colorDeChofer` (D-274): la leyenda lee el mismo color que se pinta. Sin chofer, el gris de siempre (`UNASSIGNED_COLOR`).
  const colorFor = (driver: string | null) => colorDeChofer(settings.driver_colors, driver);
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

  // La BASE de una ruta: de dónde sale el camión y a dónde vuelve (D-461). Es la tienda DEL CHOFER —la de Ajustes → Rutas
  // (`driver_settings.base_store`, la misma de la que lo saca «Armar rutas») y, si no la tiene, la de su perfil—: lo decide
  // `tiendaBaseDelChofer`. Hasta aquí era la dirección de recogida MÁS REPETIDA entre las órdenes de la ruta: con una ruta
  // que carga sobre todo en otra tienda, el camión «salía» y «volvía» a un sitio que no es el suyo, y con esa base se medían
  // las millas, las llegadas y el Optimizar (medido en D-461: era otra en 11 de 37 rutas reales). Sin tienda —un chofer sin
  // base, una ruta temporal—, `null`: la ruta se mide abierta y la tarjeta lo dice («⚠ sin base»).
  // (`pickupAddressFor` conserva el nombre de antes: es la dirección de esa base, para la fila de la Base, el mapa y la medida.)
  const basesDeChofer = useBasesDeChofer();
  // Las filas enteras de Ajustes → Rutas, para que «Asignar a…» varios choferes entre al motor con los mismos choferes que
  // «Armar rutas» (D-474): base, capacidad, turno, si vuelve, si rutea, lo que tiene el camión y sus zonas.
  const ajustesDeChofer = useAjustesDeChofer();
  const tiendaBaseDe = (laneKey: string) => tiendaBaseDelChofer(driverOf(laneKey), basesDeChofer, users, settings.stores ?? []);
  const pickupAddressFor = (laneKey: string): string | null => (tiendaBaseDe(laneKey)?.address ?? "").trim() || null;

  // Lo del día sin chofer. Es lo que cuentan el resumen, la pestaña y el tablero (y contaba «Auto-asignar», quitado en
  // D-437): el DÍA, sea cual sea el chip de la tabla. Hasta D-393 el chip «Atrasadas» cambiaba también esta lista, y con él el «Sin programar» del
  // resumen y lo que «Auto-asignar» repartía; con un chip «Todas» de cualquier día, «Programadas» habría salido negativo.
  const unassigned = useMemo(() => sinAsignarDelGestor(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);
  // Las filas de la TABLA «Sin asignar», según su chip (D-359 «Atrasadas», D-393 «Todas»), y el número de cada chip,
  // que sale de la misma función: el número es el de las filas que enseña (patrón de D-380/D-384).
  const filasDelChip = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter), [deliveries, date, modo, poolFilter]);
  const cuentasDeChips = useMemo(() => cuentasSinAsignar(deliveries, date, modo, ROUTE_STAGES, orderSearch), [deliveries, date, modo, orderSearch]);
  // «Todas» (D-462): todo lo del día, con chofer o sin él, más lo ya hecho ese día (D-459), por el filtro de chofer de la
  // barra —con un chofer elegido, las suyas y las sin asignar (`todas-del-gestor.ts` dice por qué)—. La pestaña cuenta
  // «Este día» sin búsqueda; la tabla y sus chips, con su chip y su búsqueda. Las tres salen de la misma función.
  const todasDelDia = useMemo(() => todasDelGestor(deliveries, date, modo, ROUTE_STAGES, filtroChofer), [deliveries, date, modo, filtroChofer]);
  const filasDeTodasDelChip = useMemo(() => filasDeTodas(deliveries, date, modo, ROUTE_STAGES, chipDeTodas, "", filtroChofer), [deliveries, date, modo, chipDeTodas, filtroChofer]);
  const todasConBusqueda = useMemo(() => filasDeTodas(deliveries, date, modo, ROUTE_STAGES, chipDeTodas, busquedaDeTodas, filtroChofer), [deliveries, date, modo, chipDeTodas, busquedaDeTodas, filtroChofer]);
  const cuentasDeTodasAqui = useMemo(() => cuentasDeTodas(deliveries, date, modo, ROUTE_STAGES, busquedaDeTodas, filtroChofer), [deliveries, date, modo, busquedaDeTodas, filtroChofer]);
  // Lo que «Asignar», «📍 Mejor lugar» y el recuadro «Elige conductor» pueden tomar de lo marcado: las filas SIN CHOFER de la
  // tabla que se ve, con su chip (hasta D-462, solo las de «Sin asignar»). En «Todas» una fila con chofer se marca para verla
  // en el mapa, no para asignarla: eso es «Pasar a…».
  const filasAsignables = useMemo(() => (tab === "todas" ? filasDeTodasDelChip.filter((d) => !d.assigned_driver) : filasDelChip), [tab, filasDeTodasDelChip, filasDelChip]);

  // Draw each selected unassigned load's pickup→dropoff route on the map
  // (throttled, cached), so pressing loads shows where they go.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (soloLectura) return;
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
    () => filasAsignables.reduce((n, d) => n + (selectedOrders.has(d.id) ? 1 : 0), 0),
    [filasAsignables, selectedOrders],
  );
  // Sin nada marcado el recuadro se va, y lo que se pulsó en él se olvida: la próxima tanda vuelve a preguntar (D-395).
  useEffect(() => { if (poolSelectedCount === 0) setConductorPulsado(null); }, [poolSelectedCount]);

  // Search + saved filter over the unassigned pool. La misma función que da el número de cada chip (D-393).
  const unassignedShown = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter, orderSearch), [deliveries, date, modo, poolFilter, orderSearch]);

  // Each driver's stops for the day, in their current sequence (saved
  // order first, unsequenced ones after — same rule as the Driver page).
  // Keyed by LANE (driver+load, or bucket), so each of a driver's loads is its
  // own route.
  const byDriver = useMemo(() => rutasPorChofer(dayOrders), [dayOrders]);
  // ¿Se pinta la línea del plan publicado de esta ruta? Solo con paradas pendientes y si sigue siendo la publicada
  // (D-437, `pintaElTrazoDelPlan`): la de Julio, vacío, seguía en el mapa.
  const sigueSuPlan = (laneKey: string): boolean => {
    const stops = byDriver.get(laneKey) ?? [];
    const paradas = paradasPublicadasDe(laneKey);
    if (!paradas) return false;
    return pintaElTrazoDelPlan(stops.length, lecturaDe(laneKey, stops).fuente);
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
    filtro: unicoMarcado(filtroChofer),
    enSuZona: (k) => esDeSuZona(k, filasAsignables.filter((d) => selectedOrders.has(d.id)), zonasDeChofer, settings.stores ?? []),
  });
  const conductorElegido = eleccionVigente(conductorPulsado, opcionesDelRecuadro);

  // Ordenar y filtrar por columna en «Sin asignar» (D-360), con el menú de Órdenes. El valor de cada columna lo decide
  // `valorDelGestor`; las que vienen de Órdenes (D-376) toman el valor, la celda y la etiqueta de la columna de Órdenes,
  // con el mismo contexto con que Órdenes las llama (idioma, traducción y motivos de anulación).
  // `recibidas`: la columna de Etapa pinta «Received» en las que recibió almacén (D-409), como en Órdenes.
  const recibidas = useMemo(() => idsRecibidasPorAlmacen(events), [events]);
  // Saltadas hoy y rechazadas por el cliente (D-NEXT): la misma pastilla que en Órdenes, en la columna de Etapa.
  const marcasDeParada = useMemo(() => marcasDeParadas(events, todayISO()), [events]);
  const ctxDeOrdenes = useMemo(() => ({ lang, t, motivos: motivosDeAnulacion(settings), recibidas, marcas: marcasDeParada }), [lang, t, settings, recibidas, marcasDeParada]);
  const deOrdenes = useMemo(() => ({ catalogo: ORDER_COLUMNS, ctx: ctxDeOrdenes }), [ctxDeOrdenes]);
  // Las ciudades conocidas para leer una dirección escrita sin comas (D-423, `ciudadDeEntrega`): las que salen limpias de
  // las órdenes cargadas y de las tiendas, y las zonas de los choferes. La misma lista para la celda, el orden y el filtro.
  const ciudadesQueSeConocen = useMemo(
    () => [...ciudadesConocidas([...deliveries.map((d) => d.delivery_address), ...(settings.stores ?? []).map((s) => s.address)]), ...[...zonasDeChofer.values()].flat()],
    [deliveries, settings.stores, zonasDeChofer],
  );
  const valorDelGestorAqui = useCallback((clave: string, d: Delivery) => valorDelGestor(clave, d, deOrdenes, ciudadesQueSeConocen), [deOrdenes, ciudadesQueSeConocen]);
  const ordenSinAsignar = useOrdenYFiltro(unassignedShown, valorDelGestorAqui);
  // «Todas» (D-462) ordena y filtra igual, con su propio estado: la columna «Chofer» va por la de Órdenes (`driver`).
  const ordenDeTodas = useOrdenYFiltro(todasConBusqueda, valorDelGestorAqui);
  // Las cabeceras con menú son las del catálogo (la fecha se lista formateada, y el costo como dinero). El ID fijo que iba
  // delante se quitó (D-408): el dueño, «routes manager doesn't need to see id».
  const menuSinAsignar: ColumnaConMenu[] = colsSinAsignar.map((c) => ({ ...c, etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));
  const menuDeTodas: ColumnaConMenu[] = colsTodas.map((c) => ({ ...c, etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));
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
  // En solo lectura (D-481), la orden ENTERA solo se abre si esta persona YA la puede leer, y un vendedor solo las suyas
  // (`ordenLegible`, la regla de D-467); si no, la factura es texto sin gesto.
  const abreLaOrden = (d: Delivery): { onClick?: (e: React.MouseEvent) => void; style: React.CSSProperties; title?: string } => {
    const legible = soloLectura ? ordenLegible(d.id, deliveriesLeidas, me) : d;
    if (!legible) return { style: {} };
    return {
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpenOrder(legible); },
      style: { cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 },
      title: t("Open this order", "Abrir esta orden"),
    };
  };
  // Sin la columna del ID (D-408), el enlace que abre la orden es la FACTURA, en «Sin asignar» y en las paradas. Una orden
  // sin factura enseña su código en gris (`textoQueAbreLaOrden`), para que ninguna fila se quede sin nada que pulsar.
  const enlaceALaOrden = (d: Delivery) => {
    const { texto, esFactura } = textoQueAbreLaOrden(d);
    const gesto = abreLaOrden(d);
    return <span {...gesto} data-abre-la-orden style={esFactura ? gesto.style : { ...gesto.style, color: "var(--gray)" }}>{texto}</span>;
  };

  // En la tabla de paradas de un chofer, el enlace que abre la orden es su ID, no su factura (D-444). El dueño, 2026-09-29:
  // «en vez de facturas, pongas el ID. Entonces no ocupo la factura». La factura sigue en su columna de Órdenes (⚙).
  // **Reemplazado por D-456** (2026-10-01): «It's not showing invoice number / Invoice number is more important». La FACTURA
  // vuelve a ser lo que nombra y abre la orden en la tabla de paradas, en negrita, y el ID se queda debajo, más pequeño. Una
  // orden sin factura enseña su ID en gris (`facturaYId`). (D-444 decía que la factura seguía «en su columna de Órdenes (⚙)»,
  // pero esa columna no existía en la tabla de paradas: tras D-444 no había forma de verla ahí.)
  // **D-459** (2026-10-01, «look the id looks blurry and awful becuase of those dots dont make the row larger just fix the
  // view»): el ID ya no va DEBAJO —quedaba montado sobre el subrayado de puntos de la factura, y cortado por la celda— sino en
  // la MISMA línea, a su derecha, más pequeño y gris, sin subrayar. Si no cabe, el que se corta con «…» es el ID
  // (`.factura-e-id`, globals.css), y su `title` lo dice entero. Solo la factura lleva el gesto de enlace.
  const facturaConSuId = (d: Delivery) => {
    const n = facturaYId(d);
    const gesto = abreLaOrden(d);
    return (
      <span className="factura-e-id">
        <span {...gesto} data-abre-la-orden data-factura={n.esFactura ? "" : undefined} style={n.esFactura ? { ...gesto.style, fontWeight: 700 } : { ...gesto.style, color: "var(--gray)" }}>{n.principal}</span>
        {n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>}
      </span>
    );
  };

  // ---- Las cargas de una orden (D-452, 157) ----------------------------------------------------------------------
  // Una orden que no cabe en el camión se parte en órdenes hermanas (#Xa, #Xb): cada carga es una fila, con su P y su D,
  // sus flechas y su «Pasar a…». Aquí solo lo que la fila enseña y los tres gestos: partir (si no cabe), repartir los
  // pallets de dos cargas, y volver a juntarlas (si las dos siguen pendientes y la suma cabe). La regla vive en
  // lib/cargas-partidas; la base la repite (partir_carga, reparte_cargas, juntar_cargas).
  const cargasDe = (d: Delivery) => { const hermanas = hermanasDe(deliveries, d); return { carga: cargaDe(d, hermanas), otra: laOtraCarga(d, hermanas) }; };
  const etiquetaDeLaCarga = (d: Delivery) => { const c = cargasDe(d).carga; return c ? <span className="hint" data-carga style={{ margin: 0 }}> · {etiquetaDeCarga(c, lang === "es")}</span> : null; };
  const parteLaOrden = async (d: Delivery, capacidad: number) => {
    const total = palletsDeLaOrden(d);
    const resto = restoPropuesto(total, capacidad);
    if (resto == null) return;
    const id = await partirCarga(d.id, resto);
    if (!id) return;
    clearRouteFor(orderLaneKey(d) ?? "");
    // La carga nueva nace sin puesto: va detrás de lo ya ordenado de esta ruta (medido en el demo: con la madre también sin
    // puesto, las dos salen provisionales y el orden entre ellas es el de llegada). Las flechas la ponen donde toque.
    notify(t(`#${orderLabel(d)} split in 2 loads: ${numeroDePallets(total - resto)} + ${numeroDePallets(resto)} pallets. The new load has no position yet: use the arrows to place it.`,
      `#${orderLabel(d)} partida en 2 cargas: ${numeroDePallets(total - resto)} + ${numeroDePallets(resto)} pallets. La carga nueva aún no tiene puesto: colócala con las flechas.`));
  };
  const reparteLaOrden = async (d: Delivery, otra: Delivery) => {
    const total = palletsDeLaOrden(d) + palletsDeLaOrden(otra);
    const v = window.prompt(t(`Pallets on this load #${orderLabel(d)} (of ${numeroDePallets(total)} in total):`, `Pallets de esta carga #${orderLabel(d)} (de ${numeroDePallets(total)} en total):`), numeroDePallets(palletsDeLaOrden(d)));
    if (v == null) return;
    const n = Number(v);
    if (!Number.isFinite(n) || !alRepartir(d, otra, n)) { notify(t(`Enter a number above 0 and below ${numeroDePallets(total)}.`, `Escribe un número mayor que 0 y menor que ${numeroDePallets(total)}.`)); return; }
    if (await reparteCargas(d.id, otra.id, n)) notify(t(`#${orderLabel(d)}: ${numeroDePallets(n)} pallets · #${orderLabel(otra)}: ${numeroDePallets(total - n)} pallets`, `#${orderLabel(d)}: ${numeroDePallets(n)} pallets · #${orderLabel(otra)}: ${numeroDePallets(total - n)} pallets`));
  };
  const juntaLaOrden = async (d: Delivery, otra: Delivery) => {
    if (!(await juntarCargas(d.id, otra.id))) return;
    clearRouteFor(orderLaneKey(d) ?? "");
    notify(t(`#${orderLabel(otra)} joined back into #${orderLabel(d)}: one order of ${numeroDePallets(palletsDeLaOrden(d) + palletsDeLaOrden(otra))} pallets.`, `#${orderLabel(otra)} juntada en #${orderLabel(d)}: una orden de ${numeroDePallets(palletsDeLaOrden(d) + palletsDeLaOrden(otra))} pallets.`));
  };
  /** Los botones de carga de una fila D: ✂ partir (solo si no cabe en ESE camión), ✎ repartir y ⤵ juntar (familias de dos). */
  const botonesDeCarga = (d: Delivery, capacidad: number) => {
    const { carga, otra } = cargasDe(d);
    const estilo = { padding: "2px 6px", minHeight: 0 } as const;
    return (
      <>
        {sePuedePartir(d, capacidad) && (
          <button className="btn btn-ghost btn-sm" style={estilo} data-partir onClick={() => void parteLaOrden(d, capacidad)}
            title={t(`Split in 2 loads: ${numeroDePallets(capacidad)} + ${numeroDePallets(restoPropuesto(palletsDeLaOrden(d), capacidad) ?? 0)} pallets (it doesn't fit in this truck)`, `Partir en 2 cargas: ${numeroDePallets(capacidad)} + ${numeroDePallets(restoPropuesto(palletsDeLaOrden(d), capacidad) ?? 0)} pallets (no cabe en este camión)`)}>✂</button>
        )}
        {carga && otra && (
          <button className="btn btn-ghost btn-sm" style={estilo} data-reparte onClick={() => void reparteLaOrden(d, otra)} title={t("Pallets on each load", "Pallets de cada carga")}>✎</button>
        )}
        {carga && otra && sePuedenJuntar(d, otra, capacidad) && (
          <button className="btn btn-ghost btn-sm" style={estilo} data-juntar onClick={() => void juntaLaOrden(d, otra)} title={t(`Join #${orderLabel(otra)} back into this load (it fits)`, `Juntar #${orderLabel(otra)} en esta carga (cabe)`)}>⤵</button>
        )}
      </>
    );
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

  // «📅 Horario» (D-417): cada ruta del día en el orden de su lista (D-443: sin viajes, la lista entera como UNO), con
  // cada entrega a su hora ESTIMADA (la de «📍 Mejor lugar»: línea recta, sin llamar a Google). Es lo que pinta la línea de
  // tiempo y lo que lee el arrastre: se suelta sobre lo mismo que se ve. Las recogidas no son barras: el arrastre mueve
  // entregas; su recogida la coloca `listaConEntregasEn` al soltar.
  /** Las coordenadas de una tienda de recogida, por su nombre, de Ajustes (sin llamar a nadie). */
  const coordsDeTienda = (nombre: string | null): { lat: number; lng: number } | null => {
    const n = (nombre ?? "").trim().toLowerCase();
    const s = n ? (settings.stores ?? []).find((x) => x.name.trim().toLowerCase() === n) : undefined;
    return s?.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
  };
  // TODAS las rutas con paradas que están en pantalla se MIDEN (D-456): millas, horas, trazo y la llegada estimada de cada
  // parada, en el orden guardado, sin tocarlas. El dueño, 2026-10-01: «el eta estimado en el logistic manager, quiero que
  // muestre el eta siempre que aveces no aparece». Hasta aquí (D-437) solo se medía al chofer MARCADO en el panel, y por eso
  // la columna «Llegada» de los demás decía «—». (Antes de D-437 marcar un chofer OPTIMIZABA y escribía el orden; eso no
  // vuelve: medir no escribe nada, tampoco con candado 🔒.)
  //   · Viendo UN día, todas las del filtro de chofer; viendo «todas las fechas» o las pendientes, solo las marcadas, como
  //     antes: ahí la lista de un chofer mezcla días y no es una ruta.
  //   · Una a la vez, primero las marcadas. Cómo se mide, cuántas llamadas y qué se guarda: `useMedidaDeRutas`
  //     (lib/usa-medida-de-rutas), que desde D-467 comparte «Ruta de hoy».
  const seMide = (clave: string) => (byDriver.get(clave) ?? []).length > 0 && pasaFiltro(clave) && (modo === "dia" || selected.has(clave));
  const rutasAMedir = [...lanes.filter((l) => selected.has(l.key)), ...lanes.filter((l) => !selected.has(l.key))].map((l) => l.key).filter(seMide);
  const { routeInfo, routeLines, routeEtas, depotCoords, routerInfo, getDepotCoords, baseDeLaRuta, clearRouteFor, reintentaLaMedida, estadoDeLaMedida } = useMedidaDeRutas<Delivery>({
    date, porChofer: byDriver, rutasAMedir, seMide,
    listaDe: (clave, stops) => lecturaDe(clave, stops).paradas,
    tiendaBaseDe, coordsDeTienda,
    conParadas: lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0).map((u) => u.key),
    // «Ruta de hoy» (D-467): no se busca la dirección de una base que ya tiene punto en Ajustes. Ahora la abren todos.
    ...(soloLectura ? { buscaBases: "si_falta" as const } : {}),
    invalida: [rutasPublicadas, settings.driver_capacity, settings.default_truck_capacity, settings.stores],
  });
  const aParadaDelGantt = (x: Delivery): ParadaDelGantt => ({
    id: x.id, lat: x.delivery_lat, lng: x.delivery_lng, pallets: palletsDeLaOrden(x),
    ventana: parseWindow(x.delivery_windows), servicioMin: serviceMin(x.delivery_duration),
    assigned_driver: x.assigned_driver ?? null, route_seq: x.route_seq ?? null, load_no: x.load_no ?? null,
    ...(x.pickup_seq !== undefined ? { pickup_seq: x.pickup_seq == null ? null : Number(x.pickup_seq) } : {}),
  });
  /** ¿Cabe una orden de `pallets` metida en el puesto `puesto` de la lista, recogida justo delante de su entrega? La
   *  carga a bordo en ese punto más la suya, contra la capacidad (D-443). Para «📍 Mejor lugar». */
  const admiteEnLaLista = (lista: readonly ParadaDeLaLista[], stops: readonly Delivery[], capacidad: number) => {
    const cambios = cambiosDeLaLista(lista, stops);
    return (puesto: number, pallets: number) => cabeEnElPuesto(lista, cambios, puesto, pallets, capacidad);
  };
  const rutasDelGantt: RutaDelGantt[] = lanes.map((l) => {
    const stops = byDriver.get(l.key) ?? [];
    const capacidad = capacityFor(driverOf(l.key));
    const lista = lecturaDe(l.key, stops).paradas;
    return {
      clave: l.key, viajes: [entregasDeLaLista(lista, stops).map(aParadaDelGantt)], manual: true,
      capacidad, admite: admiteEnLaLista(lista, stops, capacidad), bloqueada: bloqueada(l.key), base: baseDeLaRuta(l.key),
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
  // En solo lectura no se suelta nada en una ruta vacía: las filas sin órdenes sobran (D-481, f). En el Gestor se quedan.
  const filasDelGantt = soloLectura ? ganttRows.filter((r) => r.orders.length > 0) : ganttRows;

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

  const toggleOrder = (id: string) =>
    !soloLectura && setSelectedOrders((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelectedOrders(new Set());

  // Assign every checked order to one driver.
  const bulkAssign = async (driver: string) => {
    // Lo marcado en la TABLA que se ve, con su chip: con «Todas» o «Atrasadas» se marcan órdenes de otros días (D-359, D-393).
    const ids = filasAsignables.filter((d) => selectedOrders.has(d.id)).map((d) => d.id);
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
    const { pueden: marcadas, no: sinCamion } = separaPorRequisitos(filasAsignables.filter((d) => selectedOrders.has(d.id)), (d) => faltanA(d, laneKey));
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
    // D-443: la ruta es UNA lista. El hueco es un puesto de entrega en ella; la orden nueva se recoge justo delante de su
    // entrega (`listaConEntregasEn`), y solo se miran los puestos donde, así, el camión no pasa de su capacidad (`admite`).
    let paradas: Delivery[] = [...(byDriver.get(laneKey) ?? [])];
    let lista: ParadaDeLaLista[] = lecturaDe(laneKey, paradas).paradas;
    const desde = inicioDeLaRuta(laneKey, paradas);
    const colocadas: { en: string; es: string }[] = [];
    const aMano: string[] = [];
    setAsignando(true);
    try {
      for (const d of marcadas) {
        const entregas = entregasDeLaLista(lista, paradas);
        const cabe = admiteEnLaLista(lista, paradas, capacidad);
        // De otro día (chip «Todas»), o sin pin: se asigna como «Asignar», al final, y se dice.
        const r = delDia.has(d.id)
          ? mejorLugar({ viajes: [entregas.map(aParada)], nueva: aParada(d), base, capacidad, inicioMin: DAY_START_MIN, admite: (_v, puesto) => cabe(puesto, palletsDeLaOrden(d)) })
          : null;
        if (!r || !r.ok) {
          await assignTo(d.id, laneKey);
          aMano.push(orderLabel(d));
          if (delDia.has(d.id)) {
            paradas = [...paradas, { ...d, assigned_driver: laneKey, route_seq: null, load_no: null }];
            lista = listaConEntregasEn(lista, [...entregas.map((x) => x.id), d.id], paradas);
          }
          continue;
        }
        const ids = entregas.map((x) => x.id);
        ids.splice(r.hueco.puesto, 0, d.id);
        const nueva = listaConEntregasEn(lista, ids, [...paradas, d]);
        const e = escrituraDeLaLista(nueva, desde);
        const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;
        clearRouteFor(laneKey);
        await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: desde + e.ids.indexOf(d.id), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) });
        await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas);
        const aviso = avisoDelHueco({
          orden: orderLabel(d), ruta: laneLabel(laneKey), hueco: r.hueco,
          totalDelViaje: entregas.length + 1,
          anterior: r.hueco.puesto > 0 ? orderLabel(entregas[r.hueco.puesto - 1]) : null,
          siguienteParada: entregas[r.hueco.puesto] ? orderLabel(entregas[r.hueco.puesto]) : null,
          huecosMirados: r.huecosMirados, alternativa: r.siguiente, masCorto: r.masCorto,
        });
        colocadas.push(aviso);
        addNote(d.id, `Best fit: ${aviso.en}`);
        const porId = new Map([...paradas, d].map((x) => [x.id, x]));
        paradas = e.ids.map((id, i) => ({
          ...porId.get(id)!, assigned_driver: laneKey, route_seq: desde + i, load_no: null,
          ...(recogidas ? { pickup_seq: recogidas[id] ?? null } : {}),
        }));
        lista = nueva;
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

  // ---- «Asignar a…» varios choferes (D-474) ------------------------------------------------------------------------
  // El dueño, 2026-10-06: «en routes manager quiero que puede select multiple orders y asignarla a los ocnductos que yo
  // elija asi como el autoassign entonces elijo 10 ordenes y las asigno a 2 conductos y el sistema automaticmaente sabe a
  // quien darselas». Lo marcado —en «Sin asignar», en «Todas» (con chofer o sin él) y en las tarjetas de ruta
  // (`marcadas`)— se reparte entre los choferes ELEGIDOS con el MISMO motor que «Armar rutas» (`reparteEntre` →
  // `planifica`, motor-7), restringido a esos choferes y a esas órdenes: cada elegido conserva lo que ya lleva, en su
  // orden, y las seleccionadas se insertan donde el motor decide (a quién y en qué puesto). Una seleccionada que estaba
  // con otro chofer se mueve. Antes de escribir se enseña el resumen (cuántas a cada quien, qué no cabe y por qué); se
  // guarda por el camino de siempre (chofer, `route_seq`, `pickup_seq`: lo que lee «Mi ruta») y entra en deshacer como UN
  // movimiento con todas las rutas que tocó.
  /** Las órdenes que se reparten: lo marcado en cualquier tabla, pendiente y de ESTE día (el motor planifica un día). */
  const seleccionDelReparto = useMemo(
    () => dayOrders.filter((d) => d.delivery_date === date && ROUTE_STAGES.includes(d.stage) && (selectedOrders.has(d.id) || marcadas.has(d.id))),
    [dayOrders, date, selectedOrders, marcadas],
  );
  const alternaMarca = (id: string) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternaElegido = (id: string) => setElegidosDelReparto((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  useEffect(() => { setMarcadas(new Set()); setElegidosDelReparto(new Set()); }, [date]);
  /** El día como lo ve «Armar rutas» (`entradaDelDia`, las mismas reglas: tienda y pin, ventanas, builder, prioridad,
   *  requisitos, zonas), con las seleccionadas LIBRES —sin chofer— para que entren al motor aunque hoy estén en una ruta
   *  temporal o con un chofer que no rutea. Los choferes, con la base del perfil si no tienen la de Ajustes (D-461). */
  const diaParaElMotor = useMemo(() => {
    const sel = new Set(seleccionDelReparto.map((d) => d.id));
    return entradaDelDia({
      ordenes: deliveries.filter((d) => d.delivery_date === date && ROUTE_STAGES.includes(d.stage)).map((d) => (sel.has(d.id) ? { ...d, assigned_driver: null } : d)),
      choferes: drivers, ajustesDeChofer: ajustesConBaseDelPerfil(ajustesDeChofer, drivers), settings,
    });
  }, [deliveries, date, seleccionDelReparto, drivers, ajustesDeChofer, settings]);
  /** Con quién se puede repartir: los que entran al motor y no tienen la ruta bloqueada 🔒; los demás, apagados con su porqué. */
  const choferesDelReparto = choferesParaRepartir(diaParaElMotor, drivers, bloqueada, unavailableToday);
  /**
   * Escribe el reparto: la lista ENTERA de cada chofer elegido que recibió algo, por el camino de `guardaLaLista` (las mismas
   * escrituras: el chofer y el puesto de las que llegan, `reorderStops` con las recogidas si la base las guarda), y UNA
   * anotación en deshacer con la foto de TODAS las rutas tocadas —las de los elegidos y las de donde salieron las movidas—,
   * para que ↶ devuelva el lote entero de una vez. Si una escritura falla, para ahí y lo dice el proveedor.
   */
  const guardaElReparto = async (r: Reparto): Promise<boolean> => {
    const porId = new Map(dayOrders.map((d) => [d.id, d]));
    const rutas = r.rutas.filter((x) => x.nuevas.length > 0);
    const afectadas = new Map<string, Delivery>();
    for (const x of rutas) for (const d of byDriver.get(x.nombre) ?? []) afectadas.set(d.id, d);
    for (const x of rutas) for (const id of x.nuevas) { const d = porId.get(id); if (d) afectadas.set(d.id, d); }
    const antes: Foto = fotoDe([...afectadas.values()].map(aParadaDelGantt));
    let despues: Foto = { ...antes };
    const tocadas = new Set<string>();
    for (const x of rutas) {
      const laneKey = x.nombre;
      const suyas = byDriver.get(laneKey) ?? [];
      const traidas = x.nuevas.filter((id) => !suyas.some((d) => d.id === id)).map((id) => porId.get(id)).filter((d): d is Delivery => !!d);
      const stops = [...suyas, ...traidas];
      const lista = listaDeLasParadas(x.paradas, (id) => porId.get(id)?.store ?? null, suyas.map((d) => d.id));
      const desde = inicioDeLaRuta(laneKey, stops);
      const e = escrituraDeLaLista(lista, desde);
      const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;
      clearRouteFor(laneKey);
      tocadas.add(laneKey);
      for (const d of traidas) {
        const origen = orderLaneKey(d);
        if (origen && origen !== laneKey) { tocadas.add(origen); clearRouteFor(origen); }
        if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: desde + e.ids.indexOf(d.id), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) }))) return false;
        addNote(d.id, `Assigned to ${laneKey} by “Assign to…” (engine)${d.assigned_driver ? ` (from ${d.assigned_driver})` : ""}`);
      }
      if (!(await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas))) return false;
      despues = fotoTrasReordenar(despues, e.ids, e.loadNoById, desde, recogidas);
      for (const d of traidas) despues[d.id] = { ...despues[d.id], assigned_driver: laneKey };
    }
    await anotaMovimiento(etiquetaDelReparto(rutas.reduce((n, x) => n + x.nuevas.length, 0), rutas.map((x) => x.nombre)), [...tocadas], antes, despues);
    return true;
  };
  /** «🧭 Asignar N entre…»: pide los tiempos, reparte con el motor, enseña el resumen y, si se confirma, escribe. */
  const reparte = async () => {
    const elegidos = choferesDelReparto.filter((c) => c.puede && elegidosDelReparto.has(c.id));
    const seleccionadas = seleccionDelReparto.map((d) => d.id);
    if (!elegidos.length || !seleccionadas.length || repartiendo || moviendo) return;
    setRepartiendo(true);
    try {
      // Lo que cada elegido ya lleva hoy, en el orden de su tarjeta (lo pendiente: lo hecho no se mueve ni cuenta, D-459).
      const yaLlevan = Object.fromEntries(elegidos.map((c) => [c.id, paradasDeLaLista(lecturaDe(c.nombre, byDriver.get(c.nombre) ?? []).paradas)]));
      const peticion = { entrada: diaParaElMotor.entrada, seleccionadas, elegidos: elegidos.map((c) => c.id), yaLlevan };
      // Los tiempos por calles de los puntos que entran, como «🧭 Optimizar» (D-461): UNA petición a `/api/route-matrix`, con
      // memoria por forma mientras la pantalla esté abierta; lo que no conteste se estima en línea recta y el resumen lo dice.
      const puntos = puntosDelReparto(entradaDelReparto(peticion).entrada, diaParaElMotor.puntos);
      const tiempos = await tiemposDeLaRuta(Object.values(puntos), tiemposPedidos.current, (pts) =>
        fetch("/api/route-matrix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ puntos: pts }) }));
      const medida = matrizDelGestor(puntos, tiempos?.tiempos ?? null);
      const r = reparteEntre({ ...peticion, entrada: { ...diaParaElMotor.entrada, matriz: medida.matriz }, parametros: diaParaElMotor.parametros });
      const porId = new Map(dayOrders.map((d) => [d.id, d]));
      const nombreDe = (id: string) => { const d = porId.get(id); return d ? facturaYId(d).principal : id.slice(0, 6); };
      const movimientos = movimientosDelReparto(r, (id) => porId.get(id)?.assigned_driver ?? null);
      const resumen = resumenDelReparto({ r, nombreDe, movimientos, medida, totalSeleccionadas: seleccionadas.length });
      // Nada que asignar: se dice y no se escribe nada. Algo sí: se confirma con el resumen delante (lo que no cabe se queda donde está).
      if (!r.rutas.some((x) => x.nuevas.length)) { await confirmAction(t(resumen.en, resumen.es), { alertOnly: true }); return; }
      if (!(await confirmAction(t(resumen.en, resumen.es), { confirmLabel: t("Assign", "Asignar") }))) return;
      if (!(await guardaElReparto(r))) return;
      setMarcadas(new Set()); clearSelection(); setElegidosDelReparto(new Set());
      const n = r.rutas.reduce((s, x) => s + x.nuevas.length, 0);
      notify(t(`🧭 ${n} order(s) assigned to ${r.rutas.filter((x) => x.nuevas.length).map((x) => `${x.nombre} (+${x.nuevas.length})`).join(", ")}. Ctrl+Z undoes it.`,
        `🧭 ${n} orden(es) asignadas a ${r.rutas.filter((x) => x.nuevas.length).map((x) => `${x.nombre} (+${x.nuevas.length})`).join(", ")}. Ctrl+Z lo deshace.`));
    } finally {
      setRepartiendo(false);
    }
  };
  /** La sección de «Asignar a…» varios: la cuenta de seleccionadas, los choferes con su casilla y el botón. Dentro del recuadro
   *  «Elige conductor» va plegada tras un botón; sola (en «Rutas», o en «Todas» sin nada sin asignar marcado), abierta. */
  const seccionDeReparto = (sola: boolean) => {
    const n = seleccionDelReparto.length;
    const abierto = sola || repartoAbierto;
    const elegidos = choferesDelReparto.filter((c) => c.puede && elegidosDelReparto.has(c.id));
    return (
      <div data-reparte-entre={sola ? "sola" : "en-el-recuadro"} style={sola ? undefined : { marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b data-cuenta-seleccionadas style={{ fontSize: sola ? 15 : 13 }}>🧭 {n === 1 ? t("1 selected", "1 seleccionada") : t(`${n} selected`, `${n} seleccionadas`)}</b>
          {sola
            ? <span className="hint" style={{ margin: 0 }}>{t("Assign to the drivers you choose: the engine decides who gets each one and where it goes in their route.", "Asignar a los choferes que elija: el motor decide a quién le toca cada una y en qué puesto de su ruta.")}</span>
            : <button className="btn btn-ghost btn-sm" data-abre-reparto aria-expanded={abierto} onClick={() => setRepartoAbierto((v) => !v)}
                title={t("Hand the checked orders to several drivers at once; the engine decides who gets each one and where", "Repartir las marcadas entre varios choferes de una vez; el motor decide a quién le toca cada una y dónde")}>
                {abierto ? "▾" : "▸"} {t("Assign to several drivers…", "Asignar a varios choferes…")}
              </button>}
        </div>
        {abierto && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", margin: "8px 0 10px", maxHeight: 132, overflowY: "auto" }}>
              {choferesDelReparto.map((c) => {
                const porque = c.motivo ? textoDeNoRepartir(c.motivo) : null;
                return (
                  <label key={c.id} title={porque ? t(porque.en, porque.es) : undefined}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, cursor: c.puede ? "pointer" : "not-allowed", fontSize: 14, fontWeight: elegidosDelReparto.has(c.id) && c.puede ? 700 : 500, color: "var(--text)", textTransform: "none", letterSpacing: "normal", minWidth: 0, opacity: c.puede ? 1 : 0.6 }}>
                    <input type="checkbox" data-elige-para-repartir={c.id} disabled={!c.puede || repartiendo} checked={c.puede && elegidosDelReparto.has(c.id)}
                      onChange={() => alternaElegido(c.id)} style={{ width: 15, height: 15, flex: "0 0 auto" }} />
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorFor(c.nombre), flex: "0 0 auto", boxShadow: "0 0 0 1px var(--line)" }} />
                    <span>{c.nombre}{c.motivo === "ruta_bloqueada" ? " 🔒" : ""}</span>
                    <span className="hint" data-carga-del-conductor>
                      ({(byDriver.get(c.nombre) ?? []).length === 1 ? t("1 stop", "1 parada") : t(`${(byDriver.get(c.nombre) ?? []).length} stops`, `${(byDriver.get(c.nombre) ?? []).length} paradas`)} · {sumaPallets(byDriver.get(c.nombre) ?? [])}/{capacityFor(c.nombre)} {t("pallets", "pallets")})
                    </span>
                    {porque && c.motivo !== "ruta_bloqueada" && <span className="sema" data-no-rutea style={{ fontSize: 10, background: "var(--card)", color: "var(--amber-text)", border: "1px solid var(--amber)" }}>{t(porque.en, porque.es)}</span>}
                    {c.noDisponible && <span className="sema" style={{ fontSize: 10, background: "var(--red-chip-bg)", color: "var(--red-chip-text)" }}>{t("off today", "no disponible")}</span>}
                  </label>
                );
              })}
              {choferesDelReparto.length === 0 && (
                <span className="hint" data-sin-choferes-para-repartir style={{ margin: 0 }}>{t("No driver can be routed today: each needs a base store with a map point (Settings → Routes, or their profile store).", "Ningún chofer rutea hoy: cada uno necesita una tienda base con punto en el mapa (Ajustes → Rutas, o la tienda de su perfil).")}</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn-primary" data-reparte disabled={!elegidos.length || n === 0 || repartiendo || moviendo} onClick={() => void reparte()}
                title={t("Same engine and rules as Build routes, limited to these orders and these drivers; what each driver already has stays with them, in order", "El mismo motor y las mismas reglas que Armar rutas, limitado a estas órdenes y estos choferes; lo que cada uno ya lleva se queda con él, en su orden")}>
                🧭 {repartiendo ? t("Assigning…", "Asignando…")
                  : elegidos.length <= 1 ? t(`Assign ${n} to ${elegidos[0]?.nombre ?? "…"}`, `Asignar ${n} a ${elegidos[0]?.nombre ?? "…"}`)
                  : t(`Assign ${n} among ${elegidos.length} drivers`, `Asignar ${n} entre ${elegidos.length} choferes`)}
              </button>
              <button className="btn btn-ghost btn-sm" data-quita-seleccion disabled={repartiendo} onClick={() => { setMarcadas(new Set()); clearSelection(); }}>✕ {t("Clear selection", "Quitar selección")}</button>
            </div>
          </>
        )}
      </div>
    );
  };
  const recuadroDeReparto = () => (
    <div className="card" data-recuadro-de-reparto role="group" aria-label={t(`Assign ${seleccionDelReparto.length} selected orders to drivers`, `Asignar ${seleccionDelReparto.length} órdenes seleccionadas a choferes`)}
      style={{ position: "sticky", bottom: 8, zIndex: 6, margin: "10px 0 0", padding: "12px 14px", border: "2px solid var(--accent)", background: "var(--accent-soft)", maxWidth: "100%", boxSizing: "border-box" }}>
      {seccionDeReparto(true)}
    </div>
  );

  // Las flechas ↑ ↓ de cada parada son `mueveParada` (arriba, D-443): P o D, sobre la lista única. La de antes (`move`,
  // D-433) movía solo entregas y, con viajes a mano, sellaba el viaje de cada una por posición; se fue con los viajes.

  // ---- Deshacer / rehacer (D-417) -------------------------------------------------------------------------------
  // Los movimientos a mano de ESTA sesión y de ESTE día: arrastrar en «📅 Horario» y las flechas ↑ ↓ de parada. Deshacer
  // es otra escritura en la base (los mismos campos que las flechas: `assigned_driver`, `route_seq`, `load_no` y, con la
  // 154, `pickup_seq`), y antes de escribir se lee lo que hay AHORA: si otra persona tocó algo de lo que se va a escribir,
  // no se escribe nada.
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
        ...(d.pickup_seq !== undefined ? { pickup_seq: d.pickup_seq == null ? null : Number(d.pickup_seq) } : {}),
      }));
    }
    // `pickup_seq` solo si la base lo tiene (154): pedir una columna que no existe haría fallar la lectura entera.
    const { data, error } = await createClient().from("deliveries").select(`id, assigned_driver, route_seq, load_no, updated_at${hayRecogidaGuardada ? ", pickup_seq" : ""}`).in("id", ids);
    if (error || !data) return null;
    return data as unknown as FilaFresca[];
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
    if (soloLectura) return;
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
  }, [soloLectura]);

  // Soltar una parada en «📅 Horario» (D-417). Qué se escribe lo decide `planDeSoltar` (lo mismo que las flechas y que
  // «📍 Mejor lugar»); la vista previa mientras se arrastra es ese mismo plan, sin escribir. D-443: el orden nuevo de las
  // ENTREGAS lo decide `planDeSoltar`; dónde va cada recogida, `listaConEntregasEn` (cada una sigue pegada a la entrega que
  // tenía delante, y la de la orden que llega, justo antes de su entrega). Las dos cosas van en la foto de deshacer.
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
    const suyas = byDriver.get(plan.destino) ?? [];
    const conLaMovida = suyas.some((x) => x.id === movida) ? suyas : [...suyas, d];
    const lista = listaConEntregasEn(lecturaDe(plan.destino, suyas).paradas, plan.ids, conLaMovida);
    const recogidas = hayRecogidaGuardada ? escrituraDeLaLista(lista, 0).pickupSeqById : undefined;
    const despues = { ...plan.despues };
    if (recogidas) for (const id of plan.ids) despues[id] = { ...despues[id], pickup_seq: recogidas[id] ?? null };
    setMoviendo(true);
    try {
      clearRouteFor(plan.destino);
      if (plan.origen !== plan.destino) {
        clearRouteFor(plan.origen);
        if (!(await updateDelivery(movida, { ...plan.parcheDeLaMovida, ...(recogidas ? { pickup_seq: recogidas[movida] ?? null } : {}) }))) return;
      }
      if (!(await reorderStops(plan.ids, plan.loadNoById, undefined, 0, recogidas))) return;
      const nombre = (id: string) => { const x = dayOrders.find((o) => o.id === id); return x ? orderLabel(x) : id.slice(0, 6); };
      const previa = textoDePrevia(plan.previa, nombre);
      const cambio = plan.origen !== plan.destino ? ` (from ${laneLabel(plan.origen)})` : "";
      const cambioEs = plan.origen !== plan.destino ? ` (desde ${laneLabel(plan.origen)})` : "";
      const en = `#${orderLabel(d)} → ${laneLabel(plan.destino)}${cambio}, stop ${plan.puesto + 1} of ${plan.totalDelViaje}${plan.porNombre ? " (Best fit)" : ""}: ${previa.en} (straight-line estimate)`;
      const es = `#${orderLabel(d)} → ${laneLabel(plan.destino)}${cambioEs}, parada ${plan.puesto + 1} de ${plan.totalDelViaje}${plan.porNombre ? " (Mejor lugar)" : ""}: ${previa.es} (estimación en línea recta)`;
      addNote(movida, `Timeline: ${en}`);
      notify(t(en, es));
      await anotaMovimiento({ en: `#${orderLabel(d)} → ${laneLabel(plan.destino)}`, es: `#${orderLabel(d)} → ${laneLabel(plan.destino)}` },
        plan.origen === plan.destino ? [plan.destino] : [plan.origen, plan.destino], plan.antes, despues);
    } finally {
      setMoviendo(false);
    }
  };

  // «Mover un viaje entero» (↑↓ en la cabecera de cada viaje) se fue con los viajes (D-443).

  const focused = selected.size > 0;
  const isDim = (driver: string | null) => focused && !!driver && !selected.has(driver);

  // The whole day is always on the map — a driver focus dims the rest rather
  // than hiding it, so the full picture stays visible.
  const points: MapPoint[] = useMemo(() => {
    // Las bases, las P/D de cada ruta en el orden de su lista, lo sin chofer y lo ya hecho (✓, D-459): `puntosDeLasRutas`
    // (lib/mapa-de-rutas), lo mismo que pinta «Ruta de hoy» (D-467). Aquí se añade lo que es solo del Gestor: lo marcado ☑.
    const pts = puntosDeLasRutas<Delivery>({
      carriles: lanes, porChofer: byDriver, delDia: dayOrders, hechas: hechasPintadas,
      pasaFiltro, soloUnChofer: soloAlgunos(filtroChofer), enfocado: focused, atenuada: isDim,
      colorDe: colorFor, colorSinChofer: UNASSIGNED_COLOR,
      // D-481 (d): una recogida en una tienda de RTG no lleva burbuja «P1»: la casita y la base ya están ahí.
      recogidaEnTienda: (lugar) => esTiendaRtg(lugar, settings.stores ?? []),
      baseDe: (clave) => {
        const addr = (pickupAddressFor(clave) ?? "").trim();
        // En solo lectura la base sale de Ajustes (con `buscaBases: "si_falta"` no se busca su dirección): `baseDeLaRuta`.
        const base = soloLectura ? baseDeLaRuta(clave) : null;
        const coords: [number, number] | undefined = base ? [base.lat, base.lng] : addr ? depotCoords[addr] : undefined;
        return coords ? { coords, direccion: tiendaBaseDe(clave)?.name ?? addr } : null;
      },
      lecturaDe, coordsDeTienda, t,
      marcadas: { tiene: (id) => selectedOrders.has(id), colorDe: (id) => selColorById.get(id), cuantas: selectedOrders.size },
    });
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
  }, [dayOrders, byDriver, settings.driver_colors, settings.driver_capacity, selected, selectedOrders, selColorById, selPickup, filtroChofer, depotCoords, lanes, rutasPublicadas, deliveries, hechasPintadas]);

  // Every measured driver's routes are always drawn; a focus just dims the
  // others. Clicking a route focuses its driver (see onLineClick below).
  const lines: MapLine[] = useMemo(() => {
    // Las líneas medidas de cada ruta y la del plan publicado: `lineasDeLasRutas` (lib/mapa-de-rutas), las de «Ruta de hoy».
    const out: MapLine[] = lineasDeLasRutas({
      trazos: routeLines, trazosDelPlan, tieneParadas: (clave) => (byDriver.get(clave)?.length ?? 0) > 0,
      pasaFiltro, sigueSuPlan, colorDe: colorFor, atenuada: isDim,
    });
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
    const ruta = rutaDeLaLinea(id);
    if (ruta) focusOnly(ruta);
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
    return encuadreDeLasRutas(points, selected, byDriver, lanes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selected, selectedOrders, selRouteCache, selPickup, dayOrders, locateDriver, driverLocations, users]);

  if (!me) return null;
  if (!soloLectura && !canPlanRoutes(me)) {
    return <div className="empty">{t("You don’t have access to route planning.", "No tienes acceso a la planificación de rutas.")}</div>;
  }

  // Una ruta que ya lo entregó todo sigue siendo una ruta del día (D-459): su tarjeta se queda, con sus filas hechas.
  const conAlgoQuePintar = (clave: string) => (byDriver.get(clave) ?? []).length > 0 || hechasDe(clave).length > 0;
  const withStops = lanes.filter((u) => conAlgoQuePintar(u.key));
  // Route cards always show every route that has stops, PLUS any lane you've
  // checked (even an empty one you're filling). Checking loads to merge, or
  // focusing a driver on the map, never makes the other routes disappear.
  // Con el filtro de chofer (D-393), solo la suya.
  // Desde D-437, solo las que tienen paradas: una marcada ☑ sin paradas sacaba una tarjeta entera «0 paradas» (Julio). Esa
  // tarjeta no era destino de nada —se asigna desde «Sin asignar», el recuadro o el tablero, y se arrastra en «Horario»,
  // que sí pinta las rutas vacías—; renombrar o quitar una ruta temporal vacía sigue en el panel. Las marcadas vacías se
  // nombran en una línea (`marcadasSinParadas`).
  const shownDrivers = lanesDelFiltro.filter((u) => conAlgoQuePintar(u.key));
  // El panel «Choferes y rutas» (D-481, f): un chofer sin ninguna orden ese día no sale; una ruta temporal vacía sí.
  const filasDelPanel = rutasConOrdenes(lanesDelFiltro, conAlgoQuePintar);
  const marcadasSinParadas = lanesDelFiltro.filter((u) => selected.has(u.key) && (byDriver.get(u.key) ?? []).length === 0);
  // «▦ Cuadrícula» (D-481, e): arriba, una tarjeta COMPACTA por ruta (nombre, números, pastillas; sin tabla ni botones);
  // abajo, DESPLEGADA a todo el ancho, la del nombre pulsado. En «▭ Ancho», las tarjetas enteras, como siempre.
  const rutaDesplegada = desplegadaVigente(desplegada, shownDrivers.map((u) => u.key));
  const tarjetasDeRuta: [Lane, ModoDeTarjeta][] = wideRoutes
    ? shownDrivers.map((u) => [u, "ancha"])
    : [...shownDrivers.map((u): [Lane, ModoDeTarjeta] => [u, "compacta"]), ...shownDrivers.filter((u) => u.key === rutaDesplegada).map((u): [Lane, ModoDeTarjeta] => [u, "desplegada"])];
  const scheduledCount = dayOrders.length - unassigned.length;
  // La leyenda del mapa (D-274), solo en «Ruta de hoy» (D-467): con el mismo `colorFor` que pinta los puntos.
  const leyenda = leyendaDelMapa({
    choferes: dayOrders.filter((d) => d.delivery_lat != null && d.delivery_lng != null).map((d) => d.assigned_driver),
    coloresDeChofer: settings.driver_colors, rutasSinChofer: false, puedeAsignar: false, rutasDelDia: { camiones: veCamiones },
  });
  const canManageColors = me.role === "manager" || me.role === "admin";
  // El motor nuevo (D-320) es para quien puede publicar, y con un día concreto. Con su barra cerrada (D-400), la cabecera
  // lleva el botón que la trae. Nunca en solo lectura.
  const puedeArmarRutas = !soloLectura && !allDates && !soloPendientes && !!me && ["admin", "logistics"].includes(me.role);

  // ---- La tabla de órdenes: «Sin asignar» y «Todas» (D-462) ----------------------------------------------------
  // Son UNA tabla con dos vistas: la de siempre —lo del día sin chofer (D-331/D-393)— y «Todas»: todo lo del día, con chofer
  // o sin él, más lo ya hecho (D-459). Lo que cambia entre las dos va en `VistaDeOrdenes`; la cabecera, el buscador, el ⚙,
  // los chips, la tabla, cada fila, el recuadro «Elige conductor» y el aviso de «Mejor lugar» se pintan desde aquí para las
  // dos. Cada fila decide sola qué lleva: sin chofer, la casilla, el arrastre y «Asignar a…» (en «Sin asignar» lo son todas);
  // con chofer, «Pasar a…» (el de la tabla de paradas, `pasaA`, con deshacer); ya hecha, ✓ y nada que la mueva.
  interface VistaDeOrdenes {
    clave: "sinAsignar" | "todas";
    /** El id del plegado (`toggleCollapse`), y la cabecera: «📦 Órdenes sin asignar · 3». */
    panel: string; icono: string; titulo: string; total: number;
    columnas: ColumnaDelGestor[]; menu: ColumnaConMenu[]; selector: ColumnaDelGestor[]; notaDelSelector: string;
    busqueda: string; onBusqueda: (v: string) => void;
    chip: ChipSinAsignar; onChip: (c: ChipSinAsignar) => void; cuentas: Record<ChipSinAsignar, number>; rotuloDelChip: (c: ChipSinAsignar) => string;
    /** Las filas del chip sin búsqueda (para decir «todo tiene chofer») y con ella (para decir «nada coincide»). */
    filas: Delivery[]; conBusqueda: Delivery[];
    orden: OrdenYFiltro<Delivery>;
    vacio: string; nadaCoincide: string; pista: string;
    /** La última columna: su rótulo y su ancho («Asignar a» cabe en 116; «Asignar / pasar», no). */
    cabeceraDeAcciones: string; anchoDeAcciones: number;
    caja: React.RefObject<HTMLDivElement | null>;
  }
  const tablaDeOrdenes = (vista: VistaDeOrdenes) => {
    const { columnas, menu, orden, panel } = vista;
    // «Seleccionar todo» es lo que se VE (con un filtro de columna puesto, solo esas filas, D-360) y se puede marcar: una ya
    // hecha no se marca (en «Sin asignar» no hay ninguna).
    const marcables = orden.visibles.filter((d) => !ETAPAS_HECHAS.has(d.stage));
    const fila = (d: Delivery) => {
      const hecha = ETAPAS_HECHAS.has(d.stage);
      const entregada = d.stage === "delivered";
      const sinChofer = !d.assigned_driver;
      const ruta = sinChofer ? null : orderLaneKey(d);
      const marcada = !hecha && selectedOrders.has(d.id);
      const hora = entregada ? horaReal(d, "D") : null;
      const titulo = !hecha ? undefined : entregada
        ? t(`Delivered${hora ? ` at ${hora}` : ""} — it stays on the list; it can't be moved`, `Entregada${hora ? ` a las ${hora}` : ""} — sigue en la lista; no se mueve`)
        : t("Picked up, on the truck — it stays on the list; it can't be moved", "Recogida, en el camión — sigue en la lista; no se mueve");
      return (
        <tr key={d.id} data-orden={hecha ? "hecha" : sinChofer ? "sin-chofer" : "con-chofer"} title={titulo}
          className={`${marcada ? "row-selected" : ""}${hecha ? ` fila-hecha${entregada ? " row-done" : ""}` : ""}`}
          onClick={hecha ? undefined : () => toggleOrder(d.id)}
          style={{ cursor: hecha ? undefined : "pointer", opacity: arrastrado?.tipo === "orden" && arrastrado.id === d.id ? 0.5 : undefined }}
          data-fila-arrastrable={sinChofer && !soloLectura ? "orden" : undefined} {...(sinChofer && !soloLectura ? filaArrastrable({ tipo: "orden", id: d.id }) : {})}>
          <td>
            {/* Una ya hecha lleva ✓ (entregada) o 🚚 (recogida, en camino) en vez de la casilla: no se marca ni se asigna (D-459). */}
            {hecha
              ? <span data-hecha={entregada ? "hecho" : "en_camino"} style={{ fontWeight: 700 }}>{entregada ? "✓" : "🚚"}</span>
              : soloLectura ? null : <input type="checkbox" checked={marcada} readOnly aria-label={`#${orderLabel(d)}`} />}
            {marcada && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: selColorById.get(d.id), marginLeft: 5, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />}
          </td>
          {/* La factura abre la orden y NO selecciona la fila: `stopPropagation` en `abreLaOrden`. */}
          {columnas.map((c) => (
            <td key={c.key} className={clasePastillas(c.key)} onClick={c.key === "date" ? (e) => e.stopPropagation() : undefined}>
              {/* Las que vienen de Órdenes (D-376) —etapa, tipo, SO, PO, costo, contacto, y el chofer de «Todas»— con la celda de Órdenes. */}
              {c.deOrdenes ? celdaDeOrdenes(c.key, d)
                : c.key === "invoice" ? enlaceALaOrden(d)
                : c.key === "account" ? (d.account || "—")
                : c.key === "address" ? <span title={d.delivery_address || undefined}>{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || "—"}<AvisoSoloCiudad orden={d} corto /></span>
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
              {hecha || soloLectura ? null : sinChofer ? (
                // Assign is ALWAYS available. «🔮 Simular», que salía al lado con un chofer elegido, se quitó en D-437:
                // reoptimizaba la ruta entera y la escribía. «📍 Mejor lugar» mete la orden sin mover las demás.
                <select defaultValue="" data-asignar-a onChange={(e) => {
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
              ) : ruta && lanes.some((l) => l.key !== ruta) ? (
                // «Pasar a…» (D-462, solo en «Todas»): la orden entera a la ruta de otro chofer, al final de su lista, como en la
                // tabla de paradas (D-443) y con su deshacer (D-459).
                <select value="" data-pasar-a aria-label={t("Move the order to another driver", "Pasar la orden a otro chofer")}
                  onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) void pasaA(ruta, [d.id], v); }} style={{ width: "auto" }}>
                  <option value="">{t("Move to…", "Pasar a…")}</option>
                  {lanes.filter((l) => l.key !== ruta).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              ) : null}
              {/* La sugerencia de chofer («💡 nombre») que salía aquí se quitó (D-346), por pedido del dueño. */}
            </div>
          </td>
        </tr>
      );
    };
    return (
      <div className="card" data-tabla-de-ordenes={vista.clave} style={{ margin: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => toggleCollapse(panel)}>
          <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Collapse", "Contraer")}>{isCollapsed(panel) ? "▸" : "▾"}</button>
          <h2 style={{ margin: 0 }}>{vista.icono} {vista.titulo}</h2>
          <span className="count-tag">{vista.total}</span>
        </div>
        {!isCollapsed(panel) && <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
          <input
            value={vista.busqueda}
            onChange={(e) => vista.onBusqueda(e.target.value)}
            placeholder={t("Search # / customer / address / phone…", "Buscar # / cliente / dirección / teléfono…")}
            style={{ maxWidth: 300 }}
          />
          {/* Las dos vistas comparten las columnas elegidas, el orden, las plantillas y las flechas (`moverEn("sinAsignar")`). */}
          {!soloLectura && (
          <SelectorDeColumnas
            columnas={vista.selector}
            elegidas={colsGestor} onAlterna={alternaColumnaDelGestor} t={t} alLado="izquierda"
            rotulo={(c) => (lang === "es" ? c.es : c.en)}
            titulo={t("Show and order columns", "Mostrar y ordenar columnas")} nota={vista.notaDelSelector}
            plantillas={propsDePlantillas}
            mover={moverEn("sinAsignar")}
          />
          )}
          {/* Chips (D-393): «Este día» es el antiguo «Todas»; «Todas» es de cualquier día. Cada uno lleva su número, que
              sale de la misma función que sus filas. */}
          {(["dia", "todas", "overdue", "windowed", "noloc"] as const).map((f) => (
            <button
              key={f}
              className={"btn btn-sm " + (vista.chip === f ? "btn-primary" : "btn-ghost")}
              onClick={() => vista.onChip(f)}
              data-chip={f}
              title={f === "todas" ? t("Orders from any day — past, future or undated", "Órdenes de cualquier día — pasadas, futuras o sin fecha") : undefined}
            >
              {vista.rotuloDelChip(f)} ({vista.cuentas[f]})
            </button>
          ))}
          {selectedOrders.size > 0 && (
            <>
              <span className="count-tag">{selectedOrders.size} {t("selected", "seleccionadas")}</span>
              <button className="btn btn-ghost btn-sm" onClick={clearSelection}>{t("Clear", "Limpiar")}</button>
            </>
          )}
        </div>
        {vista.filas.length === 0 ? (
          <div className="empty">{vista.vacio}</div>
        ) : vista.conBusqueda.length === 0 ? (
          <div className="empty">{vista.nadaCoincide}</div>
        ) : (
          <>
          <FiltrosPuestos estado={orden} columnas={menu} lang={lang} t={t} />
          {showTop && !soloLectura && (
            <div className="hint" data-pista-de-arrastre style={{ margin: "0 0 6px" }}>✋ {vista.pista}</div>
          )}
          <BarraSuperior caja={vista.caja} />
          <div className="tbl-scroll tbl-fit tbl-caja" ref={vista.caja} style={estiloDeCaja}>
            <table className="orders tbl-resize" style={anchoDeTabla([28, ...columnas.map((c) => anchoEnSinAsignar(c.key)), vista.anchoDeAcciones])}>
              <colgroup>
                <col style={{ width: 28 }} />
                {columnas.map((c) => <col key={c.key} style={{ width: anchoEnSinAsignar(c.key) }} />)}
                <col style={{ width: vista.anchoDeAcciones }} />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    {!soloLectura && <input
                      type="checkbox"
                      aria-label={t("Select all", "Seleccionar todo")}
                      checked={marcables.length > 0 && marcables.every((d) => selectedOrders.has(d.id))}
                      onChange={(e) => setSelectedOrders((s) => {
                        const n = new Set(s);
                        if (e.target.checked) marcables.forEach((d) => n.add(d.id));
                        else marcables.forEach((d) => n.delete(d.id));
                        return n;
                      })}
                    />}
                  </th>
                  {/* Cada cabecera abre el menú de ordenar y filtrar (D-360); el tirador del ancho sigue en su sitio. */}
                  {menu.map((c) => <th key={c.key}><CabeceraConMenu estado={orden} col={c} lang={lang} t={t} /><span className="col-resizer" onMouseDown={poolCols.startResize(`g_${c.key}`, anchoDePartida(c.key, COLUMN_WIDTHS))} /></th>)}
                  <th>{soloLectura ? "" : vista.cabeceraDeAcciones}</th>
                </tr>
              </thead>
              <tbody>
                {orden.visibles.length === 0 && (
                  <tr><td colSpan={columnas.length + 2} className="empty">{t("No rows match the current filters.", "Ninguna fila coincide con los filtros actuales.")}</td></tr>
                )}
                {orden.visibles.map(fila)}
              </tbody>
            </table>
          </div>
          <MenuDeColumnaAbierto estado={orden} columnas={menu} lang={lang} t={t} />
          </>
        )}
        {/* «Elige conductor para N órdenes» (D-395): sustituye al antiguo desplegable «Asignar selección a…» y al botón
            «Auto-asignar selección» de la barra de arriba (ya no hay Auto-asignar, D-437). Va DESPUÉS de la tabla y pegado al borde de abajo de la ventana
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
        {!soloLectura && poolSelectedCount > 0 && (
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
              {/* «✨ Auto-asignar las marcadas» iba aquí; se quitó en D-437. Repartir automático es «Armar las rutas del día». */}
            </div>
            {/* «Asignar a…» varios choferes (D-474): el mismo recuadro, plegado tras un botón; lo marcado se reparte entre los
                elegidos con el motor de «Armar rutas». Sin nada sin asignar marcado (en «Todas», solo filas con chofer), el
                recuadro de arriba no sale y esta sección va sola, abajo. */}
            {seleccionDelReparto.length > 0 && seccionDeReparto(false)}
          </div>
        )}
        {!soloLectura && poolSelectedCount === 0 && seleccionDelReparto.length > 0 && recuadroDeReparto()}
        </>}
      </div>
    );
  };
  /** El rótulo del chip del DÍA: lo que la pantalla enseña ahora (el «🗓 Todas» de arriba y «Verlas» cambian el modo). */
  const rotuloDelChipDelDia = () => (modo === "dia" ? t("This day", "Este día") : modo === "todas" ? t("All dates", "Todas las fechas") : t("Overdue & undated", "Expiradas y sin fecha"));
  const rotuloDelChip = (f: ChipSinAsignar, cualquierDia: string) =>
    f === "dia" ? rotuloDelChipDelDia() : f === "todas" ? cualquierDia : f === "overdue" ? t("Overdue", "Expiradas") : f === "windowed" ? t("Windowed", "Con ventana") : t("No location", "Sin ubicación");
  const vistaDeSinAsignar: VistaDeOrdenes = {
    clave: "sinAsignar", panel: PANEL_SIN_ASIGNAR, icono: "📦", titulo: t("Unassigned orders", "Órdenes sin asignar"), total: unassigned.length,
    columnas: colsSinAsignar, menu: menuSinAsignar, selector: columnasDelSelector("sinAsignar", ordenGestor), notaDelSelector: t("Saved for you.", "Se guarda para usted."),
    busqueda: orderSearch, onBusqueda: setOrderSearch,
    chip: poolFilter, onChip: setPoolFilter, cuentas: cuentasDeChips, rotuloDelChip: (f) => rotuloDelChip(f, t("All", "Todas")),
    filas: filasDelChip, conBusqueda: unassignedShown, orden: ordenSinAsignar,
    vacio: poolFilter === "dia" ? t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.") : t("No unassigned orders with this filter.", "Ninguna orden sin asignar con este filtro."),
    nadaCoincide: t("No unassigned orders match your search.", "Ninguna orden sin asignar coincide con la búsqueda."),
    pista: t("Drag a row onto a driver in “Drivers & routes” (above) to assign it. Checked rows go together.", "Arrastre una fila a un chofer de «Choferes y rutas» (arriba) para asignarla. Las marcadas van juntas."),
    cabeceraDeAcciones: t("Assign to", "Asignar a"), anchoDeAcciones: 116, caja: cajaSinAsignarRef,
  };
  // «Todas» (D-462): el chip de cualquier día se llama «Todas las fechas», que «Todas» ya es el nombre de la pestaña.
  const vistaDeTodas: VistaDeOrdenes = {
    clave: "todas", panel: PANEL_DE_TODAS, icono: "📋", titulo: t("All orders of the day", "Todas las órdenes del día"), total: todasDelDia.length,
    columnas: colsTodas, menu: menuDeTodas, selector: columnasDelSelectorDeTodas(ordenGestor),
    notaDelSelector: t("The same columns as “Unassigned”: saved for you, for both tables.", "Las mismas columnas que «Sin asignar»: se guarda para usted, para las dos tablas."),
    busqueda: busquedaDeTodas, onBusqueda: setBusquedaDeTodas,
    chip: chipDeTodas, onChip: setChipDeTodas, cuentas: cuentasDeTodasAqui, rotuloDelChip: (f) => rotuloDelChip(f, t("All dates", "Todas las fechas")),
    filas: filasDeTodasDelChip, conBusqueda: todasConBusqueda, orden: ordenDeTodas,
    vacio: chipDeTodas === "dia" ? t("No orders on this date.", "No hay órdenes en esta fecha.") : t("No orders with this filter.", "Ninguna orden con este filtro."),
    nadaCoincide: t("No orders match your search.", "Ninguna orden coincide con la búsqueda."),
    pista: t("Drag an unassigned row onto a driver in “Drivers & routes” (above) to assign it; “Move to…” changes an assigned one's driver.", "Arrastre una fila sin chofer a un chofer de «Choferes y rutas» (arriba) para asignarla; «Pasar a…» cambia de chofer una asignada."),
    cabeceraDeAcciones: t("Assign / move", "Asignar / pasar"), anchoDeAcciones: 136, caja: cajaDeTodasRef,
  };


  return (
    <>
      <div className="page-head">
        <h2>{soloLectura ? t("Today's route", "Ruta de hoy") : t("Routes Manager", "Gestor de Rutas")} <span className="count-tag">{dayOrders.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className="vt" data-dia-anterior disabled={allDates || (soloLectura && fecha <= primerDia)} onClick={() => setDate((d) => shiftDateISO(d, -1))} title={t("Previous day", "Día anterior")}>◀</button>
            <input type="date" value={date} disabled={allDates} min={soloLectura ? primerDia : undefined} max={soloLectura ? rango.max : undefined} onChange={(e) => setDate(e.target.value || todayISO())} style={{ width: "auto" }} />
            <button className="vt" data-dia-siguiente disabled={allDates || (soloLectura && fecha >= rango.max)} onClick={() => setDate((d) => shiftDateISO(d, 1))} title={t("Next day", "Día siguiente")}>▶</button>
          </div>
          {/* D-428: atajos de fecha, siempre a la vista; el día que se mira sale marcado. D-469: también en «Ruta de hoy». */}
          <span data-ayer-hoy-manana style={{ display: "contents" }}>
          {!allDates && ([[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")], [1, t("Tomorrow", "Mañana")]] as const).map(([dias, etiqueta]) => {
            const dia = shiftDateISO(todayISO(), dias);
            return (
              <button key={dias} data-atajo-fecha={dias} className={"btn btn-sm " + (date === dia ? "btn-primary" : "btn-ghost")}
                disabled={soloLectura && (dia < primerDia || dia > rango.max)}
                aria-pressed={date === dia} onClick={() => setDate(dia)}>{etiqueta}</button>
            );
          })}
          </span>
          {!soloLectura && (
          <button
            className={"btn btn-sm " + (allDates ? "btn-primary" : "btn-ghost")}
            onClick={() => { setSoloPendientes(false); setAllDates((v) => !v); }}
            title={t("Show routable orders from every date, not just the selected day", "Mostrar órdenes de todas las fechas, no solo el día elegido")}
          >
            🗓 {allDates ? t("All dates ✓", "Todas ✓") : t("All dates", "Todas")}
          </button>
          )}
          {soloLectura && <span className="hint" data-solo-lectura style={{ margin: 0 }}>{t("View only — routes are built in the Routes Manager.", "Solo lectura — las rutas se arman en el Gestor de Rutas.")}</span>}
          {/* Aquí iban «✨ Auto-asignar» y «🧭 Optimizar todas las rutas»: se quitaron en D-437 («Quitar los dos; solo Armar
              rutas»). Lo automático es «Armar las rutas del día», y este botón es su ÚNICA entrada (D-459): abre y cierra el
              panel del plan, justo debajo. La pastilla dice en qué está el plan de esta fecha sin abrirlo. */}
          {puedeArmarRutas && (
            <button className="btn btn-primary btn-sm" data-armar-rutas aria-expanded={planAbierto} onClick={() => setPlanAbierto((v) => !v)}
              title={t("Build today's routes automatically: plan the day as a draft, adjust it and publish it", "Armar las rutas del día automáticamente: planificar el día en borrador, ajustarlo y publicarlo")}>
              🧭 {t("Build routes", "Armar rutas")} {planAbierto ? "▾" : "▸"}
            </button>
          )}
          {puedeArmarRutas && estadoPlan && (() => {
            const e = textoDelEstadoDelPlan(estadoPlan, lang === "es");
            return (
              <span className="sema" data-estado-del-plan={estadoPlan.tipo} title={e.titulo}
                style={estadoPlan.tipo === "sin_plan" ? { border: "1px solid var(--amber)", color: "var(--amber-text)" } : { border: "1px solid var(--line)", color: "var(--ink-soft)" }}>
                {e.texto}
              </span>
            );
          })()}
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

      {/* Sin la función (falta la migración 160) cada quien ve solo lo que ya podía leer. Se le dice a quien puede arreglarlo (D-467). */}
      {soloLectura && (origenDeHoy === "sin_funcion" || origenDeHoy === "error") && me.role === "admin" && (
        <div className="hint" data-aviso-sin-160 style={{ marginBottom: 8 }}>
          {origenDeHoy === "sin_funcion"
            ? t("Migration 160 (rutas_del_dia) isn't applied yet: each role sees only the orders it could already read, so drivers and warehouse get partial routes.",
                "La migración 160 (rutas_del_dia) aún no está aplicada: cada rol ve solo las órdenes que ya podía leer, así que choferes y almacén ven rutas parciales.")
            : t("The day's routes couldn't be read; showing only the orders you can already read.", "No se pudieron leer las rutas del día; se enseñan solo las órdenes que usted ya puede leer.")}
        </div>
      )}

      {/* El motor nuevo (D-320): planifica en BORRADOR y publica. Convive con todo lo de abajo, que sigue
          igual: «sustituye al actual» se cumple al final, no el primer día. Solo para quien puede publicar
          (admin y logística), y con una fecha concreta: «todas las fechas» no es un día que planificar.
          Sus columnas (D-429) son las de Órdenes: la misma lista, el mismo orden guardado, las mismas plantillas y las mismas
          flechas que «Sin asignar» y paradas — la tercera tabla de la fila `routes_columns`. */}
      {puedeArmarRutas && (
        <PlanDelDia date={date} onPublicado={() => setPublicaciones((n) => n + 1)} abierto={planAbierto}
          onCerrar={() => setPlanAbierto(false)} onEstado={setEstadoPlan}
          onAbrirOrden={(id) => { const d = deliveries.find((x) => x.id === id.split("#")[0]); if (d) setOpenOrder(d); }}
          columnas={{
            // Sin «Plan: Factura»: la factura es la columna fija de esa tabla (D-456), y no se repite ni se lista en su ⚙.
            lista: sinLaFacturaDelPlan(columnasDeLaTabla("plan", colsGestor, ordenGestor)), celda: celdaDelPlan, clase: clasePastillas,
            selector: (
              <SelectorDeColumnas
                columnas={sinLaFacturaDelPlan(columnasDelSelector("plan", ordenGestor))}
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

      {/* Aquí iba la franja de cuatro casillas «Programadas · Sin programar · Total · Rutas», que hacían de pestañas. Se
          quitó (D-459): el dueño, 2026-10-01, «remeuve toda esta barra porque ya esta abajo». Sus cuatro números y el cambio
          de vista están en las pestañas de abajo: «Rutas (N) · N programadas», «Sin asignar (N)» y «Tablero (N)». */}

      {soloPendientes ? (
        <div className="hint" style={{ marginBottom: 8 }}>
          <b>{t("Viewing overdue and undated orders only", "Viendo solo órdenes expiradas y sin fecha")}</b> — {t("they belong to no day until you give them one. Set a date and the order moves to that day.", "no son de ningún día hasta que se les pone uno. Póngale fecha y la orden pasa a ese día.")}{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => setSoloPendientes(false)}>{t("Back to the day", "Volver al día")}</button>
        </div>
      ) : !soloLectura && (pendientes.atrasadas.length + pendientes.sinFecha.length > 0) && !oculto(AVISOS_DEL_GESTOR.atrasadas) && (
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
        {/* «▦ Cuadrícula» se fue a las pestañas de abajo, junto a «Horario» (D-459): cambia las tarjetas de abajo, no el
            mapa. Y «👁 Mostrar avisos ocultos» ya no sale aquí (D-459; D-400 lo puso): va al fondo de la página, en pequeño.
            La explicación del mapa, que era un renglón fijo bajo él (D-400 le dio ✕), es ahora este ⓘ: se lee al pasar. */}
        <span className="hint" data-ayuda-del-mapa tabIndex={0} style={{ margin: 0, cursor: "help" }}
          title={t(
            "Every route is on the map at once. Click a route or a driver to highlight it (the rest dim and the map zooms in); check drivers to compare several. Each route loops from the pickup point (P) out and back; the dashed part is the drive back.",
            "Todas las rutas están en el mapa a la vez. Haz clic en una ruta o un chofer para resaltarla (el resto se atenúa y el mapa hace zoom); marca varios choferes para comparar. Cada ruta hace un ciclo desde el punto de recolección (P) y regresa; lo punteado es el regreso.",
          )}>ⓘ</span>
      </div>

      {/* ---------- Driver panel + map ---------- */}
      {showTop && (<>
      {/* Sticky so the driver pool (and map) stay visible while you scroll the
          route cards below and build routes. Capped height + own scroll so it
          never takes over the screen. */}
      <div ref={panelFijoRef} className="panel-fijo-del-gestor" style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8, background: "var(--paper)", paddingBottom: 6 }}>
        {/* El panel «Choferes y rutas» es `PanelDeChoferes` desde D-467: el mismo que pinta «Ruta de hoy». Lo de aquí que
            aquella no tiene —«Unir», «＋ Ruta», 🔒, ✏, ✕ y soltar una fila encima— entra por sus huecos. */}
        <PanelDeChoferes
          t={t}
          sinRutas={filasDelPanel.length === 0}
          vacio={soloLectura
            ? t("No routes with orders this day.", "Sin rutas con órdenes este día.")
            : t("No routes with orders this day — assign orders, or tap “＋ Route” to build a route without a driver.", "Sin rutas con órdenes este día — asigna órdenes, o toca “＋ Ruta” para armar una ruta sin chofer.")}
          hayMarcadas={focused}
          onMuestraTodos={() => setSelected(new Set())}
          onEnfoca={focusOnly}
          onAlterna={toggleDriver}
          onUbica={veCamiones ? (clave) => setLocateDriver(driverOf(clave)) : undefined}
          acciones={soloLectura ? undefined : <>
            {selected.size >= 2 && (
              <button className="btn btn-primary btn-sm" onClick={mergeSelectedLanes}
                title={t("Combine the checked routes into one (merges into the top-most checked one)", "Combinar las rutas marcadas en una (se unen en la primera marcada)")}>
                🔀 {t("Merge", "Unir")} ({selected.size})
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => addBucket()} title={t("Add a numbered route (Route 1, Route 2…) to build on, then hand it to a driver later", "Agrega una ruta numerada (Ruta 1, Ruta 2…) para armar, y entrégala a un chofer después")}>＋ {t("Route", "Ruta")}</button>
          </>}
          filas={filasDelPanel.map((u) => {
            const stops = byDriver.get(u.key) ?? [];
            // La CARGA MÁXIMA de su lista contra el camión (D-443): lo más cargado que va en algún punto del día. Hasta
            // D-443 era la suma del día, en rojo si pasaba del camión («hace falta otro viaje»); con la lista única el camión
            // recarga a media ruta y la suma del día no dice nada. Rojo solo si en alguna parada se pasa (`cargaDelPanel`).
            return {
              id: u.id, clave: u.key, etiqueta: u.label, color: colorFor(u.driver), paradas: stops.length, info: routeInfo[u.key],
              carga: cargaDelPanel(lecturaDe(u.key, stops), capacityFor(u.driver)), marcada: selected.has(u.key), enVivo: liveNames.has(u.driver),
            };
          })}
          // Soltar aquí una fila de «Sin asignar» la asigna; una parada de otro chofer, la pasa a esta ruta (D-456).
          atributosDe={soloLectura ? undefined : (clave) => ({
            "data-suelta-en-ruta": clave, ...sueltaAqui(clave, null),
            style: { outline: sobre === claveDeSoltar(clave, null) ? "2px dashed var(--accent)" : undefined, outlineOffset: -2 },
          })}
          extrasDe={(clave) => {
            const u = lanes.find((l) => l.key === clave);
            if (!u) return null;
            return (<>
              {!isRealDriver(u.driver) && <span className="sema" style={{ background: "var(--accent)", color: "#fff", fontSize: 10 }}>🧭 {t("route", "ruta")}</span>}
              {bloqueada(u.key) && <span data-candado-en-el-panel title={t("Locked for this day", "Bloqueada este día")}>🔒</span>}
              {u.isBucket && !soloLectura && (
                <button className="notif-clear" title={t("Rename temp driver", "Renombrar chofer temp")}
                  onClick={(e) => { e.stopPropagation(); renameBucket(u.key); }}>✏</button>
              )}
              {u.isBucket && !soloLectura && (
                <button className="notif-clear" title={t("Remove this route", "Quitar esta ruta")}
                  onClick={(e) => { e.stopPropagation(); clearLane(u.key); }}>✕</button>
              )}
            </>);
          }}
        />
        <div className="card" style={{ flex: "3 1 460px", margin: 0, padding: 0, overflow: "hidden" }}>
          <MapView points={points} lines={lines} stores={storeMarkers} liveDrivers={liveDrivers.filter((c) => pasaFiltro(c.driver))} onLineClick={onLineClick} fitTo={fitTo} height={430} onPointClick={(id) => {
            // Click any order pin (assigned or pool) to toggle its PU→DEL view.
            const d = dayOrders.find((x) => x.id === id);
            if (d) toggleOrder(d.id);
          }} />
          {soloLectura && <MapLegend elementos={leyenda} />}
        </div>
      </div>
      </>)}

      {/* ---------- Tabs ---------- */}
      {/* El orden de esta barra (D-459): filtro de chofer · las vistas · Cuadrícula · Deshacer/Rehacer · Incidencias. El
          filtro estaba en la cabecera, junto a la fecha; el dueño, 2026-10-01: «mueve eseo filtro del conducto abajo al lado
          de timeline». Lo que filtra son las tarjetas de aquí abajo (y el panel y el mapa). Misma función, lo mismo guardado. */}
      <div data-barra-de-vistas style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {/* El desplegable «Todos los choferes» (D-393/D-459) se fue (D-481): el filtro son las casillas del panel «Choferes y
              rutas». Aquí solo se dice con quién se está, y se quita de un toque. */}
          {filtroChofer.size > 0 && (
            <span className="sema" data-filtro-de-chofer style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--accent)", color: "var(--accent)", background: "var(--card)" }}
              title={t("Only the drivers checked in “Drivers & routes” are shown", "Solo se ven los choferes marcados en «Choferes y rutas»")}>
              🚚 {[...filtroChofer].map(laneLabel).join(", ")}
              <button className="notif-clear" data-quita-filtro onClick={() => setSelected(new Set())} title={t("Show every driver", "Ver todos los choferes")}>✕</button>
            </span>
          )}
      {/* `flexWrap` (D-462): con cinco pestañas, a 390 px la última se cortaba 13 px por el `overflow: hidden` de la caja
          (medido: 377 px de pestañas en 364 de caja; con cuatro cabían justas). Envueltas, bajan de línea dentro de la caja. */}
      <div className="viewtoggle" style={{ flexWrap: "wrap" }}>
        {/* Los cuatro números de la franja que iba arriba (D-459) viven aquí: las rutas y cuántas órdenes tienen chofer
            («programadas»), las que no («sin asignar», en ámbar si hay alguna, como arriba) y el total del día. */}
        <button className={"vt " + (tab === "routes" ? "on" : "")} data-pestana="routes" onClick={() => setTab("routes")}
          title={t(`${withStops.filter((u) => pasaFiltro(u.key)).length} route(s) · ${scheduledCount} order(s) scheduled (with a driver)`, `${withStops.filter((u) => pasaFiltro(u.key)).length} ruta(s) · ${scheduledCount} orden(es) programadas (con chofer)`)}>
          🧭 {t("Routes", "Rutas")} ({withStops.filter((u) => pasaFiltro(u.key)).length}) · <span data-cuenta-programadas>{t(`${scheduledCount} scheduled`, `${scheduledCount} programadas`)}</span>
        </button>
        <button className={"vt " + (tab === "orders" ? "on" : "")} data-pestana="orders" onClick={() => setTab("orders")}>
          📦 {t("Unassigned", "Sin asignar")} (<span data-cuenta-sin-programar style={unassigned.length > 0 && tab !== "orders" ? { color: "var(--amber)", fontWeight: 800 } : undefined}>{unassigned.length}</span>)
        </button>
        {/* «Todas (N)» (D-462): todas las del día, con chofer o sin él, más lo ya hecho. N sigue al filtro de chofer:
            con uno elegido, las suyas y las sin asignar. */}
        <button className={"vt " + (tab === "todas" ? "on" : "")} data-pestana="todas" onClick={() => setTab("todas")}
          title={filtroChofer.size === 0
            ? t(`${todasDelDia.length} order(s) this day, with or without a driver, delivered ones included`, `${todasDelDia.length} orden(es) este día, con chofer o sin él, entregadas incluidas`)
            : t(`${todasDelDia.length} order(s) this day: ${[...filtroChofer].map(laneLabel).join(", ")}'s and the unassigned ones`, `${todasDelDia.length} orden(es) este día: las de ${[...filtroChofer].map(laneLabel).join(", ")} y las sin asignar`)}>
          📋 {t("All", "Todas")} (<span data-cuenta-todas>{todasDelDia.length}</span>)
        </button>
        {/* El tablero es arrastrar para asignar: no en solo lectura. */}
        {!soloLectura && (
        <button className={"vt " + (tab === "board" ? "on" : "")} data-pestana="board" onClick={() => setTab("board")}
          title={t(`${dayOrders.length} order(s) in total this day`, `${dayOrders.length} orden(es) en total este día`)}>
          🗂 {t("Board", "Tablero")} (<span data-cuenta-total>{dayOrders.length}</span>)
        </button>
        )}
        <button className={"vt " + (tab === "timeline" ? "on" : "")} data-pestana="timeline" onClick={() => setTab("timeline")}>📅 {t("Timeline", "Horario")}</button>
      </div>
        {/* «▦ Cuadrícula» junto a «Horario» (D-459). El dueño, 2026-10-01: «el grid buttom que este al lado de timeline
            prorque afecta directamnete lo de abajo». Estaba arriba, junto a «Ocultar mapa y choferes». Misma función, mismo
            título; sigue saliendo solo en «Rutas», que es lo que cambia. */}
        {tab === "routes" && (
          <button className="btn btn-ghost btn-sm" data-cuadricula aria-pressed={!wideRoutes} onClick={() => setWideRoutes((v) => !v)}
            title={t("Toggle full-width route cards vs a compact grid", "Alternar tarjetas de ruta a ancho completo o cuadrícula compacta")}>
            {wideRoutes ? "▦ " + t("Grid", "Cuadrícula") : "▭ " + t("Wide", "Ancho")}
          </button>
        )}
        {/* Deshacer / rehacer los movimientos a mano de esta sesión (D-417): arrastrar en «Horario» y las flechas. */}
        {!soloLectura && (tab === "timeline" || historial.deshacer.length > 0 || historial.rehacer.length > 0) && (
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
        {/* ⚠ Incidencias (D-437): un botón, a la derecha de las pestañas, que abre la ventana. Ámbar si hay alguna
            registrada (las incidencias no tienen estado «abierta»: se registran y se borran). */}
        {!soloLectura && (
        <button className={"btn btn-sm " + (incidents.length ? "btn-amber" : "btn-ghost")} data-abrir-incidencias
          style={{ marginLeft: "auto" }} aria-haspopup="dialog" onClick={() => setIncidenciasAbiertas(true)}>
          ⚠ {t("Incidents", "Incidencias")} ({incidents.length})
        </button>
        )}
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
            {modo === "dia" && !soloLectura && <> {t("Drag a stop to another slot or driver, or onto a driver's name for 📍 Best fit. Ctrl+Z undoes.", "Arrastre una parada a otro hueco o chofer, o al nombre de un chofer para 📍 Mejor lugar. Ctrl+Z deshace.")}</>}
          </p>
          {filasDelGantt.every((r) => r.barras.length === 0)
            ? <div className="empty">{t("No assigned orders to show yet.", "Aún no hay órdenes asignadas.")}</div>
            : <GanttTimeline rows={filasDelGantt} t={t}
                arrastre={modo === "dia" && !soloLectura ? { inicioMin: DAY_START_MIN, previa: previaDeSoltar, suelta: (id, destino) => void sueltaEnLaLinea(id, destino), ocupado: moviendo } : undefined} />}
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
      {tab === "orders" && tablaDeOrdenes(vistaDeSinAsignar)}

      {/* ---------- Todas las del día (D-462) ---------- */}
      {tab === "todas" && tablaDeOrdenes(vistaDeTodas)}

      {/* ---------- Per-driver routes ---------- */}
      {tab === "routes" && (
      <div data-tarjetas-de-ruta={wideRoutes ? "ancho" : "cuadricula"} style={{ display: "grid", gridTemplateColumns: wideRoutes ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, alignItems: "start" }}>
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
      {tarjetasDeRuta.map(([u, modoDeTarjeta]) => {
        // Qué lleva esta tarjeta (D-481, e): la compacta, solo la cabecera sin botones; la desplegada, todo; la ancha, lo de siempre.
        const acciones = conAcciones(soloLectura, modoDeTarjeta);
        const desplegadaAqui = modoDeTarjeta === "desplegada" || (modoDeTarjeta === "compacta" && rutaDesplegada === u.key);
        const stops = byDriver.get(u.key) ?? [];
        const sequenced = stops.length > 0 && stops.every((d) => d.route_seq != null);
        const missingPins = stops.filter((d) => d.delivery_lat == null).length;
        const info = routeInfo[u.key];
        const capacity = capacityFor(u.driver);
        // La ruta como UNA lista (D-443): recogidas y entregas intercaladas, leídas como P1, P2… D1, D2… (D-334). Con plan
        // publicado y la ruta tal como el plan la dejó, mandan SUS paradas y etiquetas; si se tocó después, lo guardado, y se
        // avisa (D-335). Se decide por chofer.
        const lectura = lecturaDe(u.key, stops);
        const porId = new Map(stops.map((d) => [d.id, d]));
        // Lo ya hecho de este chofer hoy (D-459): sus filas se intercalan donde iban, sin índice —nada las mueve—, y no
        // entran en `lectura`, `cuenta` ni la medida, que siguen siendo de lo pendiente.
        const hechas = hechasDe(u.key);
        const hechasPorId = new Map(hechas.map((d) => [d.id, d]));
        const pintadas = filasConLoHecho(lectura, stops, hechas, capacity, paradasPublicadasDe(u.key));
        const entregas = resumenDeEntregas(stops, hechas);
        const hayFilas = stops.length > 0 || hechas.length > 0;
        // ↶ ↷ en la tarjeta (D-459): el historial es uno, global; el botón se enciende si el último movimiento tocó esta ruta.
        const deshace = botonDeVolver(historial, "deshacer", u.key, laneLabel);
        const rehace = botonDeVolver(historial, "rehacer", u.key, laneLabel);
        /** Una fila ya HECHA: la recogida de una orden recogida o entregada, o su entrega. Informa; no lleva flechas, ni
         *  «Pasar a…», ni ✕, ni se arrastra, ni es sitio donde soltar. La factura sigue abriendo la orden. */
        const filaYaHecha = (fp: Extract<FilaPintada, { hecha: true }>) => {
          const d = hechasPorId.get(fp.orden);
          if (!d) return null;
          const hecho = fp.estado === "hecho";
          const hora = hecho ? horaReal(d, fp.tipo) : null;
          const que = fp.tipo === "P" ? { en: "Picked up", es: "Recogida" } : hecho ? { en: "Delivered", es: "Entregada" } : { en: "On the truck, on its way", es: "En el camión, en camino" };
          return (
            <tr key={`hecha-${fp.tipo}-${d.id}`} data-hecha={fp.estado} data-hecha-tipo={fp.tipo} className={hecho ? "row-done fila-hecha" : "fila-hecha"}
              title={t(`${que.en}${hora ? ` at ${hora}` : ""} — it stays on the list; it can't be moved`, `${que.es}${hora ? ` a las ${hora}` : ""} — sigue en la lista; no se mueve`)}>
              <td style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700 }}>{hecho ? "✓" : "🚚"}{fp.tipo}</td>
              <td className="ordno">{facturaConSuId(d)}{etiquetaDeLaCarga(d)}</td>
              {/* Lo que movió, sin el «= a bordo»: no cuenta en la carga pendiente. */}
              <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{fp.tipo === "P" ? "+" : "−"}{numeroDePallets(palletsDeLaOrden(d))}</td>
              {colsParadas.map((c) => {
                if (c.key === "p_type") return <td key={c.key} title={d.order_type || undefined}>{d.order_type || "—"}</td>;
                // La hora REAL, si se guardó; si no, solo que está hecha. Nunca la estimada.
                if (c.key === "p_eta") return <td key={c.key} data-hora-real={hora ?? ""} style={{ fontWeight: 600 }}>{hecho ? `✓ ${hora ?? t(fp.tipo === "P" ? "picked up" : "delivered", fp.tipo === "P" ? "recogida" : "entregada")}` : `🚚 ${t("on its way", "en camino")}`}</td>;
                if (c.key === "p_ciudad_recogida") return <td key={c.key}>{fp.tipo === "P" ? <b>{(d.store ?? "").trim() || "—"}</b> : zonaDeLaRecogida(d, settings.stores ?? [], ciudadesQueSeConocen) || "—"}</td>;
                if (c.key === "p_address") return <td key={c.key} title={d.delivery_address || undefined}>{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || "—"}</td>;
                if (c.key === "p_windows") return <td key={c.key}>{fp.tipo === "D" ? fmtWindows(d.delivery_windows) : ""}</td>;
                if (fp.tipo === "P" && !seVeEnLaRecogida(c)) return <td key={c.key} />;
                return <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, d)}</td>;
              })}
              <td className="celda-acciones" />
            </tr>
          );
        };
        // La cuenta de pallets de cada fila, visible de partida: «+4 = 4», lo de la parada y el total a bordo (D-444).
        const cuenta = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacity);
        // Filas SEGUIDAS en el mismo sitio (D-444): cada una en su fila, pintadas como grupo con un tono más fuerte.
        const grupos = gruposDeMismoLugar(lectura.paradas, stops);
        const claseDeGrupo = (f: FilaDeLaRuta): string => {
          const g = f.indice != null ? grupos[f.indice] : null;
          if (g == null || f.indice == null) return "";
          const inicio = f.indice === 0 || grupos[f.indice - 1] !== g;
          return ` fila-grupo-${f.tipo === "P" ? "recoger" : "entregar"}${inicio ? " fila-grupo-inicio" : ""}`;
        };
        // Nadie la ordenó: su P/D sale igual, provisional y en gris (D-379); y, fila a fila, lo que aún no tiene puesto.
        const provisional = esProvisional(stops);
        const isC = isCollapsed(u.key);
        // La compacta de «Cuadrícula» no lleva cuerpo; la desplegada, siempre; la ancha, si no está plegada (D-481, e).
        const sinCuerpo = !conCuerpo(modoDeTarjeta, isC);
        // En qué está la medida de esta ruta, para la columna «Llegada» y la cabecera (D-456).
        const medida = estadoDeLaMedida(u.key, stops);
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
          <div className={claseDeTarjeta(modoDeTarjeta, desplegadaAqui)} key={`${modoDeTarjeta}-${u.id}`} data-tarjeta-de-ruta={u.key} data-modo-de-tarjeta={modoDeTarjeta} {...sueltaAqui(u.key, null)}
            style={{ margin: 0, gridColumn: modoDeTarjeta === "desplegada" ? "1 / -1" : undefined, outline: sobre === claveDeSoltar(u.key, null) ? "2px dashed var(--accent)" : undefined, outlineOffset: -2 }}
            onClick={() => setSelectedOrders((prev) => (prev.size ? new Set() : prev))}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              {/* La desplegada de «Cuadrícula» no repite nombre ni números (D-482): ya están en su tarjeta compacta de arriba, que
                  queda pegada a ella. Solo trae la barra de acciones y la tabla. */}
              {conCabecera(modoDeTarjeta) && (<>
              {modoDeTarjeta === "ancha" && (
                <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} onClick={() => toggleCollapse(u.key)} title={t("Collapse", "Contraer")}>{isC ? "▸" : "▾"}</button>
              )}
              {/* El NOMBRE (D-481, e): en «Ancho», resalta la ruta en el mapa, como siempre; en «Cuadrícula», despliega su tabla
                  abajo (otro nombre la cambia; el mismo la pliega). */}
              <span
                data-nombre-de-ruta={u.key}
                aria-expanded={modoDeTarjeta === "ancha" ? undefined : desplegadaAqui}
                onClick={() => (modoDeTarjeta === "ancha" ? focusOnly(u.key) : setDesplegada((x) => alternaDesplegada(x, u.key)))}
                title={modoDeTarjeta === "ancha" ? t("Show this route on the map", "Mostrar esta ruta en el mapa")
                  : desplegadaAqui ? t("Hide this route's stops", "Plegar las paradas de esta ruta") : t("Show this route's stops below", "Desplegar las paradas de esta ruta abajo")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", ...(modoDeTarjeta === "compacta" && desplegadaAqui ? { textDecoration: "underline", textUnderlineOffset: 4 } : {}) }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.driver), border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
                <h2 style={{ margin: 0 }}>{u.label}</h2>
                <span className="hint" style={{ fontSize: 12 }}>{modoDeTarjeta === "ancha" ? "🗺" : desplegadaAqui ? "▾" : "▸"}</span>
              </span>
              {needsDriver && <span className="sema" style={{ background: "var(--accent)", color: "#fff" }}>🧭 {t("route (no driver)", "ruta (sin chofer)")}</span>}
              {/* «⚠ sin base» (D-459): era un renglón entero bajo el nombre; el dueño, 2026-10-01, «remueve todo ese texto
                  incesario». El dato no se pierde: una pastilla, con la frase entera al pasar el ratón. */}
              {!tiendaBaseDe(u.key) && stops.length > 0 && (
                <span className="sema" data-sin-base tabIndex={0} style={{ border: "1px solid var(--amber)", color: "var(--amber-text)", cursor: "help" }}
                  title={t(
                    "This driver has no base store (Settings → Routes) nor a home store (Users), so the route can't be anchored to a base — it is measured and optimized as an open route instead of a round trip.",
                    "Este chofer no tiene tienda base (Ajustes → Rutas) ni tienda en su perfil (Usuarios), así que la ruta no puede anclarse a una base — se mide y se optimiza como ruta abierta en vez de ida y vuelta.",
                  )}>⚠ {t("no base", "sin base")}</span>
              )}
              {/* «Aún sin orden guardado…» era otro renglón (D-459): ahora una pastilla gris con la frase al pasar. */}
              {stops.length > 0 && !sequenced && (
                <span className="sema" data-sin-orden-guardado tabIndex={0} style={{ border: "1px solid var(--line)", color: "var(--gray)", cursor: "help" }}
                  title={t(
                    "No saved order yet — set it with the ↑/↓ arrows or 📍 Best fit, or plan the day with “Build routes”. The grey P/D labels follow the current order.",
                    "Aún sin orden guardado — póngalo con las flechas ↑/↓ o 📍 Mejor lugar, o planifique el día con «Armar rutas». Las etiquetas P/D en gris siguen el orden de ahora.",
                  )}>{t("no saved order", "sin orden guardado")}</span>
              )}
              {bucket && acciones && <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} title={t("Rename temp driver", "Renombrar chofer temp")} onClick={() => renameBucket(u.key)}>✏</button>}
              {/* Órdenes, no paradas (D-443): cada orden son dos paradas —su recogida y su entrega— y las paradas de la lista
                  las cuenta la línea de totales de al lado. Con las dos diciendo «paradas», 4 y 7 se contradecían. */}
              <span className="count-tag">{stops.length} {t("orders", "órdenes")}</span>
              {/* «3 de 7 entregadas» (D-459): lo entregado contra todo lo del chofer ese día. Lo de la izquierda sigue siendo lo
                  PENDIENTE, que es lo que cuentan los pallets y la carga máxima. */}
              {hechas.length > 0 && (
                <span className="sema" data-resumen-de-entregas style={{ background: "var(--green-soft)", color: "var(--green)", border: "1px solid var(--green)" }}
                  title={t(`${entregas.entregadas} delivered of this driver's ${entregas.total} order(s) today; ${stops.length} still pending`, `${entregas.entregadas} entregada(s) de las ${entregas.total} orden(es) de este chofer hoy; ${stops.length} pendiente(s)`)}>
                  ✓ {t(`${entregas.entregadas} of ${entregas.total} delivered`, `${entregas.entregadas} de ${entregas.total} entregadas`)}
                </span>
              )}
              {/* Sin viajes (D-443): ni «N viajes», ni «Ver un viaje» (D-441), ni «viajes fijados / agrupado automáticamente».
                  Lo que dice la cabecera es la cuenta de la lista: paradas, pallets movidos y la carga máxima contra el camión. */}
              {stops.length > 0 && (
                <span className="hint" data-totales-de-la-lista style={{ marginTop: 0 }}>
                  {cuenta.totales.paradas} {t("stops", "paradas")} · {numeroDePallets(cuenta.totales.palletsMovidos)} {t("pallets moved", "pallets movidos")} · {t("peak load", "carga máxima")} {numeroDePallets(cuenta.totales.cargaMaxima)}/{capacity}
                </span>
              )}
              {cuenta.totales.paradasConExceso > 0 && (
                <span className="sema" data-exceso-en-la-ruta style={{ background: "var(--red)", color: "#fff" }}
                  title={t("At these stops the truck carries more than its capacity — see the row", "En estas paradas el camión lleva más de lo que le cabe — mire la fila")}>
                  ⚠ {t(`over capacity at ${cuenta.totales.paradasConExceso} stop(s)`, `se pasa en ${cuenta.totales.paradasConExceso} parada(s)`)}
                </span>
              )}
              {stops.length > 0 && cuenta.totales.finalNoCero && (
                <span className="sema" data-no-acaba-en-cero style={{ background: "var(--red)", color: "#fff" }}>⚠ {t("doesn’t end at 0 pallets", "no acaba en 0 pallets")}</span>
              )}
              {info && (
                <span
                  className="hint"
                  style={{ marginTop: 0 }}
                  title={t(
                    `${info.duration_text} driving; the rest is unloading and reloading at the pickups`,
                    `${info.duration_text} manejando; el resto es descarga y recarga en las recogidas`,
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
              {/* La medida de la ruta, a la vista (D-456): mientras llega, «calculando»; si falló, se dice y se puede reintentar. */}
              {medida === "calculando" && <span className="hint" data-medida="calculando" style={{ marginTop: 0 }}>⏳ {t("calculating arrivals…", "calculando llegadas…")}</span>}
              {medida === "fallo" && (
                <button className="btn btn-ghost btn-sm" data-reintentar-medida={u.key} style={{ color: "var(--amber-text)" }}
                  title={t("The route couldn't be measured (no network, or the routing service didn't answer). Click to try once more.", "No se pudo medir la ruta (sin red, o el servicio de rutas no contestó). Pulse para probar una vez más.")}
                  onClick={(e) => { e.stopPropagation(); reintentaLaMedida(u.key); }}>
                  ↻ {t("not measured — retry", "sin medida — reintentar")}
                </button>
              )}
              </>)}
              <span style={{ flex: 1 }} />
              {acciones && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--gray)" }}>
                🚚 {t("Truck capacity", "Capacidad del camión")}
                <input
                  type="number" min={1} value={capacity}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) setCapacity(u.driver, v); }}
                  style={{ width: 60 }}
                />
                {t("plt", "trm")}
              </label>
              )}
              {/* ↶ ↷ (D-459), a la vista junto a Bloquear / Optimizar / Vaciar. El dueño, 2026-10-01: «aqui pon un undo redo
                  para los movimientos del orden de las cargas para areglar un error si pasa». Llaman al MISMO historial que
                  Ctrl+Z y que los de la barra de vistas (`vuelve`); el título dice QUÉ deshacen (`botonDeVolver`).
                  Los cinco botones van en UN grupo, para que al faltar sitio bajen juntos y no se separen. */}
              {acciones && (
              <span data-acciones-de-la-ruta style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              <span style={{ display: "inline-flex", gap: 4 }}>
                <button className="btn btn-ghost btn-sm" data-deshacer-en-ruta={u.key} disabled={moviendo || !deshace.activo}
                  title={t(deshace.titulo.en, deshace.titulo.es)} onClick={(e) => { e.stopPropagation(); void vuelve("deshacer"); }}>
                  ↶ {t("Undo", "Deshacer")}
                </button>
                <button className="btn btn-ghost btn-sm" data-rehacer-en-ruta={u.key} disabled={moviendo || !rehace.activo}
                  title={t(rehace.titulo.en, rehace.titulo.es)} onClick={(e) => { e.stopPropagation(); void vuelve("rehacer"); }}>
                  ↷ {t("Redo", "Rehacer")}
                </button>
              </span>
              {/* 🔒 (D-411): por ruta y por día. Bloqueada, ni «Armar rutas» ni «Mejor lugar» la tocan; las flechas y
                  «Asignar» sí. (Optimizar, Auto-asignar y Simular, que también la respetaban, se quitaron en D-437.) */}
              <button className={bloqueada(u.key) ? "btn btn-amber btn-sm" : "btn btn-ghost btn-sm"} data-candado={u.key}
                data-candado-fuente={candados.fuente} aria-pressed={bloqueada(u.key)}
                title={`${bloqueada(u.key)
                  ? t(`Locked for this day${bloqueadaPor(u.key) ? ` by ${bloqueadaPor(u.key)}` : ""}: Build routes and Best fit leave it alone. Click to unlock.`, `Bloqueada este día${bloqueadaPor(u.key) ? ` por ${bloqueadaPor(u.key)}` : ""}: Armar rutas y Mejor lugar no la tocan. Pulse para desbloquear.`)
                  : t("Lock this route for this day, so Build routes and Best fit leave it alone (arrows still work).", "Bloquear esta ruta este día, para que Armar rutas y Mejor lugar no la toquen (las flechas sí).")} ${t(dondeViveElCandado(candados).en, dondeViveElCandado(candados).es)}`}
                onClick={(e) => { e.stopPropagation(); void alternaCandado(u.key); }}>
                {bloqueada(u.key) ? `🔒 ${t("Locked", "Bloqueada")}` : `🔓 ${t("Lock", "Bloquear")}`}
              </button>
              {/* «🧭 Optimizar» (D-456, rehecho en D-461; D-437 lo había quitado): reordena SOLO esta ruta —por calles, mirando
                  las ventanas y saliendo de la base del chofer—, sin romper «recoger antes de entregar» ni pasarse de la
                  capacidad, y la guarda (Ctrl+Z la deshace). Con candado 🔒 no la toca y lo dice: el botón se ve apagado pero
                  se puede pulsar, para que diga por qué. */}
              {stops.length > 0 && (
                <button className="btn btn-ghost btn-sm" data-optimizar={u.key} disabled={optimizando != null || moviendo} aria-disabled={bloqueada(u.key) || undefined}
                  style={bloqueada(u.key) ? { opacity: 0.5 } : undefined}
                  title={bloqueada(u.key)
                    ? t("Locked 🔒: Optimize leaves this route alone. Unlock it first.", "Bloqueada 🔒: Optimizar no toca esta ruta. Desbloquéela primero.")
                    : t("Reorder ONLY this route's stops, by street times from the driver's base: first within capacity, then every delivery inside its window, then the shortest day. Every pickup stays before its delivery. Ctrl+Z undoes it.", "Reordenar SOLO las paradas de esta ruta, con tiempos por calles desde la base del chofer: primero sin pasarse de la capacidad, después cada entrega dentro de su ventana, y después la jornada más corta. Cada recogida, antes que su entrega. Ctrl+Z lo deshace.")}
                  onClick={(e) => { e.stopPropagation(); void optimizaLaRuta(u.key); }}>
                  🧭 {optimizando === u.key ? t("Optimizing…", "Optimizando…") : t("Optimize", "Optimizar")}
                </button>
              )}
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
              {/* «Unir viajes» y «Dividir en 2» (D-437) se fueron con los viajes (D-443): la ruta es una lista. */}
              {stops.length > 0 && (
                <button className="btn btn-danger btn-sm" title={t("Clear this route — send every stop back to Unassigned", "Vaciar esta ruta — devolver todas las paradas a Sin asignar")}
                  onClick={() => clearLane(u.key)}>🗑 {t("Clear", "Vaciar")}</button>
              )}
              </span>
              )}
            </div>
            {!sinCuerpo && <>
            {lateStops.length > 0 && (
              <div className="card" style={{ marginBottom: 8, background: "var(--red-soft)", borderColor: "var(--red)" }}>
                <b style={{ color: "var(--red)" }}>⚠️ {t(`${lateStops.length} stop(s) will miss their delivery window`, `${lateStops.length} parada(s) no llegarán a tiempo a su ventana`)}</b>
                <div className="hint" style={{ marginTop: 2 }}>
                  {lateStops.slice(0, 6).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}`).join(", ")}{lateStops.length > 6 ? "…" : ""}
                  {" — "}{t("reorder the stops or move some to another driver.", "reordene las paradas o mueva algunas a otro chofer.")}
                </div>
              </div>
            )}
            {/* Tres renglones se fueron de aquí (D-459; el dueño, 2026-10-01, «remueve todo ese texto incesario»): «Total (desde
                la base y de regreso)…», que repetía las millas y la jornada de la cabecera; «Este chofer no tiene tienda
                asignada…» y «Aún sin orden guardado…», que ahora son las pastillas «⚠ sin base» y «sin orden guardado» junto al
                nombre, con la frase entera al pasar. Los avisos de problema real de abajo (no llega a su ventana, parada sin
                pin, solo ciudad) se quedan.
                El «💡 supera la capacidad, por eso recarga entre cargas» se fue con los viajes (D-443): la lista ya lleva sus
                recargas, y la parada donde se pasa lo dice en su fila. */}
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
            {/* Las paradas de este chofer cuya dirección es SOLO una ciudad (D-454). Va aquí, fuera de la tabla, porque
                la columna «Ciudad de entrega» se puede quitar y el aviso no puede depender de qué columnas eligió nadie:
                el punto de esas paradas es el centro de la ciudad, y el chofer no debe salir sin la dirección. */}
            {stops.some(ordenSoloCiudad) && (
              <div className="card" data-solo-ciudad-ruta style={{ marginBottom: 8, background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
                <b style={{ color: "var(--amber-text)" }}>⚠ {t(AVISO_SOLO_CIUDAD.en, AVISO_SOLO_CIUDAD.es)}</b>
                <div className="hint" style={{ marginTop: 2 }}>
                  {stops.filter(ordenSoloCiudad).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""} — ${d.delivery_address}`).join(" · ")}
                  {" — "}{t("the pin is the city centre. Get the street address before the driver leaves.", "el pin es el centro de la ciudad. Consiga la dirección con calle antes de que salga el chofer.")}
                </div>
              </div>
            )}
            {hayFilas && !soloLectura && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                {/* La línea «✋ Arrastre una fila…» (D-456) se fue (D-459): es el `title` de la cabecera de la tabla. */}
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
            {hayFilas && (
              <>
              <BarraSuperior caja={cajaDeParadas(u.key)} />
              <div className="tbl-scroll tbl-fit tbl-caja" ref={cajaDeParadas(u.key)} style={estiloDeCaja}>
                {/* Address stays on one line (narrow by default) with an
                    expand/contract toggle, so Windows + the action arrows never
                    get pushed off the right edge. Width pinned to the column
                    sum; columns still draggable. */}
                <table className="orders tbl-resize tabla-de-paradas" style={{ width: ["_n", "_factura", "_cuenta", ...colsParadas.map((c) => c.key), "_acciones"].reduce((sum, k) => sum + anchoDeParada(k), 0) }}>
                  {/* Número de parada, factura y la CUENTA DE PALLETS (D-443, fija y visible siempre), las elegidas en el orden de
                      la persona (D-410), y las acciones al final. Todo por CLAVE: el ancho viaja con la columna cuando se mueve. */}
                  <colgroup>
                    <col style={{ width: anchoDeParada("_n") }} />
                    <col style={{ width: anchoDeParada("_factura") }} />
                    <col style={{ width: anchoDeParada("_cuenta") }} />
                    {colsParadas.map((c) => <col key={c.key} style={{ width: anchoDeParada(c.key) }} />)}
                    <col style={{ width: anchoDeParada("_acciones") }} />
                  </colgroup>
                  <thead>
                    <tr data-pista-de-arrastre title={t("Drag a row to another position, or onto another driver, to move it. The ↑ ↓ arrows still work.", "Arrastre una fila a otro puesto, o a otro chofer, para moverla. Las flechas ↑ ↓ siguen ahí.")}>
                      <th style={{ whiteSpace: "nowrap" }}>
                        {/* «Seleccionar todas las visibles» de esta ruta (D-474): lo pendiente de la tarjeta; lo hecho no se marca. */}
                        {!soloLectura && <input type="checkbox" data-marca-todas={u.key} checked={stops.length > 0 && stops.every((d) => marcadas.has(d.id))} disabled={stops.length === 0}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => setMarcadas((s) => { const n = new Set(s); const todas = stops.every((d) => n.has(d.id)); for (const d of stops) { if (todas) n.delete(d.id); else n.add(d.id); } return n; })}
                          aria-label={t(`Select every order of ${u.label}`, `Marcar todas las órdenes de ${u.label}`)} style={{ width: 13, height: 13, margin: "0 3px 0 0", verticalAlign: "middle" }} />}
                        #<span className="col-resizer" onMouseDown={asaDeParada("_n")} />
                      </th>
                      {/* La FACTURA, con el ID al lado (D-459; D-456 lo ponía debajo; D-444 había puesto solo el ID). La clave del ancho sigue siendo `_factura`. */}
                      <th data-columna-factura title={t("The invoice opens the order; its ID goes next to it", "La factura abre la orden; al lado va su ID")}>{t("Invoice #", "Factura #")}<span className="col-resizer" onMouseDown={asaDeParada("_factura")} /></th>
                      <th data-columna-cuenta title={t("What this stop loads (+) or unloads (−) = pallets on board after it", "Lo que carga (+) o descarga (−) esta parada = pallets a bordo después")}>
                        {t("Pallets", "Pallets")}<span className="col-resizer" onMouseDown={asaDeParada("_cuenta")} />
                      </th>
                      {/* El rótulo es el del catálogo sin su «Paradas: » (el de Órdenes, para las que vienen de allí). */}
                      {colsParadas.map((c) => <th key={c.key}>{(lang === "es" ? c.es : c.en).replace(/^[^:]+: /, "")}<span className="col-resizer" onMouseDown={asaDeParada(c.key)} /></th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequenced && lectura.cambioTrasPublicar && (
                      <tr><td colSpan={columnasDeParadas} className="hint" style={{ color: "var(--amber-text)" }}>⚠ {t("This route changed after the plan was published: the P/D labels were recalculated.", "Esta ruta cambió desde que se publicó el plan: las etiquetas P/D se recalcularon.")}</td></tr>
                    )}
                    {/* La Base (D-443): la ruta sale de ella con 0 a bordo y vuelve a ella con 0. Si al volver no da 0, se marca. */}
                    {filaDeLaBase(u.key, "salida", cuenta.salida, false)}
                    {/* Las pendientes, que son las de siempre (`lectura.filas`, con su índice), y las ya hechas donde iban. */}
                    {pintadas.map((fp) => {
                      if (fp.hecha) return filaYaHecha(fp);
                      const f = fp.fila;
                      const fi = fp.i;
                      const cu = cuenta.paradas[fi];
                      const gris = esProvisionalLaFila(f, porId);
                      const movible = f.indice != null;
                      const clave = claveDeLaFila(f);
                      const resaltada = recienMovida === clave;
                      // ARRASTRAR la fila (D-456): cualquier parada que también muevan las flechas. Soltada sobre otra fila toma
                      // su puesto; la raya marca dónde cae (arriba, o abajo si viene de más arriba en la misma lista).
                      const seArrastra = !soloLectura && movible && (f.tipo === "D" || hayRecogidaGuardada);
                      const arrastre = seArrastra ? filaArrastrable({ tipo: "parada", ruta: u.key, indice: f.indice! }) : {};
                      const soltar = movible ? sueltaAqui(u.key, f.indice!) : {};
                      const vieneDeArriba = arrastrado?.tipo === "parada" && arrastrado.ruta === u.key && arrastrado.indice < (f.indice ?? 0);
                      const claseDeSoltar = movible && sobre === claveDeSoltar(u.key, f.indice!) ? (vieneDeArriba ? " suelta-abajo" : " suelta-arriba") : "";
                      const esLaArrastrada = arrastrado?.tipo === "parada" && arrastrado.ruta === u.key && arrastrado.indice === f.indice;
                      // Las flechas de una fila: cualquier parada, P o D (D-443). Apagadas en el borde de la lista, y en una
                      // recogida si la base no guarda su posición (sin la 154). La precedencia la mira `mueveEnLaLista` al pulsar.
                      const flechas = acciones && movible && (
                        <>
                          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-sube-parada
                            disabled={f.indice === 0 || (f.tipo === "P" && !hayRecogidaGuardada)} onClick={() => void mueveParada(u.key, f.indice!, -1)}
                            title={f.tipo === "P" && !hayRecogidaGuardada ? t("Needs the database update (154) to save where a pickup goes", "Necesita la actualización de la base (154) para guardar dónde va una recogida") : t("Move up", "Subir")}>↑</button>
                          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-baja-parada
                            disabled={f.indice === lectura.paradas.length - 1 || (f.tipo === "P" && !hayRecogidaGuardada)} onClick={() => void mueveParada(u.key, f.indice!, 1)}
                            title={f.tipo === "P" && !hayRecogidaGuardada ? t("Needs the database update (154) to save where a pickup goes", "Necesita la actualización de la base (154) para guardar dónde va una recogida") : t("Move down", "Bajar")}>↓</button>
                        </>
                      );
                      // «Pasar a…» otro chofer (D-443, en las P y en las D): las órdenes de la parada, enteras.
                      const ordenesDeLaFila = f.tipo === "P" ? f.ordenes : [f.orden];
                      const pasar = acciones && movible && lanes.length > 1 && (
                        <select value="" data-pasar-a aria-label={t("Move the order(s) to another driver", "Pasar la(s) orden(es) a otro chofer")}
                          onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) void pasaA(u.key, ordenesDeLaFila, v); }}
                          style={{ width: "auto", maxWidth: 84, padding: "2px 2px", fontSize: 12 }}>
                          <option value="">{t("Move to…", "Pasar a…")}</option>
                          {lanes.filter((l) => l.key !== u.key).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                        </select>
                      );
                      const celdaDeCuenta = (
                        <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                          {cu.sinConteo ? "~" : ""}{textoDeLaCuenta(cu)}
                          {cu.exceso > 0 && <div data-exceso style={{ color: "var(--red)", fontWeight: 700 }}>{textoDelExceso(cu, capacity, lang === "es")}</div>}
                        </td>
                      );
                      if (f.tipo === "P") {
                        // Una orden por fila (D-444): su ID, su cuenta y sus columnas, como una entrega. Lo que es de la ENTREGA
                        // —ventanas, dirección, contacto— va vacío: esta parada es en la tienda (`seVeEnLaRecogida`).
                        // D-445: las dos CIUDADES sí salen, las de su orden: de dónde sale y a dónde va. El dueño, 2026-09-29:
                        // «no me sale ciudad de enetrega y quiero que claramente diga ciudad tienda de rocigda».
                        const suyas = f.ordenes.map((id) => porId.get(id)).filter((x): x is Delivery => !!x);
                        const o = suyas[0];
                        // La llegada a la tienda: la medida de la ruta ya la calcula, con la clave «P:» + su puesto en la lista.
                        const etaP = f.indice != null ? routeEtas[u.key]?.[`P:${f.indice}`] : undefined;
                        // Si no hay hora, por qué (D-456): la tienda sin coordenadas no se mide; con una sola parada y sin base, tampoco.
                        const paradaP = f.indice != null ? lectura.paradas[f.indice] : undefined;
                        const motivoP: MotivoSinLlegada | null = !paradaP || paradaP.tipo !== "P" ? null : !coordsDeTienda(paradaP.tienda) ? "sin_tienda" : "sin_base";
                        const llegadaP = textoDeLaLlegada(etaP, f.indice != null ? medida : "sin_pedir", motivoP, lang === "es");
                        // La TIENDA donde se recoge, sin «Recoger en» (D-447): va en la columna Ciudad de recogida.
                        const dondeRecoge = (
                          <>
                            <b>{f.lugar ?? t("(no store on the order)", "(la orden no dice la tienda)")}</b>
                            {!movible && <span className="hint" style={{ margin: 0 }}> · {t("another load of the same order", "otra carga de la misma orden")}</span>}
                          </>
                        );
                        return (
                          <tr key={`P-${fi}-${clave}`} data-recogida={f.etiqueta} className={`${claseDeLaFilaDelPlan("P")}${claseDeGrupo(f)}${claseDeSoltar}`}
                            data-fila-arrastrable={seArrastra ? "parada" : undefined} {...arrastre} {...soltar}
                            style={{ ...(resaltada ? { outline: "2px solid var(--amber)", outlineOffset: -2 } : {}), ...(esLaArrastrada ? { opacity: 0.5 } : {}), ...(seArrastra ? { cursor: "grab" } : {}) }} data-recien-movida={resaltada ? "" : undefined}>
                            <td className={gris || provisional ? "etiqueta-provisional" : undefined} style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700 }}>{f.etiqueta}</td>
                            <td className="ordno">{suyas.map((x, k) => <Fragment key={x.id}>{k > 0 && " · "}{facturaConSuId(x)}{etiquetaDeLaCarga(x)}</Fragment>)}</td>
                            {celdaDeCuenta}
                            {colsParadas.map((c) => {
                              // D-446: el Tipo de la P es el de su orden, como en la D. D-447 corrige el sitio de la tienda: va en la
                              // Ciudad de RECOGIDA, sin la palabra «Recoger», y la Ciudad de entrega dice la de su orden. El dueño,
                              // 2026-09-29: «la palabra recoger i dont need that y esta mal porque esta en ciudad de entrega eso de rdz
                              // mcallen deberia esta en ciudad de recodiga tienes todo alreves».
                              if (c.key === "p_type") return <td key={c.key} title={o?.order_type || undefined}>{o?.order_type || "—"}</td>;
                              if (c.key === "p_eta") return <td key={c.key} data-llegada={llegadaP.falta ? "falta" : "hora"} title={llegadaP.titulo} style={llegadaP.falta ? ESTILO_SIN_LLEGADA : { fontWeight: 600 }}>{llegadaP.texto}</td>;
                              if (c.key === "p_ciudad_recogida") return <td key={c.key}>{dondeRecoge}</td>;
                              if (c.key === "p_address") return <td key={c.key} title={o?.delivery_address || undefined}>{(o && ciudadDeEntrega(o.delivery_address, ciudadesQueSeConocen)) || "—"}<AvisoSoloCiudad orden={o} corto /></td>;
                              if (c.key === "p_windows" || !o || !seVeEnLaRecogida(c)) return <td key={c.key} />;
                              return <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, o)}</td>;
                            })}
                            {/* D-459: el td es una celda normal y el flex va DENTRO (era `display: flex` en el td: el fallo de la captura). */}
                            <td className="celda-acciones" onClick={(e) => e.stopPropagation()}>
                              <div className="acciones-de-parada">{flechas}{pasar}</div>
                            </td>
                          </tr>
                        );
                      }
                      const d = porId.get(f.orden);
                      if (!d) return null;
                      if (f.otraCarga) {
                        // La entrega de OTRA carga de una orden que el motor repartió: informa, no se mueve.
                        return (
                          <tr key={`D2-${fi}-${d.id}`} className={claseDeLaFilaDelPlan("D")}>
                            <td style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700 }}>{f.etiqueta}</td>
                            <td className="ordno">{facturaConSuId(d)}</td>
                            {celdaDeCuenta}
                            <td colSpan={colsParadas.length}>{t("Deliver another load of", "Entregar otra carga de")} {nombraLaOrden(deliveries, d.id, lang === "es")}</td>
                            <td className="celda-acciones" />
                          </tr>
                        );
                      }
                      // Flag a stop whose measured ETA lands after its window closes.
                      const eta = routeEtas[u.key]?.[d.id];
                      const win = parseWindow(d.delivery_windows);
                      const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
                      const late = etaMin != null && win != null && etaMin > win[1];
                      // Si no hay hora, por qué (D-456): sin pin no se mide; si no, «calculando…» o «sin medida».
                      const llegada = textoDeLaLlegada(eta, medida, d.delivery_lat == null || d.delivery_lng == null ? "sin_pin" : "sin_base", lang === "es");
                      // Three levels of detail, by where you tap:
                      //   the invoice → open the order itself (the ID until D-408)
                      //   the row  → isolate this stop on the map, with its route
                      //   outside  → back to the driver's whole day
                      const isolated = selectedOrders.has(d.id) && selectedOrders.size === 1;
                      return (
                        <tr
                          key={d.id}
                          // Delivered stops tint green, so the route visibly fills in over the day. Isolating a stop still
                          // wins — that's a deliberate pick.
                          className={`clickable${d.stage === "delivered" && !isolated ? " row-done" : ""}${claseDeGrupo(f)}${claseDeSoltar}`}
                          data-fila-arrastrable={seArrastra ? "parada" : undefined} {...arrastre} {...soltar}
                          style={{ ...(isolated ? { background: "var(--accent-soft)" } : resaltada ? { background: "var(--amber-soft)", outline: "2px solid var(--amber)", outlineOffset: -2 } : {}), ...(esLaArrastrada ? { opacity: 0.5 } : {}) }}
                          data-recien-movida={resaltada ? "" : undefined}
                          data-entrega={f.etiqueta}
                          // Stop here: without this the click also reaches the card's "tap outside" handler, which sees a
                          // selection already set and clears it — so moving from one stop to the next took two clicks.
                          onClick={(e) => { e.stopPropagation(); if (!soloLectura) setSelectedOrders(isolated ? new Set() : new Set([d.id])); }}
                          title={t("Show this stop on the map", "Ver esta parada en el mapa")}
                        >
                          <td className={gris || provisional ? "etiqueta-provisional" : undefined} style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700, whiteSpace: "nowrap" }}
                            title={gris || provisional ? t("Provisional: follows the current order, none saved yet", "Provisional: sigue el orden de ahora, aún sin orden guardado") : undefined}
                          >
                            {/* La casilla de «Asignar a…» varios (D-474): marca la ORDEN (su entrega es su fila), aparte de aislarla en el
                                mapa, que es lo que hace pulsar la fila. El clic no sube a la fila ni a la tarjeta. */}
                            {acciones && <input type="checkbox" data-marca-orden={d.id} checked={marcadas.has(d.id)} onChange={() => alternaMarca(d.id)} onClick={(e) => e.stopPropagation()}
                              aria-label={t(`Select ${facturaYId(d).principal} to assign it to another driver`, `Marcar ${facturaYId(d).principal} para asignarla a otro chofer`)}
                              style={{ width: 13, height: 13, margin: "0 3px 0 0", verticalAlign: "middle" }} />}
                            {f.etiqueta}
                          </td>
                          {/* La factura, subrayada: abre la orden (D-408); debajo, el ID (D-456; D-444 había dejado solo el ID); y
                              «carga 1 de 2» si es una carga de una orden partida (D-452). */}
                          <td className="ordno">{facturaConSuId(d)}{etiquetaDeLaCarga(d)}</td>
                          {celdaDeCuenta}
                          {/* Cada celda por su CLAVE, en el orden de la persona (D-410). Las cinco de siempre se pintan a su
                              manera; las que vienen de Órdenes (D-376), con la celda de Órdenes. */}
                          {colsParadas.map((c) => {
                            switch (c.key) {
                              case "p_type": return <td key={c.key} title={d.order_type || undefined}>{d.order_type || "—"}</td>;
                              case "p_ciudad_recogida": return <td key={c.key}>{zonaDeLaRecogida(d, settings.stores ?? [], ciudadesQueSeConocen) || "—"}</td>;
                              case "p_address": return <td key={c.key} title={d.delivery_address || undefined}>{ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen) || "—"}<AvisoSoloCiudad orden={d} corto /></td>;
                              case "p_eta": return (
                                <td key={c.key} data-llegada={llegada.falta ? "falta" : "hora"} style={llegada.falta ? ESTILO_SIN_LLEGADA : { fontWeight: 600, color: late ? "var(--red)" : undefined }} title={late ? t("ETA is after the delivery window", "La llegada es después de la ventana") : llegada.titulo}>
                                  {llegada.texto}{late ? " ⚠️" : ""}
                                </td>
                              );
                              case "p_windows": return <td key={c.key}>{fmtWindows(d.delivery_windows)}</td>;
                              default: return <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, d)}</td>;
                            }
                          })}
                          {/* Reordering and moving are edits, not "show me this" — they must not also hijack the map. */}
                          <td className="celda-acciones" onClick={(e) => e.stopPropagation()}>
                            <div className="acciones-de-parada">
                              {flechas}{pasar}{acciones && botonesDeCarga(d, capacity)}
                              {acciones && <button className="btn btn-danger btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} onClick={() => unassign(d.id)} title={t("Unassign", "Quitar asignación")}>✕</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filaDeLaBase(u.key, "regreso", cuenta.regreso, cuenta.totales.finalNoCero)}
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
      {/* «Asignar a…» varios choferes desde las tarjetas (D-474): con algo marcado, el recuadro pegado abajo, como el de
          «Elige conductor» en «Sin asignar». */}
      {!soloLectura && tab === "routes" && seleccionDelReparto.length > 0 && recuadroDeReparto()}

      {/* 🎨 Los colores de chofer vivían en «Mapa» / «Ruta de hoy» desde antes de D-467: se quedan ahí, solo en solo lectura.
          Lo único que se guarda desde «Ruta de hoy» es esto, y solo gerente o admin. */}
      {soloLectura && (
        <div className="card" data-colores-de-chofer>
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
                <span style={{ width: 16, height: 16, borderRadius: "50%", background: UNASSIGNED_COLOR, border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Unassigned", "Sin asignar")}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {!ready && <div className="empty">{t("Loading…", "Cargando…")}</div>}

      {/* Lo cerrado con las ✕ de los avisos (D-400) se recupera AQUÍ, al fondo y en pequeño (D-459). El dueño, 2026-10-01:
          «osea que no aparezca eso de show hidden notices» — estaba arriba, junto a «Ocultar mapa y choferes». Los avisos
          cerrados siguen cerrados; esto queda para quien cerró el de «chofer sin reportar ubicación» y lo quiere de vuelta. */}
      {avisosOcultos != null && avisosOcultos.size > 0 && (
        <div style={{ textAlign: "right", marginTop: 18 }}>
          <button className="notif-clear" data-mostrar-avisos-ocultos onClick={muestraAvisosOcultos} style={{ fontSize: 11 }}
            title={t("Show again the notices you closed on this screen", "Volver a mostrar los avisos que cerró en esta pantalla")}>
            {t(`Show hidden notices (${avisosOcultos.size})`, `Mostrar avisos ocultos (${avisosOcultos.size})`)}
          </button>
        </div>
      )}

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
  /** Dentro de la ventana de «⚠ Incidencias» (D-437): sin su tarjeta ni su título, que pone la ventana. */
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
