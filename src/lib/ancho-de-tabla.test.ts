import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anchoDeTabla, escalaDelAsa } from "./use-col-widths";

/**
 * D-345 · El arrastre de columnas no funcionaba: con `width: auto` Chrome ignora `table-layout: fixed`
 * y reparte por contenido. Esto fija las dos piezas que lo arreglan y que toda tabla que se arrastra
 * lleve el ancho en línea — la causa se midió en un navegador, no aquí; aquí se fija que no se pierda.
 */
describe("anchoDeTabla", () => {
  it("da un ancho EXPLÍCITO: al menos el marco, y la suma de las columnas cuando lo pasa", () => {
    expect(anchoDeTabla([172, 108, 96])).toEqual({ width: "max(100%, 376px)" });
  });
  it("una columna que no existe (0) o un ancho roto no suman", () => {
    expect(anchoDeTabla([0, 100, Number.NaN, -5, 50.4])).toEqual({ width: "max(100%, 150px)" });
  });
});

describe("escalaDelAsa", () => {
  const asa = (real: number) => ({ parentElement: { getBoundingClientRect: () => ({ width: real }) } }) as unknown as EventTarget;
  it("con la tabla estirada, es lo pintado entre lo pedido", () => { expect(escalaDelAsa(asa(216), 108)).toBe(2); });
  it("nunca baja de 1: una columna pintada más estrecha que lo pedido no acelera el arrastre", () => { expect(escalaDelAsa(asa(50), 108)).toBe(1); });
  it("sin th, o sin medida, no corrige", () => { expect(escalaDelAsa(null, 108)).toBe(1); expect(escalaDelAsa(asa(0), 108)).toBe(1); });
});

describe("toda tabla que se arrastra lleva su ancho en línea", () => {
  const lee = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  for (const f of ["src/components/OrdersTable.tsx", "src/app/(app)/accounts/page.tsx", "src/app/(app)/routes/page.tsx"]) {
    it(f, () => {
      const tablas = lee(f).split("<table ").slice(1).map((t) => t.slice(0, t.indexOf("</table>")));
      const conAsa = tablas.filter((t) => t.includes("tbl-resize") && t.includes("col-resizer"));
      expect(conAsa.length).toBeGreaterThan(0);
      // Solo la etiqueta de apertura: hasta el primer hijo. Más allá hay `<col style={{ width` y casaría siempre.
      for (const t of conAsa) {
        const hijo = Math.min(...["<colgroup", "<thead"].map((h) => t.indexOf(h)).filter((i) => i >= 0));
        expect(Number.isFinite(hijo)).toBe(true);
        expect(t.slice(0, hijo)).toMatch(/style=\{(anchoDeTabla\(|\{ width: )/);
      }
    });
  }
});
