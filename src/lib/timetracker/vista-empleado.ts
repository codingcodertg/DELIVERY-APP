// ============================================================
// Qué ve un EMPLEADO en Time Tracker, y qué sigue viendo el admin (D-NEXT).
//
// El dueño, el 2026-10-06, mirando la app como empleado: fuera «Mi diario»; en «Mi semana» solo
// las horas (ni pago estimado ni pagado hasta hoy), y ahí se mudan «Mi boletín» y «Fichajes de
// hoy»; en «Registrar tiempo» fuera «Esta semana de pago» —el empleado solo ve «Mi horario» y
// «Notas del día» debajo del reloj—; y en «Mis solicitudes», primero «Tiempo libre» y después
// «Tiempo».
//
// Todo eso es la vista del EMPLEADO. El admin no cambia (salvo el orden de las solicitudes, que
// es el mismo para todos): por eso cada decisión pasa por `esAdmin`, igual que la barra decide
// entre TABS y MANAGER_TABS desde D-066. Se escribe aquí, puro y sin React, para probarlo solo;
// las pantallas (TopBar, PunchPanel, Mi semana, Mis solicitudes, Mi diario) lo llaman.
// ============================================================

import { MANAGER_TABS, TABS } from "@/lib/timetracker/constants";

/** Quién mira. `esAdmin` es `timetracker_role === "admin"`, como en TopBar y Cronometro. */
export type QuienMira = { esAdmin: boolean; presencial: boolean };

export function esAdminDeTt(role: string | null | undefined): boolean {
  return role === "admin";
}

/** Las pestañas de la barra. El empleado ya no tiene «Mi diario»; el admin sigue con la suya. */
export function pestanasPara(role: string | null | undefined): { id: string; href: string }[] {
  return esAdminDeTt(role) ? MANAGER_TABS : TABS;
}

/**
 * «Mi diario» (las capturas de la app de escritorio) es solo del admin. Quien entre a
 * /timetracker/diary sin serlo —un marcador viejo, un enlace— vuelve a «Registrar tiempo».
 */
export function puedeVerMiDiario(role: string | null | undefined): boolean {
  return esAdminDeTt(role);
}

/** Lo que sale debajo del reloj de fichar (PunchPanel). */
export type SeccionesDeFichar = {
  /** La tarjeta «Turno de hoy · Esta semana de pago». */
  semanaDePago: boolean;
  /** «Fichajes de hoy», con «Hoy» y «Esta semana de pago» encima. */
  fichajesDeHoy: boolean;
  /** «Mi boletín». */
  boletin: boolean;
  /** «Mi horario» y «Notas del día»: los dos únicos que quedan para el empleado. */
  horarioYNotas: true;
};

export function seccionesDeFichar(q: Pick<QuienMira, "esAdmin">): SeccionesDeFichar {
  if (q.esAdmin) return { semanaDePago: true, fichajesDeHoy: true, boletin: true, horarioYNotas: true };
  return { semanaDePago: false, fichajesDeHoy: false, boletin: false, horarioYNotas: true };
}

/** Lo que sale en «Mi semana». */
export type SeccionesDeMiSemana = {
  /** Pago estimado, pagado hasta hoy, la columna de pago y el aviso de lo pagado. */
  dinero: boolean;
  /** «Mi boletín», mudado desde Registrar tiempo. */
  boletin: boolean;
  /** «Fichajes de hoy», mudado desde Registrar tiempo. */
  fichajesDeHoy: boolean;
};

/**
 * El boletín y los fichajes son del fichaje en tienda: a un empleado remoto (cronómetro) no le
 * dicen nada —nunca los vio, ni antes de esta mudanza— y se le quedan fuera.
 */
export function seccionesDeMiSemana(q: QuienMira): SeccionesDeMiSemana {
  if (q.esAdmin) return { dinero: true, boletin: false, fichajesDeHoy: false };
  return { dinero: false, boletin: q.presencial, fichajesDeHoy: q.presencial };
}

/**
 * La tabla por proyecto y «Entradas de esta semana» son del CRONÓMETRO. A un presencial que no lo
 * usa le decían «No hay tiempo registrado esta semana» justo debajo de sus horas fichadas, que es
 * contradecirse en la misma tarjeta: se le esconden mientras no tenga sesiones (puede tenerlas, si
 * pidió tiempo por «Mis solicitudes»). El admin y el remoto, como siempre.
 */
export function verTablasDelCronometro(q: QuienMira, haySesiones: boolean): boolean {
  if (q.esAdmin || !q.presencial) return true;
  return haySesiones;
}

/**
 * Las horas totales de «Mi semana».
 *
 * La pantalla suma las sesiones del CRONÓMETRO. Un presencial no usa el cronómetro: sus horas son
 * sus fichajes, y la suma de sesiones le daba 0,00 h toda la semana. Antes eso no importaba
 * porque sus horas de la semana salían en «Esta semana de pago», debajo del reloj; ahora que
 * esa tarjeta se va, el único total que le queda tiene que ser el bueno.
 *
 * Los fichajes solo se tienen de la semana de pago EN CURSO (`getMyDay`): de una semana pasada
 * un presencial ve «—» y no un cero, porque un cero se cree (D-136) y aquí sería falso. Las dos
 * mitades nunca se suman (D-102).
 */
export function horasDeLaSemana(e: {
  presencial: boolean;
  esSemanaEnCurso: boolean;
  segundosDeCronometro: number;
  /** Minutos fichados de la semana de pago en curso; null si aún no se han leído o fallaron. */
  minutosFichados: number | null;
}): number | null {
  if (!e.presencial) return e.segundosDeCronometro / 3600;
  if (!e.esSemanaEnCurso || e.minutosFichados == null) return null;
  return e.minutosFichados / 60;
}

/**
 * «Mis solicitudes»: primero Tiempo libre, después Tiempo. Para todos —es la misma pantalla para
 * el admin— y la primera es la que se abre.
 */
export const PESTANAS_DE_SOLICITUDES = ["off", "time"] as const;
export type PestanaDeSolicitud = (typeof PESTANAS_DE_SOLICITUDES)[number];
export const PESTANA_DE_SOLICITUD_INICIAL: PestanaDeSolicitud = PESTANAS_DE_SOLICITUDES[0];
