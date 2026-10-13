/**
 * «📅 Reprogramar» en las tablas del Gestor de Rutas (D-500). El dueño, 2026-10-08: «agrega el boton en las ordenes de
 * rescheduled ahi mismo en el gestor de rutas por si toca y uno solo elije la siguiente fehcha y una nota».
 *
 * Un toque en la fila: se elige la fecha nueva y se escribe por qué, y se guarda la fecha y la nota en el historial de la
 * orden. Lo de aquí es la regla, sin pantalla: quién puede, qué fecha se propone y qué se escribe.
 */
import { shiftDateISO } from "./utils";

/**
 * ¿Se puede reprogramar desde el Gestor (D-500) o desde Almacén (D-NEXT)? Las etapas son las que el guard de la base deja
 * editar a logística en la misma etapa (`guard_delivery_stage`: borrador, pendiente, aprobada, preparando, lista). El
 * admin, además, la que va en camino. Entregada y anulada no se reprograman.
 *
 * **Almacén** (D-NEXT; el dueño, 2026-10-12: «warehouse as an option to rescheduled and or change delivery dates»): en
 * `approved`, `fulfilling` y `ready` —lo que tiene en su cola—, que es donde el guard le deja escribir en la misma etapa
 * (169, rama de almacén). Ni el borrador ni la pendiente, que no ve; ni la que ya va en el camión.
 */
export function puedeReprogramar(rol: string | null | undefined, etapa: string | null | undefined): boolean {
  const abiertas = ["draft", "pending", "approved", "fulfilling", "ready"];
  if (!etapa || etapa === "delivered" || etapa === "canceled") return false;
  if (rol === "admin") return [...abiertas, "picked_up", "rejected"].includes(etapa);
  if (rol === "logistics" || rol === "manager" || rol === "accounting") return abiertas.includes(etapa);
  if (rol === "warehouse") return ETAPAS_QUE_REPROGRAMA_ALMACEN.includes(etapa);
  return false;
}

/** Las etapas de su cola en las que almacén reprograma (D-NEXT). */
export const ETAPAS_QUE_REPROGRAMA_ALMACEN: readonly string[] = ["approved", "fulfilling", "ready"];

/** La fecha que se propone: el día siguiente al más tarde entre hoy y la fecha que ya tiene la orden. */
export function fechaPropuesta(fechaActual: string | null | undefined, hoy: string): string {
  const base = fechaActual && fechaActual.slice(0, 10) > hoy ? fechaActual.slice(0, 10) : hoy;
  return shiftDateISO(base, 1);
}

/** Lo mínimo que se acepta como nota: tres letras, para que «.» o «x» no pasen por motivo. */
export const MINIMO_NOTA_REPROGRAMAR = 3;

/** ¿Se puede guardar? Fecha válida, distinta de la que tiene, no antes de hoy, y una nota. */
export function reprogramacionValida(nueva: string, actual: string | null | undefined, hoy: string, nota: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) return false;
  if (nueva < hoy) return false;
  if (actual && nueva === actual.slice(0, 10)) return false;
  return nota.trim().replace(/\s+/g, " ").length >= MINIMO_NOTA_REPROGRAMAR;
}

/** La nota que queda en el historial de la orden. */
export function notaDeReprogramacion(desde: string | null | undefined, hasta: string, nota: string, lang: "en" | "es"): string {
  const limpia = nota.trim().replace(/\s+/g, " ");
  const de = desde ? desde.slice(0, 10) : lang === "es" ? "sin fecha" : "no date";
  return lang === "es" ? `Reprogramada de ${de} a ${hasta}: ${limpia}` : `Rescheduled from ${de} to ${hasta}: ${limpia}`;
}
