import { describe, it, expect } from "vitest";
import { pasoFormulario } from "./order-form-step";

// D-304: una orden nueva que nace Intertienda enseñaba un modal vacío, porque el paso corto se
// saltaba (D-302) y el completo esperaba «Siguiente». Aquí se fija que la decisión nunca queda vacía.
describe("pasoFormulario", () => {
  it("una orden nueva tienda-a-tienda va DIRECTA al formulario completo, sin pulsar Siguiente", () => {
    expect(pasoFormulario(true, false, true)).toBe("completo");
  });

  it("una orden nueva de cliente empieza en el paso corto", () => {
    expect(pasoFormulario(true, false, false)).toBe("inicial");
  });

  it("tras Siguiente, el completo", () => {
    expect(pasoFormulario(true, true, false)).toBe("completo");
  });

  it("una orden existente siempre es el completo, diga lo que diga lo demás", () => {
    for (const s of [false, true]) for (const t of [false, true]) expect(pasoFormulario(false, s, t)).toBe("completo");
  });

  it("en las 8 combinaciones sale uno de los dos pasos, nunca ninguno", () => {
    for (const n of [false, true]) for (const s of [false, true]) for (const t of [false, true]) {
      expect(["inicial", "completo"]).toContain(pasoFormulario(n, s, t));
    }
  });
});
