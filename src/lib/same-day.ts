import { isoInTZ } from "@/lib/utils";
import { cambiaLaFecha, saltaDomingo } from "@/lib/dia-de-entrega";
import { mananaEnTexas } from "@/lib/avisos-cliente";

// ============================================================
// "Mismo día" (el dueño, 2026-11-10): cualquier orden —cliente, intertienda o transfer— nace POR DEFECTO para MAÑANA.
// Si alguien la pone (o la manda a programar) para HOY, se le PREGUNTA antes de guardar, con el diálogo de la app: que
// contacte al gerente de logística, porque a última hora quizá se reprograme. No bloquea: puede decir «Sí, para hoy».
//
// Reemplaza al corte de las 12 de D-845 (`corte-de-ventas`): aquél solo tocaba a ventas y solo pasadas las 12. Éste es
// para TODO el que crea órdenes a CUALQUIER hora. Quien asigna —logística y admin— queda exento: ellos sí ponen hoy sin
// aviso. La migración 237 sigue EN ESPERA e intacta (ver `@/lib/corte-de-ventas`).
//
// Puro: sin React, sin red. El día «hoy» y «mañana» se leen SIEMPRE en Texas, nunca con el reloj del aparato ni en UTC.
// ============================================================

/** Los roles que ASIGNAN y no reciben el aviso de mismo día: ellos sí ponen una orden para hoy sin que se les pregunte. */
export const ROLES_SIN_AVISO_MISMO_DIA = ["logistics", "admin"] as const;

/** ¿A este rol se le pregunta al poner una orden para hoy? A todos MENOS logística y admin. */
export function aplicaAvisoMismoDia(rol: string | null | undefined): boolean {
  return !ROLES_SIN_AVISO_MISMO_DIA.includes(rol as (typeof ROLES_SIN_AVISO_MISMO_DIA)[number]);
}

/** ¿La fecha es la de HOY en Texas? Sin fecha, no. */
export function esParaHoy(fecha: string | null | undefined, ahora: Date = new Date()): boolean {
  if (!fecha || !fecha.trim()) return false;
  return fecha.trim().slice(0, 10) === isoInTZ(ahora);
}

/**
 * ¿Esta escritura pide la pregunta «¿seguro que es para hoy?»? Un rol que no asigna, con la fecha de hoy y:
 * - la fecha es nueva o cambia (como D-532 y D-658): la misma fecha de siempre no es agendar;
 * - o la escritura manda la orden a programar sin tocar la fecha (`agenda`): enviar un borrador o reenviar una rechazada.
 */
export function pideConfirmarMismoDia(
  nueva: string | null | undefined,
  actual: string | null | undefined,
  { rol, ahora = new Date(), agenda = false }: { rol: string | null | undefined; ahora?: Date; agenda?: boolean },
): boolean {
  if (!agenda && !cambiaLaFecha(nueva, actual)) return false;
  return aplicaAvisoMismoDia(rol) && esParaHoy(nueva, ahora);
}

/** La fecha por defecto de una orden nueva: MAÑANA en Texas, saltando el domingo. */
export function fechaPorDefectoManana(ahora: Date = new Date()): string {
  return saltaDomingo(mananaEnTexas(ahora));
}

/** El aviso debajo del selector: un consejo, no un error. */
export const AVISO_MISMO_DIA = {
  en: "This order is set for today (same-day). Contact the logistics manager; for the short notice it might get rescheduled for tomorrow.",
  es: "Esta orden es para hoy (mismo día). Contacta al gerente de logística; por ser a última hora puede reprogramarse para mañana.",
} as const;

/** La pregunta antes de guardar, y sus dos botones. */
export const PREGUNTA_MISMO_DIA = {
  en: "Are you sure? Contact the logistics manager to assign it. Note: for the short notice this might get rescheduled for tomorrow.",
  es: "¿Seguro? Contacta al gerente de logística para asignarla. Nota: por ser a última hora, puede reprogramarse para mañana.",
  si: { en: "Yes, for today", es: "Sí, para hoy" },
  cambiar: { en: "Change date", es: "Cambiar fecha" },
} as const;

/**
 * Hace la pregunta con el diálogo de la app (`useConfirm` de `@/lib/confirm`, nunca `window.confirm`).
 * `true` = «Sí, para hoy» (se guarda); `false` = «Cambiar fecha» (no se guarda nada).
 */
export function preguntaMismoDia(
  confirmar: (mensaje: string, opciones: { confirmLabel: string; cancelLabel: string }) => Promise<boolean>,
  t: (en: string, es: string) => string,
): Promise<boolean> {
  const p = PREGUNTA_MISMO_DIA;
  return confirmar(t(p.en, p.es), { confirmLabel: t(p.si.en, p.si.es), cancelLabel: t(p.cambiar.en, p.cambiar.es) });
}
