import { describe, expect, it } from "vitest";
import { mueveEnOrden, ordenLimpio, sueltaEnOrden, vistaLimpia } from "./tabla-estandar";

const C = ["a", "b", "c", "d"];
describe("estándar de tablas: lo que guarda cada persona", () => {
  it("orden limpio: quita lo que ya no existe y lo repetido; lo nuevo entra al final", () => {
    expect(ordenLimpio(["c", "x", "a", "c"], C)).toEqual(["c", "a", "b", "d"]);
    expect(ordenLimpio(null, C)).toEqual(C);
  });
  it("vista: sin nada guardado, las ocultas de entrada; una fija nunca se oculta", () => {
    expect(vistaLimpia(null, C, ["a"], ["a", "d"])).toEqual({ orden: C, ocultas: ["d"] });
  });
  it("vista: respeta lo guardado, y una columna nueva nace con su valor de entrada", () => {
    const g = { orden: ["b", "a"], ocultas: ["b"], conocidas: ["a", "b"] };
    expect(vistaLimpia(g, C, [], ["d"])).toEqual({ orden: ["b", "a", "c", "d"], ocultas: ["b", "d"] });
    // quien la mostró a propósito la sigue viendo aunque sea oculta de entrada
    expect(vistaLimpia({ orden: C, ocultas: [], conocidas: C }, C, [], ["d"]).ocultas).toEqual([]);
  });
  it("soltar y flechas", () => {
    expect(sueltaEnOrden(C, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(sueltaEnOrden(C, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(mueveEnOrden(C, "a", -1)).toEqual(C);
    expect(mueveEnOrden(C, "b", 1)).toEqual(["a", "c", "b", "d"]);
  });
});
