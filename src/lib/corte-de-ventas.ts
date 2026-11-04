import { isoInTZ } from "@/lib/utils";
import { horaEnTexas } from "@/lib/fecha-de-intertienda";
import { cambiaLaFecha } from "@/lib/dia-de-entrega";

// ============================================================
// Ventas poniendo HOY después de las 12 del mediodía (hora de Texas): se PREGUNTA, no se prohíbe.
//
// D-845 (el dueño, 2026-11-04): «sales no pueden ingresar una orden para el mismo día después de las 12, tiene que ser
// para el día siguiente». Ese mismo día cambió de idea: «no lo apliques como bloqueo; solo pregúntale al vendedor
// "¿seguro? ya es tarde"». Así que ya no hay corte: el selector vuelve a empezar en hoy, duplicar vuelve a nacer hoy, y
// cuando ventas pone (o manda a programar) una orden para hoy pasadas las 12, se le pregunta UNA vez por guardado
// «¿Seguro que esta orden es para hoy?» con «Sí, para hoy» y «Cambiar fecha». Si dice que sí, se guarda como antes de
// D-845. Debajo del selector queda un aviso, como consejo, no como error.
//
// Antes de las 12:00 en Texas (`BUSINESS_TZ`, America/Chicago, con su cambio de horario) no se pregunta nada; desde las
// 12:00 en punto, sí. Solo el rol `sales`: admin, gerente, logística, almacén, office y chofer siguen como estaban.
//
// Los caminos que preguntan: la ficha (crear, enviar, guardar, borrador, «solo la fecha» de D-480, enviar un borrador y
// reenviar una rechazada), «📅 Reprogramar» (D-549) y, por si algún día llegan a ventas, la celda del Gestor y la fecha
// en bloque. Los proveedores de datos ya no bloquean: la pregunta vive en la pantalla.
//
// MIGRACIÓN 237 (`237_corte_mediodia_ventas.sql`, el disparador que BLOQUEABA en la base): EN ESPERA por decisión del
// dueño. NO se aplica hasta que él lo diga. No se edita tampoco: su checksum está congelado en el libro de migraciones.
// Su mensaje de error es `MENSAJE_DE_LA_237`, que ya no sale en pantalla.
//
// Puro: sin React, sin red. La hora y el día se leen siempre en Texas, nunca con el reloj del aparato ni en UTC.
// ============================================================

/** La hora (0–23, en Texas) desde la que a ventas se le pregunta si de verdad es para hoy. */
export const HORA_DE_CORTE_VENTAS = 12;

/** ¿Ya son las 12:00 o más en Texas? */
export function pasoElCorteDeVentas(ahora: Date = new Date()): boolean {
  return horaEnTexas(ahora) >= HORA_DE_CORTE_VENTAS;
}

/** ¿A este rol se le pregunta? Solo a ventas. */
export function aplicaCorteDeVentas(rol: string | null | undefined): boolean {
  return rol === "sales";
}

/** ¿Es ventas, pasadas las 12 en Texas, con la fecha de HOY (en Texas)? Sin fecha, no. */
export function esHoyTrasElMediodia(
  fecha: string | null | undefined,
  { rol, ahora = new Date() }: { rol: string | null | undefined; ahora?: Date },
): boolean {
  if (!fecha || !fecha.trim()) return false;
  if (!aplicaCorteDeVentas(rol) || !pasoElCorteDeVentas(ahora)) return false;
  return fecha.trim().slice(0, 10) === isoInTZ(ahora);
}

/**
 * ¿Esta escritura pide la pregunta «¿seguro que es para hoy?»? Ventas, pasadas las 12, con la fecha de hoy y:
 * - la fecha es nueva o cambia (como D-532 y D-658): la misma fecha de siempre no es agendar;
 * - o la escritura manda la orden a programar sin tocar la fecha (`agenda`): enviar un borrador o reenviar una rechazada.
 */
export function pideConfirmarMediodia(
  nueva: string | null | undefined,
  actual: string | null | undefined,
  { rol, ahora = new Date(), agenda = false }: { rol: string | null | undefined; ahora?: Date; agenda?: boolean },
): boolean {
  if (!agenda && !cambiaLaFecha(nueva, actual)) return false;
  return esHoyTrasElMediodia(nueva, { rol, ahora });
}

/** El aviso debajo del selector: un consejo, no un error. */
export const AVISO_CORTE_VENTAS = {
  en: "It's after 12:00 noon. Make sure this order really is for today; if not, pick tomorrow.",
  es: "Ya es después de las 12:00 del mediodía. Asegúrate de que esta orden de verdad es para hoy; si no, elige mañana.",
} as const;

/** La pregunta antes de guardar, y sus dos botones. */
export const PREGUNTA_CORTE_VENTAS = {
  en: "It's after 12:00 noon. Are you sure this order is for today?",
  es: "Ya es después de las 12:00 del mediodía. ¿Seguro que esta orden es para hoy?",
  si: { en: "Yes, for today", es: "Sí, para hoy" },
  cambiar: { en: "Change date", es: "Cambiar fecha" },
} as const;

/** El mensaje con el que BLOQUEA la migración 237 (en espera, sin aplicar). Solo para que la prueba lo compare con el .sql. */
export const MENSAJE_DE_LA_237 = {
  en: "After 12:00 noon, sales orders start tomorrow. Pick tomorrow or a later day.",
  es: "Después de las 12:00 del mediodía, las órdenes de ventas son para mañana. Elige mañana o un día posterior.",
} as const;

/**
 * Hace la pregunta con el diálogo de la app (`useConfirm` de `@/lib/confirm`, nunca `window.confirm`).
 * `true` = «Sí, para hoy» (se guarda); `false` = «Cambiar fecha» (no se guarda nada).
 */
export function preguntaSiEsParaHoy(
  confirmar: (mensaje: string, opciones: { confirmLabel: string; cancelLabel: string }) => Promise<boolean>,
  t: (en: string, es: string) => string,
): Promise<boolean> {
  const p = PREGUNTA_CORTE_VENTAS;
  return confirmar(t(p.en, p.es), { confirmLabel: t(p.si.en, p.si.es), cancelLabel: t(p.cambiar.en, p.cambiar.es) });
}
