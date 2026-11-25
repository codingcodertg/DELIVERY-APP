import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Leads con el estilo de Merma (Operaciones): sin cabecera ni tarjeta; tres filas sobre el fondo. */
const p = readFileSync(join(process.cwd(), "src/app/leads/Leads.tsx"), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(join(process.cwd(), "src/app/leads/leads.css"), "utf8").replace(/\r\n/g, "\n");

describe("Leads · estilo de Merma", () => {
  it("sin el título grande: ya no está «Building-permit leads» ni el «🎯 Leads» en un h1", () => {
    expect(p).not.toContain("Building-permit leads");
    expect(p).not.toContain("<h1>");
    expect(p).not.toContain("ld-sub");
  });

  it("fila 1: la pestaña va en el bloque de la barra (data-leads-en-la-barra); el selector de tienda va en la fila de filtros, tras «Match customers»", () => {
    // Con la barra a la vista, el bloque sube a su hueco por un portal; sin barra, va dentro de data-fila-de-filtros.
    const bloque = p.indexOf("const bloque = (");
    const pestanaBanco = p.indexOf('data-pestana="banco"');
    const finBloque = p.indexOf("const refrescar = (");
    const fila = p.indexOf("data-fila-de-filtros");
    const coincide = p.indexOf("data-coinciden");
    const selector = p.indexOf("{enPoolTab && selectorDeTienda}");
    expect(bloque).toBeGreaterThan(0);
    expect(pestanaBanco).toBeGreaterThan(bloque);
    expect(pestanaBanco).toBeLessThan(finBloque);
    expect(selector).toBeGreaterThan(coincide);
    expect(selector).toBeGreaterThan(fila);
    expect(p).toContain("data-leads-en-la-barra");
    expect(fila).toBeGreaterThan(finBloque);
    expect(p).toContain("{!hueco && bloque}");
  });

  it("el título de la lista va después de la fila 1 y lleva la cuenta (data-cuenta-banco)", () => {
    const titulo = p.indexOf('<h3 className="ld-titulo-de-lista">');
    expect(titulo).toBeGreaterThan(p.indexOf("data-fila-de-filtros"));
    expect(p.slice(titulo, titulo + 260)).toContain('<span className="count-tag" data-cuenta-banco>{visibles.length}</span>');
    expect(p).toContain('t("Leads in this pool", "Leads en este pool")');
    expect(p).not.toContain('<p className="hint" data-cuenta-banco>');
  });

  it("fila 2: las etapas van en UNA línea (filters-oneline) y están después de las pestañas", () => {
    expect(p).toContain('<div className="ld-etapas filters-oneline" role="group"');
    expect(p.indexOf('<div className="ld-etapas filters-oneline"')).toBeGreaterThan(p.indexOf('data-pestana="banco"'));
  });

  it("fila 3: data-barra tiene el buscador, los filtros (data-vendedor) y «Quitar filtros», en ese orden", () => {
    const barra = p.indexOf('<div className="ld-barra" data-barra>');
    const busca = p.indexOf("data-busca", barra);
    const vendedor = p.indexOf("data-vendedor", barra);
    const quitar = p.indexOf("data-quitar-filtros", barra);
    expect(barra).toBeGreaterThan(p.indexOf('<div className="ld-etapas filters-oneline"'));
    expect(busca).toBeGreaterThan(barra);
    expect(vendedor).toBeGreaterThan(busca);
    expect(quitar).toBeGreaterThan(vendedor);
  });

  it("el envoltorio de los filtros ya no es una tarjeta (sin la clase card), pero conserva ld-filtros", () => {
    expect(p).not.toContain('className="card ld-filtros"');
    expect(p).toContain('<div className="ld-filtros">');
  });

  it("las selects compactas dicen su nombre en aria-label y en title, y la tienda lleva su 🏬", () => {
    expect(p).toContain('aria-label={t("Rep", "Vendedor")} title={t("Rep", "Vendedor")}');
    expect(p).toContain('aria-label={t("Sort by", "Ordenar por")} title={t("Sort by", "Ordenar por")}');
    expect(p).toContain('<span aria-hidden="true">🏬</span>');
  });

  it("el CSS nuevo va antes del bloque de la ayuda 253 y fuerza la fila de etapas en una línea", () => {
    const bloque = css.indexOf("Estilo de Merma (rama leads/estilo-merma)");
    const fin = css.indexOf("/* 253 (ayuda e207d9ef)");
    expect(bloque).toBeGreaterThan(0);
    expect(bloque).toBeLessThan(fin);
    expect(css.slice(bloque, fin)).toContain(".leads-app .ld-filtros > .ld-etapas.filters-oneline { flex-wrap: nowrap;");
    expect(css.slice(bloque, fin)).toContain(".leads-app .ld-filtros .ld-barra input[type=\"search\"]");
  });
});
