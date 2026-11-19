import { describe, expect, it } from "vitest";
import { esSlugDeTarjeta, slugDesdeNombre, validaSlug } from "./slug";

describe("slugs de tarjeta", () => {
  it("acepta minúsculas, números y guiones sueltos", () => {
    expect(validaSlug("jose-perez")).toEqual({ ok: true });
    expect(validaSlug("ana2")).toEqual({ ok: true });
  });

  it("rechaza mayúsculas, guiones al borde o dobles, y símbolos", () => {
    for (const s of ["Jose", "jose_perez", "-jose", "jose-", "jose--perez", "jose perez", "jose.perez", "josé"]) {
      expect([s, validaSlug(s)]).toEqual([s, { ok: false, motivo: "formato" }]);
    }
  });

  it("rechaza largos fuera de 2 a 60", () => {
    expect(validaSlug("a")).toEqual({ ok: false, motivo: "largo" });
    expect(validaSlug("a".repeat(61))).toEqual({ ok: false, motivo: "largo" });
    expect(validaSlug("ab")).toEqual({ ok: true });
  });

  it("rechaza las palabras que la app usa para sus rutas", () => {
    for (const s of ["editar", "api", "tarjeta", "login", "track", "no-encontrada"]) {
      expect([s, validaSlug(s)]).toEqual([s, { ok: false, motivo: "reservado" }]);
    }
    expect(esSlugDeTarjeta("editar")).toBe(false);
  });

  it("propone el slug del nombre quitando acentos", () => {
    expect(slugDesdeNombre("José Pérez")).toBe("jose-perez");
    expect(slugDesdeNombre("  Roberto   Contreras  ")).toBe("roberto-contreras");
    expect(slugDesdeNombre("María-José O'Neil")).toBe("maria-jose-o-neil");
    expect(slugDesdeNombre("!!!")).toBe("");
  });

  it("lo que propone del nombre es un slug válido, salvo que esté vacío o reservado", () => {
    for (const n of ["Melecio Rodríguez", "Pablo Castilla", "Ana B. Ñúñez"]) {
      expect(validaSlug(slugDesdeNombre(n))).toEqual({ ok: true });
    }
  });
});
