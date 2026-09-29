/**
 * «Ver un viaje» en el Gestor de Rutas (D-NEXT): cada tarjeta de chofer con más de un viaje lleva un selector —«Todos los
 * viajes», «Viaje 1», «Viaje 2»…— que filtra A LA VEZ su tabla de paradas y lo suyo en el mapa (entregas, recogidas y
 * líneas). El dueño: «select truckload so it only shows one truckload or all in the logistic manager routes and map».
 *
 * **Solo mira.** No escribe nada, no cambia qué viaje es cuál, y no toca flechas, selector «Viaje N» ni el arrastre: todos
 * siguen trabajando sobre la ruta ENTERA (`buildTrips`), porque lo que se guarda no puede depender de lo que se ve.
 *
 * **Por tarjeta, no global:** cada chofer tiene sus viajes; un «Viaje 2» global no querría decir nada para quien tiene uno.
 * La elección vive mientras se mira ese día (estado de la página, se vacía al cambiar de fecha); no va a `user_prefs`.
 */

/** El viaje que se enseña (0 = el primero) o `null` = todos. Un «Viaje N» que ese chofer ya no tiene —se unieron sus
 *  viajes, se movió la última parada— vuelve a «todos»: esconder la ruta entera por un número viejo no ayuda a nadie. */
export function viajeEfectivo(elegido: number | null | undefined, viajes: number): number | null {
  if (elegido == null || viajes < 2) return null;
  return elegido >= 0 && elegido < viajes ? elegido : null;
}

/** ¿Se pinta el viaje `ti` con la elección `efectivo`? */
export const pasaElViaje = (efectivo: number | null, ti: number): boolean => efectivo == null || efectivo === ti;
