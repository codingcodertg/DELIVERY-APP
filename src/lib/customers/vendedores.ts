import type { Cliente } from "./reglas";

/**
 * El vendedor de cada cliente (D-683, migración 198). El dueño, 2026-10-25: «the customer app has a sales rep assigned
 * to each customer. Right now, they just have initials». `rep_id` es un perfil del hub con rol de vendedor; las iniciales
 * de QuickBooks (rep_store, rep_qb, rep_history) se quedan como estaban. Un vendedor ve solo los clientes sin vendedor,
 * los suyos y los que creó él (lo decide la base: política de la 198); en la ficha, al editar y al crear, se elige el
 * vendedor en un desplegable, y a los que no tienen se les puede poner.
 */
export interface Vendedor { id: string; full_name: string }

/** Los vendedores por nombre, para pintar la lista y la ficha. */
export const nombresDeVendedores = (v: readonly Vendedor[]): ReadonlyMap<string, string> =>
  new Map(v.map((x) => [x.id, (x.full_name ?? "").trim() || x.id]));

/** Cada fila con el NOMBRE de su vendedor (`rep_name`), para la lista, el orden y la búsqueda. Sin vendedor, null. */
export function conVendedores<T extends Pick<Cliente, "rep_id">>(filas: readonly T[], nombres: ReadonlyMap<string, string>): (T & { rep_name: string | null })[] {
  return filas.map((c) => ({ ...c, rep_name: c.rep_id ? nombres.get(c.rep_id) ?? c.rep_id : null }));
}

/** Ordenados por nombre, para el desplegable. */
export const vendedoresEnOrden = (v: readonly Vendedor[]): Vendedor[] =>
  [...v].sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", undefined, { sensitivity: "base" }));
