"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";
import { usePrefs } from "@/lib/prefs";
import { fmtMoney } from "@/lib/utils";
import { fmtDia, hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { META_DE_MERMA_PCT, mesesHastaHoy, truncaDecimales, type NivelDeBono } from "@/lib/almacen-ops/kpi-almacen";
import type { Contexto } from "./Operaciones";

/** Lo que devuelve `/api/almacen-ops/kpi-almacen` (la forma de `route.ts`). */
interface Respuesta {
  ok: true;
  tienda: string;
  mes: string;
  desde: string;
  hasta: string;
  aviso: string | null;
  listas: { buenas: number; malas: number; excluidas: number; recogidas: number; pct: number | null };
  merma: { valor: number; ventas: number | null; pct: number | null; cumple: boolean | null; filas: number; ventasFilas: number; ventasHasta: string | null } | null;
  tiempo: { turnos: number; bien: number; pct: number | null; horas: number; personas: number } | null;
  puntaje: number | null;
  bono: NivelDeBono | null;
  cortado: boolean;
}

type Carga = { estado: "cargando" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Respuesta };

/**
 * KPIs de almacén (vista «KPIs de almacén»): a la izquierda los reportes; a la derecha el selector de tienda y de mes,
 * los cuatro KPI y el tramo del bono. Las reglas viven en `src/lib/almacen-ops/kpi-almacen.ts`; aquí solo se pinta.
 */
export function KpisDeAlmacen({ ctx }: { ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const hoy = hoyEnTexas();
  const meses = useMemo(() => mesesHastaHoy(hoy, 12), [hoy]);
  const tiendas = ctx.tiendas;
  const [tienda, setTienda] = useState<string>(tiendas[0] ?? ctx.yo.store ?? "");
  const [mes, setMes] = useState<string>(meses[0] ?? "");
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });

  useEffect(() => {
    if (!tienda || !mes) return;
    if (ctx.demo) { setCarga({ estado: "listo", datos: { ...DEMO, tienda, mes } }); return; }
    let vivo = true;
    setCarga({ estado: "cargando" });
    (async () => {
      try {
        const r = await fetch(`/api/almacen-ops/kpi-almacen?store=${encodeURIComponent(tienda)}&month=${encodeURIComponent(mes)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok || !j.ok) { setCarga({ estado: "error", mensaje: j.error ?? `HTTP ${r.status}` }); return; }
        setCarga({ estado: "listo", datos: j as Respuesta });
      } catch (e) {
        if (vivo) setCarga({ estado: "error", mensaje: mensajeDeErrorAlCargar(e) });
      }
    })();
    return () => { vivo = false; };
  }, [tienda, mes, ctx.demo]);

  const nombreDelMes = (m: string) => {
    const [a, n] = m.split("-").map(Number);
    const s = new Intl.DateTimeFormat(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, n - 1, 15)));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  return (
    <div className="ops-kpi-almacen" data-kpis-almacen>
      <header className="ops-kpi-almacen-cabeza">
        <Link href="/operaciones" className="ops-boton ops-boton-chico" data-accion="volver">← {t("Back", "Volver")}</Link>
        <h2>{t("Warehouse KPIs", "KPIs de almacén")}</h2>
      </header>

      <div className="ops-kpi-almacen-grid">
        <nav className="ops-kpi-almacen-reportes" aria-label={t("Reports", "Reportes")} data-reportes-izq>
          <h3 className="ops-merma-titulo">{t("Reports", "Reportes")}</h3>
          <Link href="/operaciones/reportes" className="ops-boton ops-boton-ancho" data-ir="reportes">🧱 {t("Scrap and reports", "Merma y reportes")}</Link>
          <Link href="/operaciones/mantenimiento" className="ops-boton ops-boton-ancho" data-ir="mantenimiento">🔧 {t("Maintenance", "Mantenimiento")}</Link>
          <Link href="/operaciones/conteos" className="ops-boton ops-boton-ancho" data-ir="conteos">🔢 {t("Inventory counts", "Conteos de inventario")}</Link>
        </nav>

        <section className="ops-kpi-almacen-kpis" data-kpis-derecha>
          <div className="ops-kpi-almacen-filtros">
            <label className="ops-fecha">{t("Store", "Tienda")}
              <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda">
                {tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="ops-fecha">{t("Month", "Mes")}
              <select value={mes} onChange={(e) => setMes(e.target.value)} data-campo="mes">
                {meses.map((m) => <option key={m} value={m}>{nombreDelMes(m)}</option>)}
              </select>
            </label>
          </div>

          {carga.estado === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}
          {carga.estado === "error" && <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>}
          {carga.estado === "listo" && <Cifras d={carga.datos} t={t} lang={lang} />}
        </section>
      </div>
    </div>
  );
}

/** Las cuatro cifras y el bono de un mes. Separado para que el estado de carga quede limpio arriba. */
function Cifras({ d, t, lang }: { d: Respuesta; t: (en: string, es: string) => string; lang: "en" | "es" }) {
  const sinMigracion = d.aviso === "migration-325";
  const pctListas = d.listas.pct === null ? "—" : `${truncaDecimales(d.listas.pct, 1).toFixed(1)}%`;
  const colorListas = d.listas.pct === null ? "gris" : d.listas.pct >= 90 ? "verde" : d.listas.pct >= 70 ? "ambar" : "rojo";
  const m = d.merma;
  const colorMerma = m?.cumple === true ? "verde" : m?.cumple === false ? "rojo" : "gris";
  const pctMerma = m?.pct === null || m?.pct === undefined ? null : truncaDecimales(m.pct, 2).toFixed(2);
  const tm = d.tiempo;
  const pctTiempo = tm?.pct === null || tm?.pct === undefined ? "—" : `${truncaDecimales(tm.pct, 1).toFixed(1)}%`;
  const colorTiempo = tm?.pct === null || tm?.pct === undefined ? "gris" : tm.pct >= 95 ? "verde" : tm.pct >= 90 ? "ambar" : "rojo";
  const puntaje = d.puntaje === null ? "—" : `${truncaDecimales(d.puntaje, 1).toFixed(1)}`;
  const etiquetaBono: Record<NivelDeBono, string> = {
    completo: t("Full bonus", "Bono completo"),
    medio: t("Half bonus", "Medio bono"),
    cuarto: t("Quarter bonus", "Un cuarto de bono"),
    ninguno: t("No bonus", "Sin bono"),
  };
  const ventasHastaIncompleto = m?.ventasHasta && m.ventas !== null && m.ventasHasta < d.hasta;

  return (
    <div data-kpi-almacen-cifras data-bono={d.bono ?? ""} data-puntaje={d.puntaje ?? ""}>
      {/* Puntaje y tramo del bono */}
      <div className="ops-merma-total ops-kpi-almacen-bono" data-bono-tramo>
        <span>{t("Overall score", "Puntaje general")}</span>
        <span className="ops-merma-cifra">{puntaje}{d.puntaje === null ? "" : " / 100"}</span>
        <span>
          {d.bono ? <b>{etiquetaBono[d.bono]}</b> : t("No data yet to score this month.", "Aún no hay datos para calificar el mes.")}
          {" · "}{t("Full at 100, half at 95+, quarter at 90+, none under 90.", "Completo en 100, medio en 95+, un cuarto en 90+, nada bajo 90.")}
        </span>
        <span className="hint" data-nota-bono>
          {t("Bonuses require using the app: what is not recorded here cannot be scored.", "Los bonos requieren usar la app: lo que no se registra aquí no se puede calificar.")}
        </span>
      </div>

      {sinMigracion && (
        <p className="ops-aviso ops-aviso-error" data-aviso-325>
          {t("Scrap, sales and clock-in numbers need database migration 325. Until it is applied they show “no data”.",
            "La merma, las ventas y los fichajes necesitan la migración 325 de la base. Mientras no esté aplicada salen «sin datos».")}
        </p>
      )}

      <div className="ops-merma-totales ops-kpi-almacen-tarjetas">
        {/* 1. Listas a tiempo: un solo porcentaje */}
        <div className="ops-merma-total ops-merma-total-rango" data-kpi="listas">
          <span>{t("Ready on time", "Listas a tiempo")}</span>
          <span className={`ops-merma-cifra ops-kpi-${colorListas}`} data-kpi-listas-pct>{pctListas}</span>
          <span>{d.listas.buenas} / {d.listas.buenas + d.listas.malas} {t("orders", "órdenes")}</span>
          {d.listas.excluidas > 0 && (
            <span className="hint" data-listas-excluidas>
              {t(`${d.listas.excluidas} not counted: created less than 4 hours before pickup.`, `${d.listas.excluidas} no cuentan: se crearon a menos de 4 horas de la recogida.`)}
            </span>
          )}
        </div>

        {/* 2. Merma a precio de venta vs. ventas */}
        <div className="ops-merma-total" data-kpi="merma">
          <span>{t("Scrap at sales price", "Merma a precio de venta")}</span>
          <span className={`ops-merma-cifra ops-kpi-${colorMerma}`} data-kpi-merma-valor>{m ? fmtMoney(m.valor) : "—"}</span>
          <span>{t("Sales this month", "Ventas del mes")}: <span data-kpi-ventas>{m?.ventas === null || m === null ? t("no sales data", "sin datos de ventas") : fmtMoney(m.ventas)}</span></span>
          <span>{t("Scrap as % of sales", "Merma como % de ventas")}: <b className={`ops-kpi-${colorMerma}`} data-kpi-merma-pct>{pctMerma === null ? "—" : `${pctMerma}%`}</b>
            {" · "}{t(`target under ${META_DE_MERMA_PCT}%`, `meta menos de ${META_DE_MERMA_PCT}%`)}</span>
          {m && m.cumple === true && <span className="ops-kpi-verde">{t("Within target", "Dentro de la meta")}</span>}
          {m && m.cumple === false && <span className="ops-kpi-rojo">{t("Over target", "Fuera de la meta")}</span>}
          {ventasHastaIncompleto && (
            <span className="hint" data-ventas-incompletas>{t(`Sales loaded only through ${fmtDia(m!.ventasHasta!, lang)}; the month may be incomplete.`, `Ventas cargadas solo hasta ${fmtDia(m!.ventasHasta!, lang)}; el mes puede estar incompleto.`)}</span>
          )}
        </div>

        {/* 3. Fichajes del personal de almacén */}
        <div className="ops-merma-total" data-kpi="tiempo">
          <span>{t("Clocked in and out properly", "Turnos fichados bien")}</span>
          <span className={`ops-merma-cifra ops-kpi-${colorTiempo}`} data-kpi-tiempo-pct>{pctTiempo}</span>
          <span>{tm ? `${tm.bien} / ${tm.turnos} ${t("shifts", "turnos")}` : "—"}</span>
          <span>{t("Hours worked (closed shifts)", "Horas trabajadas (turnos cerrados)")}: <span data-kpi-horas>{tm ? tm.horas.toFixed(1) : "—"}</span></span>
          <span className="hint">{t("Counts shifts closed by the person themselves: not automatic, not fixed by hand.", "Cuenta los turnos que la persona cerró ella misma: no automáticos ni corregidos a mano.")}</span>
        </div>
      </div>

      {d.cortado && <p className="ops-aviso ops-aviso-error">{t("Too many orders this month; the on-time figure is partial.", "Demasiadas órdenes este mes; el porcentaje de listas es parcial.")}</p>}
      <p className="hint" data-regla>
        {t("On time = the warehouse marked the order “ready” before the driver picked it up. Not ready (late or never marked) counts against the warehouse, except when the order was created less than 4 hours before pickup. Days are Texas days.",
          "A tiempo = el almacén marcó la orden «lista» antes de que el chofer la recogiera. No lista (tarde o nunca marcada) cuenta contra el almacén, salvo que la orden se creara a menos de 4 horas de la recogida. Los días son los de Texas.")}
      </p>
    </div>
  );
}

/** Datos de muestra para el modo demo (sin base). */
const DEMO: Respuesta = {
  ok: true, tienda: "McAllen", mes: "", desde: "", hasta: "", aviso: null,
  listas: { buenas: 34, malas: 4, excluidas: 3, recogidas: 41, pct: 89.47 },
  merma: { valor: 1240.5, ventas: 310000, pct: 0.4, cumple: true, filas: 9, ventasFilas: 812, ventasHasta: null },
  tiempo: { turnos: 52, bien: 49, pct: 94.23, horas: 318.5, personas: 6 },
  puntaje: 94.5, bono: "cuarto", cortado: false,
};
