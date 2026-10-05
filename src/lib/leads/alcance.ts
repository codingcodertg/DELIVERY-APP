import type { Lead } from "./reglas";

/**
 * «Leads», quién ve los leads de qué tienda (migración 163).
 *
 * El dueño (2026-10-04): «solo el manager puede ver leads de otras tiendas configurable en user permisions, pero
 * sales solo puede ver su tienda».
 *
 * **Quien manda es la base**: la política de `leads` y de `lead_events`, y la comprobación dentro de `lead_take`
 * (migración 163). Lo de aquí es lo MISMO escrito otra vez, para tres cosas: que el modo demo se comporte como la
 * base, que la pantalla no enseñe un selector de tiendas a quien solo tiene una, y que cada regla tenga una prueba
 * que se pueda leer. La pantalla NO decide el alcance con estas funciones cuando hay base: se lo pregunta a la base
 * (`leads_my_scope()`), y si esa función aún no existe —el código llega antes que la 163— se queda como antes.
 */

/** La palabra que va en `profiles.permissions` (la lista de permisos por persona de la 052). La misma en la 163. */
export const PERMISO_OTRAS_TIENDAS = "leads_all_stores";

/** Lo mínimo de una persona para saber qué alcanza. */
export interface QuienMira {
  role: string | null | undefined;
  permissions?: readonly string[] | null;
  store?: string | null;
}

/** Qué alcanza quien mira: todas las tiendas, o solo el banco de la suya (y siempre lo que tiene a su nombre). */
export interface Alcance {
  todas: boolean;
  tienda: string | null;
}

/** Sin la 163 aplicada no hay regla por tienda: todo el que tiene el módulo lo ve todo, como dejó la 162. */
export const ALCANCE_SIN_REGLA: Alcance = { todas: true, tienda: null };

/**
 * ¿A este rol se le OFRECE el interruptor «ver leads de otras tiendas»? Solo al manager («solo el manager»). El
 * admin no lo necesita (lo ve todo siempre) y a ventas, oficina y logística no se les ofrece ni les sirve.
 */
export function seOfreceOtrasTiendas(role: string | null | undefined): boolean {
  return role === "manager";
}

/**
 * ¿Ve los leads de todas las tiendas? El admin, siempre. El manager, si tiene el permiso. Nadie más: a un vendedor
 * con la palabra en su lista (escrita a mano, o que le quedó de cuando era manager) NO le sirve.
 */
export function veOtrasTiendas(p: QuienMira): boolean {
  if (p.role === "admin") return true;
  return seOfreceOtrasTiendas(p.role) && !!p.permissions?.includes(PERMISO_OTRAS_TIENDAS);
}

/** Una tienda en blanco o solo con espacios no es una tienda. */
function tiendaLimpia(store: string | null | undefined): string | null {
  const s = (store ?? "").trim();
  return s === "" ? null : s;
}

/** El alcance de una persona. Lo mismo que devuelve `leads_my_scope()` en la base. */
export function alcanceDe(p: QuienMira): Alcance {
  return { todas: veOtrasTiendas(p), tienda: tiendaLimpia(p.store) };
}

/** ¿Este lead está en el banco que la persona alcanza? Es lo que `lead_take` exige antes de dejar tomarlo. */
export function esDeSuBanco(lead: Pick<Lead, "pool">, alcance: Alcance): boolean {
  if (alcance.todas) return true;
  return alcance.tienda !== null && lead.pool === alcance.tienda;
}

/**
 * ¿La persona puede LEER este lead? La política de la 163: lo de su banco, y además lo que tiene a su nombre
 * (tomado o vendido), aunque sea de otra tienda —por ejemplo, uno que le asignó un admin—.
 */
export function alcanzaElLead(lead: Pick<Lead, "pool" | "holder">, alcance: Alcance, yoId: string): boolean {
  return esDeSuBanco(lead, alcance) || lead.holder === yoId;
}

/**
 * Lo que enseña la pestaña del banco. Quien alcanza todas las tiendas, todo. Quien no, SOLO el banco de su tienda:
 * un lead suyo de otra tienda está en «Mi pool», y no hace aparecer aquí el banco de esa tienda (ni su contador).
 */
export function leadsDelBanco<L extends Pick<Lead, "pool">>(leads: readonly L[], alcance: Alcance): L[] {
  return leads.filter((l) => esDeSuBanco(l, alcance));
}

/** ¿Se enseña el selector de tienda? Solo a quien alcanza más de una. */
export function eligeTienda(alcance: Alcance): boolean {
  return alcance.todas;
}

/**
 * Lo que respondió `leads_my_scope()` (`{"all": bool, "store": text|null}`) como alcance. Cualquier cosa que no
 * sea exactamente eso se lee como lo más estrecho —ninguna tienda—: ante una respuesta rara no se abre nada.
 */
export function alcanceDeLaBase(valor: unknown): Alcance {
  if (!valor || typeof valor !== "object") return { todas: false, tienda: null };
  const v = valor as { all?: unknown; store?: unknown };
  return { todas: v.all === true, tienda: typeof v.store === "string" ? tiendaLimpia(v.store) : null };
}
