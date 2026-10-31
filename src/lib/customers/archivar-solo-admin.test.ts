import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { puedeArchivar, puedeAsignarVendedores } from "./reglas";

/** Archivar un cliente: un botón bajo «Editar», con «¿seguro?», y solo del admin (D-NEXT). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("puedeArchivar", () => {
  it("solo el admin; ni gerente, ni ventas, ni oficina, ni contabilidad, ni sin rol", () => {
    expect(puedeArchivar("admin")).toBe(true);
    for (const r of ["manager", "sales", "accounting", "driver", null, undefined] as const) expect(puedeArchivar(r), String(r)).toBe(false);
    expect(puedeArchivar("admin")).toBe(puedeAsignarVendedores("admin"));
  });
});

describe("la ficha del cliente", () => {
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  it("tiene UN botón «Archivar» (y uno «Desarchivar»), bajo «Editar», dentro de la cabecera, y solo con puedeArchivar", () => {
    expect(ficha.split("data-archivar>")).toHaveLength(2);
    expect(ficha.split("data-desarchivar>")).toHaveLength(2);
    const editar = ficha.indexOf("data-editar-en-la-ventana");
    const archivar = ficha.indexOf("data-archivar>");
    const cerrar = ficha.indexOf("data-cerrar-ficha");
    expect(editar).toBeGreaterThan(0);
    expect(archivar).toBeGreaterThan(editar);
    expect(archivar).toBeLessThan(cerrar);
    const bloque = ficha.slice(editar, cerrar);
    expect(bloque).toContain("{puedeArchivar && !nuevo && (archivado ? (");
  });
  it("pregunta «¿seguro?» antes de archivar y archiva sin motivo; ya no hay «Archivar…» abajo ni panel del motivo", () => {
    expect(ficha).toContain('if (nuevo || !puedeArchivar) return;');
    expect(ficha).toMatch(/const archivar = async \(\) => \{[\s\S]*?window\.confirm\([\s\S]*?¿Seguro que quieres archivar[\s\S]*?parcheArchivar\(""\)/);
    expect(ficha).not.toContain('"Archivar…"');
    expect(ficha).not.toContain("Why is it archived?");
    expect(ficha).not.toContain("MOTIVOS_DE_ARCHIVO");
    expect(ficha).not.toContain("setArchivando");
  });
  it("la página pasa puedeArchivar(role) y Clientes lo entrega a la ventana", () => {
    const pagina = sinComentarios(leer("src/app/customers/page.tsx"));
    expect(pagina).toContain("puedeArchivar={puedeArchivar(role)}");
    const clientes = sinComentarios(leer("src/app/customers/Clientes.tsx"));
    expect(clientes).toContain("puedeArchivar={puedeArchivar}");
  });
});
