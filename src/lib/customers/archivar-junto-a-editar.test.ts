import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** D-NEXT: «Archivar» en la misma fila que «Editar», al lado (el dueño, con captura de la ficha). */
const ficha = readFileSync(join(process.cwd(), "src/app/customers/FichaDeCliente.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("archivar junto a editar", () => {
  it("los dos botones van en una fila, no en columna", () => {
    const i = ficha.indexOf("data-acciones-de-la-ficha");
    expect(i).toBeGreaterThan(0);
    const bloque = ficha.slice(ficha.lastIndexOf("<div", i), ficha.indexOf("</div>", i));
    expect(bloque).toContain("flex-row");
    expect(bloque).not.toContain("flex-col");
    expect(bloque).toContain("data-editar-en-la-ventana");
    expect(bloque).toContain("data-archivar");
  });
});
