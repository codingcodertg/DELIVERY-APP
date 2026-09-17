import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_RECOGIDA, COLOR_RUTA_ELEGIDA, COLOR_SIN_ASIGNAR, colorDeChofer, leyendaDelMapa } from "./map-legend";
import { TIENDA_CLASICA } from "./store-pins";
import { fallbackDriverColor } from "./utils";

/**
 * La leyenda del mapa de Entregas (D-NEXT). Lo que importa es que diga lo mismo que el mapa pinta: por
 * eso la mitad de estas pruebas leen la página y los dos motores de mapa, y comprueban que pintan con lo
 * mismo que lee la leyenda.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

describe("el color de un chofer", () => {
  it("sin chofer, el gris; con color puesto, ese; sin color puesto, el de la paleta", () => {
    expect(colorDeChofer({ Zoe: "#abcdef" }, null)).toBe(COLOR_SIN_ASIGNAR);
    expect(colorDeChofer({ Zoe: "#abcdef" }, "")).toBe(COLOR_SIN_ASIGNAR);
    expect(colorDeChofer({ Zoe: "#abcdef" }, "Zoe")).toBe("#abcdef");
    expect(colorDeChofer({ Zoe: "#abcdef" }, "Ana")).toBe(fallbackDriverColor("Ana"));
    expect(colorDeChofer(undefined, "Ana")).toBe(fallbackDriverColor("Ana"));
  });
});

describe("qué sale en la leyenda", () => {
  // Desordenados, repetidos y con los tres «sin chofer» que puede traer una orden: la leyenda no
  // puede salir bien por casualidad del orden de entrada.
  const choferes = ["Zoe", null, "Ana", "Zoe", "", undefined];
  const colores = { Zoe: "#abcdef" };

  it("la tienda, un punto por chofer, por nombre y sin repetir, y un gris si alguno no tiene", () => {
    const l = leyendaDelMapa({ choferes, coloresDeChofer: colores, rutasSinChofer: false, puedeAsignar: false });
    expect(l.map((e) => [e.clave, "color" in e ? e.color : null])).toEqual([
      ["tienda", TIENDA_CLASICA.fill],
      ["chofer:Ana", fallbackDriverColor("Ana")],
      ["chofer:Zoe", "#abcdef"],
      ["sin_chofer", COLOR_SIN_ASIGNAR],
    ]);
  });

  it("sin órdenes sin chofer, no hay gris", () => {
    const l = leyendaDelMapa({ choferes: ["Ana"], coloresDeChofer: colores, rutasSinChofer: false, puedeAsignar: false });
    expect(l.map((e) => e.clave)).toEqual(["tienda", "chofer:Ana"]);
  });

  it("la ruta discontinua solo si el mapa la está dibujando", () => {
    const con = leyendaDelMapa({ choferes: [], coloresDeChofer: {}, rutasSinChofer: true, puedeAsignar: false });
    expect(con.find((e) => e.clave === "ruta_sin_chofer")).toEqual(expect.objectContaining({ forma: "linea", color: COLOR_SIN_ASIGNAR, discontinua: true }));
    const sin = leyendaDelMapa({ choferes: [], coloresDeChofer: {}, rutasSinChofer: false, puedeAsignar: false });
    expect(sin.find((e) => e.clave === "ruta_sin_chofer")).toBeUndefined();
  });

  it("quien asigna ve además la ruta elegida, la recogida y el camión; ventas no", () => {
    const asigna = leyendaDelMapa({ choferes: [], coloresDeChofer: {}, rutasSinChofer: false, puedeAsignar: true });
    expect(asigna.map((e) => e.clave)).toEqual(["tienda", "ruta_elegida", "recogida", "camion"]);
    expect(asigna.find((e) => e.clave === "ruta_elegida")).toEqual(expect.objectContaining({ color: COLOR_RUTA_ELEGIDA, discontinua: false }));
    expect(asigna.find((e) => e.clave === "recogida")).toEqual(expect.objectContaining({ forma: "pin", color: COLOR_RECOGIDA, insignia: "P" }));
    const ventas = leyendaDelMapa({ choferes: [], coloresDeChofer: {}, rutasSinChofer: false, puedeAsignar: false });
    expect(ventas.map((e) => e.clave)).toEqual(["tienda"]);
  });

  it("cada elemento dice lo suyo en los dos idiomas", () => {
    for (const e of leyendaDelMapa({ choferes, coloresDeChofer: colores, rutasSinChofer: true, puedeAsignar: true })) {
      expect(e.en.trim(), e.clave).not.toBe("");
      expect(e.es.trim(), e.clave).not.toBe("");
      expect(e.en, e.clave).not.toBe(e.es);
    }
  });
});

describe("la página pinta con lo mismo que lee la leyenda", () => {
  const pagina = sinComentarios(leer("src/app/(app)/map/page.tsx"));

  it("los puntos: `colorFor` es `colorDeChofer` con `settings.driver_colors`, y los puntos salen de `conPunto`", () => {
    expect(pagina).toContain("const colorFor = (driver: string | null) => colorDeChofer(settings.driver_colors, driver);");
    expect(pagina).toMatch(/const pts: MapPoint\[\] = conPunto\n\s*\.map\(\(d\) => \(\{[\s\S]{0,120}?color: colorFor\(d\.assigned_driver\),/);
  });

  it("la leyenda recibe los mismos choferes, los mismos colores y las mismas condiciones que el dibujo", () => {
    const llamada = pagina.slice(pagina.indexOf("leyendaDelMapa({"), pagina.indexOf("leyendaDelMapa({") + 260);
    expect(llamada).toContain("choferes: conPunto.map((d) => d.assigned_driver),");
    expect(llamada).toContain("coloresDeChofer: settings.driver_colors,");
    expect(llamada).toContain("rutasSinChofer: showRoutes && unassignedOrders.length > 0,");
    expect(llamada).toContain("puedeAsignar: canAssign,");
    expect(pagina).toContain("<MapLegend elementos={leyenda} />");
  });

  it("las líneas, la recogida y los camiones usan las constantes y las condiciones de la leyenda", () => {
    expect(pagina).toMatch(/color: COLOR_SIN_ASIGNAR, positions: pos, dashed: true/);
    expect(pagina).toMatch(/color: COLOR_RUTA_ELEGIDA, positions: pos \}/);
    expect(pagina).toMatch(/color: COLOR_RECOGIDA, label: [^\n]*badge: "P"/);
    // Los camiones solo para quien asigna: lo mismo que `puedeAsignar`.
    expect(pagina).toMatch(/const liveDrivers = useMemo\(\(\) => \{\n\s*if \(!canAssign\) return \[\];/);
  });

  it("ninguno de los tres colores queda suelto en la página", () => {
    for (const hex of [COLOR_SIN_ASIGNAR, COLOR_RECOGIDA, COLOR_RUTA_ELEGIDA]) expect(pagina, hex).not.toContain(hex);
  });

  it("los dos motores pintan la tienda sin papel con `TIENDA_CLASICA`, el color de la leyenda", () => {
    for (const f of ["src/components/LeafletMap.tsx", "src/components/GoogleMapView.tsx"]) {
      expect(sinComentarios(leer(f)), f).toContain("TIENDA_CLASICA.fill");
    }
    // Y esta página no le da papel a ninguna tienda: `useStoreMarkers` no lo pone.
    expect(sinComentarios(leer("src/lib/useStoreMarkers.ts"))).not.toContain("papel");
  });
});
