import { BUSINESS_TZ, isoInTZ } from "@/lib/utils";
import { formateadorDeFecha } from "@/lib/formateador";

/**
 * La fecha con la que NACE una Intertienda (D-823). Roberto (admin), desde el Gestor de Rutas: «if anyone programs
 * intertienda past 12pm then the default date should be tomorrow, not same date».
 *
 * Hasta hoy una orden nueva nacía sin fecha y el selector caía en el día de hoy; una Intertienda tecleada a las 3 de la
 * tarde quedaba para hoy, cuando el camión de hoy ya salió. Ahora: antes de las 12 del mediodía en Texas, hoy; desde
 * las 12, mañana. Solo para tipos tienda-a-tienda y solo cuando no hay fecha: la persona la cambia si quiere, y una
 * orden abierta no se toca.
 */
export const HORA_DE_CORTE_INTERTIENDA = 12;

/** La hora (0–23) en Texas de un instante cualquiera. */
export function horaEnTexas(ahora: Date): number {
  return Number(formateadorDeFecha("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", hourCycle: "h23" }).format(ahora));
}

export function fechaPorDefectoDeIntertienda(ahora: Date = new Date()): string {
  const manana = horaEnTexas(ahora) >= HORA_DE_CORTE_INTERTIENDA;
  return isoInTZ(manana ? new Date(ahora.getTime() + 24 * 3600 * 1000) : ahora);
}
