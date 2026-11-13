"use client";

import { useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { CabeceraConMenu, FiltrosPuestos, MenuDeColumnaAbierto } from "@/components/CabeceraConMenu";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";
import { claveDeAnchos } from "@/lib/tabla-estandar";
import { useVistaDeColumnas } from "@/lib/use-vista-de-columnas";

/**
 * LA TABLA ESTÁNDAR de RTG Hub (dueño, 12 nov 2026): las columnas de TODA tabla de datos se comportan como las de
 * Órdenes (Entregas). Guía y ejemplo: `docs/ESTANDAR-DE-TABLAS.md`. Con este componente una tabla nueva trae de fábrica:
 *
 *   · ▾ en cada cabecera: ordenar y filtrar por valores (`useOrdenYFiltro` + `CabeceraConMenu`), y la barra
 *     «Filtrado por…» para que un filtro no se olvide puesto (`FiltrosPuestos`).
 *   · ⚙ Columnas: mostrar / ocultar y mover con ↑ ↓ o arrastrando el renglón (`SelectorDeColumnas`).
 *   · Arrastrar la cabecera para mover la columna; arrastrar el borde para el ancho, doble clic lo restablece
 *     (`useColWidthMap` + `tbl-resize`).
 *   · Todo se guarda por persona en este navegador (clave `rtg:tabla:<id>:…`).
 *   · El mismo aspecto: `table.orders.tbl-resize` dentro de `.tbl-scroll.tbl-fit.tbl-caja`.
 *
 * Cada columna dice cómo sacar su VALOR (para ordenar y filtrar) y, si hace falta, cómo PINTAR la celda.
 */
export interface ColumnaEstandar<F> {
  key: string; en: string; es: string;
  /** Lo que ordena y filtra. Texto, número o null. */
  valor: (f: F) => ValorDeCelda;
  /** Lo que se pinta. Sin esto, el valor (o «—»). */
  celda?: (f: F) => ReactNode;
  /** Cómo se enseña cada valor en el menú de filtro (p. ej. una fecha). */
  etiqueta?: (v: ValorDeCelda) => string;
  /** Ancho de partida en px (la persona lo cambia arrastrando). */
  ancho?: number;
  numerico?: boolean;
  /** Siempre visible: se mueve, no se quita. */
  fija?: true;
  /** Nace oculta: se prende en ⚙ Columnas. */
  oculta?: true;
  /** Clase del `<td>` (p. ej. "num"). */
  clase?: string;
  /** El texto de la celda no se corta con «…» (notas largas). */
  envuelve?: true;
}

export function TablaEstandar<F>({
  id, columnas, filas, claveDe, onFila, vacio, acciones, anchoDeAcciones = 120, claseDeFila, barra, sinCaja, "data-tabla": dataTabla,
  ordenInicial, claseTabla, estiloTabla, totales,
}: {
  /** Único en toda la app: con él se guarda la vista de cada persona. */
  id: string;
  columnas: readonly ColumnaEstandar<F>[];
  filas: readonly F[];
  claveDe: (f: F) => string;
  /** Clic (o Enter) en la fila: abrir su ficha EN TARJETA, nunca saltar a otra pantalla. */
  onFila?: (f: F) => void;
  /** Qué decir cuando no hay filas. */
  vacio?: ReactNode;
  /** Una última columna de botones por fila (sin menú, sin mover). */
  acciones?: (f: F) => ReactNode;
  anchoDeAcciones?: number;
  claseDeFila?: (f: F) => string | undefined;
  /** Lo que va en la barra de arriba, a la izquierda del ⚙ (buscador, botones). */
  barra?: ReactNode;
  /** Sin la caja de alto fijo con cabecera pegada (tablas chicas dentro de una tarjeta). */
  sinCaja?: boolean;
  "data-tabla"?: string;
  /** Con qué orden nace (p. ej. por pies cuadrados, de mayor a menor); el menú de la columna lo cambia como siempre. */
  ordenInicial?: { clave: string; direccion: "asc" | "desc" };
  /** Clases extra del `<table>` (p. ej. para una vista de tarjetas en el teléfono). */
  claseTabla?: string;
  /** Estilos extra del `<table>` (variables CSS; el ancho lo sigue poniendo el estándar). */
  estiloTabla?: CSSProperties;
  /** Una fila de totales al pie (`<tfoot>`), por clave de columna. No se ordena ni se filtra; las columnas sin clave van vacías. */
  totales?: Readonly<Record<string, ReactNode>>;
}) {
  const { t, lang } = usePrefs();
  const idioma: "en" | "es" = lang === "es" ? "es" : "en";
  const porClave = useMemo(() => new Map(columnas.map((c) => [c.key, c])), [columnas]);
  const valorDe = useCallback((clave: string, f: F) => porClave.get(clave)?.valor(f) ?? null, [porClave]);
  const orden = useOrdenYFiltro(filas, valorDe, ordenInicial);
  const colw = useColWidthMap(claveDeAnchos(id), 140, { minimo: 48 });
  const ancho = (c: ColumnaEstandar<F>) => colw.widthOf(c.key, c.ancho);

  const vista = useVistaDeColumnas(id, columnas, orden.cerrar);
  const { enOrden, visibles } = vista;
  const anchos = [...visibles.map(ancho), ...(acciones ? [anchoDeAcciones] : [])];

  return (
    <div className="tabla-estandar" data-tabla-estandar={id}>
      <div className="tabla-estandar-barra">
        <div className="tabla-estandar-barra-izq">
          {barra}
          <FiltrosPuestos estado={orden} columnas={columnas} lang={idioma} t={t} />
        </div>
        <SelectorDeColumnas {...vista.selector}
          rotulo={(c) => (idioma === "es" ? c.es : c.en)}
          titulo={t("Columns of this table", "Columnas de esta tabla")}
          nota={t("Saved for you on this browser.", "Se guarda para ti en este navegador.")}
          t={t} />
      </div>
      <div className={"tbl-scroll tbl-fit" + (sinCaja ? "" : " tbl-caja")}>
        <table className={"orders tbl-resize" + (claseTabla ? " " + claseTabla : "")} style={{ ...anchoDeTabla(anchos), ...estiloTabla }} data-tabla={dataTabla ?? id}>
          <colgroup>
            {visibles.map((c) => <col key={c.key} style={{ width: ancho(c) }} />)}
            {acciones && <col style={{ width: anchoDeAcciones }} />}
          </colgroup>
          <thead>
            <tr>
              {visibles.map((c) => (
                <th key={c.key} data-col={c.key} {...vista.th(c.key)} title={t("Drag to move the column", "Arrastra para mover la columna")}>
                  <CabeceraConMenu estado={orden} col={c} lang={idioma} t={t} />
                  <span className="col-resizer" {...vista.asa}
                    onMouseDown={colw.startResize(c.key, c.ancho)} onDoubleClick={() => colw.resetCol(c.key)}
                    title={t("Drag to change the width; double-click to reset", "Arrastra para cambiar el ancho; doble clic para restablecer")} data-asa-de={c.key} />
                </th>
              ))}
              {acciones && <th />}
            </tr>
          </thead>
          <tbody>
            {orden.visibles.length === 0 && (
              <tr><td colSpan={visibles.length + (acciones ? 1 : 0)} className="hint">
                {filas.length === 0 ? (vacio ?? t("Nothing here yet.", "Todavía no hay nada.")) : t("Nothing matches these column filters.", "Nada coincide con los filtros de columna.")}
              </td></tr>
            )}
            {orden.visibles.map((f) => (
              <tr key={claveDe(f)} data-fila={claveDe(f)}
                className={[onFila ? "fila-abre" : "", claseDeFila?.(f) ?? ""].join(" ").trim() || undefined}
                tabIndex={onFila ? 0 : undefined}
                onClick={onFila ? () => onFila(f) : undefined}
                onKeyDown={onFila ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onFila(f); } } : undefined}>
                {visibles.map((c) => {
                  const v = c.valor(f);
                  return (
                    <td key={c.key} data-col={c.key} className={[c.clase ?? (c.numerico ? "num" : ""), c.envuelve ? "celda-suelta" : ""].join(" ").trim() || undefined}
                      title={!c.celda && typeof v === "string" ? v : undefined}>
                      {c.celda ? c.celda(f) : (v === null || v === "" ? "—" : v)}
                    </td>
                  );
                })}
                {acciones && <td className="celda-suelta" onClick={(e) => e.stopPropagation()}>{acciones(f)}</td>}
              </tr>
            ))}
          </tbody>
          {totales && (
            <tfoot>
              <tr className="tabla-estandar-totales" data-totales={id} style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                {visibles.map((c) => (
                  <td key={c.key} data-col={c.key} className={c.numerico ? "num" : undefined}>{totales[c.key] ?? null}</td>
                ))}
                {acciones && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <MenuDeColumnaAbierto estado={orden} columnas={columnas} lang={idioma} t={t} />
    </div>
  );
}
