import { conAcciones, conCabecera, type ModoDeTarjeta } from "@/lib/gestor/cuadricula";

/**
 * D-655. «🚚 10»: la capacidad del camión de cada ruta es un botón, no un campo. El dueño, 2026-10-23 (dictado, literal):
 * «eso de capacidad de camión, eso lo vamos a hacer como un botón. Y eso va a ser general también para otra vista. Que va a
 * ser el botón, simplemente va a ser el emoji del camión. Y apretando ese emoji, ahí se va a cambiar. Ahí te va a preguntar un
 * poco cuál es la capacidad. Entonces va a decir el camioncito y el número 10.»
 *
 * Hasta aquí era «🚚 CAPACIDAD DEL CAMIÓN [10] TRM» (TRM = tarimas, la unidad; en inglés «plt»), un campo que guardaba en
 * cada tecla. El botón guarda por el MISMO camino (`setCapacity` del Gestor → `settings.driver_capacity`), una vez, al pulsar
 * «Guardar».
 */

/** Qué ve cada tarjeta: el botón que se pulsa, el número sin botón, o nada. */
export type BotonDelCamion = "pulsable" | "fijo" | null;

/**
 * Pulsable donde había campo: la tarjeta con botones (`conAcciones`). Quien no puede cambiar nada (solo lectura) ve el número
 * sin poder pulsarlo, donde la tarjeta lleva su cabecera (la desplegada de «Cuadrícula» no repite lo de la compacta, D-482).
 * La compacta de quien SÍ puede cambiarla no lo lleva: se cambia en su desplegada, como el campo de antes.
 */
export function botonDelCamion(soloLectura: boolean, modo: ModoDeTarjeta): BotonDelCamion {
  if (conAcciones(soloLectura, modo)) return "pulsable";
  return soloLectura && conCabecera(modo) ? "fijo" : null;
}

/** Lo escrito, como capacidad: un número mayor que 0 (lo mismo que aceptaba el campo, `v > 0`), o `null`. */
export function capacidadEscrita(texto: string): number | null {
  const v = Number(texto.trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Lo que guarda «Guardar»: lo escrito si vale y es otra capacidad; `null` si no hay nada que guardar. Guardar la misma no
 * llama al guardado: `setCapacity` borra la ruta medida del chofer (`clearRouteFor`), y no hay por qué volver a medirla.
 */
export function capacidadAGuardar(texto: string, actual: number): number | null {
  const v = capacidadEscrita(texto);
  return v != null && v !== actual ? v : null;
}
