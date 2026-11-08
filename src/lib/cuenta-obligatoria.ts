import type { Delivery, UserRole } from "@/lib/types";
import { hayClienteDetras, type OrderTypeRules } from "@/lib/required";

// ============================================================
// La cuenta es obligatoria para ventas en una orden de cliente.
//
// El dueño (Roberto), 2026-11-08, Deliveries: «Let's make Account required when sales
// creates an order». En el Routes Manager salían paradas (#FW140, #FW137) creadas por ventas
// con la columna Cuenta en «—».
//
// La regla vive aquí, sola y pura, para que ampliarla a otro rol o a otro tipo de orden sea
// cambiar UNA lista y no buscar por la ficha de 4500 líneas.
//
//   • Quién: los roles de `ROLES_CON_CUENTA_OBLIGATORIA` (hoy, solo `sales`). La oficina, el
//     gerente, contabilidad y el chofer siguen como hasta ahora.
//   • Qué órdenes: las que tienen un cliente detrás (`hayClienteDetras`): Customer, Delivery…
//     NO una Intertienda ni un movimiento entre tiendas (la cuenta es la tienda que recibe y se
//     rellena sola, D-312/D-338) ni una orden a un proveedor (no hay cliente, D-511).
//   • Cuándo: al crear y al guardar una ya existente que siga sin cuenta (mismo tope). Es un
//     tope duro, como pallets y factura (D-049): no hay «¿continuar de todos modos?».
// ============================================================

export const ROLES_CON_CUENTA_OBLIGATORIA: ReadonlySet<UserRole> = new Set<UserRole>(["sales"]);

export const AVISO_CUENTA_OBLIGATORIA = { en: "Account is required", es: "La cuenta es obligatoria" } as const;

/** ¿A este rol, en este tipo de orden, se le exige la cuenta? No mira si la cuenta está puesta. */
export function pideCuenta(
  rol: UserRole | string | null | undefined,
  orderType: string | null | undefined,
  reglas?: OrderTypeRules,
): boolean {
  if (!rol || !ROLES_CON_CUENTA_OBLIGATORIA.has(rol as UserRole)) return false;
  return hayClienteDetras(orderType, reglas);
}

/** ¿Hay que parar el guardado porque la cuenta falta? True solo si se exige Y está vacía. */
export function faltaLaCuenta(
  rol: UserRole | string | null | undefined,
  orden: Pick<Partial<Delivery>, "account" | "order_type">,
  reglas?: OrderTypeRules,
): boolean {
  if (!pideCuenta(rol, orden.order_type, reglas)) return false;
  return !(orden.account ?? "").trim();
}
