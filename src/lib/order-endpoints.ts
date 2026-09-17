import type { Delivery, NamedLocation } from "./types";

/**
 * Una orden no puede ir de un sitio a ese mismo sitio (D-267).
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
 *   de destino. Comparar nombres es robusto aquí porque los dos salen de la lista de tiendas de
 *   Ajustes. En una entrega a cliente **no**: dos sitios con el mismo nombre y distinta dirección son
 *   legítimos —dos locales de una cadena—, así que ahí solo manda la dirección.
 *
 * Las coordenadas no sirven para esto, medido en el tipo: `pickup_lat/lng` son la posición del chofer
 * al recoger, no la del sitio de recogida, y ese sitio no tiene pin propio.
 *
 * **D-276: el destino tenía dos definiciones.** La regla y el filtro de «Vendido desde» miraban
 * `delivery_name`; el desplegable de destino enseña la tienda cuya dirección es `delivery_address`.
 * Cuando no coincidían —una entrega a cliente con la dirección de una tienda pasada a Intertienda, o
 * un nombre vacío—, «Vendido desde» ofrecía la tienda que el destino tenía delante, y la regla no la
 * veía si además se había cambiado la recogida. Ahora la tienda de origen es el destino si coincide
 * **por nombre o por la dirección guardada de esa tienda**, y los desplegables se filtran preguntando
 * a la regla con el mismo manejador que aplica la elección.
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

/** La dirección guardada en Ajustes de una tienda, buscada por nombre normalizado. */
function direccionDeTienda(nombre: string | null | undefined, tiendas: NamedLocation[]): string {
  const n = normalizaLugar(nombre);
  return n ? (tiendas.find((s) => normalizaLugar(s.name) === n)?.address ?? "") : "";
}

/**
 * ¿La tienda de origen es la de destino? Solo cuenta en un movimiento tienda-a-tienda.
 *
 * Por nombre (`delivery_name`), o porque la entrega va a la dirección guardada de la tienda de origen,
 * que es lo que enseña el desplegable de destino. `tiendas` es obligatorio a propósito: sin la lista,
 * la segunda comparación no existe y el hueco de D-276 vuelve en silencio.
 */
export function origenEsDestino(
  d: Pick<Partial<Delivery>, "store" | "delivery_name" | "delivery_address">,
  storeToStore: boolean,
  tiendas: NamedLocation[],
): boolean {
  if (!storeToStore) return false;
  const origen = normalizaLugar(d.store);
  if (!origen) return false;
  if (origen === normalizaLugar(d.delivery_name)) return true;
  const dirOrigen = normalizaLugar(direccionDeTienda(d.store, tiendas));
  return !!dirOrigen && dirOrigen === normalizaLugar(d.delivery_address);
}

/** Elegir «Vendido desde»: la tienda, y su nombre y su dirección como recogida. Lo que hace el modal. */
export function eligeOrigen(p: Partial<Delivery>, v: string, tiendas: NamedLocation[]): Partial<Delivery> {
  const st = tiendas.find((s) => s.name === v);
  return { ...p, store: v, pickup_name: v || p.pickup_name, pickup_address: st?.address ? st.address : p.pickup_address };
}

/** Elegir la tienda de destino: es el nombre del destino, su dirección y el contacto. Lo que hace el modal. */
export function eligeDestino(p: Partial<Delivery>, v: string, tiendas: NamedLocation[]): Partial<Delivery> {
  const st = tiendas.find((s) => s.name === v);
  return { ...p, delivery_name: v, delivery_address: st?.address ?? "", contact: v || p.contact };
}

/** La tienda que enseña el desplegable de destino: la de la dirección de entrega. */
export function tiendaDestinoMostrada(d: Pick<Partial<Delivery>, "delivery_address">, tiendas: NamedLocation[]): string {
  return tiendas.find((s) => s.address && s.address === d.delivery_address)?.name || "";
}

const mismoNombre = (a: string | null | undefined, b: string | null | undefined) =>
  !!normalizaLugar(a) && normalizaLugar(a) === normalizaLugar(b);

/**
 * Las tiendas que ofrece «Vendido desde»: las que, elegidas, no dejarían el origen en el destino.
 *
 * **Conserva la que tenga seleccionada ahora**, aunque choque (D-267): una orden vieja que ya lo tiene
 * tiene que poder abrirse y corregirse, y si su valor desapareciera de la lista el selector se vería
 * vacío con un valor guardado detrás. Una orden nueva no llega a ese estado: ver `aplicaTipo`.
 */
export function opcionesDeOrigen(d: Partial<Delivery>, tiendas: NamedLocation[], storeToStore: boolean): string[] {
  const nombres = tiendas.map((s) => s.name);
  if (!storeToStore) return nombres;
  return nombres.filter((n) => mismoNombre(n, d.store) || !origenEsDestino(eligeOrigen(d, n, tiendas), true, tiendas));
}

/**
 * Las tiendas que ofrece el destino: las que, elegidas, no dejarían la orden en su propio sitio —ni la
 * tienda de origen, ni la que está en la dirección de recogida—. Conserva la que enseña ahora.
 */
export function opcionesDeDestino(d: Partial<Delivery>, tiendas: NamedLocation[]): string[] {
  const actual = tiendaDestinoMostrada(d, tiendas);
  return tiendas.map((s) => s.name).filter((n) => {
    if (mismoNombre(n, actual)) return true;
    const elegido = eligeDestino(d, n, tiendas);
    return !origenEsDestino(elegido, true, tiendas) && !mismaDireccion(elegido);
  });
}
