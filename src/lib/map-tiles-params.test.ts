import { describe, it, expect } from "vitest";
import { paramsDeTileValidos } from "./map-tiles-params";

describe("paramsDeTileValidos", () => {
  it("acepta enteros dentro del cuadrado de su zoom", () => {
    expect(paramsDeTileValidos("0", "0", "0")).toEqual({ z: 0, x: 0, y: 0 });
    expect(paramsDeTileValidos("3", "7", "7")).toEqual({ z: 3, x: 7, y: 7 }); // 2^3 = 8: máximo 7
    expect(paramsDeTileValidos("12", "1234", "1500")).toEqual({ z: 12, x: 1234, y: 1500 });
  });

  it("rechaza x o y fuera del cuadrado del zoom", () => {
    expect(paramsDeTileValidos("3", "8", "0")).toBeNull();
    expect(paramsDeTileValidos("3", "0", "8")).toBeNull();
    expect(paramsDeTileValidos("0", "1", "0")).toBeNull();
  });

  it("rechaza zoom fuera de 0 a 22", () => {
    expect(paramsDeTileValidos("23", "0", "0")).toBeNull();
    expect(paramsDeTileValidos("99", "0", "0")).toBeNull();
  });

  it("rechaza negativos, decimales, notación y basura (lo que podría colarse en la URL)", () => {
    expect(paramsDeTileValidos("-1", "0", "0")).toBeNull();
    expect(paramsDeTileValidos("3", "-1", "0")).toBeNull();
    expect(paramsDeTileValidos("3", "1.5", "0")).toBeNull();
    expect(paramsDeTileValidos("3", "1e2", "0")).toBeNull();
    expect(paramsDeTileValidos("3", "0", "1&key=x")).toBeNull();
    expect(paramsDeTileValidos("3", "0", "../../etc")).toBeNull();
    expect(paramsDeTileValidos("", "0", "0")).toBeNull();
    expect(paramsDeTileValidos("3", "", "0")).toBeNull();
  });
});
