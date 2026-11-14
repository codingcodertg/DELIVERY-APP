import { describe, expect, it } from "vitest";
import {
  alturaDeLaPendiente, bloqueDeLaLoseta, bloqueDelPatron, dimensionesDeLaEscena, distanciaNormalizada, extremosExpuestos,
  juntasDePaneles, panelesDePared, paredesDeLaDisposicion, repeticionDeLaSuperficie, tamanoEnPulgadas, tornillosEnPanel,
} from "./geometria";

describe("paredesDeLaDisposicion (2, 3 y 4 paredes, las mismas que la calculadora)", () => {
  // El perímetro que cuenta la calculadora: 2 paredes = L + W; 3 = L + 2W; 4 = 2L + 2W.
  it.each([
    ["2 Walls", 2, 5 + 3],
    ["3 Walls", 3, 5 + 2 * 3],
    ["4 Walls", 4, 2 * 5 + 2 * 3],
  ] as const)("%s: %i paredes con el mismo perímetro que la calculadora", (disp, n, perimetro) => {
    const paredes = paredesDeLaDisposicion(disp, 5, 3);
    expect(paredes).toHaveLength(n);
    const suma = paredes.reduce((acc, p) => acc + p.largo, 0);
    expect(suma).toBeCloseTo(perimetro, 9);
  });

  it("las normales apuntan siempre hacia dentro del cuarto", () => {
    for (const disp of ["2 Walls", "3 Walls", "4 Walls"] as const) {
      const L = 5, W = 3;
      for (const p of paredesDeLaDisposicion(disp, L, W)) {
        const medio = { x: (p.inicio.x + p.fin.x) / 2, z: (p.inicio.z + p.fin.z) / 2 };
        const hacia = { x: L / 2 - medio.x, z: W / 2 - medio.z };
        expect(p.hacia.x * hacia.x + p.hacia.z * hacia.z).toBeGreaterThan(0);
        expect(Math.hypot(p.hacia.x, p.hacia.z)).toBeCloseTo(1, 9);
      }
    }
  });
});

describe("extremosExpuestos (dónde van los perfiles de loseta)", () => {
  it("4 paredes: ninguna esquina queda a la vista", () => {
    expect(extremosExpuestos(paredesDeLaDisposicion("4 Walls", 5, 3))).toHaveLength(0);
  });

  it("3 paredes: los dos frentes de las laterales", () => {
    const salida = extremosExpuestos(paredesDeLaDisposicion("3 Walls", 5, 3));
    expect(salida.map((e) => e.punto).sort((a, b) => a.x - b.x)).toEqual([{ x: 0, z: 3 }, { x: 5, z: 3 }]);
  });

  it("2 paredes: el extremo de la trasera en L y el frente de la izquierda", () => {
    const salida = extremosExpuestos(paredesDeLaDisposicion("2 Walls", 5, 3));
    const puntos = salida.map((e) => `${e.punto.x},${e.punto.z}`).sort();
    expect(puntos).toEqual(["0,3", "5,0"]);
  });
});

describe("paneles de tablero, juntas y tornillos", () => {
  it("5 ft de largo con paneles de 3 ft: uno completo y uno de 2 ft (se corta en obra)", () => {
    const paneles = panelesDePared(5, 8, 3, 5);
    // Dos columnas × dos filas: 3+2 de ancho, 5+3 de alto.
    expect(paneles).toHaveLength(4);
    expect(paneles.map((p) => p.x1 - p.x0)).toEqual([3, 2, 3, 2]);
    expect(paneles.map((p) => p.y1 - p.y0)).toEqual([5, 5, 3, 3]);
  });

  it("las juntas caen donde empieza cada panel nuevo", () => {
    const j = juntasDePaneles(5, 8, 3, 5);
    expect(j.verticales).toEqual([3]);
    expect(j.horizontales).toEqual([5]);
  });

  it("los tornillos salen exactamente como se piden, dentro del panel", () => {
    for (const n of [1, 7, 30, 575]) {
      const r = tornillosEnPanel(n, 3, 5);
      expect(r.puntos).toHaveLength(n);
      for (const p of r.puntos) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(3);
        expect(p.z).toBeGreaterThan(0);
        expect(p.z).toBeLessThan(5);
      }
    }
  });

  it("30 tornillos en un panel de 3×5 forman una rejilla pareja (no una sola fila)", () => {
    const r = tornillosEnPanel(30, 3, 5);
    expect(r.columnas).toBeGreaterThan(1);
    expect(r.filas).toBeGreaterThan(1);
  });
});

describe("repetición de la loseta según su tamaño", () => {
  it("12x24 sobre 5 ft × 3 ft: 5 losetas de ancho y 1.5 de alto", () => {
    const bloque = bloqueDeLaLoseta(tamanoEnPulgadas("12x24"), "apilado");
    const r = repeticionDeLaSuperficie(bloque, 5, 3);
    expect(r.x).toBeCloseTo(5, 9);
    expect(r.y).toBeCloseTo(1.5, 9);
  });

  it("el patrón de medio desfase duplica la altura del bloque (dos hileras)", () => {
    expect(bloqueDeLaLoseta([24, 48], "medio")).toEqual({ anchoIn: 24, altoIn: 96 });
    expect(bloqueDelPatron("medio").desfases).toEqual([0, 0.5]);
  });

  it("el patrón de tercio tiene tres hileras, cada una corrida 1/3", () => {
    const p = bloqueDelPatron("tercio");
    expect(p.hileras).toBe(3);
    expect(p.desfases[1]).toBeCloseTo(1 / 3, 9);
    expect(p.desfases[2]).toBeCloseTo(2 / 3, 9);
  });

  it("todos los tamaños de la calculadora se leen bien", () => {
    expect(tamanoEnPulgadas("7x22")).toEqual([7, 22]);
    expect(tamanoEnPulgadas("17x17")).toEqual([17, 17]);
    expect(tamanoEnPulgadas("8x36")).toEqual([8, 36]);
  });
});

describe("base con pendiente", () => {
  it("la coladera está en el centro (d=0) y la esquina en d=1", () => {
    expect(distanciaNormalizada(2.5, 1.5, 5, 3)).toBeCloseTo(0, 9);
    expect(distanciaNormalizada(0, 0, 5, 3)).toBeCloseTo(1, 9);
  });

  it("la base es más baja en la coladera que en la esquina", () => {
    expect(alturaDeLaPendiente(0, 1)).toBeLessThan(alturaDeLaPendiente(1, 1));
    expect(alturaDeLaPendiente(0, 1)).toBeCloseTo((1 / 12) * 0.2, 9);
    expect(alturaDeLaPendiente(1, 1)).toBeCloseTo((1 / 12) * 1.8, 9);
  });
});

describe("dimensiones de la escena (vienen de la calculadora)", () => {
  it("usa tal cual las medidas de la calculadora", () => {
    const d = dimensionesDeLaEscena({ proyecto: "Shower", disposicion: "3 Walls", largoFt: 5, anchoFt: 3, altoFt: 8 });
    expect(d).toEqual({ proyecto: "Shower", disposicion: "3 Walls", largoFt: 5, anchoFt: 3, altoFt: 8, avisos: [] });
  });

  it("una medida en 0 se dibuja a 1 ft y avisa cuál fue", () => {
    const d = dimensionesDeLaEscena({ proyecto: "Shower", disposicion: "2 Walls", largoFt: 0, anchoFt: 3, altoFt: Number.NaN });
    expect(d.largoFt).toBe(1);
    expect(d.altoFt).toBe(1);
    expect(d.avisos).toEqual(["largo", "alto"]);
  });
});
