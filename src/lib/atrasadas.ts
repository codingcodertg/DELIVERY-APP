import { isOverdue, todayISO } from "@/lib/utils";

/**
 * La pastilla «Outdated / Atrasadas» de Órdenes (D-384).
 *
 * El dueño: *«make a filter name outdated and put the old order there»*. Preguntado, precisó las dos
 * mitades: dentro van las **atrasadas y abiertas** —fecha de entrega anterior a ayer, ni entregadas
 * ni anuladas—, y **salen de la lista normal**, que se queda con ayer, hoy y lo que viene.
 *
 * Esto revierte en parte D-351 y D-374, que habían decidido lo contrario —que una vencida abierta
 * se viera siempre en la lista porque es trabajo vivo—. Lo que no se revierte es que se vea: sigue
 * a un clic, con su número en la pastilla aunque no se esté dentro, que es el aviso.
 *
 * Desde D-404 (2026-09-26) entra **toda** atrasada abierta, también la de ayer, y la pastilla es
 * para todos los roles, cada uno con los días que ya ve (D-392): ver `vaAAtrasadas`.
 *
 * **Desde D-407 (2026-09-26, por la tarde) la atrasada ya no SALE de la lista normal**: está en las
 * dos, «Todas» (y su etapa) y «Outdated». El dueño: *«outdated que también salga en all»*. Esto
 * revierte la mitad «salen de la lista normal» de D-384 y D-404; la pastilla y lo que lleva no cambian.
 *
 * Solo para la pantalla de Órdenes. La ventana compartida (`withinRetention`) **no se toca**: la
 * usan también la Cola de almacén y la pantalla del chofer, y allí las atrasadas siguen saliendo.
 */

/** El valor de `filter` de la pastilla. No es una etapa: ninguna se llama así. */
export const PESTANA_ATRASADAS = "outdated";

/**
 * ¿Va esta orden a «Outdated»? (Hasta D-407, eso la sacaba de la lista normal; ya no: va a las dos.)
 *
 * **Es `isOverdue`, sin más** —fecha pasada, ni entregada ni anulada, la de D-351/D-354/D-374—,
 * **incluida la de ayer** (D-404). El dueño, 2026-09-26: *«all late delivery orders need to go in a
 * similar filter like invoice pending pero en rojo, entonces las late ya no se verán en all sino que
 * se van directo a outdated»*.
 *
 * Hasta D-404 llevaba además el suelo de la ventana (`retentionFloorISO`, ayer): la de ayer se
 * quedaba en la lista normal con su «Tarde» y solo iba aquí la de anteayer hacia atrás (D-384). Ese
 * suelo se quitó; la de ayer también salía de «Todas» (hasta D-407: ahora se queda en las dos).
 *
 * **Quién ve qué días no lo decide esto**, lo decide la ventana (`pasaLaVentana`, D-392) antes de
 * llegar aquí: admin y logística ven todas las atrasadas; los demás solo las de ayer, porque no ven
 * nada anterior. Así que esta función no tiene rol ni suelo, y no debe volver a tenerlos.
 */
export function vaAAtrasadas(
  d: { delivery_date?: string | null; stage?: string | null },
  hoy: string = todayISO(),
): boolean {
  return isOverdue(d, hoy);
}
