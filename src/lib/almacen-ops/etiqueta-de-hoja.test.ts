import { describe, expect, it } from "vitest";
import { diaCortoDeHoja, etiquetaDeHoja, etiquetasDeGrupos, numerosDeHoja } from "./etiqueta-de-hoja";

const g = (id: string, store: string, created_at: string) => ({ id, store, created_at });

describe("numerosDeHoja", () => {
  it("numera por orden de creación dentro de cada tienda, empezando en 1", () => {
    const grupos = [
      g("c", "McAllen", "2026-11-18T15:00:00Z"),
      g("a", "McAllen", "2026-11-02T15:00:00Z"),
      g("x", "Edinburg", "2026-11-10T15:00:00Z"),
      g("b", "McAllen", "2026-11-09T15:00:00Z"),
    ];
    const n = numerosDeHoja(grupos);
    expect(n.get("a")).toBe(1);
    expect(n.get("b")).toBe(2);
    expect(n.get("c")).toBe(3);
    expect(n.get("x")).toBe(1);
  });
  it("es estable: el orden no depende del orden de la lista de entrada", () => {
    const ida = [g("a", "McAllen", "2026-11-02T15:00:00Z"), g("b", "McAllen", "2026-11-09T15:00:00Z")];
    const vuelta = [...ida].reverse();
    expect([...numerosDeHoja(ida)]).toEqual([...numerosDeHoja(vuelta)]);
  });
  it("con la misma hora de creación desempata por id", () => {
    const n = numerosDeHoja([g("zz", "McAllen", "2026-11-02T15:00:00Z"), g("aa", "McAllen", "2026-11-02T15:00:00Z")]);
    expect(n.get("aa")).toBe(1);
    expect(n.get("zz")).toBe(2);
  });
});

describe("etiquetaDeHoja", () => {
  it("sale con el formato «Sheet <n> · <Mon DD> · <tienda>» (día en Texas)", () => {
    // 2026-11-18 15:00 UTC = 9:00 en Texas (CST, UTC-6): sigue siendo el 18.
    expect(etiquetaDeHoja(g("a", "McAllen", "2026-11-18T15:00:00Z"), 12, "en", "x")).toBe("Sheet 12 · Nov 18 · McAllen");
    expect(etiquetaDeHoja(g("a", "McAllen", "2026-11-18T15:00:00Z"), 12, "es", "x")).toBe("Hoja 12 · Nov 18 · McAllen");
  });
  it("usa el día de Texas, no el de UTC (una hora tarde en la noche de Texas cambia de día en UTC)", () => {
    // 2026-11-19 03:00 UTC = 2026-11-18 21:00 en Texas.
    expect(diaCortoDeHoja("2026-11-19T03:00:00Z")).toBe("Nov 18");
  });
  it("rellena el día con cero", () => {
    expect(diaCortoDeHoja("2026-11-05T15:00:00Z")).toBe("Nov 05");
  });
  it("sin número (borrador o práctica) devuelve el nombre de respaldo", () => {
    expect(etiquetaDeHoja(g("a", "McAllen", "2026-11-18T15:00:00Z"), undefined, "en", "18/11/2026 9:00")).toBe("18/11/2026 9:00");
    expect(etiquetaDeHoja(g("a", "McAllen", "2026-11-18T15:00:00Z"), null, "es", "Borrador")).toBe("Borrador");
  });
});

describe("etiquetasDeGrupos", () => {
  it("numera solo los que cuentan (los borradores y de práctica conservan su nombre)", () => {
    const grupos = [
      { ...g("a", "McAllen", "2026-11-02T15:00:00Z"), name: "02/11 9:00" },
      { ...g("b", "McAllen", "2026-11-09T15:00:00Z"), name: "Borrador" },
      { ...g("c", "McAllen", "2026-11-18T15:00:00Z"), name: "18/11 9:00" },
    ];
    const m = etiquetasDeGrupos(grupos, "en", (id) => id !== "b");
    expect(m.get("a")).toBe("Sheet 1 · Nov 02 · McAllen");
    expect(m.get("b")).toBe("Borrador");
    expect(m.get("c")).toBe("Sheet 2 · Nov 18 · McAllen");
  });
});
