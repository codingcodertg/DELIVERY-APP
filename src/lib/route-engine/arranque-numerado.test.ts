import { describe, expect, it } from "vitest";
import { PARAMETROS_POR_DEFECTO, planifica, type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Plan } from "./index";

/**
 * El arranque numerado (D-NEXT, 208): lo que lleva `puesto` (1, 2, 3…) abre UNA ruta, en ese orden, y nada se mete
 * delante. La misma cuadrícula inventada de `route-engine.test.ts`: un punto es «x,y», se tarda su distancia en minutos.
 */
const punto = (x: number, y = 0) => `${x},${y}`;
const xy = (p: string) => p.split(",").map(Number) as [number, number];
function matrizDe(puntos: string[]): Matriz {
  const m: Matriz = {};
  for (const a of puntos) {
    m[a] = {};
    for (const b of puntos) {
      if (a === b) continue;
      const [ax, ay] = xy(a), [bx, by] = xy(b);
      const minutos = Math.abs(ax - bx) + Math.abs(ay - by);
      m[a][b] = { minutos, millas: minutos * 0.6 };
    }
  }
  return m;
}
const orden = (id: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
  id, codigo: id, entrada: "2026-01-05 0800", origen: punto(0), destino: punto(10), pallets: 1, ventana: null,
  servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra,
});
const chofer = (id: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada => ({
  id, nombre: id, base: punto(0), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true, ...extra,
});
function entradaDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[], extra: Partial<Entrada> = {}): Entrada {
  const puntos = new Set<string>();
  for (const o of ordenes) { if (o.origen) puntos.add(o.origen); if (o.destino) puntos.add(o.destino); }
  for (const c of choferes) puntos.add(c.base);
  return { ordenes, choferes, matriz: matrizDe([...puntos]), ...extra };
}
const secuencia = (plan: Plan, c: string) => plan.rutas.find((r) => r.chofer === c)!.paradas.map((p) => `${p.tipo}:${p.orden}`);
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id))?.chofer ?? null;

/** Dos cercanas (1 y 2) y dos lejanas (20 y 21): sin números, las cercanas irían primero. */
const dia = () => [
  orden("cerca1", { destino: punto(1), entrada: "2026-01-05 0700" }),
  orden("cerca2", { destino: punto(2), entrada: "2026-01-05 0701" }),
  orden("lejos1", { destino: punto(20) }),
  orden("lejos2", { destino: punto(21) }),
];

describe("D-NEXT: el arranque numerado", () => {
  it("control: sin números, las cercanas van antes que las lejanas", () => {
    const plan = planifica(entradaDe(dia(), [chofer("A")]), PARAMETROS_POR_DEFECTO);
    const sec = secuencia(plan, "A");
    expect(sec.indexOf("D:cerca1")).toBeLessThan(sec.indexOf("D:lejos1"));
    expect(plan.sinAsignar).toEqual([]);
  });

  it("con 1 y 2 en las lejanas, la ruta ABRE con ellas, en ese orden, y las demás van detrás", () => {
    const ordenes = dia().map((o) => (o.id === "lejos2" ? { ...o, puesto: 1 } : o.id === "lejos1" ? { ...o, puesto: 2 } : o));
    const plan = planifica(entradaDe(ordenes, [chofer("A")]), PARAMETROS_POR_DEFECTO);
    expect(plan.sinAsignar).toEqual([]);
    expect(secuencia(plan, "A").slice(0, 4)).toEqual(["P:lejos2", "P:lejos1", "D:lejos2", "D:lejos1"]);
    expect(secuencia(plan, "A")).toHaveLength(8);
    // Y el motor las marca como fijadas: la pantalla las enseña así.
    expect(plan.rutas[0].paradas.slice(0, 4).every((p) => p.fijada)).toBe(true);
  });

  it("con dos choferes, las numeradas van JUNTAS en una sola ruta, delante de todo lo de esa ruta", () => {
    const ordenes = dia().map((o) => (o.id === "lejos1" ? { ...o, puesto: 1 } : o.id === "cerca2" ? { ...o, puesto: 2 } : o));
    const plan = planifica(entradaDe(ordenes, [chofer("A"), chofer("B")]), PARAMETROS_POR_DEFECTO);
    expect(plan.sinAsignar).toEqual([]);
    const c = choferDe(plan, "lejos1")!;
    expect(choferDe(plan, "cerca2")).toBe(c);
    expect(secuencia(plan, c).slice(0, 4)).toEqual(["P:lejos1", "P:cerca2", "D:lejos1", "D:cerca2"]);
  });

  it("si una numerada tiene chofer puesto por una persona, la cabeza va con ese chofer", () => {
    const ordenes = dia().map((o) => (o.id === "lejos1" ? { ...o, puesto: 1, choferFijado: "B" } : o.id === "lejos2" ? { ...o, puesto: 2, choferFijado: "B" } : o));
    const plan = planifica(entradaDe(ordenes, [chofer("A"), chofer("B")]), PARAMETROS_POR_DEFECTO);
    expect(secuencia(plan, "B").slice(0, 4)).toEqual(["P:lejos1", "P:lejos2", "D:lejos1", "D:lejos2"]);
  });

  it("el plan sigue siendo válido: nada se entrega sin recoger y no hay violaciones", () => {
    const ordenes = dia().map((o) => (o.id === "lejos2" ? { ...o, puesto: 1 } : o));
    const plan = planifica(entradaDe(ordenes, [chofer("A"), chofer("B")]), PARAMETROS_POR_DEFECTO);
    expect(plan.violaciones).toEqual([]);
    for (const r of plan.rutas) {
      const aBordo = new Set<string>();
      for (const p of r.paradas) { if (p.tipo === "P") aBordo.add(p.orden); else expect(aBordo.has(p.orden), p.orden).toBe(true); }
    }
  });
});
