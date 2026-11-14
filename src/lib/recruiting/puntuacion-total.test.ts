import { describe, expect, it } from "vitest";
import { puntuacionTotal } from "./puntuacion-total";

describe("puntuacionTotal (Tot Score = Riesgo + Desempeño + Persona)", () => {
  it("suma las tres cuando están todas", () => {
    expect(puntuacionTotal({ risk: "4", performance: "3.5", person: "2" })).toEqual({ total: 9.5, cuantas: 3, de: 3 });
  });

  it("todas vacías: total null y cero de tres", () => {
    expect(puntuacionTotal({ risk: "", performance: null, person: undefined })).toEqual({ total: null, cuantas: 0, de: 3 });
  });

  it("faltan algunas: suma las que hay y dice cuántas son", () => {
    expect(puntuacionTotal({ risk: "4", performance: "", person: "2.5" })).toEqual({ total: 6.5, cuantas: 2, de: 3 });
    expect(puntuacionTotal({ risk: null, performance: "5", person: "" })).toEqual({ total: 5, cuantas: 1, de: 3 });
  });

  it("el cero es una cifra, no una casilla vacía", () => {
    expect(puntuacionTotal({ risk: "0", performance: "", person: "" })).toEqual({ total: 0, cuantas: 1, de: 3 });
  });

  it("acepta números y los formatos del formulario ($ y comas, como el servidor)", () => {
    expect(puntuacionTotal({ risk: 1, performance: "$2,000", person: " 3 " })).toEqual({ total: 2004, cuantas: 3, de: 3 });
  });

  it("una casilla que no es número cuenta como vacía", () => {
    expect(puntuacionTotal({ risk: "abc", performance: "1", person: "1" })).toEqual({ total: 2, cuantas: 2, de: 3 });
  });

  it("redondea a dos decimales", () => {
    expect(puntuacionTotal({ risk: "0.1", performance: "0.2", person: "0.3" }).total).toBe(0.6);
    expect(puntuacionTotal({ risk: "1.234", performance: "1", person: "" }).total).toBe(2.23);
  });
});
