/**
 * La barra de desplazamiento de ARRIBA de las tablas (D-NEXT).
 *
 * Pedido de Juan Briseño (Office Manager), 2026-09-25: «Need headers to be locked and have the scroll bar on
 * top of headers in the tables». La barra de abajo de la caja queda lejos —debajo de la última fila visible—, y
 * para ver las columnas de la derecha había que ir a buscarla. La de arriba es un segundo carril que mueve la
 * misma caja: las dos se sincronizan en los dos sentidos.
 *
 * Aquí va la lógica, sin DOM, para que vitest la pruebe; `components/BarraSuperior.tsx` solo la conecta.
 */

/**
 * El alto máximo de una caja que vive DEBAJO de algo `sticky` (el mapa y los choferes del Gestor de Rutas, que
 * se quedan arriba al bajar y miden ~440 px a 900 de alto). Sin esto la caja mide lo de siempre —la ventana
 * menos 150 px, en el CSS— y su cabecera, aunque pegada a la caja, queda tapada por el mapa.
 *
 * `undefined` cuando no hay nada fijo arriba: entonces manda el CSS (`.tbl-scroll.tbl-caja`). Los 60 px son el
 * `top: 6` del panel, la barra de arriba (16) y aire para que la barra de abajo de la caja también se vea. El
 * suelo de 240 px es para ventanas bajas: por debajo de eso cabrían dos o tres filas, y es mejor que la página
 * baje un poco a una tabla que no deja leer nada.
 */
export function altoMaximoDeCaja(altoFijoArriba: number): string | undefined {
  if (!(altoFijoArriba > 0)) return undefined;
  return `max(240px, calc(100dvh - ${Math.round(altoFijoArriba) + 60}px))`;
}

/** Lo que se lee de un elemento que se desplaza a lo ancho. */
export interface Carril {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * ¿Se pinta la barra? Solo si la tabla es más ancha que la caja. El píxel de margen es por el redondeo:
 * con anchos fraccionarios, `scrollWidth` puede salir uno por encima de `clientWidth` sin que haya nada que ver.
 */
export function hayQueMostrarBarra(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth - clientWidth > 1;
}

/**
 * El ancho del relleno de dentro de la barra: el que hace que la barra tenga EXACTAMENTE el mismo recorrido
 * (`scrollWidth - clientWidth`) que la caja. Con el mismo recorrido, un píxel de una es un píxel de la otra, y
 * la sincronización no redondea: por eso no se usa el ancho de la tabla a secas —la barra y la caja no tienen
 * por qué medir lo mismo por dentro (el borde de la caja, su barra vertical)—.
 */
export function anchoDelRelleno(anchoDeLaBarra: number, caja: Pick<Carril, "scrollWidth" | "clientWidth">): number {
  return anchoDeLaBarra + Math.max(0, caja.scrollWidth - caja.clientWidth);
}

/**
 * A dónde hay que llevar `destino` para que acompañe a `origen`, o `null` si ya está.
 *
 * Proporcional al recorrido, por si los dos no lo tienen igual (un cambio de ancho a medio camino). El `null`
 * cuando ya coinciden es lo que corta el eco: mover el destino dispara SU evento de desplazamiento, que pregunta
 * esto mismo al revés, y como ya coinciden no mueve nada. Sin ese corte, las dos se perseguirían.
 */
export function scrollQueToca(origen: Carril, destino: Carril): number | null {
  const recorridoOrigen = origen.scrollWidth - origen.clientWidth;
  const recorridoDestino = destino.scrollWidth - destino.clientWidth;
  // Sin recorrido en el origen no hay proporción que calcular (se dividiría entre cero). Sin recorrido en el
  // destino no hace falta mirarlo: el objetivo sale 0, que es donde ya está, y el corte de abajo devuelve null.
  if (recorridoOrigen <= 0) return null;
  const fraccion = Math.min(1, Math.max(0, origen.scrollLeft / recorridoOrigen));
  const objetivo = Math.round(fraccion * recorridoDestino);
  return Math.abs(destino.scrollLeft - objetivo) < 1 ? null : objetivo;
}
