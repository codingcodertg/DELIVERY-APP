import { describe, expect, it } from "vitest";
import {
  AJUSTES_META, AJUSTES_POR_DEFECTO, ENTRADAS_POR_DEFECTO, USO_DE_ENTRADAS, USO_DE_AJUSTES, calcular, camposQueAplican,
  type AjustesCalculadora, type EntradasCalculadora, type ResultadoCalculadora, type TipoDeProyecto,
} from "./calculadora-material";

const con = (tipo: TipoDeProyecto, ajustes: Partial<AjustesCalculadora> = {}) =>
  camposQueAplican(tipo, { ...AJUSTES_POR_DEFECTO, ...ajustes });

/** Lo que cuenta para los totales: áreas y, por fila, la cantidad sin redondear y lo que se vende. */
const totales = (r: ResultadoCalculadora) => ({
  areas: r.areas,
  filas: r.filas.map((f) => [f.clave, f.cantidad, f.venta]),
});

describe("ducha: qué se muestra", () => {
  const s = con("Shower");

  it("campos de medida de ducha (largo, ancho, alto, disposición, liner, mortero, salpicadero), sin editor de piso ni de pared", () => {
    expect(s.entradas).toEqual([
      "proyecto", "largoFt", "anchoFt", "altoFt", "disposicion", "aberturasSf", "morteroProfundidadIn",
      "cajaParedSf", "cajaPisoSf", "tamanoPared", "tamanoPiso", "juntaParedIn", "juntaPisoIn",
      "subidaLinerIn", "bordeExtraLinerIn", "bordeExpuestoLf", "salpicaderoLargoFt", "salpicaderoAltoFt",
    ]);
    expect(s.entradas).not.toContain("habitaciones");
    expect(s.entradas).not.toContain("muros");
  });

  it("filas: todas las de ducha, sin pendiente (C33 = 0)", () => {
    expect(s.filas).toEqual([
      "liner", "mortero", "tablero", "tornillos", "malla", "impermeable", "pegamento-pared", "pegamento-piso",
      "loseta-pared", "loseta-piso", "lechada", "silicon", "perfil", "clips", "cunas", "coladera",
    ]);
  });

  it("con C33 = 1 aparece la pendiente", () => {
    expect(con("Shower", { preslopeIncluido: 1 }).filas).toContain("pendiente");
  });

  it("áreas: piso, pared, perímetro y paneles", () => {
    expect(s.areas).toEqual(["pisoSf", "paredSf", "perimetroLf", "tablerosPaneles"]);
  });

  it("ajustes de ducha (mortero, pendiente, tablero, silicón); no los de solo pared ni los que la hoja no usa", () => {
    expect(s.ajustes).toEqual(expect.arrayContaining(["morteroPiesCubicosPorBolsa", "preslopeIncluido", "tablerosExtra", "siliconaLfPorTubo"]));
    expect(s.ajustes).not.toContain("tableroEnSoloPared");
    expect(s.ajustes).not.toContain("impermeableEnSoloPared");
    expect(s.ajustes).not.toContain("tableroCoberturaSf");
  });

  it("la nota del liner aplica", () => {
    expect(s.notaDeLiner).toBe(true);
  });
});

describe("piso: qué se muestra", () => {
  const p = con("Flooring Only");

  it("solo el editor de habitaciones y los campos de piso (loseta, junta, borde); nada de ducha ni de pared", () => {
    expect(p.entradas).toEqual(["proyecto", "cajaPisoSf", "tamanoPiso", "juntaPisoIn", "bordeExpuestoLf", "habitaciones"]);
  });

  it("filas: pegamento, loseta, lechada, perfil, clips y cuñas de piso", () => {
    expect(p.filas).toEqual(["pegamento-piso", "loseta-piso", "lechada", "perfil", "clips", "cunas"]);
  });

  it("área: solo piso", () => {
    expect(p.areas).toEqual(["pisoSf"]);
  });

  it("ajustes de piso; no los de pared ni de ducha", () => {
    expect(p.ajustes).toEqual(expect.arrayContaining(["adhesivoPisoSfPorBolsa", "clipsPorSf", "clipsPorPaquete", "cunasPorPaquete", "lechadaProfundidadPisoIn"]));
    for (const clave of ["tornillosPorTablero", "adhesivoParedSfPorBolsa", "lechadaProfundidadParedIn", "siliconaLfPorTubo", "morteroPiesCubicosPorBolsa", "tableroAltoFt"] as const) {
      expect(p.ajustes).not.toContain(clave);
    }
  });

  it("sin nota de liner", () => {
    expect(p.notaDeLiner).toBe(false);
  });
});

describe("pared: qué se muestra", () => {
  it("con los interruptores en 0: solo el editor de muros, los campos de pared y el salpicadero", () => {
    const w = con("Wall Only");
    expect(w.entradas).toEqual([
      "proyecto", "cajaParedSf", "tamanoPared", "juntaParedIn", "bordeExpuestoLf", "salpicaderoLargoFt", "salpicaderoAltoFt", "muros",
    ]);
    expect(w.filas).toEqual(["pegamento-pared", "loseta-pared", "lechada", "silicon", "perfil"]);
    expect(w.areas).toEqual(["paredSf", "perimetroLf"]);
    expect(w.notaDeLiner).toBe(false);
  });

  it("con C34 = 1 aparecen tablero, tornillos y malla (y sus ajustes), antes que el pegamento", () => {
    const w = con("Wall Only", { tableroEnSoloPared: 1 });
    expect(w.filas).toEqual(["tablero", "tornillos", "malla", "pegamento-pared", "loseta-pared", "lechada", "silicon", "perfil"]);
    expect(w.areas).toEqual(["paredSf", "perimetroLf", "tablerosPaneles"]);
    expect(w.ajustes).toEqual(expect.arrayContaining(["tableroAltoFt", "tableroAnchoLf", "tornillosPorTablero", "tablerosExtra"]));
  });

  it("con C35 = 1 aparece el impermeabilizante (y sus ajustes), sin tablero", () => {
    const w = con("Wall Only", { impermeableEnSoloPared: 1 });
    expect(w.filas).toEqual(["impermeable", "pegamento-pared", "loseta-pared", "lechada", "silicon", "perfil"]);
    expect(w.ajustes).toEqual(expect.arrayContaining(["impermeableSfPorGal", "impermeableSolape"]));
    expect(w.ajustes).not.toContain("tableroAltoFt");
  });

  it("los ajustes de los interruptores (C34, C35) solo salen en pared", () => {
    expect(con("Wall Only").ajustes).toEqual(expect.arrayContaining(["tableroEnSoloPared", "impermeableEnSoloPared", "adhesivoParedSfPorBolsa"]));
    expect(con("Shower").ajustes).not.toContain("tableroEnSoloPared");
    expect(con("Flooring Only").ajustes).not.toContain("impermeableEnSoloPared");
  });
});

describe("lo que se ve en cada calculadora, en resumen", () => {
  it("ninguna calculadora muestra los editores de las otras dos", () => {
    expect(con("Shower").entradas).not.toEqual(expect.arrayContaining(["habitaciones", "muros"]));
    expect(con("Flooring Only").entradas).not.toContain("muros");
    expect(con("Wall Only").entradas).not.toContain("habitaciones");
  });

  it("la pared no muestra loseta de piso ni pegamento de piso; el piso no muestra pegamento de pared", () => {
    expect(con("Wall Only").filas).not.toEqual(expect.arrayContaining(["loseta-piso", "pegamento-piso", "clips", "cunas"]));
    expect(con("Flooring Only").filas).not.toEqual(expect.arrayContaining(["loseta-pared", "pegamento-pared", "silicon"]));
  });

  it("cada campo de la hoja 1 y cada ajuste aparece en al menos una calculadora (si no, está de más)", () => {
    const tipos: TipoDeProyecto[] = ["Shower", "Flooring Only", "Wall Only"];
    const usados = new Set(tipos.flatMap((t) => con(t, { tableroEnSoloPared: 1, impermeableEnSoloPared: 1, preslopeIncluido: 1 }).entradas));
    for (const clave of Object.keys(USO_DE_ENTRADAS) as (keyof EntradasCalculadora)[]) {
      expect(usados.has(clave), clave).toBe(true);
    }
    const ajustes = new Set(tipos.flatMap((t) => con(t, { tableroEnSoloPared: 1, impermeableEnSoloPared: 1, preslopeIncluido: 1 }).ajustes));
    for (const m of AJUSTES_META) {
      if (USO_DE_AJUSTES[m.clave].usa.length > 0) expect(ajustes.has(m.clave), m.clave).toBe(true);
    }
  });
});

/** Un valor distinto del de la pantalla, para cada campo que no se muestra. */
function otroValor(clave: keyof EntradasCalculadora, actual: EntradasCalculadora): EntradasCalculadora[keyof EntradasCalculadora] {
  switch (clave) {
    case "disposicion": return actual.disposicion === "4 Walls" ? "2 Walls" : "4 Walls";
    case "tamanoPared": return actual.tamanoPared === "8x8" ? "24x48" : "8x8";
    case "tamanoPiso": return actual.tamanoPiso === "8x8" ? "24x48" : "8x8";
    case "habitaciones": return [{ nombre: "X", largoFt: 40, anchoFt: 40 }];
    case "muros": return [{ nombre: "Y", largoFt: 40, altoFt: 40, aberturasSf: 9 }];
    case "proyecto": return actual.proyecto;
    default: return 999;
  }
}

describe("un valor escrito en otra calculadora no mueve los totales de esta", () => {
  const tipos: TipoDeProyecto[] = ["Shower", "Flooring Only", "Wall Only"];
  const configuraciones: [string, Partial<AjustesCalculadora>][] = [
    ["por defecto", {}],
    ["con todos los interruptores encendidos", { tableroEnSoloPared: 1, impermeableEnSoloPared: 1, preslopeIncluido: 1 }],
  ];

  for (const tipo of tipos) {
    for (const [nombre, ajustesExtra] of configuraciones) {
      it(`${tipo}, ${nombre}: cambiar cada campo y cada ajuste oculto no cambia áreas ni cantidades ni ventas`, () => {
        const ajustes = { ...AJUSTES_POR_DEFECTO, ...ajustesExtra };
        const base = { ...ENTRADAS_POR_DEFECTO, proyecto: tipo };
        const quees = camposQueAplican(tipo, ajustes);
        const antes = totales(calcular(base, ajustes));

        for (const clave of Object.keys(USO_DE_ENTRADAS) as (keyof EntradasCalculadora)[]) {
          if (clave === "proyecto" || quees.entradas.includes(clave)) continue;
          const cambiada = { ...base, [clave]: otroValor(clave, base) } as EntradasCalculadora;
          expect(totales(calcular(cambiada, ajustes)), `campo oculto ${clave}`).toEqual(antes);
        }

        for (const clave of Object.keys(USO_DE_AJUSTES) as (keyof AjustesCalculadora)[]) {
          if (quees.ajustes.includes(clave)) continue;
          const meta = AJUSTES_META.find((m) => m.clave === clave)!;
          const nuevo = meta?.esSiNo ? 1 - ajustes[clave] : 999;
          const cambiados = { ...ajustes, [clave]: nuevo };
          expect(totales(calcular(base, cambiados)), `ajuste oculto ${clave}`).toEqual(antes);
        }
      });
    }
  }
});
