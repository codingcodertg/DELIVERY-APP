"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtDate } from "@/lib/utils";
import { formateadorDeFecha } from "@/lib/formateador";
import { cargaSnapdom } from "@/components/CapturaDeAyuda";
import type { MapLine, MapPoint } from "@/components/LeafletMap";
import type { FuenteDeHora, InformeDelDia, MotivoSinHora, ParadaDelInforme } from "@/lib/reportes-choferes/dia";
import {
  aCsv, difDe, estimadoContraReal, tarjetasDeChoferes, tiempoPorParada, visitasDe, COBERTURA_MINIMA, MINIMO_DE_CASOS, MINIMO_DE_DIAS,
  type ClaveDeMedida, type EstimadoContraReal, type GrupoDeTiempo, type Medida,
} from "@/lib/reportes-choferes/metricas";
import { DIAS_MAX_DE_REPORTES, rangoDeReportes } from "@/lib/reportes-choferes/permiso";
import { COLOR_RECORRIDO_REAL, BORDE_RECORRIDO_REAL, ANCHO_RECORRIDO_REAL, ANCHO_PLAN_CON_RECORRIDO } from "@/lib/recorrido-contra-plan";

/**
 * «Reportes de choferes» (D-NEXT) — en el Panel, debajo de «Puntualidad por chofer», con el rango del Panel.
 *
 * El dueño, 2026-11-06: «now that we have more information, I want better reports and metrics for drivers: scheduled
 * route vs real route, estimated time vs real time, time per stop».
 *
 * Cuatro reportes sobre los mismos días (`GET /api/driver-reports`, que comprueba el permiso): ruta planeada contra
 * real, estimado contra real, tiempo por parada y la tarjeta de cada chofer. Cada número dice de dónde sale (camión,
 * teléfono o toque) y cuánto dato tiene detrás; con poco dato se enseña en gris y no se compara a nadie con él.
 * Un día se abre AQUÍ, en una tarjeta con su mapa: no se sale a otra pantalla.
 */

const LeafletMap = dynamic(() => import("@/components/LeafletMap").then((m) => m.LeafletMap), { ssr: false });
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export type RespuestaDeReportes = {
  ok?: boolean; error?: string; zona: string; desde: string; hasta: string;
  choferes: { id: string; nombre: string }[];
  dias: InformeDelDia[];
  mapa: { trazos: [number, number][][]; plan: [number, number][] } | null;
  tiendas: { name: string; lat: number; lng: number }[];
  avisos: { rastroCortado: boolean; camionesPendientes: number; hayTracksolid: boolean };
};
type Pestana = "ruta" | "tiempo" | "parada" | "tarjeta";
type T = (en: string, es: string) => string;

const COLOR_PLAN = "#2563eb", COLOR_RECOGIDA = "#b45309", COLOR_ENTREGA = "#1d4ed8", COLOR_SIN_HORA = "#8a94a0";

async function pide(url: string): Promise<RespuestaDeReportes> {
  const res = await fetch(url);
  const b = (await res.json().catch(() => ({}))) as RespuestaDeReportes;
  if (!res.ok || !b.ok) throw new Error(String(b.error ?? res.status));
  return b;
}

function descargaCsv(nombre: string, cabeceras: string[], filas: (string | number | null | undefined)[][]) {
  // El BOM, para que Excel lea los acentos.
  const blob = new Blob(["﻿" + aCsv(cabeceras, filas)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const hhmm = (min: number | null | undefined) => (min == null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`);
const dura = (min: number | null | undefined) => (min == null ? "—" : min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min * 10) / 10}m`);
const signo = (n: number | null) => (n == null ? "—" : n === 0 ? "0" : `${n > 0 ? "+" : "−"}${Math.abs(n)}`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function textos(t: T) {
  const fuente = (f: FuenteDeHora | null): string =>
    f === "camion" ? t("Truck GPS", "GPS del camión") : f === "telefono" ? t("Phone GPS", "GPS del teléfono")
      : f === "toque_llegada" ? t("Driver's “arrived” tap", "Toque «llegué» del chofer") : f === "toque_cierre" ? t("Driver's closing tap", "Toque de cierre del chofer") : "—";
  const motivo = (m: MotivoSinHora | null): string =>
    m === "la_marco_otra_persona" ? t("marked by someone else", "la marcó otra persona") : m === "toco_lejos" ? t("tapped away from the stop", "tocó lejos de la parada")
      : m === "no_paro_ahi" ? t("GPS never stopped there", "el GPS no paró ahí") : m === "sin_rastro" ? t("no GPS that day", "sin GPS ese día")
        : m === "sin_punto" ? t("stop has no map point", "la parada no tiene punto") : m === "pendiente" ? t("not done", "sin hacer") : "";
  const rastro = (d: InformeDelDia): string =>
    d.rastro.fuente === "camion" ? `${t("Truck", "Camión")}${d.rastro.camion ? ` ${d.rastro.camion}` : ""}` : d.rastro.fuente === "telefono" ? `${t("Phone GPS", "GPS del teléfono")}${d.rastro.escaso ? t(" (sparse)", " (escaso)") : ""}` : t("No GPS — taps only", "Sin GPS — solo toques");
  const clase = (c: string): string =>
    c === "recogida_tienda" ? t("Store pickup", "Recogida en tienda") : c === "entrega_cliente" ? t("Customer delivery", "Entrega a cliente")
      : c === "entrega_tienda" ? t("Store drop-off", "Entrega en tienda") : c === "recogida_otro" ? t("Pickup elsewhere", "Recogida en otro sitio") : c;
  return { fuente, motivo, rastro, clase };
}

export function ReportesDeChoferes({ desde, hasta, carga = pide }: { desde: string; hasta: string; carga?: (url: string) => Promise<RespuestaDeReportes> }) {
  const { t } = usePrefs();
  const tx = useMemo(() => textos(t), [t]);
  const [chofer, setChofer] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<RespuestaDeReportes | null>(null);
  const [pestana, setPestana] = useState<Pestana>("ruta");
  const [grupo, setGrupo] = useState<GrupoDeTiempo>("clase");
  const [abierto, setAbierto] = useState<{ fecha: string; choferId: string } | null>(null);
  useEffect(() => { setR(null); setError(null); setAbierto(null); }, [desde, hasta]);

  const rangoOk = rangoDeReportes(desde, hasta);
  const calcula = async () => {
    setOcupado(true); setError(null);
    try { setR(await carga(`/api/driver-reports?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`)); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : t("Network error.", "Error de red.")); }
    setOcupado(false);
  };

  const zona = r?.zona ?? "America/Chicago";
  const hora = useMemo(() => {
    const f = formateadorDeFecha("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false });
    return (ms: number | null | undefined) => (ms == null ? "—" : f.format(ms));
  }, [zona]);
  const minutoLocal = useMemo(() => (ms: number) => { const [h, m] = hora(ms).split(":").map(Number); return h * 60 + m; }, [hora]);

  const dias = useMemo(() => (r?.dias ?? []).filter((d) => !chofer || d.choferId === chofer), [r, chofer]);
  const paradas = useMemo(() => dias.flatMap((d) => d.paradas.map((p) => ({ ...p, fecha: d.fecha, chofer: d.chofer }))), [dias]);
  const visitas = useMemo(() => visitasDe(dias), [dias]);
  const tarjetas = useMemo(() => tarjetasDeChoferes(dias, minutoLocal), [dias, minutoLocal]);
  const estPrimera = useMemo(() => estimadoContraReal(paradas.filter((p) => p.hecha), "primera"), [paradas]);
  const estPlan = useMemo(() => estimadoContraReal(paradas.filter((p) => p.hecha), "plan"), [paradas]);
  const filasDeTiempo = useMemo(() => tiempoPorParada(visitas, grupo), [visitas, grupo]);

  const conRastro = dias.filter((d) => d.rastro.fuente), conCamion = dias.filter((d) => d.rastro.fuente === "camion");
  const nombreCsv = (que: string) => `driver-reports-${que}-${desde}_${hasta}.csv`;

  const exporta = () => {
    if (pestana === "ruta") descargaCsv(nombreCsv("route"), ["Date", "Driver", "GPS source", "Truck", "GPS points", "Stops", "Stops done", "Stops with real time", "Compared for order", "Out of order", "Plan miles", "Plan drive min", "Plan legs estimated", "Real miles (stop to stop)", "Real drive min (stop to stop)", "Real miles (day)", "First departure", "Stopped off-route min", "Stopped off-route times"],
      dias.map((d) => [d.fecha, d.chofer, d.rastro.fuente ?? "none", d.rastro.camion, d.rastro.puntos, d.paradas.length, d.paradas.filter((p) => p.hecha).length, d.paradas.filter((p) => p.llegada != null).length, d.orden.comparadas, d.orden.fueraDeOrden, d.plan.millas, d.plan.minutos, `${d.plan.tramosEstimados}/${d.plan.tramos}`, d.real.millasEntreParadas, d.real.minutosManejando, d.real.millasDelDia, d.real.primeraSalida ? hora(d.real.primeraSalida) : null, d.parado.minutos, d.parado.veces]));
    else if (pestana === "tiempo") descargaCsv(nombreCsv("estimated-vs-real"), ["Date", "Driver", "Plan position", "Real position", "Type", "Order", "Place", "First estimate", "Current plan", "Actual arrival", "Actual departure", "Source", "Diff vs first (min)", "Diff vs plan (min)", "Out of order", "Counted", "Why not"],
      paradas.map((p) => { const d = difDe(p, "plan"); return [p.fecha, p.chofer, p.puestoPlan, p.puestoReal, p.tipo === "P" ? "Pickup" : "Delivery", p.codigo, p.lugar, p.primeraEta != null ? hhmm(p.primeraEta) : null, p.eta != null ? hhmm(p.eta) : null, p.llegada ? hora(p.llegada) : null, p.salida ? hora(p.salida) : null, p.fuente ?? p.motivo, p.difPrimera, p.difPlan, p.fueraDeOrden ? "yes" : "no", "min" in d ? "yes" : "no", "fuera" in d ? d.fuera : null]; }));
    else if (pestana === "parada") descargaCsv(nombreCsv("time-per-stop"), ["Date", "Driver", "Stop type", "Place", "Store", "Customer", "Arrived", "Left", "Minutes", "Planner assumes (min)", "Orders", "Source", "Measured start to end", "Outlier"],
      visitas.map((v) => [v.fecha, v.chofer, v.clase, v.lugar, v.tienda, v.cliente, hora(v.llegada), hora(v.salida), v.minutos, v.minPlaneados, v.ordenes, v.fuente, v.truncada ? "no" : "yes", v.atipica ? "yes" : "no"]));
    else {
      const m = (x: Medida) => [x.valor, x.n, x.de, x.fiable ? "yes" : "no", x.puesto];
      descargaCsv(nombreCsv("scorecard"), ["Driver", "Days worked", "Days with GPS", "Days with truck GPS", "Stops", "Stops done", "Miles",
        ...(["On time vs window %", "Within 30 min of plan %", "Min per customer delivery", "Min per store pickup", "Taps at the stop %", "Out of order %", "Stopped off-route min/day", "First departure (min of day)", "Miles/day"].flatMap((c) => [c, `${c} — n`, `${c} — of`, `${c} — enough data`, `${c} — rank`]))],
        tarjetas.map((x) => [x.chofer, x.dias, x.diasConRastro, x.diasConCamion, x.paradas, x.paradasHechas, x.millas, ...(["aTiempo", "dentroDe30", "minPorEntrega", "minPorRecogida", "toquesEnLaParada", "fueraDeOrden", "paradoMinPorDia", "primeraSalidaMin", "millasPorDia"] as ClaveDeMedida[]).flatMap((k) => m(x.medidas[k]))]));
    }
  };

  const celda = (x: Medida, texto: (v: number) => string) => (
    <td style={x.fiable ? undefined : { color: "var(--gray)" }} title={x.fiable ? undefined : t(`Thin data: ${x.n} of ${x.de}. Shown, but not used to compare drivers.`, `Poco dato: ${x.n} de ${x.de}. Se enseña, pero no se usa para comparar choferes.`)}>
      <span style={{ fontWeight: x.fiable ? 700 : 400 }}>{x.valor == null ? "—" : texto(x.valor)}</span>
      {x.puesto != null && <span className="count-tag" style={{ marginLeft: 4 }}>#{x.puesto}</span>}
      <span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>{x.n}/{x.de}{!x.fiable && x.n > 0 ? ` · ${t("thin", "poco dato")}` : ""}</span>
    </td>
  );

  const resumenEst = (titulo: string, e: EstimadoContraReal) => (
    <div className="card" style={{ margin: 0, padding: 12, flex: "1 1 320px" }} data-estimado={titulo}>
      <b>{titulo}</b>
      {e.n === 0 ? <div className="hint" style={{ margin: "6px 0 0" }}>{t("No stops to compare.", "No hay paradas que comparar.")}</div> : (
        <div style={{ marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
          <div>{t("Within", "Dentro de")} 15 min: <b>{pct(e.dentroDe15, e.n)}</b> · 30 min: <b>{pct(e.dentroDe30, e.n)}</b> · 60 min: <b>{pct(e.dentroDe60, e.n)}</b></div>
          <div>{t("Late", "Tarde")}: {e.tarde}/{e.n} · {t("average lateness", "retraso medio")} <b>{dura(e.retrasoMedioMin)}</b> · {t("median difference", "diferencia mediana")} {signo(e.medianaMin)} min</div>
        </div>
      )}
      <div className="hint" style={{ margin: "6px 0 0" }}>
        {t(`Counted ${e.n} of ${e.paradas} done stops (real time from GPS ${e.porRastro}, from the driver's tap ${e.porToque}). Left out: done out of order ${e.fuera.fueraDeOrden}, no real time ${e.fuera.sinHoraReal}, no estimate ${e.fuera.sinEstimado}, estimate written after the stop ${e.fuera.estimadoDespues}.`,
          `Cuentan ${e.n} de ${e.paradas} paradas hechas (hora real por GPS ${e.porRastro}, por el toque del chofer ${e.porToque}). Fuera: hechas fuera de orden ${e.fuera.fueraDeOrden}, sin hora real ${e.fuera.sinHoraReal}, sin estimación ${e.fuera.sinEstimado}, estimación escrita después de la parada ${e.fuera.estimadoDespues}.`)}
      </div>
    </div>
  );

  const PESTANAS: [Pestana, string][] = [
    ["ruta", t("Planned vs real route", "Ruta planeada vs real")], ["tiempo", t("Estimated vs real time", "Tiempo estimado vs real")],
    ["parada", t("Time per stop", "Tiempo por parada")], ["tarjeta", t("Driver scorecard", "Tarjeta del chofer")],
  ];

  return (
    <div className="card" data-reportes-de-choferes>
      <h2>🚚 {t("Driver reports", "Reportes de choferes")}</h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
        {t("Planned route vs the route really driven, estimated vs real times, and time at each stop — from the truck's GPS tracker when the driver had one that day, the phone's GPS otherwise, and the driver's own taps as a last resort. Every number says where it comes from and how much data is behind it.",
          "La ruta planeada contra la que se manejó de verdad, las horas estimadas contra las reales, y el tiempo en cada parada — del rastreador GPS del camión cuando el chofer llevó uno ese día, del GPS del teléfono si no, y de los toques del propio chofer como último recurso. Cada número dice de dónde sale y cuánto dato tiene detrás.")}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" data-calcular-reportes disabled={ocupado || !rangoOk || (SIN_BASE && carga === pide)} onClick={() => void calcula()}>
          {ocupado ? t("Calculating…", "Calculando…") : t("Calculate for this range", "Calcular para este rango")}
        </button>
        {r && (
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            {t("Driver", "Chofer")}
            <select value={chofer} onChange={(e) => setChofer(e.target.value)} data-chofer-de-reportes>
              <option value="">{t("All drivers", "Todos los choferes")}</option>
              {r.choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        )}
        {!rangoOk && <span className="hint" style={{ margin: 0 }}>{t(`Pick a range of at most ${DIAS_MAX_DE_REPORTES} days (the Panel's dates, above).`, `Elija un rango de ${DIAS_MAX_DE_REPORTES} días como mucho (las fechas del Panel, arriba).`)}</span>}
        {SIN_BASE && carga === pide && <span className="hint" style={{ margin: 0 }}>{t("Demo: there is no GPS history here.", "Demo: aquí no hay historial de GPS.")}</span>}
      </div>
      {error && <div className="hint" style={{ margin: "8px 0 0", color: "var(--red)" }}>{error}</div>}

      {r && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div className="hint" style={{ margin: 0 }} data-cobertura-de-reportes>
            {t(`${dias.length} driver-day(s) · GPS trail on ${conRastro.length} (truck ${conCamion.length}, phone ${conRastro.length - conCamion.length}) · no GPS on ${dias.length - conRastro.length}.`,
              `${dias.length} día(s) de chofer · con rastro GPS ${conRastro.length} (camión ${conCamion.length}, teléfono ${conRastro.length - conCamion.length}) · sin GPS ${dias.length - conRastro.length}.`)}
            {r.avisos.camionesPendientes > 0 && ` ${t(`${r.avisos.camionesPendientes} truck day(s) could not be loaded from TrackSolid this time (phone GPS used instead); calculate again to load more.`, `${r.avisos.camionesPendientes} día(s) de camión no se pudieron traer de TrackSolid esta vez (se usó el GPS del teléfono); calcule otra vez para traer más.`)}`}
            {r.avisos.rastroCortado && ` ${t("Too many phone positions in this range: phone GPS was not used. Pick a shorter range.", "Demasiadas posiciones de teléfono en este rango: no se usó el GPS del teléfono. Elija un rango más corto.")}`}
          </div>
          <details className="hint" style={{ margin: 0 }}>
            <summary style={{ cursor: "pointer" }}>{t("How this is measured", "Cómo se mide")}</summary>
            <ul style={{ margin: "6px 0 0 18px", display: "grid", gap: 3 }}>
              <li>{t("Arrival and departure: the GPS trail entering and leaving a 150 m circle around the stop, staying at least 2 minutes (shorter only if the driver tapped during it). Leaving and coming back within 3 minutes is one visit. If nothing is found at 150 m for a customer, 300 m is tried.", "Llegada y salida: el rastro GPS entrando y saliendo de un círculo de 150 m alrededor de la parada, quedándose al menos 2 minutos (menos solo si el chofer tocó durante ella). Salir y volver en menos de 3 minutos es la misma visita. Si a 150 m de un cliente no hay nada, se mira a 300 m.")}</li>
              <li>{t("Without a GPS visit, the driver's own tap is used (“arrived”, or else the closing tap) and labelled as such. A stop marked by someone else, or tapped more than 300 m away, has no real time.", "Sin visita por GPS se usa el toque del propio chofer («llegué», y si no el de cierre), y se dice. Una parada marcada por otra persona, o tocada a más de 300 m, no tiene hora real.")}</li>
              <li>{t("Out of order: the fewest stops you would have to move for the day to match the planned order.", "Fuera de orden: el menor número de paradas que habría que mover para que el día quedara en el orden planeado.")}</li>
              <li>{t("Planned miles and drive time: the planner's own cached legs between the planned stops, in order. Real: the GPS trail between the first and last arrival at a stop.", "Millas y manejo planeados: los tramos que el planificador ya tiene medidos entre las paradas planeadas, en su orden. Real: el rastro GPS entre la primera y la última llegada a una parada.")}</li>
              <li>{t(`Thin data (shown in grey, never ranked): fewer than ${MINIMO_DE_CASOS} cases (or ${MINIMO_DE_DIAS} days), or under ${COBERTURA_MINIMA * 100}% of what could be measured.`, `Poco dato (en gris, nunca se ordena): menos de ${MINIMO_DE_CASOS} casos (o ${MINIMO_DE_DIAS} días), o menos del ${COBERTURA_MINIMA * 100}% de lo que se podía medir.`)}</li>
            </ul>
          </details>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {PESTANAS.map(([k, nombre]) => (
              <button key={k} type="button" className={`chip${pestana === k ? " on" : ""}`} data-pestana-de-reportes={k} onClick={() => setPestana(k)}>{nombre}</button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} data-csv-de-reportes disabled={!dias.length} onClick={exporta}>⬇ CSV</button>
          </div>

          {dias.length === 0 && <div className="empty">{t("No orders with a driver in this range.", "No hay órdenes con chofer en este rango.")}</div>}

          {dias.length > 0 && pestana === "ruta" && (
            <div className="tbl-scroll" style={{ border: "none" }}>
              <table className="orders" style={{ minWidth: 980, fontVariantNumeric: "tabular-nums" }}>
                <thead><tr>
                  <th>{t("Date", "Fecha")}</th><th>{t("Driver", "Chofer")}</th><th>{t("Real route from", "Ruta real según")}</th>
                  <th title={t("Done · with a real time · total", "Hechas · con hora real · total")}>{t("Stops", "Paradas")}</th>
                  <th title={t("Stops out of the planned order, of those that can be compared", "Paradas fuera del orden planeado, de las que se pueden comparar")}>{t("Out of order", "Fuera de orden")}</th>
                  <th>{t("Plan: miles · drive", "Plan: millas · manejo")}</th>
                  <th title={t("From the GPS trail, between the first and last arrival at a stop", "Del rastro GPS, entre la primera y la última llegada a una parada")}>{t("Real: miles · drive", "Real: millas · manejo")}</th>
                  <th>{t("Day miles", "Millas del día")}</th><th>{t("Left at", "Salió")}</th>
                  <th title={t("Stopped 5+ min away from every stop and store, declared breaks not counted", "Parado 5 min o más lejos de toda parada y tienda, sin contar las pausas declaradas")}>{t("Stopped off-route", "Parado fuera de ruta")}</th>
                </tr></thead>
                <tbody>
                  {dias.map((d) => (
                    <tr key={`${d.fecha}|${d.chofer}`} data-dia-de-chofer={`${d.fecha}|${d.chofer}`} style={{ cursor: d.choferId ? "pointer" : undefined }}
                      title={t("Open the day: map and stops", "Abrir el día: mapa y paradas")} onClick={() => d.choferId && setAbierto({ fecha: d.fecha, choferId: d.choferId })}>
                      <td>{fmtDate(d.fecha)}</td>
                      <td style={{ fontWeight: 700 }}>{d.chofer}</td>
                      <td style={d.rastro.fuente ? undefined : { color: "var(--amber-text)" }}>{tx.rastro(d)}</td>
                      <td>{d.paradas.filter((p) => p.hecha).length} · {d.paradas.filter((p) => p.llegada != null).length} · {d.paradas.length}</td>
                      <td style={d.orden.fueraDeOrden ? { color: "var(--amber-text)", fontWeight: 700 } : undefined}>{d.orden.comparadas < 2 ? "—" : `${d.orden.fueraDeOrden} / ${d.orden.comparadas}`}</td>
                      <td>{d.plan.millas == null ? "—" : `${d.plan.millas} mi · ${dura(d.plan.minutos)}`}{d.plan.tramosEstimados > 0 && <span className="hint" style={{ margin: 0 }} title={t("Legs not in the planner's cache: straight line × 1.3 at 30 mph", "Tramos que no están en la caché del planificador: recta × 1,3 a 30 mph")}> ~{d.plan.tramosEstimados}/{d.plan.tramos}</span>}</td>
                      <td>{d.real.millasEntreParadas == null ? "—" : `${d.real.millasEntreParadas} mi · ${dura(d.real.minutosManejando)}`}</td>
                      <td>{d.real.millasDelDia == null ? "—" : `${d.real.millasDelDia} mi`}</td>
                      <td>{hora(d.real.primeraSalida)}</td>
                      <td>{d.parado.minutos == null ? "—" : d.parado.veces ? `${dura(d.parado.minutos)} · ${d.parado.veces}×` : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dias.length > 0 && pestana === "tiempo" && (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {resumenEst(t("Against the first estimate of the day", "Contra la primera estimación del día"), estPrimera)}
                {resumenEst(t("Against the current plan", "Contra el plan vigente"), estPlan)}
              </div>
              <div className="tbl-scroll" style={{ border: "none", maxHeight: 520 }}>
                <table className="orders" style={{ minWidth: 980, fontVariantNumeric: "tabular-nums" }}>
                  <thead><tr>
                    <th>{t("Date", "Fecha")}</th><th>{t("Driver", "Chofer")}</th><th title={t("Position in the plan → position really done", "Puesto en el plan → puesto en que se hizo")}>#</th>
                    <th>{t("Stop", "Parada")}</th><th>{t("First est.", "1ª estim.")}</th><th>{t("Plan", "Plan")}</th><th>{t("Arrived", "Llegó")}</th><th>{t("Left", "Salió")}</th>
                    <th>{t("Source", "Fuente")}</th><th>{t("vs first", "vs 1ª")}</th><th>{t("vs plan", "vs plan")}</th>
                  </tr></thead>
                  <tbody>
                    {paradas.map((p) => {
                      const cuenta = "min" in difDe(p, "plan");
                      return (
                        <tr key={`${p.fecha}|${p.chofer}|${p.clave}`} data-parada-de-reporte={p.clave}>
                          <td>{fmtDate(p.fecha)}</td><td>{p.chofer}</td>
                          <td style={p.fueraDeOrden ? { color: "var(--amber-text)", fontWeight: 700 } : undefined} title={p.fueraDeOrden ? t("Done out of the planned order", "Hecha fuera del orden planeado") : undefined}>{p.puestoPlan ?? "—"}→{p.puestoReal ?? "—"}</td>
                          <td><b>{p.tipo === "P" ? t("Pickup", "Recogida") : t("Delivery", "Entrega")}</b> {p.codigo} · {p.lugar}</td>
                          <td>{hhmm(p.primeraEta)}</td><td>{hhmm(p.eta)}</td><td>{hora(p.llegada)}</td><td>{p.fuente === "toque_cierre" ? "—" : hora(p.salida)}</td>
                          <td style={p.fuente ? undefined : { color: "var(--gray)" }}>{p.fuente ? tx.fuente(p.fuente) : tx.motivo(p.motivo)}</td>
                          <td style={cuenta ? undefined : { color: "var(--gray)" }}>{signo(p.difPrimera)}</td>
                          <td style={cuenta ? { fontWeight: 700, color: p.difPlan != null && p.difPlan > 30 ? "var(--red)" : p.difPlan != null && p.difPlan > 15 ? "var(--amber-text)" : "var(--green)" } : { color: "var(--gray)" }}
                            title={cuenta ? undefined : t("Not counted in the summary (out of order, or the estimate was written after the stop)", "No cuenta en el resumen (fuera de orden, o la estimación se escribió después de la parada)")}>
                            {signo(p.difPlan)}{p.fueraDeOrden && p.difPlan != null ? ` (${t("out of order", "fuera de orden")})` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {dias.length > 0 && pestana === "parada" && (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="hint" style={{ margin: 0 }}>{t("Group by", "Agrupar por")}</span>
                {([["clase", t("Stop type", "Tipo de parada")], ["tienda", t("Store", "Tienda")], ["cliente", t("Customer", "Cliente")], ["chofer", t("Driver", "Chofer")]] as [GrupoDeTiempo, string][]).map(([k, n]) => (
                  <button key={k} type="button" className={`chip${grupo === k ? " on" : ""}`} data-grupo-de-tiempo={k} onClick={() => setGrupo(k)}>{n}</button>
                ))}
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {t(`${visitas.filter((v) => !v.truncada).length} visit(s) measured from arrival to departure by GPS. ${visitas.filter((v) => v.truncada).length} more are not counted: the vehicle was already there when the trail starts, or still there when it ends. Stops without a GPS visit have no time at the stop (a tap can't tell). “Planner assumes” is the service time the planner budgets for those same visits.`,
                  `${visitas.filter((v) => !v.truncada).length} visita(s) medidas de la llegada a la salida por GPS. ${visitas.filter((v) => v.truncada).length} más no cuentan: el vehículo ya estaba ahí cuando empieza el rastro, o seguía ahí cuando acaba. Las paradas sin visita por GPS no tienen tiempo en la parada (un toque no lo dice). «El plan supone» es el tiempo de servicio que el planificador reserva para esas mismas visitas.`)}
              </div>
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 760, fontVariantNumeric: "tabular-nums" }}>
                  <thead><tr>
                    <th>{grupo === "clase" ? t("Stop type", "Tipo de parada") : grupo === "tienda" ? t("Store", "Tienda") : grupo === "cliente" ? t("Customer", "Cliente") : t("Driver", "Chofer")}</th>
                    <th>{t("Visits", "Visitas")}</th><th>{t("Median", "Mediana")}</th><th>{t("Average", "Media")}</th><th title={t("9 of 10 visits take this or less", "9 de cada 10 visitas duran esto o menos")}>P90</th><th>{t("Longest", "La más larga")}</th>
                    <th>{t("Planner assumes", "El plan supone")}</th><th>{t("Outliers", "Atípicas")}</th>
                  </tr></thead>
                  <tbody>
                    {filasDeTiempo.map((f) => (
                      <tr key={f.clave} data-fila-de-tiempo={f.clave} style={f.fiable ? undefined : { color: "var(--gray)" }} title={f.fiable ? undefined : t(`Thin data: fewer than ${MINIMO_DE_CASOS} visits.`, `Poco dato: menos de ${MINIMO_DE_CASOS} visitas.`)}>
                        <td style={{ fontWeight: 700 }}>{grupo === "clase" ? tx.clase(f.clave) : f.clave}</td>
                        <td>{f.n}{!f.fiable && ` · ${t("thin", "poco dato")}`}</td><td style={{ fontWeight: 700 }}>{dura(f.medianaMin)}</td><td>{dura(f.mediaMin)}</td><td>{dura(f.p90Min)}</td><td>{dura(f.maxMin)}</td>
                        <td>{dura(f.planeadoMin)}</td><td>{f.atipicas || "—"}</td>
                      </tr>
                    ))}
                    {filasDeTiempo.length === 0 && <tr><td colSpan={8}>{t("No visits measured by GPS in this group.", "No hay visitas medidas por GPS en este grupo.")}</td></tr>}
                  </tbody>
                </table>
              </div>
              {visitas.some((v) => v.atipica) && (
                <div data-atipicas>
                  <b style={{ fontSize: 13 }}>{t("Unusually long stops", "Paradas más largas de lo normal")}</b>
                  <div className="tbl-scroll" style={{ border: "none" }}>
                    <table className="orders" style={{ minWidth: 640, fontVariantNumeric: "tabular-nums" }}>
                      <tbody>
                        {visitas.filter((v) => v.atipica).sort((a, b) => b.minutos - a.minutos).map((v) => (
                          <tr key={`${v.fecha}|${v.chofer}|${v.llegada}`}>
                            <td>{fmtDate(v.fecha)}</td><td>{v.chofer}</td><td>{tx.clase(v.clase)}</td><td>{v.lugar}</td><td>{hora(v.llegada)}–{hora(v.salida)}</td><td style={{ fontWeight: 700 }}>{dura(v.minutos)}</td><td className="hint">{t("planner", "plan")} {dura(v.minPlaneados)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {dias.length > 0 && pestana === "tarjeta" && (
            <>
              <div className="hint" style={{ margin: 0 }}>
                {t("Under each number: how many cases it comes from, of how many could have been measured. Grey = thin data: shown, not compared. A “#1” appears only where two or more drivers have enough data for that measure.",
                  "Debajo de cada número: de cuántos casos sale, de cuántos se podían medir. Gris = poco dato: se enseña, no se compara. El «#1» solo aparece donde dos o más choferes tienen dato suficiente en esa medida.")}
              </div>
              <div className="tbl-scroll" style={{ border: "none" }}>
                <table className="orders" style={{ minWidth: 1100, fontVariantNumeric: "tabular-nums" }}>
                  <thead><tr>
                    <th>{t("Driver", "Chofer")}</th>
                    <th title={t("Days with orders · days with a GPS trail (truck + phone)", "Días con órdenes · días con rastro GPS (camión + teléfono)")}>{t("Days", "Días")}</th>
                    <th title={t("Done · total", "Hechas · total")}>{t("Stops", "Paradas")}</th>
                    <th>{t("Miles", "Millas")}</th>
                    <th title={t("Typical time the truck leaves the store where the day starts", "Hora típica a la que el camión sale de la tienda donde empieza el día")}>{t("First departure", "Primera salida")}</th>
                    <th title={t("Deliveries arriving by the end of the customer's window", "Entregas que llegan antes del fin de la ventana del cliente")}>{t("On time (window)", "A tiempo (ventana)")}</th>
                    <th title={t("Stops done in order, arriving within 30 min of the current plan", "Paradas hechas en orden que llegan a 30 min o menos del plan vigente")}>{t("Within 30 min of plan", "A 30 min del plan")}</th>
                    <th title={t("Median GPS time at a customer delivery", "Mediana del tiempo por GPS en una entrega a cliente")}>{t("Time per delivery", "Tiempo por entrega")}</th>
                    <th title={t("Of the driver's own closing taps whose place is known, how many were made at the stop", "De los toques de cierre del propio chofer cuyo lugar se conoce, cuántos se hicieron en la parada")}>{t("Taps at the stop", "Toques en la parada")}</th>
                    <th>{t("Out of order", "Fuera de orden")}</th>
                    <th title={t("Average per day with a dense GPS trail", "Media por día con rastro GPS denso")}>{t("Stopped off-route", "Parado fuera de ruta")}</th>
                  </tr></thead>
                  <tbody>
                    {tarjetas.map((x) => (
                      <tr key={x.chofer} data-tarjeta-de-chofer={x.chofer}>
                        <td style={{ fontWeight: 700 }}>{x.chofer}</td>
                        <td>{x.dias}<span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>GPS {x.diasConRastro} ({x.diasConCamion}+{x.diasConTelefono})</span></td>
                        <td>{x.paradasHechas} · {x.paradas}<span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>{t("real time", "con hora")} {x.paradasConHora} (GPS {x.paradasPorRastro})</span></td>
                        {celda(x.medidas.millasPorDia, () => `${x.millas ?? "—"} mi`)}
                        {celda(x.medidas.primeraSalidaMin, (v) => hhmm(v))}
                        {celda(x.medidas.aTiempo, (v) => `${v}%`)}
                        {celda(x.medidas.dentroDe30, (v) => `${v}%`)}
                        {celda(x.medidas.minPorEntrega, (v) => dura(v))}
                        {celda(x.medidas.toquesEnLaParada, (v) => `${v}%`)}
                        {celda(x.medidas.fueraDeOrden, (v) => `${v}%`)}
                        {celda(x.medidas.paradoMinPorDia, (v) => `${dura(v)}/${t("day", "día")}`)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {abierto && r && (
        <DiaDelChofer fecha={abierto.fecha} choferId={abierto.choferId} zona={zona} carga={carga} onClose={() => setAbierto(null)} t={t}
          inicial={r.dias.find((d) => d.fecha === abierto.fecha && d.choferId === abierto.choferId) ?? null} />
      )}
    </div>
  );
}

/** El día de un chofer, abierto en una tarjeta: el mapa (plan y rastro juntos) y sus paradas. */
function DiaDelChofer({ fecha, choferId, zona, inicial, carga, onClose, t }: {
  fecha: string; choferId: string; zona: string; inicial: InformeDelDia | null; carga: (url: string) => Promise<RespuestaDeReportes>; onClose: () => void; t: T;
}) {
  const tx = useMemo(() => textos(t), [t]);
  const hoja = useRef<HTMLDivElement>(null);
  const [r, setR] = useState<RespuestaDeReportes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    carga(`/api/driver-reports?from=${fecha}&to=${fecha}&driver=${encodeURIComponent(choferId)}&map=1`)
      .then((b) => { if (vivo) setR(b); }, (e) => { if (vivo) setError(e instanceof Error ? e.message : "error"); });
    return () => { vivo = false; };
  }, [fecha, choferId, carga]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onClose]);

  const d = r?.dias[0] ?? inicial;
  const hora = useMemo(() => {
    const f = formateadorDeFecha("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false });
    return (ms: number | null | undefined) => (ms == null ? "—" : f.format(ms));
  }, [zona]);
  const paradas = useMemo(() => [...(d?.paradas ?? [])].sort((a, b) => (a.puestoPlan ?? 999) - (b.puestoPlan ?? 999) || (a.llegada ?? Infinity) - (b.llegada ?? Infinity)), [d]);

  const { points, lines, fitTo } = useMemo(() => {
    const points: MapPoint[] = [], lines: MapLine[] = [];
    const vistos = new Set<string>();
    for (const p of paradas) {
      if (p.lat == null || p.lng == null) continue;
      const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const aqui = paradas.filter((x) => x.lat != null && x.lng != null && `${x.lat.toFixed(4)},${x.lng.toFixed(4)}` === k);
      // El texto va a un tooltip que el mapa pone como TEXTO (nunca como HTML): nombres de cliente y tienda son datos.
      points.push({
        id: p.clave, lat: p.lat, lng: p.lng, color: aqui.every((x) => x.llegada == null) ? COLOR_SIN_HORA : p.tipo === "P" ? COLOR_RECOGIDA : COLOR_ENTREGA,
        badge: p.puestoPlan != null ? String(p.puestoPlan) : "•",
        label: aqui.map((x) => `${x.puestoPlan ?? "—"}→${x.puestoReal ?? "—"} ${x.tipo === "P" ? t("Pickup", "Recogida") : t("Delivery", "Entrega")} ${x.codigo} · ${x.lugar} · ${hora(x.llegada)}`).join("\n"),
      });
    }
    const plan = r?.mapa?.plan ?? [];
    if (plan.length > 1) lines.push({ id: "plan:dia", color: COLOR_PLAN, positions: plan, weight: ANCHO_PLAN_CON_RECORRIDO, dashed: true });
    (r?.mapa?.trazos ?? []).forEach((positions, i) => lines.push({ id: `real:${i}`, color: COLOR_RECORRIDO_REAL, positions, weight: ANCHO_RECORRIDO_REAL, borde: BORDE_RECORRIDO_REAL, encima: true }));
    const fitTo: [number, number][] = [...points.map((p) => [p.lat, p.lng] as [number, number]), ...lines.flatMap((l) => l.positions)];
    return { points, lines, fitTo };
  }, [paradas, r, hora, t]);

  const png = async () => {
    if (!hoja.current || ocupado) return;
    setOcupado(true);
    try {
      const snapdom = await cargaSnapdom();
      const lienzo = await snapdom.toCanvas(hoja.current, { backgroundColor: getComputedStyle(hoja.current).backgroundColor || "#ffffff", fast: true, scale: 2, exclude: ["[data-fuera-de-la-foto]", ".leaflet-control-zoom"], excludeMode: "remove" });
      const blob = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, "image/png"));
      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `driver-day-${(d?.chofer ?? "driver").replace(/[^\p{L}\p{N}]+/gu, "-")}-${fecha}.png`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } catch { setError(t("Couldn't build the image. Try again.", "No se pudo armar la imagen. Inténtelo otra vez.")); }
    setOcupado(false);
  };

  const th = { padding: "4px 6px", textAlign: "left" as const }, td = { padding: "4px 6px" };
  return (
    <div className="overlay" data-dia-del-chofer onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("Driver's day", "Día del chofer")} style={{ maxWidth: 1040, width: "100%", padding: 0, overflow: "hidden" }}>
        <div ref={hoja} style={{ background: "var(--card)", color: "var(--ink)", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 18 }}>🚚 {d?.chofer ?? "…"}</b>
            <span style={{ fontSize: 14 }}>{fmtDate(fecha)}{d ? ` · ${t("real route from", "ruta real según")}: ${tx.rastro(d)}${d.rastro.fuente ? ` (${d.rastro.puntos} ${t("points", "puntos")}, ${hora(d.rastro.desde)}–${hora(d.rastro.hasta)})` : ""}` : ""}</span>
          </div>
          {d && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginTop: 6, fontVariantNumeric: "tabular-nums" }} data-numeros-del-dia>
              <span>{t("Out of order", "Fuera de orden")}: <b>{d.orden.comparadas < 2 ? "—" : `${d.orden.fueraDeOrden} / ${d.orden.comparadas}`}</b></span>
              <span>{t("Plan", "Plan")}: <b>{d.plan.millas == null ? "—" : `${d.plan.millas} mi · ${dura(d.plan.minutos)}`}</b>{d.plan.tramosEstimados > 0 ? ` (${d.plan.tramosEstimados}/${d.plan.tramos} ${t("legs estimated", "tramos estimados")})` : ""}</span>
              <span>{t("Real, stop to stop", "Real, de parada a parada")}: <b>{d.real.millasEntreParadas == null ? "—" : `${d.real.millasEntreParadas} mi · ${dura(d.real.minutosManejando)}`}</b></span>
              <span>{t("Whole day", "Todo el día")}: <b>{d.real.millasDelDia == null ? "—" : `${d.real.millasDelDia} mi`}</b></span>
              <span>{t("Left at", "Salió")}: <b>{hora(d.real.primeraSalida)}</b></span>
              <span>{t("Stopped off-route", "Parado fuera de ruta")}: <b>{d.parado.minutos == null ? "—" : `${dura(d.parado.minutos)} (${d.parado.veces}×)`}</b></span>
              <span>{t("Taps at the stop", "Toques en la parada")}: <b>{d.toques.conPosicion ? `${d.toques.enLaParada} / ${d.toques.conPosicion}` : "—"}</b>{d.toques.deOtraPersona ? ` · ${d.toques.deOtraPersona} ${t("marked by someone else", "marcadas por otra persona")}` : ""}</span>
            </div>
          )}
          {error && <div className="hint" style={{ color: "var(--red)", margin: "6px 0 0" }}>{error}</div>}
          <div style={{ marginTop: 10 }} data-mapa-del-dia>
            {r ? <LeafletMap points={points} lines={lines} stores={r.tiendas} fitTo={fitTo} height={420} mosaicos={SIN_BASE ? "osm" : "google"} />
              : !error && <p className="hint">{t("Loading the GPS trail…", "Cargando el rastro GPS…")}</p>}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginTop: 6, color: "var(--ink-soft)" }}>
            <span><span style={{ display: "inline-block", width: 22, borderTop: `4px dashed ${COLOR_PLAN}`, verticalAlign: "middle", marginRight: 4 }} />{t("Planned order (straight lines between stops)", "Orden planeado (rectas entre paradas)")}</span>
            <span><span style={{ display: "inline-block", width: 22, borderTop: `3px solid ${COLOR_RECORRIDO_REAL}`, verticalAlign: "middle", marginRight: 4 }} />{t("Really driven (GPS)", "Lo manejado de verdad (GPS)")}</span>
            <span>{t("Pin number = position in the plan", "Número de la marca = puesto en el plan")}</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }} data-paradas-del-dia>
            <thead><tr style={{ borderBottom: "2px solid var(--line)" }}>
              <th style={th}>{t("Plan→Real", "Plan→Real")}</th><th style={th}>{t("Stop", "Parada")}</th><th style={th}>{t("First est.", "1ª estim.")}</th><th style={th}>{t("Plan", "Plan")}</th>
              <th style={th}>{t("Arrived", "Llegó")}</th><th style={th}>{t("Left", "Salió")}</th><th style={th}>{t("At stop", "En parada")}</th><th style={th}>{t("Source", "Fuente")}</th><th style={th}>{t("vs plan", "vs plan")}</th><th style={th}>{t("Driver's tap", "Toque del chofer")}</th>
            </tr></thead>
            <tbody>
              {paradas.map((p: ParadaDelInforme) => {
                const v = p.visita != null ? d?.visitas[p.visita] : null;
                return (
                  <tr key={p.clave} style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>
                    <td style={{ ...td, fontWeight: 800, color: p.fueraDeOrden ? "var(--amber-text)" : undefined }}>{p.puestoPlan ?? "—"}→{p.puestoReal ?? "—"}</td>
                    <td style={td}><b style={{ color: p.tipo === "P" ? COLOR_RECOGIDA : COLOR_ENTREGA }}>{p.tipo === "P" ? t("Pickup", "Recogida") : t("Delivery", "Entrega")}</b> {p.codigo} · {p.lugar}</td>
                    <td style={td}>{hhmm(p.primeraEta)}</td><td style={td}>{hhmm(p.eta)}</td>
                    <td style={td}>{hora(p.llegada)}</td><td style={td}>{p.fuente === "toque_cierre" ? "—" : hora(p.salida)}</td>
                    <td style={td}>{v ? `${dura(v.minutos)}${v.truncada ? "*" : ""}` : "—"}</td>
                    <td style={{ ...td, color: p.fuente ? undefined : "var(--gray)" }}>{p.fuente ? tx.fuente(p.fuente) : tx.motivo(p.motivo)}</td>
                    <td style={td}>{signo(p.difPlan)}{p.fueraDeOrden ? ` · ${t("out of order", "fuera de orden")}` : ""}</td>
                    <td style={{ ...td, color: p.toque?.enLaParada === false ? "var(--amber-text)" : undefined }}>
                      {p.toque ? `${hora(p.toque.t)} · ${p.toque.enLaParada == null ? t("place unknown", "lugar desconocido") : p.toque.enLaParada ? t("at the stop", "en la parada") : t("away", "lejos")}${p.toque.metros != null ? ` (${p.toque.metros >= 1000 ? `${(p.toque.metros / 1609.344).toFixed(1)} mi` : `${p.toque.metros} m`})` : ""}`
                        : p.toqueDeOtraPersona ? t("someone else", "otra persona") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d?.visitas.some((v) => v.truncada) && <div style={{ fontSize: 11.5, color: "var(--gray)", marginTop: 4 }}>* {t("The vehicle was already there when the trail starts, or still there when it ends.", "El vehículo ya estaba ahí cuando empieza el rastro, o seguía ahí cuando acaba.")}</div>}
          <div data-fuera-de-la-foto style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t("Close", "Cerrar")}</button>
            <button type="button" className="btn btn-primary" data-png-del-dia disabled={ocupado || !r} onClick={() => void png()}>⬇ {ocupado ? t("Preparing…", "Preparando…") : t("Download PNG", "Descargar PNG")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
