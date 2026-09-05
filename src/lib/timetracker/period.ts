/**
 * El periodo de pago de Nómina: de VIERNES a jueves, en hora de la empresa (Chicago).
 *
 * Vivía dentro de `payroll/page.tsx` y `period.test.ts` la REIMPLEMENTABA para probarla, con
 * lo que la prueba no protegía nada (D-NEXT). Se mueve aquí para que la página y la prueba
 * llamen a la misma función. **No se cambió el cálculo**: es el mismo cuerpo que tenía la
 * página. Que exista además `payPeriodDates` en `lib/clockin/schedule.ts` (la del módulo de
 * fichaje) y el `date_trunc` de la vista `period_hours` es deuda conocida; unificarlas es
 * tocar la aritmética de lo que se paga y va en su propia rama.
 */

/** El viernes del periodo que contiene esa fecha, en hora de la empresa. */
export function periodStartOf(d: Date): string {
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const sinceFriday = (local.getDay() - 5 + 7) % 7;
  local.setDate(local.getDate() - sinceFriday);
  return local.toISOString().slice(0, 10);
}

/** `iso` más `days` días, en calendario, sin husos. */
export function shift(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
