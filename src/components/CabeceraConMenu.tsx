"use client";

import { createPortal } from "react-dom";
import { ColumnFilterMenu } from "@/components/OrdersTable";
import { posicionDelMenu } from "@/lib/menu-desplegable";
import { columnasFiltradas, textoDeColumnas } from "@/lib/filtros-activos";
import type { OrdenYFiltro } from "@/lib/use-orden-y-filtro";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";

type T = (en: string, es: string) => string;

/** Una columna que ordena y filtra: su clave, su nombre en los dos idiomas y, si hace falta, cómo se enseña cada valor. */
export type ColumnaConMenu = { key: string; en: string; es: string; etiqueta?: (v: ValorDeCelda) => string };

/**
 * La cabecera de una columna con el menú de ordenar y filtrar de Órdenes (D-275), para las tablas del Gestor de
 * Rutas (D-360). Mismas clases (`th-cell`, `th-sort`, `th-filter-btn`) y mismo gesto: el nombre y el ▾ abren el
 * mismo menú; la flecha dice por dónde está ordenada la tabla; el ▾ en color, que hay filtro en esa columna.
 * El `<th>` lo pone quien llama, porque ahí va también el tirador del ancho.
 */
export function CabeceraConMenu<F>({ estado, col, lang, t }: { estado: OrdenYFiltro<F>; col: ColumnaConMenu; lang: "en" | "es"; t: T }) {
  const hayFiltro = (estado.filtros[col.key]?.size ?? 0) > 0;
  return (
    <div
      className="th-cell"
      ref={(el) => { if (el) estado.celdas.current.set(col.key, el); else estado.celdas.current.delete(col.key); }}
    >
      <button className="th-sort" onClick={(e) => { e.stopPropagation(); estado.abrir(col.key); }} title={t("Sort and filter", "Ordenar y filtrar")}>
        {lang === "es" ? col.es : col.en}
        {estado.claveDeOrden === col.key && (estado.direccion === "asc" ? " ▲" : " ▼")}
      </button>
      <button className={"th-filter-btn " + (hayFiltro ? "on" : "")} onClick={(e) => { e.stopPropagation(); estado.abrir(col.key); }} title={t("Sort and filter", "Ordenar y filtrar")}>
        ▾
      </button>
    </div>
  );
}

/** El menú abierto (si lo hay) de una tabla, en un portal sobre `document.body`, anclado a su cabecera. */
export function MenuDeColumnaAbierto<F>({ estado, columnas, lang, t }: { estado: OrdenYFiltro<F>; columnas: readonly ColumnaConMenu[]; lang: "en" | "es"; t: T }) {
  const clave = estado.abierta;
  if (!clave || !estado.ancla) return null;
  const col = columnas.find((c) => c.key === clave);
  if (!col) return null;
  return createPortal(
    <ColumnFilterMenu
      menuRef={estado.menuRef}
      col={col}
      options={estado.opciones(clave, col.etiqueta)}
      active={estado.filtros[clave]}
      orden={estado.claveDeOrden === clave ? estado.direccion : null}
      onOrdenar={(dir) => estado.ordenar(clave, dir)}
      lang={lang}
      t={t}
      style={posicionDelMenu(estado.ancla, { ancho: window.innerWidth, alto: window.innerHeight })}
      onApply={(marcados) => estado.aplicar(clave, marcados)}
      onClear={() => estado.limpiar(clave)}
      onClose={estado.cerrar}
    />,
    document.body,
  );
}

/**
 * «Filtrado por: Cuenta y Tienda · ✕ Limpiar filtros», la barra de D-297, para que el filtro no se olvide puesto:
 * en el Gestor una orden filtrada fuera es una orden que nadie asigna. Solo se pinta si hay alguno.
 */
export function FiltrosPuestos<F>({ estado, columnas, lang, t }: { estado: OrdenYFiltro<F>; columnas: readonly ColumnaConMenu[]; lang: "en" | "es"; t: T }) {
  const filtradas = columnasFiltradas(estado.filtros, columnas.map((c) => c.key));
  if (filtradas.length === 0) return null;
  const nombres = filtradas.map((k) => { const c = columnas.find((x) => x.key === k); return c ? (lang === "es" ? c.es : c.en) : k; });
  return (
    <div className="filtros-puestos">
      <span>
        🔎 <b>{t("Filtered by", "Filtrado por")}:</b>{" "}
        {textoDeColumnas(nombres, t("and", "y"), (n) => t(`${n} more`, `${n} más`))}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={estado.limpiarTodo} title={t("Remove every column filter on this table", "Quitar todos los filtros de columna de esta tabla")}>
        ✕ {t("Clear filters", "Limpiar filtros")}
      </button>
    </div>
  );
}
