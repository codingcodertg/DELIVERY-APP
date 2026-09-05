/**
 * La aritmética de `sort` de HR, pura (G-19, D-201).
 *
 * Duplicar una pregunta, reordenar preguntas y añadir una etapa recolocan filas por `sort`.
 * Antes cada una hacía un `await` a Supabase por fila, en serie. Ahora la aritmética vive aquí,
 * devuelve SOLO `{ id, sort }` por fila (nunca una fila completa: el proveedor escribe
 * `update({ sort })`, una columna, la misma que tocaban los bucles), y el proveedor lanza las
 * escrituras en paralelo. Así una edición de otra persona en `text`, `weight`, `role`… nunca se
 * pisa con el estado viejo de este cliente, que fue el hallazgo del auditor sobre el primer
 * intento con `upsert` de filas completas.
 */
export type SortPatch = { id: string; sort: number };

/**
 * Las filas que hay que desplazar una posición para hacer sitio en `at`: con `inclusive`
 * (añadir etapa) las de `sort >= at`; sin él (duplicar pregunta, que va justo detrás de la
 * original) las de `sort > at`. Mismo orden en que venían.
 */
export function bumpSort<T extends { id: string; sort: number }>(rows: T[], at: number, opts: { inclusive: boolean }): SortPatch[] {
  return rows
    .filter((r) => (opts.inclusive ? r.sort >= at : r.sort > at))
    .map((r) => ({ id: r.id, sort: r.sort + 1 }));
}

/** El orden nuevo tal como lo arrastró la persona: la posición en la lista es el `sort`. */
export function sortByIds(ids: string[]): SortPatch[] {
  return ids.map((id, i) => ({ id, sort: i }));
}
