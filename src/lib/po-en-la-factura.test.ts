import { describe, expect, it } from "vitest";
import { poDeLaOrden, textoBajoLaFactura, tituloDeLaFactura } from "./po-en-la-factura";

describe("La PO bajo la factura en la tabla de paradas (D-1187)", () => {
  it("con PO, el texto gris es `PO <número>`", () => {
    expect(textoBajoLaFactura({ po2: "7781" })).toBe("PO 7781");
    expect(poDeLaOrden({ po2: "7781" })).toBe("7781");
  });
  it("quita los espacios de los extremos antes de enseñarla", () => {
    expect(textoBajoLaFactura({ po2: "  PO-55 " })).toBe("PO PO-55");
    expect(poDeLaOrden({ po2: "\t 12 \n" })).toBe("12");
  });
  it("sin PO, no hay texto gris: vacía, solo espacios, null o sin el campo", () => {
    expect(textoBajoLaFactura({ po2: "" })).toBeNull();
    expect(textoBajoLaFactura({ po2: "   " })).toBeNull();
    expect(textoBajoLaFactura({ po2: null })).toBeNull();
    expect(textoBajoLaFactura({})).toBeNull();
    expect(poDeLaOrden({ po2: " \t " })).toBeNull();
  });
  it("el título del texto de la PO lleva la PO y el ID de la orden, en el idioma de la página", () => {
    expect(tituloDeLaFactura({ po2: "7781" }, "#FX540", false)).toBe("PO 7781 · Order #FX540");
    expect(tituloDeLaFactura({ po2: "7781" }, "#FX540", true)).toBe("PO 7781 · Orden #FX540");
  });
  it("sin PO, el título es solo el ID de la orden (para el enlace de la factura)", () => {
    expect(tituloDeLaFactura({ po2: null }, "#FX540", false)).toBe("Order #FX540");
    expect(tituloDeLaFactura({ po2: " " }, "#FX540", true)).toBe("Orden #FX540");
  });
});
