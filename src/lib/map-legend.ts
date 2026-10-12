import { fallbackDriverColor } from "./utils";

/**
 * El color de cada chofer en el mapa de Entregas, en un solo sitio.
 *
 * Nació con la leyenda del mapa (D-274): el dueño pidió «add legend in the map of sales of what each point means», y la
 * leyenda tenía que decir lo mismo que el mapa pintaba, así que el color se sacó de la página a esta función, que usaban el
 * dibujo y la leyenda.
 *
 * **Reemplazado en parte por D-NEXT** (2026-10-11): la leyenda se quitó de toda la app —«delete the lEGEND ON THE MAP of
 * the app»— y con ella `leyendaDelMapa`, su componente `MapLegend` y los dos colores que solo usaba ella (la ruta azul de
 * lo elegido y el pin oscuro de la recogida, que el mapa ya no pintaba desde D-467). Queda lo que el mapa sigue usando: el
 * color del chofer (el Gestor, «Mi ruta» y Almacén) y el gris de lo que no tiene chofer. El fichero conserva su nombre para
 * no tocar a quien lo importa.
 */

/** El gris de lo que aún no tiene chofer: el punto y su ruta discontinua. Mismo valor que tenía la página. */
export const COLOR_SIN_ASIGNAR = "#6b7686";

/** El color de un chofer en el mapa: el que le puso un gerente, el de la paleta si no tiene, y el gris sin chofer. */
export function colorDeChofer(coloresDeChofer: Record<string, string> | null | undefined, chofer: string | null | undefined): string {
  if (!chofer) return COLOR_SIN_ASIGNAR;
  return coloresDeChofer?.[chofer] || fallbackDriverColor(chofer);
}
