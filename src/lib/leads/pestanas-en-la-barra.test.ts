import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Las pestañas, la tienda y la semana de Leads suben a la barra de arriba, a la derecha del nombre de la app (como
// Operaciones con su hueco). Esta prueba lee las hojas como texto: el portal, la vuelta a la fila si no hay barra, y las
// reglas de CSS que dejan el bloque pegado a la derecha y en una fila propia en el teléfono.
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const p = leer("src/app/leads/Leads.tsx");
const css = leer("src/app/leads/leads.css");
const globalCss = leer("src/app/globals.css");

describe("Leads: pestañas, tienda y semana en la barra de arriba", () => {
  it("importa el hueco de la barra y createPortal", () => {
    expect(p).toContain('import { createPortal } from "react-dom";');
    expect(p).toContain('import { HUECO_DE_LA_BARRA } from "@/components/BarraDeApp";');
    expect(p).toContain('document.getElementById(HUECO_DE_LA_BARRA)');
  });

  it("el portal lleva un bloque data-leads-en-la-barra con las pestañas y el selector de tienda", () => {
    expect(p).toContain("{hueco && createPortal(bloque, hueco)}");
    const bloque = p.slice(p.indexOf("const bloque = ("), p.indexOf("const refrescar = ("));
    expect(bloque).toContain('<div className="ld-en-la-barra" data-leads-en-la-barra>');
    expect(bloque).not.toContain('data-pestana="privado"');
    expect(bloque).toContain('data-pestana="banco"');
    expect(bloque).toContain("<select data-pool ");
    expect(bloque).toContain("<select data-semana ");
  });

  it("si no hay barra (primer pintado o página sin ella), el mismo bloque vuelve a su fila", () => {
    expect(p).toContain("(!hueco || !enPoolTab)");
    expect(p).toContain('<div className="ld-fila-de-filtros" data-fila-de-filtros>');
    expect(p).toContain("{!hueco && bloque}");
  });

  it("Actualizar sigue en la página: al final de la fila del título, con la barra; en Admin y Estadísticas, en la fila", () => {
    expect(p).toContain('<div className="ld-titulo-fila">');
    expect(p).toContain("{hueco && refrescar}");
    expect(p).toContain("{refrescar}");
  });

  it("leads.css: el hueco se estira y reparte a la derecha", () => {
    expect(css).toContain(".topbar-hueco:has(.ld-en-la-barra)");
    const regla = css.slice(css.indexOf(".topbar-hueco:has(.ld-en-la-barra)"));
    expect(regla.slice(0, regla.indexOf("}"))).toContain("justify-content: flex-end");
    expect(regla.slice(0, regla.indexOf("}"))).toContain("flex: 1 1 auto");
  });

  it("leads.css: a 700 px o menos el bloque baja a su fila dentro de la barra, con la barra reservando ese alto", () => {
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain(".topbar .topbar-hueco:has(.ld-en-la-barra) { position: absolute;");
    expect(css).toContain(".topbar:has(.ld-en-la-barra) { position: relative; padding-bottom: 98px; }");
  });

  it("globals.css: la marca crece solo cuando el bloque está", () => {
    expect(globalCss).toContain(".topbar .entregas-marca:has(.ld-en-la-barra)");
  });

  it("leads.css no toca la marca (esa regla va en globals.css, que es la hoja que puede nombrarla)", () => {
    expect(css).not.toContain("entregas-marca");
  });
});
