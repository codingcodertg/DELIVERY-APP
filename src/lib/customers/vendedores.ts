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

/** Las iniciales de QuickBooks de una fila: `rep_store` y, si falta, `rep_qb`, en mayúsculas y sin espacios. */
export function inicialesDe(c: Pick<Cliente, "rep_store" | "rep_qb">): string | null {
  return (c.rep_store ?? "").trim().toUpperCase() || (c.rep_qb ?? "").trim().toUpperCase() || null;
}

export interface GrupoDeIniciales {
  iniciales: string;
  total: number;
  sinVendedor: number;
  /** Quién tiene hoy los clientes de estas iniciales, de más a menos. */
  vendedores: { id: string; nombre: string; n: number }[];
  ids: number[];
  idsSinVendedor: number[];
}

/**
 * Para «Asignar vendedores» (D-684): los clientes NO archivados agrupados por sus iniciales de QuickBooks, de más a menos.
 * Los que no tienen iniciales no salen: no hay a quién atribuirlos de golpe (se asignan uno a uno en su ficha).
 */
export function gruposPorIniciales(lista: readonly Cliente[]): GrupoDeIniciales[] {
  const porIni = new Map<string, GrupoDeIniciales & { _v: Map<string, { nombre: string; n: number }> }>();
  for (const c of lista) {
    if (c.archived_at) continue;
    const ini = inicialesDe(c);
    if (!ini) continue;
    let g = porIni.get(ini);
    if (!g) { g = { iniciales: ini, total: 0, sinVendedor: 0, vendedores: [], ids: [], idsSinVendedor: [], _v: new Map() }; porIni.set(ini, g); }
    g.total++;
    g.ids.push(c.id);
    if (!c.rep_id) { g.sinVendedor++; g.idsSinVendedor.push(c.id); continue; }
    const v = g._v.get(c.rep_id) ?? { nombre: c.rep_name ?? c.rep_id, n: 0 };
    v.n++;
    g._v.set(c.rep_id, v);
  }
  return [...porIni.values()]
    .map(({ _v, ...g }) => ({ ...g, vendedores: [..._v.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.n - a.n) }))
    .sort((a, b) => b.total - a.total || a.iniciales.localeCompare(b.iniciales));
}

/** Los ids que toca «Asignar»: los sin vendedor, o todos si se pide reasignar. */
export const idsParaAsignar = (g: GrupoDeIniciales, tambienConVendedor: boolean): number[] => (tambienConVendedor ? g.ids : g.idsSinVendedor);
