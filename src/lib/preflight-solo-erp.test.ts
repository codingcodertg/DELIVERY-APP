import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generaPreflightErp, ORIGEN, versionInstalada } from "../../scripts/css/genera-preflight-erp.mjs";

/**
 * D-788: el preflight de Tailwind solo viste al ERP y a Clientes, aunque su hoja siga cargada al navegar a otra
 * pantalla. Medido en el demo antes del arreglo: `input` en `/` con borde 1px; tras pasar por `/customers` en la
 * misma pestaña, 0px y radio 0 en `/` y en `/estimator`.
 */
const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

describe("el preflight de Tailwind, acotado al ERP", () => {
  it("erp.css ya no importa tailwindcss entero: tema y utilidades por capas, y el preflight acotado", () => {
    const css = leer("src/app/erp/erp.css");
    expect(css).not.toMatch(/@import\s+"tailwindcss";/);
    expect(css).toContain('@import "tailwindcss/theme.css" layer(theme);');
    expect(css).toContain('@import "./preflight-erp.css";');
    expect(css).toContain('@import "tailwindcss/utilities.css" layer(utilities);');
  });
  it("el generado es el preflight instalado anidado bajo [data-app=\"erp\"], sin una línea de más ni de menos", () => {
    const esperado = generaPreflightErp(readFileSync(ORIGEN, "utf8"), versionInstalada());
    expect(leer("src/app/erp/preflight-erp.css")).toBe(esperado);
  });
  it("lo que Tailwind pone en html pasa a la raíz del ERP, y el reset universal queda dentro", () => {
    const g = leer("src/app/erp/preflight-erp.css");
    expect(g).toMatch(/@layer base \{\s*\[data-app="erp"\] \{/);
    expect(g).not.toMatch(/^\s*html,/m);
    expect(g).toContain("    &,\n    :host {");
    expect(g).toContain("border: 0 solid;");
  });
});
