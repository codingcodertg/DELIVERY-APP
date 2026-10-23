import { estaPlegada } from "@/lib/vista-del-gestor";

/**
 * D-653. Dos cosas del Gestor de Rutas que pidió el dueño el 2026-10-23 (dictado, literal): «Cuando yo elijo un driver, él
 * me abre la ruta, pero no me abre. Él solo me abre el mapa, pero no me abre la ruta de abajo. Entonces quiero que hayan dos
 * views […] full view y small view or efficient view».
 *
 * 1 · MARCAR UN CHOFER ABRE SU TABLA. Las casillas del panel «Choferes y rutas» son el filtro (D-481): marcar a Ernesto
 * dejaba en el mapa solo su ruta, pero su tabla de paradas seguía cerrada. Lo abierto vivía aparte —`desplegada` en
 * «▦ Cuadrícula» (D-481 e), `alternadas` en «▭ Ancho» (las tarjetas nacen plegadas, D-393)— y la casilla no lo tocaba: solo
 * lo abría pulsar el nombre de la tarjeta o su ▸. Ahora marcar (o pulsar la fila del panel) la abre, y desmarcar la cierra.
 *
 * 2 · «VISTA COMPLETA» Y «VISTA EFICIENTE». La completa es la de siempre. En la eficiente, las pestañas (Rutas, Sin asignar,
 * Todas, Tablero, Horario) suben a la fila de «Choferes y rutas», a su derecha, y debajo del mapa, pegada a él, va la tabla de
 * cada chofer marcado, como en la foto «📸 PNG» (D-636): todo en una pantalla, sin el desplegable por chofer. Se recuerda por
 * persona en este navegador, como lo marcado (D-481) y por la misma razón (D-393): la lista de claves de `user_prefs` está
 * cerrada en la base, y una clave nueva es una migración.
 */

export type VistaDelGestor = "completa" | "eficiente";

/** La de siempre: quien no ha elegido nada la sigue viendo igual. */
export const VISTA_POR_DEFECTO: VistaDelGestor = "completa";

/** La clave del navegador, por persona: dos personas en la misma computadora no se pisan la elección. */
export const claveDeLaVista = (userId: string): string => `rtg_routes_vista_${userId}`;

/** Lo guardado, o la completa. Un navegador sin almacenamiento, o que lo niega, es la completa: nunca un error a la vista. */
export function leeVista(leer: (clave: string) => string | null, userId: string): VistaDelGestor {
  try {
    return leer(claveDeLaVista(userId)) === "eficiente" ? "eficiente" : VISTA_POR_DEFECTO;
  } catch { return VISTA_POR_DEFECTO; }
}

/** Guarda la elección; la completa BORRA la clave, para que el defecto siga siendo el defecto. `almacen`, perezoso: en algunos
 *  navegadores leer `window.localStorage` ya lanza, y eso también cae en el `catch`. */
export function guardaVista(almacen: () => { setItem(k: string, v: string): void; removeItem(k: string): void }, userId: string, vista: VistaDelGestor): void {
  try {
    if (vista === "eficiente") almacen().setItem(claveDeLaVista(userId), "eficiente");
    else almacen().removeItem(claveDeLaVista(userId));
  } catch { /* sin almacenamiento, la elección dura lo que la pantalla */ }
}

/** Lo que está abierto en la vista completa: la desplegada de «Cuadrícula» y las tarjetas pulsadas de «Ancho». */
export interface LoAbierto {
  ancho: boolean;
  desplegada: string | null;
  alternadas: ReadonlySet<string>;
}

/**
 * La casilla (o la fila) del panel cambió `clave`: queda `marcada` o no. Marcada → su tabla abierta: en «Cuadrícula», la
 * desplegada abajo (con varias marcadas, la última que se marcó; las otras quedan en su tarjeta compacta); en «Ancho», su
 * tarjeta sin plegar. Desmarcada → se cierra, si estaba abierta. Lo demás no se toca.
 */
export function abreAlMarcar(abierto: LoAbierto, clave: string, marcada: boolean): { desplegada: string | null; alternadas: Set<string> } {
  const alternadas = new Set(abierto.alternadas);
  if (!abierto.ancho) {
    const desplegada = marcada ? clave : abierto.desplegada === clave ? null : abierto.desplegada;
    return { desplegada, alternadas };
  }
  // En «Ancho» abierta = no plegada; `alternadas` guarda las pulsadas, y una tarjeta de chofer nace plegada.
  if (estaPlegada(clave, alternadas) === marcada) {
    if (alternadas.has(clave)) alternadas.delete(clave); else alternadas.add(clave);
  }
  return { desplegada: abierto.desplegada, alternadas };
}
