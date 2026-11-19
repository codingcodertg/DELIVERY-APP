// ============================================================
// Búsqueda de productos del Inventario y del catálogo (puro, sin React ni base).
//
// Una búsqueda es una lista de palabras; cada palabra tiene que aparecer en AL MENOS uno de los campos
// descriptivos del producto (proveedor, SKU, nombre, categoría, …). Varias palabras son Y: «daltile 24x48»
// encuentra los Daltile de ese tamaño, aunque «daltile» esté en el proveedor y «24x48» en el tamaño.
//
// Cómo se llega a PostgREST: cada palabra es UN `.or()` (con un `campo.ilike.%palabra%` por campo), y
// supabase-js une varios `.or()` con Y. Así que `filtrosDeBusqueda` devuelve una cadena por palabra.
//
// Seguridad: las palabras no pueden meter sintaxis del filtro. Se quitan `%` `,` `(` `)` `"` `*` y `\`
// (lo mismo que hacía el catálogo, más las comillas). Un `_` sí entra: en ILIKE es «un carácter cualquiera»,
// así que «RTG_1» también encuentra «RTG-1». Es un falso positivo inofensivo en un buscador.
// ============================================================

/**
 * Campos del producto donde se busca, en el orden en que se muestra la razón de una coincidencia
 * (lo primero que coincide es lo que se enseña). Todos son columnas de `app_products` (la vista que
 * ya enmascara el costo: esta lista no incluye ni debe incluir cost, margin_pct ni gm_amount).
 */
export const CAMPOS_DE_BUSQUEDA = [
  "sku", "name", "vendor_name", "category_path", "product_type", "mpn", "collection", "size_in",
  "finish", "material", "color1", "color2", "style", "look", "origin", "description",
] as const;

export type CampoDeBusqueda = (typeof CAMPOS_DE_BUSQUEDA)[number];

/** Tope de palabras por búsqueda: más que esto no es una búsqueda, es un pegado, y cada palabra es una vuelta. */
export const MAX_PALABRAS_DE_BUSQUEDA = 8;

/** Palabras de una búsqueda, en minúscula y ya sin los caracteres que rompen el filtro. */
export function terminosDeBusqueda(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .toLowerCase()
    .replace(/[%,()"*\\]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, MAX_PALABRAS_DE_BUSQUEDA);
}

/**
 * Un filtro `.or()` de PostgREST por palabra: `sku.ilike.%x%,name.ilike.%x%,…`. Los que llamen a
 * supabase encadenan un `.or()` por cada cadena: eso es el Y entre palabras.
 */
export function filtrosDeBusqueda(texto: string | null | undefined): string[] {
  return terminosDeBusqueda(texto).map((t) => CAMPOS_DE_BUSQUEDA.map((c) => `${c}.ilike.%${t}%`).join(","));
}

export type CoincidenciaDeBusqueda = { termino: string; campo: CampoDeBusqueda; valor: string };

/**
 * Por qué aparece un producto: para cada palabra, el PRIMER campo (en el orden de CAMPOS_DE_BUSQUEDA)
 * que la contiene. Las palabras que no aparecen en ningún campo no salen (la fila no debería estar aquí).
 * Sin repetir un mismo campo para dos palabras. Se usa para enseñar «Proveedor: Daltile · Tamaño: 24x48».
 */
export function coincidenciasDeBusqueda(
  fila: Partial<Record<CampoDeBusqueda, unknown>>,
  texto: string | null | undefined,
): CoincidenciaDeBusqueda[] {
  const usados = new Set<CampoDeBusqueda>();
  const salida: CoincidenciaDeBusqueda[] = [];
  for (const termino of terminosDeBusqueda(texto)) {
    for (const campo of CAMPOS_DE_BUSQUEDA) {
      const valor = fila[campo];
      if (valor === null || valor === undefined || usados.has(campo)) continue;
      const cadena = String(valor);
      if (cadena.toLowerCase().includes(termino)) {
        usados.add(campo);
        salida.push({ termino, campo, valor: cadena });
        break;
      }
    }
  }
  return salida;
}
