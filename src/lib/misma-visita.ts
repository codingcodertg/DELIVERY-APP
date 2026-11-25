import { esTramoEntreTiendas } from "@/lib/relevo-etiqueta";
import { isStoreToStore, type OrderTypeRules } from "@/lib/required";
import { tiendaConPuntoDeAjustes } from "@/lib/tienda-de-ajustes";
import type { NamedLocation } from "@/lib/types";

/**
 * QUÉ ES UNA MISMA VISITA: la única definición de «parada» de la lista de una ruta (Gestor, «Mi ruta», mapa, PNG, plan, línea de
 * tiempo). El dueño, 2026-11-25: un chofer que hace una Intertienda descarga en la tienda y carga en esa misma tienda; eso es
 * UNA parada, no dos.
 *
 * Cada fila tiene un LUGAR:
 *   · una recogida (P) → la tienda donde se recoge (`pickup_name`, o `store`; `tiendaDeRecogida`);
 *   · una entrega (D) → la TIENDA a la que se entrega, si el destino ES una tienda (ver `tiendaDeDestinoDeLaOrden`); si no,
 *     la dirección del cliente.
 *
 * Filas SEGUIDAS con el MISMO lugar son UNA parada. Descargas y cargas en la misma tienda se juntan, en cualquier mezcla. Una
 * vuelta posterior a la misma tienda, con otro sitio en medio, es otra parada.
 *
 * Dos entregas SEGUIDAS a la misma dirección de cliente siguen siendo una parada, como hasta aquí (D-485): esta regla no
 * añade ni quita nada de las direcciones (`lugarDeLaFila`). Solo cambia lo de las TIENDAS.
 *
 * No cambia el orden de las filas: la descarga va antes que la carga si la lista lo tiene así; ordenar es del motor y de la
 * persona, no de esta función.
 */

/** Lo que hace falta de una orden para saber a qué lugar va su entrega. */
export interface OrdenDeDestino {
  id: string;
  delivery_address?: string | null;
  delivery_name?: string | null;
  order_type?: string | null;
  relay_step?: number | null;
}

/** La fila de la lista que hace falta para su lugar: una recogida (con su tienda) o una entrega (con su orden). */
export type FilaDeVisita = { tipo: "P"; ordenes: string[]; tienda: string | null } | { tipo: "D"; orden: string };

const normaliza = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * ¿La entrega de esta orden es a una TIENDA? Lo mismo que el motor de rutas (`entradaDelDia`, `entreTiendas`): la orden es un
 * traslado entre tiendas (`order_type` con `storeToStore` en las reglas de tipo) o el tramo entre tiendas de un relevo
 * (`relay_step` 1), Y su `delivery_name` nombra una tienda de Ajustes CON punto (lat y lng; la misma búsqueda del motor,
 * sin mayúsculas ni espacios de más). Si el nombre no coincide, o la tienda no tiene punto, o el tipo es de cliente, la
 * entrega NO es a una tienda: va a la dirección del cliente, como hasta aquí, y NO se junta con la recogida de esa tienda.
 * Devuelve el nombre de la tienda de Ajustes, o `null`.
 */
export function tiendaDeDestinoDeLaOrden(
  d: OrdenDeDestino, tiendas: readonly NamedLocation[], reglas: OrderTypeRules | undefined,
): string | null {
  const entreTiendas = isStoreToStore(d.order_type, reglas) || esTramoEntreTiendas(d);
  if (!entreTiendas) return null;
  return tiendaConPuntoDeAjustes(tiendas, d.delivery_name)?.name ?? null;
}

/**
 * El destino de TIENDA de cada orden, como BÚSQUEDA por id (`destinoDeTiendaDe`). Las órdenes no llevan ningún campo nuevo:
 * la pantalla construye esta función una vez (con las órdenes del día, la lista de tiendas y las reglas de tipo) y la pasa a
 * los números, los grupos y el mapa. Una orden que no está en la lista no tiene destino de tienda.
 */
export type DestinoDeTiendaDe = (ordenId: string) => string | null;

export function destinoDeTiendaDe(
  ordenes: readonly OrdenDeDestino[], tiendas: readonly NamedLocation[], reglas: OrderTypeRules | undefined,
): DestinoDeTiendaDe {
  const porId = new Map(ordenes.map((o) => [o.id, tiendaDeDestinoDeLaOrden(o, tiendas, reglas)]));
  return (ordenId) => porId.get(ordenId) ?? null;
}

/** Sin tiendas: ninguna entrega es a una tienda (la regla de siempre: solo cuenta la dirección). */
export const SIN_DESTINO_DE_TIENDA: DestinoDeTiendaDe = () => null;

/**
 * El LUGAR de una fila, como clave («T:rdz pharr» o «D:1 main st, edinburg»), o `null` si no se sabe (sin tienda en una
 * recogida, sin dirección en una entrega): una fila sin lugar va sola. Una tienda y otra dirección nunca tienen la misma clave.
 */
export function lugarDeLaFila(f: FilaDeVisita, porId: ReadonlyMap<string, OrdenDeDestino>, destinoDe: DestinoDeTiendaDe): string | null {
  if (f.tipo === "P") { const t = normaliza(f.tienda); return t ? `T:${t}` : null; }
  const tienda = normaliza(destinoDe(f.orden));
  if (tienda) return `T:${tienda}`;
  const dir = normaliza(porId.get(f.orden)?.delivery_address).replace(/\s+/g, " ");
  return dir ? `D:${dir}` : null;
}

/**
 * El grupo de cada fila (0, 1, 2… en el orden de la lista), o `null` si va sola. Solo agrupa lo SEGUIDO con el mismo lugar.
 * Es la función que usan la numeración de paradas, los colores de grupo de la tabla y la tabla del plan (`gruposDeMismoLugar`
 * en lista-unica.ts, que la delega aquí).
 */
export function gruposDeLaVisita(
  filas: readonly FilaDeVisita[], ordenes: readonly OrdenDeDestino[], destinoDe: DestinoDeTiendaDe = SIN_DESTINO_DE_TIENDA,
): (number | null)[] {
  // Si una orden llega en dos filas (la P y la D, como en el plan), manda la ÚLTIMA, como siempre (`new Map`).
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const claves = filas.map((f) => lugarDeLaFila(f, porId, destinoDe));
  const out: (number | null)[] = filas.map(() => null);
  let grupo = -1;
  for (let i = 0; i < filas.length; i++) {
    const k = claves[i];
    if (k == null) continue;
    const conLaDeAntes = i > 0 && claves[i - 1] === k;
    const conLaDeDespues = i + 1 < filas.length && claves[i + 1] === k;
    if (!conLaDeAntes && conLaDeDespues) grupo++;
    if (conLaDeAntes || conLaDeDespues) out[i] = grupo;
  }
  return out;
}
