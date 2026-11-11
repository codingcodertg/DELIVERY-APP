import { describe, expect, it } from "vitest";
import { filtrarGrupos } from "./grupos";

const g = (id: string, creado: string, aprobado: string | null) => ({ id, created_at: creado, approved_at: aprobado });
const lista = [
  g("p-dentro", "2026-11-10T18:00:00Z", null),
  g("a-dentro", "2026-11-09T18:00:00Z", "2026-11-10T01:00:00Z"),
  g("p-fuera", "2026-10-01T18:00:00Z", null),
];
const rango = { desde: "2026-11-01", hasta: "2026-11-10" };

describe("filtro de Grupos (estado + rango + ver todos)", () => {
  it("el rango de fechas también filtra los grupos", () => {
    expect(filtrarGrupos(lista, "todos", rango, false).map((x) => x.id)).toEqual(["p-dentro", "a-dentro"]);
  });
  it("«Ver todos» ignora el rango", () => {
    expect(filtrarGrupos(lista, "todos", rango, true)).toHaveLength(3);
  });
  it("pendientes y aprobados", () => {
    expect(filtrarGrupos(lista, "pendientes", rango, true).map((x) => x.id)).toEqual(["p-dentro", "p-fuera"]);
    expect(filtrarGrupos(lista, "aprobados", rango, false).map((x) => x.id)).toEqual(["a-dentro"]);
  });
});
