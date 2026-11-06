/**
 * Operaciones de almacén (D-883, migración 247): quién ve qué. Es la MISMA regla que `public.warehouse_ops_can_see`
 * de la 247; la base es la que manda (RLS) y esto solo decide qué pantalla ofrecer. La prueba lee el SQL para que
 * las dos no se separen.
 */
import type { TipoDeReporte } from "./tipos";
import { esDeRrhh } from "./tipos";

export const MODULO = "warehouse_ops";
/** El permiso por persona (profiles.permissions) del supervisor de almacén: ve los reportes de su tienda que no son de RR. HH. */
export const PERMISO_SUPERVISOR = "warehouse_ops_supervisor";

export interface Quien {
  id: string;
  role: string;
  store?: string | null;
  visible_stores?: string[] | null;
  permissions?: string[] | null;
  module_access?: string[] | null;
  recruiting_role?: string | null;
}

export function tieneElModulo(q: Quien): boolean {
  return q.role === "admin" || (q.module_access ?? []).includes(MODULO);
}

function esDeSuTienda(q: Quien, tienda: string): boolean {
  return q.store === tienda || (q.visible_stores ?? []).includes(tienda);
}

export function esSupervisor(q: Quien): boolean {
  return (q.permissions ?? []).includes(PERMISO_SUPERVISOR);
}

export function puedeVerReporte(q: Quien, r: { kind: TipoDeReporte; store: string; author_id: string }): boolean {
  if (q.role === "admin") return true;
  const modulo = (q.module_access ?? []).includes(MODULO);
  if (esDeRrhh(r.kind)) {
    if (q.recruiting_role === "admin" || q.recruiting_role === "manager") return true;
    return q.role === "manager" && modulo && esDeSuTienda(q, r.store);
  }
  if (!modulo) return false;
  if (r.author_id === q.id) return true;
  return (q.role === "manager" || esSupervisor(q)) && esDeSuTienda(q, r.store);
}

/** ¿Se le ofrece la pantalla «Reportes» (la de los gerentes)? */
export function veLosReportes(q: Quien): boolean {
  if (q.role === "admin") return true;
  if (q.recruiting_role === "admin" || q.recruiting_role === "manager") return true;
  return tieneElModulo(q) && (q.role === "manager" || esSupervisor(q));
}

/**
 * ¿Puede corregir el producto de una merma (migración 252)? El admin, o el gerente / supervisor de almacén de esa
 * tienda con el módulo. La misma regla que `public.warehouse_ops_edit_scrap_product`.
 */
export function puedeCorregirMerma(q: Quien, r: { kind: TipoDeReporte; store: string }): boolean {
  if (r.kind !== "scrap") return false;
  if (q.role === "admin") return true;
  return (q.module_access ?? []).includes(MODULO) && (q.role === "manager" || esSupervisor(q)) && esDeSuTienda(q, r.store);
}
