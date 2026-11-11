import { describe, expect, it } from "vitest";
import {
  conRecogidaDesde, etaDeEntregaEn, etaDeRecogidaEn, llegadasDelPlan, MARGEN_DEL_RELEVO_MIN, minutosDeHora, pasoAnteriorPorId,
  recogidaDesdeDelRelevo, relevosAntesDeTiempo,
} from "./relevo-a-tiempo";
import { evaluaRuta, PARAMETROS_POR_DEFECTO, type ChoferEntrada, type OrdenEntrada } from "./route-engine";
import { optimizaLaLista, type EntradaDeOptimizar } from "./optimiza-la-ruta";
import type { ParadaDeLaLista } from "./lista-unica";

/**
 * D-994 (Roberto, 2026-11-09): «need to make sure that it doesnt put B before A. Maybe for safety have an hour gap between them».
 * En su captura, Tr-149025-b se recogía en RDZ Weslaco a las 14:44 y el paso a llegaba a Weslaco después.
 */
const A = { id: "a", order_no: 149025, relay_step: 1, stage: "picked_up" };
const B = { id: "b", order_no: 149025, relay_step: 2, stage: "ready" };
const OTRA = { id: "x", order_no: 1, relay_step: null, stage: "ready" };

describe("la regla del relevo a tiempo", () => {
  it("el margen es de una hora", () => expect(MARGEN_DEL_RELEVO_MIN).toBe(60));
  it("cada paso b sin recoger tiene su paso a; lo que no es relevo, no", () => {
    expect([...pasoAnteriorPorId([A, B, OTRA]).entries()].map(([b, a]) => `${b}<${a.id}`)).toEqual(["b<a"]);
    expect(pasoAnteriorPorId([A, { ...B, stage: "picked_up" }]).size).toBe(0);
  });
  it("el paso b se recoge desde la llegada del a + 1 h; si el a ya se entregó, sin espera; sin hora del a, nada inventado", () => {
    expect(recogidaDesdeDelRelevo([A, B], () => 16 * 60 + 7).get("b")).toBe(17 * 60 + 7);
    expect(recogidaDesdeDelRelevo([{ ...A, stage: "delivered" }, B], () => 900).size).toBe(0);
    expect(recogidaDesdeDelRelevo([A, B], () => null).size).toBe(0);
  });
  it("el caso de la captura: recoger el b a las 14:44 con el a llegando a las 16:07 es demasiado pronto", () => {
    const etas = { julio: { a: "16:07" }, max: { "P:b,y": "14:44" } };
    const r = relevosAntesDeTiempo([A, B], (id) => etaDeRecogidaEn(etas, id), (id) => etaDeEntregaEn(etas, id));
    expect(r).toEqual([{ paso: "b", anterior: "a", recogida: 14 * 60 + 44, llegadaDelAnterior: 16 * 60 + 7 }]);
    // A las 17:10 ya llegó el a y pasó la hora: bien.
    const bien = { julio: { a: "16:07" }, max: { "P:b": "17:10" } };
    expect(relevosAntesDeTiempo([A, B], (id) => etaDeRecogidaEn(bien, id), (id) => etaDeEntregaEn(bien, id))).toEqual([]);
    // Sin hora del a en ninguna ruta: se avisa.
    expect(relevosAntesDeTiempo([A, B], () => 600, () => null)[0].llegadaDelAnterior).toBeNull();
  });
  it("las horas y las llegadas de un plan", () => {
    expect(minutosDeHora("08:05")).toBe(485);
    expect(minutosDeHora("x")).toBeNull();
    const plan = [{ paradas: [{ orden: "a#a", tipo: "D" as const, llegada: 700 }, { orden: "a#b", tipo: "D" as const, llegada: 650 }, { orden: "b", tipo: "P" as const, llegada: 600 }] }];
    expect([...llegadasDelPlan(plan).entries()]).toEqual([["a", 650]]);
    expect(conRecogidaDesde([{ id: "b" }, { id: "c" }], new Map([["b", 720]]))).toEqual([{ id: "b", recogidaDesde: 720 }, { id: "c" }]);
  });
});

describe("el motor espera al paso a", () => {
  const chofer: ChoferEntrada = { id: "m", nombre: "M", base: "base", capacidad: 12, entrada: 480, salida: 1080, vuelveABase: true };
  const matriz = { base: { relevo: { minutos: 30, millas: 20 } }, relevo: { base: { minutos: 30, millas: 20 } } };
  const orden = (extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
    id: "b", origen: "relevo", destino: "base", pallets: 2, ventana: null, servicioRecogidaMin: 10, servicioEntregaMin: 10, ...extra,
  });
  const ruta = (o: OrdenEntrada) => evaluaRuta(chofer, [{ orden: "b", tipo: "P" }, { orden: "b", tipo: "D" }], {
    ordenes: new Map([["b", o]]), matriz, parametros: PARAMETROS_POR_DEFECTO,
  });
  it("sin la regla recoge al llegar (08:30); con ella, no antes de la hora del paso a + 1 h", () => {
    expect(ruta(orden()).paradas[0].inicioServicio).toBe(510);
    const conEspera = ruta(orden({ recogidaDesde: 14 * 60 + 44 + 0 }));
    expect(conEspera.paradas[0].inicioServicio).toBe(884);
    expect(conEspera.paradas[0].esperaMin).toBe(884 - 510);
    expect(conEspera.violaciones).toEqual([]);
  });
});

describe("Optimizar espera al paso a y aprovecha la espera", () => {
  const P = (id: string, tienda: string): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
  const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
  // Base y tienda de relevo juntas; el paso b va a «lejos»; «c» ya va en el camión y se entrega en «otra punta».
  const base = { lat: 26.2, lng: -98.2 };
  const relevo = { lat: 26.21, lng: -98.2 };
  const lejos = { lat: 26.3, lng: -98.2 };
  const otra = { lat: 26.2, lng: -97.7 };
  const entrada = (recogidaDesde?: (number | null)[]): EntradaDeOptimizar => ({
    paradas: [P("b", "Relevo"), D("b"), D("c")],
    puntos: [relevo, lejos, otra],
    cambios: [2, -2, -1],
    base, capacidad: 12, servicios: [10, 10, 10], salidaMin: 480,
    ...(recogidaDesde ? { recogidaDesde } : {}),
  });
  it("si la carga del paso b no llega hasta tarde, primero entrega lo otro y vuelve por ella", () => {
    const sin = optimizaLaLista(entrada());
    expect(sin.paradas[0]).toEqual(P("b", "Relevo"));
    const con = optimizaLaLista(entrada([14 * 60, null, null]));
    expect(con.paradas.map((p) => (p.tipo === "P" ? `P${p.ordenes[0]}` : `D${p.orden}`))).toEqual(["Dc", "Pb", "Db"]);
    // Y la jornada cuenta la espera: no termina antes de las 14:00 más lo que queda.
    expect(480 + con.despues.minutos).toBeGreaterThan(14 * 60);
  });
});
