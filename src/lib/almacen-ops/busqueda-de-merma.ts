/**
 * La búsqueda de la tabla de merma (ayuda de Roberto, 12 nov: «need search bar to find things»). Sin acentos ni
 * mayúsculas, y cada palabra tiene que aparecer en algún campo: producto, SKU, folio, quién la llenó / rompió /
 * reportó, comentarios, motivo, tienda, CRMA y el nombre del grupo.
 */
export function normalizaBusqueda(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** ¿Cada palabra de `q` aparece en alguno de los textos? `q` vacío = todo coincide. */
export function coincideBusqueda(textos: readonly (string | null | undefined)[], q: string): boolean {
  const palabras = normalizaBusqueda(q).split(" ").filter(Boolean);
  if (palabras.length === 0) return true;
  const todo = textos.map(normalizaBusqueda).join(" | ");
  return palabras.every((p) => todo.includes(p));
}
