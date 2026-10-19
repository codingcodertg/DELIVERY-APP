import type { UserRole } from "@/lib/types";

/**
 * El chip de fechas de la pantalla de Órdenes: «Todas · Hoy · Mañana» (D-588).
 *
 * El dueño, 2026-10-18: «remove reciente y que sea todas hoy y manana en deliveries app». «Reciente» (D-350: ayer, hoy y
 * mañana) desaparece; en su sitio entra «Mañana», que es solo lo que tiene fecha de entrega mañana (día de Texas).
 */
export type PresetDeFechas = "all" | "today" | "tomorrow";
export const PRESETS_DE_FECHAS: readonly PresetDeFechas[] = ["all", "today", "tomorrow"];

/** El valor con el que se guardó el chip «Reciente» hasta D-588 (filtros guardados, `p`). Ya no existe. */
export const PRESET_RETIRADO = "recent";

/**
 * Con qué pestaña de fechas nace la pantalla de Órdenes, por rol.
 *
 * - Ventas en «Todas» (D-507): «el view de sales en orders quiero que sea all por default en vez de recientes». Su cartera
 *   es pequeña y lo que necesita ver de entrada es todo lo suyo.
 * - Los demás nacían en «Reciente» (D-350). Sin «Reciente», nacen en **«Hoy»** (D-588): es el chip que más se le parece
 *   —el centro de aquella ventana— y el que menos carga; «Todas» pide el historial entero al proveedor.
 *
 * Es solo el punto de PARTIDA: cualquiera cambia de pestaña con un clic, y lo que elija manda desde ese momento.
 */
export function presetInicialDe(rol: UserRole | null | undefined): PresetDeFechas {
  return rol === "sales" ? "all" : "today";
}

/**
 * Un chip de fechas leído de donde se guardó (un filtro guardado de D-440, en la base o en el navegador). Los tres de ahora
 * se leen tal cual; **«recent», el retirado, se lee como «Hoy»**, que es lo que lo sustituye: un filtro guardado con
 * «Reciente» sigue aplicando un corte de fecha en vez de pasar en silencio a «Todas». Cualquier otra cosa, nada.
 */
export function presetDeFechasLeido(p: unknown): PresetDeFechas | null {
  if (p === PRESET_RETIRADO) return "today";
  return (PRESETS_DE_FECHAS as readonly unknown[]).includes(p) ? (p as PresetDeFechas) : null;
}
