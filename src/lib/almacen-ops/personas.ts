/**
 * Operaciones de almacén: a quién ofrece el selector de empleados (pedido fec8a78d de Roberto).
 * Solo gente del almacén de la tienda elegida en el reporte, aunque quien llena sea admin: rol `warehouse`, o el módulo
 * Warehouse Ops dado a mano. Nadie que ya se fue (left_at).
 */
import { MODULO } from "./visibilidad";

export interface PersonaDeAlmacen {
  id: string;
  full_name: string;
  store: string | null;
  role?: string | null;
  module_access?: string[] | null;
  left_at?: string | null;
}

export function esDelAlmacen(p: PersonaDeAlmacen): boolean {
  if (p.left_at) return false;
  return p.role === "warehouse" || (p.role !== "admin" && (p.module_access ?? []).includes(MODULO));
}

export function personasParaElegir<T extends PersonaDeAlmacen>(personas: readonly T[], tienda: string, busqueda = ""): T[] {
  const n = busqueda.trim().toLowerCase();
  return personas
    .filter((p) => p.store === tienda && esDelAlmacen(p))
    .filter((p) => !n || p.full_name.toLowerCase().includes(n))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
