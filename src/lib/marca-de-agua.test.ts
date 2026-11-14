import { describe, it, expect } from "vitest";
import { fechaDeMarca, textoDeMarca, RUTAS_CON_MARCA } from "./marca-de-agua";

// Se construye con la hora local a propósito: `fechaDeMarca` formatea en hora local, así que la prueba
// da lo mismo en cualquier zona horaria.
describe("fechaDeMarca", () => {
  it("formatea mes/día/año y hora de 12 horas, como en el encargo", () => {
    expect(fechaDeMarca(new Date(2026, 10, 14, 14, 5))).toBe("11/14/2026 2:05 PM");
  });

  it("la medianoche es 12 AM y el mediodía 12 PM", () => {
    expect(fechaDeMarca(new Date(2026, 0, 1, 0, 7))).toBe("1/1/2026 12:07 AM");
    expect(fechaDeMarca(new Date(2026, 0, 1, 12, 30))).toBe("1/1/2026 12:30 PM");
  });

  it("rellena los minutos de un dígito con cero", () => {
    expect(fechaDeMarca(new Date(2026, 6, 4, 9, 3))).toBe("7/4/2026 9:03 AM");
  });
});

describe("textoDeMarca", () => {
  const ahora = new Date(2026, 10, 14, 14, 5);

  it("pone el nombre completo, un punto medio y la fecha", () => {
    expect(textoDeMarca("Roberto Rodriguez Jr", ahora)).toBe("Roberto Rodriguez Jr · 11/14/2026 2:05 PM");
  });

  it("quita los espacios sobrantes del nombre", () => {
    expect(textoDeMarca("  Demo  ", ahora)).toBe("Demo · 11/14/2026 2:05 PM");
  });

  it("sin nombre deja solo la fecha", () => {
    expect(textoDeMarca("   ", ahora)).toBe("11/14/2026 2:05 PM");
  });
});

describe("RUTAS_CON_MARCA", () => {
  it("lista las cuatro apps del encargo, cada una como ruta de primer nivel", () => {
    expect([...RUTAS_CON_MARCA].sort()).toEqual(["/customers", "/erp", "/estimator", "/recruiting"]);
  });
});
