import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { textoDelRango, textoDeLaRegla, type Traducir } from "./fee-formula-text";
import { filasDeLaFormula, UMBRAL_CORTO, UMBRAL_LARGO, FACTOR_MEDIO, TARIFA_LISTA } from "./pricing";
import { fmtMoney } from "./utils";

const en: Traducir = (a) => a;
const es: Traducir = (_a, b) => b;

// El fallo que esto fija: la tabla salía solo en español, bajo cabeceras que sí se traducían.
// Un admin en inglés leía «Zone · Distance» y debajo «cualquier distancia».
describe("los rangos se dicen en el idioma de quien mira", () => {
  it("en los dos idiomas, y el rango cerrado es igual en ambos", () => {
    expect(textoDelRango(en, null, 11)).toBe("under 11 mi");
    expect(textoDelRango(es, null, 11)).toBe("menos de 11 mi");
    expect(textoDelRango(en, 50, null)).toBe("over 50 mi");
    expect(textoDelRango(es, 50, null)).toBe("más de 50 mi");
    expect(textoDelRango(en, null, null)).toBe("any distance");
    expect(textoDelRango(es, null, null)).toBe("cualquier distancia");
    // El cerrado son números y un guion: no hay nada que traducir, y por eso coincide.
    expect(textoDelRango(en, 11, 50)).toBe("11–50 mi");
    expect(textoDelRango(es, 11, 50)).toBe("11–50 mi");
  });

  it("y NUNCA dice «11 a 49»: 50 está dentro del tramo del medio", () => {
    const cerrado = textoDelRango(en, UMBRAL_CORTO, UMBRAL_LARGO);
    expect(cerrado).toContain(String(UMBRAL_LARGO));
    expect(cerrado).not.toContain(String(UMBRAL_LARGO - 1));
  });
});

describe("las reglas se dicen según el factor", () => {
  it("plano, base más millas, y base más factor por millas", () => {
    // El importe pasa por `fmtMoney`, que es como se dice el dinero en toda la app: «$100.00».
    expect(textoDeLaRegla(en, 100, 0)).toBe(`flat ${fmtMoney(100)}`);
    expect(textoDeLaRegla(es, 100, 0)).toBe(`${fmtMoney(100)} fijo`);
    expect(textoDeLaRegla(en, 350, 1)).toBe("350 + mi");
    expect(textoDeLaRegla(en, 120, FACTOR_MEDIO)).toBe(`120 + ${FACTOR_MEDIO} × mi`);
  });

  it("y las ocho celdas de la tabla se pueden decir en inglés sin que quede nada suelto", () => {
    // El control del fallo original: si alguna celda volviera a llevar español clavado, esta
    // recorrería la tabla entera y lo encontraría.
    const celdas = filasDeLaFormula().flatMap((f) => [
      textoDelRango(en, f.desde, f.hasta),
      textoDeLaRegla(en, f.lista.base, f.lista.factor),
      textoDeLaRegla(en, f.descuento.base, f.descuento.factor),
    ]);
    expect(celdas).toHaveLength(12); // control: 4 filas × 3 celdas
    for (const c of celdas) {
      expect(c, c).not.toMatch(/fijo|cualquier|menos de|más de/);
    }
  });
});

// Y que no vuelva a haber dos fórmulas en la misma pantalla. La copia escrita a mano ya existía
// en Ajustes desde antes de esta rama; añadir la tabla generada al lado dejaba las dos, y la de
// abajo se habría quedado vieja el día que alguien cambiara un 120.
describe("Ajustes enseña la fórmula una sola vez", () => {
  const src = readFileSync("src/app/(app)/settings/page.tsx", "utf8");

  it("la tabla se genera, y no quedan constantes de la fórmula escritas a mano", () => {
    expect(src).toContain("filasDeLaFormula()");
    for (const n of [TARIFA_LISTA.baseMedio, TARIFA_LISTA.baseLargo, TARIFA_LISTA.baseNoLocal]) {
      expect(src, `la constante ${n} no puede estar escrita en la pantalla`).not.toContain(`${n} + mi`);
    }
    expect(src).not.toContain("Fee formula (by driving miles)");
  });
});
