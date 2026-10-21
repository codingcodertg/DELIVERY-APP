import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-617 (2026-10-20) · El dueño: «Need the rows to be more narrow in the route manager view … like how it is in the Orders tab».

describe("la tabla de paradas del Gestor tiene filas compactas", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  it("sin alto fijo y con relleno de 3 px; los controles de la fila, a su mínimo", () => {
    expect(css).toContain("table.orders.tabla-de-paradas tbody td { height: auto; padding-top: 3px; padding-bottom: 3px; line-height: 1.25; }");
    expect(css).toContain("table.orders.tabla-de-paradas tbody td .btn-sm { padding: 2px 6px;");
    expect(css).toContain("table.orders.tabla-de-paradas tbody td select.btn-sm { padding: 2px 4px; height: 24px; }");
    expect(css).not.toContain("table.orders.tabla-de-paradas tbody td { height: 34px; }");
  });
  it("en el teléfono las filas siguen siendo pulsables (relleno de 8 px)", () => {
    expect(css).toContain("@media (max-width: 640px) { table.orders.tabla-de-paradas tbody td { padding-top: 8px; padding-bottom: 8px; } }");
  });
});
