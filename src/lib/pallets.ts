
/**
 * Los pallets de una orden y la suma de varias, **a la décima** (D-362).
 *
 * Los pallets admiten fracciones —hay órdenes de 0.03 y de 0.1— y sumarlas en coma flotante deja cola: el dueño vio
 * «4.430000000000001/12» en la lista de choferes y «7.569999999999999 libres» en la cabecera de un viaje. D-355 lo
 * arregló en un sitio; esto lo arregla en todos, porque el problema no era de esa pantalla sino de sumar.
 *
 * **Dos formas de equivocarse, y las dos estaban en el repo:**
 * 1. Enseñar la suma tal cual, con su cola de decimales.
 * 2. `Math.round(...)` a entero — que era peor y más silencioso: una ruta con cuatro órdenes de 0.1 enseñaba «0»,
 *    y un total de 4.43 enseñaba «4». Ahí no hay cola que delate el fallo: el número está mal y parece bien.
 *
 * La décima es la unidad de la app: con una décima de pallet nadie decide nada distinto, y es lo que ya usaba D-355.
 */

/** Los pallets de UNA orden: los contados si los hay, y si no, los estimados. `0` si no hay ninguno. */
export function palletsDeLaOrden(d: { actual_pallets?: number | null; est_pallets?: number | null }): number {
  const v = Number(d.actual_pallets ?? d.est_pallets ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/** Redondea a la décima. Lo que entra ya es un número; lo que sale se puede pintar. */
export function aLaDecima(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/** La suma de los pallets de varias órdenes, a la décima. Es lo que se pinta y contra lo que se compara la capacidad. */
export function sumaPallets(ordenes: readonly { actual_pallets?: number | null; est_pallets?: number | null }[]): number {
  return aLaDecima(ordenes.reduce((s, d) => s + palletsDeLaOrden(d), 0));
}
