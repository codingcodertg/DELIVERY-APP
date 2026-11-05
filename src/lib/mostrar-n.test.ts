import { describe, expect, it } from "vitest";
import { TAMANOS_DE_TABLA, tamanoValido } from "./mostrar-n";

describe("mostrar-n", () => {
  it("ofrece 10, 50, 100 y 1000", () => expect([...TAMANOS_DE_TABLA]).toEqual([10, 50, 100, 1000]));
  it("acepta los válidos y cae al de por defecto", () => {
    expect(tamanoValido("50")).toBe(50);
    expect(tamanoValido(1000)).toBe(1000);
    expect(tamanoValido("7")).toBe(100);
    expect(tamanoValido(null, 10)).toBe(10);
  });
});
