import { describe, expect, it } from "vitest";
import { TIENDA_DE_LA_ZONA, ciudadDelTexto, consultaDe, esCondado, millas, puntoCreible, tiendaMasCercana, ubicaFila, zonaDelPermiso } from "./ubica-condado.mjs";
import { leadDeFila } from "./importa-leads-privado.mjs";

// D-1151: el reporte del 20 nov 2026 trajo 220 de 267 permisos con «Hidalgo County» en vez de ciudad.
const TIENDAS = [
  { name: "RDZ Weslaco", lat: 26.1736, lng: -98.0014 },
  { name: "RDZ Pharr", lat: 26.2041, lng: -98.1686 },
  { name: "RDZ Mission", lat: 26.2551, lng: -98.3197 },
  { name: "RDZ Edinburg", lat: 26.3087, lng: -98.2085 },
  { name: "Bodega Azul", lat: 26.18, lng: -98.0 },
];
const fila = (mas = {}) => ({ "Permit #": "1-13039", "City or County": "Hidalgo County", "Jobsite Address": "Mile 13 N & FM 493", "Type": "RNew", "Contractor Company Name": "Casas Llc", ...mas });

describe("qué es una fila de condado y de qué zona", () => {
  it("«Hidalgo County» es condado; una ciudad no", () => {
    expect(esCondado("Hidalgo County")).toBe(true);
    expect(esCondado(" Cameron County ")).toBe(true);
    expect(esCondado("McAllen")).toBe(false);
    expect(esCondado(null)).toBe(false);
  });
  it("el permiso del condado empieza con su precinto; el de una ciudad no", () => {
    expect(zonaDelPermiso("1-13039")).toBe(1);
    expect(zonaDelPermiso("3-8610")).toBe(3);
    expect(zonaDelPermiso("26-08843")).toBeNull();
    expect(zonaDelPermiso("134104")).toBeNull();
  });
  it("la pregunta al buscador es el cruce y el condado", () => {
    expect(consultaDe(fila())).toBe("Mile 13 N & FM 493, Hidalgo County, TX");
  });
});

describe("el punto y la tienda", () => {
  it("la tienda más cercana es una RDZ (una bodega no cuenta)", () => {
    expect(tiendaMasCercana({ lat: 26.18, lng: -98.0 }, TIENDAS).tienda).toBe("RDZ Weslaco");
    expect(tiendaMasCercana({ lat: 26.3, lng: -98.4 }, TIENDAS).tienda).toBe("RDZ Mission");
  });
  it("millas en línea recta: Weslaco–Pharr son unas diez", () => {
    expect(millas(TIENDAS[0], TIENDAS[1])).toBeGreaterThan(9);
    expect(millas(TIENDAS[0], TIENDAS[1])).toBeLessThan(12);
  });
  it("un punto fuera del condado, o en el lado contrario al de su precinto, no se cree", () => {
    expect(puntoCreible(1, { lat: 26.33, lng: -98.05 })).toBe(true);
    expect(puntoCreible(1, { lat: 26.33, lng: -98.45 })).toBe(false); // precinto 1 es el este
    expect(puntoCreible(3, { lat: 26.3, lng: -98.4 })).toBe(true);
    expect(puntoCreible(3, { lat: 26.3, lng: -98.0 })).toBe(false);   // precinto 3 es el oeste
    expect(puntoCreible(1, { lat: 29.7, lng: -95.3 })).toBe(false);   // Houston
    expect(puntoCreible(null, { lat: 26.3, lng: -98.2 })).toBe(true);
  });
});

describe("lo que se le agrega a cada fila", () => {
  it("con punto, la tienda MÁS CERCANA al cruce, con sus millas, y la ciudad que dio el buscador", () => {
    // Cerca de Donna, pero la tienda más cercana es Weslaco (unas 3 mi) y no Pharr (unas 7).
    const u = ubicaFila(fila(), { lat: 26.2, lng: -98.05, ciudad: "Donna", texto: "N Hutto Rd, Donna, TX 78537, USA" }, TIENDAS);
    expect(u).toMatchObject({ _ciudad: "Donna", _pool: "RDZ Weslaco", _como: "direccion" });
    expect(u._nota).toMatch(/^Hidalgo County permit, outside city limits\. Located on the map by its jobsite streets: near Donna, \d+\.\d mi from RDZ Weslaco\.$/);
  });
  it("si el buscador no da localidad (lo normal en el campo), la ciudad es la de su código postal", () => {
    expect(ciudadDelTexto("Inspiration Rd & W Monte Cristo Rd, Texas 78573, USA")).toBe("Mission");
    expect(ciudadDelTexto("Mile 19 N Rd, Texas, USA")).toBeNull();
    const u = ubicaFila(fila({ "Permit #": "3-8608" }), { lat: 26.362, lng: -98.325, ciudad: null, texto: "Inspiration Rd & W Monte Cristo Rd, Texas 78573, USA" }, TIENDAS);
    expect(u).toMatchObject({ _ciudad: "Mission", _pool: "RDZ Mission" });
    expect(ubicaFila(fila(), { lat: 26.33, lng: -98.05, ciudad: null, texto: "Mile 19 N Rd, Texas, USA" }, TIENDAS)._ciudad).toBeNull();
  });
  it("sin punto, o con uno que no cuadra con su precinto, la tienda de la zona del permiso", () => {
    expect(ubicaFila(fila(), null, TIENDAS)).toMatchObject({ _pool: "RDZ Weslaco", _como: "zona", _ciudad: null });
    expect(ubicaFila(fila({ "Permit #": "3-8610" }), { lat: 26.3, lng: -98.0, ciudad: "Weslaco" }, TIENDAS)).toMatchObject({ _pool: "RDZ Mission", _como: "zona" });
    expect(ubicaFila(fila({ "Permit #": "2-100" }), null, TIENDAS)._pool).toBe(TIENDA_DE_LA_ZONA[2]);
  });
  it("sin punto y sin precinto, se queda sin tienda y lo dice", () => {
    expect(ubicaFila(fila({ "Permit #": "X99" }), null, TIENDAS)).toMatchObject({ _pool: "No store", _como: "nada" });
  });
  it("una fila con ciudad no se toca", () => {
    expect(ubicaFila(fila({ "City or County": "McAllen", "Permit #": "26-08843" }), null, TIENDAS)).toBeNull();
  });
});

describe("el importador usa lo agregado", () => {
  it("una fila de condado ya ubicada entra con su tienda, su ciudad y su nota; el condado se conserva", () => {
    const f = fila();
    Object.assign(f, ubicaFila(f, { lat: 26.2, lng: -98.05, ciudad: "Donna" }, TIENDAS));
    const l = leadDeFila(f, 0);
    expect(l).toMatchObject({ pool: "RDZ Weslaco", site_city: "Donna", county: "Hidalgo County", site_address: "Mile 13 N & FM 493" });
    expect(l.scope_of_work).toContain("outside city limits");
  });
  it("sin ubicar, una fila de condado sigue cayendo en «No store» (por eso existe este paso)", () => {
    expect(leadDeFila(fila(), 0)).toMatchObject({ pool: "No store", site_city: "Hidalgo County", scope_of_work: null });
  });
  it("una fila con ciudad entra como siempre", () => {
    expect(leadDeFila(fila({ "City or County": "McAllen" }), 0)).toMatchObject({ pool: "RDZ McAllen", site_city: "McAllen", scope_of_work: null });
  });
});
