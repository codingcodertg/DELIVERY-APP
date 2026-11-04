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
import { formateadorDeNumero } from "./formateador";

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
 * D-840: filtros de número como los de Excel («mayor que 100», «menor que 50», entre dos valores).
 *
 * Viajan en el MISMO conjunto de claves que los valores marcados, como claves que nadie puede escribir en una celda
 * (empiezan por espacio, como `SIN_VALOR`): `" #gt:100"`. Así no cambia el tipo de los filtros, ni la barra de
 * «Filtrado por», ni nada que los guarde. Si una columna tiene alguna condición, manda la condición y la lista de
 * valores marcados no cuenta (como en Excel: o filtras por valores o por condición). Dos condiciones se juntan con Y
 * (entre 10 y 20), o con O si el conjunto lleva `O_LOGICO`. Una celda sin número no pasa ninguna condición.
 */
export type Comparador = "gt" | "gte" | "lt" | "lte" | "eq" | "ne";
export const COMPARADORES: readonly Comparador[] = ["gt", "gte", "lt", "lte", "eq", "ne"];
export type CondicionNumerica = { op: Comparador; valor: number };
const PREFIJO_DE_CONDICION = " #";
/** Con esta clave en el conjunto, las condiciones se juntan con O en vez de con Y. */
export const O_LOGICO = " #or";

export const claveDeCondicion = (c: CondicionNumerica): string => `${PREFIJO_DE_CONDICION}${c.op}:${c.valor}`;

export function leeCondicion(clave: string): CondicionNumerica | null {
  const m = /^ #(gt|gte|lt|lte|eq|ne):(-?\d+(?:\.\d+)?)$/.exec(clave);
  return m ? { op: m[1] as Comparador, valor: Number(m[2]) } : null;
}

/** Las condiciones de número de un filtro (vacío si filtra por valores marcados o no filtra). */
export function condicionesDe(s: ReadonlySet<string> | undefined): CondicionNumerica[] {
  if (!s) return [];
  const out: CondicionNumerica[] = [];
  for (const k of s) { const c = leeCondicion(k); if (c) out.push(c); }
  return out;
}

/** El conjunto de claves para unas condiciones (las que no tienen número se ignoran). */
export function filtroDeCondiciones(conds: readonly CondicionNumerica[], o = false): Set<string> {
  const validas = conds.filter((c) => Number.isFinite(c.valor));
  const s = new Set(validas.map(claveDeCondicion));
  if (o && validas.length > 1) s.add(O_LOGICO);
  return s;
}

/** El número de una celda: los números tal cual; un texto solo si entero es un número («1,250» también). */
export function numeroDeCelda(v: ValorDeCelda): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const t = String(v).trim().replace(/,/g, "");
  if (t === "" || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function cumpleCondicion(v: ValorDeCelda, c: CondicionNumerica): boolean {
  const n = numeroDeCelda(v);
  if (n == null) return false;
  switch (c.op) {
    case "gt": return n > c.valor;
    case "gte": return n >= c.valor;
    case "lt": return n < c.valor;
    case "lte": return n <= c.valor;
    case "eq": return n === c.valor;
    case "ne": return n !== c.valor;
  }
}

/** ¿Pasa la celda el filtro de su columna? Con condiciones manda la condición; si no, el valor marcado. */
export function pasaElFiltro(v: ValorDeCelda, s: ReadonlySet<string>): boolean {
  const conds = condicionesDe(s);
  if (conds.length === 0) return s.has(claveDeFiltro(v));
  return s.has(O_LOGICO) ? conds.some((c) => cumpleCondicion(v, c)) : conds.every((c) => cumpleCondicion(v, c));
}

/** «> 100 y ≤ 200», para enseñar qué condición está puesta. `locale` es el idioma elegido («en-US»/«es-MX»),
 *  no el del navegador: si no, «1,000» salía «1.000» o al revés según el aparato. */
export function textoDeCondiciones(s: ReadonlySet<string> | undefined, y: string, o: string, locale?: string): string {
  const signo: Record<Comparador, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", ne: "≠" };
  const conds = condicionesDe(s);
  return conds.map((c) => `${signo[c.op]} ${formateadorDeNumero(locale).format(c.valor)}`).join(s?.has(O_LOGICO) ? ` ${o} ` : ` ${y} `);
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
  return filas.filter((f) => activos.every(([k, s]) => pasaElFiltro(valorDe(k, f), s)));
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
