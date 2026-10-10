import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Payroll, PayrollAdjustment } from "@/lib/timetracker/types";
import { sumaDeAjustes, totalConAjustes, totalPagado } from "./total-de-nomina";

// C-2 de `docs/AUDIT-2026-10-09.md`: «cuánto se pagó» se respondía con dos fórmulas distintas —la
// del gerente sumaba los ajustes y la de «Mi semana» no—, y `total` no los lleva dentro. Con un
// bono la cifra se queda corta; con una deducción, **se pasa**. Aquí se mide la fórmula, que ahora
// es una sola, y se lee el fuente de las dos pantallas para comprobar que las dos la llaman.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
const informes = sinComentarios(leer("src/components/timetracker/ManagerReports.tsx"));
const semana = sinComentarios(leer("src/app/timetracker/(timetracker)/week/page.tsx"));

const LOTE: Payroll = {
  id: "p1", employeeUid: "u1", employeeName: "Persona de prueba", weekOf: "2026-10-02", method: null,
  lines: [], adjustments: [], total: 0, paid: true, paidAt: "2026-10-09T15:00:00Z", paidBy: "u9",
  draft: false, sessionCount: 3, createdAt: "2026-10-09T15:00:00Z",
};
/** Un lote pagado con sus horas en `total` y sus ajustes aparte, como lo escribe `markPaid`. */
const lote = (total: number, adjustments: PayrollAdjustment[]): Payroll => ({ ...LOTE, total, adjustments });

const BONO: PayrollAdjustment = { label: "Bonus", amount: 150 };
const DEDUCCION: PayrollAdjustment = { label: "Deduction", amount: -120 };

describe("1 · la suma de los ajustes", () => {
  it("sin ajustes es 0, y una lista que no llegó tampoco inventa nada", () => {
    expect(sumaDeAjustes([])).toBe(0);
    expect(sumaDeAjustes(null)).toBe(0);
    expect(sumaDeAjustes(undefined)).toBe(0);
  });

  it("un bono suma y una deducción resta, que es el signo del importe", () => {
    expect(sumaDeAjustes([BONO])).toBe(150);
    expect(sumaDeAjustes([DEDUCCION])).toBe(-120);
    // Y juntos no se cancelan por el camino: tres ajustes, una sola cifra.
    expect(sumaDeAjustes([BONO, DEDUCCION, { label: "Advance", amount: -30 }])).toBe(0);
  });

  it("un importe guardado como texto cuenta igual: la columna es jsonb", () => {
    expect(sumaDeAjustes([{ label: "Bonus", amount: "25" as unknown as number }])).toBe(25);
  });

  it("un ajuste sin importe vale 0 y no contamina la suma de los demás", () => {
    // `Number(undefined)` es NaN, y un NaN se lleva por delante el total del grupo entero. El
    // `|| 0` del original está justo para eso; esto lo deja fijado.
    expect(sumaDeAjustes([{ label: "Bonus" } as PayrollAdjustment])).toBe(0);
    expect(sumaDeAjustes([BONO, { label: "Bonus" } as PayrollAdjustment])).toBe(150);
  });

  it("y un importe que no es un número da NaN — defecto heredado, escrito para que se vea", () => {
    // `Number("x")` es NaN y el NaN se arrastra al total; `money()` lo pinta «0.00» porque
    // `NaN || 0` es 0. Viene del `adjOf` original y NO se arregla aquí: cambiaría la cifra del
    // gerente, que es la que hoy está bien. Queda medido para quien venga a decidirlo.
    expect(sumaDeAjustes([{ label: "Bonus", amount: "doscientos" as unknown as number }])).toBeNaN();
    expect(totalPagado(lote(800, [{ label: "Bonus", amount: "doscientos" as unknown as number }]))).toBeNaN();
  });
});

describe("2 · el total es la base más sus ajustes, y la suma vive en un solo sitio", () => {
  it("la base sola cuando no hay ajustes", () => {
    expect(totalConAjustes(800, [])).toBe(800);
    expect(totalConAjustes(0, null)).toBe(0);
  });

  it("con bono sube y con deducción baja", () => {
    expect(totalConAjustes(800, [BONO])).toBe(950);
    expect(totalConAjustes(800, [DEDUCCION])).toBe(680);
  });

  it("de un lote, la base es su `total`", () => {
    expect(totalPagado(lote(800, [DEDUCCION]))).toBe(680);
    expect(totalPagado(lote(800, []))).toBe(800);
  });

  it("un borrador de ajuste suelto no trae total, y vale lo que su ajuste", () => {
    // `addAdjustment` crea la fila con `draft: true` y solo `adjustments`: sin esto el ajuste
    // suelto se leería como «no hay nada que pagar».
    expect(totalPagado({ adjustments: [BONO] })).toBe(150);
    expect(totalPagado({ total: null, adjustments: [DEDUCCION] })).toBe(-120);
  });

  it("sin lote, 0: no hay fila que pagar", () => {
    expect(totalPagado(null)).toBe(0);
    expect(totalPagado(undefined)).toBe(0);
    expect(totalPagado({})).toBe(0);
  });
});

describe("3 · la misma pregunta, la misma cifra en las dos pantallas (C-2)", () => {
  it("el `total` de la fila NO es lo que se pagó: con una deducción se pasa de 120", () => {
    const b = lote(800, [DEDUCCION]);
    expect(b.total).toBe(800);          // lo que «Mi semana» enseñaba
    expect(totalPagado(b)).toBe(680);   // lo que el gerente enseña, y ahora las dos
    expect(totalPagado(b)).not.toBe(b.total);
  });

  it("con un bono se queda corta, que es el mismo fallo del otro lado", () => {
    const b = lote(800, [BONO]);
    expect(totalPagado(b)).toBe(950);
    expect(totalPagado(b) - b.total).toBe(150);
  });

  it("dos pagos de la misma semana se suman uno a uno, con sus ajustes cada uno", () => {
    const pagados = [lote(800, [DEDUCCION]), lote(400, [BONO])];
    expect(pagados.reduce((n, b) => n + totalPagado(b), 0)).toBe(1230);
    // Sumar primero los totales y luego los ajustes daría lo mismo; sumar solo los totales, no.
    expect(pagados.reduce((n, b) => n + b.total, 0)).toBe(1200);
  });

  it("la fórmula del gerente para un lote cerrado es exactamente `totalPagado`", () => {
    // Lo que tenía escrito a mano: `(b ? b.total || 0 : pay) + adjOf(adjs)`, con `adjs` = los
    // ajustes del propio lote. Mismo lote, mismo número: por eso el lote cerrado llama aquí.
    const b = lote(800, [BONO, DEDUCCION]);
    expect(totalConAjustes(b.total || 0, b.adjustments)).toBe(totalPagado(b));
    expect(totalPagado(b)).toBe(830);
  });
});

describe("4 · y las dos pantallas llaman a esa función, no a una copia", () => {
  it("«Mi semana» suma lo pagado con `totalPagado`", () => {
    expect(semana).toContain('from "@/lib/timetracker/total-de-nomina"');
    expect(semana).toContain("reduce((n, b) => n + totalPagado(b), 0)");
    // El reduce de antes, el que se dejaba los ajustes fuera.
    expect(semana).not.toContain("n + (b.total || 0)");
  });

  it("Informes no tiene su propia `adjOf` ni su propia suma", () => {
    expect(informes).toContain('from "@/lib/timetracker/total-de-nomina"');
    expect(informes).not.toContain("adjOf");
    expect(informes).not.toContain("b.total || 0 : pay) +");
  });

  it("los tres sitios de Informes que daban el total de un grupo pasan por las mismas dos funciones", () => {
    // Se cuentan aquí en vez de afirmar un número de memoria: el CSV, la tarjeta del grupo y el
    // total por empleado. Si mañana hay un cuarto sitio, que sea con la misma llamada.
    const veces = informes.split("b ? totalPagado(b) : totalConAjustes(pay, adjs)").length - 1;
    expect(veces).toBe(3);
    expect(informes).toContain("const adjTotal = sumaDeAjustes(adjs);");
    expect(informes).toContain("const adj = sumaDeAjustes(adjs);");
  });

  it("y la suma `base + ajustes` está escrita una sola vez en todo el módulo", () => {
    const lib = sinComentarios(leer("src/lib/timetracker/total-de-nomina.ts"));
    expect(lib).toContain("return base + sumaDeAjustes(list);");
    expect(lib.split("sumaDeAjustes(").length - 1).toBe(2); // su definición y esa única llamada
    expect(lib).toContain("return totalConAjustes(b?.total || 0, b?.adjustments);");
  });
});
