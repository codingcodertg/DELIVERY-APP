// La hoja semanal de horas, la de Excel: una fila por día de la semana de pago, con el turno partido
// en tramos (entrada → salida a comer → regreso → salida).
//
// Pura: no toca la base ni el DOM. Cada tramo es un fichaje (`clock_in`/`clock_out`), y sus minutos
// salen de `entryMinutes`, la misma función que usa `summarize` (la tabla de Nómina y el Excel de
// siempre). Así el total de la hoja de una persona y una semana es exactamente el total que enseña la
// tabla de «Hojas de tiempo» para ese periodo: nunca hay dos aritméticas.
//
// Un tramo abierto (sin salida) suma 0 y deja `abierta` en true, igual que `summarize`: la hoja no
// cuenta las horas hasta «ahora» porque la tabla tampoco lo hace.

import { entryMinutes, type PayEntry } from "@/lib/clockin/payroll";
import type { DiaDeTurnos } from "@/lib/clockin/turnos-por-dia";

export type FilaDeLaHoja = {
  /** Día de Texas, `YYYY-MM-DD`. */
  dia: string;
  /** ISO del primer fichaje de entrada del día. */
  entrada: string | null;
  /** ISO de la primera salida, SOLO si después hay otro tramo ese día. */
  salidaAComer: string | null;
  /** Minutos del primer tramo (`salidaAComer − entrada`); 0 si no hubo pausa. */
  trabajoManana: number;
  /** ISO del inicio del último tramo (el regreso de la comida); null si hubo un solo tramo. */
  regresoDeComer: string | null;
  /** Minutos fuera: la suma de TODOS los huecos entre tramos del día. */
  fuera: number;
  /** ISO de la última salida; null si el último tramo sigue abierto. */
  salida: string | null;
  /** Minutos trabajados después de la primera pausa (o todo el día si no hubo pausa). */
  trabajoTarde: number;
  /** Minutos trabajados en el día: la suma de todos sus tramos. */
  total: number;
  /** Cuántos tramos tuvo el día (1 = sin pausa, 2 = lo normal, 3+ = varias pausas). */
  tramos: number;
  /** Hay un tramo sin salida. */
  abierta: boolean;
  /** El día no tiene ningún fichaje. */
  sinFichaje: boolean;
};

export type HojaDeLaSemana = { filas: FilaDeLaHoja[]; total: number; limite: number; sobre: boolean };

const SIN_FICHAJE = (dia: string): FilaDeLaHoja => ({
  dia, entrada: null, salidaAComer: null, trabajoManana: 0, regresoDeComer: null, fuera: 0,
  salida: null, trabajoTarde: 0, total: 0, tramos: 0, abierta: false, sinFichaje: true,
});

/** Minutos entre la salida de un tramo y la entrada del siguiente; 0 si no hay salida o no hay hueco. */
function huecoEntre(anterior: PayEntry, siguiente: PayEntry): number {
  if (!anterior.clock_out_at) return 0;
  const min = (Date.parse(siguiente.clock_in_at) - Date.parse(anterior.clock_out_at)) / 60000;
  return min > 0 ? min : 0;
}

function filaDelDia(dia: string, d: DiaDeTurnos | undefined): FilaDeLaHoja {
  const tramosDelDia = d?.entradas ?? [];
  if (tramosDelDia.length === 0) return SIN_FICHAJE(dia);

  const primero = tramosDelDia[0];
  const ultimo = tramosDelDia[tramosDelDia.length - 1];
  const hayPausa = tramosDelDia.length > 1;

  const trabajoManana = hayPausa ? entryMinutes(primero) : 0;
  const trabajoTarde = hayPausa
    ? tramosDelDia.slice(1).reduce((s, e) => s + entryMinutes(e), 0)
    : entryMinutes(primero);
  let fuera = 0;
  for (let i = 0; i < tramosDelDia.length - 1; i++) fuera += huecoEntre(tramosDelDia[i], tramosDelDia[i + 1]);

  return {
    dia,
    entrada: primero.clock_in_at,
    salidaAComer: hayPausa ? primero.clock_out_at : null,
    trabajoManana,
    regresoDeComer: hayPausa ? ultimo.clock_in_at : null,
    fuera,
    salida: ultimo.clock_out_at,
    trabajoTarde,
    total: trabajoManana + trabajoTarde,
    tramos: tramosDelDia.length,
    abierta: tramosDelDia.some((e) => !e.clock_out_at),
    sinFichaje: false,
  };
}

/**
 * La hoja de una persona para una semana: un renglón por cada día de `semana` (los 7 días, en
 * orden), con sus tramos. `dias` son los días de la persona (`turnosPorDia`); los que no caen en
 * la semana se ignoran. `limiteMin` es el umbral semanal de horas extra (en minutos).
 */
export function hojaDeLaSemana(dias: readonly DiaDeTurnos[], semana: readonly string[], limiteMin: number): HojaDeLaSemana {
  const porDia = new Map(dias.map((d) => [d.dia, d]));
  const filas = semana.map((dia) => filaDelDia(dia, porDia.get(dia)));
  const total = filas.reduce((s, f) => s + f.total, 0);
  return { filas, total, limite: limiteMin, sobre: total > limiteMin };
}

/** Minutos → `H:MM`: 482 → "8:02", 0 → "0:00", 3142 → "52:22". Negativos y decimales se redondean a cero o al minuto. */
export function hmm(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
