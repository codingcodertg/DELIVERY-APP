import { describe, expect, it } from "vitest";
import { alternaGrupo, estadoDeGrupo, lasMarcadas, lasRepartibles } from "./seleccion-multiple";

describe("marcar varias en el Gestor, para todo tipo de fila", () => {
  it("la casilla de una recogida con varias órdenes: todas / algunas / ninguna", () => {
    expect(estadoDeGrupo(["a", "b"], new Set(["a", "b"]))).toBe("todas");
    expect(estadoDeGrupo(["a", "b"], new Set(["a"]))).toBe("algunas");
    expect(estadoDeGrupo(["a", "b"], new Set())).toBe("ninguna");
    expect(estadoDeGrupo([], new Set(["a"]))).toBe("ninguna");
  });
  it("pulsarla marca todas, o las quita si ya estaban todas", () => {
    expect([...alternaGrupo(new Set(["x", "a"]), ["a", "b"])].sort()).toEqual(["a", "b", "x"]);
    expect([...alternaGrupo(new Set(["x", "a", "b"]), ["a", "b"])]).toEqual(["x"]);
  });
  it("lo marcado incluye cualquier fecha, sin fecha y cualquier etapa; repartir solo lo de hoy en ruta", () => {
    const o = [
      { id: "hoy", delivery_date: "2026-11-12", stage: "ready" },
      { id: "sin", delivery_date: null, stage: "approved" },
      { id: "otra", delivery_date: "2026-11-14", stage: "ready" },
      { id: "camino", delivery_date: "2026-11-12", stage: "picked_up" },
      { id: "nada", delivery_date: "2026-11-12", stage: "ready" },
    ];
    const m = lasMarcadas(o, new Set(["hoy", "sin"]), new Set(["otra", "camino"]));
    expect(m.map((d) => d.id)).toEqual(["hoy", "sin", "otra", "camino"]);
    expect(lasRepartibles(m, "2026-11-12", ["approved", "fulfilling", "ready"]).map((d) => d.id)).toEqual(["hoy"]);
  });
});
