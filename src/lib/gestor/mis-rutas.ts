import type { Delivery } from "@/lib/types";

/**
 * «🗺 El mapa de mi ruta» (D-NEXT): el chofer mira EL MISMO Gestor de Rutas que el gerente de logística —el mismo mapa, el
 * mismo panel «Choferes y rutas», la misma tabla de paradas, Cuadrícula y Horario— pero acotado a SUS rutas.
 *
 * El dueño (dictado, literal): «drivers view needs to look like to logistic manager view with the routes and
 * everything the map view i mean change it and updat eit»; preguntado por la pantalla y el alcance: «quiero que el chofer
 * mire el mapa con sus rutas asi como el logistic manager ese mismo mapa».
 *
 * **El acotado no es un filtro de pantalla que él pueda cambiar.** El filtro de casillas del panel (D-481/D-488) sigue
 * existiendo, pero no decide esto: lo que se filtra aquí es el ORIGEN —las órdenes que la página recibe, los carriles que
 * pinta y los camiones en vivo del mapa—, así que una orden de otro chofer no llega a la pantalla. Desmarcar una casilla,
 * teclear otra URL o tocar el estado del filtro no puede traer de vuelta algo que no está en la lista.
 *
 * **Qué es «mía»:** la ruta cuya clave es exactamente mi nombre. Las órdenes se asignan por nombre (`assigned_driver`) y la
 * clave de un carril es ese mismo nombre (`orderLaneKey` y `carrilesDelDia`), así que la comparación es la misma que hace
 * «Mi ruta» con `paradasDelChofer`: igualdad exacta, sin normalizar ni recortar. Si los dos sitios compararan distinto, la
 * lista y el mapa del mismo chofer podrían no coincidir.
 *
 * **Sin nombre no hay ruta:** se acota a NADA, nunca a todas. Es el lado seguro, el mismo que `rutaDeSoloLectura` (D-502):
 * lo que no se sabe no se concede. Una persona sin nombre no puede asignarse ninguna orden —se asignan por nombre— así que
 * una pantalla vacía es también la verdad.
 *
 * **Esto es acotado de PANTALLA.** La función `rutas_del_dia()` de la base se le sirve a cualquiera con el módulo de
 * Entregas, el chofer incluido (auditoría del 2026-10-09, hallazgo S-9): la base NO respalda este acotado. Cerrarla es una
 * migración y va aparte.
 */
export function esMiRuta(mio: string | null | undefined, ruta: string | null | undefined): boolean {
  return !!mio && mio.trim() !== "" && ruta === mio;
}

/** Mis órdenes y nada más: las asignadas exactamente a mí. Lo sin chofer tampoco es mío. */
export function soloMisOrdenes<T extends Pick<Delivery, "assigned_driver">>(ordenes: readonly T[], mio: string | null | undefined): T[] {
  return ordenes.filter((d) => esMiRuta(mio, d.assigned_driver));
}

/** Mi carril y nada más: ni los demás choferes, ni las rutas temporales («Ruta 1»), que no son de nadie. */
export function soloMisCarriles<T extends { key: string }>(carriles: readonly T[], mio: string | null | undefined): T[] {
  return carriles.filter((l) => esMiRuta(mio, l.key));
}

/** Lo que va rotulado con el nombre de un chofer y solo me toca si es el mío: el camión en vivo del mapa, y el aviso de que
 *  un teléfono en turno dejó de reportar (dónde está un compañero, o que se le murió la batería, no es asunto del chofer). */
export function soloLoMioPorChofer<T extends { driver: string }>(cosas: readonly T[], mio: string | null | undefined): T[] {
  return cosas.filter((c) => esMiRuta(mio, c.driver));
}
