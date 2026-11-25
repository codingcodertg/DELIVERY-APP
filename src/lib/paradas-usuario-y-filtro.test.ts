import { describe, expect, it } from "vitest";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V10, ORDEN_DE_PARTIDA_DEL_GESTOR, columnasDeLaTabla,
  conRepEnSuSitio, preferenciasDelGestorAlLeer,
} from "./routes-columns";

/** «Usuario» (`p_rep`) en la tabla de paradas: su catálogo, su puesto y las listas guardadas de antes. */
describe("«Usuario» en la tabla de paradas (p_rep)", () => {
  it("es una columna de paradas, de Órdenes (rep), visible por defecto, justo tras la cuenta", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_rep")).toEqual({
      key: "p_rep", en: "Stops: User", es: "Paradas: Usuario", tablas: ["paradas"], ancho: 128, deOrdenes: "rep",
    });
    const claves = COLUMNAS_DEL_GESTOR.map((c) => c.key);
    expect(claves.indexOf("p_rep")).toBe(claves.indexOf("p_account") + 1);
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_rep")?.oculta).toBeUndefined();
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain("p_rep");
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain(MARCA_V10);
  });

  it("en la partida de paradas va tras la cuenta", () => {
    const orden = ORDEN_DE_PARTIDA_DEL_GESTOR.paradas;
    expect(orden.indexOf("p_rep")).toBe(orden.indexOf("p_account") + 1);
    expect(columnasDeLaTabla("paradas", COLUMNAS_DEL_GESTOR_POR_DEFECTO, null).map((c) => c.key)).toContain("p_rep");
  });

  it("quien guardó sus columnas antes de esta tanda la recibe, y su orden la pone tras la cuenta", () => {
    const suyas = ["p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8", "_v9"];
    const orden = ["p_type", "p_eta", "p_account", "p_so", "p_actual"];
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(al.columnas).toContain("p_rep");
    expect(al.columnas).toContain(MARCA_V10);
    expect(al.orden).toEqual(["p_type", "p_eta", "p_account", "p_rep", "p_so", "p_actual"]);
    expect(al.escribe).toBe(true);
  });

  it("quien ya tiene la marca no la recibe otra vez: si la quitó, sigue quitada", () => {
    const suyas = ["p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8", "_v9", MARCA_V10];
    const al = preferenciasDelGestorAlLeer(suyas, ["p_type", "p_account"]);
    expect(al.columnas).not.toContain("p_rep");
    expect(al.orden).toEqual(["p_type", "p_account"]);
    expect(al.escribe).toBe(false);
  });

  it("conRepEnSuSitio solo inserta, y no toca un orden sin cuenta ni uno que ya la tiene", () => {
    expect(conRepEnSuSitio(null)).toBeNull();
    expect(conRepEnSuSitio(["p_type", "p_eta"])).toEqual(["p_type", "p_eta"]);
    expect(conRepEnSuSitio(["p_account", "p_rep", "p_so"])).toEqual(["p_account", "p_rep", "p_so"]);
  });
});
