import { describe, expect, it } from "vitest";
import type { ParadaDeLaLista } from "./lista-unica";
import type { EntradaDeOptimizar, VentanaDeEntrega } from "./optimiza-la-ruta";
import { optimizaSinEmpeorar } from "./optimiza-sin-empeorar";
import { avisoDeOptimizar } from "./optimizar-desde-el-gestor";
import { validaLaLista } from "./reglas-de-la-lista";
import { claveDePunto } from "./route-times/claves";

/**
 * «🧭 Optimizar»: una lista que vuelve a una tienda ya visitada, y que al juntar las dos visitas ahorra millas pero deja a una
 * entrega tarde de su ventana estrecha. El dueño, 2026-11-25: «no regresar a la tienda, la opción b, aquí es importante el ahorro».
 * La juntada se adopta (la pasada de reglas no tumba la lista por el retraso), y el retraso se dice en el aviso.
 *
 * Mundo en línea recta: el punto `x` está a `x` millas y `x` minutos de la base (0).
 */
const P = (id: string, tienda: string): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
const en = (x: number) => ({ lat: 30 + x / 1000, lng: -101 });
const recta = (xs: number[]) => {
  const t: Record<string, Record<string, { minutos: number; millas: number }>> = {};
  for (const a of xs) for (const b of xs) if (a !== b) (t[claveDePunto(en(a))] ??= {})[claveDePunto(en(b))] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) };
  return t;
};
const v = (abre: number, cierra: number, estrecha = true): VentanaDeEntrega => ({ abre, cierra, estrecha });
const regresos = (lista: readonly ParadaDeLaLista[], ordenes: { id: string; origen: string | null; destino: string | null; pallets: number }[]) =>
  validaLaLista(lista, ordenes, 10).violaciones.filter((x) => x.clave === "regreso_a_la_misma_tienda").length;

/** z va en el camión todo el tiempo (si no, la regla 3 no ve regreso). x (S → C1, ventana estrecha que solo cumple si se sale de S
 *  sin volver) e y (S → C2). La lista del optimizador vuelve a S. */
const ordenes = [
  { id: "z", origen: "B", destino: "C3", pallets: 1 },
  { id: "x", origen: "S", destino: "C1", pallets: 1 },
  { id: "y", origen: "S", destino: "C2", pallets: 1 },
];
const entrada = (): EntradaDeOptimizar => ({
  paradas: [P("z", "B"), P("x", "S"), D("x"), P("y", "S"), D("y"), D("z")],
  puntos: [en(0), en(10), en(20), en(10), en(30), en(40)],
  cambios: [1, 1, -1, 1, -1, -1],
  base: en(0),
  fin: null,
  capacidad: 10,
  ventanas: [null, null, v(480, 507), null, null, null],
  servicios: [0, 5, 5, 5, 5, 5],
  salidaMin: 480,
  recargaMinimaMin: 0,
  tiempos: recta([0, 10, 20, 30, 40]),
});

describe("optimizaSinEmpeorar · juntar dos visitas a una tienda aunque una entrega llegue tarde", () => {
  it("la lista vuelve a S y la juntada ahorra millas: se adopta, sin el regreso, y la entrega tarde queda marcada", () => {
    const e = entrada();
    expect(regresos(e.paradas, ordenes)).toBe(1);
    const r = optimizaSinEmpeorar(e);
    expect(r.cambio).toBe(true);
    expect(regresos(r.paradas, ordenes)).toBe(0);
    expect(r.despues.millas).toBeLessThan(r.antes.millas);
    const tarde = r.despues.tarde.find((t) => t.orden === "x");
    expect(tarde).toBeDefined();
    expect(tarde!.minutos).toBeGreaterThan(0);
    expect(tarde!.estrecha).toBe(true);
  });

  it("el aviso lo dice: llega tarde a x, que antes llegaba a tiempo, y cuánto ahorra", () => {
    const e = entrada();
    const r = optimizaSinEmpeorar(e);
    const aviso = avisoDeOptimizar({
      ruta: "Ruta 1", r, tiempos: null, hayBase: true, nombreDe: (o) => o, pallets: (n) => String(n),
    });
    expect(aviso.es).toContain("Llega tarde a 1 entrega(s) que antes llegaban a tiempo: x");
    expect(aviso.es).toContain("ahorra");
  });
});
