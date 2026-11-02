import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-NEXT: la cotización impresa sin cabecera ni pie del navegador (fecha, título, URL, «1/5») y sin páginas en
 * blanco detrás. El dueño, con el PDF: «REMOVE» en las dos cosas.
 */
const css = readFileSync(join(process.cwd(), "src/app/estimator/estimator.css"), "utf8").replace(/\r\n/g, "\n");
const print = css.slice(css.indexOf("@media print"));

describe("la cotización impresa, limpia", () => {
  it("el margen de página es cero (así el navegador no pinta su cabecera ni su pie) y el margen lo lleva la hoja", () => {
    expect(print).toContain("@page { margin: 0; }");
    expect(print).toMatch(/\.hoja-cliente \{[^}]*padding: 16mm;/);
  });
  it("lo que no es la hoja se quita del flujo, no solo se esconde; la hoja deja de flotar", () => {
    expect(print).toContain("body *:not(.hoja-cliente):not(.hoja-cliente *):not(:has(.hoja-cliente)) { display: none !important; }");
    expect(print).toMatch(/\.hoja-cliente \{ position: static;/);
    expect(print).not.toContain("position: absolute");
  });
});
