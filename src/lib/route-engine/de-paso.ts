/**
 * «Entregar lo que está de paso» (D-464): el criterio de CARGA TRANSPORTADA, común al Optimizar de una ruta
 * (`optimiza-la-ruta.ts`) y al motor de «Armar rutas» (`planifica.ts`).
 *
 * El dueño, 2026-10-02, con la ruta de Julio (recoge 3 pallets en Pharr para Weslaco y 1 en Brownsville para Pharr; el plan
 * la dejó P1 P2 D1 D2: bajar a Brownsville con los 3 pallets de Weslaco a bordo y entregarlos a la vuelta): «si recoje en
 * pharr porque pharr va a ir hasta brownville recoger y despues entregar en weslaco, yo se que sale mejor a la venida pero
 * si es una vuelta tan larga como bajar a browville y no hay mas ordenes que entregue en weslaco de un solo ahi seria p1 d1
 * p2 d2 eso es lo mas eficiente». Los dos lazos miden casi lo mismo (100 contra 102 minutos al volante, 102,8 contra 104,9
 * millas); lo que los separa es que uno pasea 3 pallets 92 millas y el otro 12.
 *
 * El criterio: la carga transportada es la suma, tramo a tramo, de los pallets a bordo por las millas del tramo
 * (pallet·milla). Va DESPUÉS de todo lo demás —exceso de capacidad, retraso, jornada, millas— y solo decide entre órdenes
 * que miden CASI lo mismo: dentro de una banda alrededor del mejor orden (el de menos jornada y millas), gana el que menos
 * carga pasea; fuera de ella, manda la jornada. Nunca se acepta más exceso ni más retraso por esto.
 *
 * La banda, medida sobre las 37 rutas reales de D-461 y la de Julio (DECISIONS.md, D-464): hasta un 5 % más de jornada
 * —y nunca más de 15 minutos— y hasta 3 millas más. La de Julio está a 2 minutos (1,3 %) y 2 millas; con un 3 % se
 * perdía la ruta del 2026-09-28 (+12 minutos y 2 millas por no pasear 659 pallet·milla). Es una BANDA y no un orden entre
 * dos listas a propósito (A gana a B por carga, B a C por carga, C a A por jornada): las búsquedas la usan anclada al
 * mejor orden encontrado, nunca como criterio de un paso a otro, y así terminan.
 */

import type { ToleranciaDePaso } from "./types";

export const TOLERANCIA_DE_PASO: ToleranciaDePaso = {
  /** Hasta cuánto más puede durar la jornada, en tanto por ciento de la del mejor orden. */
  porcientoDeJornada: 5,
  /** Y nunca más de estos minutos: en una jornada de nueve horas, el 5 % serían 27, más que lo que pidió ninguna ruta real. */
  maxMin: 15,
  /** Hasta cuántas millas más. */
  millas: 3,
};

export type { ToleranciaDePaso } from "./types";

/** Lo mínimo que tiene que bajar la carga paseada para que un orden de la banda desplace al mejor: un pallet·milla. Sin
 *  esto, una ruta real de 12 órdenes cambiaba de orden y duraba un minuto más por pasear 0,1 pallet·milla menos. */
export const MARGEN_PALLET_MI = 1;

/** Los minutos de más que caben en la banda, para una jornada de `jornadaMin` minutos. Con 0 %, ninguno: solo a empate. */
export function minutosDeBanda(jornadaMin: number, t: ToleranciaDePaso = TOLERANCIA_DE_PASO): number {
  return Math.max(0, Math.min(Math.round(t.maxMin), Math.round((Math.max(0, jornadaMin) * t.porcientoDeJornada) / 100)));
}

/** Las centésimas de milla de más que caben en la banda. */
export function centiMillasDeBanda(t: ToleranciaDePaso = TOLERANCIA_DE_PASO): number {
  return Math.max(0, Math.round(t.millas * 100));
}

/** ¿`jornadaMin`/`centiMillas` están dentro de la banda de `ref`? (Lo que no es jornada ni millas —exceso, retraso— se compara fuera.) */
export function enLaBanda(jornadaMin: number, centiMillas: number, ref: { jornadaMin: number; centiMillas: number }, t: ToleranciaDePaso = TOLERANCIA_DE_PASO): boolean {
  return jornadaMin <= ref.jornadaMin + minutosDeBanda(ref.jornadaMin, t) && centiMillas <= ref.centiMillas + centiMillasDeBanda(t);
}

/** La carga transportada de una ruta, en pallet·milla: cada tramo, lo que iba a bordo por las millas. */
export function cargaTransportada(tramos: readonly { cargaABordo: number; millas: number }[]): number {
  let s = 0;
  for (const t of tramos) s += Math.max(0, t.cargaABordo) * t.millas;
  return Math.round(s * 100) / 100;
}
