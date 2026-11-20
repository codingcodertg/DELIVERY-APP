import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rotuloDeVelocidad, siguienteVelocidad, velocidadGuardada } from "./velocidad-de-audio";

describe("la velocidad de las grabaciones de RingCentral", () => {
  it("el botón pasa 1 → 1.5 → 2 → 1", () => {
    expect(siguienteVelocidad(1)).toBe(1.5);
    expect(siguienteVelocidad(1.5)).toBe(2);
    expect(siguienteVelocidad(2)).toBe(1);
    expect(siguienteVelocidad(7)).toBe(1);
  });
  it("lo guardado solo vale si es una de la lista", () => {
    expect(velocidadGuardada("1.5")).toBe(1.5);
    expect(velocidadGuardada("3")).toBe(1);
    expect(velocidadGuardada(null)).toBe(1);
    expect(velocidadGuardada("x")).toBe(1);
  });
  it("el rótulo y el botón a la vista junto al reproductor", () => {
    expect(rotuloDeVelocidad(1.5)).toBe("1.5×");
    const c = readFileSync("src/components/ringcentral/ReproductorDeGrabacion.tsx", "utf8");
    expect(c).toContain("data-velocidad-de-audio");
    expect(c).toContain("playbackRate");
  });
});
