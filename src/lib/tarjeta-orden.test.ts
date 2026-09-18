import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// La tarjeta de una orden en el teléfono: tres filas en vez de cuatro (D-298).
//
// Lo que se puede medir aquí es el marcado y las reglas; el alto se midió en Chrome con este mismo
// CSS, y los números están en la entrada de DECISIONS.md: 4 filas y 104px antes, 3 y 89px después.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const tabla = leer("src/components/OrdersTable.tsx");
const css = leer("src/app/globals.css");
/** El bloque del teléfono, que es donde la tabla se vuelve tarjetas. */
const movil = css.slice(css.indexOf("@media (max-width: 640px)"), css.indexOf("@media (max-width: 420px)"));

describe("la casilla deja de llevarse una fila entera", () => {
  it("la fila dice si lleva casilla, y solo cuando la lleva", () => {
    expect(plano(tabla)).toContain('+ (selectable ? " con-casilla" : "")');
  });

  it("la casilla se ancla en la primera línea, no en su propia fila", () => {
    const regla = movil.slice(movil.indexOf("tr.con-casilla td.sel-cell {"), movil.indexOf("}", movil.indexOf("tr.con-casilla td.sel-cell {")));
    expect(regla).toContain("position: absolute");
    expect(regla).toMatch(/top:\s*\d+px/);
    expect(regla).toMatch(/right:\s*\d+px/);
    // Y su fila es el marco de referencia; sin esto se anclaría a la página.
    expect(movil).toContain("table.orders-responsive tr.con-casilla { position: relative; }");
  });

  it("la factura le deja el hueco, para no quedar debajo", () => {
    // Medido en Chrome: con 20px la casilla pisaba el texto de la factura; con 26 no.
    expect(movil).toMatch(/tr\.con-casilla \.drv-head \.drv-inv \{ padding-right: 2[4-9]px; \}/);
  });

  it("y nada de esto toca a quien no tiene casilla: la vista del chofer se queda igual", () => {
    // Las tres reglas nuevas van acotadas a `con-casilla`. Sin eso, el chofer perdería ancho de
    // factura por un hueco para una casilla que no existe.
    for (const regla of ["td.sel-cell {", ".drv-head .drv-inv { padding-right", "tr.con-casilla { position: relative; }"]) {
      const i = movil.indexOf(regla);
      expect(i, regla).toBeGreaterThan(-1);
      const linea = movil.slice(movil.lastIndexOf("\n", i), i + regla.length);
      expect(linea, regla).toContain("con-casilla");
    }
  });
});

describe("no desaparece nada de la tarjeta", () => {
  const cabecera = plano(tabla.slice(tabla.indexOf('<span className="drv-head">'), tabla.indexOf("</span>\n        ) : (")));

  it("las tres líneas siguen llevando sus seis piezas", () => {
    expect(cabecera).toContain("stageLabel(d.stage, lang)");   // etapa
    expect(cabecera).toContain("INV {invoice}");                // documento
    expect(cabecera).toContain('className="row-type"');         // tipo
    expect(cabecera).toContain("fmtDateShort(d.delivery_date, lang)"); // fecha
    expect(cabecera).toContain('className="store-tag"');        // tienda
    expect(cabecera).toContain("ID #{orderLabel(d)}");           // id
  });

  it("y la casilla sigue estando en la fila", () => {
    expect(plano(tabla)).toContain('<td className="sel-cell"');
  });

  it("siguen siendo tres líneas: tres a la izquierda y tres a la derecha", () => {
    expect((cabecera.match(/className="drv-l"/g) ?? [])).toHaveLength(3);
    expect((cabecera.match(/className="drv-r/g) ?? [])).toHaveLength(3);
  });
});

describe("lo que no se rompe", () => {
  it("la clase de la tabla sigue escrita literal", () => {
    // La prueba del marco (D-281) cuenta contenedores buscando `<table className="…">` literal.
    // Poner ahí una expresión la dejaba contar 5 en vez de 6, sin que nada más se quejara: por eso
    // la marca de la casilla va en la FILA, que ya tenía clases condicionales.
    expect(tabla).toContain('<table className="orders tbl-resize orders-responsive">');
  });

  it("el bloque nuevo no trae colores escritos a mano", () => {
    // El recorte se ancla en cosas que NO cambian con el valor del hueco: si se anclara en «26px»,
    // cambiar ese número dejaría un recorte absurdo y esta prueba caería por el motivo equivocado.
    // Pasó, y lo enseñó un gemelo.
    const desde = movil.indexOf("La casilla no se lleva una fila");
    const hasta = movil.indexOf(".drv-head .drv-inv", desde);
    expect(desde, "falta el comentario del bloque").toBeGreaterThan(-1);
    expect(hasta, "falta la regla de la factura").toBeGreaterThan(desde);
    expect(movil.slice(desde, hasta)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
