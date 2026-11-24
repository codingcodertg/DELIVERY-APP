/**
 * KPI de almacén (D-NEXT, ayuda de Roberto, 24 nov 2026): a la izquierda ya no hay enlaces a otras pantallas sino
 * filtros. «Don't make them open the pages, make them filters for the specific KPI's. KPI's will all be shown by default
 * until they select the filter.» Sin filtro se ven todos los KPI; con uno, solo los de esa categoría. Un solo filtro a la vez.
 *
 * Todo puro: decide qué grupos de tarjetas se pintan. Sin React, sin base.
 */

/** «todos» = nada elegido (valor por defecto). */
export type FiltroDeKpi = "todos" | "merma" | "mantenimiento" | "conteos";

/** Los grupos de tarjetas. `listas` y `tiempo` solo aparecen sin filtro. */
export type GrupoDeKpi = "listas" | "merma" | "tiempo" | "mantenimiento" | "conteos";

/** Qué tarjetas se ven con cada filtro, en el orden en que se pintan. */
export function gruposDeKpiVisibles(filtro: FiltroDeKpi): GrupoDeKpi[] {
  switch (filtro) {
    case "merma": return ["merma"];
    case "mantenimiento": return ["mantenimiento"];
    case "conteos": return ["conteos"];
    default: return ["listas", "merma", "tiempo", "mantenimiento", "conteos"];
  }
}

/** Pulsar un botón: si ya estaba elegido se quita (vuelven todos); si no, pasa a ser el único elegido. */
export function alternarFiltroDeKpi(actual: FiltroDeKpi, pulsado: Exclude<FiltroDeKpi, "todos">): FiltroDeKpi {
  return actual === pulsado ? "todos" : pulsado;
}
