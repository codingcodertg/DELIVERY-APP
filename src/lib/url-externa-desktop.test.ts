import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

// `desktop/url-externa.js` es CommonJS (lo carga Electron). Se importa tal cual para probar lo que de verdad usa `main.js`.
const require = createRequire(import.meta.url);
const { esUrlExterna } = require("../../desktop/url-externa.js") as { esUrlExterna: (u: string) => boolean };

describe("desktop: esUrlExterna (lo que se abre con el navegador del sistema)", () => {
  it("deja pasar http, https, mailto y tel", () => {
    expect(esUrlExterna("https://maps.google.com/?q=Dallas")).toBe(true);
    expect(esUrlExterna("http://example.com")).toBe(true);
    expect(esUrlExterna("mailto:ana@empresa.com")).toBe(true);
    expect(esUrlExterna("tel:+12145551234")).toBe(true);
  });

  it("descarta esquemas que ejecutan o abren cosas en la máquina", () => {
    expect(esUrlExterna("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(esUrlExterna("ms-officecmd:whatever")).toBe(false);
    expect(esUrlExterna("javascript:alert(1)")).toBe(false);
    expect(esUrlExterna("data:text/html,hola")).toBe(false);
    expect(esUrlExterna("smb://servidor/recurso")).toBe(false);
    expect(esUrlExterna("rcapp://r/call?number=1")).toBe(false);
  });

  it("descarta lo que no es una URL", () => {
    expect(esUrlExterna("")).toBe(false);
    expect(esUrlExterna("no es una url")).toBe(false);
    expect(esUrlExterna(undefined as unknown as string)).toBe(false);
  });
});
