/**
 * Operaciones de almacén (D-883, migración 247; niveles: D-908, migración 265): quién ve qué. Es la MISMA regla que
 * `public.warehouse_ops_can_see` y `public.warehouse_ops_can_manage` de la 265; la base es la que manda (RLS) y esto
 * solo decide qué pantalla ofrecer. La prueba lee el SQL para que las dos no se separen.
 */
import type { TipoDeReporte } from "./tipos";
import { esDeRrhh } from "./tipos";
import { MODULO, SECCIONES, nivelDe } from "./nivel";

export { MODULO };
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
  /** 265: el nivel escrito dentro de la app (`profiles.warehouse_ops_role`). Null = manda el rol del hub. */
  warehouse_ops_role?: string | null;
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
  const nivel = nivelDe(q);
  if (nivel === "admin") return true;
  if (nivel === "store_admin" && esDeSuTienda(q, r.store)) return true;
  if (esDeRrhh(r.kind)) {
    if (q.recruiting_role === "admin" || q.recruiting_role === "manager") return true;
    return nivel === "full" && q.role === "manager" && esDeSuTienda(q, r.store);
  }
  if (nivel === "scrap_only") return r.author_id === q.id && SECCIONES.scrap_only.tipos.includes(r.kind);
  if (nivel !== "full") return false;
  if (r.author_id === q.id) return true;
  return (q.role === "manager" || esSupervisor(q)) && esDeSuTienda(q, r.store);
}

/** ¿Se le ofrece la pantalla «Reportes» (la de los gerentes)? */
export function veLosReportes(q: Quien): boolean {
  const nivel = nivelDe(q);
  if (nivel === "admin" || nivel === "store_admin") return true;
  if (q.recruiting_role === "admin" || q.recruiting_role === "manager") return true;
  return nivel === "full" && (q.role === "manager" || esSupervisor(q));
}

/**
 * ¿Puede corregir una merma (producto: 252; origen y CRMA: 263)? El admin de la app (en sus tiendas si es
 * `store_admin`), o el gerente / supervisor de almacén de esa tienda con nivel `full`. La misma regla que
 * `public.warehouse_ops_can_manage`.
 */
export function puedeCorregirMerma(q: Quien, r: { kind: TipoDeReporte; store: string }): boolean {
  if (r.kind !== "scrap") return false;
  const nivel = nivelDe(q);
  if (nivel === "admin") return true;
  if (nivel === "store_admin") return esDeSuTienda(q, r.store);
  return nivel === "full" && (q.role === "manager" || esSupervisor(q)) && esDeSuTienda(q, r.store);
}
