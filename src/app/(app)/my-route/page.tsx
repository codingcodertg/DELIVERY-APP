"use client";

import { useMemo, useState } from "react";
import { AvisoSoloCiudad } from "@/components/AvisoSoloCiudad";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { AccionesDeParada } from "@/components/AccionesDeParada";
import { llegadaDeLaParada, llegadasDeParadas, marcasDeParadas, type LlegadaDeParada } from "@/lib/acciones-parada";
import { llegadaDeLaOrden, llevaBotonDeLlegada, MOSTRAR_SIGUIENTE_PARADA, seRecogeDeUnToque, siguienteDeMiRuta, textoDePosicion } from "@/lib/siguiente-de-mi-ruta";
import { PalletsAlRecoger } from "@/components/PalletsAlRecoger";
import { RecogerSinListo } from "@/components/RecogerSinListo";
import { abreElCuadroSinListo } from "@/lib/recoger-sin-listo-pantalla";
import { idsRecibidasPorAlmacen, pastillaDeEtapa } from "@/lib/recibir";
import { IconoDeFotos } from "@/components/IconoDeFotos";
import { estiloDeParada, FONDO_DE_PARADA } from "@/lib/colores-de-mi-ruta";
import { escrituraRecogida } from "@/lib/one-tap-stop";
import { captureLocationSplit, type GeoStamp } from "@/lib/geo";
import { avisosDeRecogidaSinListo, deshacerRecogida, notaDeRecogidaSinListo } from "@/lib/recogida-del-chofer";
import { recogidaParaElChofer } from "@/lib/recogida-y-ruta-del-dia";
import { seccionesDeMiRuta, type SeccionDeMiRuta } from "@/lib/secciones-de-mi-ruta";
import { PausaDelChofer } from "@/components/PausaDelChofer";
import { IrAlInicio } from "@/components/TabGate";
import { MiPlanPublicado } from "@/components/MiPlanPublicado";
import { routeOrder } from "@/lib/dispatch";
import { paradasDelChofer } from "@/lib/ordenes-del-dia";
import { siguienteParada } from "@/lib/avisos-cliente";
import { lecturaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";
import { cuentaDePallets, numeroDePallets, textoDeLaCuenta, textoDelExceso } from "@/lib/lista-unica";
import { usePlanPublicadoDelChofer } from "@/lib/route-plan/usePlanPublicado";
import { nombraLaOrden } from "@/lib/route-plan/etiqueta";
// El mapa es el del Gestor (D-514): la página del Gestor, montada solo-el-mapa y acotada a este chofer.
import RoutesPage from "@/app/(app)/routes/page";
import { SoloLectura } from "@/lib/gestor/solo-lectura";
import { SoloMisRutas } from "@/lib/gestor/solo-mis-rutas";
import { SoloElMapa } from "@/lib/gestor/solo-el-mapa";
import { ordenDelPunto } from "@/lib/mapa-de-rutas";
import { paradasDeLaRuta, textoDeLaParada } from "@/lib/gestor/paradas-numeradas";
import { colorDeChofer } from "@/lib/map-legend";
import { OrderModal } from "@/components/OrderModalLazy";
import { fmtDate, fmtWindows, orderLabel, shiftDateISO, storeTag, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";
import { facturasDeLaOrden } from "@/lib/agregar-material";
import { cargaDe, etiquetaDeCarga, hermanasDe } from "@/lib/cargas-partidas";
import { useChoferDeLaRuta } from "@/lib/ruta-de-un-chofer";
import { rutaDeSoloLectura } from "@/lib/vista-de-chofer";
import { AvisoDeInspeccion } from "@/components/inspeccion/AvisoDeInspeccion";
import { muestraElPlanEnMiRuta } from "@/lib/barra-de-entregas";

// ============================================================
// "My route" — the driver's read-only copy of what logistics planned.
//
// Deliberately NOT the dispatcher's screen with the controls removed. A
// dispatcher is arranging a whole fleet at a desk; a driver is in a cab with
// one question at a time. So this leads with the NEXT stop, then shows the
// day's sequence to plan ahead, and never offers reordering, reassignment or
// optimisation — those stay logistics' job.
//
// The MAP is the exception, on purpose (D-514): it IS the dispatcher's map, mounted map-only and narrowed to this
// driver, because that is what the owner asked for three times — «ese mismo mapa». The screen stays the driver's.
//
// What it does let them do is finish the work: each stop opens the same order
// screen they already use to pick up and deliver.
//
// D-520 (2026-10-11), lo que el dueño pidió con capturas de «Mi ruta» de Ernesto: fuera «Saltar»; «📍 Llegué» por parada
// y «Recogido» siempre a la vista en las recogidas; la lista en dos secciones, «Pendientes» abierta y «Entregadas»
// plegada; fuera «Ver la ruta completa» y el aviso de paradas vencidas de la cabecera; y «⏸ Registrar parada».
//
// D-527 (2026-10-11): «Recogido» y «Entregado» ya no cierran la parada de un toque: abren la ficha de la orden en ese
// paso (D-218 queda reemplazada en esta pantalla), y «Entregado» abre además la cámara (ya no: D-NEXT). «📍 Llegué» va en la misma fila
// que «Recogido» / «Entregado», y las dos cosas se deshacen. Detalle en `AccionesDeParada` y `recogida-del-chofer.ts`.
//
// D-533 (2026-10-12), **reemplaza en parte a D-527**: «Siguiente parada» sigue la ruta POR PARADAS («next stop 1 of 5 and
// pickup will be one of two»); «Recogido» con la carga lista se hace de un toque, sin abrir la ficha («if he wants to open
// the order just make it possible when pressing the invoice number»); la burbuja del número y la factura abren la orden;
// y cada fila lleva UN botón que cambia, «Llegué» → «Recogido»/«Entregado». Reglas en `siguiente-de-mi-ruta.ts`.
//
// D-547 (2026-10-14), **reemplaza en parte a D-533, D-535 y D-541**: la tarjeta «Siguiente parada» apagada tras
// `MOSTRAR_SIGUIENTE_PARADA` («disable that box for now but have the option to activate it in the future»); la etapa de
// cada orden en su fila («Need driver to see the stage here»); «Recogido» pregunta los pallets antes de recoger
// (`PalletsAlRecoger`); las recogidas en azul claro y las entregas sin tinte; y «📍 Llegué» solo en la primera orden de la
// parada (`llevaBotonDeLlegada`), aunque marca la llegada en todas.
// ============================================================

const DEFAULT_CAPACITY = 12;

/** El título de una sección: un renglón entero que se toca con el pulgar. */


export default function MyRoutePage() {
  const { me, deliveries, events, settings, users, ready, setStage, updateDelivery, pushNotifs, notify } = useData();
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // En qué paso abre la ficha (D-527): «recoger» desde «Recogido», «entregar» (la prueba de entrega) desde «Entregado».
  const [abrirEn, setAbrirEn] = useState<"recoger" | "entregar" | undefined>(undefined);
  // Nota D-NEXT: aquí vivía la cámara que «Entregado» abría sola (D-527) y las fotos que traía para la ficha. Se quitó
  // («no que se lo imponga»): «Entregado» abre la prueba de entrega y el chofer elige allí cómo pone las fotos.
  // Qué lista se ve (D-522): «Pendientes» o «Entregadas», las dos opciones juntas arriba y se elige una. Nace en Pendientes.
  const [listaElegida, setListaElegida] = useState<SeccionDeMiRuta>("pendientes");
  // La orden cuyo «Recogido» espera el número de pallets (D-547): mientras no es `null`, el cuadro está abierto.
  const [palletsDe, setPalletsDe] = useState<Delivery | null>(null);
  // La orden cuyo «Recogido» espera el motivo de recogerla sin «listo» (D-603): mientras no es `null`, el cuadro está abierto.
  const [sinListoDe, setSinListoDe] = useState<Delivery | null>(null);

  // De QUIÉN es la ruta (D-502). La pestaña «Chofer» del admin monta esta misma página dentro de `<RutaDeUnChofer>` con el
  // chofer elegido; sin ese contexto —el chofer en su teléfono— es `me` y no cambia nada. Mirando la de otro, nada se puede
  // pulsar en su nombre (`rutaDeSoloLectura`): los botones se ven igual, apagados.
  const ajeno = useChoferDeLaRuta();
  const chofer = ajeno ?? me;
  const soloLectura = rutaDeSoloLectura(me, chofer);
  const driverName = chofer?.full_name ?? "";

  // CADA DÍA ES APARTE (D-331): hoy son las paradas de hoy.
  // **Reemplazado en parte por D-520:** lo atrasado ya no tiene aviso ni vista aparte en esta pantalla («QUITA ESO DEL
  // OVERVIEW TAMBIEN»). Sigue siendo suyo: lo ve en su pestaña «Chofer», por etapa, y logística en el Gestor y en Órdenes.
  // D-469: el chofer mira su ruta de ayer, hoy o mañana. El dueño, 2026-10-04: «que los conductores puedan ver ayer, hoy y
  // mañana… en donde salen mis rutas». `dia` es un desfase (−1, 0, 1) y no una fecha, para que a medianoche «hoy» siga siendo hoy.
  const [desfase, setDesfase] = useState<-1 | 0 | 1>(0);
  const dia = shiftDateISO(todayISO(), desfase);
  const stops = useMemo(() => {
    if (!me) return [];
    return routeOrder(paradasDelChofer(deliveries, driverName, dia, "dia"));
  }, [deliveries, me, driverName, dia]);
  const porId = useMemo(() => new Map(stops.map((d) => [d.id, d])), [stops]);
  const etapaDe = (id: string) => porId.get(id)?.stage;

  // La capacidad de su camión: la misma que usa quien despacha, para la misma lista y la misma cuenta.
  const capacidad = settings.driver_capacity?.[driverName] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
  // La misma ruta que ve quien despacha, como UNA lista (D-443: sin viajes) de recogidas y entregas, leída como P1, P2…
  // D1, D2… (D-334). Solo lectura. Con un plan PUBLICADO y la ruta tal como el plan la dejó, mandan las paradas y
  // etiquetas del plan —las mismas que enseña la tarjeta de arriba—; si alguien la tocó después, lo guardado, y se dice
  // (D-335). Una sola lectura, compartida.
  const planPublicado = usePlanPublicadoDelChofer(dia, ajeno?.id ?? null);
  // La tarjeta del plan y el aviso de que cambió, para quien mira y no es chofer (D-545): el admin en su pestaña «Chofer».
  const vePlan = muestraElPlanEnMiRuta(me?.role);
  const lectura = useMemo(() => lecturaDeLaRuta(stops, capacidad, planPublicado?.paradas ?? null), [stops, capacidad, planPublicado]);
  // La cuenta de pallets de cada parada, la misma del Gestor: «+4 = 4» (D-444; hasta ahí, la operación entera).
  const cuenta = useMemo(() => cuentaDePallets(lectura.filas.map((f) => f.cambio), capacidad), [lectura, capacidad]);
  // La lista numerada por PARADAS, como el Gestor (D-485 allí; aquí D-515). El dueño: «QUIERO EN EL DRIVER VIEW QUE EN VEZ
  // DE LOS P1 Y D1 SE VEA IGUAL QUE LOGISTIC MANAGER CON NUMEROS EN VES DE ESO». Filas seguidas en el mismo sitio —varias recogidas en
  // la misma tienda, varias entregas a la misma dirección— son UNA parada con UN número: la MISMA función del Gestor, así
  // que la «parada 3» del chofer es la «parada 3» que ve logística.
  const numeradas = useMemo(() => paradasDeLaRuta(lectura.filas, stops), [lectura, stops]);
  // Pendientes y Entregadas (D-520): cada fila en su sección, en el orden de la ruta y con su número de parada.
  const secciones = useMemo(() => seccionesDeMiRuta(lectura.filas, (id) => porId.get(id)?.stage, numeradas.deFila), [lectura, porId, numeradas]);
  // El color del chofer, el mismo que pinta el Gestor en su círculo y en el mapa.
  const colorDelChofer = colorDeChofer(settings.driver_colors, driverName);
  /** El círculo de la fila `fi`: el número en la primera fila de su parada DENTRO de su sección (D-520; antes, en la
   *  primera de la lista entera); en las demás, la raya de que sigue. Una entrega ya hecha lleva ✓ en su círculo, como en
   *  el Gestor. El título dice qué se hace ahí («Parada 1 — recoger P1, P2»). */
  const numeroDeParada = (fi: number, hecha = false) => {
    const n = numeradas.deFila[fi];
    const p = n != null ? numeradas.paradas[n - 1] : undefined;
    if (!p) return null;
    const titulo = textoDeLaParada(p, [], t);
    return secciones.conNumero[fi]
      ? <span className="numero-de-parada" data-numero-de-parada={n} title={titulo} style={{ background: colorDelChofer, opacity: hecha ? 0.55 : 1 }}>{n}</span>
      : <span className="numero-de-parada sigue" data-sigue-la-parada={n} title={titulo} style={{ color: colorDelChofer }} />;
  };
  // «Carga 1 de 2» (D-452, 157): una orden que no cabía en el camión son dos órdenes hermanas, cada una su parada; aquí
  // solo se dice cuál es esta. Se marca con el botón de siempre, por carga.
  const etiquetaDeLaCarga = (d: Delivery) => { const c = cargaDe(d, hermanasDe(deliveries, d)); return c ? <span className="hint" data-carga> · {etiquetaDeCarga(c, lang === "es")}</span> : null; };

  /** Abre la ficha de una orden, en un paso o sin paso (tocar el texto de una parada o el mapa). */
  const abrirOrden = (d: Delivery, paso?: "recoger" | "entregar") => { setAbrirEn(paso); setOpen(d); };
  const cerrarFicha = () => { setOpen(null); setAbrirEn(undefined); };

  /**
   * «🚚 Recogido» y «✅ Entregado» de una parada (D-527; antes D-218).
   *
   * **Reemplaza a D-218 en esta pantalla.** D-218 los hizo cerrar la parada de un toque, sin abrir la ficha. El dueño,
   * 2026-10-11: «when i press the pickup in the driver view the order should also popo up as in the delivery part» y «when
   * you pres deliverd it should open the camera so you can add the proof of delikvery for the driver». Ahora:
   *  - **Recogido** abre la ficha en la recogida (`abrirEn="recoger"`): si está lista, con «🚚 Recoger» a la vista; si el
   *    almacén aún no la marcó lista, con «Recoger de todos modos» y su nota ya abierta.
   *  - **Entregado** abre la ficha en la prueba de entrega (`abrirEn="entregar"`). Nota D-NEXT: ya NO abre la cámara del
   *    teléfono por su cuenta; en la prueba están «📸 Varias fotos», «📷 Una foto» y «🖼 Galería», y el chofer elige. La
   *    prueba pide la foto si la oficina la exige (`podSinCumplir`); si no, deja confirmar sin foto.
   */
  const cerrarParada = (d: Delivery, accion: "recoger" | "entregar") => {
    // La ruta de otro (D-502): sus botones están apagados, y esto es la segunda puerta por si alguno no lo estuviera.
    if (soloLectura) return;
    // D-533: con la carga lista, «Recogido» recoge AQUÍ, sin abrir la ficha. Sin lista, la ficha con su nota.
    // D-547: antes pregunta los pallets («it's not asking them how many pallets are they loading»), con los de la orden
    // ya puestos; al confirmar, `recogerDeUnToque(d, n)`.
    if (accion === "recoger" && seRecogeDeUnToque(d.stage)) { setPalletsDe(d); return; }
    // D-603: sin «listo» (aprobada / preparando), el cuadro pequeño del motivo; la ficha se abre DESPUÉS de recoger.
    if (accion === "recoger" && abreElCuadroSinListo(d.stage)) { setSinListoDe(d); return; }
    abrirOrden(d, accion);
  };

  /**
   * «🚚 Recogido» de un toque (D-533; como era en D-218): la misma escritura que la ficha (`escrituraRecogida`: nota, GPS
   * sin bloquear, claim y recuento). El dueño, 2026-10-12: «if you press pickup it opens up the order instead of doing the
   * action». Sin GPS a tiempo, se guarda la hora y la posición se parchea después, en silencio.
   */
  const [recogiendo, setRecogiendo] = useState<string | null>(null);
  // D-547: `pallets` es lo que el chofer confirmó en el cuadro; va a `actual_pallets` en la MISMA escritura que el salto a
  // `picked_up` (el guard de la 169 no mira columnas en ese salto del chofer; una escritura aparte en la misma etapa, sí).
  const recogerDeUnToque = async (d: Delivery, pallets: number) => {
    if (soloLectura || recogiendo) return;
    setRecogiendo(d.id);
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    const escritura = escrituraRecogida({ pedido: d, me, gps, t, pallets });
    const ok = await setStage(d.id, "picked_up", escritura.note, escritura.extra);
    setRecogiendo(null);
    if (!ok) return;
    notify(t("Picked up — on the truck", "Recogida — va en el camión"));
    if (!gps) void adjuntarTardio(d.id, eventual);
  };
  /**
   * «🚚 Recogido» sin «listo», desde el cuadro del motivo (D-603): la MISMA escritura que «Recoger de todos modos» de la
   * ficha (D-527): la nota con su prefijo, el evento `picked_up`, el GPS sin bloquear, y el aviso en la campana al almacén
   * de esa tienda y a logística. Al terminar, la ficha, para ver los detalles (Ernesto: «After they confirm pickup, now it
   * can open up the order to see the details»).
   */
  const recogerSinListoDeUnToque = async (d: Delivery, nota: string) => {
    if (soloLectura || recogiendo || !me) return;
    setRecogiendo(d.id);
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    const escritura = escrituraRecogida({ pedido: d, me, gps, t });
    const ok = await setStage(d.id, "picked_up", notaDeRecogidaSinListo(nota, escritura.note, lang), escritura.extra);
    setRecogiendo(null);
    if (!ok) return;
    setSinListoDe(null);
    if (!gps) void adjuntarTardio(d.id, eventual);
    void pushNotifs(avisosDeRecogidaSinListo({
      users, actorId: me.id, pedido: d, tiendas: settings.stores ?? [],
      etiqueta: `#${orderLabel(d)}`, nota, chofer: me.full_name,
    }));
    notify(t("Picked up — the warehouse and logistics were notified", "Recogida — se avisó al almacén y a logística"));
    abrirOrden(d);
  };
  const adjuntarTardio = async (id: string, pendiente: Promise<GeoStamp | null>) => {
    const gps = await pendiente;
    if (!gps) return;
    await updateDelivery(id, { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at }, { quiet: true });
  };

  const done = stops.filter((d) => d.stage === "delivered").length;
  // The one stop that matters right now: first in sequence still to finish. La MISMA función decide a quién va el
  // aviso «en camino» en el servidor (D-416): lo que el chofer ve como siguiente es lo que se avisa.
  // Las rechazadas (D-487) salen del historial y no son «siguiente». Las saltadas ya no existen (D-520).
  const marcas = useMemo(() => marcasDeParadas(events), [events]);
  // D-533: la siguiente sigue la ruta POR PARADAS (las dos recogidas de la tienda, y luego las entregas), no orden por
  // orden. Si la lectura no tiene filas (no debería), la regla de antes.
  const sig = siguienteDeMiRuta(lectura.filas, numeradas, etapaDe, marcas);
  const next = sig ? (porId.get(sig.id) ?? null) : siguienteParada(stops, marcas);
  const tipoDeLaSiguiente: "P" | "D" = sig ? sig.tipo : next?.stage === "picked_up" ? "D" : "P";
  /** ¿Esta orden, en este tramo, es la siguiente? Pinta el fondo de su fila. */
  const esLaSiguiente = (id: string, tipo: "P" | "D") => (sig ? sig.id === id && sig.tipo === tipo : next?.id === id);
  // «📍 Llegué» (D-520): las llegadas de hoy, por orden, y la de cada parada. Una llegada es de la PARADA —la tienda, la
  // dirección—: se pulsa una vez y vale para todas sus órdenes en ese tramo (`llegadaDeLaParada`).
  const llegadas = useMemo(() => llegadasDeParadas(events, todayISO()), [events]);
  const llegadaDe = (n: number | undefined) => {
    const p = n != null ? numeradas.paradas[n - 1] : undefined;
    return p ? llegadaDeLaParada(p, etapaDe, marcas, llegadas) : null;
  };
  // La parada de «Siguiente parada»: la de su recogida mientras no se ha recogido, la de su entrega cuando va en el camión.
  const paradaDeLaSiguiente = sig ? numeradas.paradas[sig.parada - 1] : next ? numeradas.paradas.find((p) => p.tipo === tipoDeLaSiguiente && p.ordenes.includes(next.id)) : undefined;

  // Los botones de cada orden de una parada (D-487; D-520): qué sale lo decide `accionesDeParada`, dentro del componente.
  // D-527: con «📍 Llegué» de su parada al principio de la fila si esta orden lo lleva, y con «↩ Deshacer recogido» en
  // la recogida ya hecha. El deshacer se calcula con el chofer DE LA RUTA (`chofer`), no con quien mira: así la pestaña
  // «Chofer» del admin lo pinta igual que lo ve él, y apagado (D-502).
  // D-547: `conBotonDeLlegada` dice si ESTA fila pinta «📍 Llegué» (solo la primera orden de la parada); `llegada` sigue
  // llegando a todas, porque es la que esconde «Recogido»/«Entregado» hasta llegar y los enseña después en cada una.
  const accionesDe = (d: Delivery, tipo: "P" | "D", llegada: LlegadaDeParada | null, conBotonDeLlegada = true) => (
    <AccionesDeParada pedido={d} tipo={tipo} marca={marcas.get(d.id)} cerrar={cerrarParada} llegada={llegada}
      conBotonDeLlegada={conBotonDeLlegada}
      deshacer={tipo === "P" ? deshacerRecogida({ pedido: d, yo: chofer, eventos: events, rechazada: marcas.has(d.id) }) : null}
      soloLectura={soloLectura} guardando={recogiendo === d.id} />
  );
  /** La llegada de la parada en la fila de CADA orden de su tramo (D-533): un toque la marca en todas, y en todas el botón
   *  pasa a «Recogido»/«Entregado». **Nota D-547:** el botón «Llegué» en sí, solo en la primera (`llevaBotonDeLlegada`,
   *  como en D-527). El dueño: «since is the 6th stop with that thats enough». */
  const llegadaSiEsDe = (llegada: LlegadaDeParada | null, id: string) => llegadaDeLaOrden(llegada, id);
  /** La etapa de la orden en su fila (D-547, «Need driver to see the stage here»): la MISMA pastilla de Órdenes y de la
   *  ficha (`pastillaDeEtapa`: «Ready», «Programmed»…, y «Received» si la recibió el almacén, D-409). */
  const recibidas = useMemo(() => idsRecibidasPorAlmacen(events), [events]);
  const pastillaDe = (d: Delivery) => {
    const p = pastillaDeEtapa(d, recibidas, lang, me);
    return <span className="sema" data-etapa-en-la-fila={d.stage} style={{ background: p.color, color: "#fff", marginLeft: 6, verticalAlign: "middle" }}>{p.texto}<IconoDeFotos p={p} /></span>;
  };


  const navigateTo = (d: Delivery) => {
    const dest = d.delivery_lat != null && d.delivery_lng != null
      ? `${d.delivery_lat},${d.delivery_lng}`
      : (d.delivery_address || "").trim();
    if (!dest) return;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`, "_blank", "noopener");
  };

  if (!me) return null;
  // Quien no es chofer va a su pantalla de inicio en vez de quedarse con «No disponible para tu rol» (D-520, `IrAlInicio`).
  if (!canDeliver(me) || me.role === "warehouse") return <IrAlInicio />;
  if (!ready) return <div className="empty">{t("Loading…", "Cargando…")}</div>;

  const pct = stops.length ? Math.round((done / stops.length) * 100) : 0;

  /** Una fila de la lista, la pinte la sección que la pinte. «Llegué» va en la fila de la primera orden de su parada que
   *  está en ese tramo, junto a su «Recogido» o su «Entregado» (D-527; en D-520, en la fila del número y en un renglón
   *  propio). Una fila hecha nunca lo lleva: lo recogido o entregado ya no está en el tramo. */
  /** La cabecera de una fila de recogida (D-584): «Recoger en» y la tienda resaltada, o el nombre y la dirección si no es
   *  tienda de Ajustes. Se decide por la primera orden de la parada: todas salen del mismo sitio. */
  const recogidaEnLaFila = (ordenes: readonly string[], lugar: string | null) => {
    const d = porId.get(ordenes[0]);
    const r = d ? recogidaParaElChofer(d, settings.stores ?? []) : null;
    if (r?.enTienda) return (
      <span style={{ fontWeight: 700, display: "block" }}>
        {t("Pick up at", "Recoger en")}{" "}
        {/* Mismo blanco que la pastilla de etapa, sin otro color a pelo (techo de inline-colors): hereda de `.sema`. */}
        <span className="sema" data-recogida-en-tienda={r.tienda} style={{ background: colorDelChofer, color: "white", verticalAlign: "middle" }}>🏬 {t("Store", "Tienda")} · {r.tienda}</span>
      </span>
    );
    const nombre = r?.nombre ?? lugar;
    return (
      <span style={{ display: "block" }}>
        <span style={{ fontWeight: 700, display: "block" }}>{t("Pick up at", "Recoger en")} {nombre ?? t("(no store on the order)", "(la orden no dice la tienda)")}</span>
        {r && <span className="hint" data-direccion-de-recogida style={{ display: "block" }}>{r.direccion ?? t("(no address)", "(sin dirección)")}</span>}
      </span>
    );
  };
  const fila = (fi: number) => {
    const f = lectura.filas[fi];
    const c = cuenta.paradas[fi];
    const llegada = llegadaDe(numeradas.deFila[fi]);
    const lineaDeCuenta = (
      <span className="hint" data-cuenta style={{ display: "block", fontVariantNumeric: "tabular-nums" }}>
        {c.sinConteo ? "~" : ""}{textoDeLaCuenta(c)}
        {c.exceso > 0 && <b style={{ color: "var(--red)" }}> {textoDelExceso(c, capacidad, lang === "es")}</b>}
      </span>
    );
    // D-533: la burbuja del número abre la orden (la primera de la parada que sigue en su tramo), y la factura, la suya.
    const primeraDeLaFila = f.tipo === "P" ? (f.ordenes.map((id) => porId.get(id)).find((d) => d && d.stage !== "picked_up" && d.stage !== "delivered") ?? porId.get(f.ordenes[0])) : porId.get(f.orden);
    const burbuja = (hecha = false) => (
      <button type="button" data-abre-la-parada={numeradas.deFila[fi]} onClick={() => primeraDeLaFila && abrirOrden(primeraDeLaFila)}
        style={{ flex: "0 0 auto", minWidth: 26, display: "inline-flex", justifyContent: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        {numeroDeParada(fi, hecha)}
      </button>
    );
    if (f.tipo === "P" || f.otraCarga) return (
      <div key={`${f.tipo}-${fi}-${f.etiqueta}`} className="acct-row" data-fila-de-ruta={fi} data-tipo-de-fila={f.tipo}
        style={{ alignItems: "flex-start", ...estiloDeParada(f.tipo, f.tipo === "P" && f.ordenes.some((id) => esLaSiguiente(id, "P"))) }}>
        {burbuja()}
        <span style={{ flex: 1, minWidth: 0 }}>
          {/* D-584: en una tienda de Ajustes, la TIENDA resaltada y sin dirección (el dueño: «When pickup is at a store, no need
              to put address»); si no es tienda, su nombre y su dirección, como la entrega enseña la suya. */}
          {f.tipo === "P" ? recogidaEnLaFila(f.ordenes, f.lugar) : <span style={{ fontWeight: 700, display: "block" }}>{t("Deliver another load of", "Entregar otra carga de")}</span>}
          {f.tipo === "P" ? (
            // Cada carga de la recogida, con su «Recogido» (D-487), orden por orden. D-527: «Recogido» abre la ficha también
            // cuando el almacén aún no la tiene lista (allí se recoge de todos modos, con nota); ya recogida, «↩ Deshacer».
            f.ordenes.map((id) => {
              const d = porId.get(id);
              return (
                <span key={id} data-recogida={id} style={{ display: "block", marginTop: 6 }}>
                  <button type="button" data-abre-la-orden={id} className="hint" disabled={!d} onClick={() => d && abrirOrden(d)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" }}>
                    {d && (d.stage === "picked_up" || d.stage === "delivered") ? "✓ " : ""}{nombraLaOrden(deliveries, id, lang === "es")}
                    {d && pastillaDe(d)}
                  </button>
                  {d && accionesDe(d, "P", llegadaSiEsDe(llegada, id), llevaBotonDeLlegada(llegada, id))}
                </span>
              );
            })
          ) : (
            <span className="hint" style={{ display: "block" }}>{nombraLaOrden(deliveries, f.orden, lang === "es")}</span>
          )}
          {lineaDeCuenta}
        </span>
      </div>
    );
    const d = porId.get(f.orden);
    if (!d) return null;
    const isDone = d.stage === "delivered";
    const isNext = esLaSiguiente(d.id, "D");
    // La fila ya no es un solo botón: lleva los suyos (D-487), y un botón dentro de otro no existe en HTML.
    // Tocar el número o el texto sigue abriendo la orden.
    return (
      <div
        key={d.id}
        className="acct-row"
        data-entrega={d.id}
        data-fila-de-ruta={fi}
        data-tipo-de-fila="D"
        style={{ alignItems: "flex-start", ...estiloDeParada("D", isNext) }}
      >
        {/* El círculo del Gestor (D-515): número de parada en el color del chofer, no «D1» en un círculo pintado
            por estado. Lo que el estado decía sigue: la entregada, con ✓; la siguiente, por el fondo de la fila. */}
        {burbuja(isDone)}
        <span style={{ flex: 1, minWidth: 0 }}>
          <button onClick={() => setOpen(d)} style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit" }}>
          <span style={{ fontWeight: 700, display: "block" }}>
            {facturasDeLaOrden(d).join(", ") || `#${orderLabel(d)}`}{etiquetaDeLaCarga(d)}{pastillaDe(d)}
          </span>
          <span className="hint" style={{ display: "block" }}>
            {d.delivery_address || t("(no address)", "(sin dirección)")}
          </span>
          <AvisoSoloCiudad orden={d} />
          <span className="hint" style={{ display: "block" }}>
            {fmtWindows(d.delivery_windows)}
            {d.order_type ? ` · ${d.order_type}` : ""}
          </span>
          {lineaDeCuenta}
          </button>
          {accionesDe(d, "D", llegadaSiEsDe(llegada, d.id), llevaBotonDeLlegada(llegada, d.id))}
        </span>
      </div>
    );
  };

  /** La lista de una de las dos (D-522): solo se ve la elegida arriba; la otra va pintada y escondida (`hidden`). */
  const seccion = (s: SeccionDeMiRuta, filas: readonly number[], vacia: string) => (
    <div data-seccion={s} hidden={listaElegida !== s} style={{ marginTop: 6 }}>
      {filas.length === 0
        ? <div className="hint" style={{ padding: "4px 0 8px" }}>{vacia}</div>
        : <div className="bar-list">{filas.map(fila)}</div>}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h2>🧭 {t("My route", "Mi ruta")}</h2>
        <span className="hint">{fmtDate(dia)}</span>
      </div>
      {/* D-518: «Haz tu inspección pre-viaje» mientras hoy no haya una. Avisa, no bloquea. Solo en su propia ruta. */}
      {!ajeno && <AvisoDeInspeccion />}
      <div className="viewtoggle" data-dia-de-mi-ruta style={{ marginBottom: 8 }}>
        {([[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")], [1, t("Tomorrow", "Mañana")]] as const).map(([d, rotulo]) => (
          <button key={d} className={`vt${desfase === d ? " on" : ""}`} onClick={() => setDesfase(d)}>{rotulo}</button>
        ))}
      </div>
      {/* **Reemplazado por D-520:** aquí estaba «🗓 Ver la ruta completa» (D-506/D-508/D-514), el enlace a `/my-route/mapa`.
          El dueño, con la captura de la cabecera: «FULL ROUTE VIEW PLEASE QUITALO DEL DRIVER VIEW». La página sigue
          existiendo y se abre por su dirección; ya no la enlaza nadie.
          Y debajo, el aviso «N parada(s) expiradas de días anteriores — no son de hoy · Verlas» (D-331): «QUITA ESO DEL
          OVERVIEW TAMBIEN». */}

      {/* «⏸ Registrar parada» (D-520): baño, gasolina (con su recibo), comida, tráfico. Mientras está parado, la tarjeta
          dice en qué y desde cuándo, con «▶ Seguir». Desde D-541 y D-547 se eligen solo gasolina, comida y otro. */}
      <PausaDelChofer driverId={chofer?.id} soloLectura={soloLectura} />

      {/* El orden planeado por el motor, si hay un plan publicado de hoy (D-324). Solo informa: lo que se
          hace sigue saliendo de las órdenes asignadas, abajo. */}
      {/* **D-545: ya no para el chofer.** Ni esta tarjeta ni el aviso amarillo de abajo se pintan cuando quien mira es
          un chofer (`muestraElPlanEnMiRuta`). El dueño, 2026-10-13: «remove that yellow message is not require for the
          driver» y «also take plan order of the day for driver». Siguen en la pestaña «🚚 Chofer» del admin (D-502), que
          monta esta misma página. El plan se sigue leyendo igual: de él salen las etiquetas de la lista (D-335). */}
      {vePlan && <MiPlanPublicado plan={planPublicado} nombreDeOrden={(id, ref) => nombraLaOrden(deliveries, id ?? ref, lang === "es")} />}

      {/* La ruta ya no es la que el plan publicó (D-341): se le dice al chofer, y en qué. Va FUERA de la lista, para que
          salga también si le quitaron todas las paradas. Qué cambió lo decide `cambiosTrasPublicar`; aquí solo se pinta.
          Una orden quitada que ya no está a su vista se nombra por el principio de su referencia (`nombraLaOrden`).
          Desde D-545, solo para quien no es chofer (arriba). */}
      {vePlan && lectura.cambios && (
        <div className="banner warn" role="status">
          <b>⚠ {t("Your route changed after the plan was published.", "Tu ruta cambió desde que se publicó el plan.")}</b>
          {lectura.cambios.anadidas.length > 0 && <div>➕ {t("Added", "Añadidas")}: {lectura.cambios.anadidas.map((id) => nombraLaOrden(deliveries, id, lang === "es")).join(" · ")}</div>}
          {lectura.cambios.quitadas.length > 0 && <div>➖ {t("Removed", "Quitadas")}: {lectura.cambios.quitadas.map((id) => nombraLaOrden(deliveries, id, lang === "es")).join(" · ")}</div>}
          {lectura.cambios.ordenCambiado && <div>↕ {t("The order of your stops changed.", "Cambió el orden de tus paradas.")}</div>}
          <div className="hint">{t("The list below is the current route; the planned-order card above is the plan as it was published.", "La lista de abajo es la ruta de ahora; la tarjeta del orden planeado, arriba, es el plan tal como se publicó.")}</div>
        </div>
      )}

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
                {numeradas.paradas.length} {t("stops", "paradas")} · {t("peak load", "carga máxima")} {numeroDePallets(cuenta.totales.cargaMaxima)}/{capacidad}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden", marginTop: 8 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--green)" }} />
            </div>
          </div>

          {/* The next stop, given its own card. Everything else on this screen
              is context; this is the thing to act on.
              **D-547: apagada** tras `MOSTRAR_SIGUIENTE_PARADA` (false). El dueño, 2026-10-14: «disable that box for now
              but have the option to activate it in the future». El código sigue entero; encenderla es esa constante. Con
              ella apagada, «🧭 Navegar» y «Dejar en tienda» quedan en la ficha de la orden (se abre tocando su factura). */}
          {MOSTRAR_SIGUIENTE_PARADA && next && (
            <div className="card" data-siguiente-parada data-tipo-de-fila={tipoDeLaSiguiente} style={{ marginBottom: 12, borderColor: "var(--accent)", borderWidth: 2, background: FONDO_DE_PARADA[tipoDeLaSiguiente] }}>
              <div className="section-label" style={{ marginTop: 0 }}>
                {t("Next stop", "Siguiente parada")} · {sig ? `${sig.parada}/${sig.totalParadas}` : `${stops.indexOf(next) + 1}/${stops.length}`}
                {sig && textoDePosicion(sig, t) ? <span data-posicion-en-la-parada> · {textoDePosicion(sig, t)}</span> : null}
              </div>
              {/* Tocar la orden la abre, como en las filas de la lista. Antes (D-218) la abría «📋 Ver orden», el botón verde
                  en las etapas que no se recogían ni entregaban; ese botón ya no existe (D-527) y la tarjeta no puede
                  quedarse sin forma de abrir el pedido. */}
              <button data-abre-la-orden onClick={() => abrirOrden(next)} style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit" }}>
                <span style={{ display: "block", fontWeight: 800, fontSize: 18 }}>
                  {facturasDeLaOrden(next).join(", ") || `#${orderLabel(next)}`}{etiquetaDeLaCarga(next)}
                </span>
                <span style={{ display: "block", marginTop: 2 }}>{next.delivery_address || t("(no address)", "(sin dirección)")}</span>
                <AvisoSoloCiudad orden={next} />
                <span className="hint" style={{ display: "block", marginTop: 4 }}>
                  {fmtWindows(next.delivery_windows)}
                  {next.actual_pallets ?? next.est_pallets ? ` · ${next.actual_pallets ?? next.est_pallets} ${t("pallets", "pallets")}` : ""}
                  {next.store ? ` · ${storeTag(next.store)}` : ""}
                </span>
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onClick={() => navigateTo(next)}>
                  🧭 {t("Navigate", "Navegar")}
                </button>
              </div>
              {/* Los botones de la parada, los MISMOS de la fila de la lista (D-527): «📍 Llegué» de su parada —la tienda
                  mientras no la ha recogido, el cliente cuando va en el camión— al principio, y en la misma fila «🚚 Recogido»
                  o «✅ Entregado · ⛔ Rechazado». Antes el verde iba junto a «Navegar» y «Llegué» en un renglón aparte. */}
              {accionesDe(next, tipoDeLaSiguiente, paradaDeLaSiguiente ? llegadaDeLaOrden(llegadaDeLaParada(paradaDeLaSiguiente, etapaDe, marcas, llegadas), next.id) : null)}
              {/* La salida cuando no se puede entregar: se descarga en una tienda del grupo y el
                  pedido vuelve a la lista (D-224). En su propia fila y no junto a «Entregar»:
                  es la excepción, no la acción normal, y el pulgar del chofer va al botón verde.
                  El control se enseña solo si procede —pedido en el camión y suyo—, así que aquí
                  no se repite ninguna condición. */}
              {me && (
                <div style={{ display: "flex", marginTop: 8 }}>
                  <LeaveAtStore pedido={next} me={me} disabled={soloLectura} style={{ flex: 1, justifyContent: "center" }} />
                </div>
              )}
            </div>
          )}

          {/* EL MAPA DEL GESTOR, no uno parecido (D-514). El dueño, tres veces: «quiero que el chofer mire el mapa con sus
              rutas asi como el logistic manager ese mismo mapa», y después de D-506: «MIRA EL MAPA SIGUE IGUAL». D-506 había
              dejado aquí el mapa propio de esta pantalla —sin la línea de la ruta, que solo se trazaba al tocar el título, y
              con las paradas pintadas por estado— y puesto el del Gestor en otra página, detrás de un botón.
              Ahora es la MISMA tarjeta del Gestor (`routes/page.tsx`), montada solo-el-mapa y acotada a este chofer: su línea
              medida en su color, la vuelta a la base en punteado, las casitas y el camión. Sin leyenda desde D-520 («delete
              the lEGEND ON THE MAP of the app»). Tocar una parada abre su orden, como antes. */}
          <div style={{ marginBottom: 12 }}>
            <SoloMisRutas chofer={driverName}>
              <SoloLectura>
                {/* `ordenDelPunto`: una entrega ya hecha llega como `__hecha__<id>`; sin quitarlo, dejaría de abrirse. */}
                <SoloElMapa dia={dia} alto={300} alPulsarParada={(id) => { const orden = ordenDelPunto(id); const d = orden ? porId.get(orden) : undefined; if (d) setOpen(d); }}>
                  <RoutesPage />
                </SoloElMapa>
              </SoloLectura>
            </SoloMisRutas>
          </div>

          {/* The whole day in order, so they can plan ahead: ONE list (D-443, no truckloads), recogidas y entregas en el
              orden en que se hacen, cada una con su cuenta de pallets. El título ya no traza la ruta al tocarlo (D-514): el
              mapa de arriba es el del Gestor y la trae siempre.
              D-520: en dos secciones. El dueño: «delivered orders go to do DELIVERED DROPDOWN TO SEE ALL THE DONE ORDERS BY
              DEFAULT WILL BE CLOSE AND THE PENDIGN ORDERS AS WELL BU TPENDING ON THE DRIVER VIEW». */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-label" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>🚚 {t("Your route", "Tu ruta")} · {numeroDePallets(cuenta.totales.palletsMovidos)} {t("pallets moved", "pallets movidos")}</span>
            </div>
            {/* D-522: las dos juntas arriba y se elige una. El dueño, 2026-10-11: «en driver dejaste delivered abajo pero quiero
                que vayan juntos arriba y qeu solo se elija en el driver view». N son las paradas de cada una. */}
            <div role="tablist" data-selector-de-lista style={{ display: "flex", gap: 6, margin: "6px 0 4px" }}>
              {(["pendientes", "hechas"] as const).map((s) => (
                <button key={s} type="button" role="tab" aria-selected={listaElegida === s} data-titulo-de-seccion={s}
                  className={"btn btn-sm " + (listaElegida === s ? "btn-primary" : "btn-ghost")}
                  style={{ flex: 1, minHeight: 44, justifyContent: "center", fontWeight: 800 }} onClick={() => setListaElegida(s)}>
                  {s === "pendientes" ? `🕒 ${t("Pending", "Pendientes")}` : `✓ ${t("Delivered", "Entregadas")}`} ({secciones.paradas[s]})
                </button>
              ))}
            </div>
            {seccion("pendientes", secciones.pendientes, t("Nothing left to do on this day.", "No queda nada por hacer este día."))}
            {seccion("hechas", secciones.hechas, t("Nothing done yet.", "Aún no hay nada hecho."))}
          </div>
        </>
      )}

      {/* «¿Cuántos pallets cargas?» (D-547): sale con «Recogido» de una carga lista; al confirmar, recoge con ese número. */}
      {sinListoDe && <RecogerSinListo pedido={sinListoDe} ocupado={recogiendo === sinListoDe.id} onCancelar={() => setSinListoDe(null)}
        onConfirmar={(nota) => void recogerSinListoDeUnToque(sinListoDe, nota)} />}
      {palletsDe && <PalletsAlRecoger pedido={palletsDe} onCancelar={() => setPalletsDe(null)}
        onConfirmar={(n) => { const d = palletsDe; setPalletsDe(null); void recogerDeUnToque(d, n); }} />}
      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={cerrarFicha} abrirEn={abrirEn} />}
    </>
  );
}
