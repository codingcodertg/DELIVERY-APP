/**
 * Operaciones de almacén (D-NEXT, migración 266): la fecha en que se rompió la merma. El dueño (2026-11-06): «scrap
 * needs to be able to input the date it was broken».
 *
 * Es un día (`YYYY-MM-DD`), no una hora: por defecto hoy en Texas, se puede cambiar, es obligatoria y no puede ser un
 * día futuro. Vive en su columna, `warehouse_reports.broken_on`; la base la valida igual y, si una pantalla vieja no
 * la manda, pone el día de hoy en Texas (trigger `warehouse_report_set_broken_on`). Los reportes de antes la traen
 * rellenada con el día en que se reportaron, en hora de Texas.
 *
 * Las listas, los filtros de fecha y los totales de pérdida de la merma cuentan por ESTE día, no por el día en que se
 * llenó el reporte. Sin React: lo usan las cuentas y las pruebas.
 */
import { formateadorDeFecha } from "@/lib/formateador";

export const ZONA_DE_TEXAS = "America/Chicago";

/** El día de hoy en Texas, `YYYY-MM-DD`. */
export function hoyEnTexas(ahora: Date = new Date()): string {
  return diaEnTexas(ahora);
}

/** El día en Texas de un instante, `YYYY-MM-DD`. */
export function diaEnTexas(instante: Date | string): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  if (Number.isNaN(d.getTime())) return "";
  const p = formateadorDeFecha("en-CA", { timeZone: ZONA_DE_TEXAS, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const de = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${de("year")}-${de("month")}-${de("day")}`;
}

/** ¿Es un día de verdad (`YYYY-MM-DD`, que exista en el calendario)? */
export function esDia(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** ¿Vale como fecha del daño? Un día de verdad y no futuro (comparado con hoy en Texas). */
export function fechaDelDanoValida(v: unknown, hoy: string = hoyEnTexas()): v is string {
  return esDia(v) && v <= hoy;
}

/**
 * El día que cuenta para un reporte: en la merma, cuando se rompió (o, si un reporte de antes de la 266 aún no lo
 * trae, el día en que se reportó en Texas); en los demás, el día en que se reportó en Texas.
 */
export function diaDelReporte(r: { kind: string; created_at: string; broken_on?: string | null }): string {
  if (r.kind === "scrap" && esDia(r.broken_on)) return r.broken_on;
  return diaEnTexas(r.created_at);
}

/** Más reciente primero, por el día que cuenta; el mismo día, por la hora en que se reportó. */
export function ordenPorDia<T extends { kind: string; created_at: string; broken_on?: string | null }>(filas: readonly T[]): T[] {
  return [...filas].sort((a, b) => diaDelReporte(b).localeCompare(diaDelReporte(a)) || b.created_at.localeCompare(a.created_at));
}

/** Un día para leer: «Nov 06, 2026» / «06 nov 2026». */
export function fmtDia(dia: string | null | undefined, lang: "en" | "es" = "en"): string {
  if (!esDia(dia)) return "—";
  const [a, m, d] = dia.split("-").map(Number);
  return formateadorDeFecha(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(new Date(Date.UTC(a, m - 1, d, 12)));
}
