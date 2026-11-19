import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { esRutaDeTarjeta } from "./ruta";

describe("esRutaDeTarjeta: qué segmento casado es la tarjeta pública", () => {
  it("cuenta el segmento de la tarjeta, su editor y lo que cuelga de ella", () => {
    expect(esRutaDeTarjeta("tarjeta")).toBe(true);
  });

  it("no toma por tarjeta las rutas del hub, ni la raíz, ni nombres que solo empiezan igual", () => {
    expect(esRutaDeTarjeta("tarjetas")).toBe(false);
    expect(esRutaDeTarjeta("surveys")).toBe(false);
    expect(esRutaDeTarjeta("")).toBe(false);
    expect(esRutaDeTarjeta(null)).toBe(false);
  });
});

describe("el layout raíz monta el chrome del hub a través del gate", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");

  it("envuelve el proveedor de preferencias y cada trozo del chrome con los componentes de HubSegunRuta", () => {
    expect(layout).toContain("<PrefsSegunRuta>");
    expect(layout).toContain("<SoloEnHub>");
    expect(layout).not.toMatch(/<PrefsProvider>/);
  });
});
