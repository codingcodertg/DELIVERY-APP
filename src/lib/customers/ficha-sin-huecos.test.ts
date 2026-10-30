import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** La ficha de cliente sin huecos: tarjetas que fluyen en columnas, cada una con su alto (D-745, 2026-10-29). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("las tarjetas de la ficha", () => {
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  it("van en columnas que fluyen (CSS columns), no en una rejilla que estira cada fila a la tarjeta más alta", () => {
    expect(ficha).toContain('<div className="gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid" data-tarjetas-de-la-ficha>');
    expect(ficha).not.toContain('className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"');
  });
  it("la tarjeta apilada de D-681 («Campos ocultos» y «Archivos») sigue dentro del mismo contenedor", () => {
    const desde = ficha.indexOf("data-tarjetas-de-la-ficha");
    const tramo = ficha.slice(desde, ficha.indexOf("data-solo-no-vendedor"));
    expect(desde).toBeGreaterThan(0);
    expect(tramo).toContain("filasPorGrupo()");
    expect(tramo).not.toContain("</div>\n    </div>");
  });
});
