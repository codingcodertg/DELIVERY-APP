import type { Profile, UserRole } from "@/lib/types";

/**
 * «Ver todas las tiendas» en Entregas: un permiso por persona, no un rol (D-559).
 *
 * El dueño, 2026-10-15, al pedir un «Operations Manager» con acceso a todas las apps como gerente y preguntarle si una
 * tienda o todas: «por ahora se llamara francis y todas».
 *
 * Un gerente (`manager`) ve en Entregas su tienda y las de su grupo (D-396, D-405), y sin tienda no ve nada (D-237).
 * Con esta capacidad, los cortes de PANTALLA por tienda le tratan como a admin y logística: todas. Es la copia de
 * `leads_all_stores` (`src/lib/leads/alcance.ts`): la palabra vive en `profiles.permissions` —que solo el admin escribe,
 * `guard_profile_privileged_columns` de la 131—, se OFRECE solo al gerente, y SOLO al gerente le surte efecto: a un
 * vendedor con la palabra escrita a mano (o que le quedó de cuando era gerente) no le sirve.
 *
 * **Un campo sin rellenar sigue sin ampliar nada (D-237).** La amplitud la da esta capacidad, nunca una tienda vacía.
 *
 * **Leer, no escribir.** Borrar borradores (`orden_de_mis_tiendas`, 142), deshacer pasos o decidir promos de otras tiendas
 * no se amplía: siguen siendo de su tienda y su grupo.
 *
 * **La base ya lo deja**: `tiendas_visibles()` (131:134) devuelve `null` —todas— a quien tiene `visible_stores` nulo o
 * vacío, así que la política de lectura de `deliveries` ya le manda todas las filas. Esto quita el corte de la pantalla,
 * no abre nada en la base. Si se le marcan casillas en «Tiendas que ve», la base le pone ese techo igual que hoy.
 */

/** La palabra que va en `profiles.permissions`. */
export const CAP_TODAS_LAS_TIENDAS = "all_stores" as const;

/** Quien ve todas las tiendas por su ROL, sin permiso: admin y logística (D-374, D-396). */
export const ROLES_DE_TODAS_LAS_TIENDAS: readonly UserRole[] = ["admin", "logistics"];

/** ¿A este rol se le OFRECE la casilla? Solo al gerente. */
export function seOfreceTodasLasTiendas(role: string | null | undefined): boolean {
  return role === "manager";
}

/**
 * ¿Ve esta persona las órdenes de todas las tiendas en las pantallas de Entregas? Admin y logística, siempre; el
 * gerente, si tiene la capacidad; nadie más.
 */
export function veTodasLasTiendas(me: Pick<Profile, "role" | "permissions"> | null | undefined): boolean {
  if (!me) return false;
  if (ROLES_DE_TODAS_LAS_TIENDAS.includes(me.role)) return true;
  return seOfreceTodasLasTiendas(me.role) && !!me.permissions?.includes(CAP_TODAS_LAS_TIENDAS);
}
