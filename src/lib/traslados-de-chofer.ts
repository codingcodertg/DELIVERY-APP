/**
 * Traslados contra entregas a cliente, en las cifras de choferes (junta con el dueño, 2026-11-19).
 *
 * El dueño: «Juan tiene mucha actividad, pero es porque compró muchas Intertiendas. Hay que separar las entregas a
 * clientes de los traslados entre tiendas, para que no cuenten igual.» Un traslado mueve el camión, así que sigue
 * contando en las millas y en el tiempo, pero **no es una entrega a cliente**: no tiene a nadie que cobrarle ni que
 * esperar en la puerta.
 *
 * La regla sale del TIPO de orden, nunca de editar datos: `hayClienteDetras` (D-511) de `required.ts`. Es traslado todo
 * tipo que no tenga cliente detrás: Intertienda, Transfer y Proveedor (a un proveedor tampoco se le entrega a un
 * cliente). Un tipo sin regla explícita cae en la de palabras de `orderTypeRule`, igual que en el resto de la app.
 *
 * Puro: sin base, sin React.
 */
import { hayClienteDetras, type OrderTypeRules } from "./required";

/** ¿Es un traslado (y no una entrega a cliente)? Según el tipo de la orden y sus reglas, nunca según sus datos. */
export function esTraslado(orderType: string | null | undefined, reglas?: OrderTypeRules): boolean {
  return !hayClienteDetras(orderType, reglas);
}

/** Parte una lista de órdenes en entregas a cliente y traslados, conservando el orden de llegada. */
export function separaTraslados<T extends { order_type: string | null }>(
  ordenes: readonly T[],
  reglas?: OrderTypeRules,
): { clientes: T[]; traslados: T[] } {
  const clientes: T[] = [];
  const traslados: T[] = [];
  for (const o of ordenes) (esTraslado(o.order_type, reglas) ? traslados : clientes).push(o);
  return { clientes, traslados };
}
