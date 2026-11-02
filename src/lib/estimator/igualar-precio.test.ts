import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { igualaPrecio, marcaDeFila, ponPrecioCompetidor, sePuedeIgualar } from "./price-match";
import { lineaSfVacia, lineaUnidadVacia } from "./modelo";

/** D-802: «Price Match» funcional (Roberto): precio del competidor + «Igualar precio» → precio con descuento. */
const sf = () => { const l = lineaSfVacia(); l.price_per_sf = 3; l.price_match = true; return l; };
const unidad = () => { const l = lineaUnidadVacia(); l.unit_price = 20; l.price_match = true; return l; };

describe("igualar el precio del competidor", () => {
  it("copia el precio del competidor al descuento, por SF o por unidad", () => {
    expect(igualaPrecio(ponPrecioCompetidor(sf(), 2.5)).lower_price_per_sf).toBe(2.5);
    expect(igualaPrecio(ponPrecioCompetidor(unidad(), 15)).lower_unit_price).toBe(15);
  });
  it("sin marca, sin precio, o con un precio que no es menor que el regular, no hace nada", () => {
    const sinMarca = { ...sf(), price_match: undefined };
    expect(ponPrecioCompetidor(sinMarca, 2)).toEqual(sinMarca);
    expect(sePuedeIgualar(sf())).toBe(false);
    expect(sePuedeIgualar(ponPrecioCompetidor(sf(), 3))).toBe(false);
    expect(sePuedeIgualar(ponPrecioCompetidor(sf(), 3.5))).toBe(false);
    expect(igualaPrecio(ponPrecioCompetidor(sf(), 3.5)).lower_price_per_sf).toBeNull();
  });
  it("vacío o inválido quita la clave; marcaDeFila solo acepta números positivos", () => {
    expect(ponPrecioCompetidor(ponPrecioCompetidor(sf(), 2), null)).not.toHaveProperty("price_match_price");
    expect(ponPrecioCompetidor(sf(), -1)).not.toHaveProperty("price_match_price");
    expect(marcaDeFila({ price_match: true, price_match_price: 2.25 })).toEqual({ price_match: true, price_match_price: 2.25 });
    expect(marcaDeFila({ price_match: true, price_match_price: "2" })).toEqual({ price_match: true });
    expect(marcaDeFila({ price_match: false, price_match_price: 2 })).toEqual({});
  });
  it("la pantalla: campo del precio y botón «Igualar precio» en la fila de Price Match", () => {
    const p = readFileSync(join(process.cwd(), "src/app/estimator/Estimador.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(p).toContain("data-price-match-precio");
    expect(p).toContain("data-igualar-precio disabled={!sePuedeIgualar(l)}");
    expect(p).toContain("onClick={() => cambiaLinea(l.id, igualaPrecio)}");
  });
});
