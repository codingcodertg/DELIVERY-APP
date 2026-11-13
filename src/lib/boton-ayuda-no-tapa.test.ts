import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** D-1008: la burbuja «?» no tapa los botones de abajo de una tarjeta (dueño, 12 nov). */
describe("la burbuja de ayuda no tapa la tarjeta abierta", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  it("con una tarjeta abierta la burbuja se encoge y la tarjeta deja hueco abajo", () => {
    expect(css).toMatch(/:root:has\(\.overlay\) \.fab-general-caja/);
    expect(css).toMatch(/\.overlay \.modal \{ padding-bottom: calc\(22px \+ 56px \+ env\(safe-area-inset-bottom/);
  });
  it("respeta la barra del sistema del teléfono", () => {
    expect(css).toMatch(/bottom: max\(20px, calc\(env\(safe-area-inset-bottom/);
  });
});
