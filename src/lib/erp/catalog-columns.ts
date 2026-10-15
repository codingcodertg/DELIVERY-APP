// Las columnas del catálogo del ERP (catalog-table.tsx) y su disposición: cuáles hay, en qué orden,
// cuáles se ven, por cuál se ordena, y cómo se lee eso de una vista guardada (D-NEXT, traspaso del
// commit cca6a99 de BH). Puro —sin React ni TanStack en tiempo de ejecución— para que la prueba lo
// IMPORTE: la tabla solo le pasa ids y pinta lo que devuelve.
//
// Una vista guardada (`erp.saved_views.state`, jsonb sin restricción de forma: 063, políticas en
// 066/070) es JSON libre, escrito por la versión de la app que la guardó. Las anteriores a D-NEXT no
// traen las claves de columnas, y cualquiera puede nombrar columnas que esta sesión no tiene. Por eso
// todo lo guardado se trata como `unknown` y solo se queda lo que coincide con una columna real.
//
// Costo y margen (#29): la lista de columnas de staff NO los incluye, así que cualquier id `cost` o
// `margin_pct` que traiga una vista (orden, visibilidad u ordenación) se cae al leerla. Las vistas son
// de su dueño (RLS «saved_views own select»), así que el caso real es un manager al que le bajan el
// rol y conserva sus vistas; la regla vale igual para cualquier otro.

import type { ColumnOrderState, SortingState, VisibilityState } from "@tanstack/react-table";
import { CATALOG_SORTS } from "@/lib/erp/catalog";

/** La ordenación por defecto de la tabla; el servidor cae a la misma (actions.ts). */
export const DEFAULT_SORTING: SortingState = [{ id: "name", desc: false }];

/** Lo que la lógica necesita saber de cada columna. */
export type ColumnInfo = { id: string; canSort: boolean; canHide: boolean };

/** Una columna del catálogo con su etiqueta en los dos idiomas (para el ⚙ Columnas y el menú). */
export type CatalogColumn = ColumnInfo & { en: string; es: string; cost?: true };

/** Ids de las columnas que solo existen para quien ve costo. */
export const COST_COLUMN_IDS = ["cost", "margin_pct"] as const;

// En su orden por defecto. «Request» va justo después de Name, no al final: la tabla mide ~1.500 px y
// una última columna queda fuera de la pantalla de un portátil.
const TODAS: (Omit<CatalogColumn, "canSort"> & { request?: true })[] = [
  { id: "thumb", en: "Image", es: "Imagen", canHide: true },
  { id: "sku", en: "SKU", es: "SKU", canHide: true },
  { id: "name", en: "Name", es: "Nombre", canHide: false }, // nunca se oculta: la tabla no puede quedarse sin columnas
  { id: "request", en: "Request", es: "Solicitar", canHide: true, request: true },
  { id: "status", en: "Status", es: "Estado", canHide: true },
  { id: "product_type", en: "Type", es: "Tipo", canHide: true },
  { id: "category_path", en: "Category", es: "Categoría", canHide: true },
  { id: "vendor_name", en: "Vendor", es: "Proveedor", canHide: true },
  { id: "price", en: "Price", es: "Precio", canHide: true },
  { id: "cost", en: "Cost/box", es: "Costo/caja", canHide: true, cost: true },
  { id: "margin_pct", en: "Margin", es: "Margen", canHide: true, cost: true },
  { id: "qoh", en: "QOH", es: "QOH", canHide: true },
  { id: "review", en: "Needs review", es: "Requiere revisión", canHide: true },
];

/**
 * Las columnas que ESTA sesión tiene, en su orden por defecto. Sin costo, ni Cost ni Margin existen;
 * sin los datos del formulario de solicitud (`canRequest`), tampoco la columna Request. Se puede
 * ordenar exactamente por las que ordena el servidor (CATALOG_SORTS).
 */
export function catalogColumns(opts: { canSeeCost: boolean; canRequest: boolean }): CatalogColumn[] {
  return TODAS.filter((c) => (!c.cost || opts.canSeeCost) && (!c.request || opts.canRequest)).map(
    ({ request: _r, ...c }) => ({ ...c, canSort: CATALOG_SORTS.has(c.id) }),
  );
}

/**
 * Un orden completo: los ids guardados que siguen existiendo, en su orden guardado, y cada columna que
 * la vista no nombraba puesta junto a su vecina izquierda por defecto. Cubre una vista guardada antes
 * de que existiera una columna y una guardada por un rol que veía menos. TanStack, por su cuenta, las
 * pondría al final, a la derecha, fuera de la pantalla.
 */
export function resolveColumnOrder(saved: unknown, defaults: readonly string[]): ColumnOrderState {
  const known = new Set(defaults);
  const out: string[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) if (typeof id === "string" && known.has(id) && !out.includes(id)) out.push(id);
  }
  defaults.forEach((id, i) => {
    if (out.includes(id)) return;
    out.splice(i === 0 ? 0 : out.indexOf(defaults[i - 1]) + 1, 0, id);
  });
  return out;
}

/**
 * La visibilidad de las columnas que existen, desde un mapa guardado. Ids desconocidos fuera (un
 * `cost: true` guardado no significa nada sin columna de costo), valores no booleanos fuera, y una
 * columna que no se puede ocultar no llega oculta. Un id ausente significa «se ve», como en TanStack.
 */
export function resolveColumnVisibility(saved: unknown, columns: readonly ColumnInfo[]): VisibilityState {
  const out: VisibilityState = {};
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return out;
  const map = saved as Record<string, unknown>;
  for (const c of columns) {
    const v = map[c.id];
    if (typeof v !== "boolean") continue;
    if (!v && !c.canHide) continue;
    out[c.id] = v;
  }
  return out;
}

/**
 * La ordenación guardada, si nombra una columna que esta tabla sabe ordenar; si no, la de por
 * defecto. Solo la primera entrada: el servidor solo ordena por una (sortId/sortDesc).
 */
export function resolveSorting(saved: unknown, columns: readonly ColumnInfo[]): SortingState {
  const first: unknown = Array.isArray(saved) ? saved[0] : undefined;
  if (first && typeof first === "object") {
    const { id, desc } = first as { id?: unknown; desc?: unknown };
    if (typeof id === "string" && columns.some((c) => c.id === id && c.canSort)) return [{ id, desc: desc === true }];
  }
  return DEFAULT_SORTING;
}

/** La parte de columnas de una vista guardada, lista para TanStack. Las claves que faltan, por defecto. */
export function columnStateFromView(state: Record<string, unknown>, columns: readonly ColumnInfo[]) {
  return {
    columnOrder: resolveColumnOrder(state.columnOrder, columns.map((c) => c.id)),
    columnVisibility: resolveColumnVisibility(state.columnVisibility, columns),
    sorting: resolveSorting(state.sorting, columns),
  };
}

/** ¿Se puede mover esta columna un paso (-1 izquierda/arriba, +1 derecha/abajo)? */
export function canMoveColumn(order: readonly string[], id: string, step: -1 | 1): boolean {
  const from = order.indexOf(id);
  const to = from + step;
  return from >= 0 && to >= 0 && to < order.length;
}

/** Mueve una columna un paso. Pasado cualquiera de los extremos, o con un id que no está, no hace nada. */
export function moveColumn(order: readonly string[], id: string, step: -1 | 1): ColumnOrderState {
  if (!canMoveColumn(order, id, step)) return [...order];
  const from = order.indexOf(id);
  const out = [...order];
  [out[from], out[from + step]] = [out[from + step], out[from]];
  return out;
}

/** Las columnas en el orden de la persona: lo que el ⚙ Columnas enumera. */
export function inOrder<C extends { id: string }>(columns: readonly C[], order: readonly string[]): C[] {
  const ids = resolveColumnOrder(order, columns.map((c) => c.id));
  return ids.map((id) => columns.find((c) => c.id === id)!);
}

/** Los ids que se ven (lo que el ⚙ Columnas marca). Ausente en el mapa = se ve. */
export function visibleIds(columns: readonly ColumnInfo[], visibility: VisibilityState): string[] {
  return columns.filter((c) => !c.canHide || visibility[c.id] !== false).map((c) => c.id);
}

/** Alterna una columna; una que no se puede ocultar (Name) se queda como está. */
export function toggleColumn(visibility: VisibilityState, column: ColumnInfo): VisibilityState {
  if (!column.canHide) return visibility;
  return { ...visibility, [column.id]: visibility[column.id] === false };
}

/** «Ocultar columna» del menú de cabecera: siempre oculta (no alterna); con Name no hace nada. */
export function hideColumn(visibility: VisibilityState, column: ColumnInfo): VisibilityState {
  if (!column.canHide) return visibility;
  return { ...visibility, [column.id]: false };
}

/** ¿El orden es distinto del de por defecto? (enseña «Restablecer orden»). */
export function isCustomOrder(order: readonly string[], defaults: readonly string[]): boolean {
  const resolved = resolveColumnOrder(order, defaults);
  return resolved.some((id, i) => id !== defaults[i]);
}
