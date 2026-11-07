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

/**
 * Lo que se enseña de una entrada de un paso de personas (D-NEXT): el nombre del empleado si es un id conocido; si no,
 * el texto tal cual (un nombre escrito a mano para alguien sin cuenta). Un id que ya no está en la lista sale como «—».
 */
export function nombreOTexto(personas: readonly Pick<PersonaDeAlmacen, "id" | "full_name">[], x: string): string {
  const p = personas.find((q) => q.id === x);
  if (p) return p.full_name;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x) ? "—" : x;
}

/**
 * Al cambiar la tienda del reporte se quita a la gente elegida que no es del almacén nuevo. Un nombre escrito a mano
 * (que no es id de nadie) se conserva: no pertenece a ninguna tienda.
 */
export function elegidosAlCambiarDeTienda(elegidos: readonly string[], deLaTienda: ReadonlySet<string>, conocidos: ReadonlySet<string>): string[] {
  return elegidos.filter((x) => deLaTienda.has(x) || !conocidos.has(x));
}
