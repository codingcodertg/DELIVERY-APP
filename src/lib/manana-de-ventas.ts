import type { Profile } from "@/lib/types";
import { COLUMNAS_DEL_GESTOR } from "@/lib/routes-columns";

/**
 * Ventas con el chip «Mañana» en Órdenes (D-NEXT).
 *
 * El dueño, 2026-10-18: «when they clicked todas and hoy but when they clicked mananna sales people will eb able to see
 * all order from everyone for tomorrow but the columsn they will see the same columns as the ones showed in rutas de hoy
 * and if the the order is not from them when trying to open it to see the full details it wont open if its not theres».
 *
 * Tres piezas, cada una donde ya vivía la regla parecida:
 * - **qué filas**: `esMananaDeTodos` (`ordenes-visibles.ts`), junto a los demás cortes de la lista;
 * - **qué columnas**: aquí, derivadas del catálogo de la tabla de paradas de «Ruta de hoy» —no copiadas—;
 * - **qué se abre**: `puedeAbrirLaOrden` (D-544), en la puerta de la ficha; una ajena avisa y no se abre.
 */

/** ¿Está esta persona viendo «Mañana» como vendedor? Entonces la lista es la de todos y las columnas son estas. */
export function mananaDeTodosParaVentas(me: Pick<Profile, "role"> | null | undefined, chip: string): boolean {
  return me?.role === "sales" && chip === "tomorrow";
}

/**
 * Las columnas de Órdenes que corresponden a la tabla de paradas de «Ruta de hoy» (`routes/page.tsx`, `colsParadas`):
 * sus tres fijas —Parada, Factura # (con el ID al lado) y Pallets— y las del catálogo que salen por defecto en esa tabla
 * (`COLUMNAS_DEL_GESTOR`, `tablas: ["paradas"]`, no ocultas). «Parada» no existe en Órdenes (el ID va siempre). Las que
 * no son columnas de Órdenes se traducen a la suya más cercana; las que no tienen ninguna (la llegada, `p_eta`) se quedan
 * fuera.
 */
const EQUIVALENTE_EN_ORDENES: Readonly<Record<string, string>> = {
  p_type: "type",
  // «Ciudad de recogida» es la tienda de la que sale la carga: en Órdenes, la columna Tienda.
  p_ciudad_recogida: "store",
  // «Ciudad de entrega» es un trozo de la dirección: en Órdenes, la columna Dirección.
  p_address: "address",
  p_windows: "windows",
};
const FIJAS_DE_PARADAS: readonly string[] = ["invoice", "pallets"];

export const COLUMNAS_DE_MANANA_PARA_VENTAS: readonly string[] = [
  ...FIJAS_DE_PARADAS,
  ...COLUMNAS_DEL_GESTOR
    .filter((c) => c.tablas.includes("paradas") && !c.oculta)
    .map((c) => c.deOrdenes ?? EQUIVALENTE_EN_ORDENES[c.key])
    .filter((k): k is string => !!k),
];
