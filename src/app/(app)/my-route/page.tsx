"use client";

import { useMemo, useState } from "react";
import { AvisoSoloCiudad } from "@/components/AvisoSoloCiudad";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { captureLocationSplit } from "@/lib/geo";
import { accionParada, escrituraRecogida, extraEntrega } from "@/lib/one-tap-stop";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { AccionesDeParada, BotonDeLlegada } from "@/components/AccionesDeParada";
import { llegadaDeLaParada, llegadasDeParadas, marcasDeParadas } from "@/lib/acciones-parada";
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
// ============================================================

const DEFAULT_CAPACITY = 12;

/** El título de una sección: un renglón entero que se toca con el pulgar. */
const TITULO_DE_SECCION: React.CSSProperties = { cursor: "pointer", fontWeight: 800, fontSize: 15, minHeight: 44, display: "flex", alignItems: "center", gap: 6 };

export default function MyRoutePage() {
  const { me, deliveries, events, settings, ready, setStage, updateDelivery, notify } = useData();
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // Un solo disparo por toque: mientras la escritura va, el botón queda deshabilitado. Guarda
  // el id y no un booleano para que se vea cuál es la parada que está guardándose.
  const [guardando, setGuardando] = useState<string | null>(null);
  // Las dos secciones de la lista (D-520): lo pendiente abierto, lo hecho plegado. Las dos se pliegan a mano.
  const [abierta, setAbierta] = useState<Record<SeccionDeMiRuta, boolean>>({ pendientes: true, hechas: false });

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
      ? <span className="numero-de-parada" data-numero-de-parada={n} title={titulo} style={{ background: colorDelChofer, opacity: hecha ? 0.55 : 1 }}>{hecha ? "✓" : n}</span>
      : <span className="numero-de-parada sigue" data-sigue-la-parada={n} title={titulo} style={{ color: colorDelChofer }} />;
  };
  // «Carga 1 de 2» (D-452, 157): una orden que no cabía en el camión son dos órdenes hermanas, cada una su parada; aquí
  // solo se dice cuál es esta. Se marca con el botón de siempre, por carga.
  const etiquetaDeLaCarga = (d: Delivery) => { const c = cargaDe(d, hermanasDe(deliveries, d)); return c ? <span className="hint" data-carga> · {etiquetaDeCarga(c, lang === "es")}</span> : null; };

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
    // La ruta de otro (D-502): sus botones están apagados, y esto es la segunda puerta por si alguno no lo estuviera.
    if (soloLectura) return;
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
  // The one stop that matters right now: first in sequence still to finish. La MISMA función decide a quién va el
  // aviso «en camino» en el servidor (D-416): lo que el chofer ve como siguiente es lo que se avisa.
  // Las rechazadas (D-487) salen del historial y no son «siguiente». Las saltadas ya no existen (D-520).
  const marcas = useMemo(() => marcasDeParadas(events), [events]);
  const next = siguienteParada(stops, marcas);
  // «📍 Llegué» (D-520): las llegadas de hoy, por orden, y la de cada parada. Una llegada es de la PARADA —la tienda, la
  // dirección—: se pulsa una vez y vale para todas sus órdenes en ese tramo (`llegadaDeLaParada`).
  const llegadas = useMemo(() => llegadasDeParadas(events, todayISO()), [events]);
  const llegadaDe = (n: number | undefined) => {
    const p = n != null ? numeradas.paradas[n - 1] : undefined;
    return p ? llegadaDeLaParada(p, etapaDe, marcas, llegadas) : null;
  };
  // La parada de «Siguiente parada»: la de su recogida mientras no se ha recogido, la de su entrega cuando va en el camión.
  const paradaDeLaSiguiente = next ? numeradas.paradas.find((p) => p.tipo === (next.stage === "picked_up" ? "D" : "P") && p.ordenes.includes(next.id)) : undefined;

  // Los botones de cada orden de una parada (D-487; D-520): qué sale lo decide `accionesDeParada`, dentro del componente.
  const accionesDe = (d: Delivery, tipo: "P" | "D", sinPrincipal = false) => (
    <AccionesDeParada pedido={d} tipo={tipo} marca={marcas.get(d.id)} guardando={guardando === d.id} cerrar={(x) => void cerrarParada(x)} sinPrincipal={sinPrincipal} soloLectura={soloLectura} />
  );


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
  // Etiqueta y acción del botón salen de aquí: una sola decisión, no dos que se puedan
  // desincronizar. `open` (etapa que no es ready ni picked_up) solo abre el pedido.
  const accionSiguiente = accionParada(next?.stage, settings, next?.photos);
  const hechas = new Set(secciones.hechas);

  /** Una fila de la lista, la pinte la sección que la pinte. «Llegué» va en la fila que lleva el número de su parada, y
   *  solo entre las pendientes: en las hechas no queda nada a lo que llegar. */
  const fila = (fi: number) => {
    const f = lectura.filas[fi];
    const c = cuenta.paradas[fi];
    const llegada = secciones.conNumero[fi] && !hechas.has(fi) ? llegadaDe(numeradas.deFila[fi]) : null;
    const lineaDeCuenta = (
      <span className="hint" data-cuenta style={{ display: "block", fontVariantNumeric: "tabular-nums" }}>
        {c.sinConteo ? "~" : ""}{textoDeLaCuenta(c)}
        {c.exceso > 0 && <b style={{ color: "var(--red)" }}> {textoDelExceso(c, capacidad, lang === "es")}</b>}
      </span>
    );
    if (f.tipo === "P" || f.otraCarga) return (
      <div key={`${f.tipo}-${fi}-${f.etiqueta}`} className="acct-row" data-fila-de-ruta={fi} style={{ alignItems: "flex-start" }}>
        <span style={{ flex: "0 0 auto", minWidth: 26, display: "inline-flex", justifyContent: "center" }}>{numeroDeParada(fi)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, display: "block" }}>{f.tipo === "P" ? t("Pick up at", "Recoger en") : t("Deliver another load of", "Entregar otra carga de")} {f.tipo === "P" ? (f.lugar ?? t("(no store on the order)", "(la orden no dice la tienda)")) : ""}</span>
          <BotonDeLlegada llegada={llegada} soloLectura={soloLectura} />
          {f.tipo === "P" ? (
            // Cada carga de la recogida, con su «Recogido» (D-487), orden por orden. Si el almacén aún no la tiene lista, el
            // botón sale apagado y dice por qué (D-520).
            f.ordenes.map((id) => {
              const d = porId.get(id);
              return (
                <span key={id} data-recogida={id} style={{ display: "block", marginTop: 6 }}>
                  <span className="hint" style={{ display: "block" }}>
                    {d && (d.stage === "picked_up" || d.stage === "delivered") ? "✓ " : ""}{nombraLaOrden(deliveries, id, lang === "es")}
                  </span>
                  {d && accionesDe(d, "P")}
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
    const isNext = next?.id === d.id;
    // La fila ya no es un solo botón: lleva los suyos (D-487), y un botón dentro de otro no existe en HTML.
    // Tocar el número o el texto sigue abriendo la orden.
    return (
      <div
        key={d.id}
        className="acct-row"
        data-entrega={d.id}
        data-fila-de-ruta={fi}
        style={{
          alignItems: "flex-start",
          background: isNext ? "var(--accent-soft)" : undefined,
        }}
      >
        {/* El círculo del Gestor (D-515): número de parada en el color del chofer, no «D1» en un círculo pintado
            por estado. Lo que el estado decía sigue: la entregada, con ✓; la siguiente, por el fondo de la fila. */}
        <span style={{ flex: "0 0 auto", minWidth: 26, display: "inline-flex", justifyContent: "center" }}>{numeroDeParada(fi, isDone)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <button onClick={() => setOpen(d)} style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit" }}>
          <span style={{ fontWeight: 700, display: "block" }}>
            {facturasDeLaOrden(d).join(", ") || `#${orderLabel(d)}`}{etiquetaDeLaCarga(d)}
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
          <BotonDeLlegada llegada={llegada} soloLectura={soloLectura} />
          {accionesDe(d, "D")}
        </span>
      </div>
    );
  };

  /** Una sección plegable: «Pendientes (N)» o «Entregadas (N)». N son las paradas —los números— que hay en ella. */
  const seccion = (s: SeccionDeMiRuta, titulo: string, filas: readonly number[], vacia: string) => (
    <details data-seccion={s} open={abierta[s]} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setAbierta((a) => (a[s] === o ? a : { ...a, [s]: o })); }}
      style={{ marginTop: 6 }}>
      <summary data-titulo-de-seccion={s} style={TITULO_DE_SECCION}>{titulo} ({secciones.paradas[s]})</summary>
      {filas.length === 0
        ? <div className="hint" style={{ padding: "4px 0 8px" }}>{vacia}</div>
        : <div className="bar-list">{filas.map(fila)}</div>}
    </details>
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
          dice en qué y desde cuándo, con «▶ Seguir». */}
      <PausaDelChofer driverId={chofer?.id} soloLectura={soloLectura} />

      {/* El orden planeado por el motor, si hay un plan publicado de hoy (D-324). Solo informa: lo que se
          hace sigue saliendo de las órdenes asignadas, abajo. */}
      <MiPlanPublicado plan={planPublicado} nombreDeOrden={(id, ref) => nombraLaOrden(deliveries, id ?? ref, lang === "es")} />

      {/* La ruta ya no es la que el plan publicó (D-341): se le dice al chofer, y en qué. Va FUERA de la lista, para que
          salga también si le quitaron todas las paradas. Qué cambió lo decide `cambiosTrasPublicar`; aquí solo se pinta.
          Una orden quitada que ya no está a su vista se nombra por el principio de su referencia (`nombraLaOrden`). */}
      {lectura.cambios && (
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
                {cuenta.totales.paradas} {t("stops", "paradas")} · {t("peak load", "carga máxima")} {numeroDePallets(cuenta.totales.cargaMaxima)}/{capacidad}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden", marginTop: 8 }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--green)" }} />
            </div>
          </div>

          {/* The next stop, given its own card. Everything else on this screen
              is context; this is the thing to act on. */}
          {next && (
            <div className="card" data-siguiente-parada style={{ marginBottom: 12, borderColor: "var(--accent)", borderWidth: 2 }}>
              <div className="section-label" style={{ marginTop: 0 }}>
                {t("Next stop", "Siguiente parada")} · {stops.indexOf(next) + 1}/{stops.length}
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {facturasDeLaOrden(next).join(", ") || `#${orderLabel(next)}`}{etiquetaDeLaCarga(next)}
              </div>
              <div style={{ marginTop: 2 }}>{next.delivery_address || t("(no address)", "(sin dirección)")}</div>
              <AvisoSoloCiudad orden={next} />
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
                  disabled={soloLectura || guardando === next.id}
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
              {/* «📍 Llegué» de su parada (D-520): la tienda mientras no la ha recogido, el cliente cuando va en el camión. */}
              <BotonDeLlegada llegada={paradaDeLaSiguiente ? llegadaDeLaParada(paradaDeLaSiguiente, etapaDe, marcas, llegadas) : null} soloLectura={soloLectura} />
              {/* La salida cuando no se puede entregar: se descarga en una tienda del grupo y el
                  pedido vuelve a la lista (D-224). En su propia fila y no junto a «Entregar»:
                  es la excepción, no la acción normal, y el pulgar del chofer va al botón verde.
                  El control se enseña solo si procede —pedido en el camión y suyo—, así que aquí
                  no se repite ninguna condición. */}
              {/* Rechazado (D-487), con su marca si la tiene. El verde de arriba sigue siendo la acción principal. «Saltar»
                  ya no está (D-520). */}
              {accionesDe(next, next.stage === "picked_up" ? "D" : "P", true)}
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
            {seccion("pendientes", `🕒 ${t("Pending", "Pendientes")}`, secciones.pendientes, t("Nothing left to do on this day.", "No queda nada por hacer este día."))}
            {seccion("hechas", `✓ ${t("Delivered", "Entregadas")}`, secciones.hechas, t("Nothing done yet.", "Aún no hay nada hecho."))}
          </div>
        </>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
