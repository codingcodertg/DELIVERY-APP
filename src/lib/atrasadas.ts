import { isOverdue, retentionFloorISO, todayISO } from "@/lib/utils";

/**
 * La pastilla «Outdated / Atrasadas» de Órdenes (D-NEXT).
 *
 * El dueño: *«make a filter name outdated and put the old order there»*. Preguntado, precisó las dos
 * mitades: dentro van las **atrasadas y abiertas** —fecha de entrega anterior a ayer, ni entregadas
 * ni anuladas—, y **salen de la lista normal**, que se queda con ayer, hoy y lo que viene.
 *
 * Esto revierte en parte D-351 y D-374, que habían decidido lo contrario —que una vencida abierta
 * se viera siempre en la lista porque es trabajo vivo—. Lo que no se revierte es que se vea: sigue
 * a un clic, con su número en la pastilla aunque no se esté dentro, que es el aviso.
 *
 * Solo para la pantalla de Órdenes. La ventana compartida (`withinRetention`) **no se toca**: la
 * usan también la Cola de almacén y la pantalla del chofer, y allí las atrasadas siguen saliendo.
 */

/** El valor de `filter` de la pastilla. No es una etapa: ninguna se llama así. */
export const PESTANA_ATRASADAS = "outdated";

/**
 * ¿Va esta orden a «Outdated» (y por tanto NO a la lista normal)?
 *
 * **No es una definición nueva de «atrasada»**: es `isOverdue` —fecha pasada, ni entregada ni
 * anulada, la de D-351/D-354/D-374— más el suelo de la ventana, `retentionFloorISO` (ayer). Las
 * dos piezas ya existían; esto solo las junta.
 *
 * El suelo hace falta porque `isOverdue` cuenta **ayer** como atrasada (su día ya pasó), y el dueño
 * dejó ayer en la lista normal —«ayer, hoy y lo que viene», que es la ventana de D-239—. Sin el
 * suelo, una orden de ayer sin entregar saldría en las dos listas, o en ninguna. Con él, la lista
 * normal y «Outdated» se reparten las órdenes sin solaparse. La de ayer sigue llevando su etiqueta
 * roja «Tarde» en la lista normal: está atrasada, solo que todavía dentro de la ventana.
 */
export function vaAAtrasadas(
  d: { delivery_date?: string | null; stage?: string | null },
  hoy: string = todayISO(),
): boolean {
  if (!isOverdue(d, hoy)) return false;
  return (d.delivery_date ?? "").slice(0, 10) < retentionFloorISO(hoy);
}
