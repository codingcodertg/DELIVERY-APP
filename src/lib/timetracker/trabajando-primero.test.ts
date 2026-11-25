import { describe, expect, it } from "vitest";
import { estadoDeTrabajo, ordenaTrabajandoPrimero, unionDeNomina } from "./trabajando-primero";

describe("estadoDeTrabajo", () => {
  const trabajando = new Set(["ana"]);
  it("«si» para quien trabaja ahora", () => {
    expect(estadoDeTrabajo("ana", trabajando)).toBe("si");
  });
  it("«no» para quien no trabaja, y también sin dato", () => {
    expect(estadoDeTrabajo("luis", trabajando)).toBe("no");
    expect(estadoDeTrabajo("ana", new Set())).toBe("no");
    expect(estadoDeTrabajo("ana", undefined)).toBe("no");
  });
});

describe("ordenaTrabajandoPrimero", () => {
  it("pone primero a quien trabaja y después al resto", () => {
    expect(ordenaTrabajandoPrimero(["luis", "ana", "marta", "pedro"], new Set(["ana", "pedro"]))).toEqual(["ana", "pedro", "luis", "marta"]);
  });

  it("es estable: dentro de cada grupo queda el orden que traía", () => {
    expect(ordenaTrabajandoPrimero(["c", "b", "a"], new Set(["b", "a"]))).toEqual(["b", "a", "c"]);
    expect(ordenaTrabajandoPrimero(["c", "b", "a"], new Set())).toEqual(["c", "b", "a"]);
  });

  it("sin nadie trabajando, o con todos, no cambia el orden", () => {
    expect(ordenaTrabajandoPrimero(["x", "y"], new Set())).toEqual(["x", "y"]);
    expect(ordenaTrabajandoPrimero(["x", "y"], new Set(["x", "y"]))).toEqual(["x", "y"]);
  });

  it("con objetos, usa su campo id y devuelve los mismos objetos", () => {
    const filas = [{ id: "luis", n: 1 }, { id: "ana", n: 2 }];
    const out = ordenaTrabajandoPrimero(filas, new Set(["ana"]));
    expect(out.map((f) => f.id)).toEqual(["ana", "luis"]);
    expect(out[0]).toBe(filas[1]);
  });

  it("no toca la lista de entrada", () => {
    const entrada = ["b", "a"];
    ordenaTrabajandoPrimero(entrada, new Set(["a"]));
    expect(entrada).toEqual(["b", "a"]);
  });
});

describe("unionDeNomina · la lista única", () => {
  it("une de sitio y remotos, cada persona una vez; los que trabajan, primero", () => {
    const out = unionDeNomina(["a", "b"], ["r1", "r2"], new Set(["r2", "b"]));
    expect(out.map((e) => e.id)).toEqual(["b", "r2", "a", "r1"]);
  });

  it("quien tiene horas por las dos vías sale una vez, marcada en los dos lados", () => {
    const out = unionDeNomina(["a", "b"], ["b", "r1"], new Set());
    expect(out).toEqual([
      { id: "a", enSitio: true, remoto: false },
      { id: "b", enSitio: true, remoto: true },
      { id: "r1", enSitio: false, remoto: true },
    ]);
  });

  it("sin remotos, es la lista de sitio tal cual (ordenada igual)", () => {
    expect(unionDeNomina(["x", "y"], [], new Set(["y"])).map((e) => e.id)).toEqual(["y", "x"]);
  });

  it("dos personas de sitio que trabajan y dos remotas que no: orden estable dentro de cada grupo", () => {
    const out = unionDeNomina(["s1", "s2"], ["r1", "r2"], new Set(["s2", "r2"]));
    expect(out.map((e) => e.id)).toEqual(["s2", "r2", "s1", "r1"]);
  });
});
