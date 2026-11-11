import { describe, expect, it } from "vitest";
import { avisoYaEnGrupo, esErrorDeYaEnGrupo, seleccionadasEnGrupo } from "./grupos";

describe("marcadas que ya están en un grupo", () => {
  it("las detecta", () => {
    expect(seleccionadasEnGrupo([{ id: "a", scrap_group_id: "g1" }, { id: "b", scrap_group_id: null }, { id: "c" }]).map((r) => r.id)).toEqual(["a"]);
  });
  it("aviso en singular y plural, y reconoce el error crudo de la base", () => {
    expect(avisoYaEnGrupo(1, "es")).toBe("Una de tus seleccionadas ya está en un grupo: deselecciónala para avanzar.");
    expect(avisoYaEnGrupo(2, "en")).toContain("2 of your selected reports are already in a group");
    expect(esErrorDeYaEnGrupo(new Error("warehouse_ops: solo mermas fotografiadas, sin aprobar y sin grupo"))).toBe(true);
    expect(esErrorDeYaEnGrupo(new Error("otra cosa"))).toBe(false);
  });
});
