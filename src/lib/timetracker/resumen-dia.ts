import type { Screenshot } from "./types";

/**
 * Resumen del día y «horas bajas» de la vista Auditoría → Capturas de escritorio (D-NEXT).
 *
 * El modelo de datos que hay detrás (medido en el código, no supuesto):
 *
 * - Cada fila de `timetracker.screenshots` es UN intervalo de captura de la app de escritorio
 *   (`screenshotIntervalMin`, 10 min por defecto). El escritorio dispara un `onShot` por
 *   intervalo: o trae la imagen con su `activity_percent` (0-100, entero), o trae `blank`, y
 *   entonces se inserta una fila marcador con `path = null`, `no_activity = true` y
 *   `activity_percent = 0` (`insertBlankScreenshot`, migración 059: «a 10-min segment with no
 *   keyboard/mouse activity gets a marker row»).
 * - Por eso la media simple de las filas es una media ponderada por tiempo: todas pesan lo mismo
 *   porque todas cubren lo mismo. No hace falta otra cuenta.
 * - La hora de una fila es la hora de reloj LOCAL de `taken_at` (`getHours()`), exactamente como
 *   `WorkDiary` agrupa los bloques que el auditor ve debajo. Si aquí se agrupara distinto, «08:00
 *   fue baja» no casaría con el bloque 08:00 de la pantalla.
 *
 * Decisiones que están aquí y no en la pantalla:
 *
 * - Un marcador de «sin actividad» CUENTA como muestra al 0 %: el cronómetro corría y nadie tocó
 *   nada, que es justo lo que la estadística quiere enseñar. (`WorkDiary` oculta las horas que solo
 *   tienen marcadores porque no hay nada que mirar; aquí no se ocultan, porque son las más bajas.)
 * - Una hora parcial (se empezó a las 08:40) se promedia con lo que tiene: las ranuras en las que
 *   no corría el cronómetro no son 0 %, son «no trabajaba».
 * - Una hora sin ninguna fila no es baja: es «sin datos». Se cuentan solo las que quedan ENTRE la
 *   primera y la última hora con datos (el hueco de la comida), no las 24 del día.
 * - Se compara la media SIN redondear contra el umbral, y lo que se enseña se redondea hacia abajo:
 *   9,6 % es una hora baja y se enseña «9 %», nunca «10 %» al lado de «<10 %».
 */

/** Por debajo de este porcentaje (estricto) una hora cuenta como «baja». Exactamente 10 no lo es. */
export const UMBRAL_HORA_BAJA_PCT = 10;

export type MuestraActividad = Pick<Screenshot, "takenAt" | "path" | "activityPercent">;

export interface HoraActividad {
  /** Hora de reloj, 0-23. */
  hora: number;
  /** Media sin redondear de las muestras de esa hora. */
  media: number;
  muestras: number;
}

export interface ResumenDia {
  segundosTrabajados: number;
  /** Media del día redondeada hacia abajo; `null` si no hay ninguna muestra. */
  actividadMediaPct: number | null;
  /** Capturas reales (con imagen), el mismo criterio que usa `WorkDiary` para contarlas. */
  capturas: number;
  /** Marcadores de intervalo sin actividad. */
  sinActividad: number;
  primeraMs: number | null;
  ultimaMs: number | null;
  horas: HoraActividad[];
  horasBajas: HoraActividad[];
  horasSinDatos: number[];
}

/** El porcentaje de una muestra, acotado a 0-100 como lo pinta `WorkDiary`. */
export function pctDeMuestra(s: Pick<MuestraActividad, "activityPercent">): number {
  const n = Number(s.activityPercent);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Redondeo de lo que se enseña: hacia abajo, para no cruzar nunca el umbral al pintarlo. */
export function pctEntero(media: number): number {
  return Math.floor(media);
}

export function esHoraBaja(media: number): boolean {
  return media < UMBRAL_HORA_BAJA_PCT;
}

function msDe(s: MuestraActividad): number | null {
  if (!s.takenAt) return null;
  const ms = new Date(s.takenAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const horaLocal = (ms: number) => new Date(ms).getHours();

/** Media por hora de reloj, solo de las horas que tienen alguna muestra, en orden. */
export function actividadPorHora(muestras: MuestraActividad[], horaDe: (ms: number) => number = horaLocal): HoraActividad[] {
  const acc = new Map<number, { suma: number; n: number }>();
  for (const s of muestras) {
    const ms = msDe(s);
    if (ms === null) continue;
    const h = horaDe(ms);
    const a = acc.get(h) ?? { suma: 0, n: 0 };
    a.suma += pctDeMuestra(s);
    a.n += 1;
    acc.set(h, a);
  }
  return [...acc.entries()]
    .map(([hora, a]) => ({ hora, media: a.suma / a.n, muestras: a.n }))
    .sort((a, b) => a.hora - b.hora);
}

/** Las horas entre la primera y la última con datos que no tienen ninguna muestra. */
export function horasSinDatosEntre(horas: HoraActividad[]): number[] {
  if (horas.length < 2) return [];
  const con = new Set(horas.map((h) => h.hora));
  const out: number[] = [];
  for (let h = horas[0].hora + 1; h < horas[horas.length - 1].hora; h++) if (!con.has(h)) out.push(h);
  return out;
}

/**
 * El resumen entero. `muestras` son las filas de UN empleado en UN día (las que `WorkDiary` ya
 * filtró como `dayShots`); `segundosTrabajados` es el total que la pantalla ya calcula de las
 * sesiones — no se recalcula aquí.
 */
export function resumenDelDia(muestras: MuestraActividad[], segundosTrabajados: number, horaDe: (ms: number) => number = horaLocal): ResumenDia {
  const conHora = muestras.filter((s) => msDe(s) !== null);
  const horas = actividadPorHora(conHora, horaDe);
  const suma = conHora.reduce((n, s) => n + pctDeMuestra(s), 0);
  const reales = conHora.filter((s) => !!s.path);
  const tiempos = reales.map((s) => msDe(s)!);
  return {
    segundosTrabajados: Math.max(0, segundosTrabajados || 0),
    actividadMediaPct: conHora.length ? pctEntero(suma / conHora.length) : null,
    capturas: muestras.filter((s) => !!s.path).length,
    sinActividad: muestras.filter((s) => !s.path).length,
    primeraMs: tiempos.length ? Math.min(...tiempos) : null,
    ultimaMs: tiempos.length ? Math.max(...tiempos) : null,
    horas,
    horasBajas: horas.filter((h) => esHoraBaja(h.media)),
    horasSinDatos: horasSinDatosEntre(horas),
  };
}
