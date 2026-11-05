import { describe, expect, it } from "vitest";
import { lugarDeLaDireccion, lugaresParaEntregarEn } from "./entregar-en-tienda";

const settings = {
  stores: [
    { name: "RDZ Norte", address: "100 N Main St", lat: 29.1, lng: -98.2 },
    { name: "Bodega Sur", address: "5 Yard Rd", bodega: true },
    { name: "Sin dirección", address: "  " },
  ],
  pickup_locations: [
    { name: "rdz norte", address: "otra" },
    { name: "Patio Este", address: "9 East Ave" },
  ],
};

describe("lugaresParaEntregarEn", () => {
  it("lista tiendas primero, luego bodegas; sin repetidos ni vacíos", () => {
    const l = lugaresParaEntregarEn(settings);
    expect(l.map((x) => x.name)).toEqual(["RDZ Norte", "Bodega Sur", "Patio Este"]);
    expect(l[0]).toMatchObject({ address: "100 N Main St", lat: 29.1, lng: -98.2, bodega: false });
    expect(l[1]).toMatchObject({ lat: null, lng: null, bodega: true });
  });
  it("sin ajustes, lista vacía", () => {
    expect(lugaresParaEntregarEn({ stores: [] })).toEqual([]);
  });
});

describe("lugarDeLaDireccion", () => {
  const l = lugaresParaEntregarEn(settings);
  it("encuentra el lugar por su dirección, sin importar mayúsculas ni espacios", () => {
    expect(lugarDeLaDireccion(l, "  100 n main   st ")?.name).toBe("RDZ Norte");
  });
  it("texto libre no coincide", () => {
    expect(lugarDeLaDireccion(l, "123 Cliente Ln")).toBeNull();
    expect(lugarDeLaDireccion(l, "")).toBeNull();
  });
});
