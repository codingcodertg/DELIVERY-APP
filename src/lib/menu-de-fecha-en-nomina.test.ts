import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// D-1207: Time Tracker no carga operaciones.css; el menú de fecha de Nómina lleva sus propios estilos (en el teléfono salía
// como una fila de botones que empujaba la página a los lados).
describe("menú de fecha de Nómina", () => {
  const css = readFileSync("src/app/timetracker/timetracker.css", "utf8");
  it("flota en columna, con la pantalla como tope de ancho", () => {
    expect(css).toMatch(/\.tt-nomina-en-la-pagina \.ops-menu-fecha-lista\{position:absolute;[^}]*max-width:calc\(100vw - 32px\);display:grid/);
    expect(css).toMatch(/\.tt-nomina-en-la-pagina \.ops-menu-fecha\{position:relative\}/);
    expect(css).toMatch(/\.tt-nomina-en-la-pagina \.ops-menu-fecha-opcion\{display:block;width:100%/);
  });
});
