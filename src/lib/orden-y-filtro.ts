/**
 * Ordenar por una columna y filtrar por sus valores, fuera de la pantalla (D-360).
 *
 * La tabla de Órdenes (`OrdersTable`) ya ordenaba y filtraba así desde D-275, pero la lógica vivía dentro del
 * componente y el Gestor de Rutas no podía usarla. El dueño pidió lo mismo en las tablas del Gestor («logistic
 * manager columns must also have a sorting option … and also filters»), así que la parte que decide —cómo se
 * comparan dos celdas, qué fila pasa un filtro, qué valores ofrece el menú— vive aquí y las dos pantallas la
 * llaman. Lo que no vive aquí es el menú: ese es JSX y se importa de `OrdersTable`.
 *
 * Aquí no hay React: se prueba con vitest, sin navegador.
 */

/** Lo que una columna extrae de una fila para comparar y filtrar. Un número ordena como número; lo demás, como texto. */
export type ValorDeCelda = string | number | null;

/** Un filtro por columna: el conjunto de claves marcadas. Sin clave o vacío = esa columna no filtra. */
export type FiltrosPorColumna = Record<string, Set<string>>;

/**
 * La clave interna del «sin valor». Va con un espacio delante para que nadie pueda escribirla en una celda y
 * confundirse con un valor real (es la misma de `OrdersTable`, D-275).
 */
export const SIN_VALOR = " —";

/** La clave de filtro de un valor: nulo y cadena vacía son la misma cosa, «sin valor». */
export function claveDeFiltro(v: ValorDeCelda): string {
  return v == null || v === "" ? SIN_VALOR : String(v);
}

/**
 * Compara dos celdas para ordenar ASCENDENTE, con los nulos al final: un «—» arriba de la lista no le sirve a nadie
 * que ordenó por fecha o por pallets para ver qué va primero. Números contra números, numéricamente; lo demás, como
 * texto con `numeric` (así «#9» va antes de «#10») e ignorando mayúsculas.
 */
export function comparaCeldas(a: ValorDeCelda, b: ValorDeCelda): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Las filas ordenadas por lo que `valor` saca de cada una. Los nulos van al final EN LAS DOS direcciones: invertir
 * el orden es invertir los valores que hay, no traer al principio los que faltan. Sin dirección, devuelve las
 * mismas filas tal como llegaron (el orden de entrada es el que la pantalla ya eligió). No muta la lista.
 */
export function ordenaFilas<T>(filas: readonly T[], valor: (fila: T) => ValorDeCelda, direccion: "asc" | "desc" | null): T[] {
  if (!direccion) return [...filas];
  return [...filas].sort((x, y) => {
    const a = valor(x), b = valor(y);
    if (a == null || b == null) return comparaCeldas(a, b);
    const cmp = comparaCeldas(a, b);
    return direccion === "asc" ? cmp : -cmp;
  });
}

/**
 * Las filas que pasan TODOS los filtros de columna puestos. `valorDe(clave, fila)` es lo que la columna `clave`
 * saca de la fila. `saltar` deja de aplicar el filtro de UNA columna: así el menú de esa columna sigue ofreciendo
 * todos los valores que quedarían si se quitara solo ese filtro, mientras los de las otras columnas siguen acotando
 * (en cascada, como Excel; D-275).
 */
export function filtraFilas<T>(
  filas: readonly T[],
  filtros: FiltrosPorColumna,
  valorDe: (clave: string, fila: T) => ValorDeCelda,
  saltar?: string,
): T[] {
  const activos = Object.entries(filtros).filter(([k, s]) => k !== saltar && s && s.size > 0);
  if (activos.length === 0) return [...filas];
  return filas.filter((f) => activos.every(([k, s]) => s.has(claveDeFiltro(valorDe(k, f)))));
}

/**
 * Las opciones del menú de UNA columna: cada valor distinto una vez, con su etiqueta, ordenadas por etiqueta. El
 * «sin valor» se enseña como «—». `etiqueta` es para las columnas cuya clave no se lee (una fecha ISO se enseña
 * formateada, pero filtra y ordena por el ISO).
 */
export function opcionesDeFiltro<T>(
  filas: readonly T[],
  valor: (fila: T) => ValorDeCelda,
  etiqueta?: (v: ValorDeCelda) => string,
): { key: string; label: string }[] {
  const vistos = new Map<string, string>();
  for (const f of filas) {
    const crudo = valor(f);
    const clave = claveDeFiltro(crudo);
    if (vistos.has(clave)) continue;
    vistos.set(clave, clave === SIN_VALOR ? "—" : etiqueta ? etiqueta(crudo) : clave);
  }
  return [...vistos.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
