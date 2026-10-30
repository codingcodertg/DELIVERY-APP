import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** «Permisos» del expediente: cada permiso en una fila casilla · texto, pase lo que pase con «del rol» (D-NEXT, 2026-10-29). */

const css = readFileSync(join(process.cwd(), "src/app/recruiting/recruiting.css"), "utf8").split("\r\n").join("\n");
const bloque = css.slice(css.indexOf(".recruiting-module .permisos-del-empleado .perm-opt {"), css.indexOf(".recruiting-module .permisos-del-empleado .card {"));

describe("la tarjeta de permiso dentro de RR. HH.", () => {
  it("dos columnas (casilla · texto), y el texto es un bloque, no `display: contents`", () => {
    expect(bloque).toContain("grid-template-columns: 18px minmax(0, 1fr); align-items: start;");
    expect(bloque).toContain(".perm-opt > span { display: block; min-width: 0; }");
    expect(css).not.toContain(".permisos-del-empleado .perm-opt > span { display: contents; }");
    expect(css).not.toContain("grid-template-columns: 18px minmax(160px, 220px) 1fr");
  });
  it("«del rol» va en línea con el nombre y la descripción debajo, con saltos de línea normales", () => {
    expect(bloque).toContain(".perm-opt .sema { display: inline-flex; width: auto;");
    expect(bloque).toContain(".perm-opt .hint { display: block; margin: 2px 0 0; font-size: 12px; white-space: normal; }");
    expect(css).not.toContain(".permisos-del-empleado .perm-opt .hint { grid-column: 2; }");
  });
});
