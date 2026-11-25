import { describe, it, expect } from "vitest";
import { mismaSecuencia, chipAutoEnPantalla } from "./auto-optimiza-la-ruta";

describe("mismaSecuencia: escribir una lista igual no cambia nada", () => {
  const p = (...ordenes: string[]) => ({ tipo: "P" as const, ordenes });
  const d = (orden: string) => ({ tipo: "D" as const, orden });

  it("las mismas filas en el mismo orden son la misma secuencia", () => {
    expect(mismaSecuencia([p("A"), d("A"), p("B"), d("B")], [p("A"), d("A"), p("B"), d("B")])).toBe(true);
  });

  it("otro orden de entregas no es la misma secuencia", () => {
    expect(mismaSecuencia([p("A"), d("A"), p("B"), d("B")], [p("A"), p("B"), d("B"), d("A")])).toBe(false);
  });

  it("una fila de más o de menos no es la misma secuencia", () => {
    expect(mismaSecuencia([p("A"), d("A")], [p("A"), d("A"), p("B"), d("B")])).toBe(false);
  });

  it("una recogida con varias órdenes compara por sus órdenes, en orden", () => {
    expect(mismaSecuencia([p("A", "B"), d("A")], [p("A", "B"), d("A")])).toBe(true);
    expect(mismaSecuencia([p("A", "B"), d("A")], [p("B", "A"), d("A")])).toBe(false);
  });

  it("dos listas vacías son la misma secuencia", () => {
    expect(mismaSecuencia([], [])).toBe(true);
  });
});

describe("chipAutoEnPantalla: «optimizando» solo si esta pestaña lo corre", () => {
  it("pendiente y corriendo aquí → ⏳ optimizando (calculando)", () => {
    expect(chipAutoEnPantalla("pendiente", true)?.clase).toBe("calculando");
    expect(chipAutoEnPantalla("pendiente", true)?.en).toBe("⏳ optimising…");
  });

  it("pendiente guardado que nadie corre (cerraron la pestaña, recargaron) → reintentar", () => {
    expect(chipAutoEnPantalla("pendiente", false)?.clase).toBe("fallo");
    expect(chipAutoEnPantalla("pendiente", false)?.en).toBe("↻ not optimised — retry");
  });

  it("fallo → reintentar, con o sin corrida", () => {
    expect(chipAutoEnPantalla("fallo", false)?.clase).toBe("fallo");
    expect(chipAutoEnPantalla("fallo", true)?.clase).toBe("fallo");
  });

  it("hecha o sin estado → ningún chip", () => {
    expect(chipAutoEnPantalla("hecha", false)).toBeNull();
    expect(chipAutoEnPantalla("hecha", true)).toBeNull();
    expect(chipAutoEnPantalla(null, false)).toBeNull();
    expect(chipAutoEnPantalla(undefined, true)).toBeNull();
  });
});
