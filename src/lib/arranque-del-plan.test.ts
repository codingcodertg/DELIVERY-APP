import { describe, expect, it } from "vitest";
import { numeradasDelDia, numerosDeArranque } from "./arranque-del-plan";

describe("D-722: el arranque numerado del plan", () => {
  it("lo marcado recibe 1, 2, 3… en el orden en que se marcó", () => {
    expect(numerosDeArranque(["c", "a", "b"], [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]))
      .toEqual([{ id: "c", plan_rank: 1 }, { id: "a", plan_rank: 2 }, { id: "b", plan_rank: 3 }]);
  });

  it("sigue a lo ya numerado del día, y lo que se vuelve a marcar se renumera sin contar su número viejo", () => {
    const dia = [{ id: "a", plan_rank: 1 }, { id: "b", plan_rank: 2 }, { id: "c", plan_rank: null }, { id: "d" }];
    expect(numerosDeArranque(["c"], dia)).toEqual([{ id: "c", plan_rank: 3 }]);
    // «b» ya era 2: se renumera detrás de lo que queda numerado (solo «a»).
    expect(numerosDeArranque(["d", "b"], dia)).toEqual([{ id: "d", plan_rank: 2 }, { id: "b", plan_rank: 3 }]);
    expect(numerosDeArranque([], dia)).toEqual([]);
  });

  it("las numeradas del día salen en su orden, y sin número no salen", () => {
    expect(numeradasDelDia([{ id: "b", plan_rank: 2 }, { id: "x", plan_rank: null }, { id: "a", plan_rank: 1 }, { id: "y" }]).map((o) => o.id)).toEqual(["a", "b"]);
  });
});
