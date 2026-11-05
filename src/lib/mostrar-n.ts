/** Tamaños del selector «Mostrar 10 / 50 / 100 / 1000» de las tablas del hub (reemplaza al «Ver más»). */
export const TAMANOS_DE_TABLA = [10, 50, 100, 1000] as const;
export type TamanoDeTabla = (typeof TAMANOS_DE_TABLA)[number];

/** Lee un tamaño guardado; si no es uno de los válidos, el de por defecto. */
export function tamanoValido(v: unknown, porDefecto: TamanoDeTabla = 100): TamanoDeTabla {
  const n = Number(v);
  return (TAMANOS_DE_TABLA as readonly number[]).includes(n) ? (n as TamanoDeTabla) : porDefecto;
}
