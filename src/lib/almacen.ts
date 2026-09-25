import type { Delivery, NamedLocation, OrderTypeRule } from "@/lib/types";
import { normalizaLugar, tiendasDeLaOrden } from "@/lib/order-endpoints";
import { tiendasDelGrupo } from "@/lib/store-group";

/**
 * Qué le toca a almacén, y qué va a **Recepción**.
 *
 * El dueño: *«warehouse should only see what they are in charge of»* y *«for warehouse a new view
 * where the loads intertienda going to his store will be visible; these orders will be extracted
 * from his list and passed to that one»*.
 *
 * **No es un permiso nuevo: es un reparto.** La cola de almacén ya veía las tres cosas juntas —lo
 * que sale de su tienda, lo que entra, y lo que se recoge físicamente allí— y lo que se pide es
 * partirla en dos listas. Por eso vive en la pantalla y no en la base: la base ya decide **si**
 * puede leer la orden; esto decide **en qué lista sale**.
 *
 * ### Qué campo dice el destino
 *
 * El dueño lo dijo por la cuenta —*«if account in intertienda is my store then put that under
 * receiving»*— pero **la cuenta es una copia del destino, no el destino**: `order-sites.ts` la
 * escribe desde `delivery_name` al elegirlo (D-312), y después es texto libre que se puede teclear
 * encima. **Medido en producción el 2026-09-23: de 123 Intertiendas, la cuenta coincide con el
 * destino en solo 51.** Así que manda `delivery_name`, que es el campo que no miente.
 *
 * Y **2 no tienen destino ninguno**. Esas no se pueden clasificar, así que **no se esconden**: se
 * quedan donde estaban —en la cola— y se cuentan aparte para que la pantalla lo diga. Perder dos
 * órdenes en silencio por no saber dónde ponerlas sería peor que enseñarlas mal.
 */

export type ReglaDeTipo = Pick<OrderTypeRule, "storeToStore">;

/** Las tiendas cuya cola prepara esta persona: la suya y las de su grupo (D-293), normalizadas. */
export function tiendasDeAlmacen(miTienda: string | null | undefined, tiendas: NamedLocation[]): string[] {
  return tiendasDelGrupo(miTienda, tiendas).map(normalizaLugar).filter(Boolean);
}

/** ¿Alguna de las tiendas de esta orden es de las mías? Es el corte de «lo que me toca». */
export function esDeMisTiendas(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name">,
  regla: ReglaDeTipo,
  misTiendas: readonly string[],
): boolean {
  if (misTiendas.length === 0) return false;
  return tiendasDeLaOrden(d, regla).map(normalizaLugar).some((n) => misTiendas.includes(n));
}

/**
 * ¿Esta orden **entra** a mi tienda? Una Intertienda cuyo **destino** es una de las mías.
 *
 * Si además sale de una de las mías —una Intertienda entre dos tiendas del mismo grupo— **no es
 * recepción**: no se está recibiendo de fuera, y sacarla de la cola escondería trabajo propio. La
 * condición es «entra Y no sale».
 */
export function esParaRecibir(
  d: Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name">,
  regla: ReglaDeTipo,
  misTiendas: readonly string[],
): boolean {
  if (regla.storeToStore !== true || misTiendas.length === 0) return false;
  const destino = normalizaLugar(d.delivery_name);
  if (!destino || !misTiendas.includes(destino)) return false;
  const sale = [d.store, d.pickup_name].map(normalizaLugar).some((n) => !!n && misTiendas.includes(n));
  return !sale;
}

/** Una Intertienda **sin destino**: no se puede repartir entre las dos listas, y no se pierde. */
export function intertiendaSinDestino(
  d: Pick<Partial<Delivery>, "delivery_name">,
  regla: ReglaDeTipo,
): boolean {
  return regla.storeToStore === true && normalizaLugar(d.delivery_name) === "";
}

export interface ColaDeAlmacen<T> {
  /** Lo que sale de sus tiendas: su cola de siempre, menos lo que se va a Recepción. */
  cola: T[];
  /** Las Intertiendas que su tienda RECIBE. */
  recepcion: T[];
  /** Las Intertiendas sin destino que quedaron en la cola, para poder decirlo. */
  sinDestino: T[];
}

/**
 * Las dos listas, repartidas de una vez.
 *
 * **Se devuelven juntas a propósito**, como en `ordenesVisibles`: dos listas parecidas calculadas en
 * dos sitios acaban discrepando, y entonces un contador dice un número y la tabla enseña otro.
 *
 * Sin tiendas —alguien de almacén sin tienda asignada, o un admin mirando sin elegir una— **no se
 * reparte nada**: todo se queda en la cola. Repartir sin saber cuál es «mi tienda» sería inventarse
 * el criterio.
 */
export function reparteLaColaDeAlmacen<T extends Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name" | "order_type">>(
  ordenes: readonly T[],
  reglaDe: (d: T) => ReglaDeTipo,
  misTiendas: readonly string[],
): ColaDeAlmacen<T> {
  if (misTiendas.length === 0) return { cola: [...ordenes], recepcion: [], sinDestino: [] };
  const cola: T[] = [];
  const recepcion: T[] = [];
  const sinDestino: T[] = [];
  for (const d of ordenes) {
    const regla = reglaDe(d);
    if (esParaRecibir(d, regla, misTiendas)) { recepcion.push(d); continue; }
    cola.push(d);
    if (intertiendaSinDestino(d, regla)) sinDestino.push(d);
  }
  return { cola, recepcion, sinDestino };
}

/**
 * Lo que tiene cada vista de almacén: su texto de búsqueda y su pestaña de etapa.
 *
 * El dueño, el 2026-09-25: *«THE SAME FILTERS AND SEARCH BAR MOVE IT INTO RECEIVING WAREHOUSE»*.
 * Recepción tiene los **mismos** filtros que la Cola, y por eso es la misma función y el mismo
 * componente (`components/FiltrosDeAlmacen.tsx`), no una copia: si mañana la búsqueda mira otro
 * campo, lo mira en las dos.
 *
 * **Cada vista guarda el suyo.** Buscar una factura en Recepción no debe dejar la Cola filtrada por
 * esa factura al volver. Antes pasaba algo parecido al revés: la búsqueda de la Cola se aplicaba
 * ANTES del reparto, así que vaciaba también Recepción —y su contador— sin que Recepción tuviera
 * barra donde verlo.
 */
export interface FiltroDeVista {
  /** Lo que se teclea en la barra: se busca en el número de factura. */
  q: string;
  /** La pestaña de etapa, o `all`. */
  tab: string;
}

export interface VistaFiltrada<T> {
  /** Las que pasan la búsqueda (o la ventana de fechas si no se busca), en todas las etapas. */
  visibles: T[];
  /** Cuántas de `visibles` hay en cada etapa: lo que dice cada pastilla. */
  cuentas: Record<string, number>;
  /** Las filas de la tabla: `visibles` en la pestaña elegida. */
  filas: T[];
}

/**
 * Busca y filtra UNA lista de almacén —la Cola o Recepción— sin mirar la otra.
 *
 * - **Buscando**, se compara con el número de factura y **se salta la ventana de fechas**: es el
 *   único camino al historial en esta pantalla (D-239, D-374), y en Recepción vale lo mismo.
 * - **Sin buscar**, pasa solo lo que está dentro de la ventana. Quién la tiene lo decide quien
 *   llama (`dentroDeLaVentana`), porque depende del rol REAL y de los permisos.
 * - **«Todas»** ordena de la más nueva a la más vieja; una etapa conserva el orden de llegada.
 *   Es lo que la Cola hacía antes de salir de la pantalla, sin cambiar nada.
 *
 * Las cuentas y las filas salen de la misma `visibles`: la pastilla y la tabla no pueden decir
 * cosas distintas.
 */
export function filtraLaVistaDeAlmacen<T extends Pick<Delivery, "stage" | "invoice_num" | "order_no">>(
  lista: readonly T[],
  filtro: FiltroDeVista,
  dentroDeLaVentana: (d: T) => boolean,
): VistaFiltrada<T> {
  const needle = filtro.q.trim().toLowerCase();
  const visibles = lista.filter((d) => (needle
    ? (d.invoice_num || "").toLowerCase().includes(needle)
    : dentroDeLaVentana(d)));
  const cuentas: Record<string, number> = {};
  for (const d of visibles) cuentas[d.stage] = (cuentas[d.stage] ?? 0) + 1;
  const filas = filtro.tab === "all"
    ? [...visibles].sort((a, b) => b.order_no - a.order_no)
    : visibles.filter((d) => d.stage === filtro.tab);
  return { visibles, cuentas, filas };
}
