/**
 * La casilla «marcar todas» de la cabecera de una tabla con filtros (D-NEXT).
 *
 * «Todas» son las filas que se VEN después de todos los filtros vigentes —búsqueda, pastilla, filtros de columna,
 * tienda, fecha—, no la lista completa de la pantalla. Marcar o desmarcar todas toca solo esas: lo que ya estaba
 * marcado y ahora está oculto por un filtro no se marca ni se desmarca, porque la persona no lo está viendo.
 *
 * El dueño lo pidió el 2026-10-18: *«When selecting all orders on a filtered table, it selects hidden rows
 * instead of just the filtered. Needs to be fixed»*. En Órdenes la casilla alternaba sobre la lista entera de la
 * pantalla (sin los filtros de columna, que viven dentro de la tabla) y al desmarcar vaciaba la selección completa.
 */

export type EstadoDeLaCabecera = "ninguna" | "algunas" | "todas";

/** Qué pinta la casilla de la cabecera, contando solo las visibles: marcada, indeterminada o vacía. */
export function estadoDeLaCabecera(seleccion: ReadonlySet<string>, visiblesIds: readonly string[]): EstadoDeLaCabecera {
  if (visiblesIds.length === 0) return "ninguna";
  let marcadas = 0;
  for (const id of visiblesIds) if (seleccion.has(id)) marcadas++;
  if (marcadas === 0) return "ninguna";
  return marcadas === visiblesIds.length ? "todas" : "algunas";
}

/**
 * La selección después de pulsar la casilla de la cabecera. Si todas las visibles están marcadas, las desmarca;
 * si no, las marca. Lo que no está en `visiblesIds` se queda como estaba. Devuelve un Set nuevo.
 */
export function alternaTodasLasVisibles(seleccion: ReadonlySet<string>, visiblesIds: readonly string[]): Set<string> {
  const n = new Set(seleccion);
  const quitar = estadoDeLaCabecera(seleccion, visiblesIds) === "todas";
  for (const id of visiblesIds) {
    if (quitar) n.delete(id);
    else n.add(id);
  }
  return n;
}
