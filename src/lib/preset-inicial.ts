import type { UserRole } from "@/lib/types";

/**
 * Con qué pestaña de fechas nace la pantalla de Órdenes, por rol (D-507).
 *
 * El dueño: «el view de sales en orders quiero que sea all por default en vez de recientes». D-350 puso «Reciente»
 * —ayer, hoy y mañana— como punto de partida para todos; ventas trabaja sobre su propia cartera, que es mucho más
 * pequeña que la del despacho, y lo que necesita ver de entrada es **todo lo suyo**, no los tres días de alrededor.
 *
 * Es solo el punto de PARTIDA: cualquiera cambia de pestaña con un clic, y lo que elija manda desde ese momento.
 */
export function presetInicialDe(rol: UserRole | null | undefined): "all" | "recent" {
  return rol === "sales" ? "all" : "recent";
}
