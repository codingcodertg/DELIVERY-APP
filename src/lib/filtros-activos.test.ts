import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { columnasFiltradas, hayFiltros, textoDeColumnas } from "./filtros-activos";

// «Se me olvida que tengo un filtro» (D-297). Columnas inventadas.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ORDEN = ["stage", "type", "store", "date"];

describe("columnasFiltradas", () => {
  it("las que filtran, y ninguna más", () => {
    const filtros = { stage: new Set(["a"]), store: new Set(["b", "c"]) };
    expect(columnasFiltradas(filtros, ORDEN)).toEqual(["stage", "store"]);
    expect(hayFiltros(filtros, ORDEN)).toBe(true);
  });

  it("un conjunto vacío no filtra nada, así que no cuenta", () => {
    // Pasa de verdad: vaciar un filtro desde su menú puede dejar la clave con un conjunto vacío.
    expect(columnasFiltradas({ stage: new Set() }, ORDEN)).toEqual([]);
    expect(hayFiltros({ stage: new Set() }, ORDEN)).toBe(false);
    expect(hayFiltros({}, ORDEN)).toBe(false);
  });

  it("el orden es el de las columnas, no el de cuándo se filtró", () => {
    // `date` se filtró antes que `stage`, y aun así se nombra después: es como se leen en la tabla.
    const filtros = { date: new Set(["x"]), stage: new Set(["y"]) };
    expect(columnasFiltradas(filtros, ORDEN)).toEqual(["stage", "date"]);
  });

  it("una columna que ya no se enseña no se nombra", () => {
    // Las columnas se pueden quitar desde «⚙ Columnas»; su filtro deja de aplicar, así que
    // anunciarlo mandaría a buscar algo que no está.
    expect(columnasFiltradas({ fee: new Set(["z"]) }, ORDEN)).toEqual([]);
  });
});

describe("textoDeColumnas", () => {
  const y = "y";
  const mas = (n: number) => `${n} más`;

  it("una, dos y tres se nombran enteras", () => {
    expect(textoDeColumnas(["Etapa"], y, mas)).toBe("Etapa");
    expect(textoDeColumnas(["Etapa", "Tienda"], y, mas)).toBe("Etapa y Tienda");
    expect(textoDeColumnas(["Etapa", "Tienda", "Fecha"], y, mas)).toBe("Etapa, Tienda y Fecha");
  });

  it("a partir de la cuarta se corta y se dice cuántas quedan", () => {
    expect(textoDeColumnas(["A", "B", "C", "D"], y, mas)).toBe("A, B, C y 1 más");
    expect(textoDeColumnas(["A", "B", "C", "D", "E"], y, mas)).toBe("A, B, C y 2 más");
  });

  it("sin columnas, no hay texto", () => {
    expect(textoDeColumnas([], y, mas)).toBe("");
  });
});

describe("la barra en la tabla", () => {
  const tabla = plano(leer("src/components/OrdersTable.tsx"));
  const css = leer("src/app/globals.css");

  it("solo sale cuando hay filtros puestos", () => {
    expect(tabla).toContain("{filtradas.length > 0 && (");
    expect(tabla).toContain('className="filtros-puestos"');
  });

  it("dice qué columnas están filtradas, con sus nombres", () => {
    expect(tabla).toContain("const filtradas = columnasFiltradas(filters, cols.map((c) => c.key));");
    expect(tabla).toContain("textoDeColumnas(nombresFiltrados,");
    expect(tabla).toContain('t("Filtered by", "Filtrado por")');
    // El nombre de cada columna, en el idioma de quien mira, como el resto de la tabla. Se mira
    // DENTRO del cálculo de los nombres: ese mismo texto sale en las cabeceras, así que buscarlo
    // en todo el fichero pasaba aunque este bloque dejara de traducir. Medido con un mutante.
    const nombres = tabla.slice(tabla.indexOf("const nombresFiltrados"), tabla.indexOf("});", tabla.indexOf("const nombresFiltrados")));
    expect(nombres).toContain('lang === "es" ? col.es : col.en');
  });

  it("el botón limpia TODOS los filtros de una vez", () => {
    const barra = tabla.slice(tabla.indexOf('className="filtros-puestos"'), tabla.indexOf('<div className="tbl-scroll'));
    expect(barra).toContain("onClick={() => setFilters({})}");
    expect(barra).toContain('t("Clear filters", "Limpiar filtros")');
  });

  it("va ENCIMA de la tabla, que es donde se mira antes de leer filas", () => {
    expect(tabla.indexOf('className="filtros-puestos"')).toBeLessThan(tabla.indexOf('<div className="tbl-scroll'));
  });

  it("y tiene su estilo, sin colores escritos en la página", () => {
    expect(css).toContain(".filtros-puestos {");
    // Los colores salen de los tokens de la paleta, que es lo que respeta el modo oscuro.
    const bloque = css.slice(css.indexOf(".filtros-puestos {"), css.indexOf("/* ---------- Table header"));
    expect(bloque).toContain("var(--amber-soft)");
    expect(bloque).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
