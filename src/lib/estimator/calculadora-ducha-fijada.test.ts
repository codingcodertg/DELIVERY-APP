import { describe, expect, it } from "vitest";
import {
  AJUSTES_POR_DEFECTO, ENTRADAS_POR_DEFECTO, calcular, type AjustesCalculadora, type EntradasCalculadora, type ResultadoCalculadora,
} from "./calculadora-material";

/**
 * La calculadora de ducha no debe cambiar al separar las calculadoras. Estas cifras salieron del código ANTES de tocar la
 * separación (tres casos, y cada uno con C33 = 1 y 2 paneles extra). Si una cambia, cambiaron las cifras de la ducha.
 */
const CASOS: {
  nombre: string;
  entradas: Partial<EntradasCalculadora>;
  ajustes: Partial<AjustesCalculadora>;
  areas: ResultadoCalculadora["areas"];
  tablerosLf: number;
  filas: Record<string, [cantidad: number, venta: number]>;
}[] = [
  {
    nombre: "defecto",
    entradas: {},
    ajustes: {},
      areas: {"pisoSf":15,"paredSf":91,"perimetroLf":11,"tablerosPaneles":7},
      tablerosLf: 17.6,
      filas: {
        "liner": [24, 1],
        "mortero": [2.5, 5],
        "tablero": [17.6, 21],
        "tornillos": [210, 1],
        "malla": [42, 1],
        "impermeable": [103, 3],
        "pegamento-pared": [91, 4],
        "pegamento-piso": [15, 1],
        "loseta-pared": [91, 6],
        "loseta-piso": [15, 1],
        "lechada": [8.101051010844825, 1],
        "silicon": [27, 2],
        "perfil": [0, 0],
        "clips": [212, 3],
        "cunas": [212, 3],
        "coladera": [1, 1],
        "pendiente": [0, 0],
      },
  },
  {
    nombre: "defecto con C33 = 1 y 2 paneles extra",
    entradas: {},
    ajustes: { preslopeIncluido: 1, tablerosExtra: 2 },
      areas: {"pisoSf":15,"paredSf":91,"perimetroLf":11,"tablerosPaneles":8},
      tablerosLf: 17.6,
      filas: {
        "liner": [24, 1],
        "mortero": [2.5, 5],
        "tablero": [17.6, 24],
        "tornillos": [240, 1],
        "malla": [48, 1],
        "impermeable": [103, 3],
        "pegamento-pared": [91, 4],
        "pegamento-piso": [15, 1],
        "loseta-pared": [91, 6],
        "loseta-piso": [15, 1],
        "lechada": [8.101051010844825, 1],
        "silicon": [27, 2],
        "perfil": [0, 0],
        "clips": [212, 3],
        "cunas": [212, 3],
        "coladera": [1, 1],
        "pendiente": [1.25, 3],
      },
  },
  {
    nombre: "cuatroParedes",
    entradas: { largoFt: 6, anchoFt: 4, altoFt: 8, disposicion: "4 Walls", aberturasSf: 12, morteroProfundidadIn: 2.5, tamanoPared: "12x24", tamanoPiso: "8x8", juntaParedIn: 0.0625, juntaPisoIn: 0.25, subidaLinerIn: 5, bordeExtraLinerIn: 1, bordeExpuestoLf: 6, salpicaderoLargoFt: 4, salpicaderoAltoFt: 1.5 },
    ajustes: {},
      areas: {"pisoSf":24,"paredSf":154,"perimetroLf":20,"tablerosPaneles":11},
      tablerosLf: 29.6,
      filas: {
        "liner": [35, 1],
        "mortero": [5, 10],
        "tablero": [29.6, 33],
        "tornillos": [330, 1],
        "malla": [66, 2],
        "impermeable": [172, 5],
        "pegamento-pared": [154, 7],
        "pegamento-piso": [24, 1],
        "loseta-pared": [154, 10],
        "loseta-piso": [24, 2],
        "lechada": [22.853896103896105, 1],
        "silicon": [52, 3],
        "perfil": [6, 1],
        "clips": [356, 4],
        "cunas": [356, 4],
        "coladera": [1, 1],
        "pendiente": [0, 0],
      },
  },
  {
    nombre: "cuatroParedes con C33 = 1 y 2 paneles extra",
    entradas: { largoFt: 6, anchoFt: 4, altoFt: 8, disposicion: "4 Walls", aberturasSf: 12, morteroProfundidadIn: 2.5, tamanoPared: "12x24", tamanoPiso: "8x8", juntaParedIn: 0.0625, juntaPisoIn: 0.25, subidaLinerIn: 5, bordeExtraLinerIn: 1, bordeExpuestoLf: 6, salpicaderoLargoFt: 4, salpicaderoAltoFt: 1.5 },
    ajustes: { preslopeIncluido: 1, tablerosExtra: 2 },
      areas: {"pisoSf":24,"paredSf":154,"perimetroLf":20,"tablerosPaneles":12},
      tablerosLf: 29.6,
      filas: {
        "liner": [35, 1],
        "mortero": [5, 10],
        "tablero": [29.6, 36],
        "tornillos": [360, 1],
        "malla": [72, 2],
        "impermeable": [172, 5],
        "pegamento-pared": [154, 7],
        "pegamento-piso": [24, 1],
        "loseta-pared": [154, 10],
        "loseta-piso": [24, 2],
        "lechada": [22.853896103896105, 1],
        "silicon": [52, 3],
        "perfil": [6, 1],
        "clips": [356, 4],
        "cunas": [356, 4],
        "coladera": [1, 1],
        "pendiente": [2, 4],
      },
  },
  {
    nombre: "dosParedes",
    entradas: { largoFt: 5, anchoFt: 3, altoFt: 7, disposicion: "2 Walls", cajaParedSf: 12, cajaPisoSf: 11, tamanoPared: "7x22", tamanoPiso: "22x22", salpicaderoLargoFt: 0, salpicaderoAltoFt: 0 },
    ajustes: {},
      areas: {"pisoSf":15,"paredSf":56,"perimetroLf":8,"tablerosPaneles":5},
      tablerosLf: 11.2,
      filas: {
        "liner": [24, 1],
        "mortero": [2.5, 5],
        "tablero": [11.2, 15],
        "tornillos": [150, 1],
        "malla": [30, 1],
        "impermeable": [71, 2],
        "pegamento-pared": [56, 3],
        "pegamento-piso": [15, 1],
        "loseta-pared": [56, 5],
        "loseta-piso": [15, 2],
        "lechada": [12.651252070855103, 1],
        "silicon": [15, 1],
        "perfil": [0, 0],
        "clips": [142, 2],
        "cunas": [142, 2],
        "coladera": [1, 1],
        "pendiente": [0, 0],
      },
  },
  {
    nombre: "dosParedes con C33 = 1 y 2 paneles extra",
    entradas: { largoFt: 5, anchoFt: 3, altoFt: 7, disposicion: "2 Walls", cajaParedSf: 12, cajaPisoSf: 11, tamanoPared: "7x22", tamanoPiso: "22x22", salpicaderoLargoFt: 0, salpicaderoAltoFt: 0 },
    ajustes: { preslopeIncluido: 1, tablerosExtra: 2 },
      areas: {"pisoSf":15,"paredSf":56,"perimetroLf":8,"tablerosPaneles":6},
      tablerosLf: 11.2,
      filas: {
        "liner": [24, 1],
        "mortero": [2.5, 5],
        "tablero": [11.2, 18],
        "tornillos": [180, 1],
        "malla": [36, 1],
        "impermeable": [71, 2],
        "pegamento-pared": [56, 3],
        "pegamento-piso": [15, 1],
        "loseta-pared": [56, 5],
        "loseta-piso": [15, 2],
        "lechada": [12.651252070855103, 1],
        "silicon": [15, 1],
        "perfil": [0, 0],
        "clips": [142, 2],
        "cunas": [142, 2],
        "coladera": [1, 1],
        "pendiente": [1.25, 3],
      },
  },];

describe("calculadora de ducha: las cifras de antes de separar las calculadoras", () => {
  for (const c of CASOS) {
    it(c.nombre, () => {
      const r = calcular({ ...ENTRADAS_POR_DEFECTO, proyecto: "Shower", ...c.entradas }, { ...AJUSTES_POR_DEFECTO, ...c.ajustes });
      expect(r.areas).toEqual(c.areas);
      expect(r.tablerosLf).toBeCloseTo(c.tablerosLf, 9);
      expect(r.filas.map((f) => f.clave)).toEqual(Object.keys(c.filas));
      for (const [clave, [cantidad, venta]] of Object.entries(c.filas)) {
        const f = r.filas.find((x) => x.clave === clave)!;
        expect(f.cantidad, clave).toBeCloseTo(cantidad, 9);
        expect(f.venta, clave).toBe(venta);
      }
    });
  }
});
