import type { Delivery, NamedLocation, Profile, UserRole } from "@/lib/types";
import { esDeMisTiendas, tiendasDeAlmacen } from "@/lib/almacen";
import { normalizaLugar } from "@/lib/order-endpoints";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { tiendasDelGrupo } from "@/lib/store-group";

/**
 * De qué tiendas son las cifras del Panel (D-396).
 *
 * El dueño, 2026-09-25: *«Juan Briseno (Office Manager) — the Dashboard tab should only contain data
 * of their own store, not all stores!!»*. El Panel pintaba **todas** las órdenes que traía el
 * proveedor, y para un gerente sin casillas en «Tiendas que ve» (D-315) eso son las de la empresa.
 *
 * **No es una regla nueva de tiendas.** «Mis tiendas» son la propia y las de su grupo (D-293), igual
 * que en la cola de almacén y en el tablero de Órdenes para almacén (D-374): `tiendasDeAlmacen` para
 * la lista y `esDeMisTiendas` para cada orden. Una Intertienda cuenta para las dos tiendas que toca
 * (D-309), así que puede salir en «Volumen por tienda» una barra de la otra tienda: es una orden que
 * también es suya.
 *
 * Esto es **de pantalla**. Quien decide qué filas llegan es la política de la 131 (D-315), y a un
 * gerente sin casillas marcadas le deja leer todas las tiendas: el Panel ya no las enseña, pero la
 * base las sigue mandando.
 */

/** Quien ve el Panel de todas las tiendas. Admin y logística, como en la ventana de D-374. */
export const ROLES_PANEL_DE_TODAS: readonly UserRole[] = ["admin", "logistics"];

export type AlcanceDelPanel =
  | { tipo: "todas" }
  /** `nombres` tal como están en Ajustes, para enseñarlos; `normalizadas` para comparar. */
  | { tipo: "tiendas"; nombres: string[]; normalizadas: string[] }
  /** No se le puede acotar a nada: se le avisa en vez de enseñarle la empresa (D-237). */
  | { tipo: "sin-tienda" };

/**
 * ¿De qué tiendas ve el Panel esta persona?
 *
 * - admin y logística: de todas;
 * - el resto (el gerente, y quien tenga la capacidad `dashboard` marcada a mano): la suya y las de su grupo;
 * - sin tienda asignada: ninguna, y la pantalla lo dice. Un campo sin rellenar no amplía (D-237).
 */
export function alcanceDelPanel(
  me: Pick<Profile, "role" | "store"> | null | undefined,
  tiendas: readonly NamedLocation[],
): AlcanceDelPanel {
  if (!me) return { tipo: "sin-tienda" };
  if (ROLES_PANEL_DE_TODAS.includes(me.role)) return { tipo: "todas" };
  const normalizadas = tiendasDeAlmacen(me.store, tiendas as NamedLocation[]);
  if (normalizadas.length === 0) return { tipo: "sin-tienda" };
  return { tipo: "tiendas", nombres: tiendasDelGrupo(me.store, tiendas), normalizadas };
}

/** Las órdenes que cuentan en el Panel. Todo lo demás de la pantalla sale de aquí. */
export function ordenesDelPanel<T extends Pick<Delivery, "store" | "pickup_name" | "delivery_name" | "order_type">>(
  deliveries: readonly T[],
  alcance: AlcanceDelPanel,
  reglas: OrderTypeRules | undefined,
): T[] {
  return deliveries.filter((d) => esDelAlcance(d, alcance, reglas));
}

/**
 * ¿Es esta orden de las tiendas del alcance? La pregunta de una sola orden, que usan el Panel
 * (`ordenesDelPanel`) y la pestaña «Factura pendiente» de Órdenes (D-404): la misma regla de tiendas
 * en los dos sitios, no una copia.
 */
export function esDelAlcance(
  d: Pick<Delivery, "store" | "pickup_name" | "delivery_name" | "order_type">,
  alcance: AlcanceDelPanel,
  reglas: OrderTypeRules | undefined,
): boolean {
  if (alcance.tipo === "todas") return true;
  if (alcance.tipo === "sin-tienda") return false;
  return esDeMisTiendas(d, orderTypeRule(d.order_type, reglas), alcance.normalizadas);
}

/**
 * Los choferes que cuentan en «Tiempo inactivo»: los **de sus tiendas** (`profiles.store`), o `null` si
 * cuentan todos.
 *
 * Un turno del reloj no es de una orden, es de un chofer, y no se puede partir por tienda: por eso el
 * corte va por la tienda del chofer. Y su tiempo activo se mide con **todas** sus entregas del rango,
 * no solo las de las tiendas del gerente: si no, a un chofer que también repartió para otra tienda se
 * le contaría ese rato como inactivo, y la cifra mentiría a favor de nadie.
 */
export function choferesDelPanel(
  alcance: AlcanceDelPanel,
  users: readonly Pick<Profile, "id" | "full_name" | "store">[],
): { ids: Set<string>; nombres: Set<string> } | null {
  if (alcance.tipo === "todas") return null;
  const suyos = alcance.tipo === "sin-tienda"
    ? []
    : users.filter((u) => alcance.normalizadas.includes(normalizaLugar(u.store)));
  return { ids: new Set(suyos.map((u) => u.id)), nombres: new Set(suyos.map((u) => u.full_name)) };
}
