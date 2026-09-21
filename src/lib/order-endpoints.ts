import type { Delivery, NamedLocation, OrderTypeRule } from "./types";
import { mismaTiendaOGrupo } from "./store-group";

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
 * De dónde sale la mercancía: **siempre «Vendido desde»** (D-312).
 *
 * D-302 había puesto el origen en la **recogida** para los tipos «que reciben», porque allí la tienda
 * del usuario vendía y recibía a la vez y `store` era el destino. Damaris, de office: *«INV 170059 dice
 * sold from Edinburg y debe de ser Pharr»* — y tenía razón, porque en ese modelo «Vendido desde» decía
 * la tienda que **pedía** el material, no la que lo mandaba.
 *
 * Ahora en una Intertienda se elige **a qué tienda se le pide**, y esa elección escribe «Vendido desde»
 * y la recogida a la vez (`eligeOrigen`), así que el origen vuelve a ser `store` en todos los tipos y
 * este caso especial desaparece. La regla ya no hace falta para saberlo.
 */
export function origenDeLaOrden(
  d: Pick<Partial<Delivery>, "store">,
  tiendas: NamedLocation[],
): { nombre: string; direccion: string } {
  return { nombre: d.store ?? "", direccion: direccionDeTienda(d.store, tiendas) };
}

/**
 * ¿El sitio de origen es el de destino? Solo cuenta en un movimiento tienda-a-tienda.
 *
 * Por nombre (`delivery_name`), o porque la entrega va a la dirección guardada de la tienda de origen,
 * que es lo que enseña el desplegable de destino. `tiendas` es obligatorio a propósito: sin la lista,
 * la segunda comparación no existe y el hueco de D-276 vuelve en silencio.
 *
 * El origen lo decide `origenDeLaOrden`, que desde D-312 es «Vendido desde» en todos los tipos.
 */
export function origenEsDestino(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "pickup_address" | "delivery_name" | "delivery_address">,
  regla: Pick<OrderTypeRule, "storeToStore" | "homeIsDestination">,
  tiendas: NamedLocation[],
): boolean {
  if (regla.storeToStore !== true) return false;
  const origen = origenDeLaOrden(d, tiendas);
  const nombre = normalizaLugar(origen.nombre);
  const dirOrigen = normalizaLugar(origen.direccion);
  // Sin nombre NI dirección no hay origen que comparar. Con uno de los dos, basta ese: una recogida
  // sin nombre pero con la dirección del destino es la misma orden que no va a ningún sitio.
  if (!nombre && !dirOrigen) return false;
  if (!!nombre && nombre === normalizaLugar(d.delivery_name)) return true;
  return !!dirOrigen && dirOrigen === normalizaLugar(d.delivery_address);
}

/**
 * **Las tiendas a las que les importa esta orden** (D-309).
 *
 * El dueño: *«in intertienda orders people from both pickup and delivery store can see the order
 * because les importa a ambos»*.
 *
 * En un movimiento tienda-a-tienda son hasta tres columnas y no una: `store` («Vendido desde»),
 * `pickup_name` (la que **envía** el material) y `delivery_name` (la que **recibe**). Desde D-312 una
 * Intertienda bien formada tiene `store` y `pickup_name` en la tienda que manda, y `delivery_name` en
 * la que recibe, así que lo normal es que devuelva dos. Se miran las tres igualmente porque las órdenes
 * de D-302 —con `store` en la tienda que recibe— siguen vivas, y las de antes de D-302 también.
 *
 * En los demás tipos la tienda de una orden es `store`, como siempre.
 *
 * Devuelve los nombres **como están guardados**, sin repetir: quien compare que normalice, y quien
 * pinte tiene el nombre de verdad.
 */
export function tiendasDeLaOrden(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name">,
  regla: Pick<OrderTypeRule, "storeToStore">,
): string[] {
  const candidatas = regla.storeToStore === true
    ? [d.store, d.pickup_name, d.delivery_name]
    : [d.store];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const n of candidatas) {
    const clave = normalizaLugar(n);
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push((n as string).trim());
  }
  return salida;
}

/**
 * ¿Alguna de las tiendas de esta orden es la mía (o del grupo con el que trabaja, D-293)?
 *
 * Es **la** decisión de «las dos tiendas ven la orden», y vive aquí en vez de en la pantalla a
 * propósito: la pantalla de Órdenes y la cola de almacén tienen que contestar lo mismo, y dos copias
 * acaban contestando distinto.
 *
 * Sin tienda propia devuelve false: quien no tiene tienda no gana visibilidad por esta vía.
 */
export function tiendaDeLaOrdenEsMia(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name">,
  regla: Pick<OrderTypeRule, "storeToStore">,
  miTienda: string | null | undefined,
  tiendas: NamedLocation[],
): boolean {
  if (!normalizaLugar(miTienda)) return false;
  return tiendasDeLaOrden(d, regla).some((n) => mismaTiendaOGrupo(n, miTienda, tiendas));
}

/** Elegir «Vendido desde»: la tienda, y su nombre y su dirección como recogida. Lo que hace el modal. */
export function eligeOrigen(p: Partial<Delivery>, v: string, tiendas: NamedLocation[]): Partial<Delivery> {
  const st = tiendas.find((s) => s.name === v);
  return { ...p, store: v, pickup_name: v || p.pickup_name, pickup_address: st?.address ? st.address : p.pickup_address };
}

/**
 * Elegir **dónde se recoge** en una Intertienda, aparte de a quién se le compra (D-343).
 *
 * D-312 dejó la recogida pegada a «Vendido desde»: se recogía en la tienda a la que se le pide y el
 * campo no se tecleaba. El dueño lo abre: *«pickup should enable a dropdown of the store he is
 * shipping and the user should be able to edit it»* — el material que vende una tienda puede salir
 * físicamente de otra. Escribe SOLO la recogida: «Vendido desde» y la cuenta no se tocan.
 *
 * Elegir «Vendido desde» sigue rellenando la recogida con esa misma tienda (`eligeOrigen`): es el
 * caso normal y el valor de partida; esto es para cuando no coincide.
 */
export function eligeRecogida(p: Partial<Delivery>, v: string, tiendas: NamedLocation[]): Partial<Delivery> {
  const st = tiendas.find((s) => s.name === v);
  return { ...p, pickup_name: v, pickup_address: st?.address ?? "" };
}

/**
 * La tienda donde se recoge, **cuando no es la que vende** (D-343); `null` si coinciden o si la
 * recogida no es una tienda. La hoja del chofer dice «de <Vendido desde>» (D-312): con la recogida
 * ya editable, callarse la otra tienda mandaría al chofer a la que no tiene el material.
 */
export function recogidaAparte(d: Pick<Partial<Delivery>, "store" | "pickup_name">, tiendas: NamedLocation[]): string | null {
  const st = tiendas.find((s) => mismoNombre(s.name, d.pickup_name));
  return st && !mismoNombre(st.name, d.store) ? st.name : null;
}

/** Las tiendas donde se puede recoger una Intertienda (D-343): todas menos la que recibe. La ya guardada se queda, para que una orden vieja no pierda su valor al abrirla. */
export function opcionesDeRecogida(d: Pick<Partial<Delivery>, "pickup_name" | "delivery_name">, tiendas: NamedLocation[]): string[] {
  return tiendas.map((s) => s.name).filter((n) => mismoNombre(n, d.pickup_name) || !mismoNombre(n, d.delivery_name));
}

/**
 * Elegir la tienda de destino: su nombre, su dirección y **la cuenta** (D-312).
 *
 * La cuenta de un movimiento entre tiendas es la tienda que **recibe**. Damaris, de office: *«Account se
 * debe de llenar automáticamente con el nombre de mi tienda cuando es intertienda»*. Se escribe aquí y
 * no en la pantalla para que cambiar el destino la arrastre: una cuenta que se queda con la tienda de
 * antes es peor que ninguna.
 *
 * **El contacto sigue sin escribirse** (D-309): lo hacía hasta entonces y rellenaba un campo que ya no
 * se enseña. Esto devuelve la cuenta, no el contacto ni el teléfono.
 *
 * Esta función solo se usa en el destino de un tipo tienda-a-tienda, así que no hay otro camino que
 * gane una cuenta que no le toca.
 */
export function eligeDestino(p: Partial<Delivery>, v: string, tiendas: NamedLocation[]): Partial<Delivery> {
  const st = tiendas.find((s) => s.name === v);
  return { ...p, delivery_name: v, delivery_address: st?.address ?? "", account: v };
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
