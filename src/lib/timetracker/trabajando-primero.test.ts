import { describe, expect, it } from "vitest";
import { estadoDeTrabajo, ordenaTrabajandoPrimero } from "./trabajando-primero";

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
