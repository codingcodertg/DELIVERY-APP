import { describe, expect, it } from "vitest";
import { mapaDeLaOrden } from "./orden-en-el-mapa";

const tiendas = [{ name: "RDZ Pharr", lat: 26.19, lng: -98.18 }, { name: "RDZ McAllen", lat: 26.2, lng: -98.24 }];

describe("«Ver en el mapa» de una orden (ayuda 62770f89)", () => {
  it("pin de la entrega + la tienda de recogida en el encuadre", () => {
    const m = mapaDeLaOrden({ id: "o1", delivery_lat: 26.27, delivery_lng: -98.16, delivery_address: "3501 Waccamaw Ave", pickup_name: "RDZ Pharr" }, tiendas);
    expect(m.sinUbicacion).toBe(false);
    expect(m.puntos).toHaveLength(1);
    expect(m.puntos[0]).toMatchObject({ id: "o1", lat: 26.27, lng: -98.16, label: "3501 Waccamaw Ave" });
    expect(m.encuadre).toEqual([[26.27, -98.16], [26.19, -98.18]]);
  });
  it("sin recogida conocida usa la tienda de la orden", () => {
    const m = mapaDeLaOrden({ id: "o2", delivery_lat: 26.3, delivery_lng: -98.2, store: "RDZ McAllen" }, tiendas);
    expect(m.encuadre).toEqual([[26.3, -98.2], [26.2, -98.24]]);
  });
  it("sin punto de entrega → aviso, sin pines", () => {
    const m = mapaDeLaOrden({ id: "o3", delivery_lat: null, delivery_lng: null, pickup_name: "RDZ Pharr" }, tiendas);
    expect(m.sinUbicacion).toBe(true);
    expect(m.puntos).toHaveLength(0);
  });
});
