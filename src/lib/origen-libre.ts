import type { NamedLocation, OrderTypeRule, UserRole } from "@/lib/types";
import { mismaTiendaOGrupo, trabajaConOtras } from "@/lib/store-group";

/**
 * Origen libre (D-537) y las reglas de tipo que guarda Datos.
 *
 * El dueño, 2026-10-13, al pedir el tipo «Other»: *«INICIANDO SE PUEDE ELEGIR OTRA TIENDA DE ORIGIEN
 * NO NECESARIAMENTE LA DEL ORIGIN DEL SALES GUY»*. Hasta aquí un vendedor con tienda solo vendía desde
 * la suya o las de su grupo (D-293). Con `anyOrigin` en la regla del tipo, elige cualquiera.
 *
 * Viven aquí, y no dentro de la ficha, para que las pruebas importen lo que decide y no una copia.
 */

type Yo = { role: UserRole; store?: string | null };

/** Las tiendas que el selector de «Vendido desde» le ofrece a esta persona, de entre `todas`. La que
 *  ya tiene la orden se conserva siempre (D-267). */
export function origenesPermitidos(
  todas: string[],
  yo: Yo,
  regla: OrderTypeRule,
  actual: string | null | undefined,
  tiendas: readonly NamedLocation[],
): string[] {
  if (yo.role !== "sales" || !yo.store || regla.anyOrigin === true) return todas;
  return todas.filter((n) => mismaTiendaOGrupo(n, yo.store, tiendas) || n === actual);
}

/** ¿El selector de «Vendido desde» queda fijo? Solo para un vendedor con tienda, en un tipo que no
 *  recibe ni tiene origen libre, y si su tienda no trabaja con ninguna otra (D-293). */
export function origenFijo(yo: Yo, regla: OrderTypeRule, tiendas: readonly NamedLocation[]): boolean {
  return yo.role === "sales" && !!yo.store && regla.homeIsDestination !== true && regla.anyOrigin !== true
    && !trabajaConOtras(yo.store, tiendas);
}

/** Una fila de la tabla de tipos de Datos. `orig` es el nombre con que se leyó (null si es nueva). */
export type FilaDeTipo = {
  orig: string | null;
  name: string;
  storeToStore: boolean;
  docRef: OrderTypeRule["docRef"];
  homeIsDestination: boolean;
  anyOrigin: boolean;
};

/**
 * Lo que guarda Datos → Tipos de orden. Cada regla parte de la que había (por su nombre original,
 * para que renombrar no la pierda) y encima pone lo que la tabla enseña. Antes se escribía cada regla
 * con solo tres campos, y guardar le quitaba a «Proveedor» su `hasCustomer: false` (D-511): volvía a
 * comportarse como si tuviera cliente (aviso por SMS incluido).
 */
export function reglasAlGuardar(
  filas: readonly FilaDeTipo[],
  previas: Record<string, OrderTypeRule> | null | undefined,
): { names: string[]; rules: Record<string, OrderTypeRule> } {
  const names: string[] = [];
  const rules: Record<string, OrderTypeRule> = {};
  for (const r of filas) {
    const name = r.name.trim();
    if (!name || names.includes(name)) continue; // vacías y repetidas fuera
    names.push(name);
    const antes = r.orig != null ? previas?.[r.orig] : undefined;
    rules[name] = { ...antes, storeToStore: r.storeToStore, docRef: r.docRef, homeIsDestination: r.homeIsDestination, anyOrigin: r.anyOrigin };
  }
  return { names, rules };
}
