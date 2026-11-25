import { describe, expect, it } from "vitest";
import { poolDelFiltro, pasaSemanaSTXP, unirPoolUnico } from "./pool-unico";

describe("la pestaña única: GOV y STXP juntos", () => {
  it("une los dos sin repetir por id; el orden es el GOV primero y luego el STXP", () => {
    const gov = [{ id: "a" }, { id: "b" }];
    const stxp = [{ id: "c" }, { id: "a" }];
    expect(unirPoolUnico(gov, stxp).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
  it("sin nada de un lado, enseña el otro tal cual", () => {
    expect(unirPoolUnico([], [{ id: "p" }])).toEqual([{ id: "p" }]);
    expect(unirPoolUnico([{ id: "g" }], [])).toEqual([{ id: "g" }]);
  });
  it("el pool del selector filtra el GOV siempre; el STXP solo cuando se puede elegir tienda", () => {
    expect(poolDelFiltro({ source: "tdlr" }, "RDZ Pharr", false)).toBe("RDZ Pharr");
    expect(poolDelFiltro({ source: "tdlr" }, "RDZ Pharr", true)).toBe("RDZ Pharr");
    expect(poolDelFiltro({ source: "privado" }, "RDZ Pharr", true)).toBe("RDZ Pharr");
    expect(poolDelFiltro({ source: "privado" }, "RDZ Pharr", false)).toBeNull();
    expect(poolDelFiltro({ source: "privado" }, null, true)).toBeNull();
  });
  it("la semana solo esconde STXP: un GOV pasa siempre, y el STXP pasa si es su semana", () => {
    const semanas = new Map([["p1", 1], ["p2", 2]]);
    expect(pasaSemanaSTXP({ id: "g", source: "tdlr" }, semanas, 1)).toBe(true);
    expect(pasaSemanaSTXP({ id: "g" }, semanas, 2)).toBe(true);
    expect(pasaSemanaSTXP({ id: "p1", source: "privado" }, semanas, 1)).toBe(true);
    expect(pasaSemanaSTXP({ id: "p1", source: "privado" }, semanas, 2)).toBe(false);
    expect(pasaSemanaSTXP({ id: "sin", source: "privado" }, semanas, 1)).toBe(false);
    expect(pasaSemanaSTXP({ id: "p2", source: "privado" }, semanas, null)).toBe(true);
  });
});
