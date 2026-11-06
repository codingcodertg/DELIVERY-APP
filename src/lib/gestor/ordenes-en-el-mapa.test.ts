import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_SIN_ASIGNAR, colorDeChofer } from "../map-legend";
import { ordenesEnElMapa, tieneUbicacion } from "./ordenes-en-el-mapa";

// Ayuda 042c7dc1 (Roberto, 2026-11-06, en `/routes` → «Órdenes sin asignar»): «When looking at orders would like option to
// see in map».
const orden = (id: string, lat: number | null, lng: number | null, chofer: string | null = null) =>
  ({ id, delivery_lat: lat, delivery_lng: lng, assigned_driver: chofer, account: `Cuenta ${id}` });
const etiqueta = (o: { id: string }) => `#${o.id}`;

describe("tieneUbicacion", () => {
  it("pide las dos coordenadas, finitas y dentro del rango", () => {
    expect(tieneUbicacion(orden("a", 26.2, -98.2))).toBe(true);
    expect(tieneUbicacion(orden("a", null, -98.2))).toBe(false);
    expect(tieneUbicacion(orden("a", 26.2, null))).toBe(false);
    expect(tieneUbicacion({ id: "a" })).toBe(false);
    expect(tieneUbicacion(orden("a", Number.NaN, -98.2))).toBe(false);
    expect(tieneUbicacion(orden("a", 126.2, -98.2))).toBe(false);
    expect(tieneUbicacion(orden("a", 26.2, -198.2))).toBe(false);
  });
  it("el (0, 0) de un dato vacío no es una ubicación", () => {
    expect(tieneUbicacion(orden("a", 0, 0))).toBe(false);
  });
});

describe("ordenesEnElMapa", () => {
  it("un pin por orden con ubicación, en el orden de la lista, con su id y su etiqueta", () => {
    const r = ordenesEnElMapa([orden("1", 26.1, -98.1), orden("2", 26.2, -98.2)], { etiqueta });
    expect(r.puntos.map((p) => [p.id, p.lat, p.lng, p.label])).toEqual([["1", 26.1, -98.1, "#1"], ["2", 26.2, -98.2, "#2"]]);
    expect(r.encuadre).toEqual([[26.1, -98.1], [26.2, -98.2]]);
    expect(r.sinUbicacion).toEqual([]);
  });

  it("las que no tienen ubicación no se pierden: salen aparte, y pines + sin ubicación suman la lista", () => {
    const filas = [orden("1", 26.1, -98.1), orden("2", null, null), orden("3", 26.3, -98.3), orden("4", 0, 0)];
    const r = ordenesEnElMapa(filas, { etiqueta });
    expect(r.puntos.map((p) => p.id)).toEqual(["1", "3"]);
    expect(r.sinUbicacion.map((o) => o.id)).toEqual(["2", "4"]);
    expect(r.puntos.length + r.sinUbicacion.length).toBe(filas.length);
  });

  it("ninguna con ubicación: cero pines, encuadre vacío y todas listadas", () => {
    const r = ordenesEnElMapa([orden("1", null, null), orden("2", null, null)], { etiqueta });
    expect(r.puntos).toEqual([]);
    expect(r.encuadre).toEqual([]);
    expect(r.sinUbicacion).toHaveLength(2);
  });

  it("el color es el del chofer en el mapa del Gestor, y gris sin chofer", () => {
    const colores = { Ana: "#123456" };
    const r = ordenesEnElMapa([orden("1", 26.1, -98.1), orden("2", 26.2, -98.2, "Ana"), orden("3", 26.3, -98.3, "Beto")], { coloresDeChofer: colores, etiqueta });
    expect(r.puntos.map((p) => p.color)).toEqual([COLOR_SIN_ASIGNAR, "#123456", colorDeChofer(colores, "Beto")]);
  });

  it("dos órdenes en la misma dirección se abren en abanico; la que está sola no se mueve", () => {
    const r = ordenesEnElMapa([orden("1", 26.1, -98.1), orden("2", 26.1, -98.1), orden("3", 26.3, -98.3)], { etiqueta });
    const [a, b, c] = r.puntos;
    expect(a.offset).toBeDefined();
    expect(b.offset).toBeDefined();
    expect(a.offset).not.toEqual(b.offset);
    expect(c.offset).toBeUndefined();
  });

  it("una orden repetida en la lista sale una sola vez", () => {
    const r = ordenesEnElMapa([orden("1", 26.1, -98.1), orden("1", 26.1, -98.1)], { etiqueta });
    expect(r.puntos).toHaveLength(1);
    expect(r.puntos[0].offset).toBeUndefined();
  });

  it("la lista vacía no revienta", () => {
    expect(ordenesEnElMapa([], { etiqueta })).toEqual({ puntos: [], sinUbicacion: [], encuadre: [] });
  });
});

describe("la página del Gestor monta el mapa de la lista", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  const trozo = (desde: string, hasta: string) => {
    const i = pagina.indexOf(desde);
    expect(i, desde).toBeGreaterThan(-1);
    const j = pagina.indexOf(hasta, i);
    expect(j, hasta).toBeGreaterThan(i);
    return pagina.slice(i, j);
  };
  const mapa = trozo("const mapaDeLasOrdenes = ", "const tablaDeOrdenes = ");

  it("el botón está en la tabla que comparten «Sin asignar» y «Todas», y dice si está puesto", () => {
    const tabla = trozo("const tablaDeOrdenes = ", "const vistaDeSinAsignar");
    expect(tabla).toContain("data-ordenes-en-mapa={vista.clave}");
    expect(tabla).toContain("aria-pressed={ordenesEnMapa}");
  });

  it("pinta las filas VISIBLES de la lista: su chip, su búsqueda y sus filtros de columna", () => {
    expect(pagina).toContain("{ordenesEnMapa && mapaDeLasOrdenes(vista.clave, orden.visibles)}");
  });

  it("usa el mapa del Gestor (MapView) y pulsar un pin abre la orden aquí, con la regla de la factura", () => {
    expect(mapa).toContain("<MapView points={puntos}");
    expect(mapa).toContain("onPointClick={abre}");
    expect(mapa).toContain("abreLaOrden(d)");
    expect(mapa).not.toContain("router.");
    expect(mapa).not.toContain("href=");
  });

  it("cuenta y lista las que no tienen ubicación", () => {
    expect(mapa).toContain("data-sin-ubicacion={sinUbicacion.length}");
    expect(mapa).toContain("data-orden-sin-ubicacion={d.id}");
  });

  it("solo mira: no asigna, no mueve ni escribe nada", () => {
    for (const escribe of ["updateDelivery", "manualAssign", "bulkAssign", "pasaA(", "setSelectedOrders", "toggleOrder"]) expect(mapa, escribe).not.toContain(escribe);
  });
});
