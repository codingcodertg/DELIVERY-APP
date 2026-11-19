import { describe, expect, it } from "vitest";
import { nuevoTokenDeEdicion, tokenDesdeBytes, tokenValido } from "./token";

describe("el token de edición", () => {
  it("son 32 bytes en hex: 64 caracteres minúsculos", () => {
    const bytes = new Uint8Array(32).map((_, i) => i * 7);
    const t = tokenDesdeBytes(bytes);
    expect(t).toHaveLength(64);
    expect(tokenValido(t)).toBe(true);
  });

  it("un token nuevo sale de la fuente de azar dada", () => {
    expect(nuevoTokenDeEdicion(() => new Uint8Array(32).fill(0xab))).toBe("ab".repeat(32));
  });

  it("dos tokens al azar son distintos y válidos", () => {
    const a = nuevoTokenDeEdicion();
    const b = nuevoTokenDeEdicion();
    expect(a).not.toBe(b);
    expect(tokenValido(a)).toBe(true);
  });

  it("rechaza lo que no es un token: mayúsculas, longitud o no hex", () => {
    for (const t of ["", "AB".repeat(32), "ab".repeat(31), "zz".repeat(32), "ab".repeat(33), null, undefined]) {
      expect([t, tokenValido(t as string)]).toEqual([t, false]);
    }
  });

  it("rechaza tamaños de bytes que no son 32", () => {
    expect(() => tokenDesdeBytes(new Uint8Array(16))).toThrow();
  });
});
