import { describe, expect, it } from "vitest";
import { alternaResaltada, encuadreDeResaltadas, esControlDeLaFila } from "./resaltar-orden";

describe("clic en una fila de parada: solo resalta", () => {
  it("una fila con una orden resalta esa orden", () => {
    expect([...alternaResaltada(new Set(), ["A"])]).toEqual(["A"]);
  });

  it("una recogida con varias órdenes resalta todas", () => {
    expect([...alternaResaltada(new Set(), ["A", "B", "A"])].sort()).toEqual(["A", "B"]);
  });

  it("volver a pulsar lo mismo lo quita", () => {
    expect(alternaResaltada(new Set(["A"]), ["A"]).size).toBe(0);
    expect(alternaResaltada(new Set(["A", "B"]), ["A", "B"]).size).toBe(0);
  });

  it("pulsar otra fila cambia lo resaltado (no lo acumula)", () => {
    expect([...alternaResaltada(new Set(["A"]), ["B"])]).toEqual(["B"]);
  });

  it("una fila sin órdenes no cambia nada", () => {
    expect([...alternaResaltada(new Set(["A"]), [])]).toEqual(["A"]);
  });

  it("no devuelve el mismo Set (no muta el estado de React)", () => {
    const actual = new Set(["A"]);
    alternaResaltada(actual, []);
    expect(alternaResaltada(actual, ["B"])).not.toBe(actual);
    expect([...actual]).toEqual(["A"]);
  });
});

describe("encuadre de la orden resaltada", () => {
  it("recogida y entrega, en ese orden", () => {
    expect(encuadreDeResaltadas([[25.9, -97.5], [26.2, -98.2]])).toEqual([[25.9, -97.5], [26.2, -98.2]]);
  });

  it("descarta lo que falta, lo no finito y el 0,0", () => {
    expect(encuadreDeResaltadas([undefined, [26.2, -98.2], null, [0, 0], [NaN, -98]])).toEqual([[26.2, -98.2]]);
  });

  it("sin nada válido, vacío", () => {
    expect(encuadreDeResaltadas([undefined, null])).toEqual([]);
  });
});

describe("controles dentro de la fila", () => {
  it("casilla, select, botón y etapa no resaltan la fila", () => {
    const control = { closest: (s: string) => (s.includes("input") ? {} : null) };
    expect(esControlDeLaFila(control)).toBe(true);
  });

  it("un clic en el texto de la fila sí resalta", () => {
    expect(esControlDeLaFila({ closest: () => null })).toBe(false);
    expect(esControlDeLaFila(null)).toBe(false);
  });
});
