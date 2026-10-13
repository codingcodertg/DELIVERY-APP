import type { CSSProperties } from "react";

/**
 * Los colores de «Mi ruta» por tipo de parada (D-NEXT). El dueño, 2026-10-12: «pickup in driver view should be 1 color
 * and deliveries another like light green and delivery light blue».
 *
 * Una recogida (P) va sobre verde claro y una entrega (D) sobre azul claro, en la lista y en la tarjeta de «Siguiente
 * parada». La siguiente ya no se distingue por el fondo (antes, azul claro en cualquier fila): lleva un borde del
 * color de acento, que se ve igual sobre los dos fondos. Los tokens son los de `globals.css`, con su versión oscura.
 */
export const FONDO_DE_PARADA: Record<"P" | "D", string> = { P: "var(--green-soft)", D: "var(--accent-soft)" };

/** El fondo de una fila (o de la tarjeta) y, si es la siguiente, su borde. */
export function estiloDeParada(tipo: "P" | "D", siguiente: boolean): CSSProperties {
  return {
    background: FONDO_DE_PARADA[tipo],
    ...(siguiente ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : {}),
  };
}
