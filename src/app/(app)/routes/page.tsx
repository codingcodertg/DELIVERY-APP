"use client";

import { useContextoDeAyuda } from "@/lib/ayuda-ubicacion-hook";
import { contextoDelGestor } from "@/lib/ayuda-contextos";
import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { soloActivos } from "@/lib/baja";
import { useData } from "@/lib/data-provider";
import { useSoloLectura } from "@/lib/gestor/solo-lectura";
import { useSoloMisRutas } from "@/lib/gestor/solo-mis-rutas";
import { useSoloElMapa } from "@/lib/gestor/solo-el-mapa";
import { soloLoMioPorChofer, soloMisCarriles, soloMisOrdenes } from "@/lib/gestor/mis-rutas";
import { PlanDelDia } from "@/components/PlanDelDia";
import { RecomendacionesDeVuelta } from "@/components/RecomendacionesDeVuelta";
import { choferesEnVivo, marcaEnVivo } from "@/lib/choferes-en-vivo";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canPlanRoutes } from "@/lib/constants";
import { parseWindow, unavailableDriverNames } from "@/lib/dispatch";
import dynamic from "next/dynamic";
import type { MapLine, MapPoint } from "@/components/MapView";
import { useUbicacionesDeChoferes } from "@/lib/ubicaciones-de-choferes";
import { FotoDeLaRuta } from "@/components/FotoDeLaRuta";
import { lineasDeLaRuta, puntosDeLaRuta } from "@/lib/foto-de-la-ruta";
import { OrderModal } from "@/components/OrderModalLazy";
import { DispatchBoard, type BoardColumn } from "@/components/DispatchBoard";
import { GanttTimeline, type GanttRow } from "@/components/GanttTimeline";
import { printRouteManifest } from "@/lib/manifest";
import { fallbackDriverColor, fmtDate, fmtMoney, fmtWindows, isOverdue, nombresPorId, orderLabel, orderOwner, retentionFloorISO, seesAllHistory, shiftDateISO, todayISO } from "@/lib/utils";
import { agendaEnDiaPasado, AVISO_FECHA_PASADA, minFechaDeEntrega } from "@/lib/fecha-de-entrega";
import { maxFechaDeEntrega, problemaAlAgendar, textoDelProblema } from "@/lib/dia-de-entrega";
import { pideConfirmarMismoDia, preguntaMismoDia } from "@/lib/same-day";
import { colorDeChofer } from "@/lib/map-legend";
import { COLOR_DE_CAMION_SIN_CHOFER, textoDelCamion } from "@/lib/tracksolid/camiones";
import { repartoParaElMapa } from "@/lib/tracksolid/camion-del-dia";
import { useCamionesDeTracksolid } from "@/lib/tracksolid/useCamiones";
import { useCamionDelDia, usePosicionesDeChoferes } from "@/lib/tracksolid/useCamionDelDia";
import { CamionDelChofer } from "@/components/CamionDelChofer";
import type { TruckMarker } from "@/lib/tracksolid/marca";
import { antecedentesDeRutas } from "@/lib/route-plan/historia";
import { useRutasDelDia } from "@/lib/usa-rutas-del-dia";
import { rangoDeRutasDelDia } from "@/lib/rutas-del-dia";
import { ordenesDeRutaDeHoy, ordenLegible } from "@/lib/gestor/ordenes-de-ruta-de-hoy";
import { alternaGrupo, estadoDeGrupo, lasMarcadas, lasRepartibles } from "@/lib/seleccion-multiple";
import { alternaTodas, alternaVisible, guardaMarcados, leeMarcados, marcadasAProposito, marcadosVigentes, pasaElFiltro, rutasVisibles, seVenTodas, soloAlgunos, unicoMarcado } from "@/lib/gestor/filtro-de-choferes";
import { rutasConOrdenes } from "@/lib/gestor/rutas-visibles";
import { alcanceDeChoferes, choferSeVe, choferesConOrden, ordenesPorChofer, type AlcanceDeChoferes } from "@/lib/gestor/choferes-por-tienda";
import { alAbrirRutas, alPulsarElMapa, MAPA_INICIAL, rutasAbiertas, type EstadoDelMapa } from "@/lib/gestor/mapa-al-abrir-ruta";
import { textoDeLaParada } from "@/lib/gestor/paradas-numeradas";
import { ordenesEnElMapa } from "@/lib/gestor/ordenes-en-el-mapa";
import { alternaResaltada, encuadreDeResaltadas, esControlDeLaFila } from "@/lib/resaltar-orden";
import { diaDeLaRuta as diaDeLaRutaSinDestino } from "@/lib/gestor/numeros-del-dia";
import { destinoDeTiendaDe } from "@/lib/misma-visita";
import type { OrderTypeRules } from "@/lib/required";
import { filasDelHorario, paradaDeCadaEntrega } from "@/lib/gestor/zoom-del-horario";
import { alternaDesplegada, claseDeTarjeta, conAcciones, conCabecera, conCuerpo, desplegadaVigente, type ModoDeTarjeta } from "@/lib/gestor/cuadricula";
import { abreAlMarcar, guardaVista, leeVista, type VistaDelGestor } from "@/lib/gestor/vistas-del-gestor";
import { botonDelCamion } from "@/lib/gestor/boton-del-camion";
import { serviceMin } from "@/lib/trip-timing";
import { pintaElTrazoDelPlan, textoDeLaLlegada, type MotivoSinLlegada } from "@/lib/medida-de-ruta";
import { DAY_START_MIN, useMedidaDeRutas, claveDeRecogida, ordenesDeLaRecogidaMedida } from "@/lib/usa-medida-de-rutas";
import { MARGEN_DEL_RELEVO_MIN, conRecogidaDesde, etaDeEntregaEn, etaDeRecogidaEn, llegadasDelPlan, pasoAnteriorPorId, recogidaDesdeDelRelevo, relevosAntesDeTiempo } from "@/lib/relevo-a-tiempo";
import { carrilesDelDia, cargaDelPanel, encuadreDeLasRutas, lineasDeLasRutas, puntosDeLasRutas, rutaDeLaLinea, rutasPorChofer, type CarrilDeRuta } from "@/lib/mapa-de-rutas";
import { listaDelDia, ordenesDeLaRutaDelDia, pendientesDelDia } from "@/lib/recogida-y-ruta-del-dia";
import { PanelDeChoferes } from "@/components/PanelDeChoferes";
import { ReprogramarOrden } from "@/components/ReprogramarOrden";
import { RelevoDeLaOrden } from "@/components/RelevoDeLaOrden";
import { IconoDeAvisos, type AvisoDeLaRuta } from "@/components/IconoDeAvisos";
import { avisosDeRelevo, type AvisoDeRelevo } from "@/lib/relevo";
import { esPasoDeRelevo } from "@/lib/relevo-etiqueta";
import { puedeReprogramar } from "@/lib/reprogramar-orden";
import { ReprogramarVarias } from "@/components/ReprogramarVarias";
import { BandejaDeSolicitudes } from "@/components/BandejaDeSolicitudes";
import { notaAlAprobar, pasosAlAprobar, puedeDecidirSolicitudes, type SolicitudDeAsignacion } from "@/lib/solicitud-de-asignacion";
import { arranqueDeLoPendiente, optimizaSinEmpeorar, reglasDeLaEntrada } from "@/lib/optimiza-sin-empeorar";
import { ahoraDelNegocio } from "@/lib/salida-de-la-medida";
import { diaFijoPorLaEntrega, diaQueSeGuarda, LARGO_MAX_QUIEN, notaDeEntregadaPorOtro, parcheDeEntregadaPorOtro, sugerenciasDeQuien, validaEntregadaPorOtro, type MotivoDeEntregadaPorOtro } from "@/lib/entregada-por-otro";
import { avisoDeOptimizar, entradaDeOptimizar, puntosDeLaEntrada, tiemposDeLaRuta, type TiemposPedidos } from "@/lib/optimizar-desde-el-gestor";
import { basesPorNombreDelDia, extremosDeLaRuta, type BaseDelDia } from "@/lib/base-del-dia";
import { useBasesDelDia } from "@/lib/usa-base-del-dia";
import { esVentanaDura, minutosDeHora } from "@/lib/route-settings";
import { useBasesDeChofer } from "@/lib/usa-bases";
import { useAjustesDeChofer } from "@/lib/usa-ajustes-de-chofer";
import { entradaDelDia } from "@/lib/route-plan/entrada";
import { entradaDelReparto, reparteEntre, type Reparto } from "@/lib/route-engine";
import { ajustesConBaseDelPerfil, choferesParaRepartir, etiquetaDelReparto, forzaLasQueNoCaben, listaDeLasParadas, matrizDelGestor, mensajeDelRepartoHecho, movimientosDelReparto, paradasDeLaLista, puntosDelReparto, resumenDelReparto, textoDeNoRepartir } from "@/lib/reparto-desde-el-gestor";
import { BorradoresDeRuta } from "./BorradoresDeRuta";
import type { Foto } from "@/lib/arrastre-de-paradas";
import { driverOf, orderLaneKey as orderLaneKeyPure, planMerge } from "@/lib/route-lanes";
import { COLUMN_WIDTHS, anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { liveDriverNames, trackingGaps } from "@/lib/tracking-health";
import { porQueNoReporta } from "@/lib/gps-del-turno";
import { useAutoGeocode } from "@/lib/useAutoGeocode";
import { useStoreMarkers } from "@/lib/useStoreMarkers";
import { cuentasSinAsignar, filasSinAsignar, ordenesDelDia, pendientesDeOtrosDias, sinAsignarDelGestor, type ChipSinAsignar, type ModoDelGestor } from "@/lib/ordenes-del-dia";
import { numerosDeArranque } from "@/lib/arranque-del-plan";
import { cuentasDeTodas, filasDeTodas, todasDelGestor } from "@/lib/todas-del-gestor";
import { eleccionVigente, opcionesDeConductor } from "@/lib/elige-conductor";
import { PANEL_DE_TODAS, PANEL_SIN_ASIGNAR, estaPlegada } from "@/lib/vista-del-gestor";
import { esProvisional, esProvisionalLaFila, type FilaDeLaRuta, type LecturaDeRuta } from "@/lib/route-plan/lectura-de-ruta";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { puntosDelTrazoPublicado } from "@/lib/route-plan/trazo-del-plan";
import { usePlanPublicadoDelGestor } from "@/lib/route-plan/usePlanPublicado";
import { facturaYId, nombraLaOrden } from "@/lib/route-plan/etiqueta";
import { textoBajoLaFactura, tituloDeLaFactura } from "@/lib/po-en-la-factura";
import {
  COLUMNAS_DEL_GESTOR_POR_DEFECTO, LLAVE_DE_ANCHOS_DE_PARADAS, alternaColumna, anchoDePartida, anchoDePartidaDeParada, anchoDelNumeroDeParada, claveDelOrdenEnElNavegador,
  columnaDeOrdenes, columnasDeLaTabla, columnasDePlantillaDelGestor, columnasDelSelector, columnasDelSelectorDeLasOrdenes, columnasDeLasOrdenes, preferenciasDelGestorAlLeer, fotoDePlantillaDelGestor,
  mueveEnElGestor, ordenDePlantillaDelGestor, ordenDelGestorEnElNavegador, restableceOrdenDelGestor, seMueveEnElGestor, siembraAnchosDeParadas,
  seVeEnLaRecogida, sinElNombreDeLaTabla, sinLaFacturaDelPlan, TABLA_DE_LAS_ORDENES, tieneOrdenPropio, type ColumnaDelGestor, type TablaDelGestor,
} from "@/lib/routes-columns";
import { borraPlantilla, claveDePlantillasEnElNavegador, guardaPlantilla, persistePlantillas, plantillasDelNavegador, textoDelRechazo } from "@/lib/plantillas-de-columnas";
import { ORDER_COLUMNS } from "@/components/OrdersTable";
import { idsRecibidasPorAlmacen } from "@/lib/recibir";
import { marcasDeParadas } from "@/lib/acciones-parada";
import { motivosDeAnulacion } from "@/lib/cancel-reasons";
import { CLAVE_DE_COLUMNAS_DEL_GESTOR, guardaColumnas, leeColumnas, valorDeColumnas, type ClienteDePrefs, type ColumnasPorRol, type PlantillaDeColumnas } from "@/lib/user-prefs";
import { createClient } from "@/lib/supabase/client";
import { useOrdenYFiltro, type OrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { etiquetaDelGestor, llegadaEnLasOrdenes, valorDelGestor } from "@/lib/valores-del-gestor";
import { ciudadDeEntrega, ciudadesConocidas } from "@/lib/ciudad-de-entrega";
import { AVISO_SOLO_CIUDAD, ordenSoloCiudad } from "@/lib/solo-ciudad";
import { AvisoSoloCiudad } from "@/components/AvisoSoloCiudad";
import { celdaPropiaDelPlan, claseDeLaFilaDelPlan } from "@/lib/route-plan/celdas-del-plan";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { SIN_FILTRO_EN_PARADAS, filasOcultas, paradaVisible, valorDeOrdenEnParadas, type ValoresDeOrden } from "@/lib/filtro-de-paradas";
import { arrastradaDesde } from "@/lib/arrastrada-de-otro-dia";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { BotonDelCamion } from "@/components/BotonDelCamion";

// El mapa entra solo cuando una pantalla lo pinta (como en Ajustes): arrastra Leaflet/Google enteros.
const MapView = dynamic(() => import("@/components/MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div style={{ minHeight: 320 }} aria-hidden />,
});

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
/** La capa de camiones de TrackSolid (D-900): la misma lista vacía siempre, y dónde recuerda el navegador si se apagó. */
const SIN_CAMIONES_EN_MAPA: TruckMarker[] = [];
const CLAVE_CAPA_CAMIONES = "rtg_capa_camiones";
const SIN_REPARTO = { asignados: new Map<string, { driverId: string; driver: string }>(), sinAsignar: [] as string[] };
import type { Delivery, DriverIncident, Profile } from "@/lib/types";
import { abanicoDeMarcas } from "@/lib/abanico-de-marcas";
import { palletsDeLaOrden, sumaPallets } from "@/lib/pallets";
import { sumaDinero } from "@/lib/totales";
import { altoMaximoDeCaja } from "@/lib/barra-superior";
import { BarraSuperior, useCajasPorClave } from "@/components/BarraSuperior";
import { CerrarAviso } from "@/components/CerrarAviso";
import { avisoDelHueco, escrituraDelHueco, mejorLugar, separaPorRequisitos, type ParadaDeRuta } from "@/lib/mejor-lugar";
import { avisoDePisar, chipAutoEnPantalla, claveDeRutaAuto, mismaSecuencia, notaDeReglas, planAuto, reintentoAuto, type ResultadoAuto, violacionesNuevas } from "@/lib/auto-optimiza-la-ruta";
import { huellaDeLaRuta, rutasAOptimizar, type CambioDeAsignacion } from "@/lib/auto-optimizar";

import {
  anota, barrasDeLaRuta, botonDeVolver, choquesAlVolver, descartaElDeArriba, escriturasHacia, fotoDe, fotoDeFilas, fotoTrasReordenar,
  HISTORIAL_VACIO, objetivoDe, planDeSoltar, porQueNoSuelta, resella, sellosDe, textoDeChoques, textoDePrevia, trasVolver,
  type Destino, type Direccion, type FilaFresca, type Historial, type ParadaDelGantt, type RutaDelGantt,
} from "@/lib/arrastre-de-paradas";
import { ETAPAS_FIJAS, ETAPAS_HECHAS, estaEnElCamion, hechasDelChofer, numeracionConHechas, puestoEn } from "@/lib/mover-parada";
import { accionDeLaParadaEnRutas, NOTA_CANCELAR_REGRESO, NOTA_PEDIR_REGRESO, patchCancelarRegreso, patchPedirRegreso } from "@/lib/regreso-a-tienda";
import { accionesDeEtapaParaAdmin, escrituraCambiarEtapaAdmin, preguntaCambiarEtapaAdmin, puedeCambiarEtapaAqui, type AccionDeEtapaAdmin } from "@/lib/cambiar-etapa-admin";
import { hechasQueSePintan, horaReal, resumenDeEntregas, type FilaPintada } from "@/lib/hechas-del-gestor";
import { cambiosDeEtas, claveDeEta, claveDelPlan, desvio, filasNuevasDeEtas, hechasFueraDeOrden, mapaDeEtasGuardadas, textoDelDesvio, type EtaGuardada, type FilaDeEta } from "@/lib/eta-del-plan";
import { minutosReales } from "@/lib/salida-de-la-medida";
import { textoDelEstadoDelPlan, type EstadoDelPlan } from "@/lib/route-plan/estado-del-plan";
import {
  cabeEnElPuesto, cambiosDeLaLista, cuentaDePallets, escrituraDeLaLista, gruposDeMismoLugar as gruposDeMismoLugarSinDestino, listaConEntregasEn, listaConOrdenesEn, llevaEnLaLista, mueveEnLaLista, numeroDePallets,
  textoDeLaCuenta, textoDelExceso, tienePosicionDeRecogida, type FilaDeCuenta, type ParadaDeLaLista,
} from "@/lib/lista-unica";
import { flechaDelBloque, mueveBloque, ordenesDelBloque, type OpcionesDelBloque } from "@/lib/arrastre-multiple";
import { gruposParaMarcar, mueveAParada, rangosDeParada, traeLaEntrega, velocidadDeAutoScroll } from "@/lib/mover-a-parada";
import { alRepartir, cargaDe, etiquetaDeCarga, hermanasDe, laOtraCarga, restoPropuesto, sePuedenJuntar, sePuedePartir } from "@/lib/cargas-partidas";
import { useRequisitosDelCamion } from "@/lib/usa-requisitos";
import { useZonasDeChofer } from "@/lib/usa-zonas";
import { esDeSuZona, zonaDeLaRecogida } from "@/lib/zonas";
import { recogidaLibreDeLaOrden } from "@/lib/recogida-libre";
import { fraseDeFaltan } from "@/lib/requisitos";
import { CANDADOS_SIN_LEER, cargaCandados, dondeViveElCandado, estaBloqueada, pulsaCandado, quienBloqueo, type ClienteDeCandados, type EstadoDeCandados, type OpcionesDeCandados } from "@/lib/rutas-bloqueadas";
import { AVISOS_DEL_GESTOR, cierraAviso, guardaAvisosOcultos, leeAvisosOcultos, type AvisoDelGestor } from "@/lib/avisos-ocultos";
import { BuscadorConBorrar } from "@/components/BuscadorConBorrar";
import { lineasDelRecorridoReal, planContraRecorrido } from "@/lib/recorrido-contra-plan";
import { useRecorridoDelDia } from "@/lib/useRecorridoDelDia";

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
//   · El pin del mapa nombra la orden por su factura (`lib/gestor/nombre-en-el-mapa`).
//   · D-485: la ruta se numera por PARADAS (`lib/gestor/paradas-numeradas`): filas seguidas en el mismo sitio (la regla de
//     los grupos de D-444) son UNA parada, «1», «2»…; la tabla lleva el número delante de la P/D de cada orden, y el mapa
//     una burbuja por parada con su número —también la de una tienda de RTG, que D-481 (d) había quitado—.
//   · D-529: el número (y la etiqueta P/D) es del DÍA entero, como en «Mi ruta»: lo recogido, en camino o entregado
//     conserva el suyo y lo pendiente no vuelve a contar desde 1 (`lib/gestor/numeros-del-dia`, `diaDe`).
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
  const soloLecturaDeclarada = useSoloLectura();
  // «🗺 El mapa de mi ruta» (D-506) monta ESTA pantalla, en solo lectura, ACOTADA a las rutas de un chofer: el suyo. `null`
  // = sin acotar (el Gestor del gerente y «Ruta de hoy», que ven a todos). El acotado se hace en el ORIGEN —las órdenes que
  // la pantalla recibe, los carriles que pinta, los camiones en vivo y el aviso de rastreo—, no con el filtro de casillas:
  // una orden de otro chofer no llega a esta página, así que ninguna casilla, URL ni estado la puede traer.
  const miChofer = useSoloMisRutas();
  // Acotada a un chofer es SIEMPRE de solo lectura, aunque quien la monte se olvide de `<SoloLectura>`: el chofer no asigna,
  // no mueve, no optimiza ni publica. Que lo decida esta línea y no el sitio donde se monta es lo que lo hace estructural.
  const soloLectura = soloLecturaDeclarada || miChofer != null;
  // «Mi ruta» monta ESTA pantalla y se queda solo con su mapa (D-514): el mismo mapa, no una copia. Manda su día.
  const soloElMapa = useSoloElMapa();
  const { me, users, deliveries: deliveriesLeidas, settings, saveSettings, updateDelivery, reorderStops, partirCarga, reparteCargas, juntarCargas, addNote, reprogramarOrden, notify, setStage, availability, ready, incidents, addIncident, removeIncident, shifts, events, teaching, realRole, hayAutoOptimizar, fijaParadas, estadoAutoDeRutas, marcaAutoDeRuta } = useData();
  // «🔁 Cambiar etapa» (solo admin): la celda de ETAPA de cada parada ofrece Recogido / Entregado. Apagado por defecto; sin persistir.
  const [cambiarEtapa, setCambiarEtapa] = useState(false);
  // Las posiciones de los choferes: fuera del contexto principal, para que un ping de GPS no repinte toda la pantalla de datos.
  const driverLocations = useUbicacionesDeChoferes();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [fechaDelEstado, setDate] = useState(todayISO());
  // Solo el mapa (D-514): el día lo elige la pantalla que lo monta («Mi ruta», su «Ayer/Hoy/Mañana»), no este selector,
  // que ahí no se pinta. Entra COMO la fecha elegida, así que pasa por el MISMO acotado de abajo: la ventana de D-239 y el
  // ±7 de `rutas_del_dia`. Un mapa montado no puede enseñar un día que esta pantalla no dejaría elegir.
  const fechaElegida = soloElMapa ? soloElMapa.dia : fechaDelEstado;
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
  const todasLasDelDia = useMemo(() => (soloLectura ? ordenesDeRutaDeHoy(paradasDeHoy, deliveriesLeidas) : deliveriesLeidas), [soloLectura, paradasDeHoy, deliveriesLeidas]);
  // El acotado de D-506, en UN sitio: todo lo que esta pantalla pinta cuelga de `deliveries`, así que acotarlo aquí acota
  // las paradas, los carriles, el mapa, las tablas, las cuentas, Cuadrícula y Horario de una vez.
  // Qué choferes ve esta persona en «Ruta de hoy» (D-544): la tienda con choferes dedicados ve solo esos, las demás no los
  // ven, y admin, logística y gerente ven a todos; una Intertienda que entra a su tienda se ve igual. Solo en «Ruta de hoy»
  // (`soloLecturaDeclarada`), no en el Gestor ni en el mapa del chofer (D-506, que ya acota a lo suyo). Se acota en el
  // ORIGEN, como D-506: lo que no pasa no llega a las tarjetas, al panel, al mapa, a Cuadrícula ni a Horario.
  const tiendasDeAjustes = settings.stores;
  const alcanceChoferes = useMemo<AlcanceDeChoferes>(
    () => (soloLecturaDeclarada && miChofer == null ? alcanceDeChoferes(me, tiendasDeAjustes ?? [], { teaching }) : { tipo: "todos" }),
    [soloLecturaDeclarada, miChofer, me, tiendasDeAjustes, teaching],
  );
  const deliveries = useMemo(
    () => (miChofer != null ? soloMisOrdenes(todasLasDelDia, miChofer)
      : ordenesPorChofer(todasLasDelDia, alcanceChoferes, { me, tiendas: tiendasDeAjustes ?? [], reglas: settings.order_type_rules })),
    [todasLasDelDia, miChofer, alcanceChoferes, me, tiendasDeAjustes, settings.order_type_rules],
  );
  // El destino de TIENDA de cada orden, por su id (`misma-visita`). No toca las órdenes: la pantalla lo pasa a los números,
  // a los grupos de color y al mapa, para que una descarga en una tienda y la carga en esa misma tienda sean UNA parada.
  const destinoDeTiendaDeLaRuta = useMemo(
    () => destinoDeTiendaDe(todasLasDelDia, settings.stores ?? [], settings.order_type_rules as OrderTypeRules | undefined),
    [todasLasDelDia, settings.stores, settings.order_type_rules],
  );
  // Las mismas funciones de siempre, con ese destino: sus llamadas en la página no cambian.
  const diaDeLaRuta: typeof diaDeLaRutaSinDestino = (lectura, pendientes, hechas, capacidad, paradasDelPlan, comoIba) =>
    diaDeLaRutaSinDestino(lectura, pendientes, hechas, capacidad, paradasDelPlan, comoIba, destinoDeTiendaDeLaRuta);
  const gruposDeMismoLugar: typeof gruposDeMismoLugarSinDestino = (paradas, ordenes) => gruposDeMismoLugarSinDestino(paradas, ordenes, destinoDeTiendaDeLaRuta);
  // Lo rotulado con un chofer (su carril, su camión, el aviso de su teléfono) sale si lo ve, o si lleva algo que se pinta.
  const choferesConParada = useMemo(() => choferesConOrden(deliveries), [deliveries]);
  const seVeElChofer = (chofer: string | null | undefined) => choferSeVe(chofer, alcanceChoferes, choferesConParada);
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
  // Nace en «Cuadrícula» (D-526). El dueño, 2026-10-11: «make grid view in route manager default». «▭ Ancho» la cambia.
  const [wideRoutes, setWideRoutes] = useState(false);
  // «Vista completa» o «Vista eficiente» (D-653, `lib/gestor/vistas-del-gestor`): la completa es esta pantalla de siempre; en
  // la eficiente las pestañas suben a la fila de «Choferes y rutas» y la tabla de cada chofer marcado va pegada bajo el mapa.
  // Solo en el Gestor: «Ruta de hoy» y el mapa del chofer (solo lectura) siguen como estaban.
  const [vista, setVista] = useState<VistaDelGestor>("completa");
  const eficiente = vista === "eficiente" && !soloLectura;
  // El mapa y el panel de choferes (antes un `showTop` suelto). Desde D-544 se esconde solo al abrir las rutas de un chofer,
  // y el botón de arriba lo vuelve a enseñar (`lib/gestor/mapa-al-abrir-ruta`). En la vista eficiente el mapa ES la vista: no
  // se esconde, y su botón no sale.
  const [estadoDelMapa, setEstadoDelMapa] = useState<EstadoDelMapa>(MAPA_INICIAL);
  const showTop = eficiente || estadoDelMapa.visible;
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
  // D-485: el número de parada nunca más estrecho que su partida (lleva el número de parada y la P/D de la orden).
  const anchoDeParada = (clave: string) => { const w = stopCols.widthOf(clave, anchoDePartidaDeParada(clave, COLUMN_WIDTHS)); return clave === "_n" ? anchoDelNumeroDeParada(w) : w; };
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
  // «Sin asignar» y «Todas» (D-548): EXACTAMENTE las columnas de la tabla de paradas —las elegidas, el orden, las
  // plantillas y el ⚙ son los de paradas—, con la factura y los pallets fijos delante como allí, y en «Todas» el chofer
  // (D-462). Los anchos de estas dos son los suyos (`anchoEnSinAsignar`), compartidos entre ellas.
  const colsSinAsignar = columnasDeLasOrdenes("sinAsignar", colsGestor, ordenGestor);
  const colsTodas = columnasDeLasOrdenes("todas", colsGestor, ordenGestor);
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
    const leidos = leeMarcados((k) => window.localStorage.getItem(k), me.id);
    setSelected(new Set(leidos));
    marcadosLeidos.current = true;
    // Lo marcado que se recuerda llega con su tabla abierta, igual que al marcarlo (D-653): la pantalla nace en «Cuadrícula»
    // (D-526), así que se despliega la última marcada. Sin esconder el mapa.
    if (leidos.length > 0) {
      abiertasDesdeElPanel.current = new Set(leidos);
      setDesplegada(leidos[leidos.length - 1]);
    }
  }, [me?.id]);
  useEffect(() => {
    if (!me?.id || !marcadosLeidos.current) return;
    guardaMarcados(() => window.localStorage, me.id, selected);
  }, [selected, me?.id]);
  // La vista elegida, por persona en este navegador (D-653). Se lee al saber quién es y se guarda al pulsar el selector.
  useEffect(() => {
    if (!me?.id) return;
    setVista(leeVista((k) => window.localStorage.getItem(k), me.id));
  }, [me?.id]);
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
  // a propósito: pulsar fuera lo quita y una marca para repartir tiene que sobrevivir a eso. Lo que se reparte es la unión
  // de las dos (`seleccionDelReparto`). Pulsar una fila NO marca: solo resalta (`ordenesResaltadas`).
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  // La orden RESALTADA: un clic en su fila (P o D) la resalta en el mapa y en la tabla, sin marcarla ni abrir el recuadro.
  const [ordenesResaltadas, setOrdenesResaltadas] = useState<Set<string>>(new Set());
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
  // Las cajas de búsqueda pintan lo que se escribe al instante (`orderSearch`, `busquedaDeTodas`); lo que pesa —las
  // tablas filtradas y sus cuentas— va con el valor «diferido», para que teclear no se trabe mientras se recalcula.
  const orderSearchDiferida = useDeferredValue(orderSearch);
  const busquedaDeTodasDiferida = useDeferredValue(busquedaDeTodas);
  // Lo que una solicitud de ayuda dirá de esta pantalla (D-901): pestaña, chip, fecha y qué ventana hay abierta.
  useContextoDeAyuda("gestor", contextoDelGestor({
    pestana: tab, chip: poolFilter, fecha: date, todasLasFechas: allDates, vistaEficiente: vista === "eficiente", soloLectura,
    planAbierto, incidenciasAbiertas, repartoAbierto, seleccionadas: selectedOrders.size,
  }));
  // «Todas» ya no tiene chips (D-542): siempre las del día.
  const chipDeTodas: ChipSinAsignar = "dia";
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
    // En la vista eficiente (D-653) el panel y el mapa no van fijos (su envoltorio es `display: contents`): nada que dejar.
    if (!showTop || eficiente || !el) { setAltoPanelFijo(0); return; }
    // Solo fijo en pantalla ancha (D-481, `.panel-fijo-del-gestor`): en el teléfono el panel y el mapa miden más que la
    // pantalla, y fijos tapaban todo lo de abajo. Sin fijar, las cajas no tienen que dejarle sitio.
    const mide = () => setAltoPanelFijo(getComputedStyle(el).position === "sticky" ? Math.round(el.getBoundingClientRect().height) : 0);
    mide();
    const ro = new ResizeObserver(mide);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showTop, eficiente]);
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
  // «📸 PNG» (D-636): la foto lleva la tabla de la ruta tal como se ve, y la tabla solo está en la página con la ruta
  // abierta: en «Cuadrícula», desplegada abajo; en «Ancho», la tarjeta sin plegar. Como lo haría la persona a mano.
  const abreParaLaFoto = (key: string) => {
    // En la vista eficiente la tabla de cada ruta que se ve ya está en la página, bajo el mapa (D-653).
    if (eficiente) return;
    if (!wideRoutes) { setDesplegada(key); return; }
    if (isCollapsed(key)) toggleCollapse(key);
  };
  // Abrir las rutas de un chofer esconde el mapa (D-544). El dueño, 2026-10-13: «when you open the routes for a driver in
  // the trutes manager […] it should hide the map automatically but they can still show it on the top if the user wantss
  // it». Abrir = su tabla desplegada en «Cuadrícula» o su tarjeta abierta (▸) en «Ancho». No en el mapa del chofer (D-506):
  // allí el mapa es lo que vino a ver.
  // En la vista eficiente no hay nada que abrir: las tablas van bajo el mapa, que no se esconde (D-653).
  const abiertas = miChofer != null || eficiente ? [] : rutasAbiertas({ ancho: wideRoutes, desplegada, alternadas });
  const claveDeAbiertas = abiertas.join("\u0000");
  const abiertasAntes = useRef<string[]>([]);
  // Las rutas que acaba de abrir el panel «Choferes y rutas» (D-653): esas no esconden el mapa. Se gastan en el efecto.
  const abiertasDesdeElPanel = useRef<Set<string>>(new Set());
  useEffect(() => {
    const antes = abiertasAntes.current;
    abiertasAntes.current = abiertas;
    const desdeElPanel = abiertasDesdeElPanel.current;
    abiertasDesdeElPanel.current = new Set();
    setEstadoDelMapa((e) => alAbrirRutas(e, antes, abiertas, desdeElPanel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveDeAbiertas]);

  // A newly-viewed date invalidates any measured summary/trace from before (that part lives in `useMedidaDeRutas`).
  useEffect(() => { setErr(null); }, [date]);

  const focusOnly = (name: string) => setSelected(new Set([name]));
  // Marcar un chofer en «Choferes y rutas» ABRE su tabla de paradas, y desmarcarlo la cierra (D-653). El dueño, 2026-10-23:
  // «Cuando yo elijo un driver […] él solo me abre el mapa, pero no me abre la ruta de abajo». La casilla solo cambiaba el
  // filtro (D-481); lo abierto (`desplegada`, `alternadas`) lo cambiaban el nombre y el ▸ de la tarjeta. Qué se abre lo decide
  // `abreAlMarcar`; lo abierto así no esconde el mapa (`abiertasDesdeElPanel`).
  const abreDesdeElPanel = (clave: string, marcada: boolean) => {
    const r = abreAlMarcar({ ancho: wideRoutes, desplegada, alternadas }, clave, marcada);
    if (marcada) abiertasDesdeElPanel.current = new Set([clave]);
    setDesplegada(r.desplegada);
    setAlternadas(r.alternadas);
  };
  /** La casilla de una ruta en el panel: marca o desmarca (D-566) y abre o cierra su tabla. */
  const alternaEnElPanel = (clave: string) => {
    const ahora = alternaVisible(selected, clavesDelPanel, clave);
    setSelected(ahora);
    abreDesdeElPanel(clave, ahora.has(clave));
  };
  /** Pulsar la fila del panel: solo esa ruta, y su tabla abierta. */
  const enfocaEnElPanel = (clave: string) => {
    focusOnly(clave);
    abreDesdeElPanel(clave, true);
  };
  /** El selector «Vista completa | Vista eficiente» (D-653): se guarda por persona en este navegador. */
  const eligeVista = (v: VistaDelGestor) => {
    // Al volver a la completa, lo que ya estaba abierto no cuenta como «recién abierto»: no esconde el mapa (D-544).
    if (v === "completa") abiertasDesdeElPanel.current = new Set(rutasAbiertas({ ancho: wideRoutes, desplegada, alternadas }));
    setVista(v);
    if (me?.id) guardaVista(() => window.localStorage, me.id, v);
  };

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
  const reschedule = async (id: string, delivery_date: string) => {
    // Un día pasado no se agenda (D-532): «que no se pueda agendar orden a dias pasados».
    const actual = deliveries.find((d) => d.id === id)?.delivery_date;
    if (agendaEnDiaPasado(delivery_date, actual)) { notify(t(AVISO_FECHA_PASADA.en, AVISO_FECHA_PASADA.es)); return; }
    // Ni domingo ni un año imposible (D-658). La celda no tiene la casilla del caso especial: el aviso dice dónde está.
    const problemaDeLaFecha = problemaAlAgendar(delivery_date, actual, { rol: me?.role });
    if (problemaDeLaFecha) { const m = textoDelProblema(problemaDeLaFecha, me?.role, { sinCasilla: true }); notify(t(m.en, m.es)); return; }
    // Con el Gestor por permiso suelto, quien no asigna y pone hoy: se pregunta, no se bloquea (`same-day`). Logística/admin, no.
    if (pideConfirmarMismoDia(delivery_date, actual, { rol: me?.role }) && !(await preguntaMismoDia(confirmAction, t))) return;
    return updateDelivery(id, { delivery_date });
  };

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
  // Acotada (D-506), solo la SUYA: que a un compañero se le muriera la batería no es asunto del chofer, y la suya sí.
  const trackingIssues = useMemo(
    () => { const todos = trackingGaps(users, shifts, driverLocations); return miChofer == null ? todos.filter((c) => seVeElChofer(c.driver)) : soloLoMioPorChofer(todos, miChofer); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, driverLocations, healthTick, miChofer, alcanceChoferes, choferesConParada],
  );
  // Drivers on shift AND reporting — drives the LIVE tag. Recomputed on the
  // same minute tick so the tag clears by itself when a phone goes quiet, not
  // only when a new position happens to arrive.
  // D-903: dónde está cada chofer AHORA, con la mejor fuente: su teléfono o el rastreador del camión que lleva hoy
  // (`posicionesDeChoferes`). Misma forma que `driverLocations`; sin TrackSolid es exactamente `driverLocations`.
  // El aviso de «no reporta» (`trackingIssues`, arriba) sigue mirando SOLO el teléfono: que el camión cubra el hueco no
  // quita que haya un teléfono callado que arreglar.
  const { posiciones: posicionesAhora, camionesDeHoy: camionesDeLosChoferes } = usePosicionesDeChoferes(!!me && veCamiones);
  // Y qué camión lleva cada chofer el día que se está mirando (cabecera de la ruta, hoja PNG).
  const camionesDelDia = useCamionDelDia(date, { activo: !!me });
  const liveNames = useMemo(
    () => (veCamiones ? liveDriverNames(users, shifts, posicionesAhora) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, shifts, posicionesAhora, healthTick, veCamiones],
  );
  // Set by tapping a driver's LIVE tag: frame the map on where they are right
  // now. Cleared as soon as anything else takes over the map, so it's a
  // one-shot "show me" rather than a mode to get stuck in.
  const [locateDriver, setLocateDriver] = useState<string | null>(null);
  useEffect(() => { setLocateDriver(null); }, [selected, selectedOrders]);
  // The order opened from a stop's ID — the dispatcher wants the order itself,
  // not just its pin.
  const [openOrder, setOpenOrder] = useState<Delivery | null>(null);
  // «🗺 Ver en mapa» de las tablas de órdenes (ayuda 042c7dc1, Roberto: «When looking at orders would like option to see in
  // map»): las filas que la lista enseña AHORA, cada una un pin. Vale para «Sin asignar» y «Todas»; no toca el mapa grande.
  const [ordenesEnMapa, setOrdenesEnMapa] = useState(false);

  // Where each driver's phone last reported from, so the dispatcher can see
  // the fleet against the routes they planned.
  const liveDrivers = useMemo(() => {
    if (!veCamiones) return [];
    const nameById = new Map(users.map((u) => [u.id, u.full_name]));
    // Misma regla que el mapa de despacho y que la ruta del día de Almacén (D-289). El color se
    // pasa como estaba aquí: esta pantalla no usa `colorDeChofer`.
    const color = (n: string) => settings.driver_colors?.[n] || fallbackDriverColor(n);
    const todos = choferesEnVivo(posicionesAhora, nameById, color);
    // Acotada (D-506), solo SU camión: dónde está otro chofer ahora tampoco se le enseña.
    return (miChofer == null ? todos.filter((c) => seVeElChofer(c.driver)) : soloLoMioPorChofer(todos, miChofer)).map((c) => marcaEnVivo(c, t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posicionesAhora, healthTick, lang, users, settings.driver_colors, veCamiones, miChofer, alcanceChoferes, choferesConParada]);

  // Los camiones de la empresa por su rastreador GPS (TrackSolid, D-900). Es OTRA fuente que los 🚚 de arriba: aquellos
  // son el teléfono del chofer; estos, el aparato atornillado al camión, que sigue reportando aunque el chofer no fiche.
  // Solo en la vista de planificación (no en «Ruta de hoy» ni en «Mi ruta»), y solo si la instalación tiene TrackSolid:
  // si no, `disponible` es false y ni el interruptor se pinta. No entran en `fitTo`: no mueven el encuadre de las rutas.
  const rastreadores = useCamionesDeTracksolid(!!me && !soloLectura && !soloElMapa && canPlanRoutes(me));
  const [capaCamiones, setCapaCamiones] = useState(true);
  useEffect(() => { try { if (window.localStorage.getItem(CLAVE_CAPA_CAMIONES) === "0") setCapaCamiones(false); } catch { /* sin navegador */ } }, []);
  const alternaCapaCamiones = (ver: boolean) => {
    setCapaCamiones(ver);
    try { window.localStorage.setItem(CLAVE_CAPA_CAMIONES, ver ? "1" : "0"); } catch { /* sin navegador */ }
  };
  // El dueño, 2026-11-06 (D-903): un camión que ese día no lleva ningún chofer está estacionado y en el mapa solo estorba.
  // Se pintan los ASIGNADOS ese día (`repartoParaElMapa`); los demás, solo con «sin asignar (N)», que nace apagado y no
  // se recuerda: cada vez que se abre el Gestor, el mapa vuelve limpio.
  const [verSinAsignar, setVerSinAsignar] = useState(false);
  const repartoDeCamiones = useMemo(() => {
    if (!rastreadores.disponible) return SIN_REPARTO;
    const conRuta = new Set([...dayOrders.map((d) => d.assigned_driver), ...hechasPintadas.keys()]
      .flatMap((n) => { const id = n ? users.find((x) => x.role === "driver" && x.full_name === n)?.id : null; return id ? [id] : []; }));
    return repartoParaElMapa(rastreadores.camiones.filter((c) => c.lat != null && c.lng != null).map((c) => c.imei), camionesDelDia.asignaciones, conRuta);
  }, [rastreadores.disponible, rastreadores.camiones, camionesDelDia.asignaciones, dayOrders, hechasPintadas, users]);
  const camionesEnMapa = useMemo<TruckMarker[]>(() => {
    if (!rastreadores.disponible || !capaCamiones) return SIN_CAMIONES_EN_MAPA;
    const ahora = Date.now();
    // D-903: UNA marca por «chofer + camión». El camión cuya posición ya está fundida en la marca redonda de su chofer
    // no se pinta otra vez como cuadrado. Y el nombre que lleva el cuadrado es el del chofer de HOY, no el habitual.
    const fundidos = new Set(liveDrivers.flatMap((d) => (d.fusion ? [d.fusion.camion.imei] : [])));
    return rastreadores.camiones.flatMap((crudo) => {
      if (crudo.lat == null || crudo.lng == null || fundidos.has(crudo.imei)) return [];
      const asignado = repartoDeCamiones.asignados.get(crudo.imei);
      if (!asignado && !verSinAsignar) return [];
      // Asignado pero sin fundir (el chofer aún no abre turno, o se mira otro día): sale como camión, con su chofer de ese día.
      const c = { ...crudo, chofer: asignado?.driver ?? null };
      const txt = textoDelCamion(c, ahora, t, lang);
      // Enlazado en Ajustes: el color de la ruta de su chofer. Sin enlazar: pizarra, que no es de ninguna ruta.
      const color = c.chofer ? colorDeChofer(settings.driver_colors, c.chofer) : COLOR_DE_CAMION_SIN_CHOFER;
      return [{ id: c.imei, lat: crudo.lat, lng: crudo.lng, color, estado: txt.estado, etiqueta: txt.etiqueta, titulo: txt.titulo, lineas: txt.lineas }];
    });
    // `pulso` y `healthTick`: «hace X min» se recalcula cada minuto aunque no llegue nada nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rastreadores.disponible, rastreadores.camiones, rastreadores.pulso, capaCamiones, settings.driver_colors, lang, healthTick, liveDrivers, repartoDeCamiones, verSinAsignar]);
  const camionesSinSenal = camionesEnMapa.filter((c) => c.estado === "stale");

  // D-707: el de baja no tiene carril propio; si aún tiene órdenes ese día sale como carril huérfano (carrilesDelDia).
  const todosLosChoferes = useMemo(() => users.filter((u) => u.role === "driver"), [users]);
  const drivers = useMemo(() => soloActivos(todosLosChoferes), [todosLosChoferes]);
  const realDriverNames = useMemo(() => new Set(todosLosChoferes.map((d) => d.full_name)), [todosLosChoferes]);
  const isRealDriver = (name: string) => realDriverNames.has(name);

  // "Route buckets" — build routes before a real driver exists. Each bucket is a
  // pseudo-driver (its name lives in assigned_driver) so the whole route
  // machinery works on it; later the route is handed to an actual driver.
  const bucketNames = useMemo(
    () => (settings.route_buckets ?? []).filter((n) => !todosLosChoferes.some((d) => d.full_name === n)),
    [settings.route_buckets, todosLosChoferes],
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
  // Acotada (D-506), solo SU carril: los demás choferes no salen ni vacíos, y tampoco las rutas temporales («Ruta 1»), que
  // `rutasConOrdenes` deja en el panel aunque estén vacías porque el Gestor las renombra y las vacía — él no.
  const lanes = useMemo<Lane[]>(
    () => { const todos = carrilesDelDia(drivers, bucketNames, dayOrders, hechasPintadas.keys()); return miChofer == null ? todos.filter((l) => l.isBucket || seVeElChofer(l.driver)) : soloMisCarriles(todos, miChofer); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers, dayOrders, bucketNames, hechasPintadas, miChofer, alcanceChoferes, choferesConParada],
  );
  // El filtro de chofer que manda ahora (D-481): lo marcado en el panel, si esas rutas siguen en la pantalla; vacío = todos.
  const filtroChofer = useMemo(() => marcadosVigentes(selected, lanes.map((l) => l.key)), [selected, lanes]);
  const pasaFiltro = (ruta: string | null | undefined) => pasaElFiltro(filtroChofer, ruta);
  const lanesDelFiltro = lanes.filter((l) => pasaFiltro(l.key));
  // D-846: lo que cada chofer MANEJÓ ese día (su GPS), para pintarlo encima de su ruta planeada. Solo los choferes de
  // verdad (no las rutas temporales ni las huérfanas) y quien ve camiones (`veCamiones`); la base decide qué filas ve cada
  // rol (121). El dueño: «quiero que la ruta que lleva el driver esté en otro color al de su ruta, para comparar».
  const choferesDelRecorrido = useMemo(() => lanes.filter((l) => !l.isBucket && !l.id.startsWith("orphan:") && !l.id.startsWith("bucket:")).map((l) => ({ id: l.id, nombre: l.driver })), [lanes]);
  const recorridoDelDia = useRecorridoDelDia(choferesDelRecorrido, date, veCamiones, driverLocations, date === todayISO(), camionesDeLosChoferes.posiciones); // D-909: con camión, su rastro

  // Desde qué puesto se numera la ruta de un chofer al moverla a mano: tras lo que ya recogió o entregó en esas fechas, que
  // el Gestor no enseña pero «Mi ruta» sí (D-433, `inicioDeLaSecuencia`).
  // Lo ya recogido o entregado de esa ruta en las fechas de sus paradas: no se pinta, pero sí cuenta para numerar y para
  // saber si la ruta sigue siendo la publicada (D-433, `lecturaConLoHecho`).
  const hechasDeLaRuta = (laneKey: string, stops: Delivery[]) =>
    hechasDelChofer(deliveries, laneKey, new Set(stops.map((s) => s.delivery_date ?? null)));
  // D-992: lo hecho se queda en SU puesto y las pendientes llenan los puestos libres (antes se numeraban tras lo último
  // hecho, y todo lo entregado subía arriba del todo en cuanto alguien movía una parada).
  const inicioDeLaRuta = (laneKey: string, stops: Delivery[]) => numeracionConHechas(hechasDeLaRuta(laneKey, stops), stops.filter((s) => !ETAPAS_FIJAS.has(s.stage)));
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
  /** La ruta del DÍA de un chofer (D-529): lo pendiente de la lectura, con lo ya hecho primero, en su hora real (D-459; desde 2026-11-19), numerado por
   *  paradas (D-485) y etiquetado P/D sobre el día entero, como «Mi ruta» (D-515). El dueño, 2026-10-11: «when a order is
   *  delviered dont take the number of the stop away». Lo leen la tabla, el mapa, el horario y los avisos de mover, para que
   *  los cuatro digan el mismo número; lo que se MUEVE sigue siendo la lectura de lo pendiente. */
  // `comoIba` (false): lo hecho donde iba, para la MEDIDA y la clave del plan, que no cambian al hacer una parada (D-584).
  // D-1119: una ruta que el admin acomodó a mano (alguna entregada con `done_sort_at`) se pinta por sus puestos
  // (`route_seq`), no por el plan publicado: si no, lo que mueve no se ve.
  const rutaAcomodadaDe = (laneKey: string) => hechasDe(laneKey).some((h) => !!h.done_sort_at);
  const diaDe = (laneKey: string, stops: Delivery[], lectura: LecturaDeRuta = lecturaDe(laneKey, stops), comoIba = true) =>
    diaDeLaRuta(lectura, stops, hechasDe(laneKey), capacityFor(driverOf(laneKey)), rutaAcomodadaDe(laneKey) ? null : paradasPublicadasDe(laneKey), comoIba);
  /** La etiqueta del DÍA («P3») de la fila pendiente que cumple `cual`, para los avisos de mover: la misma que pinta la fila. */
  const etiquetaDelDia = (laneKey: string, stops: Delivery[], lectura: LecturaDeRuta, cual: (f: FilaDeLaRuta) => boolean): string => {
    const fi = lectura.filas.findIndex(cual);
    return fi < 0 ? "" : diaDe(laneKey, stops, lectura).etiquetaDePendiente[fi] ?? "";
  };
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
      if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: puestoEn(desde, e.ids.indexOf(d.id)), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) }))) return false;
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
  /** Dónde acaba la ruta ESE día, para la fila del regreso (166): la tienda del fin si es otra que la de salida («Termina en»),
   *  o «no vuelve» si el chofer no vuelve a base. Sin salida, `null` (lo dice la fila de la salida). */
  const finDeLaFila = (laneKey: string): { otra: boolean; texto: string } | null => {
    const sale = tiendaBaseDe(laneKey);
    if (!sale) return null;
    const fin = tiendaFinDe(laneKey);
    if (!fin) return { otra: true, texto: t("(doesn’t return to base: the route ends at its last stop)", "(no vuelve a base: la ruta acaba en su última parada)") };
    const otra = fin.name !== sale.name, dir = (fin.address ?? "").trim() || fin.name;
    return { otra, texto: otra ? `${fin.name} — ${dir}` : dir };
  };
  const filaDeLaBase = (laneKey: string, cual: "salida" | "regreso", f: FilaDeCuenta, noCuadra: boolean) => (
    <tr key={`base-${cual}`} data-base={cual}>
      <td style={{ fontWeight: 700 }} title={t("Base", "Base")} aria-label={t("Base", "Base")}>🏠</td>
      <td className="hint" style={{ margin: 0 }}>{cual === "salida" ? t("Base: leaves", "Base: salida") : finDeLaFila(laneKey)?.otra ? t("Ends at", "Termina en") : t("Base: returns", "Base: regreso")}</td>
      <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12, color: noCuadra ? "var(--red)" : undefined, fontWeight: noCuadra ? 700 : undefined }}>
        {/* Solo cuántos van a bordo (D-444): «0». Sin «libres» ni «/ capacidad»: el dueño, «no quiero que pongas libre». */}
        {numeroDePallets(f.despues)}
        {noCuadra && <div data-no-cuadra>⚠ {t("doesn’t come back empty: the count doesn’t add up", "no vuelve vacío: la cuenta no cuadra")}</div>}
      </td>
      {(() => {
        const direccion = (cual === "regreso" ? finDeLaFila(laneKey)?.texto : null) ?? pickupAddressFor(laneKey) ?? t("(no base: the driver has no store)", "(sin base: el chofer no tiene tienda)");
        // La hora de la base en la columna «Llegada» (D-647; el dueño: «its missing the eta to the base as well»): la salida y,
        // si el chofer vuelve (tiene base y fin), la llegada a la base, las dos de la misma medida que pone las de cada parada
        // (`stat.start` / `stat.end`, con el tramo vacío de vuelta). Sin columna «Llegada» o sin medida, la fila como antes.
        const i = colsParadas.findIndex((c) => c.key === "p_eta");
        const stat = routeStats[laneKey];
        const vuelve = !!tiendaBaseDe(laneKey) && !!tiendaFinDe(laneKey);
        const hora = !stat ? null : cual === "salida" ? stat.start : vuelve ? stat.end : null;
        if (i < 0 || !hora) return <td colSpan={colsParadas.length} className="hint" style={{ margin: 0 }}>{direccion}</td>;
        const despues = colsParadas.length - i - 1;
        const celdaHora = <td key="hora" data-hora-de-la-base={cual} style={{ fontWeight: 600 }}>{hora}</td>;
        return (
          <>
            {i > 0 ? <td colSpan={i} className="hint" style={{ margin: 0 }}>{direccion}</td> : null}
            {celdaHora}
            {i === 0 ? <td colSpan={Math.max(1, despues)} className="hint" style={{ margin: 0 }}>{direccion}</td> : despues > 0 ? <td colSpan={despues} /> : null}
          </>
        );
      })()}
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
  // D-1139 (reunión del 22 nov, Roberto: «sometimes it doesn't let me move things»): un movimiento que no se hace NUNCA se
  // queda callado. Los dos casos que no decían nada: soltar mientras el movimiento anterior se sigue guardando (con mala
  // conexión son varios segundos: una escritura por parada) y mover mientras «🧭 Optimizar» calcula (su resultado, hecho con
  // la lista de antes, pisaba el movimiento). Ahora se dice y no se pierde nada: se repite cuando acabe.
  const avisaSiOptimiza = (): boolean => {
    if (optimizando == null) return false;
    notify(t(`Not moved: Optimize is still working on ${laneLabel(optimizando)}. Wait for it to finish, then move.`, `No se movió: Optimizar sigue trabajando en ${laneLabel(optimizando)}. Espera a que termine y vuelve a mover.`), { ms: 6000 });
    return true;
  };
  const avisaSiGuarda = (): boolean => {
    if (!moviendo) return false;
    notify(t("Not moved: the previous move is still saving. Try again in a moment.", "No se movió: el movimiento anterior se sigue guardando. Inténtalo de nuevo en un momento."), { ms: 6000 });
    return true;
  };
  /** «No se movió»: la orden cuya entrega quedaría antes que su recogida. Lo dicen igual las flechas y el arrastre. */
  const avisaDeLaPrecedencia = (laneKey: string, stops: Delivery[], lectura: LecturaDeRuta, orden: string) => {
    const o = stops.find((x) => x.id === orden);
    const n = o ? facturaYId(o).principal : "";
    const d = etiquetaDelDia(laneKey, stops, lectura, (f) => f.tipo === "D" && f.orden === orden);
    notify(t(
      `Not moved: ${d} ${n} would be delivered before it's picked up. A delivery always goes after its pickup. Move its pickup up first.`,
      `No se movió: ${d} ${n} se entregaría antes de recogerla. Una entrega va siempre después de su recogida. Sube primero su recogida.`,
    ), { ms: 8000 });
  };
  /** D-1024: los relevos del día (paso b → paso a), para que un bloque de marcadas no ponga la recogida de un paso b antes
   *  de la entrega de su paso a (la misma regla que D-994). */
  const opcionesDelBloque = (): OpcionesDelBloque => ({ relevos: new Map([...pasoAnteriorPorId(dayOrders)].map(([b, a]) => [b, a.id])) });
  /** D-1024: «No se movió» del bloque: la precedencia o el relevo, con la orden que lo impide. */
  const avisaDelBloque = (laneKey: string, stops: Delivery[], lectura: LecturaDeRuta, r: { motivo: string; orden?: string }) => {
    if (r.motivo === "precedencia" && r.orden) avisaDeLaPrecedencia(laneKey, stops, lectura, r.orden);
    if (r.motivo === "borde") notify(t("Not moved: the checked orders are already there, or that spot is a finished stop.", "No se movió: las órdenes marcadas ya están ahí, o ese puesto es de una parada ya hecha."), { ms: 6000 });
    if (r.motivo !== "relevo" || !r.orden) return;
    const o = stops.find((x) => x.id === r.orden);
    const n = o ? facturaYId(o).principal : "";
    notify(t(
      `Not moved: ${n} is the second leg of a transfer and would be picked up before its first leg arrives.`,
      `No se movió: ${n} es el paso b de una transferencia y se recogería antes de que llegue su paso a.`,
    ));
  };
  // ---- LOS MOVIMIENTOS DE LA LISTA, EN FILA (D-1145) -------------------------------------------------------------
  // El dueño, 2026-11-23: «cuando le quiero dar rearrange a veces no me deja, arregla eso, que sea más fluido». Roberto, en
  // la reunión: «I move it up and then it just won't move», y una parada recién movida que volvía a su sitio. Dos causas:
  //   · soltar una parada mientras la anterior se guardaba se RECHAZABA («el movimiento anterior se sigue guardando»), y
  //     guardar eran varios segundos (una escritura por fila, una detrás de otra);
  //   · las flechas ni siquiera esperaban: dos pulsadas seguidas escribían la lista a la vez, cada una con su foto de la
  //     lista, y la primera en acabar soltaba el candado del tiempo real con la otra a medias: la lista se releía partida.
  // Ahora cada movimiento (flechas, arrastre, «Pasar a…», «mover a la parada N», «traer su entrega») se pone EN FILA: espera
  // al anterior y se calcula sobre la lista que ESE dejó, buscando su fila por lo que es (su orden), no por el puesto que
  // tenía al pulsar. Nada se rechaza y nada se pisa. Y guardar es más corto: de 6 en 6 (`reorderStops`).
  const filaDeMovimientos = useRef<Promise<unknown>>(Promise.resolve());
  const movimientosEnFila = useRef(0);
  const gestosDeLaLista = useRef<{
    flecha: (ruta: string, clave: string, dir: -1 | 1) => Promise<void>;
    suelta: (ruta: string, clave: string, destino: string, claveDestino: string | null) => Promise<void>;
    pasaA: (origen: string, ids: readonly string[], destino: string) => Promise<void>;
    aParada: (ruta: string, clave: string, numero: number, entera: boolean) => Promise<void>;
    traeEntrega: (ruta: string, clave: string) => Promise<void>;
  } | null>(null);
  const enFila = (trabajo: () => Promise<void>): Promise<void> => {
    const habiaOtro = movimientosEnFila.current > 0;
    movimientosEnFila.current += 1;
    setMoviendo(true);
    const hecho = filaDeMovimientos.current.then(async () => {
      // Con otro delante, un respiro: que la pantalla tenga ya la lista que dejó (el trabajo usa la de ESE momento).
      if (habiaOtro) await new Promise((r) => setTimeout(r, 40));
      await trabajo();
    }).catch(() => undefined).finally(() => {
      movimientosEnFila.current -= 1;
      setMoviendo(movimientosEnFila.current > 0);
    });
    filaDeMovimientos.current = hecho;
    return hecho;
  };
  /** Dónde está AHORA en la lista la fila con esa clave (−1 si ya no está: otra persona la quitó, o se entregó). */
  const indiceDeLaClave = (laneKey: string, clave: string) => lecturaDe(laneKey, byDriver.get(laneKey) ?? []).paradas.findIndex((x) => claveDeLaFila(x) === clave);
  const avisaQueLaListaCambio = () => notify(t("Not moved: that stop is no longer in the list (it changed while the previous move was saving).", "No se movió: esa parada ya no está en la lista (cambió mientras se guardaba el movimiento anterior)."), { ms: 6000 });
  const mueveParada = (laneKey: string, indice: number, dir: -1 | 1) => {
    const p = lecturaDe(laneKey, byDriver.get(laneKey) ?? []).paradas[indice];
    if (!p) return Promise.resolve();
    const clave = claveDeLaFila(p);
    return enFila(() => gestosDeLaLista.current!.flecha(laneKey, clave, dir));
  };
  const mueveParadaYa = async (laneKey: string, indice: number, dir: -1 | 1) => {
    const stops = byDriver.get(laneKey) ?? [];
    const lectura = lecturaDe(laneKey, stops);
    const p = lectura.paradas[indice];
    if (!p) return;
    if (avisaSiOptimiza()) return;
    const etiquetaDe = (i: number) => etiquetaDelDia(laneKey, stops, lectura, (f) => f.indice === i);
    if (p.tipo === "P" && !hayRecogidaGuardada) {
      notify(t("Moving a pickup needs the database update (migration 154). Deliveries can be moved; pickups follow the usual rule.", "Mover una recogida necesita la actualización de la base (migración 154). Las entregas sí se mueven; las recogidas siguen la regla de siempre."));
      return;
    }
    // D-1024: si la fila es de una orden marcada y hay otra marcada en la lista, la flecha mueve el BLOQUE de marcadas un puesto.
    const bloque = ordenesDelBloque(lectura.paradas, marcadas, indice);
    if (bloque) {
      const rb = flechaDelBloque(lectura.paradas, bloque, dir, opcionesDelBloque());
      if (!rb.ok) { avisaDelBloque(laneKey, stops, lectura, rb); return; }
      const n = bloque.length;
      if (!(await guardaLaLista(laneKey, stops, rb.paradas, { en: `${n} orders ${dir < 0 ? "up" : "down"}`, es: `${n} órdenes ${dir < 0 ? "arriba" : "abajo"}` }))) return;
      senalaLaMovida(claveDeLaFila(p));
      fijaLasMovidas(bloque);
      notify(t(`${n} orders moved ${dir < 0 ? "up" : "down"} one place`, `${n} órdenes movidas ${dir < 0 ? "arriba" : "abajo"} un puesto`));
      return;
    }
    const r = mueveEnLaLista(lectura.paradas, indice, dir);
    if (!r.ok) {
      if (r.motivo === "precedencia") avisaDeLaPrecedencia(laneKey, stops, lectura, r.orden);
      return;
    }
    const nombre = p.tipo === "D" ? (() => { const o = stops.find((x) => x.id === p.orden); return o ? facturaYId(o).principal : ""; })() : (p.tienda ?? t("(no store)", "(sin tienda)"));
    const etiqueta = etiquetaDe(indice);
    if (!(await guardaLaLista(laneKey, stops, r.paradas, { en: `${etiqueta} ${nombre} ${dir < 0 ? "up" : "down"}`, es: `${etiqueta} ${nombre} ${dir < 0 ? "arriba" : "abajo"}` }))) return;
    senalaLaMovida(claveDeLaFila(p));
    fijaLasMovidas(p.tipo === "P" ? p.ordenes : [p.orden]);
    notify(t(`${etiqueta} ${nombre} → stop ${indice + dir + 1} of ${r.paradas.length}`, `${etiqueta} ${nombre} → parada ${indice + dir + 1} de ${r.paradas.length}`));
  };
  /** «Pasar a…» (D-443, en cada fila P y D): las órdenes de la parada, enteras —recogida y entrega—, a la ruta de otro chofer.
   *  Entran al final de su lista, sin puesto, como «Asignar» (`assignToLane`), y se dice. */
  // D-459: entra en deshacer/rehacer, como las flechas. La foto lleva las DOS rutas —la de salida y la de llegada—, así
  // que deshacer devuelve la orden a su chofer y a su puesto de una vez: no puede quedar a medias.
  const pasaA = (origen: string, ids: readonly string[], destino: string) => enFila(() => gestosDeLaLista.current!.pasaA(origen, ids, destino));
  const pasaAYa = async (origen: string, ids: readonly string[], destino: string) => {
    if (!destino || !ids.length) return;
    if (avisaSiOptimiza()) return;
    const afectadas = [...(byDriver.get(origen) ?? []), ...(byDriver.get(destino) ?? [])];
    const antes = fotoDe(afectadas.map(aParadaDelGantt));
    const despues = { ...antes };
    for (const id of ids) if (antes[id]) despues[id] = { ...antes[id], assigned_driver: destino, route_seq: null, load_no: null };
    const cambios = ids.map((id) => cambioDeAsignacion(id, destino));
    const nombre = afectadas.filter((d) => ids.includes(d.id)).map((d) => facturaYId(d).principal).join(" · ");
    setMoviendo(true);
    try {
      for (const id of ids) await assignToLane(id, destino);
      await anotaMovimiento({ en: `${nombre} → ${laneLabel(destino)}`, es: `${nombre} → ${laneLabel(destino)}` }, [origen, destino], antes, despues);
    } finally {
      setMoviendo(false);
    }
    trasAsignar(cambios);
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
  // D-1118: «hecha» = una entrega YA ENTREGADA que arrastra el admin.
  type Arrastrado = { tipo: "orden"; id: string } | { tipo: "parada"; ruta: string; indice: number } | { tipo: "hecha"; ruta: string; orden: string };
  const [arrastrado, setArrastrado] = useState<Arrastrado | null>(null);
  // Sobre qué se está pasando: «ruta:<chofer>» (su tarjeta o su fila del panel) o «fila:<chofer>:<puesto>».
  const [sobre, setSobre] = useState<string | null>(null);
  const pulsadoEnControl = useRef(false);
  // D-1139: si el arrastre que se cancela empezó sobre el número de la orden (un enlace), se dice por dónde agarrar la fila.
  const pulsadoEnEnlace = useRef(false);
  const filaArrastrable = (a: Arrastrado) => {
    const mira = (e: React.MouseEvent | React.TouchEvent) => {
      pulsadoEnControl.current = !!(e.target as HTMLElement).closest("button, select, input, textarea, a, label, [data-abre-la-orden], .col-resizer");
      pulsadoEnEnlace.current = !!(e.target as HTMLElement).closest("a, [data-abre-la-orden]");
    };
    return {
      draggable: true,
      onMouseDown: mira,
      onTouchStart: mira,
      onDragStart: (e: React.DragEvent) => {
        if (pulsadoEnControl.current && pulsadoEnEnlace.current) notify(t("To drag a stop, grab the row outside the order number (the number opens the order).", "Para arrastrar una parada, agarra la fila fuera del número de la orden (el número abre la orden)."), { ms: 6000 });
        if (pulsadoEnControl.current) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", a.tipo === "orden" ? a.id : a.tipo === "hecha" ? a.orden : `${a.ruta}#${a.indice}`);
        e.dataTransfer.effectAllowed = "move";
        // D-1024: con varias órdenes marcadas en esta lista, lo que sigue al puntero es «N órdenes» (el bloque que se mueve).
        if (a.tipo === "parada") {
          const stops = byDriver.get(a.ruta) ?? [];
          const bloque = ordenesDelBloque(lecturaDe(a.ruta, stops).paradas, marcadas, a.indice);
          if (bloque) {
            const g = document.createElement("span");
            g.className = "badge";
            g.textContent = t(`${bloque.length} orders`, `${bloque.length} órdenes`);
            g.style.position = "fixed";
            g.style.top = "-1000px";
            document.body.appendChild(g);
            e.dataTransfer.setDragImage(g, 0, 0);
            window.setTimeout(() => g.remove(), 0);
          }
        }
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
  /** D-1118 (solo admin): lleva la entrega `movida` al puesto de la entrega `destino` en la ruta, entregadas y pendientes
   *  juntas, y reescribe los puestos (`route_seq`). Las entregadas de la ruta quedan acomodadas (`done_sort_at`) para que la
   *  tabla las pinte por puesto. La hora real no se toca. */
  const reacomodaEntregas = async (ruta: string, movida: string, destino: string) => {
    if (me?.role !== "admin" || movida === destino) return;
    const stops = byDriver.get(ruta) ?? [];
    // La lista TAL COMO SE VE (lo hecho arriba por hora, o por puesto si la ruta ya está acomodada).
    const filas = diaDe(ruta, stops, lecturaDe(ruta, stops), !rutaAcomodadaDe(ruta)).pintadas;
    const ids: string[] = [];
    for (const f of filas) {
      const id = f.hecha ? (f.tipo === "D" ? f.orden : null) : (f.fila.tipo === "D" ? f.fila.orden : null);
      if (id && !ids.includes(id)) ids.push(id);
    }
    const de = ids.indexOf(movida); const a = ids.indexOf(destino);
    if (de < 0 || a < 0) return;
    ids.splice(de, 1); ids.splice(a, 0, movida);
    const porId = new Map([...stops, ...hechasDe(ruta)].map((d) => [d.id, d]));
    const ahora = new Date().toISOString();
    setMoviendo(true);
    try {
      for (let i = 0; i < ids.length; i++) {
        const d = porId.get(ids[i]);
        if (!d) continue;
        const cambio: Partial<Delivery> = {};
        if (d.route_seq !== i) cambio.route_seq = i;
        if (d.stage === "delivered" && !d.done_sort_at) cambio.done_sort_at = ahora;
        if (Object.keys(cambio).length && !(await updateDelivery(d.id, cambio, { quiet: true }))) return;
      }
      const d = porId.get(movida);
      notify(t(`${d ? facturaYId(d).principal : ""} → stop ${a + 1}`, `${d ? facturaYId(d).principal : ""} → parada ${a + 1}`));
    } finally {
      setMoviendo(false);
    }
  };
  /** D-1118: una fila entregada como sitio donde soltar (solo admin): lo que se suelta toma su puesto. */
  const sueltaSobreHecha = (ruta: string, orden: string) => {
    if (!arrastrado || me?.role !== "admin") return {};
    const clave = `hecha:${ruta}:${orden}`;
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (sobre !== clave) setSobre(clave); },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        const a = arrastrado; setArrastrado(null); setSobre(null);
        if (!a || a.tipo === "orden" || a.ruta !== ruta) return;
        if (a.tipo === "hecha") { void reacomodaEntregas(ruta, a.orden, orden); return; }
        const stops = byDriver.get(ruta) ?? [];
        const pd = lecturaDe(ruta, stops).paradas[a.indice];
        if (pd?.tipo === "D") void reacomodaEntregas(ruta, pd.orden, orden);
        else notify(t("A pickup can't be dropped on a delivered stop; move the delivery.", "Una recogida no se suelta sobre una entregada; mueve la entrega."));
      },
    };
  };
  const sueltaEnLaRuta = async (destino: string, indice: number | null) => {
    const a = arrastrado;
    setArrastrado(null);
    setSobre(null);
    if (!a) return;
    if (a.tipo === "parada") {
      // D-1145: una parada soltada va EN FILA (ver `enFila`): no se rechaza si la anterior se sigue guardando.
      const origen = lecturaDe(a.ruta, byDriver.get(a.ruta) ?? []).paradas[a.indice];
      const sobreLa = indice == null ? null : lecturaDe(destino, byDriver.get(destino) ?? []).paradas[indice];
      if (!origen || (indice != null && !sobreLa)) return;
      const claveOrigen = claveDeLaFila(origen), claveDestino = sobreLa ? claveDeLaFila(sobreLa) : null;
      await enFila(() => gestosDeLaLista.current!.suelta(a.ruta, claveOrigen, destino, claveDestino));
      return;
    }
    if (avisaSiOptimiza() || avisaSiGuarda()) return;
    if (a.tipo === "hecha") {
      // D-1118: una entregada soltada sobre una ENTREGA pendiente de su ruta toma su puesto.
      if (a.ruta !== destino || indice == null) return;
      const pd = lecturaDe(destino, byDriver.get(destino) ?? []).paradas[indice];
      if (pd?.tipo === "D") await reacomodaEntregas(destino, a.orden, pd.orden);
      return;
    }
    if (a.tipo === "orden") {
      const d = deliveries.find((x) => x.id === a.id);
      if (!d) return;
      // Si la fila arrastrada es una de varias marcadas, van todas: lo mismo que hace su desplegable «Asignar a…».
      if (selectedOrders.has(a.id) && poolSelectedCount > 1) { await bulkAssign(destino); return; }
      manualAssign(a.id, destino);
      notify(t(`${facturaYId(d).principal} → ${laneLabel(destino)} (at the end of its list)`, `${facturaYId(d).principal} → ${laneLabel(destino)} (al final de su lista)`));
      return;
    }
  };
  /** D-1145: lo que hace una parada soltada, cuando le toca en la fila. La fila que se movió y la fila sobre la que se
   *  soltó se buscan AHORA, por su clave: si el movimiento anterior cambió los puestos, siguen siendo las mismas filas. */
  const sueltaParadaYa = async (rutaDeOrigen: string, claveOrigen: string, destino: string, claveDestino: string | null) => {
    if (avisaSiOptimiza()) return;
    const a = { ruta: rutaDeOrigen, indice: indiceDeLaClave(rutaDeOrigen, claveOrigen) };
    const indice = claveDestino == null ? null : indiceDeLaClave(destino, claveDestino);
    const stops = byDriver.get(a.ruta) ?? [];
    const lectura = lecturaDe(a.ruta, stops);
    const p = lectura.paradas[a.indice];
    if (!p || (indice != null && indice < 0)) { avisaQueLaListaCambio(); return; }
    const etiqueta = etiquetaDelDia(a.ruta, stops, lectura, (f) => f.indice === a.indice);
    const ids = p.tipo === "P" ? p.ordenes : [p.orden];
    // D-1024: si hay varias órdenes marcadas en esta lista, van TODAS (en su orden de lista), no solo la arrastrada.
    const bloque = ordenesDelBloque(lectura.paradas, marcadas, a.indice);
    const movidas = (bloque ?? ids).flatMap((id) => { const d = stops.find((x) => x.id === id); return d ? [d] : []; });
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
        if (bloque) {
          // D-1024: el bloque de marcadas va a este puesto (antes de la fila si sube, detrás si baja), en una sola escritura.
          const rb = mueveBloque(lectura.paradas, bloque, indice, opcionesDelBloque());
          if (!rb.ok) { avisaDelBloque(a.ruta, stops, lectura, rb); return; }
          if (!(await guardaLaLista(destino, stops, rb.paradas, { en: `${bloque.length} orders → stop ${indice + 1}`, es: `${bloque.length} órdenes → parada ${indice + 1}` }))) return;
          senalaLaMovida(claveDeLaFila(p));
          fijaLasMovidas(bloque);
          notify(t(`${bloque.length} orders → stop ${indice + 1} of ${rb.paradas.length}.`, `${bloque.length} órdenes → parada ${indice + 1} de ${rb.paradas.length}.`));
          return;
        }
        const r = llevaEnLaLista(lectura.paradas, a.indice, indice);
        if (!r.ok) { if (r.motivo === "precedencia") avisaDeLaPrecedencia(a.ruta, stops, lectura, r.orden); return; }
        if (!(await guardaLaLista(destino, stops, r.paradas, { en: `${etiqueta} ${nombre} → stop ${indice + 1}`, es: `${etiqueta} ${nombre} → parada ${indice + 1}` }))) return;
        senalaLaMovida(claveDeLaFila(p));
        fijaLasMovidas(ids);
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
      // Soltada con un puesto: queda fijada a mano en la ruta de destino; la de origen se vuelve a optimizar (sin esa orden).
      // Sin puesto (al final): no queda fijada, y las dos rutas se optimizan solas.
      const cambiosDeLaSuelta = movidas.map((d) => cambioDeAsignacion(d.id, destino));
      if (indice != null) {
        const idsMovidas = movidas.map((d) => d.id);
        fijaLasMovidas(idsMovidas);
        trasAsignar(cambiosDeLaSuelta, { colocadasAMano: idsMovidas });
      } else {
        trasAsignar(cambiosDeLaSuelta);
      }
      for (const d of movidas) addNote(d.id, `Dragged to ${destino} (from ${a.ruta})`);
      senalaLaMovida(movidas[0].id);
      const ex = avisoDeExceso(lista, todas, destino);
      notify(t(`${nombre} → ${laneLabel(destino)}${indice == null ? " (at the end of its list)" : `, stop ${indice + 1}`}.${ex.en}`, `${nombre} → ${laneLabel(destino)}${indice == null ? " (al final de su lista)" : `, parada ${indice + 1}`}.${ex.es}`));
    } finally {
      setMoviendo(false);
    }
  };
  /** Las flechas, cuando les toca en la fila: la fila se busca por su clave. */
  const flechaYa = async (laneKey: string, clave: string, dir: -1 | 1) => {
    const i = indiceDeLaClave(laneKey, clave);
    if (i < 0) { avisaQueLaListaCambio(); return; }
    await mueveParadaYa(laneKey, i, dir);
  };
  // ---- «# Mover a la parada N» y «traer su entrega» (D-1145; la regla, en lib/mover-a-parada) ----------------------
  // El «#» de cada fila abre un diálogo corto: el número de parada (el del círculo) y dos botones: solo esa fila, o la
  // orden entera (recogida y entrega juntas). Si la fila es de una orden MARCADA y hay más marcadas en la lista, van todas.
  const [moverA, setMoverA] = useState<{ ruta: string; clave: string } | null>(null);
  const [numeroParaMover, setNumeroParaMover] = useState("");
  const cierraMoverA = () => { setMoverA(null); setNumeroParaMover(""); };

  // ---- «No fue este chofer…» (solo admin, en una entregada): quien la entregó de verdad (p. ej. un gerente de almacén) y
  // el día real. Un solo cambio: chofer, día y puestos a null; la etapa se queda en «entregada». Reglas en lib/entregada-por-otro.
  const [entregadaPorOtro, setEntregadaPorOtro] = useState<{ order: Delivery; quien: string; dia: string } | null>(null);
  const AVISO_DE_ENTREGADA_POR_OTRO: Record<MotivoDeEntregadaPorOtro, { en: string; es: string }> = {
    "quien-vacio": { en: "Write who delivered it.", es: "Escribe quién la entregó." },
    "quien-largo": { en: `Keep it under ${LARGO_MAX_QUIEN} characters.`, es: `Que no pase de ${LARGO_MAX_QUIEN} caracteres.` },
    "mismo-chofer": { en: "That is already the driver on this order: nothing to change.", es: "Ese ya es el chofer de esta orden: no hay nada que cambiar." },
    "dia-no-valido": { en: "Pick a valid day.", es: "Elige un día válido." },
    "dia-futuro": { en: "The delivery day can't be after today.", es: "El día de la entrega no puede ser después de hoy." },
  };
  // Con hora de entrega registrada (`pod_delivered_at`), la base deja la orden en el día de esa hora (trigger 222): el día
  // no se elige y no se manda en el parche. Sin hora, el día es el que se elija (por defecto, el de la orden).
  const abreEntregadaPorOtro = (order: Delivery) => setEntregadaPorOtro({
    order, quien: "", dia: diaQueSeGuarda({ dia: order.delivery_date ?? ahoraDelNegocio().fecha, podDeLaEntrega: order.pod_delivered_at }),
  });
  const guardaEntregadaPorOtro = async () => {
    const x = entregadaPorOtro;
    if (!x) return;
    const podDeLaEntrega = x.order.pod_delivered_at;
    const motivo = validaEntregadaPorOtro({ quien: x.quien, dia: diaQueSeGuarda({ dia: x.dia, podDeLaEntrega }), hoy: ahoraDelNegocio().fecha, choferActual: x.order.assigned_driver });
    if (motivo) { notify(t(AVISO_DE_ENTREGADA_POR_OTRO[motivo].en, AVISO_DE_ENTREGADA_POR_OTRO[motivo].es)); return; }
    const quien = x.quien.trim();
    const anterior = x.order.assigned_driver;
    // Un solo write por el proveedor; si falla, el proveedor ya avisó y el diálogo se queda abierto para reintentar.
    if (!(await updateDelivery(x.order.id, parcheDeEntregadaPorOtro({ quien, dia: x.dia, conRecogida: hayRecogidaGuardada, podDeLaEntrega })))) return;
    await addNote(x.order.id, notaDeEntregadaPorOtro({ quien, dia: x.dia, anterior, podDeLaEntrega }));
    setEntregadaPorOtro(null);
    notify(t(`#${orderLabel(x.order)} marked delivered by ${quien}.`, `#${orderLabel(x.order)} marcada entregada por ${quien}.`));
  };
  const aParadaYa = async (laneKey: string, clave: string, numero: number, entera: boolean) => {
    if (avisaSiOptimiza()) return;
    const stops = byDriver.get(laneKey) ?? [];
    const lectura = lecturaDe(laneKey, stops);
    const indice = lectura.paradas.findIndex((x) => claveDeLaFila(x) === clave);
    const p = lectura.paradas[indice];
    if (!p) { avisaQueLaListaCambio(); return; }
    const bloque = ordenesDelBloque(lectura.paradas, marcadas, indice);
    const ordenes = bloque ?? (entera ? (p.tipo === "P" ? p.ordenes : [p.orden]) : null);
    if (!hayRecogidaGuardada && (p.tipo === "P" || ordenes)) { notify(t("Moving a pickup needs the database update (migration 154).", "Mover una recogida necesita la actualización de la base (migración 154).")); return; }
    const r = mueveAParada(lectura.paradas, rangosDeParada(lectura.filas, diaDe(laneKey, stops, lectura).dePendiente), indice, numero, ordenes, opcionesDelBloque());
    if (!r.ok) {
      if (r.motivo === "no_existe") notify(t(`Not moved: stop ${numero} is not a pending stop of this route (pending: ${r.min} to ${r.max}).`, `No se movió: la parada ${numero} no es una parada pendiente de esta ruta (pendientes: de la ${r.min} a la ${r.max}).`), { ms: 7000 });
      else if (r.motivo === "borde") notify(t(`Not moved: it is already at stop ${numero}.`, `No se movió: ya está en la parada ${numero}.`));
      else avisaDelBloque(laneKey, stops, lectura, r);
      return;
    }
    const etiqueta = etiquetaDelDia(laneKey, stops, lectura, (f) => f.indice === indice);
    const nombre = r.ordenes.map((id) => { const o = stops.find((x) => x.id === id); return o ? facturaYId(o).principal : ""; }).filter(Boolean).join(" · ");
    const que = bloque ? { en: `${bloque.length} orders`, es: `${bloque.length} órdenes` } : ordenes ? { en: `Order ${nombre}`, es: `Orden ${nombre}` } : { en: `${etiqueta} ${nombre}`, es: `${etiqueta} ${nombre}` };
    if (!(await guardaLaLista(laneKey, stops, r.paradas, { en: `${que.en} → stop ${numero}`, es: `${que.es} → parada ${numero}` }))) return;
    senalaLaMovida(clave);
    fijaLasMovidas(r.ordenes);
    const n = cuentaDePallets(cambiosDeLaLista(r.paradas, stops), capacityFor(driverOf(laneKey))).totales.paradasConExceso;
    notify(t(`${que.en} → stop ${numero}.${n > 0 ? ` ⚠ over capacity at ${n} stop(s).` : ""}`, `${que.es} → parada ${numero}.${n > 0 ? ` ⚠ se pasa de la capacidad en ${n} parada(s).` : ""}`));
  };
  const traeEntregaYa = async (laneKey: string, clave: string) => {
    if (avisaSiOptimiza()) return;
    const stops = byDriver.get(laneKey) ?? [];
    const lectura = lecturaDe(laneKey, stops);
    const indice = lectura.paradas.findIndex((x) => claveDeLaFila(x) === clave);
    const p = lectura.paradas[indice];
    if (!p) { avisaQueLaListaCambio(); return; }
    if (!hayRecogidaGuardada) { notify(t("Needs the database update (migration 154).", "Necesita la actualización de la base (migración 154).")); return; }
    const r = traeLaEntrega(lectura.paradas, indice, opcionesDelBloque());
    if (!r.ok) {
      if (r.motivo === "borde") notify(t("Its delivery already goes right after this pickup.", "Su entrega ya va justo después de esta recogida."));
      else if (r.motivo !== "no_existe") avisaDelBloque(laneKey, stops, lectura, r);
      return;
    }
    const etiqueta = etiquetaDelDia(laneKey, stops, lectura, (f) => f.indice === indice);
    const nombre = r.ordenes.map((id) => { const o = stops.find((x) => x.id === id); return o ? facturaYId(o).principal : ""; }).filter(Boolean).join(" · ");
    if (!(await guardaLaLista(laneKey, stops, r.paradas, { en: `Delivery of ${nombre} right after ${etiqueta}`, es: `Entrega de ${nombre} justo después de ${etiqueta}` }))) return;
    senalaLaMovida(clave);
    fijaLasMovidas(r.ordenes);
    notify(t(`Delivery of ${nombre} → right after its pickup (${etiqueta}).`, `Entrega de ${nombre} → justo después de su recogida (${etiqueta}).`));
  };
  // Lo último de cada gesto: la fila los llama cuando les toca, con la lista de ESE momento (no la de cuando se pulsó).
  gestosDeLaLista.current = { flecha: flechaYa, suelta: sueltaParadaYa, pasaA: pasaAYa, aParada: aParadaYa, traeEntrega: traeEntregaYa };
  // ---- DESPLAZAR SOLA la lista al arrastrar (D-1145) -------------------------------------------------------------
  // El dueño: «si lo muevo hacia arriba que él haga el scroll, porque ahorita debo ir haciendo como escalones». Mientras se
  // arrastra, cerca del borde de arriba o de abajo de lo que se ve se desplaza la caja que tenga más que enseñar bajo el
  // puntero (la tabla de la ruta, el panel) y, si ninguna, la página. La velocidad, `velocidadDeAutoScroll`.
  const arrastrando = arrastrado != null;
  useEffect(() => {
    if (!arrastrando) return;
    let x = -1, y = -1, cuadro = 0;
    const mira = (e: DragEvent) => { x = e.clientX; y = e.clientY; };
    const paso = () => {
      cuadro = requestAnimationFrame(paso);
      if (y < 0) return;
      const alto = window.innerHeight;
      for (let el = document.elementFromPoint(x, y) as HTMLElement | null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        if (el.scrollHeight <= el.clientHeight + 1) continue;
        const desborde = getComputedStyle(el).overflowY;
        if (desborde !== "auto" && desborde !== "scroll") continue;
        const caja = el.getBoundingClientRect();
        const v = velocidadDeAutoScroll(y, Math.max(caja.top, 0), Math.min(caja.bottom, alto));
        if ((v < 0 && el.scrollTop > 0) || (v > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) { el.scrollTop += v; return; }
      }
      const pagina = document.scrollingElement;
      const v = velocidadDeAutoScroll(y, 0, alto);
      if (pagina && v) pagina.scrollTop += v;
    };
    document.addEventListener("dragover", mira, true);
    cuadro = requestAnimationFrame(paso);
    return () => { document.removeEventListener("dragover", mira, true); cancelAnimationFrame(cuadro); };
  }, [arrastrando]);

  // ---- «🧭 Optimizar» una ruta (D-456, rehecho en D-461) ---------------------------------------------------------
  // El dueño, 2026-10-01: «have the optimize option for every route when selecting a driver and optimize it». D-437 lo había
  // quitado. Vuelve POR RUTA: reordena solo las paradas de esa tarjeta —recogidas y entregas—. Y el 2026-10-02, con el primero
  // en la calle: «sigamos trabajando en el alrgoritmo de optimizar ruta porque sigue muy mal ineficente». Aquel decidía en
  // línea recta, sin mirar ventanas, y salía de la tienda de recogida más repetida en vez de la base del chofer. Ahora:
  //   · sale de la BASE del chofer (`baseDeLaRuta`) y vuelve a ella;
  //   · mide POR CALLES: una petición de matriz por pulsación (`/api/route-matrix`), y ninguna si esta forma de la ruta ya se
  //     pidió (`tiemposPedidos`). Si no contesta, estima en línea recta y el aviso lo dice;
  //   · el orden lo decide `optimizaSinEmpeorar` (D-1029; el dueño, 2026-11-12: «más bien agrega más millas y aumenta el
  //     tiempo estimado»): NUNCA más millas ni más jornada de tarjeta que lo que hay, ni más retraso ni más exceso. Primero lo
  //     que arregla un retraso o un exceso sin costar nada; si no, la jornada y las millas más cortas sin retrasar más a nadie.
  //     Si no hay nada así, no toca la ruta y dice «ya está en buen orden»;
  //   · se guarda por `guardaLaLista` (Ctrl+Z lo deshace) y la medida de siempre pone las llegadas. Con candado 🔒 no
  //     optimiza, y lo dice. El aviso dice lo ganado (`avisoDeOptimizar`).
  const [optimizando, setOptimizando] = useState<string | null>(null);
  const tiemposPedidos = useRef(new Map<string, TiemposPedidos>());
  // La huella de una ruta (chofer, día, paradas en orden, órdenes con pallets y direcciones): cambia si cambia la ruta.
  const paradaParaHuella = (p: ParadaDeLaLista) => ({ orden: p.tipo === "D" ? p.orden : p.ordenes.join("+"), tipo: p.tipo });
  const ordenParaHuella = (d: Delivery) => ({ id: d.id, pallets: palletsDeLaOrden(d), origen: d.pickup_address ?? null, destino: d.delivery_address ?? null });
  const huellaDeLaRutaCon = (laneKey: string, lista: readonly ParadaDeLaLista[], stops: readonly Delivery[]): string =>
    huellaDeLaRuta({ chofer: laneKey, dia: date, paradas: lista.map(paradaParaHuella), ordenes: stops.map(ordenParaHuella) });
  /** La huella de la ruta de un chofer TAL COMO ESTÁ AHORA (la lista que pinta la tarjeta). */
  const huellaDeLaLane = (laneKey: string): string => {
    const stops = byDriver.get(laneKey) ?? [];
    return huellaDeLaRutaCon(laneKey, lecturaDe(laneKey, stops).paradas, stops);
  };
  // Lo que la cola de movimientos comprueba antes de escribir una auto-optimización: la huella del último render.
  const huellaVivaRef = useRef<(laneKey: string) => string>(() => "");
  huellaVivaRef.current = huellaDeLaLane;
  /** La entrada del optimizador para UNA lista de la ruta (lo mismo que arma «Optimizar», sin el arranque ni el relevo). */
  const entradaDeLaRuta = (laneKey: string, lista: readonly ParadaDeLaLista[], ordenes: readonly Delivery[], base: { lat: number; lng: number } | null) =>
    entradaDeOptimizar({ lista, ordenes, base, fin: finParaEstimar(laneKey), capacidad: capacityFor(driverOf(laneKey)), coordsDeTienda, esEstrecha: (ventana) => esVentanaDura(ventana, settings), salidaMin: DAY_START_MIN });

  /** Optimizar una ruta (el botón). Con 348: pregunta antes de pisar paradas fijadas a mano, no escribe un resultado que
   *  añada una regla dura que la ruta no rompía, y al guardar suelta las fijadas y marca la ruta como hecha. */
  const optimizaLaRuta = async (laneKey: string) => {
    if (optimizando != null || moviendo) return;
    if (bloqueada(laneKey)) {
      notify(t(`🔒 ${laneLabel(laneKey)} is locked — Optimize leaves it alone. Unlock it first.`, `🔒 ${laneLabel(laneKey)} está bloqueada — Optimizar no la toca. Desbloquéela primero.`));
      return;
    }
    const stops = byDriver.get(laneKey) ?? [];
    // (348) Con paradas fijadas a mano, Optimizar lo dice ANTES de pisarlas: la confirmación de siempre de esta pantalla.
    const pisa = hayAutoOptimizar ? avisoDePisar(stops) : null;
    if (pisa && !(await confirmAction(t(pisa.en, pisa.es), { danger: true, confirmLabel: t("Optimize anyway", "Optimizar igual") }))) return;
    const lista = lecturaDe(laneKey, stops).paradas;
    const base = baseDeLaRuta(laneKey);
    // D-1029: con la ruta de HOY ya a medias, lo pendiente sale de donde quedó el camión y a la hora que es, no de la base a
    // las 08:00; y termina donde terminaba (la base, o el fin de ese día).
    const arranque = arranqueDeLoPendiente({ hechos: [...hechasDe(laneKey), ...stops], fecha: date, hoy: ahoraDelNegocio(), salidaMin: DAY_START_MIN, coordsDeTienda, fechaDe: (x) => ahoraDelNegocio(x).fecha });
    const finDeSiempre = finParaEstimar(laneKey);
    const entrada = entradaDeOptimizar({
      lista, ordenes: stops, base: arranque && base ? arranque.punto : base, fin: arranque && base && finDeSiempre === undefined ? base : finDeSiempre, capacidad: capacityFor(driverOf(laneKey)), coordsDeTienda,
      esEstrecha: (ventana) => esVentanaDura(ventana, settings), salidaMin: arranque && base ? arranque.salidaMin : DAY_START_MIN,
    });
    // D-994: el paso b de un relevo no se recoge antes de que llegue su paso a (+1 h): esa recogida espera en la tienda.
    const desdeDelRelevo = recogidaDesdeDelRelevo(dayOrders, (id) => etaDeEntregaEn(routeEtas, id));
    const recogidaDesde = entrada.paradas.map((p) => {
      if (p.tipo !== "P") return null;
      const v = p.ordenes.map((id) => desdeDelRelevo.get(id)).filter((x): x is number => x != null);
      return v.length ? Math.max(...v) : null;
    });
    setOptimizando(laneKey);
    try {
      const tiempos = await tiemposDeLaRuta(puntosDeLaEntrada(entrada), tiemposPedidos.current, (puntos) =>
        fetch("/api/route-matrix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ puntos }) }));
      // D-1029: nunca peor que lo que hay, medido como lo enseña la tarjeta (millas, y jornada de manejo + parado).
      const r = optimizaSinEmpeorar({ ...entrada, recogidaDesde, tiempos: tiempos?.tiempos ?? null });
      // (348) Regla dura: no se escribe un resultado que AÑADA una regla que la ruta de ahora no rompe. Las que ya rompía, se dicen.
      const reglasNuevas = hayAutoOptimizar ? violacionesNuevas(reglasDeLaEntrada({ ...entrada, recogidaDesde }), r.reglas.violaciones) : [];
      if (reglasNuevas.length) {
        notify(t(`Not optimised: the result would break ${notaDeReglas(reglasNuevas)}. Nothing was changed.`, `No se optimizó: el resultado rompería ${notaDeReglas(reglasNuevas)}. No se cambió nada.`), { ms: 8000 });
        void marcaAutoDeRuta(date, laneKey, "fallo", { nota: notaDeReglas(reglasNuevas) }).catch(() => false);
        return;
      }
      const porId = new Map(stops.map((d) => [d.id, d]));
      const aviso = avisoDeOptimizar({
        ruta: laneLabel(laneKey), r, tiempos, hayBase: !!base, pallets: numeroDePallets, sinRecogidas: !hayRecogidaGuardada,
        nombreDe: (id) => { const d = porId.get(id); return d ? facturaYId(d).principal : id.slice(0, 6); },
      });
      // Si no hay nada mejor no se escribe: no hay nada que guardar ni que deshacer.
      if (r.cambio && !(await guardaLaLista(laneKey, stops, r.paradas, { en: `Optimize ${laneLabel(laneKey)}`, es: `Optimizar ${laneLabel(laneKey)}` }))) return;
      notify(t(aviso.en, aviso.es));
      if (hayAutoOptimizar) {
        // (348) Optimizar rehace la ruta entera: las paradas fijadas dejan de estarlo, y la ruta queda hecha.
        void fijaParadas(stops.map((d) => d.id), false).catch(() => false);
        if (r.reglas.violaciones.length) notify(t(`This route already broke ${notaDeReglas(r.reglas.violaciones)} before; this change didn't cause it.`, `Esta ruta ya rompía ${notaDeReglas(r.reglas.violaciones)} antes; este cambio no lo causó.`));
        void marcaAutoDeRuta(date, laneKey, "hecha", { huella: huellaDeLaRutaCon(laneKey, r.paradas, stops), nota: notaDeReglas(r.reglas.violaciones) || null }).catch(() => false);
      }
    } finally {
      setOptimizando(null);
    }
  };

  // Friendly display name for a lane key.
  /** Encola la auto-optimización de una ruta: UNA por chofer, 700 ms después del último cambio que la toca. */
  const encolaAuto = (laneKey: string, ordenes: readonly string[], colocadas: readonly string[] = []) => {
    corriendoAuto.current.add(laneKey);
    const lote = lotesAuto.current.get(laneKey) ?? { ordenes: [], colocadas: [], timer: null };
    for (const o of ordenes) if (!lote.ordenes.includes(o)) lote.ordenes.push(o);
    for (const c of colocadas) if (!lote.colocadas.includes(c)) lote.colocadas.push(c);
    if (lote.timer) clearTimeout(lote.timer);
    lote.timer = setTimeout(() => {
      lotesAuto.current.delete(laneKey);
      void autoRef.current?.(laneKey, lote.ordenes, lote.colocadas, 0);
    }, 700);
    lotesAuto.current.set(laneKey, lote);
  };

  /** El reintento de una ruta que falló: 5 s y luego 20 s (`reintentoAuto`). Después, se queda en «fallo». */
  const programaReintento = (laneKey: string, ordenes: readonly string[], colocadas: readonly string[], intento: number) => {
    const espera = reintentoAuto(intento);
    if (espera == null) return;
    clearTimeout(reintentosAuto.current.get(laneKey));
    reintentosAuto.current.set(laneKey, setTimeout(() => {
      reintentosAuto.current.delete(laneKey);
      void autoRef.current?.(laneKey, ordenes, colocadas, intento + 1);
    }, espera));
  };

  /** El cambio de una orden para `trasAsignar`: de qué chofer era AHORA y a cuál pasa. El día es el de su fila. */
  const cambioDeAsignacion = (id: string, despues: string | null): CambioDeAsignacion => {
    const d = deliveries.find((x) => x.id === id);
    return { orden: id, dia: d?.delivery_date ?? date, antes: d?.assigned_driver ?? null, despues };
  };

  /**
   * Al terminar una asignación (cada gesto lo llama con SUS cambios, después de guardar): las rutas que tocó se optimizan
   * solas. `lote.colocadasAMano` son las órdenes que una persona acaba de poner en un puesto a mano: ya van fijadas y no se
   * vuelven a colocar. Una orden que cambia de chofer SIN puesto elegido a mano pierde su marca (`route_fixed`).
   */
  const trasAsignar = (cambios: readonly CambioDeAsignacion[], lote?: { colocadasAMano?: readonly string[] }): void => {
    if (!hayAutoOptimizar) return;
    try {
      const aMano = lote?.colocadasAMano ?? [];
      const sueltanLaMarca = cambios
        .filter((c) => c.antes !== c.despues && !aMano.includes(c.orden) && deliveries.some((x) => x.id === c.orden && x.route_fixed === true))
        .map((c) => c.orden);
      if (sueltanLaMarca.length) void fijaParadas(sueltanLaMarca, false).catch(() => false);
      for (const r of rutasAOptimizar(cambios)) {
        if (r.dia !== date || !lanes.some((l) => l.key === r.chofer)) continue;
        encolaAuto(r.chofer, r.ordenes, aMano);
      }
    } catch {
      // La asignación ya está guardada: lo automático nunca la tumba.
    }
  };

  /** Una persona colocó estas órdenes en un puesto a mano: quedan fijadas y la auto-optimización no las vuelve a mover. */
  const fijaLasMovidas = (ids: readonly string[]) => {
    if (!hayAutoOptimizar || ids.length === 0) return;
    void fijaParadas(ids, true).catch(() => false);
  };

  /** La parada de una orden como la lee `mejorLugar` (lo mismo para «📍 Mejor lugar» y la colocación automática). */
  const paradaDeRuta = (x: Delivery): ParadaDeRuta => ({
    id: x.id, lat: x.delivery_lat, lng: x.delivery_lng, pallets: palletsDeLaOrden(x),
    ventana: parseWindow(x.delivery_windows), servicioMin: serviceMin(x.delivery_duration),
  });
  /** La lista SIN la orden `id` (su recogida y su entrega), para colocarla de nuevo. */
  const sacaLaOrden = (lista: readonly ParadaDeLaLista[], id: string): ParadaDeLaLista[] =>
    lista.flatMap((p): ParadaDeLaLista[] => {
      if (p.tipo === "D") return p.orden === id ? [] : [p];
      if (!p.ordenes.includes(id)) return [p];
      return p.ordenes.length > 1 ? [{ ...p, ordenes: p.ordenes.filter((x) => x !== id) }] : [];
    });
  /** La base para colocar: la de la ruta; con la ruta vacía, la recogida de la primera orden (como «📍 Mejor lugar»). */
  const baseDeColocacion = async (laneKey: string, primera: Delivery | undefined): Promise<{ lat: number; lng: number } | null> => {
    const direccion = (((byDriver.get(laneKey) ?? []).length ? pickupAddressFor(laneKey) : (primera?.pickup_address || pickupAddressFor(laneKey))) ?? "").trim();
    const tienda = settings.stores.find((s) => (s.address || "").trim() === direccion && s.lat != null && s.lng != null);
    const coords = tienda ? [tienda.lat!, tienda.lng!] as [number, number] : await getDepotCoords(direccion || null);
    return coords ? { lat: coords[0], lng: coords[1] } : null;
  };
  /**
   * El mejor puesto de UNA orden en la ruta: el hueco de `mejorLugar`, sin escribir nada. Quita a la orden de la lista si ya
   * estaba (la colocación automática la vuelve a poner). Lo usan «📍 Mejor lugar» y la colocación automática.
   */
  const huecoDeLaOrden = (laneKey: string, d: Delivery, paradas: readonly Delivery[], lista: readonly ParadaDeLaLista[], base: { lat: number; lng: number } | null) => {
    const sinD = paradas.filter((x) => x.id !== d.id);
    const listaSinD = sacaLaOrden(lista, d.id);
    const capacidad = capacityFor(driverOf(laneKey));
    const entregas = entregasDeLaLista(listaSinD, sinD);
    const cabe = admiteEnLaLista(listaSinD, sinD, capacidad);
    const r = mejorLugar({ viajes: [entregas.map(paradaDeRuta)], nueva: paradaDeRuta(d), base, fin: finParaEstimar(laneKey), capacidad, inicioMin: DAY_START_MIN, admite: (_v, puesto) => cabe(puesto, palletsDeLaOrden(d)) });
    return { r, entregas, listaSinD };
  };

  /**
   * Coloca las órdenes NUEVAS de la ruta, una a una, en su mejor puesto (`huecoDeLaOrden`), y guarda el resultado UNA
   * sola vez por `guardaLaLista` (Ctrl+Z lo deshace de un golpe; D-1201: antes se guardaba orden por orden y las filas
   * saltaban varias veces seguidas). Lo que ya estaba no se mueve. Si el resultado rompe una regla dura, esa orden se
   * queda al final (donde la dejó la asignación) y la ruta queda «fallo» con la regla en la nota.
   */
  const escribeLasNuevas = async (laneKey: string, marcadas: readonly Delivery[], base: { lat: number; lng: number } | null): Promise<ResultadoAuto> => {
    const iniciales = [...(byDriver.get(laneKey) ?? [])];
    let paradas = iniciales;
    const listaInicial = lecturaDe(laneKey, paradas).paradas;
    let lista = listaInicial;
    const colocadas: Delivery[] = [];
    const desde = inicioDeLaRuta(laneKey, paradas);
    const notas: string[] = [];
    for (const d of marcadas) {
      const { r, entregas, listaSinD } = huecoDeLaOrden(laneKey, d, paradas, lista, base);
      if (!r.ok) { notas.push("sin_punto"); continue; }
      const ids = entregas.map((x) => x.id);
      ids.splice(r.hueco.puesto, 0, d.id);
      const nueva = listaConEntregasEn(listaSinD, ids, [...paradas, d]);
      // Solo cuenta lo que la orden AÑADE a la ruta: lo que la ruta ya rompía no le impide entrar (se dice en la nota).
      const nuevas = violacionesNuevas(reglasDeLaEntrada(entradaDeLaRuta(laneKey, lista, paradas, base)), reglasDeLaEntrada(entradaDeLaRuta(laneKey, nueva, paradas, base)));
      if (nuevas.length) { notas.push(`#${orderLabel(d)}: ${notaDeReglas(nuevas)}`); continue; }
      const e = escrituraDeLaLista(nueva, desde);
      const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;
      if (!mismaSecuencia(lista, nueva)) {
        colocadas.push(d);
        const porId = new Map([...paradas, d].map((x) => [x.id, x]));
        paradas = e.ids.map((id, i) => ({
          ...porId.get(id)!, assigned_driver: laneKey, route_seq: puestoEn(desde, i), load_no: null,
          ...(recogidas ? { pickup_seq: recogidas[id] ?? null } : {}),
        }));
      }
      lista = nueva;
    }
    // Una sola escritura con todo lo colocado. Si nada cambió de lugar, no se escribe nada (ni un deshacer vacío).
    if (!mismaSecuencia(listaInicial, lista)) {
      const nombre = colocadas.map((d) => orderLabel(d)).join(", ");
      if (!(await guardaLaLista(laneKey, iniciales, lista, { en: `Auto-place ${nombre}`, es: `Colocación automática de ${nombre}` }))) throw new Error("no se guardó la colocación");
    }
    if (notas.length) return { estado: "fallo", nota: [...new Set(notas)].join("; "), reintentar: false };
    const previas = reglasDeLaEntrada(entradaDeLaRuta(laneKey, lista, paradas, base));
    return { estado: "hecha", huella: huellaDeLaRutaCon(laneKey, lista, paradas), nota: notaDeReglas(previas) || null };
  };
  /** La colocación automática de las órdenes nuevas de una ruta, con la comprobación de huella dentro de la cola. */
  const insertaEnLaRuta = async (laneKey: string, nuevas: readonly string[], huellaInicial: string): Promise<ResultadoAuto> => {
    const stops = byDriver.get(laneKey) ?? [];
    const delDia = new Set(dayOrders.map((d) => d.id));
    const marcadas = nuevas.map((id) => stops.find((x) => x.id === id)).filter((d): d is Delivery => !!d && delDia.has(d.id));
    if (!marcadas.length) return { estado: "nada" };
    const base = await baseDeColocacion(laneKey, marcadas[0]);
    let res: ResultadoAuto = { estado: "nada" };
    await enFila(async () => {
      if (huellaVivaRef.current(laneKey) !== huellaInicial) { res = { estado: "reprograma" }; return; }
      try {
        res = await escribeLasNuevas(laneKey, marcadas, base);
      } catch {
        res = { estado: "fallo", nota: t("The route couldn't be saved", "No se pudo guardar la ruta"), reintentar: true };
      }
    });
    return res;
  };

  // ---- LA AUTO-OPTIMIZACIÓN AL ASIGNAR (348) ---------------------------------------------------------------------------
  // Cada asignación (una, varias, repartir, pasar un bucket, mover de un chofer a otro, quitar) llama a `trasAsignar` al
  // terminar, con SUS cambios. Las rutas que tocó se optimizan solas, una vez por chofer (700 ms: un lote de asignaciones
  // seguidas es una sola pasada). Nada de esto tumba la asignación: si la consulta de tiempos falla o tarda, la orden se
  // queda asignada, la ruta queda «sin optimizar» y se reintenta (5 s, luego 20 s). Después se queda así hasta que se pulse.
  // Sin `hayAutoOptimizar` (la base sin la 348) todo esto no hace nada.
  type LoteAuto = { ordenes: string[]; colocadas: string[]; timer: ReturnType<typeof setTimeout> | null };
  const lotesAuto = useRef(new Map<string, LoteAuto>());
  // Las rutas que ESTA pestaña está calculando (con su corrida o con un lote pendiente). El chip «optimizando» solo vale para ellas.
  const corriendoAuto = useRef(new Set<string>());
  const reintentosAuto = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const ultimoLoteAuto = useRef(new Map<string, { ordenes: string[]; colocadas: string[] }>());
  const autoRef = useRef<((laneKey: string, ordenes: readonly string[], colocadas: readonly string[], intento: number) => Promise<void>) | null>(null);
  // Al cambiar de día o salir de la pantalla, no queda nada pendiente de ese día.
  useEffect(() => () => {
    for (const l of lotesAuto.current.values()) if (l.timer) clearTimeout(l.timer);
    lotesAuto.current.clear();
    for (const r of reintentosAuto.current.values()) clearTimeout(r);
    reintentosAuto.current.clear();
    ultimoLoteAuto.current.clear();
    corriendoAuto.current.clear();
  }, [date]);

  /** Marca la ruta en el estado automático del día. Nunca lanza. */
  const marcaAuto = (laneKey: string, estado: "pendiente" | "hecha" | "fallo", datos?: { huella?: string | null; nota?: string | null; sumaIntento?: boolean }) => {
    if (!hayAutoOptimizar) return;
    void marcaAutoDeRuta(date, laneKey, estado, datos).catch(() => false);
  };


  /**
   * Lo que pasa con una ruta cuando le toca a la auto-optimización. `planAuto` decide: nada, colocar las nuevas una a una
   * (`insertar`); nunca reacomoda la ruta entera, eso es del botón «Optimizar» (D-1201). Marca la ruta según el resultado.
   */
  const autoOptimizaCuerpo = async (laneKey: string, ordenes: readonly string[], colocadas: readonly string[], intento: number): Promise<void> => {
    if (!hayAutoOptimizar) return;
    const stops = byDriver.get(laneKey) ?? [];
    const huellaInicial = huellaDeLaLane(laneKey);
    const plan = planAuto({
      bloqueada: bloqueada(laneKey),
      pendientes: stops.map((d) => ({ id: d.id, route_fixed: d.route_fixed, route_seq: d.route_seq })),
      delLote: ordenes.filter((id) => !colocadas.includes(id)),
      huellaAhora: huellaInicial,
      guardado: estadoAutoDeRutas.get(claveDeRutaAuto(date, laneKey)) ?? null,
    });
    if (plan.que === "nada") {
      // Nada que hacer: si la ruta quedó guardada como pendiente, ya está al día: se marca hecha para que no quede pendiente.
      if (estadoAutoDeRutas.get(claveDeRutaAuto(date, laneKey))?.estado === "pendiente") marcaAuto(laneKey, "hecha", { huella: huellaInicial });
      return;
    }
    ultimoLoteAuto.current.set(laneKey, { ordenes: [...ordenes], colocadas: [...colocadas] });
    marcaAuto(laneKey, "pendiente");
    let res: ResultadoAuto;
    try {
      res = await insertaEnLaRuta(laneKey, plan.nuevas, huellaInicial);
    } catch {
      res = { estado: "fallo", nota: t("The route couldn't be optimised", "No se pudo optimizar la ruta"), reintentar: true };
    }
    if (res.estado === "reprograma") { encolaAuto(laneKey, ordenes, colocadas); return; }
    if (res.estado === "hecha") { marcaAuto(laneKey, "hecha", { huella: res.huella, nota: res.nota ?? null }); return; }
    if (res.estado === "nada") { marcaAuto(laneKey, "hecha", { huella: huellaDeLaLane(laneKey) }); return; }
    marcaAuto(laneKey, "fallo", { nota: res.nota, sumaIntento: res.reintentar });
    if (res.reintentar) programaReintento(laneKey, ordenes, colocadas, intento);
  };
  /** Una corrida de la auto-optimización de una ruta. Mientras dura, esta pestaña la marca como «en marcha» (el chip). */
  const autoOptimiza = async (laneKey: string, ordenes: readonly string[], colocadas: readonly string[], intento: number): Promise<void> => {
    corriendoAuto.current.add(laneKey);
    try {
      await autoOptimizaCuerpo(laneKey, ordenes, colocadas, intento);
    } finally {
      if (!lotesAuto.current.has(laneKey)) corriendoAuto.current.delete(laneKey);
    }
  };
  autoRef.current = autoOptimiza;

  /** El 📌 de una parada colocada a mano (348): si alguna de sus órdenes está fijada, lo pone; pulsarlo la suelta. */
  const pinFijada = (ids: readonly string[]) => {
    if (!hayAutoOptimizar || !ids.some((id) => deliveries.some((x) => x.id === id && x.route_fixed === true))) return null;
    return (
      <span role="button" tabIndex={0} data-fijada={ids.join(",")}
        title={t("Placed by hand — automatic optimisation won't move it. Click to release.", "Colocada a mano — la optimización automática no la mueve. Pulse para soltarla.")}
        onClick={(e) => { e.stopPropagation(); void fijaParadas(ids, false).catch(() => false); }}
        style={{ marginLeft: 3, cursor: "pointer" }}>📌</span>
    );
  };
  /** El botón «↻ sin optimizar — reintentar» de la tarjeta: vuelve a intentar esa ruta ya, con su último lote. */
  const reintentaAuto = (laneKey: string) => {
    clearTimeout(reintentosAuto.current.get(laneKey));
    reintentosAuto.current.delete(laneKey);
    const ult = ultimoLoteAuto.current.get(laneKey) ?? { ordenes: (byDriver.get(laneKey) ?? []).map((d) => d.id), colocadas: [] };
    void autoRef.current?.(laneKey, ult.ordenes, ult.colocadas, 0);
  };

  const laneLabel = (key: string) => lanes.find((l) => l.key === key)?.label ?? key;
  // «📸 PNG» (D-536): de qué ruta se está armando la imagen para el chofer. Una a la vez.
  const [pngDe, setPngDe] = useState<string | null>(null);
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
    const cambios = plan.moveIds.map((id) => cambioDeAsignacion(id, plan.targetKey));
    for (const id of plan.moveIds) await updateDelivery(id, plan.patch);
    trasAsignar(cambios);
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
    const cambios = stops.map((d) => cambioDeAsignacion(d.id, driver));
    for (const d of stops) {
      await updateDelivery(d.id, { assigned_driver: driver, load_no: null });
      addNote(d.id, `Route "${bucket}" assigned to ${driver}, after their own stops`);
    }
    await guardaLaLista(driver, [...suyas, ...stops], lista, { en: `Route ${bucket} → ${driver}`, es: `Ruta ${bucket} → ${driver}` });
    trasAsignar(cambios);
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
    // D-1144: UNA pasada, y de 6 en 6. Este bloque estaba dos veces (copia de una fusión vieja, v0.9.59) y todo salía a la
    // vez: vaciar dos rutas (29 órdenes) el 2026-11-23 fueron 240 escrituras en 10 s, la base se saturó y cortó lo
    // siguiente con «canceling statement due to statement timeout».
    const cambiosDeLaLimpieza = stops.map((d) => cambioDeAsignacion(d.id, null));
    for (let i = 0; i < stops.length; i += 6) {
      const tanda = stops.slice(i, i + 6);
      await Promise.all(tanda.map((d) => updateDelivery(d.id, { assigned_driver: null, route_seq: null, load_no: null })));
      await Promise.all(tanda.map((d) => addNote(d.id, `Unassigned (was ${laneKey})`)));
    }
    trasAsignar(cambiosDeLaLimpieza);
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
  /** El id del perfil de un chofer de verdad, por su nombre (las rutas van por nombre; los camiones, por id). D-903. */
  const choferIdDe = (driver: string | null) => (driver ? users.find((x) => x.role === "driver" && x.full_name === driver)?.id ?? null : null);
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
  // De qué tienda SALE y en cuál TERMINA cada chofer EL DÍA QUE SE MIRA (166, `base-del-dia.ts`). El dueño, 2026-10-11:
  // «choose the driver strarting position LOGISTIC MANAGER, DEFAULT IS THE ONE HE ALREADY WORKS ON» y «Need to be able to
  // assign store where driver is starting/ ending at». Desde D-1142 ya NO se elige en el panel (el dueño, 2026-11-23: se
  // programa en Ajustes → Rutas, «quiero que me quites eso de ahí»): lo ya guardado para un día pasado se sigue leyendo; sin
  // nada guardado, su base de siempre. QUÉ MANDA lo decide `extremosDeLaRuta`: la salida, la elegida para ese día > Ajustes > perfil;
  // el fin, el elegido > donde sale ese día; sin fin si no vuelve a base. De ahí salen la medida (millas, horas, llegadas), el
  // Optimizar, «Asignar a…», «📍 Mejor lugar», el horario y las marcas del mapa. Solo viendo UN día: «todas las fechas»
  // mezcla días, y ahí cada ruta sale de su base.
  const basesDelDia = useBasesDelDia(date, modo === "dia");
  const basesDelDiaPorNombre = useMemo(() => (modo === "dia" ? basesPorNombreDelDia(basesDelDia.bases, users) : new Map<string, BaseDelDia>()), [basesDelDia.bases, users, modo]);
  const noVuelven = useMemo(() => {
    const nombreDe = new Map(users.map((u) => [u.id, (u.full_name ?? "").trim()]));
    return new Set(ajustesDeChofer.filter((f) => f.returns_to_base === false).map((f) => nombreDe.get(f.profile_id) ?? "").filter(Boolean));
  }, [ajustesDeChofer, users]);
  const extremosDe = (laneKey: string) => extremosDeLaRuta(driverOf(laneKey), { delDia: basesDelDiaPorNombre, deAjustes: basesDeChofer, usuarios: users, noVuelven, tiendas: settings.stores ?? [] });
  const tiendaBaseDe = (laneKey: string) => extremosDe(laneKey).salida?.tienda ?? null;
  /** Dónde termina ese día (166); `null` = no vuelve (o no tiene salida). */
  const tiendaFinDe = (laneKey: string) => extremosDe(laneKey).fin?.tienda ?? null;
  const pickupAddressFor = (laneKey: string): string | null => (tiendaBaseDe(laneKey)?.address ?? "").trim() || null;

  // Lo del día sin chofer. Es lo que cuentan el resumen, la pestaña y el tablero (y contaba «Auto-asignar», quitado en
  // D-437): el DÍA, sea cual sea el chip de la tabla. Hasta D-393 el chip «Atrasadas» cambiaba también esta lista, y con él el «Sin programar» del
  // resumen y lo que «Auto-asignar» repartía; con un chip «Todas» de cualquier día, «Programadas» habría salido negativo.
  const unassigned = useMemo(() => sinAsignarDelGestor(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);
  // Las filas de la TABLA «Sin asignar», según su chip (D-359 «Atrasadas», D-393 «Todas»), y el número de cada chip,
  // que sale de la misma función: el número es el de las filas que enseña (patrón de D-380/D-384).
  const filasDelChip = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter), [deliveries, date, modo, poolFilter]);
  const cuentasDeChips = useMemo(() => cuentasSinAsignar(deliveries, date, modo, ROUTE_STAGES, orderSearchDiferida), [deliveries, date, modo, orderSearchDiferida]);
  // «Todas» (D-462): todo lo del día, con chofer o sin él, más lo ya hecho ese día (D-459), por el filtro de chofer de la
  // barra —con un chofer elegido, las suyas y las sin asignar (`todas-del-gestor.ts` dice por qué)—. La pestaña cuenta
  // «Este día» sin búsqueda; la tabla y sus chips, con su chip y su búsqueda. Las tres salen de la misma función.
  // «Todas» es TODAS (D-499): no sigue el filtro de choferes del panel. El dueño, 2026-10-08, con captura de «Todas (3)» y el
  // filtro en «ningún chofer»: «todas son todas si apreto driver me aparecen 20 y si no en 3 pero son todas».
  const sinFiltroDeChofer = useMemo(() => new Set<string>(), []);
  const todasDelDia = useMemo(() => todasDelGestor(deliveries, date, modo, ROUTE_STAGES, sinFiltroDeChofer), [deliveries, date, modo, sinFiltroDeChofer]);
  const filasDeTodasDelChip = useMemo(() => filasDeTodas(deliveries, date, modo, ROUTE_STAGES, chipDeTodas, "", sinFiltroDeChofer), [deliveries, date, modo, chipDeTodas, sinFiltroDeChofer]);
  const todasConBusqueda = useMemo(() => filasDeTodas(deliveries, date, modo, ROUTE_STAGES, chipDeTodas, busquedaDeTodasDiferida, sinFiltroDeChofer), [deliveries, date, modo, chipDeTodas, busquedaDeTodasDiferida, sinFiltroDeChofer]);
  const cuentasDeTodasAqui = useMemo(() => cuentasDeTodas(deliveries, date, modo, ROUTE_STAGES, busquedaDeTodasDiferida, sinFiltroDeChofer), [deliveries, date, modo, busquedaDeTodasDiferida, sinFiltroDeChofer]);
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
      const chosen = dayOrders.filter((d) => (selectedOrders.has(d.id) || ordenesResaltadas.has(d.id)) && d.delivery_lat != null && d.delivery_lng != null);
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
  }, [selectedOrders, dayOrders, ordenesResaltadas]);

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
  // El recuadro «Elige conductor» va en el flujo, debajo de la tabla: al abrirse (y solo entonces) la página baja hasta él.
  // «nearest»: si ya se ve entero, no se mueve.
  const elegeRef = useRef<HTMLDivElement>(null);
  const elegeAbierto = !soloLectura && poolSelectedCount > 0;
  useEffect(() => {
    if (elegeAbierto) elegeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [elegeAbierto]);

  // Search + saved filter over the unassigned pool. La misma función que da el número de cada chip (D-393).
  const unassignedShown = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter, orderSearchDiferida), [deliveries, date, modo, poolFilter, orderSearchDiferida]);

  // Each driver's stops for the day, in their current sequence (saved
  // order first, unsequenced ones after — same rule as the Driver page).
  // Keyed by LANE (driver+load, or bucket), so each of a driver's loads is its
  // own route.
  // D-621: la entrega de lo YA RECOGIDO sigue en la ruta como parada pendiente (se mueve, se mide, cuenta su carga).
  const enElCamion = useMemo(() => [...hechasPintadas.values()].flat().filter((d) => estaEnElCamion(d.stage)), [hechasPintadas]);
  const byDriver = useMemo(() => rutasPorChofer([...dayOrders, ...enElCamion.filter((d) => !dayOrders.some((x) => x.id === d.id))]), [dayOrders, enElCamion]);
  const aBordoDe = (stops: readonly Delivery[]): number => stops.filter((d) => estaEnElCamion(d.stage)).reduce((n, d) => n + (Number(d.actual_pallets ?? d.est_pallets ?? 0) || 0), 0);
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
  // Los eventos de cada orden (`order_events`, la ventana que trae la app): de ahí sale de qué día viene una arrastrada.
  const eventosPorOrden = useMemo(() => {
    const m = new Map<string, typeof events>();
    for (const e of events) { const lista = m.get(e.delivery_id); if (lista) lista.push(e); else m.set(e.delivery_id, [e]); }
    return m;
  }, [events]);
  // Saltadas hoy y rechazadas por el cliente (D-487): la misma pastilla que en Órdenes, en la columna de Etapa.
  const marcasDeParada = useMemo(() => marcasDeParadas(events, todayISO()), [events]);
  // `nombreDe` (D-652): la columna «Vendedor» que el plan hereda de Órdenes pinta el nombre, no el id.
  const ctxDeOrdenes = useMemo(() => ({ lang, t, motivos: motivosDeAnulacion(settings), recibidas, marcas: marcasDeParada, nombreDe: nombresPorId(users) }), [lang, t, settings, recibidas, marcasDeParada, users]);
  const deOrdenes = useMemo(() => ({ catalogo: ORDER_COLUMNS, ctx: ctxDeOrdenes }), [ctxDeOrdenes]);
  // Las ciudades conocidas para leer una dirección escrita sin comas (D-423, `ciudadDeEntrega`): las que salen limpias de
  // las órdenes cargadas y de las tiendas, y las zonas de los choferes. La misma lista para la celda, el orden y el filtro.
  const ciudadesQueSeConocen = useMemo(
    () => [...ciudadesConocidas([...deliveries.map((d) => d.delivery_address), ...(settings.stores ?? []).map((s) => s.address)]), ...[...zonasDeChofer.values()].flat()],
    [deliveries, settings.stores, zonasDeChofer],
  );
  // El valor para ordenar y filtrar y el menú de cada columna de «Sin asignar» y «Todas» van más abajo, tras la medida de
  // las rutas (`useMedidaDeRutas`): la «Llegada» de una orden con chofer sale de ella (D-548).
  /** La celda de una columna que el Gestor toma de Órdenes: la MISMA función que pinta Órdenes, o nada si no viene de allí. */
  const celdaDeOrdenes = (clave: string, d: Delivery) => columnaDeOrdenes(clave, ORDER_COLUMNS)?.cell(d, ctxDeOrdenes);
  /** La celda de la tabla del plan (D-434): sus dos columnas propias —tipo de cliente y ciudad de recogida— y, las demás, la de
   *  Órdenes. La ciudad se lee con las mismas tiendas y ciudades conocidas que el resto del Gestor. */
  const celdaDelPlan = (clave: string, d: Delivery) =>
    celdaPropiaDelPlan(clave, d, { reglas: settings.order_type_rules, tiendas: settings.stores ?? [], conocidas: ciudadesQueSeConocen, es: lang === "es" }) ?? celdaDeOrdenes(clave, d);
  /** Las pastillas (la etapa, «Tarde») bajan de línea en vez de cortarse, como en Órdenes (D-364). */
  const clasePastillas = (clave: string) => (columnaDeOrdenes(clave, ORDER_COLUMNS)?.pastillas ? "td-pastillas" : undefined);
  /**
   * La celda de una columna de PARADAS (`p_*`) para la orden `d`: UNA función para todas las tablas que las pintan —las
   * filas P, D y ya hechas de la tabla de paradas de cada chofer, y «Sin asignar» y «Todas» desde D-548—. Hasta aquí había
   * tres copias de este `switch` en la tabla de paradas; con las dos tablas de órdenes habrían sido cuatro.
   *   · `tipo`: «P» en una fila de recogida —lo que es de la ENTREGA (ventanas, contacto…) va vacío, `seVeEnLaRecogida`—;
   *     «D» en una entrega y en las tablas de órdenes.
   *   · `llegada`: la celda de la «Llegada» entera, que cada tabla calcula a su manera (la medida, la hora real, «—»).
   *   · `recogida`: lo que dice la «Ciudad de recogida» cuando no es la ciudad de la tienda de la orden (en una P, la TIENDA).
   *   · `sinAviso`: sin el aviso de «solo ciudad» (en una fila ya hecha nunca lo llevó).
   */
  /** «Recogido» / «Entregado» del admin desde la celda de ETAPA (con «Cambiar etapa» activo). Pregunta una vez, nombrando la
   *  factura y la etapa nueva, y escribe con el mismo `setStage` que la ficha. Solo admin: el resto nunca llega aquí. */
  const cambiarEtapaDeLaOrden = async (d: Delivery, accion: AccionDeEtapaAdmin) => {
    if (!me || !puedeCambiarEtapaAqui(me.role)) return;
    const { mensaje, confirmar } = preguntaCambiarEtapaAdmin(accion, facturaYId(d).principal, t);
    // 2026-11-25, el dueño: «desde que le cambio a entregado, that's it, no pidas más confirmación». Solo la recogida pregunta.
    if (accion !== "entregar" && !(await confirmAction(mensaje, { confirmLabel: confirmar }))) return;
    const e = escrituraCambiarEtapaAdmin({ accion, pedido: d, me, t });
    if (await setStage(d.id, e.stage, e.note, e.extra)) notify(t("Stage changed", "Etapa cambiada"));
  };
  const celdaDeParada = (c: ColumnaDelGestor, d: Delivery | undefined, como: { tipo: "P" | "D"; llegada: React.ReactNode; recogida?: React.ReactNode; sinAviso?: boolean; fueraDeOrden?: boolean; ordenes?: Delivery[] }) => {
    switch (c.key) {
      case "p_type": return <td key={c.key} title={d?.order_type || undefined}>{d?.order_type || "—"}</td>;
      // «Usuario» (D-652, como en Órdenes): el vendedor de la orden. Una recogida con varias, sus nombres distintos (`ordenes`).
      case "p_rep": {
        const nombres = [...new Set((como.ordenes ?? (d ? [d] : [])).map((x) => ctxDeOrdenes.nombreDe?.(orderOwner(x)) ?? null).filter((n): n is string => !!n))];
        return <td key={c.key}>{nombres.join(" · ") || "—"}</td>;
      }
      case "p_eta": return <Fragment key={c.key}>{como.llegada}</Fragment>;
      case "p_actual": return celdaReal(c.key, d, como.tipo, como.fueraDeOrden);
      case "p_ciudad_recogida": return <td key={c.key}>{como.recogida ?? ((d && zonaDeLaRecogida(d, settings.stores ?? [], ciudadesQueSeConocen, settings.order_type_rules)) || "—")}</td>;
      case "p_address": return <td key={c.key} title={d?.delivery_address || undefined}>{(d && ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen)) || "—"}{!como.sinAviso && <AvisoSoloCiudad orden={d} corto />}</td>;
      case "p_windows": return <td key={c.key}>{como.tipo === "D" && d ? fmtWindows(d.delivery_windows) : ""}</td>;
    }
    if (!d || (como.tipo === "P" && !seVeEnLaRecogida(c))) return <td key={c.key} />;
    // Admin con «Cambiar etapa» activo: la insignia de siempre, y al lado lo que se puede cambiar de esta orden. Entregada y
    // anulada solo llevan la insignia. Ningún otro rol cambia lo que ve.
    const esLaCeldaDeEtapa = c.key === "p_stage" || c.key === "stage";
    const accionesEtapa = cambiarEtapa && esLaCeldaDeEtapa && puedeCambiarEtapaAqui(me?.role) ? accionesDeEtapaParaAdmin(d.stage) : [];
    if (accionesEtapa.length === 0) return <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, d)}</td>;
    // D-1087 (ayuda del dueño: «está horrible… que cuando se apriete "Listo" suelte un dropdown con las otras opciones»):
    // la insignia de siempre, con una flechita; encima va un <select> nativo invisible, así al tocarla se abre el menú
    // del sistema (que nunca queda cortado por la tabla) con lo que se puede marcar. La fila no crece.
    return (
      <td key={c.key} className={clasePastillas(c.key)}>
        <span data-cambiar-etapa style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2, cursor: "pointer" }}>
          {celdaDeOrdenes(c.key, d)}
          <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
          <select
            value=""
            aria-label={t("Change stage", "Cambiar etapa")}
            title={t("Change stage", "Cambiar etapa")}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { const a = e.target.value as AccionDeEtapaAdmin; if (a) void cambiarEtapaDeLaOrden(d, a); }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
          >
            <option value="">{t("Change to…", "Cambiar a…")}</option>
            {accionesEtapa.map((a) => (
              <option key={a} value={a} data-cambiar-etapa-accion={a}>{a === "recoger" ? t("Picked up", "Recogido") : t("Delivered", "Entregado")}</option>
            ))}
          </select>
        </span>
      </td>
    );
  };
  // Pulsar el ID o la factura abre la orden entera, como en la tabla de paradas por chofer (D-360). Para el
  // dueño «still pending the clicking on the ID or invoice # to view the full order details».
  // En solo lectura (D-481), la orden ENTERA solo se abre si esta persona YA la puede leer, y un vendedor solo las suyas
  // (`ordenLegible`, la regla de D-467); si no, la factura es texto sin gesto.
  const abreLaOrden = (d: Delivery): { onClick?: (e: React.MouseEvent) => void; style: React.CSSProperties; title?: string } => {
    const legible = soloLectura ? ordenLegible(d.id, deliveriesLeidas, me, { teaching }) : d;
    if (!legible) return { style: {} };
    return {
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpenOrder(legible); },
      style: { cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 },
      title: t("Open this order", "Abrir esta orden"),
    };
  };
  // Sin la columna del ID (D-408), el enlace que abre la orden es la FACTURA. En «Sin asignar» lo pintaba `enlaceALaOrden`
  // (la factura sola, o el código en gris, `textoQueAbreLaOrden`); desde D-548 esa tabla y «Todas» pintan la factura como
  // la tabla de paradas, con su ID al lado (`facturaConSuId`, abajo), y `enlaceALaOrden` se quitó.

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
  /** El 📅 de «Reprogramar» de la tabla de paradas (D-592; en la de órdenes va inline, D-574): junto a cada factura, con la
   *  misma condición. Una función y no JSX inline en cada celda: tres bloques anidados en los `map` de esta página de 3.800
   *  líneas dejaron sin memoria al type-check del build de Vercel (dos veces, 28 min hasta el OOM); así no. */
  const iconoDeReprogramar = (o: Delivery): React.ReactNode =>
    !ETAPAS_HECHAS.has(o.stage) && !soloLectura && puedeReprogramar(me?.role, o.stage) ? (
      <span className="accion-de-fila" onClick={(e) => e.stopPropagation()}>
        <ReprogramarOrden pedido={o} rol={me?.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} compacto />
      </span>
    ) : null;
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

  // D-1187 (2026-11-25, «quiero que se miren los po en vez del orden id»): en la tabla de PARADAS, bajo la factura va la PO
  // (`PO 7781`, gris, donde iba el ID). Sin PO no va nada debajo, y el ID se queda en el `title` del enlace. Sin factura
  // (D-408) el ID sigue siendo el texto principal, y debajo va la PO si la hay. `facturaConSuId` no cambia: sigue con el ID
  // en «Sin asignar» y «Todas» y en las demás tablas.
  const facturaDeLaParada = (d: Delivery) => {
    const n = facturaYId(d);
    const gesto = abreLaOrden(d);
    const codigo = `#${orderLabel(d)}`;
    const po = textoBajoLaFactura(d);
    const titulo = tituloDeLaFactura(d, codigo, lang === "es");
    return (
      <span className="factura-e-id">
        <span {...gesto} data-abre-la-orden data-factura={n.esFactura ? "" : undefined} style={n.esFactura ? { ...gesto.style, fontWeight: 700 } : { ...gesto.style, color: "var(--gray)" }}
          title={n.esFactura && !po ? [gesto.title, titulo].filter(Boolean).join(" · ") : gesto.title}>{n.principal}</span>
        {po && <span data-po-de-la-orden title={titulo}>{po}</span>}
      </span>
    );
  };

  // ---- Las cargas de una orden (D-452, 157) ----------------------------------------------------------------------
  // Una orden que no cabe en el camión se parte en órdenes hermanas (#Xa, #Xb): cada carga es una fila, con su P y su D,
  // sus flechas y su «Pasar a…». Aquí solo lo que la fila enseña y los tres gestos: partir (si no cabe), repartir los
  // pallets de dos cargas, y volver a juntarlas (si las dos siguen pendientes y la suma cabe). La regla vive en
  // lib/cargas-partidas; la base la repite (partir_carga, reparte_cargas, juntar_cargas).
  const cargasDe = (d: Delivery) => { const hermanas = hermanasDe(deliveries, d); return { carga: cargaDe(d, hermanas), otra: laOtraCarga(d, hermanas) }; };
  // D-898 (256): en ese mismo sitio, la TRANSFERENCIA POR RELEVO (`components/RelevoDeLaOrden`): en un paso de relevo
  // («Tr-1111-a»), su pastilla, que abre la tarjeta del relevo; en cualquier otra orden, el «⇄» que lo
  // activa. Un paso de relevo no es «carga 1 de 2» (`cargaDe` da `null`), así que nunca salen las dos cosas.
  const etiquetaDeLaCarga = (d: Delivery) => {
    const c = cargasDe(d).carga;
    if (c) return <span className="hint" data-carga style={{ margin: 0 }}> · {etiquetaDeCarga(c, lang === "es")}</span>;
    // Cualquier tipo de orden: el componente decide si el relevo aplica (un paso ya relevo, o una orden de quien planifica).
    return <RelevoDeLaOrden pedido={d} compacto soloLectura={soloLectura} />;
  };
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
  //   · Se mide la ruta del DÍA (D-584): lo pendiente con lo ya recogido o entregado donde iba (`diaDe(…, comoIba=false).paradas`, los
  //     mismos números de la tabla, D-529), no solo lo que queda. El dueño: «keep the route lines of the day even when
  //     delivered». Hasta aquí cada entrega cambiaba la forma, tiraba la medida y se volvía a medir lo pendiente: la línea
  //     del mapa se encogía parada a parada y desaparecía con la última. Ahora entregar no cambia la forma (una llamada
  //     menos por entrega), la línea es la del día entero y la ruta que ya terminó la conserva. Las millas y las horas de
  //     la tarjeta pasan a ser las del día; la «Llegada» de lo pendiente, la de después de lo ya hecho; la de lo hecho,
  //     su hora real (`llegadaEnLasOrdenes`). Una ruta sin nada en el día —ni pendiente ni hecho— sigue sin línea (D-437).
  const rutaDelDia = useMemo(() => {
    const m = new Map<string, Delivery[]>();
    for (const k of new Set([...byDriver.keys(), ...hechasPintadas.keys()])) m.set(k, ordenesDeLaRutaDelDia(byDriver.get(k) ?? [], hechasPintadas.get(k) ?? []));
    return m;
  }, [byDriver, hechasPintadas]);
  const delDiaDe = (clave: string): Delivery[] => rutaDelDia.get(clave) ?? [];
  const seMide = (clave: string) => delDiaDe(clave).length > 0 && pasaFiltro(clave) && (modo === "dia" || selected.has(clave));
  const rutasAMedir = [...lanes.filter((l) => selected.has(l.key)), ...lanes.filter((l) => !selected.has(l.key))].map((l) => l.key).filter(seMide);
  // D-906: a qué hora sale cada chofer si aún no ha hecho nada —la entrada de su turno, de Ajustes → Rutas; sin fila, las
  // 08:00 de siempre— y dónde está su camión ahora (TrackSolid, D-900), si lo tiene enlazado y está a la vista.
  const entradaDelTurno = useMemo(() => {
    const nombreDe = new Map(users.map((x) => [x.id, (x.full_name ?? "").trim()]));
    return new Map(ajustesDeChofer.flatMap((f): [string, number][] => { const m = minutosDeHora(f.shift_start), n = nombreDe.get(f.profile_id); return m != null && n ? [[n, m]] : []; }));
  }, [ajustesDeChofer, users]);
  const camionDelChofer = useMemo(() => new Map((rastreadores.disponible ? rastreadores.camiones : []).flatMap((c): [string, { lat: number; lng: number; en: string }][] =>
    (c.chofer && c.lat != null && c.lng != null && c.posicionEn ? [[c.chofer.trim(), { lat: c.lat, lng: c.lng, en: c.posicionEn }]] : []))), [rastreadores.disponible, rastreadores.camiones]);
  const { finDeLaRuta, routeInfo, routeStats, routeLines, routeEtas, routeSinHora, depotCoords, routerInfo, getDepotCoords, baseDeLaRuta, clearRouteFor, reintentaLaMedida, estadoDeLaMedida } = useMedidaDeRutas<Delivery>({
    date, porChofer: rutaDelDia, rutasAMedir, seMide,
    listaDe: (clave, delDia) => listaDelDia(diaDe(clave, pendientesDelDia(delDia), undefined, false).paradas),
    salidaPrevistaDe: (clave) => entradaDelTurno.get(driverOf(clave).trim()),
    camionDe: (clave) => camionDelChofer.get(driverOf(clave).trim()) ?? null,
    tiendaBaseDe, coordsDeTienda,
    // Dónde termina cada ruta ese día (166): la vuelta va ahí. Cambiar la salida o el fin vuelve a medir esa ruta.
    tiendaFinDe,
    conParadas: lanes.filter((u) => delDiaDe(u.key).length > 0).map((u) => u.key),
    // «Ruta de hoy» (D-467): no se busca la dirección de una base que ya tiene punto en Ajustes. Ahora la abren todos.
    ...(soloLectura ? { buscaBases: "si_falta" as const } : {}),
    invalida: [rutasPublicadas, settings.driver_capacity, settings.default_truck_capacity, settings.stores],
  });
  // D-671 (194): la llegada PREVISTA de cada parada (`delivery_eta_plans`): la «ETA» de lo ya hecho, al lado de su hora
  // real («Actual»). Se lee la del día que se mira; y se apunta, solo HOY, cada vez que se mide una ruta.
  // D-906 (260): la prevista es la del PLAN VIGENTE. Lo que aún no estaba se apunta; lo pendiente de una ruta cuyo plan
  // cambió (`claveDelPlan`: otra salida, otro fin u otras paradas u otro orden) se vuelve a apuntar entero, de una sola
  // medida; con el mismo plan no se toca, y lo ya hecho tampoco (la medida solo trae lo pendiente). Sin la 260 en la base
  // (`sinPlanVigente`), como con la 194: la primera gana. Sin la 194 no se lee ni se apunta.
  const [etasDelPlan, setEtasDelPlan] = useState<Map<string, EtaGuardada>>(() => new Map());
  const sinTablaDeEtas = useRef(false);
  const sinPlanVigente = useRef(false);
  /** Lee las del día: con las columnas de la 260 si la base las tiene; si no, las de la 194. */
  const leeLasEtas = async (dia: string): Promise<Map<string, EtaGuardada> | null> => {
    type Fila = FilaDeEta & { plan_key?: string | null; first_eta?: string | null };
    if (!sinPlanVigente.current) {
      const con = await createClient().from("delivery_eta_plans").select("delivery_id, kind, eta, plan_key, first_eta").eq("plan_date", dia).range(0, 4999);
      if (!con.error) return mapaDeEtasGuardadas((con.data ?? []) as unknown as Fila[]);
      sinPlanVigente.current = true;
    }
    const sin = await createClient().from("delivery_eta_plans").select("delivery_id, kind, eta").eq("plan_date", dia).range(0, 4999);
    if (sin.error) { sinTablaDeEtas.current = true; return null; }
    return mapaDeEtasGuardadas((sin.data ?? []) as unknown as Fila[]);
  };
  useEffect(() => {
    let vivo = true;
    setEtasDelPlan(new Map());
    if (SIN_BASE) return;
    void leeLasEtas(date).then((m) => { if (vivo && m) setEtasDelPlan(m); });
    return () => { vivo = false; };
  }, [date]);
  const apuntaEtas = !soloLectura && date === todayISO() && !!me && ["admin", "logistics", "manager", "accounting"].includes(me.role);
  /** La clave del plan de una ruta, de su lista del DÍA tal como está (no cambia porque se haga una parada). */
  const planDeLaRuta = (clave: string): string =>
    claveDelPlan(date, clave, `${tiendaBaseDe(clave)?.name ?? ""}>${tiendaFinDe(clave)?.name ?? "·"}`, listaDelDia(diaDe(clave, pendientesDelDia(delDiaDe(clave)), undefined, false).paradas));
  useEffect(() => {
    if (!apuntaEtas || sinTablaDeEtas.current) return;
    const CONFLICTO = { onConflict: "delivery_id,plan_date,kind" } as const;
    if (sinPlanVigente.current) {
      // La base aún sin la 260: la regla de la 194, la primera gana.
      const primeras = filasNuevasDeEtas(routeEtas, date, etasDelPlan);
      if (!primeras.length) return;
      setEtasDelPlan((m) => { const n = new Map(m); for (const f of primeras) if (!n.has(claveDeEta(f.delivery_id, f.kind))) n.set(claveDeEta(f.delivery_id, f.kind), { eta: f.eta, plan_key: null, first_eta: null }); return n; });
      void createClient().from("delivery_eta_plans").upsert(primeras, { ...CONFLICTO, ignoreDuplicates: true }).then(({ error }) => {
        if (error) { sinTablaDeEtas.current = true; return; }
        // Otro pudo apuntar antes la misma parada: manda la de la base.
        void leeLasEtas(date).then((m) => { if (m) setEtasDelPlan(m); });
      });
      return;
    }
    // Solo las rutas cuya medida pintada es la de su forma de AHORA: una medida que va a tirarse no se apunta.
    const medidas: Record<string, { etas: Record<string, string>; plan: string }> = {};
    for (const [clave, etas] of Object.entries(routeEtas)) if (estadoDeLaMedida(clave, delDiaDe(clave)) === "medida") medidas[clave] = { etas, plan: planDeLaRuta(clave) };
    const { nuevas, rehechas } = cambiosDeEtas(medidas, date, etasDelPlan, new Date().toISOString());
    if (!nuevas.length && !rehechas.length) return;
    // En el demo (sin base) se quedan en memoria, con la misma regla.
    setEtasDelPlan((m) => {
      const n = new Map(m);
      for (const f of nuevas) if (!n.has(claveDeEta(f.delivery_id, f.kind))) n.set(claveDeEta(f.delivery_id, f.kind), { eta: f.eta, plan_key: f.plan_key, first_eta: f.first_eta });
      for (const f of rehechas) n.set(claveDeEta(f.delivery_id, f.kind), { eta: f.eta, plan_key: f.plan_key, first_eta: n.get(claveDeEta(f.delivery_id, f.kind))?.first_eta ?? null });
      return n;
    });
    if (SIN_BASE) return;
    void (async () => {
      const tabla = () => createClient().from("delivery_eta_plans");
      // Lo nuevo, sin pisar (otro pudo apuntarlo antes); lo rehecho, pisando la prevista y su plan. `first_eta` no va en lo
      // rehecho: la primera del día se queda como estaba.
      const a = nuevas.length ? await tabla().upsert(nuevas, { ...CONFLICTO, ignoreDuplicates: true }) : { error: null };
      const b = !a.error && rehechas.length ? await tabla().upsert(rehechas, CONFLICTO) : { error: null };
      // La base no tiene (aún) la 260: desde ahora, la regla de la 194. Lo de esta vez se apunta en la siguiente medida.
      if (a.error || b.error) sinPlanVigente.current = true;
      const leidas = await leeLasEtas(date);
      if (leidas) setEtasDelPlan(leidas);
    })();
  }, [routeEtas, apuntaEtas, date]); // eslint-disable-line react-hooks/exhaustive-deps
  /** «Actual» (D-671): la hora real de la parada, si ya está hecha, y cuánto se desvió de su llegada prevista. Una parada
   *  hecha FUERA DEL ORDEN de la lista (D-906, `hechasFueraDeOrden`) no lleva «±min»: lo dice. */
  const celdaReal = (key: string, d: Delivery | undefined, tipo: "P" | "D", fueraDeOrden = false) => {
    const hecha = !!d && (tipo === "D" ? d.stage === "delivered" : d.stage === "picked_up" || d.stage === "delivered");
    const hora = hecha && d ? horaReal(d, tipo) : null;
    if (!hora) return <td key={key} data-real="" style={{ color: "var(--gray)" }}>{hecha ? "✓" : "—"}</td>;
    const prevista = d ? etasDelPlan.get(claveDeEta(d.id, tipo))?.eta : undefined;
    const dif = fueraDeOrden ? null : textoDelDesvio(desvio(prevista, hora), lang === "es");
    const hizo = tipo === "P" ? { en: "picked up", es: "recogida" } : { en: "delivered", es: "entregada" };
    return (
      <td key={key} data-real={hora} data-desvio={dif?.tono} data-fuera-de-orden={fueraDeOrden ? "" : undefined} style={{ fontWeight: 600, whiteSpace: "nowrap" }}
        title={fueraDeOrden
          ? t(`Done out of the list's order: ${hizo.en} ${hora}, ahead of stops listed before it${prevista ? ` (it was estimated for ${prevista} in its place on the list)` : ""}. The difference isn't shown: it wouldn't mean early or late.`, `Hecha fuera del orden de la lista: ${hizo.es} ${hora}, antes que paradas que van delante${prevista ? ` (en su puesto de la lista estaba prevista para las ${prevista})` : ""}. No se enseña la diferencia: no querría decir antes ni tarde.`)
          : prevista ? t(`Estimated ${prevista}, ${hizo.en} ${hora}`, `Prevista ${prevista}, ${hizo.es} ${hora}`) : t("No estimate was recorded for this stop today", "Hoy no quedó apuntada una llegada prevista para esta parada")}>
        ✓ {hora}{dif && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: dif.tono === "verde" ? "var(--green)" : dif.tono === "ambar" ? "var(--amber)" : "var(--red)" }}>{dif.texto}</span>}
        {fueraDeOrden && <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 600, color: "var(--gray)" }}>↕ {t("out of order", "fuera de orden")}</span>}
      </td>
    );
  };
  // La «Llegada» de una orden en «Sin asignar» y «Todas» (D-548): la que su ruta midió para ella, «—» sin chofer, y la
  // hora real si ya está hecha (`llegadaEnLasOrdenes`). La misma para la celda y para ordenar y filtrar.
  const llegadaDeLaOrden = useCallback((d: Delivery) => {
    const ruta = d.assigned_driver ? orderLaneKey(d) : null;
    return llegadaEnLasOrdenes(d, ruta ? routeEtas[ruta]?.[d.id] : null, lang === "es");
  }, [routeEtas, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const valorDelGestorAqui = useCallback(
    (clave: string, d: Delivery) => valorDelGestor(clave, d, deOrdenes, ciudadesQueSeConocen, { tiendas: settings.stores ?? [], reglas: settings.order_type_rules, llegada: llegadaDeLaOrden }),
    [deOrdenes, ciudadesQueSeConocen, settings.stores, settings.order_type_rules, llegadaDeLaOrden],
  );
  const ordenSinAsignar = useOrdenYFiltro(unassignedShown, valorDelGestorAqui);
  // «Todas» (D-462) ordena y filtra igual, con su propio estado: la columna «Chofer» va por la de Órdenes (`driver`).
  const ordenDeTodas = useOrdenYFiltro(todasConBusqueda, valorDelGestorAqui);
  // Filtrar la tabla de paradas desde su cabecera (sin ordenar; `soloFiltro`). UN filtro para todas las tarjetas de choferes,
  // que no se guarda entre sesiones. Sus opciones son los valores de TODAS las listas a la vista, así que se calculan aquí,
  // antes del `return` temprano, con las mismas filas que pinta cada tarjeta (`dia.pintadas`). Ver `src/lib/filtro-de-paradas.ts`.
  const extraDeParadas = { tiendas: settings.stores ?? [], reglas: settings.order_type_rules };
  const textoRecogidaDeUnaRecogida = (o: Delivery | undefined, lugar: string | null | undefined): string => {
    const ciudadLibre = o && recogidaLibreDeLaOrden(o, settings.order_type_rules) ? zonaDeLaRecogida(o, settings.stores ?? [], ciudadesQueSeConocen, settings.order_type_rules) : "";
    return ciudadLibre || (lugar ?? t("(no store on the order)", "(la orden no dice la tienda)"));
  };
  /** Lo que enseña cada columna de la tabla de paradas de UNA orden: la misma celda que `celdaDeParada` (las de Órdenes por
   *  su valor de Órdenes; la ciudad de recogida, la del texto de la recogida; y lo que no se ve en una recogida, vacío). */
  const valoresDeLaOrden = (d: Delivery, tipo: "P" | "D", recogida: string | null): ValoresDeOrden => {
    const r: ValoresDeOrden = {};
    for (const c of colsParadas) {
      if (SIN_FILTRO_EN_PARADAS.includes(c.key)) continue;
      if (tipo === "P" && (c.key === "p_windows" || !seVeEnLaRecogida(c))) r[c.key] = null;
      else if (tipo === "P" && c.key === "p_ciudad_recogida") r[c.key] = recogida;
      else r[c.key] = valorDelGestor(c.key, d, deOrdenes, ciudadesQueSeConocen, extraDeParadas);
    }
    return r;
  };
  /** Las órdenes de una fila pintada con sus valores: una entrega (una), o una recogida (las suyas, todas con su texto de recogida). */
  /** Las órdenes de una fila que vienen arrastradas de otro día (`arrastradaDesde`): sus fechas de origen y el aviso. */
  const arrastreDeLaFila = (ordenes: readonly Delivery[]): { fechas: string; texto: string } | null => {
    const porFecha = new Map<string, string[]>();
    for (const x of ordenes) {
      const de = arrastradaDesde(x, eventosPorOrden.get(x.id) ?? []);
      if (de) porFecha.set(de, [...(porFecha.get(de) ?? []), facturaYId(x).principal]);
    }
    if (porFecha.size === 0) return null;
    return {
      fechas: [...porFecha.keys()].join(", "),
      texto: [...porFecha].map(([de, codigos]) => `${t("Carried over from", "Viene arrastrada del")} ${de}: ${codigos.join(", ")}`).join(" · "),
    };
  };
  const valoresDeLaFila = (fp: FilaPintada, porId: Map<string, Delivery>, hechasPorId: Map<string, Delivery>): ValoresDeOrden[] => {
    if (fp.hecha) {
      const d = hechasPorId.get(fp.orden);
      if (!d) return [];
      return [valoresDeLaOrden(d, fp.tipo, fp.tipo === "P" ? ((d.pickup_name ?? "").trim() || (d.store ?? "").trim() || "—") : null)];
    }
    const f = fp.fila;
    if (f.tipo === "D") { const d = porId.get(f.orden); return d ? [valoresDeLaOrden(d, "D", null)] : []; }
    const suyas = f.ordenes.map((id) => porId.get(id)).filter((x): x is Delivery => !!x);
    const recogida = textoRecogidaDeUnaRecogida(suyas[0], f.lugar);
    return suyas.map((d) => valoresDeLaOrden(d, "P", recogida));
  };
  // Las opciones del filtro salen de las filas que YA pinta cada tarjeta (`valoresDeLasTarjetas`, que cada una deja al
  // pintarse): así no se vuelve a calcular el plan del día de cada chofer en cada render. Son las del último render, que
  // es el que se ve cuando se abre el menú. Solo cuentan las tarjetas que hay en pantalla.
  const valoresDeLasTarjetas = useRef(new Map<string, ValoresDeOrden[][]>());
  const filtroParadas = useOrdenYFiltro<ValoresDeOrden>(
    [...valoresDeLasTarjetas.current].filter(([clave]) => lanesDelFiltro.some((l) => l.key === clave && ((byDriver.get(clave) ?? []).length > 0 || hechasDe(clave).length > 0))).flatMap(([, filas]) => filas.flat()),
    valorDeOrdenEnParadas,
  );
  // La factura y los pallets fijos no filtran (la factura va con su texto fijo, como antes); las de Sin filtro, tampoco.
  const menuDeParadas: ColumnaConMenu[] = colsParadas.filter((c) => !SIN_FILTRO_EN_PARADAS.includes(c.key)).map((c): ColumnaConMenu => ({ key: c.key, en: sinElNombreDeLaTabla(c.en), es: sinElNombreDeLaTabla(c.es), etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));
  /** La cabecera de una columna de paradas: con su menú para filtrar (`soloFiltro`), o el rótulo de siempre. */
  const cabeceraDeParada = (c: ColumnaDelGestor) => {
    const cm = menuDeParadas.find((m) => m.key === c.key);
    return cm ? <CabeceraConMenu estado={filtroParadas} col={cm} lang={lang} t={t} soloFiltro /> : sinElNombreDeLaTabla(lang === "es" ? c.es : c.en);
  };
  // Las cabeceras con menú son las del catálogo (la fecha se lista formateada, y el costo como dinero). El ID fijo que iba
  // delante se quitó (D-408): el dueño, «routes manager doesn't need to see id».
  const menuSinAsignar: ColumnaConMenu[] = colsSinAsignar.map((c) => ({ ...c, etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));
  const menuDeTodas: ColumnaConMenu[] = colsTodas.map((c) => ({ ...c, etiqueta: etiquetaDelGestor(c.key, deOrdenes) }));
  /** Dónde termina la ruta para lo que ESTIMA en el navegador (Optimizar, «📍 Mejor lugar», horario), en coordenadas: sin
   *  fin (no vuelve), `null`; un fin cuyo punto aún no se sabe, `undefined` (vuelve a la base, como antes de la 166). */
  const finParaEstimar = (laneKey: string): { lat: number; lng: number } | null | undefined => (tiendaFinDe(laneKey) ? finDeLaRuta(laneKey) ?? undefined : null);
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
      capacidad, admite: admiteEnLaLista(lista, stops, capacidad), bloqueada: bloqueada(l.key), base: baseDeLaRuta(l.key), fin: finParaEstimar(l.key),
    };
  });
  // Una fila por ruta; cuáles se PINTAN lo decide `filasDelHorario`, abajo. `rutasDelGantt` sigue teniendo todas: el plan de
  // soltar (`planDeSoltar`) las mira enteras.
  const ganttRows: GanttRow[] = rutasDelGantt.map((r) => {
    const l = lanes.find((x) => x.key === r.clave)!;
    const stops = byDriver.get(r.clave) ?? [];
    // El número de parada de cada barra es el de la tabla y el mapa (D-485): la misma lectura y la misma numeración, la del
    // DÍA entero (D-529): una barra pendiente no vuelve a contar desde 1 porque el chofer ya entregó otras.
    const lectura = lecturaDe(r.clave, stops);
    return {
      key: r.clave, title: l.label, color: colorFor(l.driver), orders: stops,
      barras: barrasDeLaRuta(r.viajes, r.base, DAY_START_MIN), bloqueada: r.bloqueada,
      paradaDe: paradaDeCadaEntrega(lectura.filas, diaDe(r.clave, stops, lectura).dePendiente),
    };
  });
  // D-503: en el horario salen solo las rutas con alguna parada ese día y que pasan el filtro de choferes del panel (D-488),
  // también en el Gestor. El dueño, 2026-10-08: «si stevene no tiene nada que no salga». Antes el Gestor pintaba las vacías
  // para poder soltar en ellas (D-417, D-481 f); a un chofer sin nada se le asigna desde «Sin asignar», «Asignar a…» o el tablero.
  const filasDelGantt = filasDelHorario(ganttRows, pasaFiltro);

  const assignTo = (id: string, driver: string) => {
    clearRouteFor(driver);
    // A plain (dropdown / drag) assignment always lands on the driver's first
    // load; multi-load assignment goes through assignRouteToDriver.
    return updateDelivery(id, { assigned_driver: driver || null, route_seq: null, load_no: null });
  };
  const unassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    if (d) { const k = orderLaneKey(d); if (k) clearRouteFor(k); }
    const cambio = cambioDeAsignacion(id, null);
    const hecho = updateDelivery(id, { assigned_driver: null, route_seq: null, load_no: null });
    void hecho.then((ok) => { if (ok) trasAsignar([cambio]); }, () => undefined);
    return hecho;
  };

  // Assign an order onto a lane (a driver or temp driver) — used by the board's
  // drag-and-drop onto a column. Lands on the lane's first truckload.
  const assignToLane = async (id: string, laneKey: string) => {
    const d = dayOrders.find((x) => x.id === id);
    clearRouteFor(laneKey);
    await updateDelivery(id, { assigned_driver: laneKey, route_seq: null, load_no: null });
    addNote(id, `Moved to ${laneKey}${d?.assigned_driver ? ` (from ${d.assigned_driver})` : ""}`);
  };

  // A single manual (re)assignment — assign + write an audit note. Devuelve la escritura (D-560: «Aprobar» una solicitud
  // de asignación espera a que termine); el orden de siempre —asignar, y la nota sin esperar— no cambia.
  const manualAssign = (id: string, driver: string) => {
    const d = dayOrders.find((x) => x.id === id);
    const cambio = cambioDeAsignacion(id, driver || null);
    const hecho = assignTo(id, driver);
    addNote(id, `Assigned to ${driver}${d?.assigned_driver && d.assigned_driver !== driver ? ` (from ${d.assigned_driver})` : ""}`);
    void hecho.then((ok) => { if (ok) trasAsignar([cambio]); }, () => undefined);
    return hecho;
  };

  // «Aprobar» una solicitud de asignación (D-560, 176). Reutiliza, no copia: la fecha por `reprogramarOrden` (D-549, la
  // función `reprogramar_orden` de la 173; la 172 la saca de la ruta vieja) y el chofer por `manualAssign`, el «Asignar a…»
  // de cada fila. Primero la fecha y DESPUÉS el chofer: al revés, la 172 vería la fecha cambiar con el chofer ya puesto y
  // se lo quitaría. Qué pasos tocan lo decide `pasosAlAprobar`.
  const apruebaSolicitud = async (s: SolicitudDeAsignacion, chofer: string): Promise<boolean> => {
    const orden = deliveriesLeidas.find((x) => x.id === s.delivery_id);
    const pasos = pasosAlAprobar({ solicitud: s, orden, chofer, hoy: todayISO() });
    if (pasos.error) {
      const motivo = {
        cerrada: t("This request is no longer open.", "Esta solicitud ya no está abierta."),
        "sin-orden": t("That order isn't loaded here.", "Esa orden no está cargada aquí."),
        etapa: t("The order already left, was delivered or canceled.", "La orden ya salió, se entregó o se anuló."),
        "fecha-pasada": t("The requested day already passed — reject it.", "El día pedido ya pasó: recházela."),
      }[pasos.error];
      notify(motivo);
      return false;
    }
    if (pasos.reprogramar) {
      const quien = users.find((u) => u.id === s.requested_by)?.full_name ?? "";
      const ok = await reprogramarOrden(s.delivery_id, s.requested_date, notaAlAprobar(quien, s.note, lang), lang);
      if (!ok) return false;
    }
    if (pasos.asignar) {
      const ok = await manualAssign(s.delivery_id, pasos.asignar);
      if (!ok) return false;
    }
    notify(t(`Approved: ${s.requested_date}${pasos.asignar ? ` · ${pasos.asignar}` : ""}`, `Aprobada: ${s.requested_date}${pasos.asignar ? ` · ${pasos.asignar}` : ""}`));
    return true;
  };
  const manualUnassign = (id: string) => {
    const d = dayOrders.find((x) => x.id === id);
    unassign(id);
    if (d?.assigned_driver) addNote(id, `Unassigned (was ${d.assigned_driver})`);
  };

  // «Regresar a tienda» (migración 311): una orden que ya va en el camión no se desasigna (quedaría recogida y sin chofer,
  // fuera de todas las listas). Se le pide al chofer que la deje en su tienda; la orden sigue con él hasta entonces.
  const pedirRegresoATienda = async (d: Delivery) => {
    const chofer = d.assigned_driver ?? "";
    const ok = await confirmAction(
      t(`Tell ${chofer} to leave ${facturaYId(d).principal} at ${d.store ?? "the store"}? It stays with ${chofer} until they drop it there, then it goes back to Unassigned.`,
        `¿Pedirle a ${chofer} que deje ${facturaYId(d).principal} en ${d.store ?? "la tienda"}? Sigue con ${chofer} hasta que la deje ahí; luego vuelve a Sin asignar.`),
      { danger: true, confirmLabel: t("Return to store", "Regresar a tienda") },
    );
    if (!ok) return;
    const hecho = await updateDelivery(d.id, patchPedirRegreso(me?.id ?? null, new Date().toISOString()));
    if (hecho) addNote(d.id, NOTA_PEDIR_REGRESO);
  };
  const cancelarRegresoATienda = async (d: Delivery) => {
    const hecho = await updateDelivery(d.id, patchCancelarRegreso());
    if (hecho) addNote(d.id, NOTA_CANCELAR_REGRESO);
  };

  // Drag-and-drop on the board: move an order to a driver column, or back to
  // the unassigned pool.
  const boardMove = (orderId: string, columnKey: string) => {
    const d = dayOrders.find((x) => x.id === orderId);
    if (!d) return;
    if (columnKey === "__unassigned__") {
      // Una orden en el camión no vuelve a «Sin asignar» arrastrándola: se le pide el regreso a tienda (migración 311).
      if (d.assigned_driver && estaEnElCamion(d.stage)) notify(t("It's already on the truck — use «Return to store» on its stop.", "Ya va en el camión — usa «Regresar a tienda» en su parada."));
      else if (d.assigned_driver) manualUnassign(orderId);
    }
    else if (orderLaneKey(d) !== columnKey) {
      const cambio = cambioDeAsignacion(orderId, columnKey);
      void assignToLane(orderId, columnKey).then(() => trasAsignar([cambio]), () => undefined);
    }
  };

  const toggleOrder = (id: string) =>
    !soloLectura && setSelectedOrders((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSelection = () => setSelectedOrders(new Set());

  // Assign every checked order to one driver.
  // «🔢 Arrancar el plan con estas» (D-722, 208): a lo marcado se le pone 1, 2, 3… en el orden en que se marcó (el Set
  // guarda ese orden), siguiendo a lo ya numerado del día. «Armar las rutas del día» abre una ruta con ellas, en ese
  // orden, y no mete nada delante. No asigna nada: es un botón de acción extra, como pidió el dueño.
  const numeraElArranque = async () => {
    const marcadas = [...selectedOrders].filter((id) => filasAsignables.some((d) => d.id === id));
    const numeros = numerosDeArranque(marcadas, dayOrders);
    if (!numeros.length) return;
    setAsignando(true);
    let ok = true;
    for (const n of numeros) ok = (await updateDelivery(n.id, { plan_rank: n.plan_rank }, { quiet: true })) && ok;
    setAsignando(false);
    notify(ok
      ? t(`${numeros.length} order(s) numbered to start the plan (1…${numeros[numeros.length - 1].plan_rank}). Build the routes to use them.`, `${numeros.length} orden(es) numeradas para arrancar el plan (1…${numeros[numeros.length - 1].plan_rank}). Arma las rutas para usarlas.`)
      : t("Could not number some orders (is migration 208 applied?).", "No se pudieron numerar algunas órdenes (¿está aplicada la migración 208?)."));
    if (ok) setSelectedOrders(new Set());
  };

  const bulkAssign = async (driver: string) => {
    // Lo marcado en la TABLA que se ve, con su chip: con «Todas» o «Atrasadas» se marcan órdenes de otros días (D-359, D-393).
    const ids = filasAsignables.filter((d) => selectedOrders.has(d.id)).map((d) => d.id);
    if (!ids.length || !driver) return;
    setAsignando(true);
    const cambios = ids.map((id) => cambioDeAsignacion(id, driver));
    try { for (const id of ids) await assignTo(id, driver); } finally { setAsignando(false); }
    trasAsignar(cambios);
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
    const cambios = marcadas.map((d) => cambioDeAsignacion(d.id, laneKey));
    setAsignando(true);
    try {
      for (const d of marcadas) {
        const entregas = entregasDeLaLista(lista, paradas);
        const cabe = admiteEnLaLista(lista, paradas, capacidad);
        // De otro día (chip «Todas»), o sin pin: se asigna como «Asignar», al final, y se dice.
        const r = delDia.has(d.id)
          ? mejorLugar({ viajes: [entregas.map(aParada)], nueva: aParada(d), base, fin: finParaEstimar(laneKey), capacidad, inicioMin: DAY_START_MIN, admite: (_v, puesto) => cabe(puesto, palletsDeLaOrden(d)) })
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
        await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: puestoEn(desde, e.ids.indexOf(d.id)), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) });
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
          ...porId.get(id)!, assigned_driver: laneKey, route_seq: puestoEn(desde, i), load_no: null,
          ...(recogidas ? { pickup_seq: recogidas[id] ?? null } : {}),
        }));
        lista = nueva;
      }
    } finally {
      setAsignando(false);
    }
    trasAsignar(cambios);
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
  // D-998 (Roberto: «click on multiple… it only works for deliveries»): lo MARCADO es cualquier fila, de cualquier fecha,
  // tipo o etapa (`seleccionMarcada`); cada acción en bloque toma lo suyo: repartir, solo lo de este día en ruta; reprogramar
  // decide con su propia regla y dice qué saltó.
  const seleccionMarcada = useMemo(() => lasMarcadas(deliveries, selectedOrders, marcadas), [deliveries, selectedOrders, marcadas]);
  const seleccionDelReparto = useMemo(
    () => lasRepartibles(lasMarcadas(dayOrders, selectedOrders, marcadas), date, ROUTE_STAGES),
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
      // De qué tienda sale y en cuál termina cada uno ESE día (166), como en «Armar rutas».
      basesDelDia: basesDelDia.bases,
      // D-834: lo aprendido de las rutas hechas antes de este día (lo que el Gestor tiene cargado).
      historia: { fecha: date, antecedentes: antecedentesDeRutas(deliveries.filter((d) => (d.delivery_date ?? "") < date && (d.stage === "delivered" || d.stage === "picked_up"))) },
    });
  }, [deliveries, date, seleccionDelReparto, drivers, ajustesDeChofer, settings, basesDelDia.bases]);
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
        if (!(await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: puestoEn(desde, e.ids.indexOf(d.id)), load_no: null, ...(recogidas ? { pickup_seq: recogidas[d.id] ?? null } : {}) }))) return false;
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
      // D-994: el paso b de un relevo no se recoge antes de que llegue su paso a (+1 h). Primero con las llegadas que ya hay
      // en las rutas; si el paso a también se repartió aquí, con la llegada que le dio el motor, y se vuelve a repartir.
      const desdeFuera = recogidaDesdeDelRelevo(dayOrders, (id) => etaDeEntregaEn(routeEtas, id));
      // Lo que el motor deja fuera y se puede llevar se fuerza al final de un elegido (`forzaLasQueNoCaben`): se asigna, y se avisa.
      const repartir = (desde: ReadonlyMap<string, number>) => { const pet = { ...peticion, entrada: { ...diaParaElMotor.entrada, ordenes: conRecogidaDesde(diaParaElMotor.entrada.ordenes, desde), matriz: medida.matriz }, parametros: diaParaElMotor.parametros }; return forzaLasQueNoCaben(reparteEntre(pet), pet); };
      let r = repartir(desdeFuera);
      {
        const llegadas = llegadasDelPlan(r.plan.rutas);
        const desde = new Map(desdeFuera);
        let cambio = false;
        for (const [b, a] of pasoAnteriorPorId(dayOrders)) {
          const llega = llegadas.get(a.id);
          if (llega == null || a.stage === "delivered") continue;
          const v = llega + MARGEN_DEL_RELEVO_MIN;
          if ((desde.get(b) ?? -Infinity) < v) { desde.set(b, v); cambio = true; }
        }
        if (cambio) r = repartir(desde);
      }
      const porId = new Map(dayOrders.map((d) => [d.id, d]));
      const nombreDe = (id: string) => { const d = porId.get(id); return d ? facturaYId(d).principal : id.slice(0, 6); };
      const movimientos = movimientosDelReparto(r, (id) => porId.get(id)?.assigned_driver ?? null);
      const resumen = resumenDelReparto({ r, nombreDe, movimientos, medida, totalSeleccionadas: seleccionadas.length });
      // Nada que asignar: se dice y no se escribe nada. Algo sí: se confirma con el resumen delante (lo que pasa el límite se asigna y se avisa; lo imposible se queda donde está).
      if (!r.rutas.some((x) => x.nuevas.length)) { await confirmAction(t(resumen.en, resumen.es), { alertOnly: true }); return; }
      if (!(await confirmAction(t(resumen.en, resumen.es), { confirmLabel: t("Assign", "Asignar") }))) return;
      const cambiosDelReparto = r.rutas.flatMap((x) => x.nuevas.map((id) => cambioDeAsignacion(id, x.nombre)));
      if (!(await guardaElReparto(r))) return;
      trasAsignar(cambiosDelReparto);
      setMarcadas(new Set()); clearSelection(); setElegidosDelReparto(new Set());
      // Lo que se asignó, aparte lo que pasó el límite (con su porqué) y lo que de verdad se quedó donde estaba.
      const hecho = mensajeDelRepartoHecho({ rutas: r.rutas, forzadas: r.forzadas, sinAsignar: r.sinAsignar, ignoradas: r.ignoradas, nombreDe });
      notify(t(hecho.en, hecho.es), { ms: 9000 });
    } finally {
      setRepartiendo(false);
    }
  };
  /** La sección de «Asignar a…» varios: la cuenta de seleccionadas, los choferes con su casilla y el botón. Dentro del recuadro
   *  «Elige conductor» va plegada tras un botón; sola (en «Rutas», o en «Todas» sin nada sin asignar marcado), abierta. */
  const seccionDeReparto = (sola: boolean) => {
    const n = seleccionMarcada.length;
    // Lo marcado que NO se reparte hoy (otra fecha, sin fecha, ya en camino…): se cuenta aparte, reprogramar sí lo toma.
    const nRepartir = seleccionDelReparto.length;
    const fueraDelReparto = n - nRepartir;
    const abierto = (sola || repartoAbierto) && seleccionDelReparto.length > 0;
    const elegidos = choferesDelReparto.filter((c) => c.puede && elegidosDelReparto.has(c.id));
    return (
      <div data-reparte-entre={sola ? "sola" : "en-el-recuadro"} style={sola ? undefined : { marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b data-cuenta-seleccionadas style={{ fontSize: sola ? 15 : 13 }}>🧭 {n === 1 ? t("1 selected", "1 seleccionada") : t(`${n} selected`, `${n} seleccionadas`)}</b>
          {nRepartir === 0 ? null : sola
            ? <span className="hint" style={{ margin: 0 }}>{t("Assign to the drivers you choose: the engine decides who gets each one and where it goes in their route.", "Asignar a los choferes que elija: el motor decide a quién le toca cada una y en qué puesto de su ruta.")}</span>
            : <button className="btn btn-ghost btn-sm" data-abre-reparto aria-expanded={abierto} onClick={() => setRepartoAbierto((v) => !v)}
                title={t("Hand the checked orders to several drivers at once; the engine decides who gets each one and where", "Repartir las marcadas entre varios choferes de una vez; el motor decide a quién le toca cada una y dónde")}>
                {abierto ? "▾" : "▸"} {t("Assign to several drivers…", "Asignar a varios choferes…")}
              </button>}
          {/* D-994 (Roberto: «reschedule multiple at a time»): una fecha nueva —o «Fecha pendiente»— para todas las marcadas. */}
          {fueraDelReparto > 0 && (
            <span className="hint" data-fuera-del-reparto style={{ margin: 0 }}>
              {t(`${fueraDelReparto} can't be assigned on this day (other date, no date or already on the way); they can still be rescheduled.`,
                `${fueraDelReparto} no se reparten este día (otra fecha, sin fecha o ya en camino); sí se pueden reprogramar.`)}
            </span>
          )}
          <ReprogramarVarias key={seleccionMarcada.map((d) => d.id).join(",")} marcadas={seleccionMarcada} todas={deliveries} rol={me?.role} meId={me?.id} lang={lang} t={t}
            reprogramarOrden={(id, f, nota, l) => reprogramarOrden(id, f, nota, l)} updateDelivery={updateDelivery} addNote={addNote} notify={notify}
            onListo={() => { setMarcadas(new Set()); clearSelection(); }} />
          {nRepartir === 0 && <button className="btn btn-ghost btn-sm" data-quita-seleccion onClick={() => { setMarcadas(new Set()); clearSelection(); }}>✕ {t("Clear selection", "Quitar selección")}</button>}
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
              <button className="btn btn-primary" data-reparte disabled={!elegidos.length || nRepartir === 0 || repartiendo || moviendo} onClick={() => void reparte()}
                title={t("Same engine and rules as Build routes, limited to these orders and these drivers; what each driver already has stays with them, in order", "El mismo motor y las mismas reglas que Armar rutas, limitado a estas órdenes y estos choferes; lo que cada uno ya lleva se queda con él, en su orden")}>
                🧭 {repartiendo ? t("Assigning…", "Asignando…")
                  : elegidos.length <= 1 ? t(`Assign ${nRepartir} to ${elegidos[0]?.nombre ?? "…"}`, `Asignar ${nRepartir} a ${elegidos[0]?.nombre ?? "…"}`)
                  : t(`Assign ${nRepartir} among ${elegidos.length} drivers`, `Asignar ${nRepartir} entre ${elegidos.length} choferes`)}
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
    // D-1145: los movimientos de debajo que tocaban estas paradas toman su sello nuevo (`resella`): la escritura es nuestra.
    setHistorial((h) => anota(resella(h, sellos), { etiqueta, rutas, antes, despues, sellos }));
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
      setHistorial((h) => trasVolver(resella(h, sellos), dir, sellos));
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
    if (avisaSiOptimiza() || avisaSiGuarda()) return;
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
      // Soltada a mano en un puesto: queda fijada. Si cambió de chofer, la ruta de origen se vuelve a optimizar.
      fijaLasMovidas([movida]);
      if (plan.origen !== plan.destino) trasAsignar([cambioDeAsignacion(movida, plan.destino)], { colocadasAMano: [movida] });
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
      baseDe: (clave) => {
        const addr = (pickupAddressFor(clave) ?? "").trim();
        // En solo lectura la base sale de Ajustes (con `buscaBases: "si_falta"` no se busca su dirección): `baseDeLaRuta`.
        const base = soloLectura ? baseDeLaRuta(clave) : null;
        const coords: [number, number] | undefined = base ? [base.lat, base.lng] : addr ? depotCoords[addr] : undefined;
        return coords ? { coords, direccion: tiendaBaseDe(clave)?.name ?? addr } : null;
      },
      // Dónde termina ese día, si es otra tienda (166): su marca «F».
      finDe: (clave) => {
        const tienda = tiendaFinDe(clave), fin = finDeLaRuta(clave);
        return tienda && fin ? { coords: [fin.lat, fin.lng], direccion: tienda.name } : null;
      },
      // Los números del DÍA (D-529), los mismos de la tabla: `diaDe` (lo hecho primero, en su hora real; lo pendiente detrás).
      paradasDe: (clave, stops) => diaDe(clave, stops).paradas, coordsDeTienda, t,
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
  }, [dayOrders, byDriver, settings.driver_colors, settings.driver_capacity, selected, selectedOrders, selColorById, selPickup, filtroChofer, depotCoords, lanes, rutasPublicadas, deliveries, hechasPintadas, basesDelDiaPorNombre, basesDeChofer]);

  // Every measured driver's routes are always drawn; a focus just dims the
  // others. Clicking a route focuses its driver (see onLineClick below).
  const lines: MapLine[] = useMemo(() => {
    // Las líneas medidas de cada ruta y la del plan publicado: `lineasDeLasRutas` (lib/mapa-de-rutas), las de «Ruta de hoy».
    const out: MapLine[] = lineasDeLasRutas({
      // Con paradas en el DÍA, pendientes o hechas (D-584): la ruta que ya terminó conserva su línea.
      trazos: routeLines, trazosDelPlan, tieneParadas: (clave) => delDiaDe(clave).length > 0,
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
    // D-846: lo manejado encima de lo planeado (lib/recorrido-contra-plan): la ruta en el color del chofer, más ancha; lo
    // manejado, fino y oscuro con borde blanco; los huecos sin GPS, punteados y grises (D-835).
    return planContraRecorrido(out, lineasDelRecorridoReal(recorridoDelDia, { pasaFiltro, atenuada: isDim }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLines, trazosDelPlan, byDriver, rutasPublicadas, deliveries, selected, settings.driver_colors, selectedOrders, selRouteCache, selPickup, selColorById, dayOrders, filtroChofer, recorridoDelDia]);

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
      const loc = posicionesAhora.find((l) => {
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
    // Una orden resaltada (clic en su fila): el mapa encuadra su recogida y su entrega, lo más cerca que cabe con margen.
    if (ordenesResaltadas.size > 0) {
      const pts = encuadreDeResaltadas(dayOrders.filter((d) => ordenesResaltadas.has(d.id)).flatMap((d) => [
        selPickup[d.id] ?? null,
        d.delivery_lat != null && d.delivery_lng != null ? ([d.delivery_lat, d.delivery_lng] as const) : null,
      ]));
      if (pts.length) return pts;
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
    // Las tiendas de Ajustes entran en el día entero (D-580): la región, y encima lo de hoy. Acotado a un chofer («Mi
    // ruta», D-718), no: su ruta sola, cerrada, sin las tiendas de Ajustes abriendo el encuadre hasta Brownsville.
    return encuadreDeLasRutas(points, selected, byDriver, lanes, storeMarkers, miChofer != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selected, selectedOrders, selRouteCache, selPickup, dayOrders, locateDriver, posicionesAhora, users, storeMarkers, miChofer, ordenesResaltadas]);

  // Con una orden resaltada, el resto del mapa se atenúa (el mismo `dimmed` que el foco de un chofer) y su recogida, su
  // entrega y su tramo quedan encima. Sin resaltar, el mapa es el de siempre.
  const { puntosMostrados, lineasMostradas } = useMemo(() => {
    if (ordenesResaltadas.size === 0) return { puntosMostrados: points, lineasMostradas: lines };
    const extraPuntos: MapPoint[] = [], tramos: MapLine[] = [];
    for (const d of dayOrders) {
      if (!ordenesResaltadas.has(d.id)) continue;
      const pk = selPickup[d.id];
      const color = selColorById.get(d.id) ?? "#2456c9";
      const conDestino = d.delivery_lat != null && d.delivery_lng != null;
      if (pk) extraPuntos.push({ id: `__resaltada_pk__${d.id}`, lat: pk[0], lng: pk[1], color, badge: "P", label: `#${orderLabel(d)} — ${t("Pickup", "Recolección")}` });
      if (conDestino) extraPuntos.push({ id: `__resaltada_dl__${d.id}`, lat: d.delivery_lat as number, lng: d.delivery_lng as number, color, badge: "D", label: `#${orderLabel(d)} — ${t("Delivery", "Entrega")}` });
      const pos = selRouteCache[d.id];
      const tramo: [number, number][] | null = pos && pos.length ? pos : pk && conDestino ? [pk, [d.delivery_lat as number, d.delivery_lng as number]] : null;
      if (tramo) tramos.push({ id: `resaltada:${d.id}`, color, positions: tramo, weight: 8 });
    }
    return {
      puntosMostrados: [...points.map((p) => ({ ...p, dimmed: true })), ...extraPuntos],
      lineasMostradas: [...lines.map((l) => ({ ...l, dimmed: true })), ...tramos],
    };
  }, [ordenesResaltadas, points, lines, dayOrders, selPickup, selColorById, selRouteCache, t]);

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
  // tarjeta no era destino de nada —se asigna desde «Sin asignar», el recuadro o el tablero—; renombrar o quitar una ruta
  // temporal vacía sigue en el panel. Las marcadas vacías se nombran en una línea (`marcadasSinParadas`). («Horario» pintaba
  // las rutas vacías para soltar en ellas; desde D-503 tampoco.)
  const shownDrivers = lanesDelFiltro.filter((u) => conAlgoQuePintar(u.key));
  // El panel «Choferes y rutas» (D-481, f): un chofer sin ninguna orden ese día no sale; una ruta temporal vacía sí.
  // El panel lista SIEMPRE todas las rutas del día (D-488): su casilla dice si se ve. Antes listaba solo las filtradas y,
  // marcado un chofer, no quedaba casilla para marcar otro.
  const filasDelPanel = rutasConOrdenes(lanes, conAlgoQuePintar);
  const clavesDelPanel = filasDelPanel.map((u) => u.key);
  const marcadasSinParadas = lanesDelFiltro.filter((u) => selected.has(u.key) && (byDriver.get(u.key) ?? []).length === 0);
  // «▦ Cuadrícula» (D-481, e): arriba, una tarjeta COMPACTA por ruta (nombre, números, pastillas; sin tabla ni botones);
  // abajo, DESPLEGADA a todo el ancho, la del nombre pulsado. En «▭ Ancho», las tarjetas enteras, como siempre.
  const rutaDesplegada = desplegadaVigente(desplegada, shownDrivers.map((u) => u.key));
  // En la vista eficiente (D-653), una tarjeta entera por ruta que dejan ver las casillas, sin plegar ni desplegar: qué
  // rutas salen lo deciden SOLO las casillas del panel (sin ninguna marcada, todas, D-566).
  const tarjetasDeRuta: [Lane, ModoDeTarjeta][] = eficiente
    ? shownDrivers.map((u) => [u, "eficiente"])
    : wideRoutes
    ? shownDrivers.map((u) => [u, "ancha"])
    : [...shownDrivers.map((u): [Lane, ModoDeTarjeta] => [u, "compacta"]), ...shownDrivers.filter((u) => u.key === rutaDesplegada).map((u): [Lane, ModoDeTarjeta] => [u, "desplegada"])];
  // Los avisos de los relevos (`avisosDeRelevo`) van en el «⚠ N» de la ruta que los lleva (las dos, si son dos choferes).
  // Si ninguna de esas rutas tiene su cuerpo a la vista, van al «⚠ N» de la barra, que es de toda la página.
  const avisosDeRelevoDelDia = avisosDeRelevo(deliveries.filter(esPasoDeRelevo));
  const cartasConCuerpo = tarjetasDeRuta.filter(([u, m]) => conCuerpo(m, isCollapsed(u.key)));
  const relevosDeLaCarta = new Map<string, AvisoDeRelevo[]>();
  const relevosSinCarta: AvisoDeRelevo[] = [];
  for (const a of avisosDeRelevoDelDia) {
    const llevan = cartasConCuerpo.filter(([u]) => {
      const ids = new Set([...(byDriver.get(u.key) ?? []), ...hechasDe(u.key)].map((d) => d.id));
      return a.ids.some((id) => ids.has(id));
    });
    if (llevan.length === 0) { relevosSinCarta.push(a); continue; }
    for (const [u] of llevan) relevosDeLaCarta.set(u.key, [...(relevosDeLaCarta.get(u.key) ?? []), a]);
  }
  const scheduledCount = dayOrders.length - unassigned.length;
  // Aquí se armaba la leyenda del mapa (D-274; en «Ruta de hoy», D-467, y en «Mi ruta», D-514). Fuera en toda la app desde
  // D-520. El dueño, 2026-10-11: «delete the lEGEND ON THE MAP of the app».
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
    /** Los chips de filtro (D-393) se pintan solo en «Sin asignar»; «Todas» va sin ellos, siempre «Este día» (D-542). */
    conChips: boolean;
    /** Las filas del chip sin búsqueda (para decir «todo tiene chofer») y con ella (para decir «nada coincide»). */
    filas: Delivery[]; conBusqueda: Delivery[];
    orden: OrdenYFiltro<Delivery>;
    vacio: string; nadaCoincide: string; pista: string;
    /** La última columna: su rótulo y su ancho («Asignar a» cabe en 116; «Asignar / pasar», no). */
    cabeceraDeAcciones: string; anchoDeAcciones: number;
    caja: React.RefObject<HTMLDivElement | null>;
  }
  // El mapa de la lista («🗺 Ver en mapa», ayuda 042c7dc1): las filas VISIBLES —chip, búsqueda y filtros de columna ya
  // aplicados—, cada una un pin del color de su chofer (gris sin chofer, como en el mapa del Gestor). Pulsar un pin abre la
  // orden en su tarjeta, aquí mismo (`abreLaOrden`, la misma regla que la factura). Las que no tienen ubicación no se
  // callan: se cuentan y se listan debajo, y también se abren. No toca rutas ni el mapa de arriba: solo mira.
  const mapaDeLasOrdenes = (clave: VistaDeOrdenes["clave"], filas: Delivery[]) => {
    const { puntos, sinUbicacion, encuadre } = ordenesEnElMapa(filas, {
      coloresDeChofer: settings.driver_colors,
      etiqueta: (d) => `#${orderLabel(d)}${d.account ? ` — ${d.account}` : ""}${d.assigned_driver ? ` · ${d.assigned_driver}` : ""}`,
    });
    const abre = (id: string) => { const d = filas.find((x) => x.id === id); if (d) abreLaOrden(d).onClick?.({ stopPropagation() {} } as React.MouseEvent); };
    return (
      <div data-mapa-de-ordenes={clave} style={{ margin: "0 0 10px" }}>
        <div className="hint" data-cuenta-del-mapa style={{ margin: "0 0 6px" }}>
          📍 {t(`${puntos.length} of ${filas.length} order(s) on the map`, `${puntos.length} de ${filas.length} orden(es) en el mapa`)}
          {sinUbicacion.length > 0 && <> · <b style={{ color: "var(--amber-text)" }}>{t(`${sinUbicacion.length} with no location`, `${sinUbicacion.length} sin ubicación`)}</b></>}
          {puntos.length > 0 && <>{" · "}{t("tap a pin to open the order", "pulse un pin para abrir la orden")}</>}
        </div>
        {puntos.length > 0
          ? <MapView points={puntos} stores={storeMarkers} fitTo={encuadre} height="min(52vh, 420px)" onPointClick={abre} />
          : <div className="empty" data-mapa-sin-pines>{t("None of these orders has a location yet.", "Ninguna de estas órdenes tiene ubicación todavía.")}</div>}
        {sinUbicacion.length > 0 && (
          <div className="card" data-sin-ubicacion={sinUbicacion.length} style={{ margin: "8px 0 0", background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
            <b style={{ color: "var(--amber-text)" }}>📍 {t(`No location (${sinUbicacion.length})`, `Sin ubicación (${sinUbicacion.length})`)}</b>
            <span className="hint" style={{ marginTop: 0 }}> — {t("not on the map: they need a delivery address that can be found, or a pin.", "no salen en el mapa: les falta una dirección de entrega que se encuentre, o un pin.")}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {sinUbicacion.map((d) => {
                const gesto = abreLaOrden(d);
                return (
                  <button key={d.id} type="button" className="btn btn-ghost btn-sm" data-orden-sin-ubicacion={d.id} disabled={!gesto.onClick}
                    title={d.delivery_address || t("No delivery address", "Sin dirección de entrega")} onClick={gesto.onClick}>
                    #{orderLabel(d)}{d.account ? ` — ${d.account}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };
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
          className={`${marcada ? "row-selected" : ""}${hecha ? " fila-hecha" : ""}`}
          onClick={hecha ? undefined : () => toggleOrder(d.id)}
          style={{ cursor: hecha ? undefined : "pointer", opacity: arrastrado?.tipo === "orden" && arrastrado.id === d.id ? 0.5 : undefined }}
          data-fila-arrastrable={sinChofer && !soloLectura ? "orden" : undefined} {...(sinChofer && !soloLectura ? filaArrastrable({ tipo: "orden", id: d.id }) : {})}>
          <td>
            {/* Una ya hecha lleva ✓ (entregada) o 🚚 (recogida, en camino) en vez de la casilla: no se marca ni se asigna (D-459). */}
            {hecha
              ? <span data-hecha={entregada ? "hecho" : "en_camino"} style={{ fontWeight: 700 }}>{entregada ? "✓" : "🚚"}</span>
              : soloLectura ? null : <input type="checkbox" checked={marcada} readOnly aria-label={`#${orderLabel(d)}`} />}
            {/* El número de arranque del plan (D-722, 208). */}
            {Number(d.plan_rank) > 0 && (
              <span className="sema" data-arranque={d.plan_rank} title={t("Starts the plan in this position", "Arranca el plan en este puesto")}
                style={{ marginLeft: 5, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)", fontWeight: 700 }}>🔢 {d.plan_rank}</span>
            )}
            {marcada && <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: selColorById.get(d.id), marginLeft: 5, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />}
          </td>
          {/* Las columnas de la tabla de paradas (D-548), con la MISMA celda que allí (`celdaDeParada`). Delante, las fijas:
              el chofer en «Todas» (celda de Órdenes), la factura con su ID —abre la orden y NO selecciona la fila:
              `stopPropagation` en `abreLaOrden`— y los pallets de la orden, que es lo que la cuenta de una ruta suma. */}
          {columnas.map((c) => {
            // La fecha se sigue cambiando desde aquí (`DateCell`), como en la «Fecha de entrega» de antes: es como se le
            // pone su día a una orden atrasada o sin fecha (D-331). La tabla de paradas la enseña sin editar.
            if (c.key === "p_date") return <td key={c.key} onClick={(e) => e.stopPropagation()}><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>;
            if (c.tablas.includes(TABLA_DE_LAS_ORDENES)) {
              const llegada = llegadaDeLaOrden(d);
              return celdaDeParada(c, d, { tipo: "D", llegada: <td data-llegada={llegada ? "hora" : "sin-ruta"} style={llegada ? { fontWeight: 600 } : ESTILO_SIN_LLEGADA}>{llegada ?? "—"}</td> });
            }
            if (c.key === "invoice") return (
              <td key={c.key} className="ordno">
                {facturaConSuId(d)}
                {/* «📅 Reprogramar» (D-500) en línea con la factura (D-574), no en «Asignar a»: allí hacía la fila más alta. */}
                {!hecha && !soloLectura && puedeReprogramar(me?.role, d.stage) && (
                  <span className="accion-de-fila" onClick={(e) => e.stopPropagation()}>
                    <ReprogramarOrden pedido={d} rol={me?.role} lang={lang} t={t} reprogramarOrden={reprogramarOrden} notify={notify} compacto />
                  </span>
                )}
                {etiquetaDeLaCarga(d)}
              </td>
            );
            if (c.key === "pallets") return <td key={c.key} data-pallets-de-la-orden style={{ fontVariantNumeric: "tabular-nums" }}>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>;
            return <td key={c.key} className={clasePastillas(c.key)}>{c.deOrdenes ? celdaDeOrdenes(c.key, d) : "—"}</td>;
          })}
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
              {/* «📅 Reprogramar» (D-500) vivía aquí; desde D-574 va en la celda de la factura, en su misma línea: el dueño,
                  «Calendar button needs to be on Invoice column instead of Assign to column. Its making the row bigger». */}
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
          {/* Con su «✕» para borrar (D-546). */}
          <BuscadorConBorrar
            valor={vista.busqueda}
            onValor={vista.onBusqueda}
            placeholder={t("Search # / customer / address / phone…", "Buscar # / cliente / dirección / teléfono…")}
            maxWidth={300}
          />
          {/* Las dos vistas comparten con la tabla de paradas las columnas elegidas, el orden, las plantillas y las flechas
              (`moverEn(TABLA_DE_LAS_ORDENES)`, D-548): es el mismo ⚙, con los mismos rótulos. */}
          {!soloLectura && (
          <SelectorDeColumnas
            columnas={vista.selector}
            elegidas={colsGestor} onAlterna={alternaColumnaDelGestor} t={t} alLado="izquierda"
            rotulo={(c) => sinElNombreDeLaTabla(lang === "es" ? c.es : c.en)}
            titulo={t("Show and order columns", "Mostrar y ordenar columnas")} nota={vista.notaDelSelector}
            plantillas={propsDePlantillas}
            mover={moverEn(TABLA_DE_LAS_ORDENES)}
          />
          )}
          {/* Chips (D-393): «Este día» es el antiguo «Todas»; «Todas» es de cualquier día. Cada uno lleva su número, que
              sale de la misma función que sus filas. */}
          {vista.conChips && (["dia", "todas", "overdue", "windowed", "noloc"] as const).map((f) => (
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
          <button type="button" className={"btn btn-sm " + (ordenesEnMapa ? "btn-primary" : "btn-ghost")} data-ordenes-en-mapa={vista.clave} aria-pressed={ordenesEnMapa}
            title={t("See the orders of this list on a map — the same ones, with its filters and search", "Ver en un mapa las órdenes de esta lista — las mismas, con sus filtros y su búsqueda")}
            onClick={() => setOrdenesEnMapa((v) => !v)}>
            🗺 {ordenesEnMapa ? t("Hide map", "Ocultar mapa") : t("See on map", "Ver en mapa")}
          </button>
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
          {ordenesEnMapa && mapaDeLasOrdenes(vista.clave, orden.visibles)}
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
            «Auto-asignar selección» de la barra de arriba (ya no hay Auto-asignar, D-437). Va DESPUÉS de la tabla, en el flujo
            normal: ni `sticky` ni `fixed`, para que no tape la tabla ni la barra de búsqueda (el dueño, con captura). Al abrirse,
            la página baja hasta él (ver `elegeRef`). `scrollMarginBottom` deja el hueco de la burbuja de Ayuda. */}
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
          <div className="card" data-elige-conductor role="group" ref={elegeRef} aria-label={t(`Choose a driver for ${poolSelectedCount} orders`, `Elige conductor para ${poolSelectedCount} órdenes`)}
            style={{ margin: "10px 0 0", padding: "12px 14px", border: "2px solid var(--accent)", background: "var(--accent-soft)", maxWidth: "100%", boxSizing: "border-box", scrollMarginBottom: "var(--hueco-de-ayuda)" }}>
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
              {/* D-722: numerar el arranque del plan. No asigna: «Armar las rutas del día» las pone primero, en este orden. */}
              <button className="btn btn-ghost btn-sm" data-arranque-del-plan disabled={asignando}
                title={t("Number the checked orders 1, 2, 3… in the order you checked them; “Build routes” starts a route with them, in that order", "Numerar las marcadas 1, 2, 3… en el orden en que las marcaste; «Armar rutas» abre una ruta con ellas, en ese orden")}
                onClick={() => void numeraElArranque()}>🔢 {t("Start the plan with these", "Arrancar el plan con estas")}</button>
              {/* «✨ Auto-asignar las marcadas» iba aquí; se quitó en D-437. Repartir automático es «Armar las rutas del día». */}
            </div>
            {/* «Asignar a…» varios choferes (D-474): el mismo recuadro, plegado tras un botón; lo marcado se reparte entre los
                elegidos con el motor de «Armar rutas». Sin nada sin asignar marcado (en «Todas», solo filas con chofer), el
                recuadro de arriba no sale y esta sección va sola, abajo. */}
            {seleccionMarcada.length > 0 && seccionDeReparto(false)}
          </div>
        )}
        {!soloLectura && poolSelectedCount === 0 && seleccionMarcada.length > 0 && recuadroDeReparto()}
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
    columnas: colsSinAsignar, menu: menuSinAsignar, selector: columnasDelSelectorDeLasOrdenes(ordenGestor),
    notaDelSelector: t("The same columns as the stop tables in “Routes”: saved for you, for all of them.", "Las mismas columnas que las tablas de paradas de «Rutas»: se guarda para usted, para todas."),
    busqueda: orderSearch, onBusqueda: setOrderSearch,
    chip: poolFilter, onChip: setPoolFilter, cuentas: cuentasDeChips, rotuloDelChip: (f) => rotuloDelChip(f, t("All", "Todas")), conChips: true,
    filas: filasDelChip, conBusqueda: unassignedShown, orden: ordenSinAsignar,
    vacio: poolFilter === "dia" ? t("Everything on this date has a driver.", "Todo en esta fecha ya tiene chofer.") : t("No unassigned orders with this filter.", "Ninguna orden sin asignar con este filtro."),
    nadaCoincide: t("No unassigned orders match your search.", "Ninguna orden sin asignar coincide con la búsqueda."),
    pista: t("Drag a row onto a driver in “Drivers & routes” (above) to assign it. Checked rows go together.", "Arrastre una fila a un chofer de «Choferes y rutas» (arriba) para asignarla. Las marcadas van juntas."),
    cabeceraDeAcciones: t("Assign to", "Asignar a"), anchoDeAcciones: 116, caja: cajaSinAsignarRef,
  };
  // «Todas» (D-462): el chip de cualquier día se llama «Todas las fechas», que «Todas» ya es el nombre de la pestaña.
  const vistaDeTodas: VistaDeOrdenes = {
    clave: "todas", panel: PANEL_DE_TODAS, icono: "📋", titulo: t("All orders of the day", "Todas las órdenes del día"), total: todasDelDia.length,
    columnas: colsTodas, menu: menuDeTodas, selector: columnasDelSelectorDeLasOrdenes(ordenGestor),
    notaDelSelector: t("The same columns as the stop tables in “Routes” and “Unassigned”, with the driver in front: saved for you, for all of them.", "Las mismas columnas que las tablas de paradas de «Rutas» y que «Sin asignar», con el chofer delante: se guarda para usted, para todas."),
    busqueda: busquedaDeTodas, onBusqueda: setBusquedaDeTodas,
    // Sin chips (D-542, el dueño: «delete all those filters but just lleave sin asginar»): «Todas» es la del día.
    chip: "dia", onChip: () => {}, cuentas: cuentasDeTodasAqui, rotuloDelChip: (f) => rotuloDelChip(f, t("All dates", "Todas las fechas")), conChips: false,
    filas: filasDeTodasDelChip, conBusqueda: todasConBusqueda, orden: ordenDeTodas,
    vacio: chipDeTodas === "dia" ? t("No orders on this date.", "No hay órdenes en esta fecha.") : t("No orders with this filter.", "Ninguna orden con este filtro."),
    nadaCoincide: t("No orders match your search.", "Ninguna orden coincide con la búsqueda."),
    pista: t("Drag an unassigned row onto a driver in “Drivers & routes” (above) to assign it; “Move to…” changes an assigned one's driver.", "Arrastre una fila sin chofer a un chofer de «Choferes y rutas» (arriba) para asignarla; «Pasar a…» cambia de chofer una asignada."),
    cabeceraDeAcciones: t("Assign / move", "Asignar / pasar"), anchoDeAcciones: 136, caja: cajaDeTodasRef,
  };

  // Solo el mapa (D-514): la MISMA tarjeta de abajo —`points`, `lines`, tiendas y camiones, calculados arriba
  // como siempre; la leyenda ya no, D-520—, sin cabecera, panel ni pestañas. Va aquí, después de todos los hooks: devolver antes rompería su orden.
  // Lo único que cambia es qué pasa al tocar una parada: lo decide quien monta el mapa.
  if (soloElMapa) {
    return (
      <div className="card" data-mapa-del-gestor style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        {/* El toque va entero a quien monta el mapa: «Mi ruta» busca la parada en su propia lista, y lo que no sea una
            parada suya (la casita de una tienda, la base) no abre nada. */}
        <MapView points={puntosMostrados} lines={lineasMostradas} stores={storeMarkers} liveDrivers={liveDrivers.filter((c) => pasaFiltro(c.driver))} onLineClick={onLineClick} fitTo={fitTo} height={soloElMapa.alto ?? 430} onPointClick={(id) => soloElMapa.alPulsarParada?.(id)} />
      </div>
    );
  }

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
          {/* D-953: borradores de ruta (Opción 1/2/3), solo admin y logística. */}
          {!soloLectura && !!me && ["admin", "logistics"].includes(me.role) && (
            <BorradoresDeRuta day={date} t={t} />
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
      {/* «Recomendaciones» (D-642): las cargas chicas con la tienda lejana cuya vuelta no compensa, encima de «Armar rutas»
          para verlas antes de armar. Sin ninguna no se pinta nada. Recibe TODAS las órdenes de la pantalla, no `dayOrders`:
          hacen falta los días siguientes (a cuál moverlas) y lo que ya salió (si el viaje va igual). */}
      {!soloLectura && modo === "dia" && (
        <RecomendacionesDeVuelta deliveries={deliveries} fecha={date} settings={settings} me={me} reprogramarOrden={reprogramarOrden}
          abrirOrden={setOpenOrder} notify={notify} lang={lang} t={t} />
      )}

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
          }}
          // El color del chofer, el de la tabla de paradas (`colorFor`); y tras la factura, los mismos iconos que allí: el 📅
          // de reprogramar y el ⇄ de relevo (la etiqueta de la carga no, que la tabla del plan ya dice «carga n de m»).
          colorDelChofer={(_, nombre) => colorFor(nombre)}
          choferes={choferesDelReparto.map((c) => ({ id: c.id, nombre: c.nombre, puede: c.puede, porque: c.motivo ? (lang === "es" ? textoDeNoRepartir(c.motivo).es : textoDeNoRepartir(c.motivo).en) : null }))}
          iconosDeLaOrden={(d) => (<>{iconoDeReprogramar(d)}{cargasDe(d).carga ? null : <RelevoDeLaOrden pedido={d} compacto soloLectura={soloLectura} />}</>)} />
      )}

      {/* ---------- Drivers who stopped reporting ----------
           No amount of Android hardening is bulletproof: a battery manager, a
           flat battery or no signal will still cut the feed. Surfacing it here
           means a truck goes "not reporting" instead of quietly vanishing. */}
      {/* Solo en el Gestor (admin y logística), no en «Ruta de hoy» ni en el mapa del chofer (D-541, el dueño: «people
          should not see this message just admin and logistic manager but from the logistic manager view not rutas de hoy»). */}
      {!soloLectura && trackingIssues.length > 0 && !oculto(AVISOS_DEL_GESTOR.choferesSinSenal) && (
        <div className="card" style={{ marginBottom: 14, background: "var(--amber-soft)", borderColor: "var(--amber)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <b style={{ color: "var(--amber-text)" }}>
            📡 {t(`${trackingIssues.length} driver(s) on shift aren't reporting their location`,
                  `${trackingIssues.length} chofer(es) en turno no están reportando su ubicación`)}
          </b>
          <CerrarAviso aviso={AVISOS_DEL_GESTOR.choferesSinSenal} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.choferesSinSenal)} />
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {trackingIssues.map((g) => { const porQue = porQueNoReporta(g, t("en", "es") === "es"); return `${g.driver} (${g.quietForMin == null ? t("no fix yet", "sin señal aún") : t(`${g.quietForMin} min`, `${g.quietForMin} min`)}${porQue ? `, ${porQue}` : ""})`; }).join(" · ")}
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

      {soloPendientes && (
        <div className="hint" style={{ marginBottom: 8 }}>
          <b>{t("Viewing overdue and undated orders only", "Viendo solo órdenes expiradas y sin fecha")}</b> — {t("they belong to no day until you give them one. Set a date and the order moves to that day.", "no son de ningún día hasta que se les pone uno. Póngale fecha y la orden pasa a ese día.")}{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => setSoloPendientes(false)}>{t("Back to the day", "Volver al día")}</button>
        </div>
      )}

      {err && <div className="hint" style={{ color: "var(--red)", marginBottom: 8 }}>⚠ {err}</div>}

      {/* ---------- Layout toolbar ---------- */}
      {/* Una fila (D-655): el selector de vista y, a su lado, «N orden(es) expiradas · N sin fecha — Verlas», que era un
          renglón aparte encima. El dueño, 2026-10-23: «eso de vista completa y vista se vaya para arriba y ese texto vaya al
          lado para que en vez de que hayan dos rows, solo haya una». En las dos vistas. */}
      <div data-barra-de-arriba style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {/* «Vista completa | Vista eficiente» (D-653), como «Tabla | Tablero» de Órdenes. El dueño, 2026-10-23: «quiero que
            hayan dos views […] arriba va a estar full view y small view or efficient view». Solo en el Gestor.
            Rótulos de D-659 (el dueño, 2026-10-23: «en vez de efficient put it collapsed and expanded view mode»): «Expanded
            view / Vista expandida» y «Collapsed view / Vista compacta». Las claves internas (`completa`/`eficiente`) no cambian:
            son lo que cada persona tiene guardado en su navegador. */}
        {!soloLectura && (
          <div className="viewtoggle" data-selector-de-vista role="group" aria-label={t("Route manager view", "Vista del Gestor")}>
            <button className={"vt " + (!eficiente ? "on" : "")} data-vista="completa" aria-pressed={!eficiente} onClick={() => eligeVista("completa")}
              title={t("Everything, as always: the tabs and the route tables below the map", "Todo, como siempre: las pestañas y las tablas de ruta debajo del mapa")}>
              ▣ {t("Expanded view", "Vista expandida")}
            </button>
            <button className={"vt " + (eficiente ? "on" : "")} data-vista="eficiente" aria-pressed={eficiente} onClick={() => eligeVista("eficiente")}
              title={t("One screen: the tabs next to “Drivers & routes”, and the route of each checked driver right under the map", "Una sola pantalla: las pestañas junto a «Choferes y rutas», y la ruta de cada chofer marcado justo debajo del mapa")}>
              ⚡ {t("Collapsed view", "Vista compacta")}
            </button>
          </div>
        )}
        {/* En la eficiente el mapa no se esconde: es la vista (D-653). */}
        {!eficiente && (
        <button className={"btn btn-sm " + (showTop ? "btn-ghost" : "btn-primary")} data-boton-del-mapa onClick={() => setEstadoDelMapa((e) => alPulsarElMapa(e, abiertas.length > 0))}
          title={t("Show or hide the map + driver panel to free up space", "Mostrar u ocultar el mapa y el panel para ganar espacio")}>
          🗺 {showTop ? t("Hide map & drivers", "Ocultar mapa y choferes") : t("Show map & drivers", "Mostrar mapa y choferes")}
        </button>
        )}
        {/* «▦ Cuadrícula» se fue a las pestañas de abajo, junto a «Horario» (D-459): cambia las tarjetas de abajo, no el
            mapa. Y «👁 Mostrar avisos ocultos» ya no sale aquí (D-459; D-400 lo puso): va al fondo de la página, en pequeño.
            La explicación del mapa, que era un renglón fijo bajo él (D-400 le dio ✕), es ahora este ⓘ: se lee al pasar. */}
        <span className="hint" data-ayuda-del-mapa tabIndex={0} style={{ margin: 0, cursor: "help" }}
          title={t(
            "Every route is on the map at once. Click a route or a driver to highlight it (the rest dim and the map zooms in); check drivers to compare several. Each route loops from the pickup point (P) out and back; the dashed part is the drive back.",
            "Todas las rutas están en el mapa a la vez. Haz clic en una ruta o un chofer para resaltarla (el resto se atenúa y el mapa hace zoom); marca varios choferes para comparar. Cada ruta hace un ciclo desde el punto de recolección (P) y regresa; lo punteado es el regreso.",
          )}>ⓘ</span>
        {!soloPendientes && !soloLectura && (pendientes.atrasadas.length + pendientes.sinFecha.length > 0) && !oculto(AVISOS_DEL_GESTOR.atrasadas) && (
          <span className="hint" data-texto-de-expiradas style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>{t(`${pendientes.atrasadas.length} overdue order(s) · ${pendientes.sinFecha.length} with no date`, `${pendientes.atrasadas.length} orden(es) expiradas · ${pendientes.sinFecha.length} sin fecha`)}
            {" — "}{t("not part of this day.", "no son de este día.")}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAllDates(false); setSoloPendientes(true); }}>{t("View them", "Verlas")}</button>
            <CerrarAviso aviso={AVISOS_DEL_GESTOR.atrasadas} onCerrar={() => cierraAvisoDelGestor(AVISOS_DEL_GESTOR.atrasadas)} />
          </span>
        )}
      </div>

      {/* La vista eficiente (D-653) reordena lo que va de aquí al recuadro de reparto con una rejilla (`.gestor-eficiente`,
          globals.css): a la izquierda el panel «Choferes y rutas»; a su derecha, en su misma fila, las pestañas; debajo de
          ellas el mapa, y pegado al mapa lo de la pestaña (en «Rutas», la tabla de cada chofer marcado). En la completa este
          envoltorio y el de la pestaña son `display: contents`: no pintan nada y todo queda como estaba. */}
      <div data-vista-del-gestor={eficiente ? "eficiente" : "completa"} className={eficiente ? "gestor-eficiente" : undefined}>
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
          todas={seVenTodas(selected, clavesDelPanel)}
          onAlternaTodas={() => setSelected((s) => alternaTodas(s, clavesDelPanel))}
          onEnfoca={enfocaEnElPanel}
          onAlterna={alternaEnElPanel}
          onUbica={veCamiones ? (clave) => setLocateDriver(driverOf(clave)) : undefined}
          acciones={soloLectura ? undefined : <>
            {marcadasAProposito(selected).size >= 2 && (
              <button className="btn btn-primary btn-sm" onClick={mergeSelectedLanes}
                title={t("Combine the checked routes into one (merges into the top-most checked one)", "Combinar las rutas marcadas en una (se unen en la primera marcada)")}>
                🔀 {t("Merge", "Unir")} ({marcadasAProposito(selected).size})
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
              carga: cargaDelPanel(lecturaDe(u.key, stops), capacityFor(u.driver)), marcada: marcadasAProposito(selected).has(u.key), enVivo: liveNames.has(u.driver),
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
        <div className="card" data-mapa-del-gestor style={{ flex: "3 1 460px", margin: 0, padding: 0, overflow: "hidden", position: "relative" }}>
          {/* La capa de camiones de TrackSolid (D-900): un interruptor flotando sobre el mapa, arriba a la derecha (la
              esquina que ninguno de los dos mapas usa), para no quitarle alto al mapa ni mover la tabla de la ruta. */}
          {rastreadores.disponible && (
            <div className="capa-camiones" data-capa-camiones={capaCamiones ? "si" : "no"}>
              <label>
                <input type="checkbox" checked={capaCamiones} onChange={(e) => alternaCapaCamiones(e.target.checked)} />
                🚛 {t("Trucks", "Camiones")}
              </label>
              {capaCamiones && (
                <span className="hint" style={{ margin: 0 }} title={camionesSinSenal.map((c) => c.etiqueta).join("\n") || undefined}>
                  {/* D-903: cuentan también los camiones que ya van dentro de la marca de su chofer. */}
                  {camionesEnMapa.length - camionesSinSenal.length + liveDrivers.filter((d) => d.fusion?.camionMin != null).length} {t("reporting", "reportando")}
                  {camionesSinSenal.length > 0 && <b style={{ color: "var(--red)" }}> · {camionesSinSenal.length} {t("no signal", "sin señal")}</b>}
                  {rastreadores.atrasado && <> · ⚠ {t("delayed", "con retraso")}</>}
                </span>
              )}
              {/* D-903: los camiones sin chofer ese día no se pintan (estorban); aquí se piden. Apagado al entrar. */}
              {capaCamiones && repartoDeCamiones.sinAsignar.length > 0 && (
                <label data-camiones-sin-asignar={verSinAsignar ? "si" : "no"} title={t("Trucks with no driver this day (parked). Their state is also in Settings → Trucks.", "Camiones sin chofer este día (estacionados). Su estado también está en Ajustes → Camiones.")}>
                  <input type="checkbox" checked={verSinAsignar} onChange={(e) => setVerSinAsignar(e.target.checked)} />
                  {t(`unassigned (${repartoDeCamiones.sinAsignar.length})`, `sin asignar (${repartoDeCamiones.sinAsignar.length})`)}
                </label>
              )}
            </div>
          )}
          {/* Más bajo en la eficiente (D-653), para que el mapa y la tabla de la ruta quepan juntos en una pantalla. */}
          <MapView points={puntosMostrados} lines={lineasMostradas} stores={storeMarkers} liveDrivers={liveDrivers.filter((c) => pasaFiltro(c.driver))} trucks={camionesEnMapa} onLineClick={onLineClick} fitTo={fitTo} height={eficiente ? "var(--alto-mapa-gestor-eficiente)" : "var(--alto-mapa-gestor)"} onPointClick={(id) => {
            // Click any order pin (assigned or pool) to toggle its PU→DEL view.
            const d = dayOrders.find((x) => x.id === id);
            if (d) toggleOrder(d.id);
          }} />
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
        {/* «Todas (N)» (D-462): todas las del día, con chofer o sin él, más lo ya hecho. Desde D-499 NO sigue el filtro de
            choferes: todas son todas. */}
        <button className={"vt " + (tab === "todas" ? "on" : "")} data-pestana="todas" onClick={() => setTab("todas")}
          title={t(`${todasDelDia.length} order(s) this day, with or without a driver, delivered ones included`, `${todasDelDia.length} orden(es) este día, con chofer o sin él, entregadas incluidas`)}>
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
        {tab === "routes" && !eficiente && (
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
              ↶ <span className="rotulo-del-boton">{t("Undo", "Deshacer")}</span>
            </button>
            <button className="btn btn-ghost btn-sm" data-rehacer disabled={moviendo || !historial.rehacer.length} onClick={() => void vuelve("rehacer")}
              title={historial.rehacer.length ? t(`Redo: ${historial.rehacer[historial.rehacer.length - 1].etiqueta.en} (Ctrl+Y)`, `Rehacer: ${historial.rehacer[historial.rehacer.length - 1].etiqueta.es} (Ctrl+Y)`) : undefined}>
              ↷ <span className="rotulo-del-boton">{t("Redo", "Rehacer")}</span>
            </button>
          </span>
        )}
        {/* ⚠ Incidencias (D-437): un botón, a la derecha de las pestañas, que abre la ventana. Ámbar si hay alguna
            registrada (las incidencias no tienen estado «abierta»: se registran y se borran). */}
        {!soloLectura && (
        <button className={"btn btn-sm " + (incidents.length ? "btn-amber" : "btn-ghost")} data-abrir-incidencias
          style={{ marginLeft: "auto" }} aria-haspopup="dialog" onClick={() => setIncidenciasAbiertas(true)} title={t("Driver incidents", "Incidencias de choferes")}>
          ⚠ <span className="rotulo-de-la-franja">{t("Incidents", "Incidencias")}</span> ({incidents.length})
        </button>
        )}
        {/* Los avisos de relevo que no son de ninguna ruta a la vista: el mismo «⚠ N» y su panel, en la barra. */}
        {relevosSinCarta.length > 0 && <IconoDeAvisos avisos={relevosSinCarta.map((a) => ({ clave: a.tipo + a.ids.join(), titulo: `⇄ ${a[lang]}`, detalle: null }))} t={t} />}
        {/* 📥 Solicitudes de asignación (D-560, 176): las que piden ventas, Office y gerente; logística y admin deciden. */}
        {!soloLectura && puedeDecidirSolicitudes(me?.role) && (
          <BandejaDeSolicitudes ordenes={deliveriesLeidas} usuarios={users} choferes={drivers.map((u) => u.full_name)}
            aprobar={apruebaSolicitud} abrirOrden={setOpenOrder} t={t} />
        )}
      </div>

      {moverA && (() => {
        // D-1145: «# Mover a la parada N». Se abre en su sitio, encima del Gestor; Enter mueve, Esc cierra.
        const stops = byDriver.get(moverA.ruta) ?? [];
        const lectura = lecturaDe(moverA.ruta, stops);
        const indice = lectura.paradas.findIndex((x) => claveDeLaFila(x) === moverA.clave);
        const p = lectura.paradas[indice];
        if (!p) return null;
        const rangos = rangosDeParada(lectura.filas, diaDe(moverA.ruta, stops, lectura).dePendiente);
        const numeros = [...rangos.keys()].sort((x, y) => x - y);
        const min = numeros[0] ?? 0, max = numeros[numeros.length - 1] ?? 0;
        const bloque = ordenesDelBloque(lectura.paradas, marcadas, indice);
        const suyas = p.tipo === "P" ? p.ordenes : [p.orden];
        const nombre = suyas.map((id) => { const o = stops.find((x) => x.id === id); return o ? facturaYId(o).principal : ""; }).filter(Boolean).join(" · ");
        const etiqueta = etiquetaDelDia(moverA.ruta, stops, lectura, (f) => f.indice === indice);
        // «La orden entera» solo si su otra mitad está en la lista (una entrega ya en el camión no tiene recogida que mover).
        const tieneLasDos = lectura.paradas.filter((x) => (x.tipo === "P" ? x.ordenes : [x.orden]).some((id) => suyas.includes(id))).length > 1;
        const n = Number(numeroParaMover);
        const valido = numeroParaMover.trim() !== "" && Number.isInteger(n) && rangos.has(n);
        const mueve = (entera: boolean) => { if (!valido) return; const { ruta, clave } = moverA; cierraMoverA(); void enFila(() => gestosDeLaLista.current!.aParada(ruta, clave, n, entera)); };
        return (
          <div className="overlay" data-dialogo-mover-a-parada onClick={(e) => { if (e.target === e.currentTarget) cierraMoverA(); }}>
            <form className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}
              onSubmit={(e) => { e.preventDefault(); mueve(false); }} onKeyDown={(e) => { if (e.key === "Escape") cierraMoverA(); }}>
              <h3 style={{ marginTop: 0 }}>{bloque ? t(`Move the ${bloque.length} checked orders`, `Mover las ${bloque.length} órdenes marcadas`) : t(`Move ${etiqueta} · ${nombre}`, `Mover ${etiqueta} · ${nombre}`)}</h3>
              <div className="field">
                <label htmlFor="numero-para-mover">{t(`To stop number (${min} to ${max})`, `A la parada número (de la ${min} a la ${max})`)}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input id="numero-para-mover" data-numero-para-mover type="number" inputMode="numeric" autoFocus min={min} max={max} step={1}
                    value={numeroParaMover} onChange={(e) => setNumeroParaMover(e.target.value)} style={{ flex: 1, minHeight: 44, fontSize: 18 }} />
                  <button type="button" className="btn btn-ghost btn-sm" data-a-la-primera onClick={() => setNumeroParaMover(String(min))} title={t("The first pending stop", "La primera parada pendiente")}>⤒ {min}</button>
                  <button type="button" className="btn btn-ghost btn-sm" data-a-la-ultima onClick={() => setNumeroParaMover(String(max))} title={t("The last stop", "La última parada")}>⤓ {max}</button>
                </div>
                {numeroParaMover.trim() !== "" && !valido && <div className="hint" data-numero-no-valido style={{ color: "var(--red)" }}>{t(`That is not a pending stop of this route.`, `Esa no es una parada pendiente de esta ruta.`)}</div>}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="btn" style={{ minHeight: 44 }} onClick={cierraMoverA}>{t("Cancel", "Cancelar")}</button>
                <button type="submit" className="btn btn-primary" data-mover-solo-esta style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={!valido}>
                  {bloque ? t("Move them together", "Moverlas juntas") : t("Move this stop", "Mover esta parada")}
                </button>
                {!bloque && tieneLasDos && hayRecogidaGuardada && (
                  <button type="button" className="btn btn-primary" data-mover-la-orden-entera style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={!valido} onClick={() => mueve(true)}>
                    {p.tipo === "P" ? t("Move it with its delivery", "Moverla con su entrega") : t("Move it with its pickup", "Moverla con su recogida")}
                  </button>
                )}
              </div>
            </form>
          </div>
        );
      })()}

      {entregadaPorOtro && (() => {
        // Diálogo en su sitio, como «# Mover a la parada»: Enter guarda, Esc cierra. Sugerencias: la tienda y las rutas del día.
        const x = entregadaPorOtro;
        const hoy = ahoraDelNegocio().fecha;
        const diaFijo = diaFijoPorLaEntrega(x.order.pod_delivered_at);
        const motivo = validaEntregadaPorOtro({ quien: x.quien, dia: diaQueSeGuarda({ dia: x.dia, podDeLaEntrega: x.order.pod_delivered_at }), hoy, choferActual: x.order.assigned_driver });
        const sugerencias = sugerenciasDeQuien(x.order.store, lanes.map((l) => l.driver), x.order.assigned_driver);
        return (
          <div className="overlay" data-dialogo-entregada-por-otro onClick={(e) => { if (e.target === e.currentTarget) setEntregadaPorOtro(null); }}>
            <form className="modal" role="dialog" aria-modal="true" aria-label={t("Delivered by someone else", "Entregada por otro")} style={{ maxWidth: 440 }}
              onSubmit={(e) => { e.preventDefault(); void guardaEntregadaPorOtro(); }} onKeyDown={(e) => { if (e.key === "Escape") setEntregadaPorOtro(null); }}>
              <h3 style={{ marginTop: 0 }}>{t(`Delivered by someone else · #${orderLabel(x.order)}`, `Entregada por otro · #${orderLabel(x.order)}`)}</h3>
              <div className="hint">{t(`It leaves ${laneLabel(x.order.assigned_driver ?? "")}'s route and stays delivered, recorded with who delivered it.`, `Sale de la ruta de ${laneLabel(x.order.assigned_driver ?? "")} y sigue entregada, con quien la entregó.`)}</div>
              <div className="field">
                <label htmlFor="entregada-por-otro-quien">{t("Who delivered it", "Quién la entregó")}</label>
                <input id="entregada-por-otro-quien" data-entregada-quien list="entregada-por-otro-sugerencias" autoFocus maxLength={LARGO_MAX_QUIEN}
                  value={x.quien} onChange={(e) => setEntregadaPorOtro({ ...x, quien: e.target.value })} style={{ minHeight: 44, fontSize: 16 }} />
                <datalist id="entregada-por-otro-sugerencias">{sugerencias.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="field">
                <label htmlFor="entregada-por-otro-dia">{t("Delivered on", "Entregada el")}</label>
                <input id="entregada-por-otro-dia" data-entregada-dia type="date" max={hoy} value={diaFijo ?? x.dia} disabled={diaFijo != null}
                  onChange={(e) => setEntregadaPorOtro({ ...x, dia: e.target.value })} style={{ minHeight: 44 }} />
                {diaFijo && <div className="hint" data-entregada-dia-fijo>{t(`This order has a recorded delivery time, so its day stays on ${diaFijo}.`, `Esta orden tiene hora de entrega registrada, así que su día se queda en ${diaFijo}.`)}</div>}
              </div>
              {x.quien.trim() !== "" && motivo && <div className="hint" data-entregada-no-valida style={{ color: "var(--red)" }}>{t(AVISO_DE_ENTREGADA_POR_OTRO[motivo].en, AVISO_DE_ENTREGADA_POR_OTRO[motivo].es)}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setEntregadaPorOtro(null)}>{t("Cancel", "Cancelar")}</button>
                <button type="submit" className="btn btn-primary" data-entregada-guardar style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={!!motivo}>{t("Save", "Guardar")}</button>
              </div>
            </form>
          </div>
        );
      })()}

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

      {/* Lo de la pestaña elegida. En la eficiente va bajo el mapa, pegado a él (D-653). */}
      <div data-contenido-de-la-pestana>
      {/* ---------- Day timeline (Gantt) ---------- */}
      {tab === "timeline" && (
        <div className="card" style={{ margin: 0 }}>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Each driver's day in route order: every stop at its estimated arrival (straight-line estimate, leaving at 08:00), its window as the thin line underneath; ⚠ = late.",
              "El día de cada chofer en el orden de su ruta: cada parada a su llegada estimada (en línea recta, saliendo a las 08:00), y su ventana en la raya fina de abajo; ⚠ = tarde.")}
            {modo === "dia" && !soloLectura && <> {t("Drag a stop to another slot or driver, or onto a driver's name for 📍 Best fit. Ctrl+Z undoes.", "Arrastre una parada a otro hueco o chofer, o al nombre de un chofer para 📍 Mejor lugar. Ctrl+Z deshace.")}</>}
          </p>
          {filasDelGantt.length === 0
            ? <div className="empty" data-horario-vacio>{ganttRows.some((r) => r.barras.length > 0)
                ? t("No driver with stops is ticked in “Drivers & routes”.", "Ningún chofer con paradas está marcado en «Choferes y rutas».")
                : t("No assigned orders to show yet.", "Aún no hay órdenes asignadas.")}</div>
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
      {/* En cuadrícula, las tarjetas de una fila miden lo mismo: se estiran a la más alta (D-526). El dueño, 2026-10-11: «why
          does this has differtent heights everyhting should be equal». En ancho, cada una lo suyo, como antes. */}
      {/* En la eficiente (D-653), una debajo de otra y juntas: la tabla de cada chofer que dejan ver las casillas. */}
      {tab === "routes" && (
      <div data-tarjetas-de-ruta={eficiente ? "eficiente" : wideRoutes ? "ancho" : "cuadricula"} style={{ display: "grid", gridTemplateColumns: eficiente || wideRoutes ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(280px, 1fr))", gap: eficiente ? 8 : 14, alignItems: eficiente || wideRoutes ? "start" : "stretch" }}>
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
      {/* El filtro de la tabla de paradas (`soloFiltro`): una sola barra de «Filtrado por» para todas las tarjetas. */}
      <FiltrosPuestos estado={filtroParadas} columnas={menuDeParadas} lang={lang} t={t} />
      <MenuDeColumnaAbierto estado={filtroParadas} columnas={menuDeParadas} lang={lang} t={t} soloFiltro />
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
        // La lista que se pinta (lo hecho primero, en su hora real, y lo pendiente) y su numeración del DÍA (D-529): la misma de «Mi ruta».
        // D-1117: si el admin ya acomodó a mano alguna entregada de esta ruta, la tabla pinta lo hecho DONDE VA en la ruta
        // (por su puesto, mezclado con lo pendiente) en vez de todo lo hecho arriba por hora.
        const rutaAcomodada = rutaAcomodadaDe(u.key);
        const dia = diaDe(u.key, stops, lectura, !rutaAcomodada);
        const pintadas = dia.pintadas;
        // Las entregas de esta lista que el filtro deja ver (todas, sin filtro). Lo marcado con «todas» va sobre ellas.
        const entregasVisibles = stops.filter((d) => paradaVisible([valoresDeLaOrden(d, "D", null)], filtroParadas.filtros));
        const valoresDeLasFilas = pintadas.map((fp) => valoresDeLaFila(fp, porId, hechasPorId));
        valoresDeLasTarjetas.current.set(u.key, valoresDeLasFilas);
        const ocultasEnLaTarjeta = filasOcultas(valoresDeLasFilas, filtroParadas.filtros);
        const entregas = resumenDeEntregas(stops, hechas);
        const hayFilas = stops.length > 0 || hechas.length > 0;
        // D-906: lo hecho fuera del orden de la lista (delante queda algo sin hacer, o hecho después): su «Actual» lo dice
        // en vez de un «±min» que no quiere decir nada.
        // Se mira contra la lista COMO IBA (lo hecho en su puesto de la ruta): en la que se pinta lo hecho va siempre
        // primero y en su hora, así que ahí nunca habría nada fuera de orden y el aviso de D-906 se perdería.
        const fueraDeOrden = hechasFueraDeOrden(diaDe(u.key, stops, lectura, false).pintadas.map((fp) => {
          if (!fp.hecha || fp.estado !== "hecho") return { clave: "", hecha: false, real: null };
          const o = hechasPorId.get(fp.orden);
          return { clave: claveDeEta(fp.orden, fp.tipo), hecha: true, real: o ? minutosReales(fp.tipo === "D" ? o.pod_delivered_at : o.pickup_gps_at, date) : null };
        }));
        // ↶ ↷ en la tarjeta (D-459): el historial es uno, global; el botón se enciende si el último movimiento tocó esta ruta.
        const deshace = botonDeVolver(historial, "deshacer", u.key, laneLabel);
        const rehace = botonDeVolver(historial, "rehacer", u.key, laneLabel);
        /** Una fila ya HECHA: la recogida de una orden recogida o entregada, o su entrega. Informa; no lleva flechas, ni
         *  «Pasar a…», ni ✕, ni se arrastra, ni es sitio donde soltar. La factura sigue abriendo la orden. */
        // 21 nov (el dueño): «déjame solo al admin poder rearrange órdenes en el routes manager aunque ya estén delivered».
        // Solo el admin: ↑ ↓ en una entrega YA ENTREGADA la cambia de lugar con la entregada vecina (340, `done_sort_at`).
        // D-1117: la vecina es la ENTREGA de arriba o de abajo en la lista, hecha o pendiente.
        const entregaDeFila = (f: FilaPintada): Delivery | null => {
          if (f.hecha) return f.tipo === "D" ? hechasPorId.get(f.orden) ?? null : null;
          { const fl = f.fila; return fl.tipo === "D" ? stops.find((x) => x.id === fl.orden) ?? null : null; }
        };
        const vecinaD = (k: number, paso: -1 | 1): Delivery | null => {
          const propia = entregaDeFila(pintadas[k]);
          for (let j = k + paso; j >= 0 && j < pintadas.length; j += paso) {
            const v = entregaDeFila(pintadas[j]);
            if (v && v.id !== propia?.id && v.route_seq != null) return v;
          }
          return null;
        };
        const mueveEntregada = async (d: Delivery, k: number, paso: -1 | 1) => {
          const v = vecinaD(k, paso);
          // D-1117: se intercambian los PUESTOS (`route_seq`) con la entrega vecina, hecha o pendiente, y la entregada queda
          // marcada como acomodada (`done_sort_at`, 340) para que la ruta se pinte por puesto. La hora real no se toca.
          if (!v || d.route_seq == null || v.route_seq == null) return;
          const a = d.route_seq; const b = v.route_seq;
          if (await updateDelivery(d.id, { route_seq: b, done_sort_at: d.done_sort_at ?? new Date().toISOString() }, { quiet: true })) await updateDelivery(v.id, { route_seq: a }, { quiet: true });
        };
        const filaYaHecha = (fp: Extract<FilaPintada, { hecha: true }>, k: number) => {
          const d = hechasPorId.get(fp.orden);
          // Oculta por el filtro de columna (como las pendientes, sin tocar su índice).
          if (!d || !paradaVisible(valoresDeLaFila(fp, porId, hechasPorId), filtroParadas.filtros)) return null;
          const hecho = fp.estado === "hecho";
          const hora = hecho ? horaReal(d, fp.tipo) : null;
          const que = fp.tipo === "P" ? { en: "Picked up", es: "Recogida" } : hecho ? { en: "Delivered", es: "Entregada" } : { en: "On the truck, on its way", es: "En el camión, en camino" };
          return (
            <tr key={`hecha-${fp.tipo}-${d.id}`} {...(me.role === "admin" && !soloLectura && fp.tipo === "D" && hecho ? { ...filaArrastrable({ tipo: "hecha", ruta: u.key, orden: d.id }), ...sueltaSobreHecha(u.key, d.id) } : {})} data-hecha={fp.estado} data-hecha-tipo={fp.tipo} data-arrastrada={fp.tipo === "P" ? arrastreDeLaFila([d])?.fechas : undefined} data-etiqueta-del-dia={dia.etiqueta[k]} className={`fila-hecha${fp.tipo === "P" ? ` ${claseDeLaFilaDelPlan("P")}` : ""}`}
              title={t(`${que.en}${hora ? ` at ${hora}` : ""} — it stays on the list; it can't be moved`, `${que.es}${hora ? ` a las ${hora}` : ""} — sigue en la lista; no se mueve`)}>
              {/* Su número de parada del día y su etiqueta (D-529; hasta aquí, solo «✓P» / «🚚D»): el dueño, «when a order is
                  delviered dont take the number of the stop away». El ✓ o el 🚚 siguen diciendo que está hecha o en camino. */}
              <td style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700, whiteSpace: "nowrap" }}>{numeroDeParada(k, hecho)}{hecho ? "✓" : "🚚"}{dia.etiqueta[k]}</td>
              <td className="ordno">{facturaDeLaParada(d)}{etiquetaDeLaCarga(d)}</td>
              {/* Lo que movió, sin el «= a bordo»: no cuenta en la carga pendiente. */}
              <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{fp.tipo === "P" ? "+" : "−"}{numeroDePallets(palletsDeLaOrden(d))}</td>
              {colsParadas.map((c) => celdaDeParada(c, d, {
                tipo: fp.tipo, sinAviso: true, fueraDeOrden: fueraDeOrden.has(claveDeEta(d.id, fp.tipo)),
                // D-671: la llegada PREVISTA (`delivery_eta_plans`); la hora real va en «Actual». Desde D-906 es la del plan
                // vigente cuando se hizo la parada, no la primera del día (que queda en el aviso, si fue otra).
                // Sin «Actual» a la vista, la real sigue aquí, como antes: lo hecho no se queda sin hora.
                llegada: colsParadas.some((x) => x.key === "p_actual")
                  ? (() => {
                      const g = etasDelPlan.get(claveDeEta(d.id, fp.tipo));
                      const primera = g?.first_eta && g.first_eta !== g.eta ? g.first_eta : null;
                      return <td data-hora-prevista={g?.eta ?? ""} data-hora-real={hora ?? ""} style={{ color: "var(--gray)" }}
                        title={!g ? t("No estimate was recorded for this stop today", "Hoy no quedó apuntada una llegada prevista para esta parada")
                          : t(`Estimated arrival under the route's plan when this stop was done${primera ? ` (first estimate today: ${primera})` : ""}`, `Llegada prevista con el plan de la ruta cuando se hizo esta parada${primera ? ` (la primera de hoy: ${primera})` : ""}`)}>{g?.eta ?? "—"}</td>;
                    })()
                  : <td data-hora-real={hora ?? ""} style={{ fontWeight: 600 }}>{hecho ? `✓ ${hora ?? t(fp.tipo === "P" ? "picked up" : "delivered", fp.tipo === "P" ? "recogida" : "entregada")}` : `🚚 ${t("on its way", "en camino")}`}</td>,
                // Ayuda de Roberto (11 nov, «says mcallen but its weslaco»): la recogida hecha va donde se RECOGIÓ (`pickup_name`,
                // p. ej. el tramo b de un relevo recoge en Weslaco), no la tienda dueña de la orden; `store` solo de respaldo.
                recogida: fp.tipo === "P" ? <b>{(d.pickup_name ?? "").trim() || (d.store ?? "").trim() || "—"}</b> : undefined,
              }))}
              <td className="celda-acciones">
                {me.role === "admin" && fp.tipo === "D" && hecho && !soloLectura && (
                  <div className="acciones-de-parada" data-admin-mueve-entregada>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={!vecinaD(k, -1)} onClick={() => void mueveEntregada(d, k, -1)} title={t("Move up (admin)", "Subir (admin)")} data-accion="subir-entregada">↑</button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={!vecinaD(k, 1)} onClick={() => void mueveEntregada(d, k, 1)} title={t("Move down (admin)", "Bajar (admin)")} data-accion="bajar-entregada">↓</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => abreEntregadaPorOtro(d)} data-entregada-por-otro={d.id}
                      title={t("Delivered by someone else? Set who delivered it and the real day: it leaves this driver's route and stays delivered (admin)", "¿La entregó otro? Pon quién y el día real: sale de la ruta de este chofer y sigue entregada (admin)")}>👤 {t("Not this driver…", "No fue este chofer…")}</button>
                  </div>
                )}
              </td>
            </tr>
          );
        };
        // La cuenta de pallets de cada fila, visible de partida: «+4 = 4», lo de la parada y el total a bordo (D-444).
        const cuenta = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacity, aBordoDe(stops));
        // Filas SEGUIDAS en el mismo sitio (D-444): cada una en su fila, pintadas como grupo con un tono más fuerte.
        const grupos = gruposDeMismoLugar(lectura.paradas, stops);
        // La ruta por PARADAS (D-485): filas seguidas en el mismo sitio —la misma regla de los grupos— son una parada, con un
        // número. La primera fila de cada parada lleva el número; las demás, la raya de que sigue. Desde D-529, sobre la
        // lista PINTADA (`dia`): lo ya hecho cuenta y conserva su número, y lo pendiente no vuelve a contar desde 1. `k` es el
        // índice de la fila en `pintadas`; lo ya entregado o recogido, con el círculo apagado, como en «Mi ruta».
        const numeroDeParada = (k: number, hecha = false) => {
          const n = dia.deFila[k];
          const p = n != null ? dia.paradas[n - 1] : undefined;
          if (!p) return null;
          const titulo = textoDeLaParada(p, [], t);
          return dia.primera[k]
            ? <span className="numero-de-parada" data-numero-de-parada={n} title={titulo} style={{ background: colorFor(u.driver) }}>{n}</span>
            : <span className="numero-de-parada sigue" data-sigue-la-parada={n} title={titulo} style={{ color: colorFor(u.driver) }} />;
        };
        /** El 📌 de la parada (348), junto a su número: solo en la primera fila de la parada. */
        const pinDeLaParada = (k: number) => { const n = dia.deFila[k]; const p = n != null ? dia.paradas[n - 1] : undefined; return p && dia.primera[k] ? pinFijada(p.ordenes) : null; };
        const claseDeGrupo = (f: FilaDeLaRuta): string => {
          const g = f.indice != null ? grupos[f.indice] : null;
          if (g == null || f.indice == null) return "";
          const inicio = f.indice === 0 || grupos[f.indice - 1] !== g;
          // D-698: solo las recogidas llevan color; la entrega, ni tinte ni raya de grupo.
          if (f.tipo !== "P") return "";
          return ` fila-grupo-recoger${inicio ? " fila-grupo-inicio" : ""}`;
        };
        // Nadie la ordenó: su P/D sale igual, provisional y en gris (D-379); y, fila a fila, lo que aún no tiene puesto.
        const provisional = esProvisional(stops);
        const isC = isCollapsed(u.key);
        // La compacta de «Cuadrícula» no lleva cuerpo; la desplegada, siempre; la ancha, si no está plegada (D-481, e).
        const sinCuerpo = !conCuerpo(modoDeTarjeta, isC);
        // En qué está la medida de esta ruta, para la columna «Llegada» y la cabecera (D-456).
        const medida = estadoDeLaMedida(u.key, delDiaDe(u.key));
        const bucket = u.isBucket;
        // A route that isn't on a real driver (a bucket, or one recovered under
        // a stale name) can be handed to a driver.
        const needsDriver = !isRealDriver(u.driver);
        // Stops whose measured ETA lands after the delivery window closes —
        // surfaced as a banner so the dispatcher acts before dispatch, not just
        // as a red cell buried in the table.
        // «⚙ Columnas» de las paradas (D-346), una sola vez: en la eficiente va en la fila de la cabecera (D-655); en la
        // completa, en su renglón sobre la tabla, como siempre.
        const selectorDeParadas = (
          <SelectorDeColumnas
            columnas={columnasDelSelector("paradas", ordenGestor)}
            elegidas={colsGestor} onAlterna={alternaColumnaDelGestor} t={t}
            rotulo={(c) => sinElNombreDeLaTabla(lang === "es" ? c.es : c.en)}
            titulo={t("Stop columns", "Columnas de paradas")} nota={t("Saved for you. Applies to every route, and to “Unassigned” and “All”.", "Se guarda para usted. Vale para todas las rutas, y para «Sin asignar» y «Todas».")}
            plantillas={propsDePlantillas}
            mover={moverEn("paradas")}
          />
        );
        // El camión (D-655): «🚚 10» pulsable donde había campo; sin botón para quien no puede cambiarlo.
        const camion = botonDelCamion(soloLectura, modoDeTarjeta);
        // En la eficiente (D-655) la cabecera es UNA fila y el resumen de la ruta no se pinta: queda al pasar por el nombre.
        const eficienteAqui = modoDeTarjeta === "eficiente";
        const resumenDeLaRuta = [
          stops.length > 0 ? `${dia.quedan} ${t("stops", "paradas")} · ${numeroDePallets(cuenta.totales.palletsMovidos)} ${t("pallets moved", "pallets movidos")} · ${t("peak load", "carga máxima")} ${numeroDePallets(cuenta.totales.cargaMaxima)}/${capacity}` : "",
          info ? `${info.miles} mi · ${info.dayText} ${t("day", "jornada")} (${info.duration_text} ${t("drive", "manejo")})` : "",
        ].filter(Boolean).join(" · ");
        const lateStops = stops.filter((d) => {
          const eta = routeEtas[u.key]?.[d.id];
          const win = parseWindow(d.delivery_windows);
          const etaMin = eta ? parseInt(eta.slice(0, 2), 10) * 60 + parseInt(eta.slice(3, 5), 10) : null;
          return etaMin != null && win != null && etaMin > win[1];
        });
        // D-994: un paso b de relevo que esta ruta recoge antes de que llegue su paso a (+1 h), o sin saber cuándo llega.
        const enEstaRuta = new Set(stops.map((d) => d.id));
        const relevosTarde = relevosAntesDeTiempo(dayOrders, (id) => etaDeRecogidaEn({ [u.key]: routeEtas[u.key] }, id), (id) => etaDeEntregaEn(routeEtas, id))
          .filter((x) => enEstaRuta.has(x.paso));
        // Tapping anywhere on the card that isn't a stop row drops the
        // single-stop focus, so the map goes back to this driver's whole day.
        // That's the "tap outside" way back out.
        // Los avisos de esta ruta, para su «⚠ N» de la cabecera (solo si la tarjeta lleva cuerpo; ver `cartasConCuerpo`).
        const noPin = stops.filter((d) => d.delivery_lat == null);
        const avisosDeLaCarta: AvisoDeLaRuta[] = [
          ...(lateStops.length > 0 ? [{ clave: "tarde", titulo: t(`${lateStops.length} stop(s) will miss their delivery window`, `${lateStops.length} parada(s) no llegarán a tiempo a su ventana`),
            detalle: <>
              {lateStops.slice(0, 6).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}`).join(", ")}{lateStops.length > 6 ? "…" : ""}
              {" — "}{t("reorder the stops or move some to another driver.", "reordene las paradas o mueva algunas a otro chofer.")}
            </> }] : []),
          ...(relevosTarde.length > 0 ? [{ clave: "relevo-antes-de-tiempo", titulo: t(`${relevosTarde.length} relay pickup(s) before leg A arrives`, `${relevosTarde.length} recogida(s) de relevo antes de que llegue el paso a`),
            detalle: <>
              {relevosTarde.slice(0, 6).map((x) => {
                const b = dayOrders.find((d) => d.id === x.paso);
                const hh = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                const nombre = b ? `#${orderLabel(b)}` : x.paso.slice(0, 6);
                return x.llegadaDelAnterior == null
                  ? t(`${nombre}: pickup ${hh(x.recogida)}, leg A has no ETA on any route`, `${nombre}: recoge ${hh(x.recogida)}, el paso a no tiene hora en ninguna ruta`)
                  : t(`${nombre}: pickup ${hh(x.recogida)}, leg A arrives ${hh(x.llegadaDelAnterior)}`, `${nombre}: recoge ${hh(x.recogida)}, el paso a llega ${hh(x.llegadaDelAnterior)}`);
              }).join(" · ")}
              {" — "}{t(`leave at least ${MARGEN_DEL_RELEVO_MIN} min after leg A arrives (Optimize and Distribute already do).`, `deje al menos ${MARGEN_DEL_RELEVO_MIN} min después de que llegue el paso a (Optimizar y Repartir ya lo hacen).`)}
            </> }] : []),
          ...(noPin.length > 0 ? [{ clave: "sin-pin", titulo: t(`${missingPins} stop(s) aren't on the map yet, so the route skips them.`, `${missingPins} parada(s) aún no están en el mapa, así que la ruta las omite.`),
            detalle: <>
              {noPin.map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""}${d.delivery_address ? "" : " — " + t("no delivery address", "sin dirección de entrega")}`).join(", ")}
              {" — "}{t("give each a valid delivery address (or drop a map pin) on the Orders page so it geocodes.", "dé a cada una una dirección de entrega válida (o coloque un pin) en Órdenes para que se ubique.")}
            </> }] : []),
          ...(stops.some(ordenSoloCiudad) ? [{ clave: "solo-ciudad", titulo: t(AVISO_SOLO_CIUDAD.en, AVISO_SOLO_CIUDAD.es),
            detalle: <>
              {stops.filter(ordenSoloCiudad).map((d) => `#${orderLabel(d)}${d.account ? ` (${d.account})` : ""} — ${d.delivery_address}`).join(" · ")}
              {" — "}{t("the pin is the city centre. Get the street address before the driver leaves.", "el pin es el centro de la ciudad. Consiga la dirección con calle antes de que salga el chofer.")}
            </> }] : []),
          ...(relevosDeLaCarta.get(u.key) ?? []).map((a) => ({ clave: a.tipo + a.ids.join(), titulo: `⇄ ${a[lang]}`, detalle: null })),
        ];
        return (
          <div className={claseDeTarjeta(modoDeTarjeta, desplegadaAqui)} key={`${modoDeTarjeta}-${u.id}`} data-tarjeta-de-ruta={u.key} data-modo-de-tarjeta={modoDeTarjeta} {...sueltaAqui(u.key, null)}
            style={{ margin: 0, gridColumn: modoDeTarjeta === "desplegada" ? "1 / -1" : undefined, outline: sobre === claveDeSoltar(u.key, null) ? "2px dashed var(--accent)" : undefined, outlineOffset: -2 }}
            onClick={() => { setSelectedOrders((prev) => (prev.size ? new Set() : prev)); setOrdenesResaltadas((prev) => (prev.size ? new Set() : prev)); }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              {/* La desplegada de «Cuadrícula» no repite nombre ni números (D-482): ya están en su tarjeta compacta de arriba, que
                  queda pegada a ella. Solo trae la barra de acciones y la tabla. */}
              {conCabecera(modoDeTarjeta) && (<>
              {modoDeTarjeta === "ancha" && (
                <button className="btn btn-ghost btn-sm" style={{ padding: "0 6px" }} onClick={() => toggleCollapse(u.key)} title={t("Collapse", "Contraer")}>{isC ? "▸" : "▾"}</button>
              )}
              {/* El NOMBRE (D-481, e): en «Ancho», resalta la ruta en el mapa, como siempre; en «Cuadrícula», despliega su tabla
                  abajo (otro nombre la cambia; el mismo la pliega). */}
              {/* En la eficiente (D-653) el nombre solo nombra: no pliega, no despliega ni enfoca. El dueño: «la forma que yo voy
                  a ir cambiando eso ya no es como abajo, que Ernesto y se hace un pop-up para abajo, no, que es simplemente
                  eligiendo el driver con los selection boxes de ahí arriba». */}
              {modoDeTarjeta === "eficiente" ? (
                <span data-nombre-de-ruta={u.key} title={resumenDeLaRuta || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorFor(u.driver), border: "2px solid var(--card)", boxShadow: "0 0 0 1px var(--line)", flex: "0 0 auto" }} />
                  <h2 style={{ margin: 0, fontSize: 16 }}>{u.label}</h2>
                </span>
              ) : (
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
              )}
              {needsDriver && <span className="sema" style={{ background: "var(--accent)", color: "#fff" }}>🧭 {t("route (no driver)", "ruta (sin chofer)")}</span>}
              {/* «🚛 camión» (D-903): el camión que este chofer lleva ESTE día. Quien planifica lo cambia aquí, en el sitio
                  (el servidor comprueba el permiso); los demás —el chofer en su ruta, «Ruta de hoy»— lo leen. */}
              {choferIdDe(u.driver) && camionesDelDia.disponible && (
                <CamionDelChofer chofer={u.driver} driverId={choferIdDe(u.driver)!} asignado={camionesDelDia.asignaciones.find((a) => a.driverId === choferIdDe(u.driver))}
                  asignaciones={camionesDelDia.asignaciones} camiones={camionesDelDia.camiones} puedeCambiar={!soloLectura && camionesDelDia.puedeAsignar} asigna={camionesDelDia.asigna} t={t} />
              )}
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
                  Lo que dice la cabecera es la cuenta de la lista: paradas, pallets movidos y la carga máxima contra el camión.
                  «N paradas» son las que aún tienen algo PENDIENTE, como «N órdenes» (D-529: los números ya cuentan lo hecho). */}
              {/* En la eficiente no (D-655; el dueño: «ese texto que sale ahí, de pales y todas esas cosas, eso lo vamos a
                  eliminar»): va en el `title` del nombre. Lo que es un problema —se pasa de la capacidad, no acaba en 0, más
                  de 8 h, sin medida— sigue siendo su pastilla, en las dos. */}
              {stops.length > 0 && !eficienteAqui && (
                <span className="hint" data-totales-de-la-lista style={{ marginTop: 0 }}>
                  {dia.quedan} {t("stops", "paradas")} · {numeroDePallets(cuenta.totales.palletsMovidos)} {t("pallets moved", "pallets movidos")} · {t("peak load", "carga máxima")} {numeroDePallets(cuenta.totales.cargaMaxima)}/{capacity}
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
              {info && !eficienteAqui && (
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
              {/* La auto-optimización al asignar (348): «⏳ optimizando…» o, si falló, «↻ sin optimizar — reintentar». Solo con la 348. */}
              {hayAutoOptimizar && (() => {
                const guardado = estadoAutoDeRutas.get(claveDeRutaAuto(date, u.key));
                const chip = chipAutoEnPantalla(guardado?.estado ?? null, corriendoAuto.current.has(u.key));
                if (!chip) return null;
                return chip.clase === "fallo" ? (
                  <button className="btn btn-ghost btn-sm" data-reintentar-auto={u.key} style={{ color: "var(--amber-text)" }}
                    title={guardado?.nota ?? t("The automatic optimisation didn't finish. Click to retry.", "La optimización automática no terminó. Pulse para reintentar.")}
                    onClick={(e) => { e.stopPropagation(); reintentaAuto(u.key); }}>
                    {t(chip.en, chip.es)}
                  </button>
                ) : (
                  <span className="hint" data-auto={chip.clase} title={guardado?.nota ?? undefined} style={{ marginTop: 0 }}>{t(chip.en, chip.es)}</span>
                );
              })()}
              </>)}
              {/* El «⚠ N» de los avisos de la ruta: después de las pastillas. Sin cuerpo (la compacta) no hay avisos que mostrar. */}
              {!sinCuerpo && <IconoDeAvisos avisos={avisosDeLaCarta} t={t} />}
              <span style={{ flex: 1 }} />
              {/* Aquí iba «🚚 Capacidad del camión [10] trm», un campo que guardaba en cada tecla: ahora es el botón «🚚 10»,
                  al final de la fila (D-655, abajo). */}
              {/* ↶ ↷ (D-459), a la vista junto a Bloquear / Optimizar / Vaciar. El dueño, 2026-10-01: «aqui pon un undo redo
                  para los movimientos del orden de las cargas para areglar un error si pasa». Llaman al MISMO historial que
                  Ctrl+Z y que los de la barra de vistas (`vuelve`); el título dice QUÉ deshacen (`botonDeVolver`).
                  Los cinco botones van en UN grupo, para que al faltar sitio bajen juntos y no se separen.
                  En la vista eficiente (D-655) van solo con su icono —el rótulo, `.rotulo-del-boton`, se esconde en
                  globals.css y queda en el `title`—: así cabe todo en una fila con el nombre y sus pastillas. */}
              {acciones && (
              <span data-acciones-de-la-ruta style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
              <span style={{ display: "inline-flex", gap: 4 }}>
                <button className="btn btn-ghost btn-sm" data-deshacer-en-ruta={u.key} disabled={moviendo || !deshace.activo}
                  title={t(deshace.titulo.en, deshace.titulo.es)} onClick={(e) => { e.stopPropagation(); void vuelve("deshacer"); }}>
                  ↶ <span className="rotulo-del-boton">{t("Undo", "Deshacer")}</span>
                </button>
                <button className="btn btn-ghost btn-sm" data-rehacer-en-ruta={u.key} disabled={moviendo || !rehace.activo}
                  title={t(rehace.titulo.en, rehace.titulo.es)} onClick={(e) => { e.stopPropagation(); void vuelve("rehacer"); }}>
                  ↷ <span className="rotulo-del-boton">{t("Redo", "Rehacer")}</span>
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
                {bloqueada(u.key) ? "🔒" : "🔓"} <span className="rotulo-del-boton">{bloqueada(u.key) ? t("Locked", "Bloqueada") : t("Lock", "Bloquear")}</span>
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
                  🧭 <span className="rotulo-del-boton">{optimizando === u.key ? t("Optimizing…", "Optimizando…") : t("Optimize", "Optimizar")}</span>
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
                  onClick={() => clearLane(u.key)}>🗑 <span className="rotulo-del-boton">{t("Clear", "Vaciar")}</span></button>
              )}
              </span>
              )}
              {/* «📸 PNG» (D-536): la hoja de la ruta —paradas en orden y el mapa con solo esta ruta— como imagen, para
                  mandársela al chofer. También en solo lectura: mirar y mandar no cambia nada. Ventas, no (D-542, el dueño:
                  «remove the png option for the sales people»). */}
              {stops.length > 0 && veCamiones && (
                <button className="btn btn-ghost btn-sm" data-png-de-la-ruta={u.key} title={t("Build a PNG of this route (stops + map) to send to the driver", "Armar un PNG de esta ruta (paradas + mapa) para mandárselo al chofer")}
                  onClick={(e) => { e.stopPropagation(); abreParaLaFoto(u.key); setPngDe(u.key); }}>📸 PNG</button>
              )}
              {/* «🔁 Cambiar etapa» (solo admin): muestra en la celda de ETAPA lo que se puede marcar a mano. */}
              {stops.length > 0 && puedeCambiarEtapaAqui(me?.role) && (
                <button type="button" className={`btn btn-sm ${cambiarEtapa ? "btn-amber" : "btn-ghost"}`} aria-pressed={cambiarEtapa} data-cambiar-etapa-toggle
                  title={t("Admin: show the stage actions (picked up / delivered) on each stop", "Admin: mostrar las acciones de etapa (recogido / entregado) en cada parada")}
                  onClick={(e) => { e.stopPropagation(); setCambiarEtapa((v) => !v); }}>🔁 {t("Change stage", "Cambiar etapa")}</button>
              )}
              {/* «Marcar por…» (D-1145): marca de un toque las órdenes de una ciudad o de una tienda de recogida, para moverlas
                  juntas (arrastre, flechas o «#»), pasarlas a otro chofer o reprogramarlas con la barra de marcadas. */}
              {stops.length > 1 && !soloLectura && modoDeTarjeta !== "compacta" && (() => {
                const grupos = gruposParaMarcar(stops, (d) => ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen));
                const deCiudad = grupos.filter((g) => g.tipo === "ciudad"), deTienda = grupos.filter((g) => g.tipo === "tienda");
                if (!grupos.length) return null;
                const hayMarcadas = stops.some((d) => marcadas.has(d.id));
                return (
                  <select value="" data-marcar-por={u.key} onClick={(e) => e.stopPropagation()}
                    aria-label={t("Check the orders of a city or a pickup store", "Marcar las órdenes de una ciudad o de una tienda de recogida")}
                    title={t("Check every order of a delivery city or a pickup store, to move them together", "Marcar todas las órdenes de una ciudad de entrega o de una tienda de recogida, para moverlas juntas")}
                    onChange={(e) => {
                      const v = e.target.value; e.currentTarget.value = "";
                      const suyas = new Set(stops.map((d) => d.id));
                      const elegidas = grupos.find((g) => g.clave === v)?.ids ?? [];
                      setMarcadas((m) => { const n = new Set([...m].filter((id) => !suyas.has(id))); for (const id of elegidas) n.add(id); return n; });
                    }}
                    style={{ width: "auto", maxWidth: 132, padding: "2px 4px", fontSize: 12 }}>
                    <option value="">☑ {t("Check by…", "Marcar por…")}</option>
                    {deCiudad.length > 0 && <optgroup label={t("Delivery city", "Ciudad de entrega")}>{deCiudad.map((g) => <option key={g.clave} value={g.clave}>{g.nombre} ({g.ids.length})</option>)}</optgroup>}
                    {deTienda.length > 0 && <optgroup label={t("Picks up at", "Recoge en")}>{deTienda.map((g) => <option key={g.clave} value={g.clave}>{g.nombre} ({g.ids.length})</option>)}</optgroup>}
                    {hayMarcadas && <option value="_ninguna">✕ {t("Uncheck this route", "Quitar las marcas de esta ruta")}</option>}
                  </select>
                );
              })()}
              {/* Una sola foto por ruta: en «Cuadrícula» la pinta la desplegada, que es la que tiene la tabla (D-636). */}
              {pngDe === u.key && modoDeTarjeta !== "compacta" && (
                <FotoDeLaRuta chofer={u.label} fecha={date} laneKey={u.key} stops={stops} color={colorFor(u.driver)} t={t} onClose={() => setPngDe(null)} camion={camionesDelDia.asignaciones.find((a) => a.driverId === choferIdDe(u.driver))?.truck ?? null}
                  points={puntosDeLaRuta(points, u, new Set([...stops, ...hechasDe(u.key)].map((d) => d.id)), { paradas: diaDe(u.key, stops).paradas, color: colorFor(u.driver), coordsDeTienda })} lines={lineasDeLaRuta(lines, u.key)} />
              )}
              {/* En la eficiente, «⚙ Columnas» sube a esta fila (D-655): «todo va a estar en una sola línea». */}
              {eficienteAqui && hayFilas && !soloLectura && selectorDeParadas}
              {/* «🚚 10» (D-655), en las dos vistas: pulsado pide la capacidad y guarda por el MISMO `setCapacity` que el campo. */}
              {camion && <BotonDelCamion capacidad={capacity} puedeCambiar={camion === "pulsable"} onGuarda={(v) => setCapacity(u.driver, v)} t={t} />}
            </div>
            {!sinCuerpo && <>
            {/* Los avisos de la ruta (tarde, relevo, sin pin, solo ciudad) no van aquí: van en su «⚠ N» de la cabecera. */}
            {hayFilas && !soloLectura && !eficienteAqui && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                {/* La línea «✋ Arrastre una fila…» (D-456) se fue (D-459): es el `title` de la cabecera de la tabla. */}
                {selectorDeParadas}
              </div>
            )}
            {ocultasEnLaTarjeta > 0 && <div className="hint">{t(`${ocultasEnLaTarjeta} stop(s) hidden by the filter`, `${ocultasEnLaTarjeta} parada(s) ocultas por el filtro`)}</div>}
            {hayFilas && (
              <>
              <BarraSuperior caja={cajaDeParadas(u.key)} />
              <div className="tbl-scroll tbl-fit tbl-caja" ref={cajaDeParadas(u.key)} style={estiloDeCaja}>
                {/* Address stays on one line (narrow by default) with an
                    expand/contract toggle, so Windows + the action arrows never
                    get pushed off the right edge. Width pinned to the column
                    sum; columns still draggable. */}
                <table className="orders tbl-resize tabla-de-paradas" data-tabla-de-la-ruta={u.key} style={{ width: ["_n", "_factura", "_cuenta", ...colsParadas.map((c) => c.key), "_acciones"].reduce((sum, k) => sum + anchoDeParada(k), 0) }}>
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
                        {/* `stops` aquí son las entregas que el filtro deja ver (`entregasVisibles`): la casilla solo marca esas. */}
                        {!soloLectura && ((stops: Delivery[]) => <input type="checkbox" data-marca-todas={u.key} checked={stops.length > 0 && stops.every((d) => marcadas.has(d.id))} disabled={stops.length === 0}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => setMarcadas((s) => { const n = new Set(s); const todas = stops.every((d) => n.has(d.id)); for (const d of stops) { if (todas) n.delete(d.id); else n.add(d.id); } return n; })}
                          aria-label={t(`Select every order of ${u.label}`, `Marcar todas las órdenes de ${u.label}`)} style={{ width: 13, height: 13, margin: "0 3px 0 0", verticalAlign: "middle" }} />)(entregasVisibles)}
                        {t("Stop", "Parada")}<span className="col-resizer" onMouseDown={asaDeParada("_n")} />
                      </th>
                      {/* La FACTURA, con el ID al lado (D-459; D-456 lo ponía debajo; D-444 había puesto solo el ID). La clave del ancho sigue siendo `_factura`. */}
                      <th data-columna-factura title={t("The invoice opens the order; its ID goes next to it", "La factura abre la orden; al lado va su ID")}>{t("Invoice #", "Factura #")}<span className="col-resizer" onMouseDown={asaDeParada("_factura")} /></th>
                      <th data-columna-cuenta title={t("What this stop loads (+) or unloads (−) = pallets on board after it", "Lo que carga (+) o descarga (−) esta parada = pallets a bordo después")}>
                        {t("Pallets", "Pallets")}<span className="col-resizer" onMouseDown={asaDeParada("_cuenta")} />
                      </th>
                      {/* El rótulo es el del catálogo sin su «Paradas: » (el de Órdenes, para las que vienen de allí). */}
                      {colsParadas.map((c) => <th key={c.key}>{cabeceraDeParada(c)}<span className="col-resizer" onMouseDown={asaDeParada(c.key)} /></th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequenced && lectura.cambioTrasPublicar && (
                      <tr><td colSpan={columnasDeParadas} className="hint" style={{ color: "var(--amber-text)" }}>⚠ {t("This route changed after the plan was published: the P/D labels were recalculated.", "Esta ruta cambió desde que se publicó el plan: las etiquetas P/D se recalcularon.")}</td></tr>
                    )}
                    {/* La Base (D-443): la ruta sale de ella con 0 a bordo y vuelve a ella con 0. Si al volver no da 0, se marca. */}
                    {filaDeLaBase(u.key, "salida", cuenta.salida, false)}
                    {/* Las pendientes, que son las de siempre (`lectura.filas`, con su índice), y las ya hechas, primero y en su hora real. */}
                    {pintadas.map((fp, k) => {
                      if (fp.hecha) return filaYaHecha(fp, k);
                      const f = fp.fila;
                      const fi = fp.i;
                      // Oculta por el filtro de columna: no se pinta, pero su índice (`k`, `fi`) sigue siendo el real.
                      if (!paradaVisible(valoresDeLaFila(fp, porId, hechasPorId), filtroParadas.filtros)) return null;
                      // Su etiqueta P/D del DÍA (D-529): sin plan, numerada con lo ya hecho dentro; con plan, la del plan.
                      const etiquetaDeLaFila = dia.etiqueta[k];
                      const cu = cuenta.paradas[fi];
                      const gris = esProvisionalLaFila(f, porId);
                      const movible = f.indice != null;
                      const clave = claveDeLaFila(f);
                      const resaltada = recienMovida === clave;
                      // ARRASTRAR la fila (D-456): cualquier parada que también muevan las flechas. Soltada sobre otra fila toma
                      // su puesto; la raya marca dónde cae (arriba, o abajo si viene de más arriba en la misma lista).
                      const enCamion = f.tipo === "D" && estaEnElCamion(porId.get(f.orden)?.stage);
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
                          {/* D-1145: «#» = a la parada número N, de una vez; en una recogida, «D↑» trae su entrega justo detrás. */}
                          <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-mover-a-parada
                            disabled={f.tipo === "P" && !hayRecogidaGuardada} onClick={() => { setNumeroParaMover(""); setMoverA({ ruta: u.key, clave }); }}
                            title={t("Move to stop number… (with several orders checked, they all go together)", "Mover a la parada número… (con varias órdenes marcadas, van todas juntas)")}>#</button>
                          {f.tipo === "P" && hayRecogidaGuardada && (
                            <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-trae-la-entrega
                              onClick={() => void enFila(() => gestosDeLaLista.current!.traeEntrega(u.key, clave))}
                              title={t("Bring its delivery up, right after this pickup", "Traer su entrega, justo después de esta recogida")}>D↑</button>
                          )}
                        </>
                      );
                      // «Pasar a…» otro chofer (D-443, en las P y en las D): las órdenes de la parada, enteras.
                      const ordenesDeLaFila = f.tipo === "P" ? f.ordenes : [f.orden];
                      // Una entrega ya en el camión no se pasa a otro chofer desde aquí (el material va en ESTE camión).
                      const pasar = acciones && movible && !enCamion && lanes.length > 1 && (
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
                        const arrastradaDeLaRecogida = arrastreDeLaFila(suyas);
                        // La llegada a la tienda: la medida de la ruta ya la calcula, con la clave «P:» + las órdenes de la PARADA
                        // del día entera (D-680; con las de la fila solo acertaba la recogida que iba sola en su tienda).
                        const etaP = f.indice != null ? routeEtas[u.key]?.[claveDeRecogida(ordenesDeLaRecogidaMedida(dia.paradas, dia.deFila[k], f.ordenes))] : undefined;
                        // Si no hay hora, por qué (D-456): la tienda sin coordenadas no se mide; con una sola parada y sin base, tampoco.
                        const paradaP = f.indice != null ? lectura.paradas[f.indice] : undefined;
                        const claveP = claveDeRecogida(ordenesDeLaRecogidaMedida(dia.paradas, dia.deFila[k], f.ordenes));
                        const motivoP: MotivoSinLlegada | null = !paradaP || paradaP.tipo !== "P" ? null : !coordsDeTienda(paradaP.tienda) ? "sin_tienda" : routeSinHora[u.key]?.[claveP] ?? "sin_base";
                        const llegadaP = textoDeLaLlegada(etaP, f.indice != null ? medida : "sin_pedir", motivoP, lang === "es");
                        // La TIENDA donde se recoge, sin «Recoger en» (D-447): va en la columna Ciudad de recogida.
                        // D-808: una recogida LIBRE (Otro, Proveedor; D-782) no es una tienda aunque su nombre tecleado lo parezca: la
                        // columna dice la CIUDAD de su dirección, la misma que la fila D (`zonaDeLaRecogida`). FV594: la P decía
                        // «RDZ Weslaco» (el nombre elegido) y su D «Harlingen» (la dirección, la buena).
                        const ciudadLibre = o && recogidaLibreDeLaOrden(o, settings.order_type_rules)
                          ? zonaDeLaRecogida(o, settings.stores ?? [], ciudadesQueSeConocen, settings.order_type_rules) : "";
                        const dondeRecoge = (
                          <>
                            {ciudadLibre
                              ? <b title={f.lugar ?? undefined}>{ciudadLibre}</b>
                              : <b>{f.lugar ?? t("(no store on the order)", "(la orden no dice la tienda)")}</b>}
                            {!movible && <span className="hint" style={{ margin: 0 }}> · {t("another load of the same order", "otra carga de la misma orden")}</span>}
                          </>
                        );
                        return (
                          <tr key={`P-${fi}-${clave}`} data-recogida={etiquetaDeLaFila} className={`${claseDeLaFilaDelPlan("P")}${claseDeGrupo(f)}${claseDeSoltar}`}
                            data-arrastrada={arrastradaDeLaRecogida?.fechas}
                            data-fila-arrastrable={seArrastra ? "parada" : undefined} {...arrastre} {...soltar}
                            title={arrastradaDeLaRecogida ? `${arrastradaDeLaRecogida.texto} — ${t("Show this stop on the map", "Ver esta parada en el mapa")}` : t("Show this stop on the map", "Ver esta parada en el mapa")}
                            onClick={(e) => { e.stopPropagation(); if (esControlDeLaFila(e.target as Element)) return; setOrdenesResaltadas((s) => alternaResaltada(s, suyas.map((x) => x.id))); }}
                            style={{ ...(suyas.some((x) => ordenesResaltadas.has(x.id)) ? { background: "var(--accent-soft)" } : {}), ...(suyas.some((x) => marcadas.has(x.id)) ? { boxShadow: "inset 4px 0 0 var(--accent)" } : {}), ...(resaltada ? { outline: "2px solid var(--amber)", outlineOffset: -2 } : {}), ...(esLaArrastrada ? { opacity: 0.5 } : {}), ...(seArrastra ? { cursor: "grab" } : {}) }} data-recien-movida={resaltada ? "" : undefined}>
                            <td className={gris || provisional ? "etiqueta-provisional" : undefined} style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700, whiteSpace: "nowrap" }}>
                              {/* D-998: la RECOGIDA también se marca (intertienda, relevos, recogidas en otra tienda): marca sus órdenes. */}
                              {acciones && suyas.length > 0 && (() => {
                                const ids = suyas.map((x) => x.id);
                                const est = estadoDeGrupo(ids, marcadas);
                                return <input type="checkbox" data-marca-recogida={ids.join(",")} checked={est === "todas"}
                                  ref={(el) => { if (el) el.indeterminate = est === "algunas"; }}
                                  onChange={() => setMarcadas((m) => alternaGrupo(m, ids))} onClick={(e) => e.stopPropagation()}
                                  aria-label={t(`Select ${suyas.map((x) => facturaYId(x).principal).join(", ")}`, `Marcar ${suyas.map((x) => facturaYId(x).principal).join(", ")}`)}
                                  style={{ width: 13, height: 13, margin: "0 3px 0 0", verticalAlign: "middle" }} />;
                              })()}
                              {numeroDeParada(k)}{etiquetaDeLaFila}{pinDeLaParada(k)}
                            </td>
                            {/* D-592: el 📅 de «Reprogramar» (D-500/D-574) también aquí, en la tabla de paradas, junto a cada factura. El
                                dueño: «Route Manager view needs the calendar icon to reschedule». Misma condición que en la tabla de órdenes. */}
                            <td className="ordno">{suyas.map((x, k) => <Fragment key={x.id}>{k > 0 && " · "}{facturaDeLaParada(x)}{iconoDeReprogramar(x)}{etiquetaDeLaCarga(x)}</Fragment>)}</td>
                            {celdaDeCuenta}
                            {/* D-446: el Tipo de la P es el de su orden, como en la D. D-447 corrige el sitio de la tienda: va en la
                                Ciudad de RECOGIDA, sin la palabra «Recoger», y la Ciudad de entrega dice la de su orden. El dueño,
                                2026-09-29: «la palabra recoger i dont need that y esta mal porque esta en ciudad de entrega eso de rdz
                                mcallen deberia esta en ciudad de recodiga tienes todo alreves». Las ventanas y lo demás de la
                                ENTREGA van vacíos (`tipo: "P"`, `seVeEnLaRecogida`). */}
                            {colsParadas.map((c) => celdaDeParada(c, o, {
                              tipo: "P", recogida: dondeRecoge, ordenes: suyas,
                              llegada: <td data-llegada={llegadaP.falta ? "falta" : "hora"} title={llegadaP.titulo} style={llegadaP.falta ? ESTILO_SIN_LLEGADA : { fontWeight: 600 }}>{llegadaP.texto}</td>,
                            }))}
                            {/* D-459: el td es una celda normal y el flex va DENTRO (era `display: flex` en el td: el fallo de la captura). */}
                            <td className="celda-acciones" onClick={(e) => e.stopPropagation()}>
                              <div className="acciones-de-parada">{flechas}{pasar}
                                {/* La ✕ de la entrega, también aquí (dueño): quitar la carga desde su recogida. Es el MISMO `unassign`
                                    que la ✕ de la entrega, y la misma condición (`accionDeLaParadaEnRutas`): antes de recoger. Quita
                                    la orden entera, P y D a la vez. */}
                                {acciones && suyas.map((x) => accionDeLaParadaEnRutas(x) === "quitar" && (
                                  <button key={x.id} className="btn btn-danger btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-quitar-recogida={x.id}
                                    onClick={() => unassign(x.id)} title={t("Unassign", "Quitar asignación")}>✕</button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      const d = porId.get(f.orden);
                      if (!d) return null;
                      if (f.otraCarga) {
                        // La entrega de OTRA carga de una orden que el motor repartió: informa, no se mueve.
                        return (
                          <tr key={`D2-${fi}-${d.id}`} className={claseDeLaFilaDelPlan("D") || undefined}>
                            <td style={{ borderLeft: `4px solid ${colorFor(u.driver)}`, fontWeight: 700, whiteSpace: "nowrap" }}>{numeroDeParada(k)}{etiquetaDeLaFila}{pinDeLaParada(k)}</td>
                            <td className="ordno">{facturaDeLaParada(d)}{iconoDeReprogramar(d)}</td>
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
                      const llegada = textoDeLaLlegada(eta, medida, d.delivery_lat == null || d.delivery_lng == null ? "sin_pin" : routeSinHora[u.key]?.[d.id] ?? "sin_base", lang === "es");
                      // Three levels of detail, by where you tap:
                      //   the invoice → open the order itself (the ID until D-408)
                      //   the row  → isolate this stop on the map, with its route
                      //   outside  → back to the driver's whole day
                      const resaltadaOrden = ordenesResaltadas.has(d.id);
                      return (
                        <tr
                          key={d.id}
                          // Sin verde de entregada (D-691, Roberto: «Dont turn the rows green when a delivery is delivered»): la etapa ya lo dice.
                          // Aislar una parada sigue pintándola con su fondo.
                          className={`clickable${claseDeGrupo(f)}${claseDeSoltar}`}
                          data-fila-arrastrable={seArrastra ? "parada" : undefined} {...arrastre} {...soltar}
                          style={{ ...(resaltadaOrden ? { background: "var(--accent-soft)" } : resaltada ? { background: "var(--amber-soft)", outline: "2px solid var(--amber)", outlineOffset: -2 } : {}), ...(marcadas.has(d.id) ? { boxShadow: "inset 4px 0 0 var(--accent)" } : {}), ...(esLaArrastrada ? { opacity: 0.5 } : {}) }}
                          data-recien-movida={resaltada ? "" : undefined}
                          data-entrega={etiquetaDeLaFila}
                          // Stop here: without this the click also reaches the card's "tap outside" handler, which would clear the
                          // highlight right after it is set. Un clic en la fila solo RESALTA; marcar es la casilla.
                          onClick={(e) => { e.stopPropagation(); if (esControlDeLaFila(e.target as Element)) return; setOrdenesResaltadas((s) => alternaResaltada(s, [d.id])); }}
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
                            {numeroDeParada(k)}{etiquetaDeLaFila}{pinDeLaParada(k)}
                          </td>
                          {/* La factura, subrayada: abre la orden (D-408); debajo, el ID (D-456; D-444 había dejado solo el ID); y
                              «carga 1 de 2» si es una carga de una orden partida (D-452). */}
                          <td className="ordno">{facturaDeLaParada(d)}{iconoDeReprogramar(d)}{etiquetaDeLaCarga(d)}</td>
                          {celdaDeCuenta}
                          {/* Cada celda por su CLAVE, en el orden de la persona (D-410). Las cinco de siempre se pintan a su
                              manera; las que vienen de Órdenes (D-376), con la celda de Órdenes. */}
                          {colsParadas.map((c) => celdaDeParada(c, d, {
                            tipo: "D",
                            llegada: (
                              <td data-llegada={llegada.falta ? "falta" : "hora"} style={llegada.falta ? ESTILO_SIN_LLEGADA : { fontWeight: 600, color: late ? "var(--red)" : undefined }} title={late ? t("ETA is after the delivery window", "La llegada es después de la ventana") : llegada.titulo}>
                                {llegada.texto}{late ? " ⚠️" : ""}
                              </td>
                            ),
                          }))}
                          {/* Reordering and moving are edits, not "show me this" — they must not also hijack the map. */}
                          <td className="celda-acciones" onClick={(e) => e.stopPropagation()}>
                            <div className="acciones-de-parada">
                              {flechas}{pasar}{acciones && botonesDeCarga(d, capacity)}
                              {acciones && (() => {
                                // Antes de recoger: la ✕ de siempre. En el camión NUNCA desasigna: pide el regreso a tienda (migración 311).
                                const accion = accionDeLaParadaEnRutas(d);
                                if (accion === "quitar") return <button className="btn btn-danger btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} onClick={() => unassign(d.id)} title={t("Unassign", "Quitar asignación")}>✕</button>;
                                return (
                                  <>
                                    {accion === "cancelar-regreso" && (
                                      <span data-regreso-pendiente style={{ display: "inline-block", background: "var(--amber-soft)", color: "var(--amber)", fontWeight: 700, fontSize: 12, padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap" }}
                                        title={t(`Waiting for ${d.assigned_driver ?? "the driver"} to leave it at the store`, `Esperando que ${d.assigned_driver ?? "el chofer"} la deje en la tienda`)}>
                                        ↩ {t("Return to store", "Regresar a tienda")}
                                      </span>
                                    )}
                                    {accion === "cancelar-regreso"
                                      ? <button data-accion-regreso="cancelar" className="btn btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} onClick={() => void cancelarRegresoATienda(d)}>{t("Cancel return", "Cancelar regreso")}</button>
                                      : <button data-accion-regreso="pedir" className="btn btn-amber btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} onClick={() => void pedirRegresoATienda(d)}>↩ {t("Return to store", "Regresar a tienda")}</button>}
                                  </>
                                );
                              })()}
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
      {!soloLectura && tab === "routes" && seleccionMarcada.length > 0 && recuadroDeReparto()}
      </div>
      </div>

      {/* Sin la tarjeta «🎨 Colores de chofer» (D-526). El dueño, 2026-10-11: «remove this driver colors». Los colores siguen
          (los guardados en `settings.driver_colors` y, si no hay, `fallbackDriverColor`); solo se quita la tarjeta. */}

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
        max={maxFechaDeEntrega()}
        min={minFechaDeEntrega()}
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
