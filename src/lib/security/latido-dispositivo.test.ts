import { describe, expect, it } from "vitest";
import { LATIDO_DISPOSITIVO_MS, MIN_ENTRE_RUTAS_MS, tocaAvisar } from "./latido-dispositivo";

describe("latido del dispositivo (Disk IO, D-1004)", () => {
  it("primera vez avisa", () => { expect(tocaAvisar(null, 5, false)).toBe(true); });
  it("cambio de ruta: solo tras 1 min", () => {
    expect(tocaAvisar(0, MIN_ENTRE_RUTAS_MS - 1, true)).toBe(false);
    expect(tocaAvisar(0, MIN_ENTRE_RUTAS_MS, true)).toBe(true);
  });
  it("reloj: cada 5 min", () => {
    expect(tocaAvisar(0, LATIDO_DISPOSITIVO_MS - 1, false)).toBe(false);
    expect(tocaAvisar(0, LATIDO_DISPOSITIVO_MS, false)).toBe(true);
  });
});
