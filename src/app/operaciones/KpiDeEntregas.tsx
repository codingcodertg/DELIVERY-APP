"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtDateTime } from "@/lib/utils";
import { fmtDia, hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { etiquetaDeRango, sumarDias, type Rango } from "@/lib/almacen-ops/rango-de-merma";
import { DIAS_MAX_DEL_RANGO, colorDelPct, type Grupo, type GrupoDeEmpleado, type OrdenEvaluada } from "@/lib/almacen-ops/kpi-entregas";
import type { Contexto } from "./Operaciones";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";

/** Lo que devuelve `/api/almacen-ops/kpi-entregas`. */
interface Respuesta {
  ok: true;
  desde: string;
  hasta: string;
  cortado: boolean;
  total: Grupo;
  porTienda: Grupo[];
  porDia: Grupo[];
  porSemana: Grupo[];
  porEmpleado: GrupoDeEmpleado[];
  peores: (OrdenEvaluada & { quienMarcoNombre: string | null })[];
}

type Carga = { estado: "cargando" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Respuesta };

/**
 * KPI de entregas del almacén (Roberto, fase 1): «% de órdenes listas antes de que llegue el chofer». Pestaña
 * «Entregas» de Reportes (gerentes). El rango lo pone el selector de la merma (D-911); aquí se exige cerrado y de a lo
 * más dos meses, porque la ruta lee el historial de órdenes. La regla exacta vive en `kpi-entregas.ts`.
 */
export function KpiDeEntregas({ rango, ctx }: { rango: Rango | null; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const hoy = hoyEnTexas();
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [periodo, setPeriodo] = useState<"dia" | "semana">("dia");
  // Un extremo abierto se cierra: «Desde» vacío = dos meses atrás desde «Hasta»; «Hasta» vacío = hoy.
  const cerrado = useMemo<Rango | null>(() => {
    if (!rango) return null;
    const hasta = rango.hasta || hoy;
    const desde = rango.desde || sumarDias(hasta, -(DIAS_MAX_DEL_RANGO - 1));
    return { desde, hasta };
  }, [rango, hoy]);
  const demasiado = cerrado ? (Date.parse(`${cerrado.hasta}T00:00:00Z`) - Date.parse(`${cerrado.desde}T00:00:00Z`)) / 86_400_000 >= DIAS_MAX_DEL_RANGO : false;

  useEffect(() => {
    if (!cerrado || demasiado) return;
    if (ctx.demo) { setCarga({ estado: "listo", datos: DEMO }); return; }
    let vivo = true;
    setCarga({ estado: "cargando" });
    (async () => {
      try {
        const r = await fetch(`/api/almacen-ops/kpi-entregas?from=${cerrado.desde}&to=${cerrado.hasta}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok || !j.ok) { setCarga({ estado: "error", mensaje: j.error ?? `HTTP ${r.status}` }); return; }
        setCarga({ estado: "listo", datos: j as Respuesta });
      } catch (e) {
        if (vivo) setCarga({ estado: "error", mensaje: mensajeDeErrorAlCargar(e) });
      }
    })();
    return () => { vivo = false; };
  }, [cerrado, demasiado, ctx.demo]);

  if (!cerrado) return <p className="hint">{t("Fix the dates to see the KPI.", "Corrige las fechas para ver el KPI.")}</p>;
  if (demasiado) return <p className="ops-aviso ops-aviso-error" data-rango-largo>{t(`Pick a range of at most ${DIAS_MAX_DEL_RANGO} days.`, `Elige un rango de a lo más ${DIAS_MAX_DEL_RANGO} días.`)}</p>;
  if (carga.estado === "cargando") return <p className="hint">{t("Loading…", "Cargando…")}</p>;
  if (carga.estado === "error") return <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>;

  const d = carga.datos;
  const etiqueta = etiquetaDeRango(cerrado, lang, hoy);
  const tot = d.total;
  const color = colorDelPct(tot.pct);
  const pct = (g: Grupo) => (g.pct === null ? "—" : `${g.pct}%`);
  const min = (m: number | null) => (m === null ? "—" : `${m} min`);
  const porPeriodo = periodo === "dia" ? d.porDia : d.porSemana;
  const nombreDelPeriodo = (clave: string) => (periodo === "dia" ? fmtDia(clave, lang) : `${t("Week of", "Semana del")} ${fmtDia(clave, lang)}`);
  // Las tablas (estándar de tablas): ▾, ⚙ y anchos como en Órdenes. Las cifras son las mismas que antes.
  const colsTienda = columnasDeGrupo<Grupo>({ key: "tienda", en: "Store", es: "Tienda", valor: (g) => g.clave });
  const colsPeriodo = columnasDeGrupo<Grupo>({ key: "periodo", en: periodo === "dia" ? "Day" : "Week", es: periodo === "dia" ? "Día" : "Semana", valor: (g) => g.clave, celda: (g) => nombreDelPeriodo(g.clave) });
  const colsEmpleado = columnasDeGrupo<GrupoDeEmpleado>({ key: "empleado", en: "Employee", es: "Empleado", valor: (g) => g.nombre });

  return (
    <div data-kpi-entregas data-kpi-pct={tot.pct ?? ""} data-kpi-color={color}>
      <div className="ops-merma-totales ops-kpi">
        <div className="ops-merma-total ops-merma-total-rango ops-kpi-tile-principal">
          <span>{t("Ready before the driver arrived", "Listas antes de que llegara el chofer")}</span>
          <span className={`ops-merma-cifra ops-kpi-${color}`} data-kpi-total-pct>{pct(tot)}</span>
          <span>{tot.aTiempo} / {tot.total} · <span data-etiqueta-rango>{etiqueta}</span></span>
        </div>
        <div className="ops-merma-total">
          <span>{t("Marked after pickup", "Marcadas después de recogidas")}</span>
          <span className={`ops-merma-cifra ${tot.tarde > 0 ? "ops-kpi-ambar" : "ops-kpi-verde"}`}>{tot.tarde}</span>
          <span>{t("orders", "órdenes")}</span>
        </div>
        <div className="ops-merma-total">
          <span>{t("Never marked ready", "Nunca marcadas lista")}</span>
          <span className={`ops-merma-cifra ${tot.sinMarcar > 0 ? "ops-kpi-rojo" : "ops-kpi-verde"}`}>{tot.sinMarcar}</span>
          <span>{t("picked up without “ready”", "recogidas sin «lista»")}</span>
        </div>
        <div className="ops-merma-total">
          <span>{t("Median ready → pickup", "Mediana listo → recogida")}</span>
          <span className="ops-merma-cifra">{min(tot.medianaMin)}</span>
          <span>{t("over orders with a “ready” mark", "sobre las órdenes con marca de «lista»")}</span>
        </div>
      </div>
      {d.cortado && <p className="ops-aviso ops-aviso-error">{t("Too many orders in this range; the numbers are partial. Pick a shorter range.", "Demasiadas órdenes en el rango; las cifras son parciales. Elige un rango más corto.")}</p>}
      <p className="hint" data-regla>
        {t("An order counts as ready on time when the warehouse marked it “ready” before the driver pressed “picked up” (last “ready” vs. first “picked up”; a tie is not on time). Picked up without a “ready” mark counts as not ready. Orders never picked up are not counted. Days are Texas days of the pickup.",
          "Una orden cuenta como lista a tiempo cuando el almacén la marcó «lista» antes de que el chofer pulsara «recogida» (el último «lista» contra la primera «recogida»; un empate no es a tiempo). Recogida sin marca de «lista» cuenta como no lista. Las órdenes que nunca se recogieron no cuentan. Los días son los de Texas, por la recogida.")}
      </p>

      <h3 className="ops-merma-titulo">{t("By store", "Por tienda")}</h3>
      <TablaEstandar id="kpi-por-tienda" data-tabla="kpi-por-tienda" filas={d.porTienda} claveDe={(g) => g.clave}
        columnas={colsTienda}
        vacio={t("No orders picked up in this range.", "No se recogió ninguna orden en este rango.")} />

      <h3 className="ops-merma-titulo">{t("By period", "Por periodo")}</h3>
      <div className="filters-oneline ops-filtros" role="group" aria-label={t("Period", "Periodo")} data-periodo>
        <button type="button" className={`chip${periodo === "dia" ? " active" : ""}`} onClick={() => setPeriodo("dia")} aria-pressed={periodo === "dia"} data-periodo-opcion="dia">{t("By day", "Por día")}</button>
        <button type="button" className={`chip${periodo === "semana" ? " active" : ""}`} onClick={() => setPeriodo("semana")} aria-pressed={periodo === "semana"} data-periodo-opcion="semana">{t("By week", "Por semana")}</button>
      </div>
      <TablaEstandar id={`kpi-por-periodo-${periodo}`} data-tabla={`kpi-por-periodo-${periodo}`} filas={porPeriodo} claveDe={(g) => g.clave}
        columnas={colsPeriodo}
        vacio={t("No orders picked up in this range.", "No se recogió ninguna orden en este rango.")} />

      <h3 className="ops-merma-titulo">{t("By warehouse employee", "Por empleado del almacén")} <span className="count-tag">{d.porEmpleado.length}</span></h3>
      <p className="hint">{t("Who marked the order “ready” (the last mark). Orders picked up without a “ready” mark belong to nobody and are not here.", "Quién marcó la orden como «lista» (la última marca). Las recogidas sin marca de «lista» no son de nadie y no salen aquí.")}</p>
      <TablaEstandar id="kpi-por-empleado" data-tabla="kpi-por-empleado" filas={d.porEmpleado} claveDe={(g) => g.clave}
        columnas={colsEmpleado}
        vacio={t("Nobody marked an order ready in this range.", "Nadie marcó una orden como lista en este rango.")} />

      <h3 className="ops-merma-titulo">{t("Worst 10 orders", "Las 10 peores órdenes")}</h3>
      <TablaEstandar id="kpi-peores" data-tabla="kpi-peores" filas={d.peores} claveDe={(o) => o.id}
        columnas={[
          { key: "factura", en: "Invoice", es: "Factura", valor: (o) => o.factura },
          { key: "tienda", en: "Store", es: "Tienda", valor: (o) => o.tienda },
          { key: "minutos", en: "Minutes late", es: "Minutos tarde", numerico: true, valor: (o) => (o.minutos === null ? null : -o.minutos), celda: (o) => (
            <span className="ops-kpi-rojo" data-minutos={o.minutos ?? ""}>{o.minutos === null ? t("never marked", "nunca marcada") : `${-o.minutos} min`}</span>
          ) },
          { key: "recogida", en: "Picked up", es: "Recogida", valor: (o) => o.recogidaEn, etiqueta: (v) => (typeof v === "string" ? fmtDateTime(v) : ""), celda: (o) => fmtDateTime(o.recogidaEn) },
          { key: "marcola", en: "Marked ready by", es: "La marcó lista", valor: (o) => o.quienMarcoNombre ?? (o.quienMarco ? "—" : t("nobody", "nadie")) },
        ]}
        vacio={t("Every order was ready on time.", "Todas las órdenes estuvieron listas a tiempo.")} />
    </div>
  );
}

/** Las cinco cifras de un grupo (tienda, día, semana, empleado): las mismas columnas en las cuatro tablas. */
function columnasDeGrupo<G extends Grupo>(primera: ColumnaEstandar<G>): ColumnaEstandar<G>[] {
  const pctDe = (g: Grupo) => (g.pct === null ? "—" : `${g.pct}%`);
  const minDe = (m: number | null) => (m === null ? "—" : `${m} min`);
  return [
    primera,
    { key: "aTiempo", en: "Ready on time", es: "A tiempo", numerico: true, valor: (g) => g.pct, celda: (g) => (
      <span className={`ops-kpi-${colorDelPct(g.pct)}`}><b>{pctDe(g)}</b> <span className="ops-persona-tienda">({g.aTiempo})</span></span>
    ) },
    { key: "tarde", en: "Not ready", es: "No listas", numerico: true, valor: (g) => g.tarde },
    { key: "sinMarcar", en: "Never marked", es: "Sin marcar", numerico: true, valor: (g) => g.sinMarcar },
    { key: "total", en: "Total", es: "Total", numerico: true, valor: (g) => g.total },
    { key: "mediana", en: "Median", es: "Mediana", numerico: true, valor: (g) => g.medianaMin, celda: (g) => minDe(g.medianaMin) },
  ];
}

/** Datos de muestra para el modo demo (sin base). */
const DEMO: Respuesta = {
  ok: true, desde: "2026-11-01", hasta: "2026-11-08", cortado: false,
  total: { clave: "*", total: 42, aTiempo: 35, tarde: 4, sinMarcar: 3, pct: 83, medianaMin: 38 },
  porTienda: [
    { clave: "McAllen", total: 18, aTiempo: 16, tarde: 1, sinMarcar: 1, pct: 89, medianaMin: 42 },
    { clave: "Pharr", total: 24, aTiempo: 19, tarde: 3, sinMarcar: 2, pct: 79, medianaMin: 31 },
  ],
  porDia: [
    { clave: "2026-11-05", total: 20, aTiempo: 17, tarde: 2, sinMarcar: 1, pct: 85, medianaMin: 40 },
    { clave: "2026-11-06", total: 22, aTiempo: 18, tarde: 2, sinMarcar: 2, pct: 82, medianaMin: 35 },
  ],
  porSemana: [{ clave: "2026-11-01", total: 42, aTiempo: 35, tarde: 4, sinMarcar: 3, pct: 83, medianaMin: 38 }],
  porEmpleado: [
    { clave: "u1", nombre: "Ana López", total: 22, aTiempo: 20, tarde: 2, sinMarcar: 0, pct: 91, medianaMin: 45 },
    { clave: "u2", nombre: "Beto Ríos", total: 17, aTiempo: 15, tarde: 2, sinMarcar: 0, pct: 88, medianaMin: 30 },
  ],
  peores: [
    { id: "d1", factura: "INV-1021", tienda: "Pharr", dia: "2026-11-05", semana: "2026-11-01", listaEn: "2026-11-05T16:40:00Z", recogidaEn: "2026-11-05T15:55:00Z", minutos: -45, aTiempo: false, quienMarco: "u2", quienMarcoNombre: "Beto Ríos" },
    { id: "d2", factura: "INV-1034", tienda: "McAllen", dia: "2026-11-06", semana: "2026-11-01", listaEn: null, recogidaEn: "2026-11-06T14:10:00Z", minutos: null, aTiempo: false, quienMarco: null, quienMarcoNombre: null },
  ],
};
