import { describe, expect, it } from "vitest";
import { ANCHO_ESCRITORIO, contenidoDelViewport } from "./vista-escritorio";

describe("Desktop view en el teléfono (junta 2026-11-20)", () => {
  it("escritorio dibuja a 1280 px; móvil vuelve al ancho del teléfono", () => {
    expect(contenidoDelViewport(true)).toContain(`width=${ANCHO_ESCRITORIO}`);
    expect(contenidoDelViewport(false)).toContain("width=device-width");
    expect(contenidoDelViewport(false)).toContain("initial-scale=1");
  });
});
