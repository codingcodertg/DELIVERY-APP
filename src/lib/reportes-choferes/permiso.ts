import { tieneAccesoAEntregas } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

/**
 * Quién ve «Reportes de choferes» (D-NEXT): los mismos tres roles que ven la puntualidad por chofer (D-414) y que leen
 * las posiciones GPS (121) —admin, logística y gerente—, y con el módulo de Entregas. El gerente, además, solo ve las
 * órdenes de SUS tiendas (lo acota la ruta, con `alcanceDelPanel`, como el Panel).
 *
 * Se comprueba en el servidor (`/api/driver-reports`); la pantalla lo usa solo para no enseñar un botón que daría 403.
 */
export const ROLES_DE_REPORTES: readonly UserRole[] = ["admin", "logistics", "manager"];

export function puedeVerReportesDeChoferes(u: { role?: UserRole | string | null; module_access?: string[] | null } | null | undefined): boolean {
  if (!u?.role || !ROLES_DE_REPORTES.includes(u.role as UserRole)) return false;
  return tieneAccesoAEntregas({ role: u.role as UserRole, module_access: u.module_access });
}

/** El rango que se acepta: fechas `YYYY-MM-DD`, `desde <= hasta`, y como mucho 31 días. */
export const DIAS_MAX_DE_REPORTES = 31;
export function rangoDeReportes(desde: string, hasta: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return false;
  const a = Date.parse(`${desde}T00:00:00Z`), b = Date.parse(`${hasta}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b && (b - a) / 86_400_000 < DIAS_MAX_DE_REPORTES;
}
