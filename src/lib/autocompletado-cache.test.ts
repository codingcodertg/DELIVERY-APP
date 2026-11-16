import { describe, expect, it } from "vitest";
import { LRUSugerencias, SESION_VALIDA, nuevaSesionDeAutocompletado } from "@/lib/autocompletado-cache";

describe("LRUSugerencias", () => {
  it("devuelve lo guardado y nada para una clave desconocida", () => {
    const c = new LRUSugerencias<string[]>(3);
    c.set("calle 1", ["x"]);
    expect(c.get("calle 1")).toEqual(["x"]);
    expect(c.get("otra")).toBeUndefined();
  });
  it("al pasar del máximo olvida la que menos se usó", () => {
    const c = new LRUSugerencias<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.tamano).toBe(2);
  });
  it("leer una clave la deja la más reciente", () => {
    const c = new LRUSugerencias<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
  });
});

describe("sesión de autocompletado", () => {
  it("un token nuevo es válido para el servidor y cambia cada vez", () => {
    const a = nuevaSesionDeAutocompletado();
    const b = nuevaSesionDeAutocompletado();
    expect(SESION_VALIDA.test(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it("el validador rechaza tokens vacíos, cortos o con caracteres raros", () => {
    expect(SESION_VALIDA.test("")).toBe(false);
    expect(SESION_VALIDA.test("corto")).toBe(false);
    expect(SESION_VALIDA.test("abc; drop table")).toBe(false);
    expect(SESION_VALIDA.test("a".repeat(65))).toBe(false);
  });
});
