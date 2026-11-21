import { describe, expect, it } from "vitest";
import { instanteReal, ordenConHechasPrimero } from "./hechas-del-gestor";

describe("340: el admin acomoda las entregas hechas", () => {
  it("la entrega se ordena por done_sort_at si lo tiene; la recogida, por su hora real", () => {
    const o = { pod_delivered_at: "2026-11-21T15:00:00Z", pickup_gps_at: "2026-11-21T14:00:00Z", done_sort_at: "2026-11-21T13:00:00Z" };
    expect(instanteReal(o, "D")).toBe(Date.parse("2026-11-21T13:00:00Z"));
    expect(instanteReal(o, "P")).toBe(Date.parse("2026-11-21T14:00:00Z"));
    expect(instanteReal({ pod_delivered_at: "2026-11-21T15:00:00Z" }, "D")).toBe(Date.parse("2026-11-21T15:00:00Z"));
  });
  it("intercambiar las horas de orden cambia de lugar dos entregas", () => {
    const horas: Record<string, string> = { a: "2026-11-21T15:00:00Z", b: "2026-11-21T14:00:00Z" };
    const filas = [{ hecha: true, tipo: "D" as const, ordenes: ["a"] }, { hecha: true, tipo: "D" as const, ordenes: ["b"] }];
    expect(ordenConHechasPrimero(filas, (o) => Date.parse(horas[o]))).toEqual([1, 0]);
    [horas.a, horas.b] = [horas.b, horas.a];
    expect(ordenConHechasPrimero(filas, (o) => Date.parse(horas[o]))).toEqual([0, 1]);
  });
});
