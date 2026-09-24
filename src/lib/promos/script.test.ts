import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El script con el que se cargan las rondas (`scripts/promos/cargar.mjs`).
 *
 * Es impuro por definición —abre ficheros y escribe en la base—, así que lo que se puede sostener
 * sin correrlo es **quién llama a qué y en qué orden**. Va en su fichero y no dentro de
 * `subida.test.ts` a propósito: son ramas distintas tocando el mismo módulo, y dos ramas editando
 * el mismo fichero de pruebas es un conflicto que no hace falta.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const script = leer("scripts/promos/cargar.mjs");
const readme = leer("scripts/promos/README.md");

describe("el script usa la app, no una copia de la app", () => {
  it("importa los MISMOS módulos puros", () => {
    // Es lo único que garantiza que el script y la pantalla no se separen: el día que el libro
    // cambie de forma, cambia en un sitio. Una copia del lector se habría quedado atrás sin que
    // nada fallara y sin que nadie se enterara hasta que una ronda entrara mal.
    expect(script).toContain('await import("../../src/lib/promos/excel.ts")');
    expect(script).toContain('await import("../../src/lib/promos/libro.ts")');
    expect(script).toContain('await import("../../src/lib/promos/subida.ts")');
  });

  it("y no se ha traído el trabajo aquí", () => {
    // Ni encabezados del libro, ni reglas de celda, ni una segunda definición de lo que ya existe.
    expect(script).not.toContain("Unified Code");
    expect(script).not.toMatch(/function (leePromo|leeLibro|disposicionDe|filasParaGuardar)/);
  });
});

describe("no escribe sin que se lo pidan", () => {
  it("la bandera es la única forma", () => {
    expect(script).toContain('const ESCRIBE = bandera("escribir");');
  });

  it("las tres escrituras están DESPUÉS del corte del modo lectura", () => {
    // Se mide por posición y no por «existe un if»: cualquiera de las tres por encima de la salida
    // del modo lectura sería una escritura sin bandera, y leerlo no lo habría cazado.
    const corte = script.indexOf("Esto ha sido solo una lectura");
    expect(corte).toBeGreaterThan(-1);
    for (const escritura of ['.from("promo_rounds")', '.from("promo_products")', '.from("promo_suggestions")']) {
      expect(script.indexOf(escritura), escritura).toBeGreaterThan(corte);
    }
  });

  it("y mirar un libro NO pide la llave de servicio", () => {
    // Comprobar un Excel no debería exigir la llave que escribe.
    expect(script).toContain("if (ESCRIBE && !base) {");
    expect(script).toContain("if (URL_BASE && LLAVE) {");
  });

  it("`--grupos` se rechaza al escribir: al escribir, los grupos son los de Ajustes", () => {
    // Una lista escrita a mano metería sugerencias de grupos que en la base no existen.
    expect(script).toContain("if (ESCRIBE && gruposAMano.length) {");
  });
});

describe("lo más parecido a una transacción que da supabase-js", () => {
  it("la ronda NACE CERRADA", () => {
    // `closed_at` significa en la 140 «esta ronda no se decide», y el disparador rechaza toda
    // escritura de decisión mientras lo esté. Una carga interrumpida deja una ronda cerrada con el
    // catálogo a medias —sobre la que nadie puede aprobar— en vez de una abierta a medio llenar.
    expect(script).toContain("closed_at: ahora }");
  });

  it("y solo se abre DESPUÉS de contar las filas", () => {
    const iContar = script.indexOf("nProductos !== productos.length");
    const iAbrir = script.indexOf(".update({ closed_at: null })");
    expect(iContar).toBeGreaterThan(-1);
    expect(iAbrir).toBeGreaterThan(-1);
    expect(iAbrir).toBeGreaterThan(iContar);
  });

  it("si un paso falla, borra la ronda", () => {
    expect(script).toContain('await base.from("promo_rounds").delete().eq("id", id);');
  });

  it("no inventa ninguna columna: `closed_at` ya existía", () => {
    const sql = leer("supabase/migrations/140_promos.sql");
    expect(sql).toContain("closed_at    timestamptz,");
    // Y el script no pide ninguna que la 140 no tenga.
    expect(script).not.toMatch(/incompleta|loading|is_complete/);
  });
});

describe("el README sirve a quien no estuvo", () => {
  it("dice cómo se detecta una ronda coja y cómo se borra", () => {
    // Las rondas dependerán de quién esté; esto tiene que servirle a una sesión que no estuvo.
    expect(readme).toContain("NO HAY TRANSACCIÓN");
    expect(readme).toContain("delete from public.promo_rounds where id =");
    expect(readme).toContain("from public.promo_products    p where p.round_id = r.id");
  });

  it("y avisa de que borrar una ronda se lleva las decisiones", () => {
    expect(readme).toContain("y sus decisiones");
  });

  it("dice qué Node hace falta y por qué sale el aviso", () => {
    expect(readme).toContain("Node 22.6");
    expect(readme).toContain("MODULE_TYPELESS_PACKAGE_JSON");
    // Y que NO se arregla poniendo `"type": "module"` en todo el proyecto.
    expect(readme).toContain("No se le pone");
  });

  it("el script comprueba la versión de Node antes de importar nada con tipos", () => {
    const iVersion = script.indexOf("process.versions.node.split");
    const iImport = script.indexOf('await import("../../src/lib/promos/excel.ts")');
    expect(iVersion).toBeGreaterThan(-1);
    expect(iImport).toBeGreaterThan(-1);
    expect(iVersion).toBeLessThan(iImport);
  });
});
