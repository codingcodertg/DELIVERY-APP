import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSS_IMPRESION_LIMPIA } from "./impresion-limpia";

/**
 * Auditoría de impresión (dueño, 10 nov): nada de lo que se imprime puede llevar la URL de la app, el título o la fecha
 * que pinta el navegador. Eso exige que TODO `@page` de la app tenga margen 0, y que cada documento que se abre en
 * ventana aparte para imprimir traiga la regla limpia.
 */
const raiz = join(process.cwd(), "src");
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(css|ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("impresión limpia en toda la app", () => {
  it("todo @page tiene margen 0 (si no, el navegador imprime URL, título y fecha)", () => {
    const malos: string[] = [];
    for (const f of archivos(raiz)) {
      const txt = readFileSync(f, "utf8");
      for (const m of txt.matchAll(/@page(?:\s+[\w-]+)?\s*\{([^}]*)\}/g)) {
        if (!/margin\s*:\s*0\s*;?/.test(m[1])) malos.push(`${f.slice(raiz.length)}: ${m[0]}`);
      }
    }
    expect(malos).toEqual([]);
  });
  it("D-1021: ninguna hoja de estilos esconde TODA la página al imprimir sin atarse a su propia hoja", () => {
    // Next deja cargado el CSS de una ruta al pasar a otra sin recargar. Un «body * { display: none }» suelto en el
    // @media print de una app deja en blanco lo que se imprime en las demás (así salía en blanco la cotización después
    // de pasar por Operaciones). Tiene que ir atado: «body:has(.mi-hoja) * { … }». Lo mismo un `@page` con tamaño: con
    // nombre (`@page mi-hoja { … }` + `page: mi-hoja`), o le cambia el papel a todas las apps.
    const malos: string[] = [];
    for (const f of archivos(raiz).filter((x) => x.endsWith(".css"))) {
      const txt = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of txt.matchAll(/(?:^|[;{}])\s*((?:html\s+)?body\s*>?\s*\*[^{}]*)\{[^}]*(?:visibility\s*:\s*hidden|display\s*:\s*none)/g)) {
        malos.push(`${f.slice(raiz.length)}: ${m[1].trim()}`);
      }
      for (const m of txt.matchAll(/@page\s*\{([^}]*)\}/g)) {
        if (/\bsize\s*:/.test(m[1])) malos.push(`${f.slice(raiz.length)}: ${m[0]}`);
      }
    }
    expect(malos).toEqual([]);
  });
  it("D-1021: manifiesto y exportación imprimen por el marco oculto (en la app de escritorio no hay window.open)", () => {
    for (const f of ["lib/export.ts", "lib/manifest.ts"]) {
      const txt = readFileSync(join(raiz, f), "utf8");
      expect({ f, abre: /=\s*window\.open\(/.test(txt) }).toEqual({ f, abre: false });
      expect(txt).toContain("imprimeDocumento(html)");
    }
  });
  it("globals.css pone la regla general", () => {
    const g = readFileSync(join(raiz, "app/globals.css"), "utf8");
    expect(g).toMatch(/@media print \{\s*@page \{ margin: 0; \}/);
  });
  it("cada ventana de impresión inyecta la regla limpia", () => {
    for (const f of ["lib/export.ts", "lib/manifest.ts", "lib/slip.ts", "lib/timetracker/talon-de-pago.ts"]) {
      const txt = readFileSync(join(raiz, f), "utf8");
      const heads = txt.match(/<\/head>/g)?.length ?? 0;
      const limpias = txt.match(/\$\{ESTILO_IMPRESION_LIMPIA\}<\/head>/g)?.length ?? 0;
      expect({ f, limpias }).toEqual({ f, limpias: heads });
    }
    expect(CSS_IMPRESION_LIMPIA).toContain("@page{margin:0}");
  });
});
