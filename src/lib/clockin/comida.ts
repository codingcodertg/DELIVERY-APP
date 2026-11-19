import { centralWallToUtc, utcToCentralInput } from "./tz";

/**
 * La comida con horas exactas (inicio y fin) de un turno del parte de nómina.
 *
 * Una comida FICHADA ya es una fila de `clockin.exceptions` con `reason = 'lunch'`, `left_at` y
 * `returned_at` (ver `lib/clockin/payroll.ts`): esa es la ventana que cuenta para las horas, el
 * CSV, el XLSX, los talones y `timetracker.period_hours`. Este módulo es la única regla de qué
 * hace el admin con esa ventana al corregir un turno: validar las horas, calcular los minutos
 * de comida y las horas pagadas. El servidor (`actions/reports.ts`) y la pantalla usan lo mismo.
 *
 * Todas las horas que entran aquí son "YYYY-MM-DDTHH:MM" de Chicago (lo que da un
 * `<input type="datetime-local">`); se convierten a UTC con `centralWallToUtc`, que sabe del
 * horario de verano, así que la resta de dos horas el día del cambio sale bien.
 */

/** Una pausa fichada, en UTC (ISO), como la guarda `clockin.exceptions`. */
export type VentanaComida = { left: string; returned: string };

/** Lo que el admin escribe en el formulario, en hora de Chicago. */
export type TurnoBruto = {
  clockIn: string;
  /** null = fichaje abierto (solo se edita; el alta exige salida). */
  clockOut: string | null;
  /** Las dos juntas o ninguna. */
  lunchStart: string | null;
  lunchEnd: string | null;
};

export type TurnoValidado =
  | {
      ok: true;
      clockInAt: string;
      clockOutAt: string | null;
      /** null = sin comida. */
      comida: VentanaComida | null;
      comidaMin: number;
      /** null mientras el turno siga abierto. */
      pagadoMin: number | null;
    }
  | { ok: false; error: string };

// Los mensajes van en inglés, como el resto del formulario de esta pantalla.
const vacio = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

/** Hora de Chicago -> UTC ISO; null si el texto no es una fecha. */
function aUtc(local: string): string | null {
  try {
    const iso = centralWallToUtc(local);
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  } catch {
    return null;
  }
}

const minutos = (desde: string, hasta: string) => (Date.parse(hasta) - Date.parse(desde)) / 60000;

/**
 * Valida un turno y la comida que trae, y calcula lo que sale pagado.
 * `exigeSalida`: el alta sí, la edición no (un fichaje abierto se puede corregir sin salida).
 */
export function validaTurno(t: TurnoBruto, opciones: { exigeSalida: boolean }): TurnoValidado {
  const entrada = vacio(t.clockIn);
  const salida = vacio(t.clockOut);
  const inicio = vacio(t.lunchStart);
  const fin = vacio(t.lunchEnd);

  if (!entrada) return { ok: false, error: "Clock in is required." };
  if (opciones.exigeSalida && !salida) return { ok: false, error: "Clock out is required." };
  if (!!inicio !== !!fin) return { ok: false, error: "Enter both lunch start and lunch end, or neither." };

  const clockInAt = aUtc(entrada);
  if (!clockInAt) return { ok: false, error: "Clock in is not a valid date and time." };
  let clockOutAt: string | null = null;
  if (salida) {
    clockOutAt = aUtc(salida);
    if (!clockOutAt) return { ok: false, error: "Clock out is not a valid date and time." };
    if (minutos(clockInAt, clockOutAt) <= 0) return { ok: false, error: "Clock out must be after clock in." };
  }

  let comida: VentanaComida | null = null;
  let comidaMin = 0;
  if (inicio && fin) {
    const left = aUtc(inicio);
    const returned = aUtc(fin);
    if (!left || !returned) return { ok: false, error: "Lunch start or lunch end is not a valid date and time." };
    if (minutos(left, returned) <= 0) return { ok: false, error: "Lunch end must be after lunch start." };
    const antesDeEntrar = minutos(left, clockInAt) > 0;
    const despuesDeSalir = clockOutAt !== null && minutos(clockOutAt, returned) > 0;
    if (antesDeEntrar || despuesDeSalir) return { ok: false, error: "Lunch must be inside the shift." };
    comida = { left, returned };
    comidaMin = Math.round(minutos(left, returned));
  }

  const pagadoMin = clockOutAt ? Math.max(0, Math.round(minutos(clockInAt, clockOutAt)) - comidaMin) : null;
  return { ok: true, clockInAt, clockOutAt, comida, comidaMin, pagadoMin };
}

/** Minutos de comida que suman varias ventanas (una persona puede haber salido a comer dos veces). */
export function minutosDeVentanas(ventanas: VentanaComida[]): number {
  return Math.round(ventanas.reduce((a, v) => a + minutos(v.left, v.returned), 0));
}

/**
 * Cómo se muestra la comida de un turno existente en el formulario:
 *  - `horas`: 0 ventanas (los campos quedan vacíos) o 1 ventana (sus horas, en Chicago).
 *  - `minutos`: sin ventana pero con `lunch_minutes` (un turno viejo): se sigue editando en minutos
 *    para no tirar esa comida sin querer.
 *  - `varias`: más de una ventana: el formulario no las toca (se ven en la fila).
 */
export type ModoComida =
  | { modo: "horas"; lunchStart: string; lunchEnd: string }
  | { modo: "minutos"; minutos: number }
  | { modo: "varias"; minutos: number };

export function modoDeComida(e: { lunch_minutes: number | null; lunch_windows?: VentanaComida[] | null }): ModoComida {
  const ventanas = e.lunch_windows ?? [];
  if (ventanas.length > 1) return { modo: "varias", minutos: minutosDeVentanas(ventanas) };
  if (ventanas.length === 1) {
    return { modo: "horas", lunchStart: utcToCentralInput(ventanas[0].left), lunchEnd: utcToCentralInput(ventanas[0].returned) };
  }
  if ((e.lunch_minutes ?? 0) > 0) return { modo: "minutos", minutos: e.lunch_minutes as number };
  return { modo: "horas", lunchStart: "", lunchEnd: "" };
}

/** Lo que el formulario de la pantalla tiene escrito. `lunch` son minutos (modo `minutos`, o el total en `varias`). */
export type BorradorTurno = {
  clockIn: string;
  clockOut: string;
  modo: ModoComida["modo"];
  lunch: number;
  lunchStart: string;
  lunchEnd: string;
  note: string;
};

/** Lo que se ve bajo el formulario mientras se escribe: el error, o los minutos de comida y las horas pagadas. */
export function resumenDelBorrador(b: BorradorTurno, exigeSalida: boolean): { error: string | null; comidaMin: number; pagadoMin: number | null } {
  const horas = b.modo === "horas";
  const v = validaTurno(
    { clockIn: b.clockIn, clockOut: b.clockOut || null, lunchStart: horas ? b.lunchStart || null : null, lunchEnd: horas ? b.lunchEnd || null : null },
    { exigeSalida },
  );
  if (!v.ok) return { error: v.error, comidaMin: 0, pagadoMin: null };
  if (horas) return { error: null, comidaMin: v.comidaMin, pagadoMin: v.pagadoMin };
  const comidaMin = b.lunch;
  return { error: null, comidaMin, pagadoMin: v.pagadoMin === null ? null : Math.max(0, v.pagadoMin - comidaMin) };
}

/**
 * Lo que se manda al servidor. En modo `horas` van las horas (también vacías, que quita la comida).
 * En `minutos` y `varias` NO van las horas: el servidor entonces no toca las pausas fichadas.
 */
export function pagoDeComida(b: BorradorTurno): { lunch: number; lunchStart?: string | null; lunchEnd?: string | null } {
  if (b.modo !== "horas") return { lunch: b.lunch };
  const r = resumenDelBorrador(b, false);
  return { lunch: r.comidaMin, lunchStart: b.lunchStart || null, lunchEnd: b.lunchEnd || null };
}
