/**
 * El filtro de la tabla de paradas del Gestor de Rutas, desde el encabezado de cada columna (solo filtrar, sin ordenar).
 *
 * Una parada es una FILA de la lista de un chofer: una entrega (una orden) o una recogida (varias órdenes, D-444). El
 * filtro es UNO para todas las tarjetas de choferes: «Usuario = María» enseña solo sus paradas en cada una. Filtrar solo
 * OCULTA filas; nunca renumera ni cambia índices (las flechas, «#» y las casillas siguen con los reales).
 *
 * Cada orden trae ya su valor por columna (`ValoresDeOrden`), el mismo texto que enseña su celda. Una fila se ve si
 * ALGUNA de sus órdenes pasa todos los filtros: así una recogida con varias órdenes sale si una de ellas cumple.
 *
 * Aquí no hay React: se prueba con vitest, sin navegador.
 */
import { filtraFilas, type FiltrosPorColumna, type ValorDeCelda } from "./orden-y-filtro";

/** Lo que cada columna de la tabla de paradas saca de UNA orden para filtrar: su valor, o nulo si la celda queda vacía. */
export type ValoresDeOrden = Record<string, ValorDeCelda>;

/** Las columnas que NO filtran: su celda es la hora (la llegada depende de la medida de la ruta, no de la orden). */
export const SIN_FILTRO_EN_PARADAS: readonly string[] = ["p_eta", "p_actual"];

/** El valor de la columna `clave` en esa orden. Función pura y estable: la usan el hook y el filtro. */
export const valorDeOrdenEnParadas = (clave: string, orden: ValoresDeOrden): ValorDeCelda => orden[clave] ?? null;

/** ¿Hay algún filtro de columna puesto? */
export function hayFiltroEnParadas(filtros: FiltrosPorColumna): boolean {
  return Object.values(filtros).some((s) => !!s && s.size > 0);
}

/**
 * ¿Se ve la parada? `ordenes` son las órdenes de la fila (una en una entrega, las de la recogida en una P). Sin filtros,
 * siempre. Con filtros, si ALGUNA orden los pasa todos. Una fila sin órdenes no pasa ningún filtro.
 */
export function paradaVisible(ordenes: readonly ValoresDeOrden[], filtros: FiltrosPorColumna): boolean {
  if (!hayFiltroEnParadas(filtros)) return true;
  return ordenes.some((o) => filtraFilas([o], filtros, valorDeOrdenEnParadas).length === 1);
}

/** Cuántas filas de una lista quedan ocultas por el filtro. `filas` trae las órdenes de cada fila. */
export function filasOcultas(filas: readonly (readonly ValoresDeOrden[])[], filtros: FiltrosPorColumna): number {
  return filas.filter((ordenes) => !paradaVisible(ordenes, filtros)).length;
}
