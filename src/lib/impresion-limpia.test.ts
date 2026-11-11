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
      for (const m of txt.matchAll(/@page\s*\{([^}]*)\}/g)) {
        if (!/margin\s*:\s*0\s*;?/.test(m[1])) malos.push(`${f.slice(raiz.length)}: ${m[0]}`);
      }
    }
    expect(malos).toEqual([]);
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
