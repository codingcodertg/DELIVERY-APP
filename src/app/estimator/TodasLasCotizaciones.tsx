"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto, type ColumnaConMenu } from "@/components/CabeceraConMenu";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import type { AlmacenDeCotizaciones } from "@/lib/estimator/almacen";
import { filtraEstimados, masNuevoPrimero, type AlmacenDeCompetencia, type EstimadoDeCompetencia } from "@/lib/estimator/competencia";
import {
  COLUMNAS_DE_LA_TABLA, TANDA, atajoEncendido, fechaDeCelda, filtraCompetenciaComoLaTabla, filtroVacio, pasoDeRango, puedeVerTodas,
  rangoAcotado, rangoDeAtajo, textoDeEstado, valorDeColumna,
  type AtajoDeRango, type CotizacionResumen, type FiltroDeCotizaciones, type RangoDeFechas,
} from "@/lib/estimator/lista-admin";
import { dinero } from "@/lib/estimator/modelo";
import { todayISO } from "@/lib/utils";
import { AvisoSin156, ListaDeEstimados } from "./EstimadosCompetencia";

type T = (en: string, es: string) => string;
type Yo = { id: string; name: string; admin: boolean; store?: string | null };

/**
 * El calendario del Panel (`dashboard/page.tsx`), tal cual: ◀ Desde Hasta ▶ · Hoy · Esta semana · Este mes · Mes pasado,
 * y aquí además «Todo». El dueño (2026-10-06): «PON EL CALENDARIO QUE SIEMPRE HEMOS PEUSTO». Las cuentas, en `lista-admin`.
 */
export function RangoDelPanel({ rango, onRango, t }: { rango: RangoDeFechas; onRango: (r: RangoDeFechas) => void; t: T }) {
  const hoy = todayISO();
  const encendido = atajoEncendido(rango);
  const atajo = (a: AtajoDeRango, texto: string) => (
    <button type="button" className={"btn btn-sm " + (encendido === a ? "btn-primary" : "btn-ghost")} data-atajo={a} onClick={() => onRango(rangoDeAtajo(a))}>
      {texto}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-rango-fechas>
      <button type="button" className="btn btn-ghost btn-sm" data-rango-paso="-1" onClick={() => onRango(pasoDeRango(rango, -1))} title={t("Previous period", "Período anterior")}>◀</button>
      <label style={{ margin: 0, textTransform: "none", letterSpacing: 0 }}>
        {t("From", "Desde")}
        <input type="date" value={rango.desde} max={rango.hasta || hoy} data-rango-desde
          onChange={(e) => onRango(rangoAcotado(e.target.value, rango.hasta, "custom"))} style={{ width: 150, marginTop: 2 }} />
      </label>
      <label style={{ margin: "0 0 0 10px", textTransform: "none", letterSpacing: 0 }}>
        {t("To", "Hasta")}
        <input type="date" value={rango.hasta} min={rango.desde || undefined} max={hoy} data-rango-hasta
          onChange={(e) => onRango(rangoAcotado(rango.desde, e.target.value, "custom"))} style={{ width: 150, marginTop: 2 }} />
      </label>
      <button type="button" className="btn btn-ghost btn-sm" data-rango-paso="1" onClick={() => onRango(pasoDeRango(rango, 1))} title={t("Next period", "Período siguiente")}>▶</button>
      <span style={{ width: 1, height: 24, background: "var(--line)", margin: "0 2px" }} />
      {atajo("hoy", t("Today", "Hoy"))}
      {atajo("semana", t("This week", "Esta semana"))}
      {atajo("mes", t("This month", "Este mes"))}
      {atajo("mes-pasado", t("Last month", "Mes pasado"))}
      {atajo("todo", t("All", "Todo"))}
    </div>
  );
}

/**
 * La pestaña «All quotes / Todas las cotizaciones» (D-476), **solo para el admin**. El dueño, 2026-10-06: «en el quote
 * builder solo para admin habilita la lista de todas las quotes ya hechas y las de los comeptirodes tambien».
 *
 * Rehecha con los patrones de la casa (D-478, «SE MIR MUY FEO ESOS FILTROS PON EL CALENDARIO QUE SIEMPRE HEMOS PEUSTO Y
 * LOS FILTROS ASI COMO EN LAS TABLES QUE HEMOS EHCHO»): la barra `.filters` con la búsqueda compacta de Órdenes y el
 * calendario del Panel; la tabla `table.orders` con el menú de ordenar y filtrar por columna de Órdenes / Gestor de
 * Rutas (`CabeceraConMenu`, `MenuDeColumnaAbierto`, `FiltrosPuestos`: D-275, D-360) en Fecha, #, Vendedor, Tienda,
 * Cliente, Total y Estado. A la base van fechas y texto, por tandas de `TANDA`; los filtros de columna acotan lo cargado.
 *
 * «Abrir» carga la cotización en la pestaña Cotización (el admin la edita e imprime: la RLS de la 148 lo permite). Debajo,
 * todos los estimados de la competencia (156), que **heredan** fechas, texto y los filtros de Vendedor y Tienda.
 * Quién puede ver cuántas lo decide la base; si no es admin no se pinta nada (y la pestaña ni se ofrece).
 */
export function TodasLasCotizaciones({ almacen, competencia, me, t, lang, onAbrir }: {
  almacen: AlmacenDeCotizaciones; competencia: AlmacenDeCompetencia; me: Yo; t: T; lang: "en" | "es";
  onAbrir: (quoteId: string) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDeCotizaciones>(() => filtroVacio());
  const [modo, setModo] = useState<RangoDeFechas["modo"]>("custom");
  const [filas, setFilas] = useState<CotizacionResumen[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [tanda, setTanda] = useState(0);
  const [estado, setEstado] = useState<"cargando" | "sin-base" | "lista">("cargando");
  const [error, setError] = useState<string | null>(null);
  const [estimados, setEstimados] = useState<EstimadoDeCompetencia[]>([]);
  const [estadoCompetencia, setEstadoCompetencia] = useState<"cargando" | "sin-156" | "lista">("cargando");
  const [errorCompetencia, setErrorCompetencia] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const rango: RangoDeFechas = { desde: filtro.desde, hasta: filtro.hasta, modo };
  const ponRango = (r: RangoDeFechas) => { setModo(r.modo); setFiltro((f) => ({ ...f, desde: r.desde, hasta: r.hasta })); };

  const cargar = useCallback(async (f: FiltroDeCotizaciones, n: number) => {
    if (!puedeVerTodas(me)) return;
    setOcupado(true);
    const r = await almacen.listarTodas(f, n);
    setOcupado(false);
    if (!r.ok) {
      if (r.sinTabla) { setEstado("sin-base"); return; }
      setEstado("lista");
      setError(`${t("Could not read the quotes", "No se pudieron leer las cotizaciones")}: ${r.error}`);
      return;
    }
    setError(null);
    setEstado("lista");
    setFilas((previas) => (n === 0 ? r.valor.filas : [...previas, ...r.valor.filas]));
    setHayMas(r.valor.hayMas);
    setTanda(n);
  }, [almacen, me, t]);

  // Fechas o texto reinician la lista a la primera tanda, tras una pausa para no pedir en cada tecla.
  useEffect(() => {
    if (!puedeVerTodas(me)) return;
    const id = setTimeout(() => { void cargar(filtro, 0); }, 300);
    return () => clearTimeout(id);
  }, [filtro, cargar, me]);

  const cargarCompetencia = useCallback(async () => {
    const e = await competencia.listarTodos();
    if (e.ok) { setEstimados(masNuevoPrimero(e.valor)); setEstadoCompetencia("lista"); return; }
    if (e.sinTabla) { setEstadoCompetencia("sin-156"); return; }
    setEstadoCompetencia("lista");
    setErrorCompetencia(`${t("Could not read the competitor estimates", "No se pudieron leer los estimados de la competencia")}: ${e.error}`);
  }, [competencia, t]);
  useEffect(() => { if (puedeVerTodas(me)) void cargarCompetencia(); }, [cargarCompetencia, me]);

  // El menú por columna de Órdenes (D-275) sobre lo cargado: `valorDe` estable, como pide el hook.
  const valorDe = useCallback((clave: string, c: CotizacionResumen) => valorDeColumna(clave, c, t), [t]);
  const orden = useOrdenYFiltro(filas, valorDe);
  const columnas: ColumnaConMenu[] = useMemo(
    () => COLUMNAS_DE_LA_TABLA.map((c) => (c.key === "total" ? { ...c, etiqueta: (v) => (typeof v === "number" ? dinero(v) : "—") } : { ...c })),
    [],
  );

  const estimadosVisibles = useMemo(
    () => filtraCompetenciaComoLaTabla(estimados, filtro, orden.filtros, (e, texto) => filtraEstimados([e], { tienda: "", texto }).length > 0),
    [estimados, filtro, orden.filtros],
  );
  const abrir = async (e: EstimadoDeCompetencia) => {
    const r = await competencia.abrir(e);
    if (!r.ok) { setErrorCompetencia(`${t("Could not open the file", "No se pudo abrir el archivo")}: ${r.error}`); return; }
    window.open(r.valor, "_blank", "noopener,noreferrer");
  };
  // Quitar, como en la pestaña de la competencia (D-451): la base solo deja a quien lo subió o al admin.
  const quitar = async (e: EstimadoDeCompetencia) => {
    setOcupado(true);
    const r = await competencia.quitar(e);
    setOcupado(false);
    setConfirmando(null);
    if (!r.ok) { setErrorCompetencia(`${t("Not removed", "No se quitó")}: ${r.error}`); return; }
    await cargarCompetencia();
  };

  // Nunca para quien no es admin: la pestaña no se ofrece, y si alguien llegara aquí igual, no pide nada.
  if (!puedeVerTodas(me)) return null;

  const filtrando = !!(filtro.desde || filtro.hasta || filtro.texto.trim());

  return (
    <div data-pestana-todas={estado}>
      <div className="card">
        <h2>📚 {t("All quotes", "Todas las cotizaciones")} <span className="hint">({orden.visibles.length}{hayMas ? "+" : ""})</span></h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("Admin only: every saved quote, from every sales rep and store, newest first.", "Solo admin: todas las cotizaciones guardadas, de todos los vendedores y tiendas, de la más reciente a la más vieja.")}
        </p>
        {estado === "sin-base" && (
          <p className="hint" data-todas-sin-base>
            {t("Not available yet: the database has not been updated (migration 148).", "Todavía no disponible: falta actualizar la base (migración 148).")}
          </p>
        )}
        {error && <div className="est-aviso rojo" data-todas-error>{error}</div>}
        {estado !== "sin-base" && (
          <>
            {/* La barra de filtros de Órdenes: búsqueda compacta y, al lado, el calendario del Panel. */}
            <div className="filters">
              <input style={{ maxWidth: 260 }} value={filtro.texto} data-todas-texto placeholder={t("Search…", "Buscar…")}
                title={t("Estimate # or customer", "# de estimado o cliente")} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
              <RangoDelPanel rango={rango} onRango={ponRango} t={t} />
            </div>
            <FiltrosPuestos estado={orden} columnas={columnas} lang={lang} t={t} />
            {estado === "cargando" ? (
              <p className="hint">{t("Loading…", "Cargando…")}</p>
            ) : filas.length === 0 ? (
              <p className="hint" data-todas-vacia>
                {filtrando ? t("Nothing matches the filter.", "Nada coincide con el filtro.") : t("No saved quotes yet.", "Todavía no hay cotizaciones guardadas.")}
              </p>
            ) : (
              <div className="tbl-scroll">
                <table className="orders" data-todas-tabla style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      {columnas.map((c) => <th key={c.key}><CabeceraConMenu estado={orden} col={c} lang={lang} t={t} /></th>)}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orden.visibles.length === 0 ? (
                      <tr><td colSpan={columnas.length + 1} className="empty" data-todas-vacia>{t("No rows match the current filters.", "Ninguna fila coincide con los filtros actuales.")}</td></tr>
                    ) : orden.visibles.map((c) => (
                      <tr key={c.id} data-cotizacion={c.id} className="clickable" onClick={() => onAbrir(c.id)}>
                        <td>{fechaDeCelda(c.created_at)}</td>
                        <td><b>{c.estimate_num || "—"}</b></td>
                        <td data-cotizacion-vendedor>{c.owner_name ?? (c.owner_id ? "?" : t("(no owner)", "(sin dueño)"))}</td>
                        <td data-cotizacion-tienda>{c.store ?? t("No store", "Sin tienda")}</td>
                        <td data-cotizacion-cliente>{c.customer_name || "—"}</td>
                        <td style={{ textAlign: "right" }} data-cotizacion-total>{dinero(c.total)}</td>
                        <td data-cotizacion-estado>{textoDeEstado(c, t)}</td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" data-cotizacion-abrir onClick={(e) => { e.stopPropagation(); onAbrir(c.id); }}>
                            {t("Open", "Abrir")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <MenuDeColumnaAbierto estado={orden} columnas={columnas} lang={lang} t={t} />
            {hayMas && (
              <div className="est-acciones" style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" data-todas-mas disabled={ocupado} onClick={() => void cargar(filtro, tanda + 1)}>
                  {t(`Load ${TANDA} more`, `Cargar ${TANDA} más`)}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>🕵️ {t("All competitor estimates", "Todos los estimados de la competencia")} <span className="hint">({estimadosVisibles.length})</span></h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("Who uploaded it, when, the competitor company and which quote it belongs to. The dates, the search and the Sales rep / Store column filters above apply here too.", "Quién lo subió, cuándo, la empresa competidora y a qué cotización pertenece. Las fechas, la búsqueda y los filtros de columna Vendedor / Tienda de arriba valen aquí también.")}
        </p>
        {estadoCompetencia === "sin-156" && <AvisoSin156 t={t} />}
        {errorCompetencia && <div className="est-aviso rojo" data-todas-competencia-error>{errorCompetencia}</div>}
        {estadoCompetencia === "lista" && (
          <ListaDeEstimados estimados={estimadosVisibles} me={me} t={t} lang={lang} confirmando={confirmando} ocupado={ocupado}
            filtrando={filtrando || !!orden.filtros.vendedor?.size || !!orden.filtros.tienda?.size}
            onAbrir={(e) => void abrir(e)} onQuitar={(e) => void quitar(e)} onConfirmar={setConfirmando}
            onAbrirCotizacion={onAbrir} />
        )}
      </div>
    </div>
  );
}
