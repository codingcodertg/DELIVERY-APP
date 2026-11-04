import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { COLOR_SIN_ASIGNAR, colorDeChofer } from "./map-legend";
import { fallbackDriverColor } from "./utils";

/**
 * El color de cada chofer en el mapa de Entregas (D-274), y —desde D-520— que la leyenda del mapa ya no sale en ninguna
 * pantalla.
 *
 * **Nota D-520 (2026-10-11):** este fichero probaba sobre todo `leyendaDelMapa`: qué elementos salía, en qué orden, con qué
 * color y que la página le pasaba los mismos choferes que pintaba (seis pruebas). El dueño: «delete the lEGEND ON THE MAP of
 * the app». Con la leyenda se fueron la función, `MapLegend.tsx` y los dos colores que solo ella usaba (`COLOR_RECOGIDA`,
 * `COLOR_RUTA_ELEGIDA`), así que esas pruebas no tienen qué medir; en su lugar va la que fija que no vuelve. Las del color
 * del chofer y del cableado de la página siguen, porque el mapa sigue pintando con eso.
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

describe("D-520: el mapa ya no lleva leyenda, en ninguna pantalla", () => {
  // Todo el código de la app (sin pruebas): ni el componente, ni la función, ni la lista que la pintaba.
  const ficheros: string[] = [];
  const recorre = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) ficheros.push(p);
    }
  };
  recorre(join(process.cwd(), "src"));

  it("recorre el código de la app", () => {
    expect(ficheros.length).toBeGreaterThan(200);
  });
  it("ni `MapLegend` ni `leyendaDelMapa` ni la lista «Map legend» en el código", () => {
    expect(existsSync(join(process.cwd(), "src/components/MapLegend.tsx"))).toBe(false);
    for (const f of ficheros) {
      const codigo = sinComentarios(readFileSync(f, "utf8").split("\r\n").join("\n"));
      expect(codigo, f).not.toContain("MapLegend");
      expect(codigo, f).not.toContain("leyendaDelMapa");
      expect(codigo, f).not.toContain('"Map legend"');
    }
  });
  it("el Gestor, «Ruta de hoy» y «Mi ruta» montan la tarjeta del mapa sin nada debajo", () => {
    const gestor = sinComentarios(leer("src/app/(app)/routes/page.tsx"));
    // La tarjeta de «solo el mapa» (la de «Mi ruta», D-514): el `MapView` y se cierra.
    expect(gestor).toMatch(/onPointClick=\{\(id\) => soloElMapa\.alPulsarParada\?\.\(id\)\} \/>\n\s*<\/div>/);
    // La de la página entera (Gestor y «Ruta de hoy»): tras el `MapView`, la tarjeta se cierra.
    expect(gestor).toMatch(/if \(d\) toggleOrder\(d\.id\);\n\s*\}\} \/>\n\s*<\/div>/);
  });
});

describe("la página pinta con el color del chofer", () => {
  // Puesto al día por D-481: «Ruta de hoy» (map/page.tsx) monta la página del Gestor en solo lectura.
  const pagina = sinComentarios(leer("src/app/(app)/routes/page.tsx"));
  const mapa = sinComentarios(leer("src/app/(app)/map/page.tsx"));

  it("los puntos: `colorFor` es `colorDeChofer` con `settings.driver_colors`, y los puntos salen de `conPunto`", () => {
    expect(pagina).toContain("const colorFor = (driver: string | null) => colorDeChofer(settings.driver_colors, driver);");
    // **Reemplazado en parte por D-467** (2026-10-04): la página es «Ruta de hoy» y sus puntos los pinta
    // `puntosDeLasRutas` (lib/mapa-de-rutas), el mismo del Gestor, con el `colorFor` que ella le pasa.
    expect(pagina).toContain("colorDe: colorFor, colorSinChofer: UNASSIGNED_COLOR,");
    expect(pagina).toContain(`const UNASSIGNED_COLOR = "${COLOR_SIN_ASIGNAR}";`);
    expect(leer("src/lib/mapa-de-rutas.ts")).toContain("color: sel ? colorMarcada(d.id) : e.colorDe(d.assigned_driver),");
  });

  it("los camiones, solo para quien los ve", () => {
    // D-467: la ruta azul de la orden elegida y su «P» oscura se fueron con el panel de asignar; la página ya no las pinta.
    for (const ido of ["COLOR_RUTA_ELEGIDA", "COLOR_RECOGIDA", "showRoutes"]) expect(pagina, ido).not.toContain(ido);
    expect(pagina).toMatch(/const liveDrivers = useMemo\(\(\) => \{\n\s*if \(!veCamiones\) return \[\];/);
  });

  it("el gris de lo sin chofer no queda suelto en «Ruta de hoy»", () => {
    // Puesto al día por D-481: «Ruta de hoy» ya no tiene código propio (el Gestor guarda sus colores de antes).
    expect(mapa).not.toContain(COLOR_SIN_ASIGNAR);
  });

  it("los dos motores pintan la tienda sin papel con `casaDeTienda`", () => {
    for (const f of ["src/components/LeafletMap.tsx", "src/components/GoogleMapView.tsx"]) {
      // Desde D-348 el color no se escribe en los motores: lo lleva dentro `casaDeTienda`, que lee `TIENDA_CLASICA.fill`.
      expect(sinComentarios(leer(f)), f).toContain("casaDeTienda()");
    }
    // Y esta página no le da papel a ninguna tienda: `useStoreMarkers` no lo pone.
    expect(sinComentarios(leer("src/lib/useStoreMarkers.ts"))).not.toContain("papel");
  });
});
