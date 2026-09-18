/**
 * Qué filtros hay puestos en la tabla, para poder decirlo y quitarlos (D-NEXT).
 *
 * Baudelio, de Almacén: *«cuando pongo un filtro funciona, pero luego se me olvida que tengo un
 * filtro; hace falta un botón de limpiar filtro visible»*. Hasta ahora lo único que lo delataba
 * era el ▾ de la cabecera puesto en color, que hay que ir a buscar columna por columna —y en una
 * tabla con desplazamiento horizontal, la columna filtrada puede no estar ni en pantalla—.
 *
 * La cuenta vive aquí, aparte de la pantalla, porque decide dos cosas: si la barra se enseña y
 * qué dice. Sin navegador para probarlo.
 */

/** Un filtro por columna: el conjunto de valores marcados. Vacío = esa columna no filtra. */
export type FiltrosPorColumna = Record<string, Set<string>>;

/**
 * Las columnas que de verdad están filtrando, **en el orden en que se pintan**.
 *
 * El orden lo pone quien llama pasando sus columnas, no el orden en que se fueron poniendo los
 * filtros: la barra se lee junto a la tabla, y ahí las columnas tienen un orden a la vista.
 *
 * Un conjunto vacío no cuenta. Pasa de verdad: al vaciar un filtro desde su menú, la clave puede
 * quedarse con un conjunto sin elementos, y eso no filtra nada — decir «1 columna filtrada» ahí
 * sería mandar a alguien a buscar un filtro que no existe.
 */
export function columnasFiltradas(filtros: FiltrosPorColumna, orden: string[]): string[] {
  return orden.filter((k) => (filtros[k]?.size ?? 0) > 0);
}

/** ¿Hay algo que limpiar? */
export function hayFiltros(filtros: FiltrosPorColumna, orden: string[]): boolean {
  return columnasFiltradas(filtros, orden).length > 0;
}

/**
 * «Etapa», o «Etapa y Tienda», o «Etapa, Tienda y 2 más».
 *
 * Se nombran las columnas en vez de decir solo cuántas: «2 columnas filtradas» obliga a buscarlas.
 * A partir de la cuarta se corta, porque la barra no puede crecer sin fin; el número dice cuántas
 * quedan, y el botón las quita todas igual.
 */
export function textoDeColumnas(nombres: string[], y: string, mas: (n: number) => string): string {
  if (nombres.length === 0) return "";
  const visibles = nombres.slice(0, 3);
  const restantes = nombres.length - visibles.length;
  if (restantes > 0) return `${visibles.join(", ")} ${y} ${mas(restantes)}`;
  if (visibles.length === 1) return visibles[0];
  return `${visibles.slice(0, -1).join(", ")} ${y} ${visibles.at(-1)}`;
}
