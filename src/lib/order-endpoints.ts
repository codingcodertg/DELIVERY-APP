import type { Delivery } from "./types";

/**
 * Una orden no puede ir de un sitio a ese mismo sitio (D-NEXT).
 *
 * El dueño: «no permitas que una tienda se venda a sí misma, ni recoja y entregue en sí misma; no
 * tiene sentido». Dos reglas, y cada una con su comparación, porque no valen lo mismo en todos los
 * tipos de orden:
 *
 * - **Misma dirección, en cualquier tipo.** Recogida y entrega en la misma dirección normalizada.
 *   Ya existía en el modal (sin decisión escrita), pero solo al guardar: el botón de crear y enviar a
 *   aprobación no la miraba, y por ahí se podía colar. Ahora vive aquí y la usa `submitBlockers`, que
 *   corre en los dos caminos.
 * - **Misma tienda, solo en tienda-a-tienda.** La tienda de origen (`store`, «Sold From») igual a la
 *   de destino (`delivery_name`). Comparar nombres es robusto aquí porque los dos salen de la lista de
 *   tiendas de Ajustes. En una entrega a cliente **no**: dos sitios con el mismo nombre y distinta
 *   dirección son legítimos —dos locales de una cadena—, así que ahí solo manda la dirección.
 *
 * Las coordenadas no sirven para esto, medido en el tipo: `pickup_lat/lng` son la posición del chofer
 * al recoger, no la del sitio de recogida, y ese sitio no tiene pin propio.
 */

/** Recortado, en minúsculas y con los espacios unificados: «RDZ  Norte » y «rdz norte» son lo mismo. */
export function normalizaLugar(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** ¿Recogida y entrega en la misma dirección? Sin dirección de recogida no hay nada que comparar. */
export function mismaDireccion(d: Pick<Partial<Delivery>, "pickup_address" | "delivery_address">): boolean {
  const recogida = normalizaLugar(d.pickup_address);
  return !!recogida && recogida === normalizaLugar(d.delivery_address);
}

/** ¿La tienda de origen es la de destino? Solo cuenta en un movimiento tienda-a-tienda. */
export function origenEsDestino(d: Pick<Partial<Delivery>, "store" | "delivery_name">, storeToStore: boolean): boolean {
  if (!storeToStore) return false;
  const origen = normalizaLugar(d.store);
  return !!origen && origen === normalizaLugar(d.delivery_name);
}

/**
 * Las tiendas que ofrece un desplegable, sin la que ya está en la otra punta.
 *
 * **Conserva la que tenga seleccionada ahora**, aunque sea la otra punta. Una orden vieja que ya tiene
 * origen igual a destino tiene que poder abrirse y corregirse: si su valor desapareciera de la lista, el
 * selector se vería vacío con un valor guardado detrás, y el aviso no tendría a qué referirse.
 */
export function opcionesSinLaOtraPunta(
  nombres: string[],
  otraPunta: string | null | undefined,
  actual: string | null | undefined,
): string[] {
  const otra = normalizaLugar(otraPunta);
  const elegida = normalizaLugar(actual);
  if (!otra) return nombres;
  return nombres.filter((n) => {
    const x = normalizaLugar(n);
    return x !== otra || x === elegida;
  });
}
