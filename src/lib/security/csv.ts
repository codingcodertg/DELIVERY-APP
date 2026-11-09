/**
 * CSV para las listas de Security (D-940): exportar Usuarios y Dispositivos a Excel, como en Scrap (D-919).
 * Puro y con pruebas; la vista solo arma las filas de texto y llama a `downloadCSV`.
 */

/** Una celda, escapada para CSV y con la inyección de fórmulas neutralizada (una celda que empieza por
 *  `=`, `+`, `-`, `@` o un control la antepone con `'`, para que Excel no la ejecute). Igual que `escaparCsv` de Scrap. */
export function escaparCsv(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Cabeceras + filas → un CSV con saltos CRLF, cada celda escapada. */
export function filasACsv(cabeceras: readonly string[], filas: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [cabeceras, ...filas].map((f) => f.map(escaparCsv).join(",")).join("\r\n");
}

/** `seguridad-usuarios-2026-11-09.csv`. */
export function nombreCsv(base: string, hoy: string): string {
  return `${base}-${hoy}.csv`;
}
