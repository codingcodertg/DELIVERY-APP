/**
 * Inyección de fórmulas en los informes (CSV y Excel). Un texto que empieza por `=`, `+`, `-`, `@`, tabulador o
 * retorno lo abre Excel como fórmula (`=HYPERLINK(...)`, un comando pegado en un nombre o en una nota). Se le antepone
 * una comilla simple para que se lea como texto. Solo a los TEXTOS: un número negativo sigue siendo número.
 * Mismo criterio que `toCSV` (lib/utils.ts), que usan los demás informes.
 */
export function celdaSegura<T extends string | number | null | undefined>(v: T): T | string {
  if (typeof v !== "string") return v ?? "";
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
