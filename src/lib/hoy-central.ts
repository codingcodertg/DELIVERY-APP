/**
 * El día de HOY para el usuario, `AAAA-MM-DD`, en hora de Texas (America/Chicago).
 *
 * Por qué existe (auditoría 27 nov, hallazgo MEDIO): `new Date().toISOString().slice(0, 10)` da el día en UTC. En
 * Texas, desde las 6–7 pm (CST/CDT) el UTC ya marca el día siguiente, así que «hoy» en Conteos, Seguridad, el tablero
 * o Market salía mañana. Por eso el «hoy» de cualquier pantalla pasa por aquí, y nunca por `toISOString()`.
 *
 * Los datos que se cuentan en UTC a propósito (claves de caché, sumas de días sobre un `AAAA-MM-DD` ya dado, instantes
 * ISO completos) NO usan este módulo; `sumaDias` es la aritmética de calendario pura para esos casos.
 *
 * Sin dependencias fuera de los formateadores cacheados, para que lo importe cualquiera (cliente o servidor).
 */
import { formateadorDeFecha } from "@/lib/formateador";

export const ZONA_HOY_CENTRAL = "America/Chicago";

/** El día en Texas de un instante, `AAAA-MM-DD`. Cadena vacía si la fecha no es válida. */
export function fechaCentral(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const p = formateadorDeFecha("en-CA", { timeZone: ZONA_HOY_CENTRAL, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const de = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${de("year")}-${de("month")}-${de("day")}`;
}

/** El día de hoy en Texas, `AAAA-MM-DD`. Recibe el instante para poder probarlo a cualquier hora. */
export function hoyCentral(ahora: Date = new Date()): string {
  return fechaCentral(ahora);
}

/** `fecha` (`AAAA-MM-DD`) más `dias` días, en calendario puro: sin horas ni husos. */
export function sumaDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
