"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { fmtDateTime } from "@/lib/utils";
import { fmtDia, hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { etiquetaDeRango, sumarDias, type Rango } from "@/lib/almacen-ops/rango-de-merma";
import { DIAS_MAX_DEL_RANGO, colorDelPct, type Grupo, type GrupoDeEmpleado, type OrdenEvaluada } from "@/lib/almacen-ops/kpi-entregas";
import type { Contexto } from "./Operaciones";

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
        if (vivo) setCarga({ estado: "error", mensaje: e instanceof Error ? e.message : String(e) });
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
      <div className="tbl-scroll tbl-caja">
        <table className="orders" data-kpi-por-tienda>
          <thead><tr><th>{t("Store", "Tienda")}</th><th className="num">{t("Ready on time", "A tiempo")}</th><th className="num">{t("Not ready", "No listas")}</th><th className="num">{t("Never marked", "Sin marcar")}</th><th className="num">{t("Total", "Total")}</th><th className="num">{t("Median", "Mediana")}</th></tr></thead>
          <tbody>
            {d.porTienda.length === 0 && <tr><td colSpan={6} className="hint">{t("No orders picked up in this range.", "No se recogió ninguna orden en este rango.")}</td></tr>}
            {d.porTienda.map((g) => (
              <tr key={g.clave} data-tienda={g.clave}>
                <td>{g.clave}</td>
                <td className={`num ops-kpi-${colorDelPct(g.pct)}`} data-pct={g.pct ?? ""}><b>{pct(g)}</b> <span className="ops-persona-tienda">({g.aTiempo})</span></td>
                <td className="num">{g.tarde}</td>
                <td className="num">{g.sinMarcar}</td>
                <td className="num">{g.total}</td>
                <td className="num">{min(g.medianaMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ops-merma-titulo">{t("By period", "Por periodo")}</h3>
      <div className="filters-oneline ops-filtros" role="group" aria-label={t("Period", "Periodo")} data-periodo>
        <button type="button" className={`chip${periodo === "dia" ? " active" : ""}`} onClick={() => setPeriodo("dia")} aria-pressed={periodo === "dia"} data-periodo-opcion="dia">{t("By day", "Por día")}</button>
        <button type="button" className={`chip${periodo === "semana" ? " active" : ""}`} onClick={() => setPeriodo("semana")} aria-pressed={periodo === "semana"} data-periodo-opcion="semana">{t("By week", "Por semana")}</button>
      </div>
      <div className="tbl-scroll tbl-caja">
        <table className="orders" data-kpi-por-periodo={periodo}>
          <thead><tr><th>{periodo === "dia" ? t("Day", "Día") : t("Week", "Semana")}</th><th className="num">{t("Ready on time", "A tiempo")}</th><th className="num">{t("Not ready", "No listas")}</th><th className="num">{t("Never marked", "Sin marcar")}</th><th className="num">{t("Total", "Total")}</th><th className="num">{t("Median", "Mediana")}</th></tr></thead>
          <tbody>
            {porPeriodo.length === 0 && <tr><td colSpan={6} className="hint">{t("No orders picked up in this range.", "No se recogió ninguna orden en este rango.")}</td></tr>}
            {porPeriodo.map((g) => (
              <tr key={g.clave} data-periodo-clave={g.clave}>
                <td>{nombreDelPeriodo(g.clave)}</td>
                <td className={`num ops-kpi-${colorDelPct(g.pct)}`}><b>{pct(g)}</b> <span className="ops-persona-tienda">({g.aTiempo})</span></td>
                <td className="num">{g.tarde}</td>
                <td className="num">{g.sinMarcar}</td>
                <td className="num">{g.total}</td>
                <td className="num">{min(g.medianaMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ops-merma-titulo">{t("By warehouse employee", "Por empleado del almacén")} <span className="count-tag">{d.porEmpleado.length}</span></h3>
      <p className="hint">{t("Who marked the order “ready” (the last mark). Orders picked up without a “ready” mark belong to nobody and are not here.", "Quién marcó la orden como «lista» (la última marca). Las recogidas sin marca de «lista» no son de nadie y no salen aquí.")}</p>
      <div className="tbl-scroll tbl-caja">
        <table className="orders" data-kpi-por-empleado>
          <thead><tr><th>{t("Employee", "Empleado")}</th><th className="num">{t("Ready on time", "A tiempo")}</th><th className="num">{t("Marked late", "Marcadas tarde")}</th><th className="num">{t("Orders", "Órdenes")}</th><th className="num">{t("Median", "Mediana")}</th></tr></thead>
          <tbody>
            {d.porEmpleado.length === 0 && <tr><td colSpan={5} className="hint">{t("Nobody marked an order ready in this range.", "Nadie marcó una orden como lista en este rango.")}</td></tr>}
            {d.porEmpleado.map((g) => (
              <tr key={g.clave} data-empleado={g.clave}>
                <td>{g.nombre}</td>
                <td className={`num ops-kpi-${colorDelPct(g.pct)}`} data-pct={g.pct ?? ""}><b>{pct(g)}</b> <span className="ops-persona-tienda">({g.aTiempo})</span></td>
                <td className="num">{g.tarde}</td>
                <td className="num">{g.total}</td>
                <td className="num">{min(g.medianaMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ops-merma-titulo">{t("Worst 10 orders", "Las 10 peores órdenes")}</h3>
      <div className="tbl-scroll tbl-caja">
        <table className="orders" data-kpi-peores>
          <thead><tr><th>{t("Invoice", "Factura")}</th><th>{t("Store", "Tienda")}</th><th className="num">{t("Minutes late", "Minutos tarde")}</th><th>{t("Picked up", "Recogida")}</th><th>{t("Marked ready by", "La marcó lista")}</th></tr></thead>
          <tbody>
            {d.peores.length === 0 && <tr><td colSpan={5} className="hint">{t("Every order was ready on time.", "Todas las órdenes estuvieron listas a tiempo.")}</td></tr>}
            {d.peores.map((o) => (
              <tr key={o.id} data-orden={o.id}>
                <td>{o.factura}</td>
                <td>{o.tienda}</td>
                <td className="num ops-kpi-rojo" data-minutos={o.minutos ?? ""}>{o.minutos === null ? t("never marked", "nunca marcada") : `${-o.minutos} min`}</td>
                <td>{fmtDateTime(o.recogidaEn)}</td>
                <td>{o.quienMarcoNombre ?? (o.quienMarco ? "—" : t("nobody", "nadie"))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
