import { TIENDA_CLASICA } from "./store-pins";
import { fallbackDriverColor } from "./utils";

/**
 * La leyenda del mapa de Entregas: qué significa cada cosa que se pinta (D-NEXT).
 *
 * El dueño: «add legend in the map of sales of what each point means». La leyenda tiene que decir lo
 * mismo que el mapa pinta, así que **sale de los mismos sitios que deciden cada color**, no de una copia:
 *
 * - la tienda, de `TIENDA_CLASICA`, el rojo que dibujan los dos motores de mapa cuando la tienda no
 *   tiene papel, que es el caso de esta página;
 * - cada entrega, de `colorDeChofer`, que es lo que llama el `colorFor` de la página para pintar los
 *   puntos: el color que le puso un gerente al chofer, el de la paleta si no tiene, y el gris sin chofer;
 * - la recogida, la ruta de lo elegido y la ruta sin chofer, de las constantes de aquí, que la página
 *   usa también para pintarlas. Antes eran hex sueltos dentro de la página.
 */

/** El gris de lo que aún no tiene chofer: el punto y su ruta discontinua. Mismo valor que tenía la página. */
export const COLOR_SIN_ASIGNAR = "#6b7686";

/** El pin oscuro con una «P» de la recogida de la orden elegida. Mismo valor que tenía la página. */
export const COLOR_RECOGIDA = "#111827";

/** La ruta, en azul, de las órdenes elegidas. Mismo valor que tenía la página. */
export const COLOR_RUTA_ELEGIDA = "#2456c9";

/** El color de un chofer en el mapa. La página pinta con esto y la leyenda lee esto. */
export function colorDeChofer(coloresDeChofer: Record<string, string> | null | undefined, chofer: string | null | undefined): string {
  if (!chofer) return COLOR_SIN_ASIGNAR;
  return coloresDeChofer?.[chofer] || fallbackDriverColor(chofer);
}

export type ElementoLeyenda =
  | { clave: string; forma: "tienda" | "punto"; color: string; en: string; es: string }
  | { clave: string; forma: "pin"; color: string; insignia: string; en: string; es: string }
  | { clave: string; forma: "linea"; color: string; discontinua: boolean; en: string; es: string }
  | { clave: string; forma: "icono"; icono: string; en: string; es: string };

/**
 * Los elementos de la leyenda, lo fijo primero.
 *
 * - `choferes`: el chofer asignado de cada punto que el mapa pinta ese día, repetidos o no. Sale un
 *   elemento por chofer distinto, por nombre, y uno gris si alguno no tiene: un chofer sin puntos ese
 *   día no dice nada en la leyenda y solo ocupa sitio. «Sin chofer» es lo mismo que decide
 *   `colorDeChofer`, un valor vacío.
 * - `coloresDeChofer`: `settings.driver_colors`, lo mismo que recibe la página.
 * - `rutasSinChofer`: si el mapa está dibujando las rutas discontinuas de lo que no tiene chofer.
 * - `puedeAsignar`: lo que ve quien asigna y ventas no, porque no puede elegir órdenes: la recogida y
 *   la ruta de lo elegido, y los camiones en vivo. Sale aunque aún no haya nada elegido, para que la
 *   leyenda no cambie de tamaño con cada toque.
 */
export function leyendaDelMapa(a: {
  choferes: (string | null | undefined)[];
  coloresDeChofer: Record<string, string> | null | undefined;
  rutasSinChofer: boolean;
  puedeAsignar: boolean;
}): ElementoLeyenda[] {
  const out: ElementoLeyenda[] = [
    { clave: "tienda", forma: "tienda", color: TIENDA_CLASICA.fill, en: "Store", es: "Tienda" },
  ];

  const nombres = new Set<string>();
  let haySinChofer = false;
  for (const c of a.choferes) {
    if (!c) haySinChofer = true;
    else nombres.add(c);
  }
  for (const nombre of [...nombres].sort((x, y) => x.localeCompare(y))) {
    out.push({ clave: `chofer:${nombre}`, forma: "punto", color: colorDeChofer(a.coloresDeChofer, nombre), en: `Delivery · ${nombre}`, es: `Entrega · ${nombre}` });
  }
  if (haySinChofer) {
    out.push({ clave: "sin_chofer", forma: "punto", color: colorDeChofer(a.coloresDeChofer, null), en: "Delivery · no driver yet", es: "Entrega · sin chofer" });
  }

  if (a.rutasSinChofer) {
    out.push({ clave: "ruta_sin_chofer", forma: "linea", color: COLOR_SIN_ASIGNAR, discontinua: true, en: "Route of an order with no driver", es: "Ruta de una orden sin chofer" });
  }
  if (a.puedeAsignar) {
    out.push({ clave: "ruta_elegida", forma: "linea", color: COLOR_RUTA_ELEGIDA, discontinua: false, en: "Route of the selected orders", es: "Ruta de las órdenes elegidas" });
    out.push({ clave: "recogida", forma: "pin", color: COLOR_RECOGIDA, insignia: "P", en: "Pickup of the selected order", es: "Recolección de la orden elegida" });
    out.push({ clave: "camion", forma: "icono", icono: "🚚", en: "Driver, live", es: "Chofer en vivo" });
  }
  return out;
}
