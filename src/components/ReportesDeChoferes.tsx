"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtDate } from "@/lib/utils";
import { formateadorDeFecha } from "@/lib/formateador";
import { cargaSnapdom } from "@/components/CapturaDeAyuda";
import { TablaEstandar } from "@/components/TablaEstandar";
import type { MapLine, MapPoint } from "@/components/LeafletMap";
import type { FuenteDeHora, InformeDelDia, MotivoSinHora, ParadaDelInforme } from "@/lib/reportes-choferes/dia";
import {
  aCsv, difDe, estimadoContraReal, tarjetasDeChoferes, tiempoPorParada, visitasDe, COBERTURA_MINIMA, MINIMO_DE_CASOS, MINIMO_DE_DIAS,
  type ClaveDeMedida, type EstimadoContraReal, type GrupoDeTiempo, type Medida,
} from "@/lib/reportes-choferes/metricas";
import { DIAS_MAX_DE_REPORTES, rangoDeReportes } from "@/lib/reportes-choferes/permiso";
import { COLOR_RECORRIDO_REAL, BORDE_RECORRIDO_REAL, ANCHO_RECORRIDO_REAL, ANCHO_PLAN_CON_RECORRIDO } from "@/lib/recorrido-contra-plan";

/**
 * «Reportes de choferes» (D-907) — en el Panel, debajo de «Puntualidad por chofer», con el rango del Panel.
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

  // Una medida de la tarjeta del chofer, dentro de su celda de `TablaEstandar`: el número, su muestra y su puesto.
  const medida = (x: Medida, texto: (v: number) => string) => (
    <span style={x.fiable ? undefined : { color: "var(--gray)" }} title={x.fiable ? undefined : t(`Thin data: ${x.n} of ${x.de}. Shown, but not used to compare drivers.`, `Poco dato: ${x.n} de ${x.de}. Se enseña, pero no se usa para comparar choferes.`)}>
      <span style={{ fontWeight: x.fiable ? 700 : 400 }}>{x.valor == null ? "—" : texto(x.valor)}</span>
      {x.puesto != null && <span className="count-tag" style={{ marginLeft: 4 }}>#{x.puesto}</span>}
      <span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>{x.n}/{x.de}{!x.fiable && x.n > 0 ? ` · ${t("thin", "poco dato")}` : ""}</span>
    </span>
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
            // Estándar de tablas (`TablaEstandar`). Pulsar un renglón abre el día en una tarjeta (mapa y paradas).
            <TablaEstandar id="reportes-ruta" data-tabla="reportes-ruta" sinCaja filas={dias} claveDe={(d) => `${d.fecha}|${d.chofer}`}
              onFila={(d) => { if (d.choferId) setAbierto({ fecha: d.fecha, choferId: d.choferId }); }}
              columnas={[
                { key: "fecha", en: "Date", es: "Fecha", ancho: 110, valor: (d) => d.fecha, celda: (d) => fmtDate(d.fecha) },
                { key: "chofer", en: "Driver", es: "Chofer", ancho: 160, fija: true, valor: (d) => d.chofer, celda: (d) => <strong>{d.chofer}</strong> },
                { key: "rastro", en: "Real route from", es: "Ruta real según", ancho: 170, valor: (d) => tx.rastro(d), celda: (d) => <span style={d.rastro.fuente ? undefined : { color: "var(--amber-text)" }}>{tx.rastro(d)}</span> },
                { key: "paradas", en: "Stops", es: "Paradas", ancho: 130, valor: (d) => d.paradas.filter((p) => p.hecha).length, celda: (d) => `${d.paradas.filter((p) => p.hecha).length} · ${d.paradas.filter((p) => p.llegada != null).length} · ${d.paradas.length}` },
                { key: "fuera", en: "Out of order", es: "Fuera de orden", ancho: 120, numerico: true, valor: (d) => (d.orden.comparadas < 2 ? null : d.orden.fueraDeOrden), celda: (d) => (
                  <span style={d.orden.fueraDeOrden ? { color: "var(--amber-text)", fontWeight: 700 } : undefined}>{d.orden.comparadas < 2 ? "—" : `${d.orden.fueraDeOrden} / ${d.orden.comparadas}`}</span>
                ) },
                { key: "plan", en: "Plan: miles · drive", es: "Plan: millas · manejo", ancho: 170, valor: (d) => d.plan.millas, celda: (d) => (
                  <>{d.plan.millas == null ? "—" : `${d.plan.millas} mi · ${dura(d.plan.minutos)}`}{d.plan.tramosEstimados > 0 && <span className="hint" style={{ margin: 0 }} title={t("Legs not in the planner's cache: straight line × 1.3 at 30 mph", "Tramos que no están en la caché del planificador: recta × 1,3 a 30 mph")}> ~{d.plan.tramosEstimados}/{d.plan.tramos}</span>}</>
                ) },
                { key: "real", en: "Real: miles · drive", es: "Real: millas · manejo", ancho: 170, valor: (d) => d.real.millasEntreParadas, celda: (d) => (d.real.millasEntreParadas == null ? "—" : `${d.real.millasEntreParadas} mi · ${dura(d.real.minutosManejando)}`) },
                { key: "millasdia", en: "Day miles", es: "Millas del día", ancho: 110, numerico: true, valor: (d) => d.real.millasDelDia, celda: (d) => (d.real.millasDelDia == null ? "—" : `${d.real.millasDelDia} mi`) },
                { key: "salio", en: "Left at", es: "Salió", ancho: 90, valor: (d) => d.real.primeraSalida, celda: (d) => hora(d.real.primeraSalida) },
                { key: "parado", en: "Stopped off-route", es: "Parado fuera de ruta", ancho: 170, valor: (d) => d.parado.minutos, celda: (d) => (d.parado.minutos == null ? "—" : d.parado.veces ? `${dura(d.parado.minutos)} · ${d.parado.veces}×` : "0") },
              ]} />
          )}

          {dias.length > 0 && pestana === "tiempo" && (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {resumenEst(t("Against the first estimate of the day", "Contra la primera estimación del día"), estPrimera)}
                {resumenEst(t("Against the current plan", "Contra el plan vigente"), estPlan)}
              </div>
              <TablaEstandar id="reportes-tiempo" data-tabla="reportes-tiempo" sinCaja filas={paradas} claveDe={(p) => `${p.fecha}|${p.chofer}|${p.clave}`}
                columnas={[
                  { key: "fecha", en: "Date", es: "Fecha", ancho: 110, valor: (p) => p.fecha, celda: (p) => fmtDate(p.fecha) },
                  { key: "chofer", en: "Driver", es: "Chofer", ancho: 150, fija: true, valor: (p) => p.chofer },
                  { key: "puesto", en: "#", es: "#", ancho: 90, valor: (p) => p.puestoPlan ?? null, celda: (p) => (
                    <span style={p.fueraDeOrden ? { color: "var(--amber-text)", fontWeight: 700 } : undefined} title={p.fueraDeOrden ? t("Done out of the planned order", "Hecha fuera del orden planeado") : undefined}>{p.puestoPlan ?? "—"}→{p.puestoReal ?? "—"}</span>
                  ) },
                  { key: "parada", en: "Stop", es: "Parada", ancho: 260, valor: (p) => `${p.codigo} ${p.lugar}`, celda: (p) => <><b>{p.tipo === "P" ? t("Pickup", "Recogida") : t("Delivery", "Entrega")}</b> {p.codigo} · {p.lugar}</> },
                  { key: "primera", en: "First est.", es: "1ª estim.", ancho: 90, valor: (p) => p.primeraEta, celda: (p) => hhmm(p.primeraEta) },
                  { key: "plan", en: "Plan", es: "Plan", ancho: 80, valor: (p) => p.eta, celda: (p) => hhmm(p.eta) },
                  { key: "llego", en: "Arrived", es: "Llegó", ancho: 90, valor: (p) => p.llegada, celda: (p) => hora(p.llegada) },
                  { key: "salio", en: "Left", es: "Salió", ancho: 90, valor: (p) => p.salida, celda: (p) => (p.fuente === "toque_cierre" ? "—" : hora(p.salida)) },
                  { key: "fuente", en: "Source", es: "Fuente", ancho: 170, valor: (p) => (p.fuente ? tx.fuente(p.fuente) : tx.motivo(p.motivo)), celda: (p) => <span style={p.fuente ? undefined : { color: "var(--gray)" }}>{p.fuente ? tx.fuente(p.fuente) : tx.motivo(p.motivo)}</span> },
                  { key: "vsprimera", en: "vs first", es: "vs 1ª", ancho: 90, numerico: true, valor: (p) => p.difPrimera, celda: (p) => <span style={"min" in difDe(p, "plan") ? undefined : { color: "var(--gray)" }}>{signo(p.difPrimera)}</span> },
                  { key: "vsplan", en: "vs plan", es: "vs plan", ancho: 130, numerico: true, valor: (p) => p.difPlan, celda: (p) => {
                    const cuenta = "min" in difDe(p, "plan");
                    return (
                      <span style={cuenta ? { fontWeight: 700, color: p.difPlan != null && p.difPlan > 30 ? "var(--red)" : p.difPlan != null && p.difPlan > 15 ? "var(--amber-text)" : "var(--green)" } : { color: "var(--gray)" }}
                        title={cuenta ? undefined : t("Not counted in the summary (out of order, or the estimate was written after the stop)", "No cuenta en el resumen (fuera de orden, o la estimación se escribió después de la parada)")}>
                        {signo(p.difPlan)}{p.fueraDeOrden && p.difPlan != null ? ` (${t("out of order", "fuera de orden")})` : ""}
                      </span>
                    );
                  } },
                ]} />
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
              <TablaEstandar id="reportes-tiempo-parada" data-tabla="reportes-tiempo-parada" sinCaja filas={filasDeTiempo} claveDe={(f) => f.clave}
                vacio={t("No visits measured by GPS in this group.", "No hay visitas medidas por GPS en este grupo.")}
                columnas={[
                  { key: "grupo", en: grupo === "clase" ? "Stop type" : grupo === "tienda" ? "Store" : grupo === "cliente" ? "Customer" : "Driver", es: grupo === "clase" ? "Tipo de parada" : grupo === "tienda" ? "Tienda" : grupo === "cliente" ? "Cliente" : "Chofer", ancho: 180, fija: true,
                    valor: (f) => (grupo === "clase" ? tx.clase(f.clave) : f.clave), celda: (f) => <span style={f.fiable ? { fontWeight: 700 } : { color: "var(--gray)" }} title={f.fiable ? undefined : t(`Thin data: fewer than ${MINIMO_DE_CASOS} visits.`, `Poco dato: menos de ${MINIMO_DE_CASOS} visitas.`)}>{grupo === "clase" ? tx.clase(f.clave) : f.clave}</span> },
                  { key: "visitas", en: "Visits", es: "Visitas", ancho: 110, numerico: true, valor: (f) => f.n, celda: (f) => <span style={f.fiable ? undefined : { color: "var(--gray)" }}>{f.n}{!f.fiable && ` · ${t("thin", "poco dato")}`}</span> },
                  { key: "mediana", en: "Median", es: "Mediana", ancho: 100, numerico: true, valor: (f) => f.medianaMin, celda: (f) => <span style={{ fontWeight: 700 }}>{dura(f.medianaMin)}</span> },
                  { key: "media", en: "Average", es: "Media", ancho: 100, numerico: true, valor: (f) => f.mediaMin, celda: (f) => dura(f.mediaMin) },
                  { key: "p90", en: "P90", es: "P90", ancho: 90, numerico: true, valor: (f) => f.p90Min, celda: (f) => dura(f.p90Min) },
                  { key: "maxima", en: "Longest", es: "La más larga", ancho: 110, numerico: true, valor: (f) => f.maxMin, celda: (f) => dura(f.maxMin) },
                  { key: "planeado", en: "Planner assumes", es: "El plan supone", ancho: 130, numerico: true, valor: (f) => f.planeadoMin, celda: (f) => dura(f.planeadoMin) },
                  { key: "atipicas", en: "Outliers", es: "Atípicas", ancho: 100, numerico: true, valor: (f) => f.atipicas, celda: (f) => f.atipicas || "—" },
                ]} />
              {visitas.some((v) => v.atipica) && (
                <div data-atipicas>
                  <b style={{ fontSize: 13 }}>{t("Unusually long stops", "Paradas más largas de lo normal")}</b>
                  <TablaEstandar id="reportes-atipicas" data-tabla="reportes-atipicas" sinCaja filas={visitas.filter((v) => v.atipica).sort((a, b) => b.minutos - a.minutos)}
                    claveDe={(v) => `${v.fecha}|${v.chofer}|${v.llegada}`}
                    columnas={[
                      { key: "fecha", en: "Date", es: "Fecha", ancho: 110, valor: (v) => v.fecha, celda: (v) => fmtDate(v.fecha) },
                      { key: "chofer", en: "Driver", es: "Chofer", ancho: 150, fija: true, valor: (v) => v.chofer },
                      { key: "clase", en: "Stop type", es: "Tipo de parada", ancho: 140, valor: (v) => tx.clase(v.clase) },
                      { key: "lugar", en: "Place", es: "Lugar", ancho: 220, valor: (v) => v.lugar },
                      { key: "horario", en: "Time", es: "Horario", ancho: 130, valor: (v) => v.llegada, celda: (v) => `${hora(v.llegada)}–${hora(v.salida)}` },
                      { key: "minutos", en: "Minutes", es: "Minutos", ancho: 100, numerico: true, valor: (v) => v.minutos, celda: (v) => <span style={{ fontWeight: 700 }}>{dura(v.minutos)}</span> },
                      { key: "plan", en: "Planner", es: "Plan", ancho: 110, numerico: true, valor: (v) => v.minPlaneados, celda: (v) => <span className="hint">{t("planner", "plan")} {dura(v.minPlaneados)}</span> },
                    ]} />
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
              <TablaEstandar id="reportes-tarjeta" data-tabla="reportes-tarjeta" sinCaja filas={tarjetas} claveDe={(x) => x.chofer}
                columnas={[
                  { key: "chofer", en: "Driver", es: "Chofer", ancho: 150, fija: true, valor: (x) => x.chofer, celda: (x) => <strong>{x.chofer}</strong> },
                  { key: "dias", en: "Days", es: "Días", ancho: 120, numerico: true, valor: (x) => x.dias, celda: (x) => (
                    <span title={t("Days with orders · days with a GPS trail (truck + phone)", "Días con órdenes · días con rastro GPS (camión + teléfono)")}>{x.dias}<span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>GPS {x.diasConRastro} ({x.diasConCamion}+{x.diasConTelefono})</span></span>
                  ) },
                  { key: "paradas", en: "Stops", es: "Paradas", ancho: 140, numerico: true, valor: (x) => x.paradasHechas, celda: (x) => (
                    <span title={t("Done · total", "Hechas · total")}>{x.paradasHechas} · {x.paradas}<span className="hint" style={{ margin: 0, display: "block", fontSize: 11 }}>{t("real time", "con hora")} {x.paradasConHora} (GPS {x.paradasPorRastro})</span></span>
                  ) },
                  { key: "millas", en: "Miles", es: "Millas", ancho: 130, numerico: true, valor: (x) => x.medidas.millasPorDia.valor, celda: (x) => medida(x.medidas.millasPorDia, () => `${x.millas ?? "—"} mi`) },
                  { key: "primera", en: "First departure", es: "Primera salida", ancho: 130, numerico: true, valor: (x) => x.medidas.primeraSalidaMin.valor, celda: (x) => medida(x.medidas.primeraSalidaMin, (v) => hhmm(v)) },
                  { key: "atiempo", en: "On time (window)", es: "A tiempo (ventana)", ancho: 140, numerico: true, valor: (x) => x.medidas.aTiempo.valor, celda: (x) => medida(x.medidas.aTiempo, (v) => `${v}%`) },
                  { key: "dentro30", en: "Within 30 min of plan", es: "A 30 min del plan", ancho: 150, numerico: true, valor: (x) => x.medidas.dentroDe30.valor, celda: (x) => medida(x.medidas.dentroDe30, (v) => `${v}%`) },
                  { key: "pordel", en: "Time per delivery", es: "Tiempo por entrega", ancho: 140, numerico: true, valor: (x) => x.medidas.minPorEntrega.valor, celda: (x) => medida(x.medidas.minPorEntrega, (v) => dura(v)) },
                  { key: "toques", en: "Taps at the stop", es: "Toques en la parada", ancho: 140, numerico: true, valor: (x) => x.medidas.toquesEnLaParada.valor, celda: (x) => medida(x.medidas.toquesEnLaParada, (v) => `${v}%`) },
                  { key: "fuera", en: "Out of order", es: "Fuera de orden", ancho: 130, numerico: true, valor: (x) => x.medidas.fueraDeOrden.valor, celda: (x) => medida(x.medidas.fueraDeOrden, (v) => `${v}%`) },
                  { key: "parado", en: "Stopped off-route", es: "Parado fuera de ruta", ancho: 150, numerico: true, valor: (x) => x.medidas.paradoMinPorDia.valor, celda: (x) => medida(x.medidas.paradoMinPorDia, (v) => `${dura(v)}/${t("day", "día")}`) },
                ]} />
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
          {/* Estándar de tablas (`TablaEstandar`), dentro de la tarjeta del día. */}
          <div style={{ marginTop: 10 }}>
          <TablaEstandar id="reportes-dia-chofer" data-tabla="reportes-dia-chofer" sinCaja filas={paradas} claveDe={(p) => p.clave}
            columnas={[
              { key: "plan", en: "Plan→Real", es: "Plan→Real", ancho: 100, numerico: true, valor: (p) => p.puestoPlan, celda: (p) => <b style={{ color: p.fueraDeOrden ? "var(--amber-text)" : undefined }}>{p.puestoPlan ?? "—"}→{p.puestoReal ?? "—"}</b> },
              { key: "parada", en: "Stop", es: "Parada", ancho: 260, fija: true, valor: (p) => `${p.codigo} ${p.lugar}`, celda: (p) => <><b style={{ color: p.tipo === "P" ? COLOR_RECOGIDA : COLOR_ENTREGA }}>{p.tipo === "P" ? t("Pickup", "Recogida") : t("Delivery", "Entrega")}</b> {p.codigo} · {p.lugar}</> },
              { key: "primera", en: "First est.", es: "1ª estim.", ancho: 90, valor: (p) => p.primeraEta, celda: (p) => hhmm(p.primeraEta) },
              { key: "plan", en: "Plan", es: "Plan", ancho: 80, valor: (p) => p.eta, celda: (p) => hhmm(p.eta) },
              { key: "llego", en: "Arrived", es: "Llegó", ancho: 90, valor: (p) => p.llegada, celda: (p) => hora(p.llegada) },
              { key: "salio", en: "Left", es: "Salió", ancho: 90, valor: (p) => p.salida, celda: (p) => (p.fuente === "toque_cierre" ? "—" : hora(p.salida)) },
              { key: "enparada", en: "At stop", es: "En parada", ancho: 110, numerico: true, valor: (p) => (p.visita != null ? d?.visitas[p.visita]?.minutos ?? null : null), celda: (p) => {
                const v = p.visita != null ? d?.visitas[p.visita] : null;
                return v ? `${dura(v.minutos)}${v.truncada ? "*" : ""}` : "—";
              } },
              { key: "fuente", en: "Source", es: "Fuente", ancho: 170, valor: (p) => (p.fuente ? tx.fuente(p.fuente) : tx.motivo(p.motivo)), celda: (p) => <span style={{ color: p.fuente ? undefined : "var(--gray)" }}>{p.fuente ? tx.fuente(p.fuente) : tx.motivo(p.motivo)}</span> },
              { key: "vsplan", en: "vs plan", es: "vs plan", ancho: 130, numerico: true, valor: (p) => p.difPlan, celda: (p) => `${signo(p.difPlan)}${p.fueraDeOrden ? ` · ${t("out of order", "fuera de orden")}` : ""}` },
              { key: "toque", en: "Driver's tap", es: "Toque del chofer", ancho: 240, valor: (p) => p.toque?.t ?? null, celda: (p) => (
                <span style={{ color: p.toque?.enLaParada === false ? "var(--amber-text)" : undefined }}>
                  {p.toque ? `${hora(p.toque.t)} · ${p.toque.enLaParada == null ? t("place unknown", "lugar desconocido") : p.toque.enLaParada ? t("at the stop", "en la parada") : t("away", "lejos")}${p.toque.metros != null ? ` (${p.toque.metros >= 1000 ? `${(p.toque.metros / 1609.344).toFixed(1)} mi` : `${p.toque.metros} m`})` : ""}`
                    : p.toqueDeOtraPersona ? t("someone else", "otra persona") : "—"}
                </span>
              ) },
            ]} />
          </div>
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
