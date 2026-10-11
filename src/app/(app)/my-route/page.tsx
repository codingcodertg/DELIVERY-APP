"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AvisoSoloCiudad } from "@/components/AvisoSoloCiudad";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { captureLocationSplit } from "@/lib/geo";
import { accionParada, escrituraRecogida, extraEntrega } from "@/lib/one-tap-stop";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { AccionesDeParada } from "@/components/AccionesDeParada";
import { marcasDeParadas } from "@/lib/acciones-parada";
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
import { OrderModal } from "@/components/OrderModalLazy";
import { fmtDate, fmtWindows, orderLabel, shiftDateISO, storeTag, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";
import { facturasDeLaOrden } from "@/lib/agregar-material";
import { cargaDe, etiquetaDeCarga, hermanasDe } from "@/lib/cargas-partidas";
import { useChoferDeLaRuta } from "@/lib/ruta-de-un-chofer";
import { rutaDeSoloLectura } from "@/lib/vista-de-chofer";

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
// ============================================================

const DEFAULT_CAPACITY = 12;

export default function MyRoutePage() {
  const { me, deliveries, events, settings, ready, setStage, updateDelivery, notify } = useData();
  const { t, lang } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // Un solo disparo por toque: mientras la escritura va, el botón queda deshabilitado. Guarda
  // el id y no un booleano para que se vea cuál es la parada que está guardándose.
  const [guardando, setGuardando] = useState<string | null>(null);

  // De QUIÉN es la ruta (D-502). La pestaña «Chofer» del admin monta esta misma página dentro de `<RutaDeUnChofer>` con el
  // chofer elegido; sin ese contexto —el chofer en su teléfono— es `me` y no cambia nada. Mirando la de otro, nada se puede
  // pulsar en su nombre (`rutaDeSoloLectura`): los botones se ven igual, apagados.
  const ajeno = useChoferDeLaRuta();
  const chofer = ajeno ?? me;
  const soloLectura = rutaDeSoloLectura(me, chofer);
  const driverName = chofer?.full_name ?? "";

  // CADA DÍA ES APARTE (D-331): hoy son las paradas de hoy. Lo suyo atrasado sigue siendo suyo y sigue a un toque,
  // pero se ve APARTE (`verAtrasadas`), no mezclado en la secuencia del día. Qué entra lo decide `paradasDelChofer`.
  const [verAtrasadas, setVerAtrasadas] = useState(false);
  // D-469: el chofer mira su ruta de ayer, hoy o mañana. El dueño, 2026-10-04: «que los conductores puedan ver ayer, hoy y
  // mañana… en donde salen mis rutas». `dia` es un desfase (−1, 0, 1) y no una fecha, para que a medianoche «hoy» siga siendo hoy.
  const [desfase, setDesfase] = useState<-1 | 0 | 1>(0);
  const dia = shiftDateISO(todayISO(), desfase);
  const atrasadas = useMemo(() => (me ? paradasDelChofer(deliveries, driverName, todayISO(), "atrasadas") : []), [deliveries, me, driverName]);
  const stops = useMemo(() => {
    if (!me) return [];
    return routeOrder(paradasDelChofer(deliveries, driverName, dia, verAtrasadas ? "atrasadas" : "dia"));
  }, [deliveries, me, driverName, verAtrasadas, dia]);

  // La capacidad de su camión: la misma que usa quien despacha, para la misma lista y la misma cuenta.
  const capacidad = settings.driver_capacity?.[driverName] ?? settings.default_truck_capacity ?? DEFAULT_CAPACITY;
  // La misma ruta que ve quien despacha, como UNA lista (D-443: sin viajes) de recogidas y entregas, leída como P1, P2…
  // D1, D2… (D-334). Solo lectura. Con un plan PUBLICADO y la ruta tal como el plan la dejó, mandan las paradas y
  // etiquetas del plan —las mismas que enseña la tarjeta de arriba—; si alguien la tocó después, lo guardado, y se dice
  // (D-335). Una sola lectura, compartida.
  const planPublicado = usePlanPublicadoDelChofer(dia, ajeno?.id ?? null);
  const lectura = useMemo(() => lecturaDeLaRuta(stops, capacidad, verAtrasadas ? null : planPublicado?.paradas ?? null), [stops, capacidad, planPublicado, verAtrasadas]);
  // La cuenta de pallets de cada parada, la misma del Gestor: «+4 = 4» (D-444; hasta ahí, la operación entera).
  const cuenta = useMemo(() => cuentaDePallets(lectura.filas.map((f) => f.cambio), capacidad), [lectura, capacidad]);
  const dDe = lectura.etiquetaDe;
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
  // Saltadas y rechazadas (D-487) salen del historial: una saltada cede el turno, una rechazada no es «siguiente».
  const marcas = useMemo(() => marcasDeParadas(events, todayISO()), [events]);
  const next = siguienteParada(stops, marcas);

  // Los botones de cada parada (D-487): qué sale lo decide `accionesDeParada`, dentro del componente.
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
        <span className="hint">{fmtDate(dia)}</span>
      </div>
      <div className="viewtoggle" data-dia-de-mi-ruta style={{ marginBottom: 8 }}>
        {([[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")], [1, t("Tomorrow", "Mañana")]] as const).map(([d, rotulo]) => (
          <button key={d} className={`vt${desfase === d && !verAtrasadas ? " on" : ""}`} onClick={() => { setVerAtrasadas(false); setDesfase(d); }}>{rotulo}</button>
        ))}
      </div>
      {/* **Puesto al día por D-514:** el mapa del Gestor ya está EN esta pantalla, más abajo, en lugar del mapa propio que
          D-506 dejó aquí («MIRA EL MAPA SIGUE IGUAL»). Este enlace queda para la vista entera, y se llama por lo que abre.

          «🗺 El mapa de mi ruta» (D-506): el MISMO mapa del Gestor de Rutas —panel, paradas, Cuadrícula y Horario— acotado a
          SUS rutas, en `/my-route/mapa`. De aquí no se quita nada: allí solo se mira, y lo que cierra una parada sigue
          estando solo aquí.

          D-508: también sale al mirar la ruta de OTRO (la pestaña «Chofer» del admin, D-502), y entonces lleva SU id.
          D-506 lo escondía ahí para que no abriera el mapa de quien mira, y el efecto fue que el admin —que es quien
          revisa esa pestaña— no veía el mapa nuevo por ninguna parte: «aun miro el mismo mapa en drivers». Quién puede
          abrir el de otro lo decide `choferDelMapa` en la propia pantalla del mapa, no este enlace. */}
      {(
        <div style={{ marginBottom: 8 }}>
          <Link className="btn btn-ghost btn-sm" data-mapa-de-mi-ruta href={ajeno ? `/my-route/mapa?chofer=${ajeno.id}` : "/my-route/mapa"}>
            {/* D-514: el mapa ya está aquí abajo. Este enlace abre la vista ENTERA del Gestor —panel, cuadrícula y
                horario—, y se llama por lo que abre: «Mapa de mi ruta» al lado de un mapa no dice qué hay detrás. */}
            🗓 {t("Full route view", "Ver la ruta completa")}
          </Link>
        </div>
      )}

      {/* El orden planeado por el motor, si hay un plan publicado de hoy (D-324). Solo informa: lo que se
          hace sigue saliendo de las órdenes asignadas, abajo. */}
      {verAtrasadas ? (
        <div className="hint" style={{ marginBottom: 8 }}>
          <b>{t("Viewing your overdue stops only", "Viendo solo tus paradas expiradas")}</b>{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => setVerAtrasadas(false)}>{t("Back to today", "Volver a hoy")}</button>
        </div>
      ) : atrasadas.length > 0 && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {t(`${atrasadas.length} overdue stop(s) from earlier days — not part of today.`, `${atrasadas.length} parada(s) expiradas de días anteriores — no son de hoy.`)}{" "}
          <button className="btn btn-ghost btn-sm" onClick={() => setVerAtrasadas(true)}>{t("View them", "Verlas")}</button>
        </div>
      )}

      {!verAtrasadas && <MiPlanPublicado plan={planPublicado} nombreDeOrden={(id, ref) => nombraLaOrden(deliveries, id ?? ref, lang === "es")} />}

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
            <div className="card" style={{ marginBottom: 12, borderColor: "var(--accent)", borderWidth: 2 }}>
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
              {/* La salida cuando no se puede entregar: se descarga en una tienda del grupo y el
                  pedido vuelve a la lista (D-224). En su propia fila y no junto a «Entregar»:
                  es la excepción, no la acción normal, y el pulgar del chofer va al botón verde.
                  El control se enseña solo si procede —pedido en el camión y suyo—, así que aquí
                  no se repite ninguna condición. */}
              {/* Saltar y Rechazado (D-487), con su marca si la tiene. El verde de arriba sigue siendo la acción principal. */}
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
              medida en su color, la vuelta a la base en punteado, las casitas, el camión y la leyenda. Tocar una parada abre
              su orden, como antes. */}
          <div style={{ marginBottom: 12 }}>
            <SoloMisRutas chofer={driverName}>
              <SoloLectura>
                {/* `ordenDelPunto`: una entrega ya hecha llega como `__hecha__<id>`; sin quitarlo, dejaría de abrirse. */}
                <SoloElMapa dia={dia} alto={300} alPulsarParada={(id) => { const orden = ordenDelPunto(id); const d = orden ? stops.find((x) => x.id === orden) : undefined; if (d) setOpen(d); }}>
                  <RoutesPage />
                </SoloElMapa>
              </SoloLectura>
            </SoloMisRutas>
          </div>

          {/* The whole day in order, so they can plan ahead: ONE list (D-443, no truckloads), recogidas y entregas en el
              orden en que se hacen, cada una con su cuenta de pallets. El título ya no traza la ruta al tocarlo (D-514): el
              mapa de arriba es el del Gestor y la trae siempre. */}
          {(() => {
            return (
              <div className="card" style={{ marginBottom: 12 }}>
                <div
                  className="section-label"
                  style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  <span>🚚 {t("Your route", "Tu ruta")} · {numeroDePallets(cuenta.totales.palletsMovidos)} {t("pallets moved", "pallets movidos")}</span>
                </div>
                <div className="bar-list">
                  {/* Cada recogida va donde está en la lista: al principio, o a media ruta si el camión recarga. Informa; no se pulsa. */}
                  {lectura.filas.map((f, fi) => {
                    const c = cuenta.paradas[fi];
                    const lineaDeCuenta = (
                      <span className="hint" data-cuenta style={{ display: "block", fontVariantNumeric: "tabular-nums" }}>
                        {c.sinConteo ? "~" : ""}{textoDeLaCuenta(c)}
                        {c.exceso > 0 && <b style={{ color: "var(--red)" }}> {textoDelExceso(c, capacidad, lang === "es")}</b>}
                      </span>
                    );
                    if (f.tipo === "P" || f.otraCarga) return (
                      <div key={`${f.tipo}-${fi}-${f.etiqueta}`} className="acct-row" style={{ alignItems: "flex-start" }}>
                        <b style={{ flex: "0 0 auto", minWidth: 26 }}>{f.etiqueta}</b>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 700, display: "block" }}>{f.tipo === "P" ? t("Pick up at", "Recoger en") : t("Deliver another load of", "Entregar otra carga de")} {f.tipo === "P" ? (f.lugar ?? t("(no store on the order)", "(la orden no dice la tienda)")) : ""}</span>
                          {f.tipo === "P" ? (
                            // Cada carga de la recogida, con sus botones (D-487): «Recogido» y «Saltar», orden por orden.
                            f.ordenes.map((id) => {
                              const d = stops.find((x) => x.id === id);
                              return (
                                <span key={id} data-recogida={id} style={{ display: "block", marginTop: 6 }}>
                                  <span className="hint" style={{ display: "block" }}>
                                    {d && (d.stage === "picked_up" || d.stage === "delivered") ? "✓ " : ""}{nombraLaOrden(deliveries, id, lang === "es")}
                                    {d && d.stage !== "ready" && d.stage !== "picked_up" && d.stage !== "delivered" ? ` · ${t("not ready yet", "aún no está lista")}` : ""}
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
                    const d = stops.find((x) => x.id === f.orden);
                    if (!d) return null;
                    const n = dDe.get(d.id) ?? f.etiqueta;
                    const isDone = d.stage === "delivered";
                    const isNext = next?.id === d.id;
                    // La fila ya no es un solo botón: lleva los suyos (D-487), y un botón dentro de otro no existe en HTML.
                    // Tocar el número o el texto sigue abriendo la orden.
                    return (
                      <div
                        key={d.id}
                        className="acct-row"
                        data-entrega={d.id}
                        style={{
                          alignItems: "flex-start",
                          background: isNext ? "var(--accent-soft)" : undefined,
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
                          {accionesDe(d, "D")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
