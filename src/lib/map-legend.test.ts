import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLOR_RECOGIDA, COLOR_RUTA_ELEGIDA, COLOR_SIN_ASIGNAR, colorDeChofer, leyendaDelMapa } from "./map-legend";
import { TIENDA_CLASICA } from "./store-pins";
import { fallbackDriverColor } from "./utils";

/**
 * La leyenda del mapa de Entregas (D-274). Lo que importa es que diga lo mismo que el mapa pinta: por
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
    // **Reemplazado en parte por D-NEXT** (2026-10-04): la página es «Ruta de hoy» y sus puntos los pinta
    // `puntosDeLasRutas` (lib/mapa-de-rutas), el mismo del Gestor, con el `colorFor` que ella le pasa.
    expect(pagina).toContain("colorDe: colorFor, colorSinChofer: COLOR_SIN_ASIGNAR,");
    expect(leer("src/lib/mapa-de-rutas.ts")).toContain("color: sel ? colorMarcada(d.id) : e.colorDe(d.assigned_driver),");
    expect(pagina).toContain("const conPunto = paradas.filter((d) => d.delivery_lat != null && d.delivery_lng != null);");
  });

  it("la leyenda recibe los mismos choferes, los mismos colores y las mismas condiciones que el dibujo", () => {
    const llamada = pagina.slice(pagina.indexOf("leyendaDelMapa({"), pagina.indexOf("leyendaDelMapa({") + 260);
    expect(llamada).toContain("choferes: conPunto.map((d) => d.assigned_driver),");
    expect(llamada).toContain("coloresDeChofer: settings.driver_colors,");
    // D-NEXT: ya no hay rutas punteadas de lo sin chofer (costaban una llamada de mapas por orden) ni se asigna desde aquí;
    // la leyenda explica las marcas de una ruta (`rutasDelDia`) y nombra los camiones solo a quien los recibe (`veCamiones`).
    expect(llamada).toContain("rutasSinChofer: false,");
    expect(llamada).toContain("puedeAsignar: false,");
    expect(llamada).toContain("rutasDelDia: { camiones: veCamiones },");
    const deRutas = leyendaDelMapa({ choferes: ["Ana", null], coloresDeChofer: {}, rutasSinChofer: false, puedeAsignar: false, rutasDelDia: { camiones: true } });
    expect(deRutas.map((e) => e.clave)).toEqual(["tienda", "chofer:Ana", "sin_chofer", "recogida_de_ruta", "entrega_de_ruta", "entregada", "ruta_del_chofer", "regreso", "camion"]);
    expect(deRutas.find((e) => e.clave === "regreso")).toEqual(expect.objectContaining({ forma: "linea", discontinua: true }));
    // Ventas no recibe las posiciones: sin camión. Y lo de «elegir órdenes» no sale nunca en esta página.
    const sinCamion = leyendaDelMapa({ choferes: [], coloresDeChofer: {}, rutasSinChofer: false, puedeAsignar: true, rutasDelDia: { camiones: false } }).map((e) => e.clave);
    expect(sinCamion).toEqual(["tienda", "recogida_de_ruta", "entrega_de_ruta", "entregada", "ruta_del_chofer", "regreso"]);
    expect(pagina).toContain("<MapLegend elementos={leyenda} />");
  });

  it("las líneas, la recogida y los camiones usan las constantes y las condiciones de la leyenda", () => {
    // D-NEXT: la ruta azul de la orden elegida y su «P» oscura se fueron con el panel de asignar; la página ya no las pinta.
    for (const ido of ["COLOR_RUTA_ELEGIDA", "COLOR_RECOGIDA", "showRoutes"]) expect(pagina, ido).not.toContain(ido);
    // Los camiones solo para quien los ve: lo mismo que `puedeAsignar`.
    expect(pagina).toMatch(/const liveDrivers = useMemo\(\(\) => \{\n\s*if \(!veCamiones\) return \[\];/);
  });

  it("ninguno de los tres colores queda suelto en la página", () => {
    for (const hex of [COLOR_SIN_ASIGNAR, COLOR_RECOGIDA, COLOR_RUTA_ELEGIDA]) expect(pagina, hex).not.toContain(hex);
  });

  it("los dos motores pintan la tienda sin papel con `TIENDA_CLASICA`, el color de la leyenda", () => {
    for (const f of ["src/components/LeafletMap.tsx", "src/components/GoogleMapView.tsx"]) {
      // Desde D-348 el color no se escribe en los motores: lo lleva dentro `casaDeTienda`, que lee `TIENDA_CLASICA.fill`.
      expect(sinComentarios(leer(f)), f).toContain("casaDeTienda()");
    }
    // Y esta página no le da papel a ninguna tienda: `useStoreMarkers` no lo pone.
    expect(sinComentarios(leer("src/lib/useStoreMarkers.ts"))).not.toContain("papel");
  });
});
