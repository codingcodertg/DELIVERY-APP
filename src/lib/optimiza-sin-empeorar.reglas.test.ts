import { describe, expect, it } from "vitest";
import type { ParadaDeLaLista } from "./lista-unica";
import type { EntradaDeOptimizar } from "./optimiza-la-ruta";
import { optimizaSinEmpeorar } from "./optimiza-sin-empeorar";

/**
 * «🧭 Optimizar» devuelve la lista ya con las reglas duras del motor (`reglas`): lo que la lista que se devuelve incumple.
 * Lo que se mide aquí es la lista final, no la del optimizador: si el arreglo de las reglas la cambia, es la que sale.
 */

const P = (id: string, tienda: string): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
/** Un mundo en línea recta: el punto `x` está a `x` millas y `x` minutos del 0. */
const en = (x: number) => ({ lat: 30 + x / 1000, lng: -101 });

describe("optimizaSinEmpeorar · las reglas duras de la lista que devuelve", () => {
  it("una carga antes que una descarga en la misma tienda sale arreglada, y `reglas` no la marca", () => {
    // a: se recoge en S1 y se entrega en V (en el mismo sitio que se recoge b). b: se recoge en V y se entrega en X.
    const e: EntradaDeOptimizar = {
      paradas: [P("a", "S1"), P("b", "V"), D("a"), D("b")],
      puntos: [en(0), en(10), en(10), en(20)],
      cambios: [2, 2, -2, -2],
      base: en(0),
      fin: null,
      capacidad: 10,
      servicios: [5, 5, 10, 10],
      salidaMin: 480,
    };
    const r = optimizaSinEmpeorar(e);
    // La lista del optimizador traía la carga antes que la descarga: el arreglo la cambia, y se adopta (no es peor).
    expect(r.cambio).toBe(true);
    const claves = r.reglas.violaciones.map((v) => v.clave);
    expect(claves).not.toContain("carga_antes_de_descarga");
    expect(r.reglas.avisos).toBeInstanceOf(Array);
    // Lo que se devuelve es una lista de paradas válida: las mismas órdenes, cada una una vez.
    const ids = r.paradas.flatMap((p) => (p.tipo === "P" ? p.ordenes : [p.orden])).sort();
    expect(ids).toEqual(["a", "a", "b", "b"]);
  });

  it("una lista sin problemas devuelve `reglas` vacías", () => {
    const e: EntradaDeOptimizar = {
      paradas: [P("a", "S1"), D("a"), P("b", "S2"), D("b")],
      puntos: [en(0), en(10), en(20), en(30)],
      cambios: [2, -2, 2, -2],
      base: en(0),
      fin: null,
      capacidad: 10,
    };
    const r = optimizaSinEmpeorar(e);
    expect(r.reglas.violaciones).toEqual([]);
  });
});
