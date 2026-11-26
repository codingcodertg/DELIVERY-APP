import { describe, expect, it } from "vitest";
import {
  AJUSTES_POR_DEFECTO, ENTRADAS_POR_DEFECTO, calcular, type EntradasCalculadora, type Explicacion, type FilaCalculada,
  type ResultadoCalculadora,
} from "./calculadora-material";

const con = (patch: Partial<EntradasCalculadora>): EntradasCalculadora => ({ ...ENTRADAS_POR_DEFECTO, ...patch });
const correr = (patch: Partial<EntradasCalculadora> = {}): ResultadoCalculadora =>
  calcular(con(patch), AJUSTES_POR_DEFECTO);
const fila = (r: ResultadoCalculadora, clave: string): FilaCalculada => r.filas.find((f) => f.clave === clave)!;
/** Todo el texto de una explicación en inglés, para buscar cifras. */
const textoEn = (x: Explicacion) => [x.formula.en, ...x.pasos.map((p) => p.en), ...x.usa.map((u) => u.en), x.cierre.en].join("\n");
const textoEs = (x: Explicacion) => [x.formula.es, ...x.pasos.map((p) => p.es), ...x.usa.map((u) => u.es), x.cierre.es].join("\n");

const CLAVES = [
  "liner", "mortero", "tablero", "tornillos", "malla", "impermeable", "pegamento-pared", "pegamento-piso",
  "loseta-pared", "loseta-piso", "lechada-arenada", "lechada-sin-arena", "silicon", "perfil", "clips", "cunas", "coladera", "pendiente",
];

describe("cada fila trae su explicación, en inglés y en español", () => {
  const r = correr();

  it("las 18 filas y las 4 áreas tienen fórmula, pasos, entradas y cierre en las dos lenguas", () => {
    expect(r.filas.map((f) => f.clave)).toEqual(CLAVES);
    for (const f of r.filas) {
      const x = f.explicacion;
      expect(x.formula.en, f.clave).not.toBe("");
      expect(x.formula.es, f.clave).not.toBe("");
      expect(x.pasos.length, f.clave).toBeGreaterThan(0);
      expect(x.cierre.en, f.clave).not.toBe("");
      expect(x.cierre.es, f.clave).not.toBe("");
      for (const p of x.pasos) expect(p.es, f.clave).not.toBe("");
    }
    for (const x of Object.values(r.explicacionAreas)) {
      expect(x.formula.en).not.toBe("");
      expect(x.formula.es).not.toBe("");
      expect(x.pasos.length).toBeGreaterThan(0);
      expect(x.cierre.es).not.toBe("");
    }
  });
});

describe("valores por defecto (Shower, 5×3×8, 3 Walls)", () => {
  const r = correr();

  it("área de pared: la fórmula con las cifras y 91 SF", () => {
    const paso = r.explicacionAreas.paredSf.pasos[0].en;
    expect(paso).toBe("Wall area = 8 × (5 + 2 × 3) − 0 + 3 = 91 SF");
    expect(r.explicacionAreas.paredSf.formula.en).toContain("height × (length + 2 × width)");
  });

  it("loseta de pared: contiene 91 y 6 (91 ÷ 15.5 = 5.87 → 6 cajas)", () => {
    const x = fila(r, "loseta-pared").explicacion;
    expect(textoEn(x)).toContain("91");
    expect(x.cierre.en).toBe("91 SF ÷ 15.5 SF per box = 5.87 → rounded up = 6 boxes");
    expect(x.cierre.es).toBe("91 SF ÷ 15.5 SF por caja = 5.87 → redondeado hacia arriba = 6 cajas");
    expect(fila(r, "loseta-pared").venta).toBe(6);
  });

  it("tablero: 17.6 LF, 7 paneles y 21 LF a vender", () => {
    const x = fila(r, "tablero").explicacion;
    expect(x.pasos[0].en).toBe("(91 − 3) ÷ 5 ft = 17.6 LF");
    expect(x.cierre.en).toContain("7 panels");
    expect(x.cierre.en).toContain("21 LF to sell");
    expect(r.explicacionAreas.tablerosPaneles.pasos[1].en).toBe("6 + 1 extra = 7 panels");
  });

  it("lechada (D-1203): un paso por superficie con su rendimiento, y el cierre en bolsas", () => {
    const x = fila(r, "lechada-arenada").explicacion;
    expect(x.pasos).toHaveLength(2);
    expect(x.pasos[0].en).toMatch(/^wall 24x48, joint 0.125 in, depth 0.375 in: adjustment [\d.]+ → \d+ SF per bag; 91 SF ÷ \d+ = [\d.]+ bags$/);
    expect(x.pasos[1].es).toMatch(/^piso 12x24, junta 0.125 in/);
    expect(x.cierre.en).toMatch(/→ rounded up = 1 bag\. Sanded and unsanded are alternatives: sell one\.$/);
  });

  it("impermeable: (88 + 15) × (1 + 0) = 103 SF, 3 envases", () => {
    const x = fila(r, "impermeable").explicacion;
    expect(x.pasos[1].en).toBe("(88 + 15) × (1 + 0) = 103 SF");
    expect(x.cierre.en).toContain("= 2.58 → rounded up = 3 containers");
  });

  it("silicón: 11 + 8 × 2 = 27 LF, 2 tubos", () => {
    const x = fila(r, "silicon").explicacion;
    expect(x.pasos[0].en).toBe("Silicone = 11 + 8 × 2 = 27 LF");
    expect(x.cierre.en).toContain("= 2 tubes");
  });

  it("liner con subida: (5 + 1) × (3 + 1) = 24 SF, 1 pieza", () => {
    const x = fila(r, "liner").explicacion;
    expect(x.pasos[1].en).toBe("Liner = (5 + 1) × (3 + 1) = 24 SF");
    expect(x.cierre.en).toContain("= 1 piece");
  });

  it("cada cierre termina en la cantidad a vender de la tabla", () => {
    for (const f of r.filas) {
      if (f.porPaquete === null || f.clave === "tablero" || f.venta === 0) continue;
      expect(f.explicacion.cierre.en, f.clave).toContain(`= ${f.venta} `);
    }
  });
});

describe("Flooring Only (5×3, sin pared)", () => {
  const r = correr({ proyecto: "Flooring Only" });

  it("las filas de pared y de ducha dan 0 con la razón del tipo de proyecto", () => {
    for (const clave of ["liner", "mortero", "pendiente", "coladera", "silicon", "loseta-pared", "pegamento-pared", "tablero"]) {
      const x = fila(r, clave).explicacion;
      expect(fila(r, clave).venta, clave).toBe(0);
      expect(x.pasos[0].en, clave).toContain("0 because project type is Flooring Only");
    }
  });

  it("en español la misma razón", () => {
    const x = fila(r, "loseta-pared").explicacion;
    expect(x.pasos[0].es).toBe("0 porque el tipo de proyecto es Solo piso (sin paredes)");
    expect(x.cierre.es).toBe("Nada que vender: 0.");
  });

  it("el piso sigue con su cuenta: 15 SF y 1 caja", () => {
    const x = fila(r, "loseta-piso").explicacion;
    expect(x.pasos[0].en).toBe("Amount needed = floor area = 15 SF");
    expect(fila(r, "loseta-piso").venta).toBe(1);
  });

  it("el área de pared de la sección 03 explica el cero", () => {
    expect(r.explicacionAreas.paredSf.pasos[0].en).toBe("0 because project type is Flooring Only (no walls)");
  });
});

describe("otras causas de cero", () => {
  it("perfil sin borde expuesto: 0 con la celda C37", () => {
    const x = fila(correr(), "perfil").explicacion;
    expect(x.pasos[0].en).toBe("0 because no exposed tile edge is entered (sheet C37 = 0)");
  });

  it("pendiente con C33 = 0 en ducha", () => {
    const x = fila(correr(), "pendiente").explicacion;
    expect(x.pasos[0].en).toBe("0 because pre-slope is not included (Product Settings C33 = 0)");
  });
});
