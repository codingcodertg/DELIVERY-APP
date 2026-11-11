import { describe, expect, it } from "vitest";
import { numeracionConHechas, puestoEn } from "./mover-parada";
import { escrituraDeLaLista } from "./lista-unica";

/** D-992 (Roberto, 11 nov): lo entregado se queda en el puesto que tenía; mover pendientes ya no lo sube arriba. */
describe("orden original de la ruta: lo hecho se queda en su puesto", () => {
  it("las pendientes ocupan los puestos libres, saltando los de las hechas", () => {
    const n = numeracionConHechas([{ route_seq: 2 }, { route_seq: 4 }], [{ route_seq: 0 }, { route_seq: 1 }, { route_seq: 3 }, { route_seq: 5 }]);
    expect([0, 1, 2, 3].map((i) => puestoEn(n, i))).toEqual([0, 1, 3, 5]);
  });
  it("empieza en el primer puesto de la ruta (no en 0 si la ruta ya empezaba más abajo)", () => {
    const n = numeracionConHechas([{ route_seq: 7 }, { route_seq: 8 }], [{ route_seq: 9 }, { route_seq: 10 }]);
    expect([0, 1].map((i) => puestoEn(n, i))).toEqual([9, 10]);
  });
  it("sin hechas, puestos seguidos como siempre", () => {
    expect(numeracionConHechas([], [{ route_seq: 3 }, { route_seq: 4 }])).toBe(3);
    expect(puestoEn(5, 2)).toBe(7);
  });
  it("la escritura de la lista usa esos puestos (y la recogida va justo antes de su entrega)", () => {
    const e = escrituraDeLaLista([{ tipo: "P", ordenes: ["a"] }, { tipo: "D", orden: "a" }, { tipo: "D", orden: "b" }] as never, { desde: 0, ocupados: [0, 1] });
    expect(e.ids).toEqual(["a", "b"]);
    expect(puestoEn({ desde: 0, ocupados: [0, 1] }, 0)).toBe(2);
    expect(e.pickupSeqById.a).toBeLessThan(2);
    expect(e.pickupSeqById.a).toBeGreaterThan(1);
  });
});
