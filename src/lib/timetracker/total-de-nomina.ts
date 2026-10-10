// ============================================================
// Cuánto se paga: la aritmética del total de nómina, en UN solo sitio (D-NEXT).
//
// La misma pregunta —cuánto se le pagó a esta persona esta semana— se respondía con dos fórmulas
// distintas: la del gerente (`ManagerReports`) sumaba los ajustes y la de «Mi semana» no.
//
// Y no es un detalle de pintura: **`total` NO incluye los ajustes.** El bono, el adelanto y la
// deducción viven aparte, en `adjustments` (ver `Payroll` en `types.ts`), y así se escribe la fila
// al marcar pagado — `total` es solo el dinero de las horas. Así que `total` a secas se queda
// corto con un bono y **se pasa con una deducción**, y como las dos cifras se formatean a dos
// decimales, se ven igual de limpias y no cuadran. Hallazgo C-2 de `docs/AUDIT-2026-10-09.md`.
//
// Lo que ve el gerente es lo correcto y no cambia: estas funciones son su fórmula movida aquí tal
// cual, con sus `|| 0` incluidos. Lo que cambia es que «Mi semana» llame a la misma.
// ============================================================

import type { PayrollAdjustment } from "@/lib/timetracker/types";

/**
 * Lo que hace falta de una fila de nómina para saber cuánto se pagó. Un `Payroll` entero encaja;
 * se pide lo justo para que esto no dependa del resto de la fila (ni de la pantalla que lo tenga
 * a medio rellenar).
 */
export type LoteDeNomina = {
  total?: number | null;
  adjustments?: PayrollAdjustment[] | null;
};

/**
 * La suma de los ajustes de un lote: un bono suma, una deducción (importe negativo) resta.
 *
 * El `Number(a.amount || 0)` viene tal cual del `adjOf` de `ManagerReports` y se conserva a
 * propósito: la columna es `jsonb` y puede traer lo que se guardara en su día. Un importe que no
 * sea un número da `NaN`, el `NaN` se arrastra al total y `money()` lo pinta como «0.00», porque
 * `NaN || 0` es `0`. Es un defecto heredado —está probado como tal, para que se vea— y
 * arreglarlo cambiaría la cifra del gerente, que hoy es la buena: no se toca aquí.
 */
export function sumaDeAjustes(list: PayrollAdjustment[] | null | undefined): number {
  return (list || []).reduce((n, a) => n + Number(a.amount || 0), 0);
}

/**
 * La ÚNICA suma de este cálculo: una base en dinero más sus ajustes.
 *
 * La base es lo que lleve el grupo que se esté mirando: el `total` de un lote ya cerrado, o el
 * pago calculado de las horas de un grupo abierto. Quien decide eso es la pantalla; que se sumen
 * los ajustes, no.
 */
export function totalConAjustes(base: number, list: PayrollAdjustment[] | null | undefined): number {
  return base + sumaDeAjustes(list);
}

/**
 * Lo que de verdad se pagó en un lote: su `total` más sus ajustes.
 *
 * Es la respuesta que tienen que dar las dos pantallas para la misma fila. `total || 0` porque
 * una fila de ajuste suelto (el borrador que crea `addAdjustment`) no trae total.
 */
export function totalPagado(b: LoteDeNomina | null | undefined): number {
  return totalConAjustes(b?.total || 0, b?.adjustments);
}
