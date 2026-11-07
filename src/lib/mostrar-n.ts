/**
 * Tamaños del selector «Mostrar 10 / 50 / 100 / Todos» de las tablas del hub (reemplaza al «Ver más»).
 * D-918: «Todos» sustituye al 1000 (Roberto, 2026-11-07: «Instead of 1000 do All»): enseña cada fila que la persona
 * puede ver, sin tope. La lista ya se carga entera (el almacén pagina los cortes de 1.000 de PostgREST), así que «Todos»
 * solo deja de recortar lo pintado.
 */
export const TODOS = "todos" as const;
export const TAMANOS_DE_TABLA = [10, 50, 100, TODOS] as const;
export type TamanoDeTabla = (typeof TAMANOS_DE_TABLA)[number];

/** Lee un tamaño guardado; si no es uno de los válidos, el de por defecto. Un 1000 guardado de antes pasa a «Todos». */
export function tamanoValido(v: unknown, porDefecto: TamanoDeTabla = 100): TamanoDeTabla {
  if (v === TODOS || v === "1000" || v === 1000) return TODOS;
  const n = Number(v);
  return (TAMANOS_DE_TABLA as readonly unknown[]).includes(n) ? (n as TamanoDeTabla) : porDefecto;
}

/** Cuántas filas se pintan de `total` con el tamaño elegido: todas con «Todos». */
export function filasQueSePintan(tamano: TamanoDeTabla, total: number): number {
  return tamano === TODOS ? total : Math.min(tamano, total);
}
