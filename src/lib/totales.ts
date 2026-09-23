/**
 * Sumar **dinero** y **millas**: cada magnitud con su unidad, y en un solo sitio (D-NEXT).
 *
 * Hermano de `sumaPallets` (`lib/pallets.ts`, D-362), y por la misma razón que aquélla: el problema
 * no era de ninguna pantalla, era de sumar por ahí suelto. Medido en `main` 6999253, la regla de
 * redondeo estaba **copiada a mano en 27 sitios** y en **tres grafías** —`Math.round(x * 100) / 100`,
 * `Math.round(x * 10) / 10` y `.toFixed(2)`—, sin ningún lugar que dijera cuál es la unidad de cada
 * magnitud. Un total que se calcula en catorce sitios acaba saliendo distinto en dos de ellos.
 *
 * **Lo que NO pasaba, y conviene no contarlo mal:** la cola binaria no llegaba a ninguna pantalla.
 * Los sitios que acumulaban en coma flotante redondeaban antes de pintar o de devolver. Esto no
 * arregla un número que se viera mal; quita catorce copias de una regla que nadie había escrito.
 *
 * ### Las unidades, que son la decisión
 *
 * - **El dinero, al centavo.** Dos decimales. Con dinero la décima no es una unidad: no existe un
 *   precio de $12,3 que alguien pueda cobrar.
 * - **Las millas, a la décima**, que es lo que ya hacía el manifiesto y lo que decide algo: con una
 *   centésima de milla nadie cambia una ruta.
 *
 * ### Por qué se acumula en enteros, y en una unidad MÁS FINA que la que se enseña
 *
 * Se suman **centésimas enteras** y se divide al final. Sumar en coma flotante y redondear una vez
 * también da bien con estos tamaños, pero en enteros no hay nada que explicar.
 *
 * Lo que sí importa y es fácil hacer mal: **no se redondea cada sumando a la unidad de salida**. Con
 * millas a la décima, diez tramos de 0,04 mi darían `0` cada uno y **0 en total** en vez de 0,4 — que
 * es exactamente el fallo que D-362 llama *«mal y creíble»*, el que no deja cola que delate nada. Por
 * eso se acumula a la centésima y solo el total baja a la décima.
 */

/** Centésimas enteras de un valor cualquiera. Lo que no es un número cuenta como 0. */
const centesimasDe = (v: number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Redondea al centavo. Es la unidad del dinero en esta app. */
export function redondeaDinero(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Redondea a la décima de milla. Es la unidad de las millas en esta app. */
export function redondeaMillas(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/**
 * Suma dinero, al centavo. `de` saca el importe de cada elemento; lo vacío cuenta como 0.
 *
 * Sirve tanto para sumar `delivery_fee` de unas órdenes como para sumar totales ya calculados —los
 * ingresos por chofer del Panel, el coste de unos incidentes—: es la misma magnitud y la misma unidad.
 */
export function sumaDinero<T>(items: readonly T[], de: (x: T) => number | null | undefined): number {
  return items.reduce((s, x) => s + centesimasDe(de(x)), 0) / 100;
}

/**
 * Suma millas, a la décima. `de` saca las millas de cada elemento; lo vacío cuenta como 0.
 *
 * Se acumula a la centésima y se baja a la décima **al final**, no por sumando: ver la cabecera.
 */
export function sumaMillas<T>(items: readonly T[], de: (x: T) => number | null | undefined): number {
  return redondeaMillas(items.reduce((s, x) => s + centesimasDe(de(x)), 0) / 100);
}
