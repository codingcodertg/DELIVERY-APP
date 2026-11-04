import { isoInTZ } from "@/lib/utils";
import { horaEnTexas } from "@/lib/fecha-de-intertienda";
import { cambiaLaFecha } from "@/lib/dia-de-entrega";

// ============================================================
// Ventas no agenda para HOY después de las 12 del mediodía (hora de Texas).
//
// El dueño, 2026-11-04: «recuerda la regla, sales no pueden ingresar una orden para el mismo día después de las 12,
// tiene que ser para el día siguiente».
//
// Antes de las 12:00 en Texas (`BUSINESS_TZ`, America/Chicago, con su cambio de horario), ventas puede poner hoy; desde
// las 12:00 en punto, el primer día que puede poner es MAÑANA. Solo el rol `sales`: admin, gerente, logística, almacén,
// office y chofer siguen como estaban. Es la misma hora de corte que la Intertienda (D-823), que solo pone la fecha por
// defecto; esta prohíbe.
//
// Una sola regla para todo lo que deja a ventas poner o mandar una fecha: la ficha (crear, enviar, borrador, «solo la
// fecha» de D-480, enviar un borrador y reenviar una rechazada), duplicar (nace mañana), «📅 Reprogramar» (D-549) y, por si
// algún día llegan a ventas, la celda del Gestor y la fecha en bloque. La base lo repite (migración 237) para quien llame a
// Supabase sin pasar por la pantalla.
//
// Puro: sin React, sin red. La hora y el día se leen siempre en Texas, nunca con el reloj del aparato ni en UTC.
// ============================================================

/** La hora (0–23, en Texas) desde la que ventas ya no agenda para hoy. */
export const HORA_DE_CORTE_VENTAS = 12;

/** El día siguiente a una fecha `YYYY-MM-DD`, por calendario (sin zona horaria: un día de 23 o 25 horas no lo mueve). */
function diaSiguiente(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** ¿Ya son las 12:00 o más en Texas? */
export function pasoElCorteDeVentas(ahora: Date = new Date()): boolean {
  return horaEnTexas(ahora) >= HORA_DE_CORTE_VENTAS;
}

/** ¿A este rol le aplica el corte? Solo a ventas. */
export function aplicaCorteDeVentas(rol: string | null | undefined): boolean {
  return rol === "sales";
}

/**
 * El primer día que este rol puede poner como fecha de entrega: el `min` de los selectores. Ventas, desde las 12 en
 * Texas, mañana; antes, hoy. Los demás roles, hoy (D-532).
 */
export function minFechaParaRol(rol: string | null | undefined, ahora: Date = new Date()): string {
  const hoy = isoInTZ(ahora);
  return aplicaCorteDeVentas(rol) && pasoElCorteDeVentas(ahora) ? diaSiguiente(hoy) : hoy;
}

/** ¿Esta fecha queda antes del primer día que este rol puede poner, por el corte de mediodía? Sin fecha, no. */
export function fechaCortadaParaVentas(
  fecha: string | null | undefined,
  { rol, ahora = new Date() }: { rol: string | null | undefined; ahora?: Date },
): boolean {
  if (!fecha || !fecha.trim()) return false;
  if (!aplicaCorteDeVentas(rol) || !pasoElCorteDeVentas(ahora)) return false;
  return fecha.trim().slice(0, 10) < minFechaParaRol(rol, ahora);
}

/**
 * La regla de una escritura: ¿esta escritura de ventas AGENDA para hoy (o antes) pasadas las 12?
 * - Cuando la fecha es nueva o cambia (como D-532 y D-658): la misma fecha de siempre no es agendar.
 * - O cuando la escritura manda la orden a programar sin tocar la fecha (`agenda`): enviar un borrador o reenviar una
 *   rechazada. Un borrador guardado a las 10 para hoy no se envía a las 2.
 */
export function cortaPorMediodia(
  nueva: string | null | undefined,
  actual: string | null | undefined,
  { rol, ahora = new Date(), agenda = false }: { rol: string | null | undefined; ahora?: Date; agenda?: boolean },
): boolean {
  if (!agenda && !cambiaLaFecha(nueva, actual)) return false;
  return fechaCortadaParaVentas(nueva, { rol, ahora });
}

/** El aviso, en los dos idiomas (y el mismo texto que devuelve la base, migración 237). */
export const AVISO_CORTE_VENTAS = {
  en: "After 12:00 noon, sales orders start tomorrow. Pick tomorrow or a later day.",
  es: "Después de las 12:00 del mediodía, las órdenes de ventas son para mañana. Elige mañana o un día posterior.",
} as const;
