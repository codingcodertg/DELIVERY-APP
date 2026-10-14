// ============================================================
// Qué ve un EMPLEADO en Time Tracker, y qué sigue viendo el admin (D-489).
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

/**
 * ¿«Entrada» y «Salida» abren la cámara antes de fichar? (D-539) El dueño, 2026-10-13: *«admin remove the
 * images requiremenet in the clock in app»*. El admin ficha directo, sin foto; el empleado y el gerente,
 * como siempre. La foto nunca fue obligatoria en el servidor (`clockIn` acepta `photoPath` vacío): lo
 * único que la pedía era este paso de la pantalla.
 */
export function fichaConFoto(role: string | null | undefined): boolean {
  return !esAdminDeTt(role);
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

/** Lo que sale en la tarjeta de fichar y debajo de ella (PunchPanel). */
export type SeccionesDeFichar = {
  /**
   * El contador grande que corre («4:05:12», «0:00:00») en la tarjeta de fichar. Solo el admin
   * (D-517): el dueño, mirando la de un empleado, «quita el tiempo y solo deja clock in y not active,
   * no queremos que miren el tiempo». Es solo el NÚMERO de esta tarjeta: el cronómetro de D-470
   * (`Cronometro`, su latido y su vigía) no es esto y sigue montado y grabando igual.
   */
  contador: boolean;
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
  if (q.esAdmin) return { contador: true, semanaDePago: true, fichajesDeHoy: true, boletin: true, horarioYNotas: true };
  return { contador: false, semanaDePago: false, fichajesDeHoy: false, boletin: false, horarioYNotas: true };
}

/** Lo que sale en «Mi semana». */
export type SeccionesDeMiSemana = {
  /** Pago estimado, pagado hasta hoy, la columna de pago y el aviso de lo pagado. */
  dinero: boolean;
  /**
   * La cifra «Horas totales» de arriba. Fuera para el presencial (D-517, el dueño: «TOTAL HOURS
   * REMOVE IT»): la suya eran sus horas FICHADAS de la semana de pago (D-489). El remoto la conserva:
   * es la suma de su propia tabla del cronómetro, que sigue viendo justo debajo. El admin, como siempre.
   */
  totalDeHoras: boolean;
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
  if (q.esAdmin) return { dinero: true, totalDeHoras: true, boletin: false, fichajesDeHoy: false };
  return { dinero: false, totalDeHoras: !q.presencial, boletin: q.presencial, fichajesDeHoy: q.presencial };
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

// `horasDeLaSemana` (D-489) se quitó en D-517: daba las horas FICHADAS al presencial para «Horas
// totales», y esa cifra ya no se le enseña. Al remoto y al admin la cifra les sale de su cronómetro
// (`totalSec`), que es lo que la función devolvía para ellos.

/**
 * «Mis solicitudes»: primero Tiempo libre, después Tiempo. Para todos —es la misma pantalla para
 * el admin— y la primera es la que se abre.
 */
export const PESTANAS_DE_SOLICITUDES = ["off", "time"] as const;
export type PestanaDeSolicitud = (typeof PESTANAS_DE_SOLICITUDES)[number];
export const PESTANA_DE_SOLICITUD_INICIAL: PestanaDeSolicitud = PESTANAS_DE_SOLICITUDES[0];
