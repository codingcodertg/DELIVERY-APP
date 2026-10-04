import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cargaTransportadaDe, centiMillasDeBanda, enLaBanda, evaluaPlan, evaluaRuta, MARGEN_PALLET_MI, minutosDeBanda, PARAMETROS_POR_DEFECTO, planifica,
  TOLERANCIA_DE_PASO, VERSION_DEL_MOTOR,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type ParadaRef, type Parametros, type Plan,
} from "./index";
import { entradaDelDia } from "../route-plan/entrada";

/**
 * «Entregar antes lo que está de paso» en el motor de «Armar rutas» (D-NEXT, `motor-7`).
 *
 * El dueño, 2026-10-02, con el plan de Julio para el 3 (recoge 3 pallets en Pharr para Weslaco y 1 en Brownsville para
 * Pharr; el motor lo dejó P1 P2 D1 D2): «si recoje en pharr porque pharr va a ir hasta brownville recoger y despues
 * entregar en weslaco, yo se que sale mejor a la venida pero si es una vuelta tan larga como bajar a browville y no hay
 * mas ordenes que entregue en weslaco de un solo ahi seria p1 d1 p2 d2 eso es lo mas eficiente».
 *
 * Aquí, con otros nombres y los tiempos por calles que guardó aquel plan: «base» (Pharr), «oeste» (Weslaco), «sur»
 * (Brownsville). La entrega del pallet del Sur es en la propia base.
 */
const MATRIZ: Matriz = {
  base: { oeste: { minutos: 14, millas: 12.07 }, sur: { minutos: 47, millas: 50.56 } },
  oeste: { base: { minutos: 14, millas: 10.86 }, sur: { minutos: 38, millas: 40.58 } },
  sur: { base: { minutos: 50, millas: 52.21 }, oeste: { minutos: 39, millas: 41.41 } },
};
const chofer = (extra: Partial<ChoferEntrada> = {}): ChoferEntrada => ({ id: "j", nombre: "J", base: "base", capacidad: 12, entrada: 480, salida: 1050, vuelveABase: true, ...extra });
const orden = (id: string, origen: string, destino: string, pallets: number, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
  id, codigo: id, entrada: `2026-10-02 ${id}`, origen, destino, pallets, ventana: [510, 930], servicioRecogidaMin: 12, servicioEntregaMin: 15, ...extra,
});
const OESTE = (extra: Partial<OrdenEntrada> = {}) => orden("oeste", "base", "oeste", 3, extra);
const SUR = (extra: Partial<OrdenEntrada> = {}) => orden("sur", "sur", "base", 1, { servicioRecogidaMin: 4, servicioEntregaMin: 5, ...extra });
const dia = (ordenes: OrdenEntrada[], choferes: ChoferEntrada[] = [chofer()], matriz: Matriz = MATRIZ): Entrada => ({ ordenes, choferes, matriz });
const CON: Parametros = { ...PARAMETROS_POR_DEFECTO, dePaso: TOLERANCIA_DE_PASO };
const forma = (plan: Plan, c = "j") => plan.rutas.find((r) => r.chofer === c)!.paradas.map((p) => `${p.tipo}${p.orden}`).join(" ");
const mapa = (e: Entrada) => new Map(e.ordenes.map((o) => [o.id, o]));
const carga = (plan: Plan, e: Entrada, c = "j") => cargaTransportadaDe(plan.rutas.find((r) => r.chofer === c)!, mapa(e));

describe("la banda y la carga, en números", () => {
  it("la banda: 5 % de jornada con tope de 15 minutos, y 3 millas; con 0 %, nada", () => {
    expect(TOLERANCIA_DE_PASO).toEqual({ porcientoDeJornada: 5, maxMin: 15, millas: 3 });
    expect([minutosDeBanda(158), minutosDeBanda(300), minutosDeBanda(301), minutosDeBanda(540)]).toEqual([8, 15, 15, 15]);
    expect(minutosDeBanda(158, { porcientoDeJornada: 0, maxMin: 15, millas: 3 })).toBe(0);
    expect(minutosDeBanda(158, { porcientoDeJornada: 50, maxMin: 20, millas: 3 })).toBe(20);
    expect(minutosDeBanda(-5)).toBe(0);
    expect(centiMillasDeBanda()).toBe(300);
    const ref = { jornadaMin: 160, centiMillas: 10283 };
    expect(enLaBanda(168, 10583, ref)).toBe(true);
    expect(enLaBanda(169, 10583, ref)).toBe(false);
    expect(enLaBanda(168, 10584, ref)).toBe(false);
    expect(MARGEN_PALLET_MI).toBe(1);
  });
  it("la carga transportada de una ruta evaluada: pallets a bordo por milla, tramo a tramo, y lo que ya iba al salir", () => {
    const e = dia([OESTE(), SUR()]);
    const ctx = { ordenes: mapa(e), matriz: MATRIZ, parametros: PARAMETROS_POR_DEFECTO };
    const ruta = (ps: ParadaRef[]) => evaluaRuta(chofer(), ps, ctx);
    const P = (o: string): ParadaRef => ({ orden: o, tipo: "P" }), D = (o: string): ParadaRef => ({ orden: o, tipo: "D" });
    // 3 pallets las 50,56 millas al Sur, 4 las 41,41 a Oeste y 1 las 10,86 de vuelta.
    expect(cargaTransportadaDe(ruta([P("oeste"), P("sur"), D("oeste"), D("sur")]), ctx.ordenes)).toBe(Math.round((3 * 50.56 + 4 * 41.41 + 1 * 10.86) * 100) / 100);
    // 3 pallets las 12,07 a Oeste, vacío al Sur y 1 las 52,21 de vuelta.
    expect(cargaTransportadaDe(ruta([P("oeste"), D("oeste"), P("sur"), D("sur")]), ctx.ordenes)).toBe(88.42);
    // Con la recogida de Oeste ya hecha, sus 3 pallets van a bordo desde la salida: lo mismo.
    const hecha = mapa(dia([OESTE({ recogidaHecha: true, choferFijado: "j" }), SUR()]));
    expect(cargaTransportadaDe(evaluaRuta(chofer(), [P("sur"), D("oeste"), D("sur")], { ...ctx, ordenes: hecha }), hecha)).toBe(328.18);
    // Y si la ruta no vuelve a la base, el último tramo no existe.
    expect(cargaTransportadaDe(evaluaRuta(chofer({ vuelveABase: false }), [P("oeste"), D("oeste")], ctx), ctx.ordenes)).toBe(36.21);
    expect(cargaTransportadaDe(ruta([]), ctx.ordenes)).toBe(0);
  });
});

describe("el plan de Julio: de P1 P2 D1 D2 a P1 D1 P2 D2", () => {
  const e = dia([OESTE(), SUR()]);
  it("sin `dePaso` (motor-6) el plan baja al Sur con los 3 pallets de Oeste a bordo: lo de la captura, 102,83 millas", () => {
    const plan = planifica(e);
    expect(forma(plan)).toBe("Poeste Psur Doeste Dsur");
    expect(plan.rutas[0]).toMatchObject({ duracionMin: 160, millas: 102.83, tardeMin: 0 });
    expect(carga(plan, e)).toBe(328.18);
  });
  it("con `dePaso` entrega Oeste de paso: 2 minutos y 2 millas más, 240 pallet·milla menos, sin dejar nada fuera ni llegar tarde", () => {
    const plan = planifica(e, CON);
    expect(forma(plan)).toBe("Poeste Doeste Psur Dsur");
    expect(plan.rutas[0]).toMatchObject({ duracionMin: 162, millas: 104.86, tardeMin: 0, violaciones: [] });
    expect(carga(plan, e)).toBe(88.42);
    expect(plan.sinAsignar).toEqual([]);
    expect(plan.version).toBe("motor-7");
    expect(VERSION_DEL_MOTOR).toBe("motor-7");
    // El coste y las explicaciones son los del plan que sale, no los de antes de reordenar.
    expect(plan.coste).toEqual(evaluaPlan({ secuencias: { j: plan.rutas[0].paradas.map((p) => ({ orden: p.orden, tipo: p.tipo })) }, ordenes: e.ordenes, choferes: e.choferes, matriz: MATRIZ, parametros: CON }).coste);
    expect(plan.explicaciones.map((x) => x.orden).sort()).toEqual(["oeste", "sur"]);
    // Y es determinista.
    expect(forma(planifica(e, CON))).toBe(forma(plan));
  });
  it("«Armar rutas» lo lleva siempre: los parámetros que salen de Ajustes traen la banda, y el borrador planifica con esos", () => {
    const parametros = entradaDelDia({ ordenes: [], choferes: [], ajustesDeChofer: [], settings: { stores: [] } } as never).parametros;
    expect(parametros.dePaso).toEqual(TOLERANCIA_DE_PASO);
    expect(PARAMETROS_POR_DEFECTO.dePaso).toBeUndefined();
    // …y el borrador planifica con los parámetros del día y los guarda con el plan.
    const borrador = readFileSync("src/lib/route-plan/borrador.ts", "utf8");
    expect(borrador).toContain("planificaConTrafico(entrada, dia.parametros,");
    expect(borrador).toContain("params: { ...dia.parametros,");
  });
});

describe("la banda en el motor: lo que NO se cambia por pasear menos", () => {
  const con = (matriz: Matriz, ordenes = [OESTE(), SUR()], choferes = [chofer()]) => planifica(dia(ordenes, choferes, matriz), CON);
  const otra = (k: "min" | "mi", v: number): Matriz => ({ ...MATRIZ, oeste: { ...MATRIZ.oeste, sur: k === "min" ? { minutos: v, millas: 40.58 } : { minutos: 38, millas: v } } });
  it("si el rodeo cuesta más que la banda de jornada (8 minutos de 160) o más de 3 millas, se queda el orden más corto", () => {
    expect(forma(con(otra("min", 44)))).toBe("Poeste Doeste Psur Dsur");   // +8 minutos: cabe justo
    expect(forma(con(otra("min", 45)))).toBe("Poeste Psur Doeste Dsur");   // +9: no
    expect(forma(con(otra("mi", 41.5)))).toBe("Poeste Doeste Psur Dsur");  // +2,95 mi
    expect(forma(con(otra("mi", 41.6)))).toBe("Poeste Psur Doeste Dsur");  // +3,05 mi
  });
  it("ni un minuto más tarde: si entregar Oeste primero llega tarde al Sur, no se toca", () => {
    // La entrega del Sur cierra a las 10:35: el orden corto llega justo; el otro, 2 minutos tarde (ventana ancha: se podría, y no se hace).
    const justo = [OESTE(), SUR({ ventana: [480, 635] })];
    expect(forma(con(MATRIZ, justo))).toBe("Poeste Psur Doeste Dsur");
    expect(forma(con(MATRIZ, [OESTE(), SUR({ ventana: [480, 637] })]))).toBe("Poeste Doeste Psur Dsur");
  });
  it("ni un minuto-builder más: si la del Sur es de un builder, entregar Oeste antes la retrasa 2 minutos, y no se hace", () => {
    // (Con el peso del builder casi a cero, para que el orden corto sea el que deja la mejora: con el de siempre, el propio
    // coste ya pone al builder delante y la pasada no tiene nada que decidir.)
    const casiSinPeso: Parametros = { ...CON, pesos: { ...CON.pesos, builder: 0.001 } };
    const e = dia([OESTE(), SUR({ builder: true })]);
    expect(forma(planifica(e, casiSinPeso))).toBe("Poeste Psur Doeste Dsur");
    // Con el builder en Oeste, entregarla de paso la adelanta: sí.
    expect(forma(planifica(dia([OESTE({ builder: true }), SUR()]), casiSinPeso))).toBe("Poeste Doeste Psur Dsur");
  });
  it("las críticas no se retrasan: si la del Sur es crítica, no se le pone delante la entrega de Oeste", () => {
    expect(forma(con(MATRIZ, [OESTE(), SUR({ prioridad: "critical" })]))).toBe("Poeste Psur Doeste Dsur");
    expect(forma(con(MATRIZ, [OESTE({ prioridad: "critical" }), SUR()]))).toBe("Poeste Doeste Psur Dsur");
  });
  it("sin violaciones nuevas: si el turno acaba justo cuando vuelve por el orden corto, los 2 minutos de más lo sacarían del turno, y no se hace", () => {
    expect(forma(con(MATRIZ, undefined, [chofer({ salida: 480 + 160 })]))).toBe("Poeste Psur Doeste Dsur");
    expect(forma(con(MATRIZ, undefined, [chofer({ salida: 480 + 162 })]))).toBe("Poeste Doeste Psur Dsur");
  });
  it("el margen: por menos de un pallet·milla no se cambia nada", () => {
    expect(forma(con(MATRIZ, [OESTE({ pallets: 0.01 }), SUR()]))).toBe("Poeste Psur Doeste Dsur");
    expect(forma(con(MATRIZ, [OESTE({ pallets: 0.02 }), SUR()]))).toBe("Poeste Doeste Psur Dsur");
  });
  it("lo que fijó una persona no se mueve", () => {
    const fijada: Entrada = { ...dia([OESTE(), SUR()]), secuenciaFijada: { j: [{ orden: "oeste", tipo: "P" }, { orden: "sur", tipo: "P" }, { orden: "oeste", tipo: "D" }, { orden: "sur", tipo: "D" }] } };
    expect(forma(planifica(fijada, CON))).toBe("Poeste Psur Doeste Dsur");
  });
  it("no cambia de chofer ni deja nada fuera: con dos choferes, el reparto es el mismo con y sin `dePaso`", () => {
    const dos = [chofer(), chofer({ id: "m", nombre: "M", base: "sur" })];
    const e = dia([OESTE(), SUR(), orden("otra", "sur", "oeste", 2)], dos);
    const sin = planifica(e), conPaso = planifica(e, CON);
    const reparto = (p: Plan) => p.rutas.map((r) => [...new Set(r.paradas.map((x) => x.orden))].sort().join(","));
    expect(reparto(conPaso)).toEqual(reparto(sin));
    expect(conPaso.sinAsignar).toEqual(sin.sinAsignar);
    for (const r of conPaso.rutas) expect(r.violaciones).toEqual([]);
  });
});
