/**
 * Reglas puras del cron del fichaje (`timetracker/clock-in/api/cron`) que deciden SI hay algo que hacer en esta
 * corrida, y a quién hay que consultar. Sin red ni base: se prueban solas.
 *
 * El cron corre cada dos minutos. La mayoría de las veces no hay ningún aviso que mandar: se pide solo lo mínimo para
 * saberlo (turnos de hoy, turnos abiertos, ausencias) y, si no hay nada, se sale antes de leer las siete tablas
 * pesadas. Cada condición de aquí es una SUPERCONJUNTO de la regla que la usa en la ruta: si la regla puede disparar,
 * esta devuelve `true`. Nunca al revés.
 */

/** «HH:MM» o «HH:MM:SS» → minutos desde medianoche. */
export function parseHM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export interface TurnoDeHoy {
  employee_id: string;
  start_time: string;
  end_time: string;
  lunch_start_time: string | null;
}

/**
 * ¿Puede disparar alguna regla de ESTE turno en este minuto (hora de Central)? Mira solo el tiempo; no mira si la
 * persona está fichada, que es lo que las reglas añaden. Por eso es un superconjunto: si da `false`, ninguna regla
 * del turno dispara, con o sin fichaje.
 */
export function turnoPuedeDisparar(t: TurnoDeHoy, nowMin: number): boolean {
  const s = parseHM(t.start_time);
  const e = parseHM(t.end_time);
  const l = t.lunch_start_time ? parseHM(t.lunch_start_time) : null;
  return (
    // shift_reminder: 28–31 min antes del inicio
    (s - nowMin > 28 && s - nowMin <= 31) ||
    // shift_now: desde el inicio hasta +5
    (nowMin >= s && nowMin <= s + 5) ||
    // not_clocked_in y alertas al manager: después de +6 y hasta el fin
    (nowMin > s + 6 && nowMin <= e) ||
    // shift_ending: los últimos 15 min
    (e - nowMin > 0 && e - nowMin <= 15) ||
    // lunch_reminder: entre 2 y 5 min antes del almuerzo
    (l !== null && l - nowMin > 2 && l - nowMin <= 5) ||
    // forgot_clockout: pasado el fin + 30
    nowMin > e + 30
  );
}

/**
 * Las ventanas de hora fija de los jueves (cierre de nómina: 9:00 y 14:00) y del domingo (la felicitación, 12:00),
 * en hora de Central, con sus 3 minutos de margen igual que en la ruta.
 */
export function ventanaSemanalAbierta(diaDeLaSemana: number, nowMin: number): boolean {
  if (diaDeLaSemana === 4) {
    return (nowMin >= 9 * 60 && nowMin <= 9 * 60 + 3) || (nowMin >= 14 * 60 && nowMin <= 14 * 60 + 3);
  }
  if (diaDeLaSemana === 0) return nowMin >= 12 * 60 && nowMin <= 12 * 60 + 3;
  return false;
}

/**
 * ¿Hay algo que hacer en esta corrida? `turnos` son los de hoy; `hayTurnoAbierto` es si existe algún fichaje abierto
 * (de cualquier día: el cierre de las 8 PM corre sobre todos); `hayAusencia` es si hay alguien fuera con regreso
 * previsto sin volver.
 */
export function hayTrabajoEnEstaCorrida(p: {
  turnos: readonly TurnoDeHoy[];
  hayTurnoAbierto: boolean;
  hayAusencia: boolean;
  diaDeLaSemana: number;
  nowMin: number;
}): boolean {
  if (p.hayTurnoAbierto || p.hayAusencia) return true;
  if (ventanaSemanalAbierta(p.diaDeLaSemana, p.nowMin)) return true;
  return p.turnos.some((t) => turnoPuedeDisparar(t, p.nowMin));
}

/**
 * Los empleados a quienes la corrida PUEDE avisar (y, por tanto, cuyas suscripciones push hacen falta): los de turno
 * de hoy, los que tienen fichaje abierto, los que están fuera, todos los managers y owners (reciben las alertas de la
 * empresa), y —en la ventana semanal— todos. Es un superconjunto: quien no está aquí nunca recibe un `send`.
 */
export function destinatariosPosibles(p: {
  turnos: readonly TurnoDeHoy[];
  abiertos: readonly string[];
  ausentes: readonly string[];
  managers: readonly string[];
  todos: readonly string[];
  enVentanaSemanal: boolean;
}): string[] {
  if (p.enVentanaSemanal) return [...new Set(p.todos)];
  return [
    ...new Set([
      ...p.turnos.map((t) => t.employee_id),
      ...p.abiertos,
      ...p.ausentes,
      ...p.managers,
    ]),
  ];
}
