import type { Delivery, NamedLocation, OrderTypeRule } from "./types";

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
 * De dónde sale la mercancía, **que no siempre es «Vendido desde»** (D-302).
 *
 * En un tipo «que recibe» (`homeIsDestination`, hoy solo Intertienda) la tienda del usuario vende Y
 * recibe, y la que manda el material es la **recogida**. Si el origen siguiera siendo `store`, la regla
 * de D-276 vería toda Intertienda como una orden que va de un sitio a ese mismo sitio y la bloquearía.
 * En los demás tipos el origen es `store`, como siempre.
 *
 * Se pasa la **regla entera** y no un booleano a propósito: así el compilador obliga a cada llamador a
 * decir de qué tipo habla, en vez de heredar un `true` que ya no significa lo mismo.
 */
export function origenDeLaOrden(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "pickup_address">,
  regla: Pick<OrderTypeRule, "homeIsDestination">,
  tiendas: NamedLocation[],
): { nombre: string; direccion: string } {
  if (regla.homeIsDestination === true) {
    return {
      nombre: d.pickup_name ?? "",
      direccion: (d.pickup_address ?? "") || direccionDeTienda(d.pickup_name, tiendas),
    };
  }
  return { nombre: d.store ?? "", direccion: direccionDeTienda(d.store, tiendas) };
}

/**
 * ¿El sitio de origen es el de destino? Solo cuenta en un movimiento tienda-a-tienda.
 *
 * Por nombre (`delivery_name`), o porque la entrega va a la dirección guardada de la tienda de origen,
 * que es lo que enseña el desplegable de destino. `tiendas` es obligatorio a propósito: sin la lista,
 * la segunda comparación no existe y el hueco de D-276 vuelve en silencio.
 *
 * Desde D-302 el origen lo decide `origenDeLaOrden`, que en un tipo que recibe es la recogida.
 */
export function origenEsDestino(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "pickup_address" | "delivery_name" | "delivery_address">,
  regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">,
  tiendas: NamedLocation[],
): boolean {
  if (regla.storeToStore !== true) return false;
  const origen = origenDeLaOrden(d, regla, tiendas);
  const nombre = normalizaLugar(origen.nombre);
  const dirOrigen = normalizaLugar(origen.direccion);
  // Sin nombre NI dirección no hay origen que comparar. Con uno de los dos, basta ese: una recogida
  // sin nombre pero con la dirección del destino es la misma orden que no va a ningún sitio.
  if (!nombre && !dirOrigen) return false;
  if (!!nombre && nombre === normalizaLugar(d.delivery_name)) return true;
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

/**
 * Elegir la tienda que **manda** el material en un tipo que recibe (D-302): solo la recogida.
 *
 * `eligeOrigen` no vale aquí porque escribe también `store`, y en Intertienda «Vendido desde» es la
 * tienda del usuario y no se mueve.
 */
export function eligeRecogidaDeTienda(p: Partial<Delivery>, v: string, tiendas: NamedLocation[]): Partial<Delivery> {
  const st = tiendas.find((s) => s.name === v);
  return { ...p, pickup_name: v, pickup_address: st?.address ?? "" };
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
export function opcionesDeOrigen(d: Partial<Delivery>, tiendas: NamedLocation[], regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">): string[] {
  const nombres = tiendas.map((s) => s.name);
  if (regla.storeToStore !== true) return nombres;
  return nombres.filter((n) => mismoNombre(n, d.store) || !origenEsDestino(eligeOrigen(d, n, tiendas), regla, tiendas));
}

/**
 * Las tiendas que ofrece la **recogida** en un tipo que recibe: las que, elegidas, no dejarían la orden
 * yendo a su propio sitio — o sea, todas menos la que recibe. Conserva la que tenga puesta (D-267).
 */
export function opcionesDeRecogida(d: Partial<Delivery>, tiendas: NamedLocation[], regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">): string[] {
  const nombres = tiendas.map((s) => s.name);
  if (regla.homeIsDestination !== true) return nombres;
  return nombres.filter((n) => mismoNombre(n, d.pickup_name)
    || !origenEsDestino(eligeRecogidaDeTienda(d, n, tiendas), regla, tiendas));
}

/**
 * Las tiendas que ofrece el destino: las que, elegidas, no dejarían la orden en su propio sitio —ni la
 * tienda de origen, ni la que está en la dirección de recogida—. Conserva la que enseña ahora.
 */
export function opcionesDeDestino(d: Partial<Delivery>, tiendas: NamedLocation[], regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">): string[] {
  const actual = tiendaDestinoMostrada(d, tiendas);
  return tiendas.map((s) => s.name).filter((n) => {
    if (mismoNombre(n, actual)) return true;
    const elegido = eligeDestino(d, n, tiendas);
    return !origenEsDestino(elegido, regla, tiendas) && !mismaDireccion(elegido);
  });
}
