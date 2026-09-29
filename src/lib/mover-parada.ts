/**
 * Mover UNA parada a mano en la tarjeta de un chofer del Gestor de Rutas (D-433): las flechas ↑ ↓ y el selector «Viaje N».
 *
 * **D-NEXT quitó los viajes.** El selector «Viaje N» / «＋ Nuevo viaje», «Unir viajes» y «Dividir en 2» ya no existen, y
 * con ellos se fueron de aquí `planDeFlecha`, `cabeEnElViaje`, `planDeUnirViajes`, `planDeDividirEnDos` y
 * `planDeCambioDeViaje(DeVarias)`. Mover una parada de la lista —P o D— es ahora `mueveEnLaLista` (lib/lista-unica). Aquí
 * queda lo que D-433 decidió y sigue valiendo: desde qué puesto se numera (tras lo ya hecho) y qué es «lo ya hecho».
 *
 * El dueño, el 2026-09-28, con la tarjeta de Ernesto delante: «las felchas no funcionan igual para cmabiar truckload no
 * funcionan». Lo que se midió en el demo (clics de persona, con plan publicado simulado):
 *
 * - **«Viaje N» / «＋ Nuevo viaje» dejaba la ruta A MEDIAS.** Escribía el viaje nuevo con `route_seq: null`, y una ruta con
 *   alguna parada sin puesto se lee como D-336: la movida pasa a «—» y **todas las filas de recogida (P) desaparecen** de la
 *   tarjeta, también las del otro viaje. La parada sí cambiaba de viaje, pero la tarjeta se veía rota. Y lo guardado (sin
 *   puesto) no decía dónde estaba la parada que la pantalla pintaba al final del viaje.
 * - **No miraba la capacidad**: pasaba la parada a un viaje lleno sin decir nada.
 * - **Las flechas escribían `route_seq` 0..n-1 contando solo lo pendiente.** Lo recogido o entregado del chofer ese día no
 *   sale en el Gestor, pero conserva su puesto, y «Mi ruta» del chofer ordena TODO por `route_seq`: medido en producción el
 *   2026-09-28, #552 entregada con `route_seq` 1 y #603 pendiente también con 1.
 *
 * Aquí está lo que decide QUÉ se escribe, sin pantalla: la pantalla llama a esto y escribe con `reorderStops`.
 */

/** Las etapas de lo ya hecho: no salen en el Gestor, pero siguen en «Mi ruta» con su puesto. No se mueven nunca. */
export const ETAPAS_HECHAS: ReadonlySet<string> = new Set(["picked_up", "delivered"]);

/**
 * Desde qué `route_seq` se numeran las pendientes: justo DESPUÉS de lo último ya hecho del chofer ese día.
 *
 * Se decidió así, y no «saltar» los números de las hechas intercalándolas, porque lo hecho ya pasó: en el orden del día va
 * delante de todo lo pendiente. Así las pendientes no empatan con ninguna hecha (el caso medido: dos con puesto 1) y «Mi
 * ruta» enseña lo hecho y después lo que falta, en el orden que dejó quien despacha. Las hechas no se reescriben.
 */
export function inicioDeLaSecuencia(hechas: readonly { route_seq?: number | null }[]): number {
  let max = -1;
  for (const h of hechas) if (h.route_seq != null && h.route_seq > max) max = h.route_seq;
  return max + 1;
}

/** Lo ya hecho de un chofer en esas fechas (las de las paradas que se mueven). */
export function hechasDelChofer<T extends { assigned_driver?: string | null; delivery_date?: string | null; stage: string }>(
  todas: readonly T[], chofer: string, fechas: ReadonlySet<string | null>,
): T[] {
  return todas.filter((d) => d.assigned_driver === chofer && ETAPAS_HECHAS.has(d.stage) && fechas.has(d.delivery_date ?? null));
}
