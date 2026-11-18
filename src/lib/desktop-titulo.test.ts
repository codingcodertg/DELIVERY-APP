import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { tituloDeLaVentana } = require("../../desktop/titulo.js") as { tituloDeLaVentana: (t: string) => string };

describe("desktop: el título de la ventana (D-1085)", () => {
  it("firma «RTG Hub by iFloor» sin perder la sección del sitio", () => {
    expect(tituloDeLaVentana("RTG Hub | Order & Dispatch")).toBe("RTG Hub by iFloor | Order & Dispatch");
    expect(tituloDeLaVentana("RTG Hub")).toBe("RTG Hub by iFloor");
    expect(tituloDeLaVentana("")).toBe("RTG Hub by iFloor");
    expect(tituloDeLaVentana("Time Tracker")).toBe("RTG Hub by iFloor | Time Tracker");
    expect(tituloDeLaVentana("RTG Hub by iFloor | HR")).toBe("RTG Hub by iFloor | HR");
  });

  it("el instalador lleva titulo.js y el actualizador cierra de verdad", () => {
    expect(JSON.parse(readFileSync("desktop/package.json", "utf8")).build.files).toContain("titulo.js");
    const main = readFileSync("desktop/main.js", "utf8");
    expect(main).toContain("autoUpdater.quitAndInstall(true, true)");
    expect(main).toContain("w.destroy()");
    expect(main).toContain("setTimeout(() => app.exit(0), 5000)");
  });
});
