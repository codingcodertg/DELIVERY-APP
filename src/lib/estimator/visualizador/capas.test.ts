import { describe, expect, it } from "vitest";
import { CAPAS, ORDEN_DE_INSTALACION, capaDe, capasHastaPaso } from "./capas";

describe("capas de la regadera (la lámina del dueño)", () => {
  it("los números 1 a 14 aparecen una sola vez, con sus nombres de la lámina", () => {
    const numeros = CAPAS.map((c) => c.numero).filter((n): n is number => n !== null).sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(capaDe("membrana").nombre.es).toBe("Membrana para base (cuero de marrano)");
    expect(capaDe("tablero").nombre.en).toBe("Backerboard");
    expect(capaDe("impermeable").nombre.es).toBe("Impermeabilizante");
    expect(capaDe("silicon").numero).toBe(14);
  });

  it("base y coladera no llevan número (la lámina no las numera)", () => {
    expect(capaDe("base-mortero").numero).toBeNull();
    expect(capaDe("coladera").numero).toBeNull();
  });

  it("cada capa tiene id único y nombre y descripción en inglés y español", () => {
    expect(new Set(CAPAS.map((c) => c.id)).size).toBe(CAPAS.length);
    for (const c of CAPAS) {
      expect(c.nombre.en && c.nombre.es && c.que.en && c.que.es).toBeTruthy();
    }
  });

  it("el orden de instalación: base, coladera, membrana, cama, tablero, tornillos, malla, impermeable, adhesivo, piso, niveladores, pared, salpicadero, perfiles, boquilla, silicón", () => {
    expect(ORDEN_DE_INSTALACION).toEqual([
      "base-mortero", "coladera", "membrana", "mortero-final", "tablero", "tornillos", "malla", "impermeable",
      "adhesivo", "loseta-piso", "niveladores", "loseta-pared", "salpicadero", "perfiles", "boquilla", "silicon",
    ]);
  });

  it("el orden respeta la lógica de obra: membrana antes que la cama, la cama antes que el tablero, impermeable antes que la loseta, boquilla y silicón al final", () => {
    const pos = (id: string) => ORDEN_DE_INSTALACION.indexOf(id as (typeof ORDEN_DE_INSTALACION)[number]);
    expect(pos("membrana")).toBeLessThan(pos("mortero-final"));
    expect(pos("mortero-final")).toBeLessThan(pos("tablero"));
    expect(pos("impermeable")).toBeLessThan(pos("adhesivo"));
    expect(pos("adhesivo")).toBeLessThan(pos("loseta-pared"));
    expect(pos("boquilla")).toBeLessThan(pos("silicon"));
    expect(pos("silicon")).toBe(ORDEN_DE_INSTALACION.length - 1);
  });

  it("capasHastaPaso devuelve las primeras N capas en orden, y acota los extremos", () => {
    expect(capasHastaPaso(0)).toEqual([]);
    expect(capasHastaPaso(3)).toEqual(["base-mortero", "coladera", "membrana"]);
    expect(capasHastaPaso(99)).toHaveLength(CAPAS.length);
    expect(capasHastaPaso(-4)).toEqual([]);
  });
});
