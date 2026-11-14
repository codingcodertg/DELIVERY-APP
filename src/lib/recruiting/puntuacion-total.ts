/**
 * La puntuación total de la hoja de RR. HH. (Tot Score): Riesgo + Desempeño + Persona.
 *
 * Es una cuenta, no un dato: no se guarda (igual que el costo mensual). Las tres casillas llegan del formulario como
 * texto, así que se leen con `numeroDeFicha`, la misma regla que usa el servidor al guardar; así lo que se ve en el
 * total es lo que de verdad queda guardado.
 *
 *   · Casilla vacía = «falta». Cero sí cuenta: es una cifra.
 *   · Si las tres faltan, el total es null (la pantalla enseña «—»).
 *   · Si faltan algunas, se suman las que hay y `cuantas` dice cuántas son («2 de 3»).
 */

import { numeroDeFicha } from "./employee-file";

export type CifraDeHoja = string | number | null | undefined;

export interface PuntuacionTotal {
  /** La suma de las cifras que hay, redondeada a dos decimales; null si no hay ninguna. */
  total: number | null;
  /** Cuántas de las tres tienen cifra (0 a 3). */
  cuantas: number;
  /** Siempre 3: las tres partes de la hoja. */
  de: 3;
}

/** Una casilla a número, o null si está vacía o no es un número válido (se trata como «falta»). */
function cifraDe(v: CifraDeHoja): number | null {
  const n = numeroDeFicha(v);
  return typeof n === "number" ? n : null;
}

export function puntuacionTotal(hoja: { risk: CifraDeHoja; performance: CifraDeHoja; person: CifraDeHoja }): PuntuacionTotal {
  const cifras = [cifraDe(hoja.risk), cifraDe(hoja.performance), cifraDe(hoja.person)].filter((n): n is number => n !== null);
  if (!cifras.length) return { total: null, cuantas: 0, de: 3 };
  const suma = cifras.reduce((a, b) => a + b, 0);
  return { total: Math.round(suma * 100) / 100, cuantas: cifras.length, de: 3 };
}
