"use client";

import { Fragment, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { anchoDeTabla, useColWidthMap } from "@/lib/use-col-widths";
import { claveDeAnchos } from "@/lib/tabla-estandar";
import { useVistaDeColumnas } from "@/lib/use-vista-de-columnas";

/**
 * LA FORMA REDUCIDA del estándar de tablas (docs/ESTANDAR-DE-TABLAS.md) para las tablas de Time Tracker que se
 * EDITAN en su propia fila o que despliegan una fila de ancho completo (Nómina: bitácora del turno; Informes:
 * edición de un tramo). Sin ▾: ordenar o filtrar mientras se teclea o se edita movería las filas, igual que en
 * `ProductosCompetencia`. Lo que sí trae: ⚙ Columnas, arrastrar cabeceras para mover, arrastrar el borde para el
 * ancho, todo guardado por persona (`useVistaDeColumnas` + `useColWidthMap`).
 *
 * `id` debe ser único por tabla que se pinte a la vez: la vista se guarda con él, y dos tablas con el mismo id se
 * pisarían la configuración. Por eso las de una persona llevan su id en la clave.
 */
export interface ColumnaReducida<F> {
  key: string;
  /** Rótulos (el que sale en la cabecera y en ⚙), según el idioma. */
  en: string;
  es: string;
  /** Ancho de partida en px. */
  ancho: number;
  /** Lo que se pinta en la celda (puede ser un campo editable). */
  celda: (f: F) => ReactNode;
  fija?: true;
  oculta?: true;
  numerico?: boolean;
  envuelve?: true;
}

export function TablaReducida<F>({
  id, columnas, filas, claveDe, subFila, acciones, anchoDeAcciones = 120, sinCaja,
}: {
  id: string;
  columnas: readonly ColumnaReducida<F>[];
  filas: readonly F[];
  claveDe: (f: F) => string;
  /** Una fila de ancho completo debajo de cada fila (p. ej. la bitácora del turno). */
  subFila?: (f: F) => ReactNode;
  /** Una última columna de botones por fila. */
  acciones?: (f: F) => ReactNode;
  anchoDeAcciones?: number;
  sinCaja?: boolean;
}) {
  const { t, lang } = usePrefs();
  const rotuloDe = (c: { en: string; es: string }) => (lang === "es" ? c.es : c.en);
  const vista = useVistaDeColumnas(id, columnas);
  const colw = useColWidthMap(claveDeAnchos(id), 140, { minimo: 48 });
  const ancho = (c: ColumnaReducida<F>) => colw.widthOf(c.key, c.ancho);
  const { visibles } = vista;
  const anchos = [...visibles.map(ancho), ...(acciones ? [anchoDeAcciones] : [])];
  const columnasTotales = visibles.length + (acciones ? 1 : 0);

  return (
    <div className="tabla-estandar" data-tabla-estandar={id}>
      <div className="tabla-estandar-barra">
        <SelectorDeColumnas {...vista.selector}
          rotulo={rotuloDe}
          titulo={t("Columns of this table", "Columnas de esta tabla")}
          nota={t("Saved for you on this browser.", "Se guarda para ti en este navegador.")}
          t={t} />
      </div>
      <div className={"tbl-scroll tbl-fit" + (sinCaja ? "" : " tbl-caja")}>
        <table className="orders tbl-resize" style={anchoDeTabla(anchos)} data-tabla={id}>
          <colgroup>
            {visibles.map((c) => <col key={c.key} style={{ width: ancho(c) }} />)}
            {acciones && <col style={{ width: anchoDeAcciones }} />}
          </colgroup>
          <thead>
            <tr>
              {visibles.map((c) => (
                <th key={c.key} data-col={c.key} {...vista.th(c.key)} title={t("Drag to move the column", "Arrastra para mover la columna")}>
                  {rotuloDe(c)}
                  <span className="col-resizer" {...vista.asa}
                    onMouseDown={colw.startResize(c.key, c.ancho)} onDoubleClick={() => colw.resetCol(c.key)}
                    title={t("Drag to change the width; double-click to reset", "Arrastra para cambiar el ancho; doble clic para restablecer")} data-asa-de={c.key} />
                </th>
              ))}
              {acciones && <th />}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <Fragment key={claveDe(f)}>
                <tr data-fila={claveDe(f)}>
                  {visibles.map((c) => (
                    <td key={c.key} data-col={c.key} className={[c.numerico ? "num" : "", c.envuelve ? "celda-suelta" : ""].join(" ").trim() || undefined}>
                      {c.celda(f)}
                    </td>
                  ))}
                  {acciones && <td className="celda-suelta nowrap">{acciones(f)}</td>}
                </tr>
                {subFila && (
                  <tr className="bitacora-fila">
                    <td colSpan={columnasTotales}>{subFila(f)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
