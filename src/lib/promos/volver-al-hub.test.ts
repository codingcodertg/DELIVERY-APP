import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D-378: al quitar la lista de rondas (D-375) se fue el único enlace de vuelta, y el dueño lo notó
// el mismo día. Las dos salidas de la página de la ronda —demo y base— lo llevan.
const fuente = readFileSync("src/app/promos/[id]/page.tsx", "utf8").split("\r\n").join("\n");

describe("la ronda de promos tiene cómo volver al hub", () => {
  it("el enlace va a /home", () => {
    expect(fuente).toMatch(/function VolverAlHub\(\)[\s\S]*<Link href="\/home"/);
  });

  it("y sale en las dos pantallas de la ronda, la de demo y la de verdad", () => {
    expect(fuente.split("<VolverAlHub />").length - 1).toBe(2);
    expect(fuente.indexOf("<VolverAlHub />")).toBeLessThan(fuente.indexOf("<RondaDemo"));
    expect(fuente.lastIndexOf("<VolverAlHub />")).toBeLessThan(fuente.indexOf("<TablaDeRonda"));
    expect(fuente.lastIndexOf("<VolverAlHub />")).toBeGreaterThan(fuente.indexOf("<RondaDemo"));
  });
});
