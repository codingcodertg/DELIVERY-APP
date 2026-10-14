import type { CSSProperties } from "react";

/**
 * Los colores de «Mi ruta» por tipo de parada (D-535). El dueño, 2026-10-12: «pickup in driver view should be 1 color
 * and deliveries another like light green and delivery light blue».
 *
 * Una recogida (P) va sobre verde claro y una entrega (D) sobre azul claro, en la lista y en la tarjeta de «Siguiente
 * parada». La siguiente ya no se distingue por el fondo (antes, azul claro en cualquier fila): lleva un borde del
 * color de acento, que se ve igual sobre los dos fondos. Los tokens son los de `globals.css`, con su versión oscura.
 */
/**
 * **Reemplazado en parte por D-547** (2026-10-14). El dueño, con una captura de «Mi ruta»: *«pickups change to color blue
 * and deliveries to the orgiinal clear color»*. La recogida pasa a azul claro (`--accent-soft`, el que tenían las
 * entregas) y la entrega vuelve al fondo de siempre de la fila, sin tinte (`undefined`: no se escribe `background`). El
 * borde de la siguiente no cambia. Antes: `{ P: "var(--green-soft)", D: "var(--accent-soft)" }`.
 */
export const FONDO_DE_PARADA: Record<"P" | "D", string | undefined> = { P: "var(--accent-soft)", D: undefined };

/** El fondo de una fila (o de la tarjeta) y, si es la siguiente, su borde. Sin fondo propio (la entrega), sin `background`. */
export function estiloDeParada(tipo: "P" | "D", siguiente: boolean): CSSProperties {
  const fondo = FONDO_DE_PARADA[tipo];
  return {
    ...(fondo ? { background: fondo } : {}),
    ...(siguiente ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : {}),
  };
}
