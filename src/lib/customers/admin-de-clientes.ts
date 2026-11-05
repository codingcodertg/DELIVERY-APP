import type { UserRole } from "@/lib/types";

/**
 * Admin SOLO de Clientes (`profiles.customers_role = 'admin'`, migración 241). El dueño, 2026-11-04: «dale permiso de
 * admin a Nick solo para la app de Clientes». Mismo patrón que `recruiting_role`: un rol dentro de la app que no toca el
 * `role` del hub, así que en el resto de las apps sigue siendo lo que era.
 *
 * Vale solo con la casilla «Clientes» puesta (quitarla lo deja sin nada, como a cualquiera). El espejo en la base es
 * `erp.es_admin_de_clientes()`; esto solo decide qué se ofrece en pantalla.
 */
export function esAdminDeClientes(p: { role?: string | null; customers_role?: string | null; module_access?: string[] | null } | null | undefined): boolean {
  if (p?.role === "admin") return true;
  return p?.customers_role === "admin" && !!p?.module_access?.includes("customers");
}

/** El rol con el que se leen las reglas DENTRO de Clientes (`puedeEditar`, `puedeArchivar`…). La barra y el hub siguen con el del hub. */
export function rolEnClientes(p: { role?: string | null; customers_role?: string | null; module_access?: string[] | null } | null | undefined): UserRole {
  if (esAdminDeClientes(p)) return "admin";
  return (p?.role as UserRole | undefined) ?? "sales";
}
