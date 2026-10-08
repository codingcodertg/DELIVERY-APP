import { posicionDelMenu, type Ancla } from "@/lib/menu-desplegable";

/**
 * La mecánica del menú «Acciones ▾» (D-497): dónde se pinta y a qué opción va el foco con el teclado.
 *
 * QUÉ opciones lleva lo decide quien lo usa (la ficha: `lib/acciones-de-la-ficha.ts`). Aquí solo lo que
 * vale para cualquier lista de acciones, en funciones puras porque las pruebas corren sin navegador.
 */

/** Alto de cada opción: el mínimo cómodo para un dedo (44 px, la guía de Apple y la de WCAG 2.5.5). */
export const ALTO_OPCION = 44;
/** Ancho del menú. En un teléfono de 390 px deja 8 px de aire a cada lado como mínimo. */
export const ANCHO_MENU_ACCIONES = 260;
/** Lo que el menú ocupa además de sus opciones: el relleno de `.col-menu` (6 + 6) y su borde (1 + 1). */
const RELLENO_Y_BORDE = 14;
/** La raya que separa lo destructivo (1 px y 4 px de margen arriba y abajo). */
export const ALTO_RAYA = 9;
/** Aire mínimo entre el menú y el borde de la ventana, el mismo que `posicionDelMenu`. */
const MARGEN = 8;
/** Separación entre el botón y el menú, la misma que `posicionDelMenu`. */
const HUECO = 6;

/** Lo que mide el menú entero, con sus opciones y sus rayas. */
export function altoDelMenu(opciones: number, rayas: number): number {
  return opciones * ALTO_OPCION + rayas * ALTO_RAYA + RELLENO_Y_BORDE;
}

/**
 * Dónde y de qué tamaño se pinta. Va en un portal con `position: fixed`, como los de la tabla de Órdenes:
 * la ficha es una capa que se desplaza, y un menú dentro de ella quedaría recortado o alargaría la página.
 *
 * - Abre **debajo** del botón si cabe, y si no cabe y arriba hay más sitio, **encima** (`posicionDelMenu`).
 * - Su borde derecho va con el del botón, sin salirse de la ventana por ningún lado.
 * - Nunca más ancho que la ventana menos 8 px por lado.
 * - Si no cabe entero en el lado elegido, se queda en el sitio que hay y se desplaza por dentro
 *   (`maxHeight`): una opción que queda fuera de la pantalla es una opción que no existe.
 */
export function colocacionDelMenu(
  ancla: Ancla,
  ventana: { ancho: number; alto: number },
  alto: number,
) {
  const ancho = Math.min(ANCHO_MENU_ACCIONES, ventana.ancho - 2 * MARGEN);
  const pos = posicionDelMenu(ancla, ventana, { ancho, alto });
  const haciaArriba = pos.top === "auto";
  const sitio = haciaArriba ? ancla.top - HUECO - MARGEN : ventana.alto - ancla.bottom - HUECO - MARGEN;
  return { ...pos, width: ancho, maxHeight: Math.max(ALTO_OPCION, Math.min(alto, sitio)) };
}

/**
 * A qué opción va el foco con cada tecla (el patrón «menu button» de WAI-ARIA): las flechas recorren la lista
 * y dan la vuelta, Inicio y Fin van a los extremos. `actual` es -1 cuando el foco aún no está en ninguna.
 * Cualquier otra tecla: `null`, no se mueve nada.
 */
export function focoAlTeclear(tecla: string, actual: number, total: number): number | null {
  if (total <= 0) return null;
  if (tecla === "ArrowDown") return actual < 0 ? 0 : (actual + 1) % total;
  if (tecla === "ArrowUp") return actual < 0 ? total - 1 : (actual - 1 + total) % total;
  if (tecla === "Home") return 0;
  if (tecla === "End") return total - 1;
  return null;
}
