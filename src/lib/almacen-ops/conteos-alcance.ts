/**
 * Operaciones de almacén (333): el alcance de un conteo y los buscadores del teléfono. La MISMA regla que
 * `warehouse_ops_count_products` (la base decide; esto lo prueba y lo usa la pantalla para buscar en lo ya cargado).
 *
 *   · Proveedor y medida se comparan NORMALIZADOS: el nombre sin mayúsculas y con los espacios colapsados; la medida
 *     sin espacios y sin mayúsculas («24 x 48» = «24x48», igual que el ERP). ANTES la base comparaba el texto crudo con
 *     el parámetro recortado y cualquier espacio de más en el ERP dejaba la lista vacía («No products match»).
 *   · La nota es un filtro de texto (contiene, sin mayúsculas) sobre nombre, SKU, colección, etiquetas, color y estilo.
 *     En «proveedor + nota» es obligatoria (2 letras o más). En «proveedor + medida» es OPCIONAL: si la hay, afina.
 *   · «Un producto» se compara por id.
 */
import type { AlcanceElegido } from "./conteos";

/** Clave de comparación de un nombre (proveedor, colección…): sin extremos, espacios colapsados, minúsculas. */
export function claveDeNombre(t: string | null | undefined): string {
  return (t ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Clave de comparación de una medida: sin ningún espacio, minúsculas («24 x 48» → «24x48»). */
export function claveDeMedida(t: string | null | undefined): string {
  return (t ?? "").replace(/\s+/g, "").toLowerCase();
}

/** Lo que el alcance necesita de un producto del catálogo (los campos que la base mira). */
export interface ProductoParaAlcance {
  id: number;
  sku: string;
  name: string;
  vendor_name: string | null;
  size_in: string | null;
  collection?: string | null;
  tags?: string | null;
  color1?: string | null;
  style?: string | null;
}

/** La nota como filtro: contiene la palabra en nombre, SKU, colección, etiquetas, color o estilo (sin mayúsculas). */
export function coincideConNota(p: ProductoParaAlcance, nota: string): boolean {
  const n = nota.trim().toLowerCase();
  if (n === "") return true;
  return [p.name, p.sku, p.collection, p.tags, p.color1, p.style].some((x) => (x ?? "").toLowerCase().includes(n));
}

/** ¿Pertenece el producto al alcance elegido? Espejo de la base (la misma regla de proveedor, medida, nota e id). */
export function coincideConAlcance(p: ProductoParaAlcance, a: AlcanceElegido): boolean {
  const nota = (a.note ?? "").trim();
  switch (a.scope_kind) {
    case "product":
      return a.product_id != null && p.id === a.product_id;
    case "vendor_size":
      return claveDeNombre(p.vendor_name) === claveDeNombre(a.vendor_name)
        && claveDeMedida(p.size_in) === claveDeMedida(a.size_in)
        && coincideConNota(p, nota);
    case "vendor_note":
      return claveDeNombre(p.vendor_name) === claveDeNombre(a.vendor_name) && coincideConNota(p, nota);
  }
}

/** Los proveedores y sus medidas, como la base (`warehouse_ops_count_vendors`): agrupados por nombre normalizado. */
export function proveedoresDelCatalogo(productos: readonly ProductoParaAlcance[]): { vendor_name: string; sizes: string[]; products: number }[] {
  const grupos = new Map<string, { vendor_name: string; medidas: Map<string, string>; products: number }>();
  for (const p of productos) {
    const clave = claveDeNombre(p.vendor_name);
    if (clave === "") continue;
    const g = grupos.get(clave) ?? { vendor_name: (p.vendor_name ?? "").trim(), medidas: new Map<string, string>(), products: 0 };
    g.products++;
    const m = (p.size_in ?? "").trim();
    if (m !== "" && !g.medidas.has(claveDeMedida(m))) g.medidas.set(claveDeMedida(m), m);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .map((g) => ({ vendor_name: g.vendor_name, sizes: [...g.medidas.values()].sort(), products: g.products }))
    .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
}

/** Sin acentos y sin mayúsculas, para comparar lo que se teclea con lo que hay. */
export function normalizaBusqueda(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * El buscador del teléfono: cada palabra de lo que se teclea debe aparecer en el texto (sin acentos, sin mayúsculas y
 * sin espacios: «24 x» encuentra «24x48»). Primero los que EMPIEZAN por lo escrito. Sin texto, los primeros `max`.
 */
export function buscarEnLista<T>(items: readonly T[], texto: (t: T) => string, q: string, max = 40): T[] {
  const n = normalizaBusqueda(q);
  if (n === "") return items.slice(0, max);
  const palabras = n.split(/\s+/).filter(Boolean);
  const pegadas = palabras.map((w) => w.replace(/\s+/g, ""));
  const coincide = (x: string) => palabras.every((w, i) => x.includes(w) || x.replace(/\s+/g, "").includes(pegadas[i]));
  const con = items
    .map((it) => ({ it, x: normalizaBusqueda(texto(it)) }))
    .filter(({ x }) => coincide(x));
  con.sort((a, b) => Number(!a.x.startsWith(palabras[0])) - Number(!b.x.startsWith(palabras[0])));
  return con.slice(0, max).map((c) => c.it);
}
