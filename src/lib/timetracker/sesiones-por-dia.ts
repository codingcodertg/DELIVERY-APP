// Las sesiones remotas de una persona, agrupadas por día (Nómina · Remoto).
//
// Pura: no toca la base ni el DOM. Es el mismo papel que `turnosPorDia` tiene para el fichaje:
// una fila por día, con su entrada y su salida, y la duración sumada de sus tramos. Los totales
// de la pantalla no pasan por aquí; esto solo agrupa para pintar.
//
// El día es el campo `date` de la sesión cuando lo trae; si no, el día de Texas de su inicio.
// Así una sesión de las 11:30 pm hora de Texas cae en el día en que empezó.

import type { Session } from "@/lib/timetracker/types";
import { diaDeTexas } from "@/lib/clockin/turnos-por-dia";

export type DiaDeSesiones = {
  /** Día calendario, `YYYY-MM-DD`. */
  dia: string;
  /** Las sesiones del día, por inicio (ascendente). */
  sesiones: Session[];
  /** Inicio más temprano del día (ms). */
  primerInicio: number;
  /** Fin más tardío entre las sesiones cerradas, o `null` si ninguna tiene fin (en vivo). */
  ultimoFin: number | null;
  /** Suma de `durationSeconds` de las sesiones del día. */
  segundos: number;
};

function diaDeSesion(s: Session): string {
  if (s.date) return s.date;
  return s.startMs != null ? diaDeTexas(new Date(s.startMs).toISOString()) : "";
}

export function sesionesPorDia(sesiones: readonly Session[]): DiaDeSesiones[] {
  const porDia = new Map<string, Session[]>();
  for (const s of sesiones) {
    const dia = diaDeSesion(s);
    const lista = porDia.get(dia);
    if (lista) lista.push(s);
    else porDia.set(dia, [s]);
  }

  const dias: DiaDeSesiones[] = [];
  for (const [dia, lista] of porDia) {
    const delDia = [...lista].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
    const fines = delDia.map((s) => s.endMs).filter((f): f is number => f != null);
    dias.push({
      dia,
      sesiones: delDia,
      primerInicio: delDia[0].startMs ?? 0,
      ultimoFin: fines.length ? Math.max(...fines) : null,
      segundos: delDia.reduce((n, s) => n + (s.durationSeconds || 0), 0),
    });
  }
  return dias.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
}
