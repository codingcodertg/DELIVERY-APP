/**
 * Qué rutas se LISTAN en el panel «Choferes y rutas» (D-481, f). El dueño, 2026-10-06 (dictado, literal): «if a driver
 * doesnt have an order he doesnt appear on the list».
 *
 * Un chofer sin ninguna orden ese día —ni pendiente ni ya hecha (D-459)— no sale en el panel ni en las tarjetas, ni en el
 * Gestor ni en «Ruta de hoy». Sigue saliendo donde se ASIGNA (el desplegable «Asignar a…», «Elige conductor», «Asignar a
 * varios», el tablero y el horario): ahí es justo donde se le da su primera orden.
 *
 * Una ruta TEMPORAL vacía («Route 1», D-437) sí se queda: nace vacía desde «＋ Ruta» en ese mismo panel, y es desde ahí
 * donde se renombra (✏) o se quita (✕); si desapareciera al nacer, no habría forma de llegarle. No es un chofer.
 */
export function rutasConOrdenes<T extends { key: string; isBucket: boolean }>(rutas: readonly T[], tieneAlgo: (clave: string) => boolean): T[] {
  return rutas.filter((r) => r.isBucket || tieneAlgo(r.key));
}
