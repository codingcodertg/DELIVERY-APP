"use client";

import type { CSSProperties } from "react";
import { usePrefs } from "@/lib/prefs";
import type { ApegoDelChofer } from "@/lib/apego-a-la-ruta/apego";
import { EtiquetaDeOrden } from "@/components/EtiquetaDeOrden";

// ============================================================
// «Plan contra real» (D-910): lo que el Recorrido enseña de la ruta programada contra lo que el chofer hizo.
//
// Dos piezas: el RESUMEN en la tarjeta de cada chofer (el porcentaje de apego, «X de N paradas en orden», millas y
// tiempo plan/real en una tablita), y el DETALLE cuando se mira a un solo chofer (las barras, las paradas del plan en su
// orden con lo que se vio de cada una, y la definición de cada número). Un chofer sin plan ese día dice «Sin ruta
// programada», no ceros.
//
// Los números vienen ya hechos del servidor (`/api/route-adherence`, el motor de D-907): aquí solo se pintan.
// ============================================================

type T = (en: string, es: string) => string;

export function fmtMinutos(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  const n = Math.round(Math.abs(m)), signo = m < 0 ? "−" : "";
  if (n < 60) return `${signo}${n} min`;
  const h = Math.floor(n / 60), r = n % 60;
  return `${signo}${h} h${r ? ` ${r} min` : ""}`;
}
const conSigno = (x: number | null, unidad: string): string => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x)}${unidad}`);
const pctConSigno = (x: number | null): string => (x == null ? "" : ` (${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x)} %)`);
const hora = (ms: number | null, lang: string): string => (ms == null ? "—" : new Date(ms).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" }));
const minutoDelDia = (m: number | null): string => (m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

/** El color del porcentaje: verde de 80 arriba, ámbar de 50 arriba, rojo debajo. */
export function colorDelApego(pct: number | null): string {
  if (pct == null) return "var(--gray)";
  return pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--amber-text)" : "var(--red)";
}

export function definicionDelApego(t: T): string {
  return t(
    "Route adherence = planned stops done in the planned order ÷ planned stops. A stop counts as done when the truck (or phone) GPS stayed within 150 m of it for 2 min or more, or the driver tapped it in the app. Stops out of sequence or not visited do not count.",
    "Apego a la ruta = paradas del plan hechas en su orden ÷ paradas del plan. Una parada cuenta como hecha cuando el GPS del camión (o del teléfono) se quedó a 150 m o menos de ella 2 min o más, o el chofer la tocó en la app. Las fuera de secuencia o no visitadas no cuentan.",
  );
}

export function definicionDelCamino(t: T): string {
  return t(
    "Path adherence = share of the miles driven that lie within 150 m of the planned path. The hub does not store road geometry for a plan, so the planned path is straight lines between stops: use it to compare days, not as an absolute.",
    "Apego al camino = parte de las millas manejadas que caen a 150 m o menos del camino planeado. El hub no guarda las calles de un plan, así que el camino planeado son rectas entre paradas: sirve para comparar días, no como medida absoluta.",
  );
}

function Barra({ pct, color }: { pct: number | null; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, height: "100%", background: color, transition: "width .3s" }} />
    </div>
  );
}

const celda: CSSProperties = { padding: "1px 6px 1px 0", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

/** La tablita plan/real/diferencia de millas y tiempo: la misma en la tarjeta y en el detalle. */
function TablaPlanReal({ a, t, compacta }: { a: ApegoDelChofer; t: T; compacta?: boolean }) {
  const estimado = a.plan.estimado ? " *" : "";
  return (
    <table data-tabla="plan-real" style={{ borderCollapse: "collapse", fontSize: compacta ? 11 : 13, marginTop: 4 }}>
      <thead>
        <tr style={{ color: "var(--gray)" }}><th style={celda} /><th style={{ ...celda, fontWeight: 600 }}>{t("Planned", "Plan")}</th><th style={{ ...celda, fontWeight: 600 }}>{t("Real", "Real")}</th><th style={{ ...celda, fontWeight: 600 }}>±</th></tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ ...celda, color: "var(--gray)" }}>{t("Miles", "Millas")}</td>
          <td style={celda}>{a.plan.millas != null ? `${a.plan.millas} mi${estimado}` : "—"}</td>
          <td style={celda}>{a.real.millas != null ? `${a.real.millas} mi` : "—"}</td>
          <td style={{ ...celda, color: a.diferencia.millas != null && a.diferencia.millas > 0 ? "var(--amber-text)" : undefined }}>{conSigno(a.diferencia.millas, " mi")}{!compacta && pctConSigno(a.diferencia.millasPct)}</td>
        </tr>
        <tr>
          <td style={{ ...celda, color: "var(--gray)" }}>{t("Total time", "Tiempo total")}</td>
          <td style={celda}>{fmtMinutos(a.plan.minutosTotal)}</td>
          <td style={celda}>{fmtMinutos(a.real.minutosTotal)}{a.real.enVivo ? " ·" : ""}</td>
          <td style={{ ...celda, color: a.diferencia.minutos != null && a.diferencia.minutos > 0 ? "var(--amber-text)" : undefined }}>{a.diferencia.minutos == null ? "—" : `${a.diferencia.minutos > 0 ? "+" : a.diferencia.minutos < 0 ? "−" : "±"}${fmtMinutos(Math.abs(a.diferencia.minutos))}`}{!compacta && pctConSigno(a.diferencia.minutosPct)}</td>
        </tr>
        {!compacta && (
          <tr>
            <td style={{ ...celda, color: "var(--gray)" }}>{t("Driving", "Manejando")}</td>
            <td style={celda}>{fmtMinutos(a.plan.minutosManejo)}{a.plan.minutosManejo != null ? ` + ${fmtMinutos(a.plan.minutosServicio)} ${t("at stops", "en paradas")}` : ""}</td>
            <td style={celda}>{fmtMinutos(a.real.minutosManejo)}</td>
            <td style={celda}>{a.plan.minutosManejo != null && a.real.minutosManejo != null ? `${a.real.minutosManejo - a.plan.minutosManejo > 0 ? "+" : a.real.minutosManejo - a.plan.minutosManejo < 0 ? "−" : "±"}${fmtMinutos(Math.abs(a.real.minutosManejo - a.plan.minutosManejo))}` : "—"}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Lo que va en la tarjeta de cada chofer del Recorrido. */
export function ApegoEnTarjeta({ apego, listo, esHoy }: { apego: ApegoDelChofer | undefined; listo: boolean; esHoy: boolean }) {
  const { t } = usePrefs();
  if (!listo) return <div className="hint" data-apego="cargando" style={{ marginTop: 6 }}>📐 {t("Plan vs real: loading…", "Plan contra real: cargando…")}</div>;
  if (!apego || !apego.hayPlan) return <div className="hint" data-apego="sin-plan" style={{ marginTop: 6 }}>📐 {t("No planned route that day", "Sin ruta programada ese día")}</div>;
  const color = colorDelApego(apego.orden.pct);
  return (
    <div data-apego="con-plan" data-apego-pct={apego.orden.pct ?? ""} style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }} title={definicionDelApego(t)}>
        <span className="hint" style={{ marginTop: 0 }}>📐 {t("Route adherence", "Apego a la ruta")}</span>
        <b style={{ color, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{apego.orden.pct ?? "—"} %</b>
        <span className="hint" style={{ marginTop: 0, cursor: "help" }}>ⓘ</span>
      </div>
      <Barra pct={apego.orden.pct} color={color} />
      <div className="hint" style={{ marginTop: 3 }}>
        {t(`${apego.orden.enOrden} of ${apego.orden.planeadas} stops in planned order`, `${apego.orden.enOrden} de ${apego.orden.planeadas} paradas en su orden`)}
        {" · "}{t(`${apego.orden.visitadas} visited`, `${apego.orden.visitadas} visitadas`)}
        {apego.orden.noVisitadas.length > 0 && <> · {esHoy && apego.real.enVivo ? t(`${apego.orden.planeadas - apego.orden.visitadas} pending`, `${apego.orden.planeadas - apego.orden.visitadas} pendientes`) : t(`${apego.orden.planeadas - apego.orden.visitadas} skipped`, `${apego.orden.planeadas - apego.orden.visitadas} saltadas`)}</>}
      </div>
      <TablaPlanReal a={apego} t={t} compacta />
      {!apego.rastro.fuente && <div className="hint" style={{ marginTop: 2 }}>{t("No GPS trail: stops from the app's taps only.", "Sin rastro GPS: las paradas salen solo de los toques en la app.")}</div>}
    </div>
  );
}

/** El detalle cuando se mira a un solo chofer: barras, paradas del plan en su orden, y las definiciones. */
export function DetalleDelApego({ apego, listo, esHoy, color, mostrarPlan, onMostrarPlan, abrirOrden }: {
  apego: ApegoDelChofer | undefined; listo: boolean; esHoy: boolean; color: string;
  mostrarPlan: boolean; onMostrarPlan: (v: boolean) => void;
  /** D-NEXT: abrir la ficha de una orden (por su id) en su sitio. Si devuelve `null`, esa orden no está cargada y no se puede abrir. */
  abrirOrden?: (id: string | undefined) => (() => void) | null;
}) {
  const { t, lang } = usePrefs();
  return (
    <div className="card" data-bloque="plan-contra-real">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        📐 {t("Plan vs real", "Plan contra real")}
        {apego?.hayPlan && <span className="count-tag">{apego.orden.planeadas} {t("planned stops", "paradas del plan")}</span>}
        <label className="hint" style={{ marginTop: 0, marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input type="checkbox" checked={mostrarPlan} onChange={(e) => onMostrarPlan(e.target.checked)} data-accion="mostrar-plan" />
          {t("Show planned route on the map", "Ver la ruta planeada en el mapa")}
        </label>
      </h2>
      {!listo ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : !apego || !apego.hayPlan ? (
        <div className="empty">{t("No planned route for this driver that day. The Routes Manager had not scheduled stops for them.", "Sin ruta programada para este chofer ese día: el Gestor de Rutas no le había programado paradas.")}</div>
      ) : (
        <>
          <div className="grid g3" style={{ marginBottom: 10 }}>
            <div className="card" style={{ margin: 0 }} title={definicionDelApego(t)}>
              <div className="hint" style={{ marginTop: 0 }}>{t("Route adherence (stop order)", "Apego a la ruta (orden de paradas)")} ⓘ</div>
              <div className="display" style={{ fontSize: 26, fontWeight: 800, color: colorDelApego(apego.orden.pct) }}>{apego.orden.pct ?? "—"} %</div>
              <Barra pct={apego.orden.pct} color={colorDelApego(apego.orden.pct)} />
              <div className="hint">{t(`${apego.orden.enOrden} of ${apego.orden.planeadas} stops in planned order`, `${apego.orden.enOrden} de ${apego.orden.planeadas} paradas en su orden`)}</div>
            </div>
            <div className="card" style={{ margin: 0 }} title={definicionDelCamino(t)}>
              <div className="hint" style={{ marginTop: 0 }}>{t("Path adherence (straight-line plan)", "Apego al camino (plan en rectas)")} ⓘ</div>
              <div className="display" style={{ fontSize: 26, fontWeight: 800, color: "var(--gray)" }}>{apego.camino.pct != null ? `${apego.camino.pct} %` : "—"}</div>
              <Barra pct={apego.camino.pct} color="var(--gray)" />
              <div className="hint">{apego.camino.pct != null ? t(`${apego.camino.millasDentro} of ${apego.camino.millas} mi within ${apego.camino.corredorM} m`, `${apego.camino.millasDentro} de ${apego.camino.millas} mi a ${apego.camino.corredorM} m o menos`) : t("No GPS trail", "Sin rastro GPS")}</div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="hint" style={{ marginTop: 0 }}>{t("Stops", "Paradas")}</div>
              <div className="display" style={{ fontSize: 26, fontWeight: 800 }}>{apego.orden.visitadas} <span style={{ fontSize: 14, color: "var(--gray)" }}>/ {apego.orden.planeadas}</span></div>
              <div className="hint">
                {t("visited", "visitadas")}
                {apego.orden.fueraDeOrden.length > 0 && <> · <span style={{ color: "var(--amber-text)" }}>{apego.orden.fueraDeOrden.length} {t("out of order", "fuera de orden")}</span></>}
                {apego.orden.planeadas - apego.orden.visitadas > 0 && <> · <span style={{ color: esHoy && apego.real.enVivo ? undefined : "var(--red)" }}>{apego.orden.planeadas - apego.orden.visitadas} {esHoy && apego.real.enVivo ? t("pending", "pendientes") : t("skipped", "saltadas")}</span></>}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <b>{t("Miles and time", "Millas y tiempo")}</b>
              <TablaPlanReal a={apego} t={t} />
              <div className="hint" style={{ marginTop: 4 }}>
                {apego.plan.estimado && <>* {t(`${apego.plan.tramosEstimados} of ${apego.plan.tramos} planned legs were not in the planner's cache: estimated as straight line × 1.3 at 30 mph.`, `${apego.plan.tramosEstimados} de ${apego.plan.tramos} tramos del plan no estaban en la caché del planificador: estimados en recta × 1,3 a 30 mph.`)}{" "}</>}
                {apego.real.desde != null && <>{t("Real", "Real")}: {hora(apego.real.desde, lang)} – {apego.real.enVivo ? <b style={{ color: "var(--green)" }}>{t("now (live)", "ahora (en vivo)")}</b> : hora(apego.real.hasta, lang)}
                  {apego.rastro.fuente === "camion" ? ` · ${t("truck GPS", "GPS del camión")}${apego.rastro.camion ? ` ${apego.rastro.camion}` : ""}` : apego.rastro.fuente === "telefono" ? ` · ${t("phone GPS", "GPS del teléfono")}` : ""}
                  {apego.rastro.escaso && <> · <span style={{ color: "var(--amber-text)" }}>{t("sparse trail: miles and time are a lower bound", "rastro escaso: millas y tiempo son un piso")}</span></>}</>}
                {apego.real.desde == null && t("No GPS trail that day: real miles and time are unknown.", "Sin rastro GPS ese día: las millas y el tiempo reales no se saben.")}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 260 }}>
              <b>{t("Planned stops, in planned order", "Paradas del plan, en su orden")}</b>
              <div className="tbl-scroll">
                <table className="orders" style={{ fontSize: 13 }}>
                  <thead><tr><th>#</th><th>{t("Where", "Dónde")}</th><th>{t("Invoice", "Factura")}</th><th>ETA</th><th>{t("Arrived", "Llegó")}</th><th>{t("Status", "Estado")}</th></tr></thead>
                  <tbody>
                    {apego.paradas.map((p) => (
                      <tr key={p.puesto} data-parada-plan={p.puesto} data-estado={p.enOrden ? "en-orden" : p.visitada ? "fuera-de-orden" : p.hecha ? "hecha-sin-rastro" : "no-visitada"}>
                        <td><span style={{ display: "inline-block", minWidth: 20, textAlign: "center", borderRadius: 10, background: color, color: "var(--card)", fontSize: 11, fontWeight: 700, padding: "1px 5px" }}>{p.puesto}</span></td>
                        <td>{p.lugar}</td>
                        {/* D-NEXT: la orden se nombra por su FACTURA; sin ella, el código en gris. Pulsar abre la ficha. */}
                        <td className="ordno">
                          {p.ordenes.map((o, i) => (
                            <span key={`${o.tipo}:${o.id ?? o.codigo}`}>
                              {i > 0 && ", "}
                              <EtiquetaDeOrden orden={o} prefijo={`${o.tipo === "P" ? "▲" : "✓"} `} onAbrir={abrirOrden?.(o.id) ?? null} />
                            </span>
                          ))}
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{minutoDelDia(p.eta)}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{hora(p.llegada, lang)}</td>
                        <td>
                          {p.enOrden ? <b style={{ color: "var(--green)" }}>✓ {t("in order", "en orden")}</b>
                            : p.visitada ? <b style={{ color: "var(--amber-text)" }}>↕ {t("out of order", "fuera de orden")}</b>
                            : p.hecha ? <span className="hint" style={{ marginTop: 0 }}>{t("closed in the app, not seen there", "cerrada en la app, no se vio ahí")}</span>
                            : esHoy && apego.real.enVivo ? <span className="hint" style={{ marginTop: 0 }}>{t("pending", "pendiente")}</span>
                            : <b style={{ color: "var(--red)" }}>✕ {t("not visited", "no visitada")}</b>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="hint" style={{ marginTop: 10 }}>
            <b>{t("How this is measured", "Cómo se mide")}.</b> {definicionDelApego(t)} {definicionDelCamino(t)}{" "}
            {t("Planned miles and time come from the Routes Manager plan (travel cache legs plus service minutes per stop); real ones from the GPS trail of the whole day, first point to last (or to now while live). Same engine as Driver reports.", "Las millas y el tiempo planeados salen del plan del Gestor de Rutas (tramos de la caché más los minutos de servicio por parada); los reales, del rastro GPS del día entero, del primer punto al último (o hasta ahora en vivo). El mismo motor que Reportes de choferes.")}
          </div>
        </>
      )}
    </div>
  );
}
