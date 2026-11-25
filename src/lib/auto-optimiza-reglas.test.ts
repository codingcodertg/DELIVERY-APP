import { describe, it, expect } from "vitest";
import { reintentoAuto, notaDeReglas, violacionesNuevas } from "./auto-optimiza-la-ruta";

describe("reintentoAuto (348): 5 s, luego 20 s, y después se queda en fallo", () => {
  it("el primer reintento a los 5 s, el segundo a los 20 s", () => {
    expect(reintentoAuto(0)).toBe(5_000);
    expect(reintentoAuto(1)).toBe(20_000);
  });
  it("después de dos reintentos no hay más: lo decide la persona con el botón", () => {
    expect(reintentoAuto(2)).toBeNull();
  });
});

describe("notaDeReglas (348): las reglas que incumple, sin repetir", () => {
  it("une las claves distintas en orden de aparición", () => {
    expect(notaDeReglas([{ clave: "parada_repetida" }, { clave: "carga_antes_de_descarga" }, { clave: "parada_repetida" }])).toBe("parada_repetida, carga_antes_de_descarga");
  });
  it("sin violaciones, cadena vacía", () => {
    expect(notaDeReglas([])).toBe("");
  });
});

describe("violacionesNuevas (348): solo cuenta lo que el cambio AÑADE", () => {
  const v = (clave: string, ordenes: string[] = ["A"]) => ({ clave, ordenes });

  it("sin violaciones después: ninguna nueva", () => {
    expect(violacionesNuevas([], [])).toEqual([]);
    expect(violacionesNuevas([v("x")], [])).toEqual([]);
  });

  it("una violación que ya estaba antes NO es nueva (la ruta ya la rompía)", () => {
    expect(violacionesNuevas([v("carga_antes_de_descarga", ["A"])], [v("carga_antes_de_descarga", ["A"])])).toEqual([]);
  });

  it("la misma clave con OTRAS órdenes sí es nueva", () => {
    const nuevas = violacionesNuevas([v("parada_repetida", ["A"])], [v("parada_repetida", ["B"])]);
    expect(nuevas).toEqual([v("parada_repetida", ["B"])]);
  });

  it("las órdenes se comparan sin importar su orden", () => {
    expect(violacionesNuevas([v("k", ["B", "A"])], [v("k", ["A", "B"])])).toEqual([]);
  });

  it("una clave que no estaba es nueva aunque la ruta ya tuviera otras", () => {
    const despues = [v("a", ["X"]), v("b", ["Y"])];
    expect(violacionesNuevas([v("a", ["X"])], despues)).toEqual([v("b", ["Y"])]);
  });

  it("conserva el tipo de lo que devuelve (las violaciones completas, con su detalle)", () => {
    const completa = { clave: "k", ordenes: ["A"], detalle: "explicación", indice: 2 };
    expect(violacionesNuevas([], [completa])[0].detalle).toBe("explicación");
  });
});
