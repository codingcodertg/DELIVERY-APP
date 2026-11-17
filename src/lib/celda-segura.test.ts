import { describe, it, expect } from "vitest";
import { celdaSegura } from "./celda-segura";

describe("celdaSegura (inyección de fórmulas en CSV y Excel)", () => {
  it("antepone una comilla a los textos que Excel leería como fórmula", () => {
    expect(celdaSegura("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(celdaSegura("+1+1")).toBe("'+1+1");
    expect(celdaSegura("-2+3")).toBe("'-2+3");
    expect(celdaSegura("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celdaSegura("\tcmd")).toBe("'\tcmd");
    expect(celdaSegura("\rcmd")).toBe("'\rcmd");
  });

  it("deja igual el texto normal y los números (también los negativos)", () => {
    expect(celdaSegura("Ana Pérez")).toBe("Ana Pérez");
    expect(celdaSegura("— (open)")).toBe("— (open)");
    expect(celdaSegura(-3.5)).toBe(-3.5);
    expect(celdaSegura(0)).toBe(0);
    expect(celdaSegura(null)).toBe("");
    expect(celdaSegura(undefined)).toBe("");
  });
});
