"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AlmacenDeCotizaciones } from "@/lib/estimator/almacen";
import { filtraEstimados, masNuevoPrimero, type AlmacenDeCompetencia, type EstimadoDeCompetencia } from "@/lib/estimator/competencia";
import { fechaHora } from "@/lib/encuestas/resumen";
import {
  TANDA, estadoDeCotizacion, filtroVacio, hayFiltro, puedeVerTodas, tiendasDelFiltro,
  type CotizacionResumen, type FiltroDeCotizaciones, type Vendedor,
} from "@/lib/estimator/lista-admin";
import { dinero } from "@/lib/estimator/modelo";
import { AvisoSin156, ListaDeEstimados } from "./EstimadosCompetencia";

type T = (en: string, es: string) => string;
type Yo = { id: string; name: string; admin: boolean; store?: string | null };

/** La tabla de cotizaciones, aparte para probarla sin navegador: fecha, vendedor, tienda, cliente, total, estado y «Abrir». */
export function TablaDeCotizaciones({ filas, t, filtrando, onAbrir }: {
  filas: CotizacionResumen[]; t: T; filtrando: boolean; onAbrir: (id: string) => void;
}) {
  if (!filas.length) {
    return (
      <p className="hint" data-todas-vacia>
        {filtrando ? t("Nothing matches the filter.", "Nada coincide con el filtro.") : t("No saved quotes yet.", "Todavía no hay cotizaciones guardadas.")}
      </p>
    );
  }
  return (
    <div className="est-prod-tabla">
      <table data-todas-tabla>
        <thead>
          <tr>
            <th>{t("Date", "Fecha")}</th>
            <th>{t("Estimate #", "# de estimado")}</th>
            <th>{t("Sales rep", "Vendedor")}</th>
            <th>{t("Store", "Tienda")}</th>
            <th>{t("Customer", "Cliente")}</th>
            <th style={{ textAlign: "right" }}>{t("Total", "Total")}</th>
            <th>{t("Status", "Estado")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => {
            const estado = estadoDeCotizacion(c);
            return (
              <tr key={c.id} data-cotizacion={c.id}>
                <td style={{ whiteSpace: "nowrap" }}>{c.created_at ? fechaHora(c.created_at) : "—"}</td>
                <td><b>{c.estimate_num || "—"}</b></td>
                <td data-cotizacion-vendedor>{c.owner_name ?? (c.owner_id ? "?" : t("(no owner)", "(sin dueño)"))}</td>
                <td data-cotizacion-tienda>{c.store ?? t("No store", "Sin tienda")}</td>
                <td data-cotizacion-cliente>{c.customer_name || "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }} data-cotizacion-total>{dinero(c.total)}</td>
                <td data-cotizacion-estado={estado}>
                  {estado === "impresa"
                    ? `${t("Printed", "Impresa")}${c.print_count > 1 ? ` ×${c.print_count}` : ""}`
                    : t("Saved, not printed", "Guardada, sin imprimir")}
                </td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" data-cotizacion-abrir onClick={() => onAbrir(c.id)}>
                    {t("Open", "Abrir")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * La pestaña «All quotes / Todas las cotizaciones» (D-476), **solo para el admin**. El dueño, 2026-10-06: «en el quote
 * builder solo para admin habilita la lista de todas las quotes ya hechas y las de los comeptirodes tambien».
 *
 * Arriba, todas las cotizaciones guardadas, de todos los vendedores y tiendas, de la más reciente a la más vieja, con
 * filtro por vendedor, tienda, fechas y texto, por tandas de `TANDA`; «Abrir» la carga en la pestaña Cotización (el
 * admin la puede editar e imprimir: la RLS de la 148 se lo permite). Abajo, todos los estimados de la competencia (156),
 * con quién lo subió, cuándo, la empresa competidora y a qué cotización va pegado, con el mismo filtro de tienda y texto.
 *
 * Quién puede ver cuántas lo decide la base: esto solo pinta lo que devuelve. Si no es admin, no se pinta nada (y la
 * pestaña ni se ofrece: `pestanasDe`).
 */
export function TodasLasCotizaciones({ almacen, competencia, me, tiendas, t, lang, onAbrir }: {
  almacen: AlmacenDeCotizaciones; competencia: AlmacenDeCompetencia; me: Yo; tiendas: string[]; t: T; lang: string;
  onAbrir: (quoteId: string) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroDeCotizaciones>(() => filtroVacio());
  const [filas, setFilas] = useState<CotizacionResumen[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [tanda, setTanda] = useState(0);
  const [estado, setEstado] = useState<"cargando" | "sin-base" | "lista">("cargando");
  const [error, setError] = useState<string | null>(null);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [estimados, setEstimados] = useState<EstimadoDeCompetencia[]>([]);
  const [estadoCompetencia, setEstadoCompetencia] = useState<"cargando" | "sin-156" | "lista">("cargando");
  const [errorCompetencia, setErrorCompetencia] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

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

  // El filtro reinicia la lista a la primera tanda, tras una pausa para no pedir en cada tecla.
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

  useEffect(() => {
    if (!puedeVerTodas(me)) return;
    void (async () => {
      const v = await almacen.vendedores();
      if (v.ok) setVendedores(v.valor);
      await cargarCompetencia();
    })();
  }, [almacen, cargarCompetencia, me]);

  const tiendasDelDesplegable = useMemo(() => tiendasDelFiltro(tiendas, [...filas, ...estimados]), [tiendas, filas, estimados]);
  const estimadosVisibles = useMemo(() => filtraEstimados(estimados, { tienda: filtro.tienda, texto: filtro.texto }), [estimados, filtro.tienda, filtro.texto]);
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

  return (
    <div data-pestana-todas={estado}>
      <div className="card">
        <h2>📚 {t("All quotes", "Todas las cotizaciones")} <span className="hint">({filas.length}{hayMas ? "+" : ""})</span></h2>
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
            <div className="grid g3" style={{ marginBottom: 10 }}>
              <div className="field">
                <label htmlFor="todas-vendedor">{t("Sales rep", "Vendedor")}</label>
                <select id="todas-vendedor" value={filtro.vendedor} data-todas-vendedor onChange={(e) => setFiltro({ ...filtro, vendedor: e.target.value })}>
                  <option value="">{t("All sales reps", "Todos los vendedores")}</option>
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name ?? v.id}{v.store ? ` · ${v.store}` : ""}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="todas-tienda">{t("Store", "Tienda")}</label>
                <select id="todas-tienda" value={filtro.tienda} data-todas-tienda onChange={(e) => setFiltro({ ...filtro, tienda: e.target.value })}>
                  <option value="">{t("All stores", "Todas las tiendas")}</option>
                  {tiendasDelDesplegable.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="todas-texto">{t("Search", "Buscar")}</label>
                <input id="todas-texto" value={filtro.texto} data-todas-texto placeholder={t("Estimate #, customer…", "# de estimado, cliente…")}
                  onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="todas-desde">{t("From", "Desde")}</label>
                <input id="todas-desde" type="date" value={filtro.desde} data-todas-desde onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="todas-hasta">{t("To", "Hasta")}</label>
                <input id="todas-hasta" type="date" value={filtro.hasta} data-todas-hasta onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} />
              </div>
              {hayFiltro(filtro) && (
                <div className="field" style={{ alignSelf: "end" }}>
                  <button type="button" className="btn btn-ghost btn-sm" data-todas-limpiar onClick={() => setFiltro(filtroVacio())}>✕ {t("Clear filters", "Quitar filtros")}</button>
                </div>
              )}
            </div>
            {estado === "cargando"
              ? <p className="hint">{t("Loading…", "Cargando…")}</p>
              : <TablaDeCotizaciones filas={filas} t={t} filtrando={hayFiltro(filtro)} onAbrir={onAbrir} />}
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
          {t("Who uploaded it, when, the competitor company and which quote it belongs to. The store and search filters above apply here too.", "Quién lo subió, cuándo, la empresa competidora y a qué cotización pertenece. Los filtros de tienda y búsqueda de arriba valen aquí también.")}
        </p>
        {estadoCompetencia === "sin-156" && <AvisoSin156 t={t} />}
        {errorCompetencia && <div className="est-aviso rojo" data-todas-competencia-error>{errorCompetencia}</div>}
        {estadoCompetencia === "lista" && (
          <ListaDeEstimados estimados={estimadosVisibles} me={me} t={t} lang={lang} confirmando={confirmando} ocupado={ocupado}
            filtrando={!!(filtro.tienda || filtro.texto.trim())}
            onAbrir={(e) => void abrir(e)} onQuitar={(e) => void quitar(e)} onConfirmar={setConfirmando}
            onAbrirCotizacion={onAbrir} />
        )}
      </div>
    </div>
  );
}
