import { describe, expect, it } from "vitest";
import { ordenarTiendas } from "./tiendas-orden";

describe("orden de las tiendas (19 nov)", () => {
  const todas = ["Harlingen", "Brownsville", "Weslaco", "Edinburg", "Mission", "McAllen", "Alamo", "Zapata"];

  it("la tienda de quien mira va primero; luego McAllen, Mission, Edinburg, Weslaco, Brownsville; el resto alfabético", () => {
    expect(ordenarTiendas(todas, "Edinburg")).toEqual(["Edinburg", "McAllen", "Mission", "Weslaco", "Brownsville", "Alamo", "Harlingen", "Zapata"]);
  });

  it("sin tienda propia, el mismo orden preferido", () => {
    expect(ordenarTiendas(todas, null)).toEqual(["McAllen", "Mission", "Edinburg", "Weslaco", "Brownsville", "Alamo", "Harlingen", "Zapata"]);
  });

  it("compara por nombre: mayúsculas y espacios no cambian el lugar; el nombre se queda como viene (sin espacios de los lados)", () => {
    expect(ordenarTiendas(["  brownsville", "MÉXICO", "mcallen"], " McAllen ")).toEqual(["mcallen", "brownsville", "MÉXICO"]);
  });

  it("quita vacías y repetidas", () => {
    expect(ordenarTiendas(["", "McAllen", "McAllen", " "], null)).toEqual(["McAllen"]);
  });
});
