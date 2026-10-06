/**
 * La vista «▦ Cuadrícula» de la pestaña «Rutas» del Gestor (D-481, e). El dueño, 2026-10-06 (dictado, literal): «in routes
 * wabing the grid view, hwhen you press tehe name of a driver idpslay on the buttom keeping the 3 drivers on the top and the
 * table will take the normal sicze and the actionable buttoms remove until the table is displayed».
 *
 * Hasta aquí «Cuadrícula» ponía las tarjetas enteras en dos columnas (D-459), cada una con su tabla estrecha y sus botones.
 * Ahora, en cuadrícula:
 *   · ARRIBA, en fila, una tarjeta COMPACTA por chofer: su nombre, sus números y sus pastillas. Sin tabla y sin botones.
 *   · Al pulsar el NOMBRE de un chofer, su tarjeta entera —con la tabla a tamaño normal y sus botones— se despliega ABAJO,
 *     a todo el ancho. Pulsar otro nombre cambia la de abajo; pulsar el mismo la pliega.
 *   · Los botones de acción (capacidad, deshacer, bloquear, optimizar, vaciar, flechas, «Pasar a…») solo existen en la
 *     tarjeta desplegada: mientras no haya tabla a la vista no hay nada que accionar.
 * La vista «▭ Ancho» no cambia: las tarjetas enteras, una debajo de otra, con su ▸ para plegar.
 */

/** Cómo se pinta una tarjeta de ruta: entera en «Ancho»; compacta arriba en «Cuadrícula»; desplegada abajo en «Cuadrícula». */
export type ModoDeTarjeta = "ancha" | "compacta" | "desplegada";

/** Pulsar el nombre: se despliega esa; si ya era esa, se pliega. */
export function alternaDesplegada(actual: string | null, clave: string): string | null {
  return actual === clave ? null : clave;
}

/** La desplegada que MANDA: solo si su tarjeta sigue en pantalla (cambió el día, el filtro, o se vació). */
export function desplegadaVigente(actual: string | null, rutasEnPantalla: readonly string[]): string | null {
  return actual != null && rutasEnPantalla.includes(actual) ? actual : null;
}

/** ¿Lleva la tarjeta sus botones de acción? Nunca en solo lectura; en cuadrícula, solo la desplegada. */
export function conAcciones(soloLectura: boolean, modo: ModoDeTarjeta): boolean {
  return !soloLectura && modo !== "compacta";
}

/** ¿Pinta la tarjeta su cuerpo (avisos y tabla)? La compacta nunca; la desplegada siempre; la ancha, si no está plegada. */
export function conCuerpo(modo: ModoDeTarjeta, plegada: boolean): boolean {
  if (modo === "compacta") return false;
  if (modo === "desplegada") return true;
  return !plegada;
}

/**
 * ¿Lleva la tarjeta su cabecera (nombre, pastillas, números)? La desplegada NO (D-482). El dueño, 2026-10-06, con captura del
 * nombre repetido arriba y abajo: «si yo abro este conductos quiero que este pegado como una animacion tipo apple y ahi si no va
 * a haber doble nmbre y cosas». El nombre y los números ya están en su tarjeta compacta, que queda pegada encima.
 */
export function conCabecera(modo: ModoDeTarjeta): boolean {
  return modo !== "desplegada";
}

/**
 * Las clases de la tarjeta (D-482): la compacta abierta se marca (`tarjeta-abierta`, con su pico hacia abajo) y la desplegada
 * entra pegada a ella con la animación de abrir (`tarjeta-desplegada`). Ver `globals.css`.
 */
export function claseDeTarjeta(modo: ModoDeTarjeta, abierta: boolean): string {
  if (modo === "desplegada") return "card tarjeta-desplegada";
  if (modo === "compacta" && abierta) return "card tarjeta-abierta";
  return "card";
}
