import { todayISO } from "@/lib/utils";

// ============================================================
// Una orden no se agenda en un día pasado (D-532).
//
// El dueño, 2026-10-12: «que no se pueda agendar orden a dias pasados».
//
// Una sola regla para todos los sitios que escriben `delivery_date`: la ficha (crear, enviar, editar y «solo la fecha»
// de ventas), la celda de fecha del Gestor de rutas, la fecha en bloque de Órdenes. «Reprogramar» ya la tenía
// (`reprogramacionValida`, D-500: `nueva < hoy` no vale). Se mira la FECHA NUEVA: una orden que ya estaba en un día
// pasado (atrasada) se sigue pudiendo editar sin tocarle la fecha; lo que no se puede es PONERLE un día pasado.
// Un borrador (`stage = draft`) no se agenda, así que no se le mira aquí: el tope le cae al enviarlo.
//
// Puro: sin React, sin red.
// ============================================================

/** ¿Es un día anterior a hoy? Sin fecha, no (eso lo dicen los campos obligatorios). */
export function fechaDeEntregaPasada(fecha: string | null | undefined, hoy: string = todayISO()): boolean {
  if (!fecha) return false;
  return fecha.slice(0, 10) < hoy;
}

/**
 * ¿Esta escritura AGENDA en un día pasado? Solo cuando la fecha es nueva o cambia: la misma fecha de siempre, aunque
 * ya sea vieja, no es agendar (es una atrasada que se edita o se entrega).
 */
export function agendaEnDiaPasado(
  nueva: string | null | undefined,
  actual: string | null | undefined,
  hoy: string = todayISO(),
): boolean {
  if (!fechaDeEntregaPasada(nueva, hoy)) return false;
  return (nueva ?? "").slice(0, 10) !== (actual ?? "").slice(0, 10);
}

/** El `min` del selector de fecha: hoy. */
export function minFechaDeEntrega(hoy: string = todayISO()): string {
  return hoy;
}

export const AVISO_FECHA_PASADA = {
  en: "The delivery date can't be a past day. Pick today or a later day.",
  es: "La fecha de entrega no puede ser un día pasado. Elige hoy o un día posterior.",
} as const;
