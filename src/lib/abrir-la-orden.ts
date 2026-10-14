import type { Delivery, Profile } from "@/lib/types";
import { esMia } from "@/lib/ordenes-visibles";

/**
 * ¿Puede esta persona ABRIR la ficha de esta orden? (D-544)
 *
 * El dueño, 2026-10-13 (literal): «if you are a sales person you cant open others peoples orders just their owns».
 *
 * **Una sola regla, para todas las pantallas.** Una orden se abre desde muchos sitios —la tabla y el tablero de Órdenes, el
 * enlace `/?order=` de una notificación, del Panel o de Auditoría, las paradas de «Ruta de hoy», Cuentas, Resumen, Almacén—
 * y todos montan la misma ficha (`OrderModalLazy`). La puerta está ahí, en la ficha, con esta función: lo que no pasa no se
 * monta, venga de donde venga (y de lo que se escriba mañana). Las pantallas que pintan un enlace usan la misma función
 * para no pintarlo (`ordenLegible` en «Ruta de hoy»).
 *
 * - **Quien no es de ventas**: abre lo que su pantalla le enseña, como antes.
 * - **Ventas**: la suya — la creó, o es su vendedor (`esMia`, D-537: `created_by` u `orderOwner`, que incluye la que oficina
 *   o un admin le asignaron).
 * - **Un BORRADOR lo abre cualquiera, también ventas** (D-286): el dueño pidió *«para borrador, deja que cualquiera pueda
 *   volver y editarlo»*, y un borrador que no se abre no se retoma. Este pedido no lo nombra; se mantiene D-286. Si el dueño
 *   quiere cerrar también los borradores, es quitar la línea del `draft` (y la prueba que la fija dirá que cambió).
 * - **Sin saber quién mira** (`me` nulo): no se abre nada.
 * - **El sandbox de enseñanza**: sin cortes, como en Órdenes (`leTocaPorRol`): sus datos no son de nadie.
 *
 * **Es de PANTALLA.** La RLS de `deliveries` (131, D-374) sigue dejando a ventas LEER filas de otros: esto no la toca.
 */
export function puedeAbrirLaOrden(
  me: Pick<Profile, "id" | "role"> | null | undefined,
  d: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep">,
  opts: { teaching?: boolean } = {},
): boolean {
  if (!me) return false;
  if (opts.teaching) return true;
  if (me.role !== "sales") return true;
  if (d.stage === "draft") return true;
  return esMia(d, me);
}

/** El aviso cuando un vendedor pulsa una orden ajena. */
export const AVISO_SOLO_TUS_ORDENES = { en: "You can only open your own orders", es: "Solo puedes abrir tus órdenes" } as const;
