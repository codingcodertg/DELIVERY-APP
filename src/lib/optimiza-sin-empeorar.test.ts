import { describe, expect, it } from "vitest";
import type { ParadaDeLaLista } from "./lista-unica";
import { mideLaLista, optimizaLaLista, type EntradaDeOptimizar, type VentanaDeEntrega } from "./optimiza-la-ruta";
import { arranqueDeLoPendiente, comoLaVeElDespachador, entradaEnOrden, jornadaDeTarjeta, noEsPeor, optimizaSinEmpeorar, picoDeCarga } from "./optimiza-sin-empeorar";
import { claveDePunto } from "./route-times/claves";

/**
 * «🧭 Optimizar» nunca deja la ruta peor de como la ve el despachador (D-1029). El dueño, 2026-11-12: «el botón de optimizar
 * no funciona: más bien agrega más millas y aumenta el tiempo estimado».
 *
 * Cada caso de la sección 1 es UNA de las causas medidas en las rutas reales, en pequeño: el optimizador de siempre
 * (`optimizaLaLista`) la «arregla» con más millas, y el de la pantalla (`optimizaSinEmpeorar`) no toca la ruta. Las rutas
 * reales están en `rutas-a-mano.backtest.test.ts`.
 */

const P = (id: string, tienda = "Tienda A"): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
/** Un mundo en línea recta: el punto `x` está a `x` millas y `x` minutos del 0. */
const en = (x: number) => ({ lat: 30 + x / 1000, lng: -101 });
const recta = (xs: number[]) => {
  const t: Record<string, Record<string, { minutos: number; millas: number }>> = {};
  for (const a of xs) for (const b of xs) if (a !== b) (t[claveDePunto(en(a))] ??= {})[claveDePunto(en(b))] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) };
  return t;
};
const v = (abre: number, cierra: number, estrecha = true): VentanaDeEntrega => ({ abre, cierra, estrecha });

describe("1 · las causas, en pequeño: lo que el optimizador de siempre compraba con millas", () => {
  it("LA VENTANA · llegar a tiempo a una ventana estrecha costaría 20 millas más: no se toca, y se dice", () => {
    // Sin vuelta a la base: B a 10 millas, A a 30 con ventana hasta las 08:50. B y luego A: 30 millas, A llega 10 min tarde.
    const e: EntradaDeOptimizar = {
      paradas: [P("b"), P("a"), D("b"), D("a")], puntos: [en(0), en(0), en(10), en(30)], cambios: [1, 1, -1, -1], base: en(0), fin: null, capacidad: 10,
      ventanas: [null, null, null, v(480, 530)], servicios: [5, 5, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 30]),
    };
    const antes = mideLaLista(e);
    expect(antes).toMatchObject({ millas: 30, tarde: [{ orden: "a", minutos: 10, estrecha: true }] });
    // El de siempre: primero la ventana. 50 millas.
    const viejo = optimizaLaLista(e);
    expect(viejo.cambio).toBe(true);
    expect(viejo.despues).toMatchObject({ millas: 50, tarde: [] });
    // El de la pantalla: no hay orden que mejore algo sin empeorar las millas.
    const r = optimizaSinEmpeorar(e);
    expect(r).toMatchObject({ cambio: false, como: null, paradas: e.paradas });
    expect(r.despues).toEqual(antes);
    expect(r.descartados).toBe(0); // la búsqueda ni lo propone: el tope de millas va DENTRO de ella
  });

  it("LA CAPACIDAD · no pasarse por 2 pallets costaría una vuelta a la base: no se toca", () => {
    const e: EntradaDeOptimizar = {
      paradas: [P("1"), P("2"), D("1"), D("2")], puntos: [en(0), en(0), en(10), en(30)], cambios: [6, 6, -6, -6], base: en(0), capacidad: 10,
      servicios: [5, 5, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 30]),
    };
    expect(mideLaLista(e)).toMatchObject({ millas: 60, exceso: 2 });
    const viejo = optimizaLaLista(e);
    expect(viejo.despues).toMatchObject({ millas: 80, exceso: 0 });
    const r = optimizaSinEmpeorar(e);
    expect(r.cambio).toBe(false);
    expect(r.despues).toMatchObject({ millas: 60, exceso: 2 });
  });

  it("LA ESPERA · quitar una espera manejando más no es mejor: la tarjeta cuenta manejo + parado", () => {
    // A a 10 millas con ventana desde las 12:00; B a 60. A y luego B: 60 millas y 3 h de espera. B y luego A: 110 millas, sin espera.
    const e: EntradaDeOptimizar = {
      paradas: [P("a"), P("b"), D("a"), D("b")], puntos: [en(0), en(0), en(10), en(60)], cambios: [1, 1, -1, -1], base: en(0), fin: null, capacidad: 10,
      ventanas: [null, null, v(720, 1050, false), null], servicios: [5, 5, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 60]),
    };
    const antes = mideLaLista(e);
    expect(antes.millas).toBe(60);
    expect(antes.esperaMin).toBe(720 - (480 + 20 + 10));
    expect(jornadaDeTarjeta(antes)).toBe(20 + 10 + 10 + 50 + 10);
    const viejo = optimizaLaLista(e);
    expect(viejo.despues.millas).toBe(110);
    expect(viejo.despues.minutos).toBeLessThan(antes.minutos); // «mejor» para él: menos jornada CON esperas
    expect(jornadaDeTarjeta(viejo.despues)).toBeGreaterThan(jornadaDeTarjeta(antes)); // y peor en la tarjeta
    expect(optimizaSinEmpeorar(e).cambio).toBe(false);
  });
});

describe("2 · lo que SÍ hace: arregla lo que sale gratis, y ahorra sin retrasar más a nadie", () => {
  it("ARREGLA · si llegar a tiempo no cuesta ni millas ni tiempo, lo hace (y lo dice: «arregla»)", () => {
    // Con vuelta a la base, ir primero a la lejana mide lo mismo: 60 millas. Y A llega a tiempo.
    const e: EntradaDeOptimizar = {
      paradas: [P("b"), P("a"), D("b"), D("a")], puntos: [en(0), en(0), en(10), en(30)], cambios: [1, 1, -1, -1], base: en(0), capacidad: 10,
      ventanas: [null, null, null, v(480, 530)], servicios: [5, 5, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 30]),
    };
    const r = optimizaSinEmpeorar(e);
    expect(r).toMatchObject({ cambio: true, como: "arregla" });
    expect(r.antes.tarde).toHaveLength(1);
    expect(r.despues).toMatchObject({ millas: 60, tarde: [] });
    expect(r.paradas.filter((p) => p.tipo === "D")).toEqual([D("a"), D("b")]);
  });

  it("AHORRA · una ruta en zigzag que YA llega tarde a algo: baja las millas sin retrasar más a nadie", () => {
    // Cuatro entregas en zigzag; la de 40 tiene una ventana que ningún orden cumple desde aquí sin rodeo.
    const xs = [0, 10, 20, 30, 40];
    const e: EntradaDeOptimizar = {
      paradas: [P("1"), P("2"), P("3"), P("4"), D("3"), D("1"), D("4"), D("2")], puntos: [en(0), en(0), en(0), en(0), en(30), en(10), en(40), en(20)],
      cambios: [1, 1, 1, 1, -1, -1, -1, -1], base: en(0), capacidad: 10, servicios: [5, 5, 5, 5, 10, 10, 10, 10], salidaMin: 480, tiempos: recta(xs),
      ventanas: [null, null, null, null, null, null, v(480, 490), null],
    };
    const r = optimizaSinEmpeorar(e);
    expect(r.cambio).toBe(true);
    expect(r.despues.millas).toBe(80);
    expect(r.antes.millas).toBe(120);
    expect(noEsPeor(r.antes, r.despues)).toBe(true);
    // La de la ventana no llega más tarde que antes.
    expect(r.despues.tarde[0].minutos).toBeLessThanOrEqual(r.antes.tarde[0].minutos);
  });

  it("lo que devuelve es lo que mide su orden, con las ventanas y la capacidad DE VERDAD (no las relajadas)", () => {
    const e: EntradaDeOptimizar = {
      paradas: [P("1"), P("2"), P("3"), D("3"), D("1"), D("2")], puntos: [en(0), en(0), en(0), en(30), en(10), en(20)], cambios: [4, 4, 4, -4, -4, -4], base: en(0), capacidad: 10,
      servicios: [5, 5, 5, 10, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 20, 30]), ventanas: [null, null, null, null, v(480, 500), null],
    };
    const r = optimizaSinEmpeorar(e);
    expect(r.despues).toEqual(mideLaLista(entradaEnOrden(e, r.paradas)));
    expect(r.antes).toEqual(mideLaLista(e));
    expect(r.excesoDespues).toBe(r.despues.exceso);
    expect(r.millasDespues).toBe(r.despues.millas);
  });
});

describe("3 · la guarda y sus piezas", () => {
  const m = (centiMillas: number, minutos: number, esperaMin = 0, tarde: { orden: string; minutos: number; estrecha: boolean }[] = [], exceso = 0) =>
    ({ millas: centiMillas / 100, centiMillas, minutos, manejoMin: 0, esperaMin, exceso, tarde, cargaPalletMi: 0 });
  it("`noEsPeor`: ni millas, ni jornada de tarjeta, ni jornada con esperas, ni retraso, ni exceso", () => {
    const a = m(10_000, 300, 20, [{ orden: "x", minutos: 30, estrecha: true }, { orden: "y", minutos: 10, estrecha: false }], 1);
    expect(noEsPeor(a, a)).toBe(true);
    expect(noEsPeor(a, m(9_000, 280, 0, [], 0))).toBe(true);
    expect(noEsPeor(a, { ...a, centiMillas: 10_001 })).toBe(false);
    // Menos jornada con esperas pero más de tarjeta (20 min menos de espera, 10 más de manejo): peor.
    expect(noEsPeor(a, { ...a, minutos: 290, esperaMin: 0 })).toBe(false);
    expect(noEsPeor(a, { ...a, minutos: 301, esperaMin: 21 })).toBe(false);
    expect(noEsPeor(a, { ...a, tarde: [{ orden: "x", minutos: 31, estrecha: true }] })).toBe(false);
    // El retraso total no sube aunque el de las estrechas baje.
    expect(noEsPeor(a, { ...a, tarde: [{ orden: "y", minutos: 41, estrecha: false }] })).toBe(false);
    expect(noEsPeor(a, { ...a, tarde: [{ orden: "y", minutos: 40, estrecha: false }] })).toBe(true);
    expect(noEsPeor(a, { ...a, exceso: 1.5 })).toBe(false);
  });

  it("`picoDeCarga`: lo más que lleva a bordo, contando lo que ya iba recogido al salir", () => {
    expect(picoDeCarga({ paradas: [P("1"), P("2"), D("1"), D("2")], cambios: [6, 6, -6, -6] })).toBe(12);
    expect(picoDeCarga({ paradas: [P("1"), D("1"), P("2"), D("2")], cambios: [6, -6, 6, -6] })).toBe(6);
    // «z» ya va a bordo (su recogida no está en la lista): 3 desde la salida.
    expect(picoDeCarga({ paradas: [P("1"), D("z"), D("1")], cambios: [6, -3, -6] })).toBe(9);
    expect(picoDeCarga({ paradas: [P("1"), D("1")], cambios: [0.1, -0.1] })).toBe(0.1);
  });

  it("`comoLaVeElDespachador`: la ventana que ya se incumple se estira hasta su hora de ahora, y la capacidad hasta su pico", () => {
    const e: EntradaDeOptimizar = {
      paradas: [P("b"), P("a"), D("b"), D("a")], puntos: [en(0), en(0), en(10), en(30)], cambios: [6, 6, -6, -6], base: en(0), capacidad: 10,
      ventanas: [null, null, v(480, 600), v(480, 530)], servicios: [5, 5, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 30]),
    };
    const antes = mideLaLista(e);
    const r = comoLaVeElDespachador(e, antes);
    expect(r.capacidad).toBe(12);
    expect(r.ventanas).toEqual([null, null, v(480, 600), v(480, 530 + antes.tarde[0].minutos)]);
    // Visto así, la ruta de ahora no debe nada.
    expect(mideLaLista(r)).toMatchObject({ tarde: [], exceso: 0 });
    // Sin capacidad conocida, sigue sin mirarse.
    expect(comoLaVeElDespachador({ ...e, capacidad: null }, antes).capacidad).toBeNull();
  });

  it("los topes van DENTRO de la búsqueda: con ellos, `optimizaLaLista` no propone nada con más millas ni más tarjeta", () => {
    const e: EntradaDeOptimizar = {
      paradas: [P("b"), P("a"), D("b"), D("a")], puntos: [en(0), en(0), en(10), en(30)], cambios: [1, 1, -1, -1], base: en(0), fin: null, capacidad: 10,
      ventanas: [null, null, null, v(480, 530)], servicios: [5, 5, 10, 10], salidaMin: 480, tiempos: recta([0, 10, 30]),
    };
    expect(optimizaLaLista(e).despues.millas).toBe(50);
    expect(optimizaLaLista({ ...e, topes: { millas: 30 } }).cambio).toBe(false);
    expect(optimizaLaLista({ ...e, topes: { millas: 50 } }).despues.millas).toBe(50);
    // Y lo que se enseña como exceso es el de pallets, no la marca del tope.
    const pasada = mideLaLista({ ...e, topes: { millas: 10 } });
    expect(pasada).toMatchObject({ millas: 30, exceso: 0 });
  });
});

describe("4 · nunca peor, en rutas inventadas; y dentro de lo permitido, lo mejor que existe", () => {
  /** Un generador fijo (el congruencial de «Numerical Recipes»): sin `Math.random`. */
  const azar = (semilla: number) => () => { semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0; return semilla / 2 ** 32; };
  const inventada = (n: number, semilla: number): EntradaDeOptimizar => {
    const r = azar(semilla);
    const tiendas = [{ lat: 30, lng: -101 }, { lat: 30.25, lng: -100.8 }, { lat: 29.9, lng: -100.6 }];
    const ps: ParadaDeLaLista[] = [], ds: ParadaDeLaLista[] = [];
    const punto = new Map<ParadaDeLaLista, { lat: number; lng: number }>(), cambio = new Map<ParadaDeLaLista, number>(), ventana = new Map<ParadaDeLaLista, VentanaDeEntrega | null>(), servicio = new Map<ParadaDeLaLista, number>();
    for (let i = 0; i < n; i++) {
      const t = Math.floor(r() * tiendas.length), pal = 1 + Math.floor(r() * 5);
      const p = P(`o${i}`, `Tienda ${"ABC"[t]}`), d = D(`o${i}`);
      punto.set(p, tiendas[t]); punto.set(d, { lat: 29.8 + r() * 0.6, lng: -101.1 + r() * 0.7 });
      cambio.set(p, pal); cambio.set(d, -pal); servicio.set(p, pal * 4); servicio.set(d, pal * 5);
      const q = r();
      ventana.set(p, null); ventana.set(d, q < 0.3 ? v(510, 600, true) : q < 0.45 ? v(720, 1050, false) : v(510, 1050, false));
      ps.push(p); ds.push(d);
    }
    // Un orden cualquiera que respeta la precedencia: cada entrega, en un puesto al azar DESPUÉS de su recogida.
    const paradas: ParadaDeLaLista[] = [];
    ps.forEach((p, i) => { const a = Math.floor(r() * (paradas.length + 1)); paradas.splice(a, 0, p); const b = a + 1 + Math.floor(r() * (paradas.length - a)); paradas.splice(b, 0, ds[i]); });
    return {
      paradas, puntos: paradas.map((x) => punto.get(x)!), cambios: paradas.map((x) => cambio.get(x)!), base: tiendas[0], capacidad: 8,
      ventanas: paradas.map((x) => ventana.get(x)!), servicios: paradas.map((x) => servicio.get(x)!), salidaMin: 480,
    };
  };

  it("60 rutas inventadas (4 a 7 órdenes, con ventanas y camión justo): ninguna sale peor en nada", () => {
    let cambian = 0;
    for (let s = 1; s <= 60; s++) {
      const e = inventada(4 + (s % 4), 1000 + s);
      const r = optimizaSinEmpeorar(e);
      expect(noEsPeor(r.antes, r.despues), `semilla ${s}`).toBe(true);
      expect(r.despues, `semilla ${s}`).toEqual(mideLaLista(entradaEnOrden(e, r.paradas)));
      expect([...r.paradas].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), `semilla ${s}`).toEqual([...e.paradas].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
      if (r.cambio) cambian++; else expect(r.paradas).toEqual(e.paradas);
    }
    expect(cambian).toBeGreaterThan(30);
  }, 120_000);

  it("contra la fuerza bruta (3 órdenes): de los órdenes que no retrasan a nadie ni pasan los topes, da el de menos jornada y millas", () => {
    const SIN_BANDA = { porcientoDeJornada: 0, maxMin: 0, millas: 0 };
    const permutaciones = <T,>(l: T[]): T[][] => (l.length <= 1 ? [l] : l.flatMap((x, i) => permutaciones([...l.slice(0, i), ...l.slice(i + 1)]).map((p) => [x, ...p])));
    let comprobadas = 0;
    for (let s = 1; s <= 40; s++) {
      const e = { ...inventada(3, 5000 + s), tolerancia: SIN_BANDA };
      const r = optimizaSinEmpeorar(e);
      if (r.como === "arregla") continue;
      const antes = mideLaLista(e), relajada = comoLaVeElDespachador(e, antes);
      let mejor: [number, number] | null = null;
      for (const p of permutaciones([...e.paradas])) {
        if (p.some((x, i) => x.tipo === "D" && p.findIndex((y) => y.tipo === "P" && y.ordenes[0] === x.orden) > i)) continue;
        const q = mideLaLista(entradaEnOrden(relajada, p));
        if (q.tarde.length || q.exceso > 0 || q.centiMillas > antes.centiMillas || jornadaDeTarjeta(q) > jornadaDeTarjeta(antes)) continue;
        if (!mejor || q.minutos < mejor[0] || (q.minutos === mejor[0] && q.centiMillas < mejor[1])) mejor = [q.minutos, q.centiMillas];
      }
      expect(mejor, `semilla ${s}`).not.toBeNull();
      const dado = mideLaLista(entradaEnOrden(relajada, r.paradas));
      expect([dado.minutos, dado.centiMillas], `semilla ${s}`).toEqual(mejor);
      comprobadas++;
    }
    expect(comprobadas).toBeGreaterThan(15);
  }, 120_000);
});

describe("5 · la ruta que ya va a medias: lo pendiente sale de donde quedó el camión", () => {
  const coordsDeTienda = (n: string | null) => (n === "Tienda A" ? { lat: 30, lng: -101 } : n === "Tienda B" ? { lat: 30.5, lng: -100.5 } : null);
  const fechaDe = (x: Date) => x.toISOString().slice(0, 10);
  const base = { fecha: "2026-11-12", hoy: { fecha: "2026-11-12", minutos: 13 * 60 }, salidaMin: 480, coordsDeTienda, fechaDe };

  it("sin nada hecho hoy, o viendo otro día: `null` (la base, a su hora)", () => {
    expect(arranqueDeLoPendiente({ ...base, hechos: [] })).toBeNull();
    expect(arranqueDeLoPendiente({ ...base, hechos: [{ pod_delivered_at: null, delivery_lat: 30.1, delivery_lng: -101 }] })).toBeNull();
    // Mañana: aunque haya algo hecho, la ruta de mañana sale de la base.
    expect(arranqueDeLoPendiente({ ...base, fecha: "2026-11-13", hechos: [{ pod_delivered_at: "2026-11-12T15:00:00Z", delivery_lat: 30.1, delivery_lng: -101 }] })).toBeNull();
    // Lo recogido AYER y aún a bordo no dice dónde está hoy el camión.
    expect(arranqueDeLoPendiente({ ...base, hechos: [{ pickup_gps_at: "2026-11-11T20:00:00Z", pickup_name: "Tienda B" }] })).toBeNull();
  });

  it("con algo hecho hoy: el punto de lo ÚLTIMO (una entrega, o la tienda de una recogida), a la hora que es", () => {
    const hechos = [
      { pod_delivered_at: "2026-11-12T15:00:00Z", delivery_lat: 30.1, delivery_lng: -101.2 },
      { pickup_gps_at: "2026-11-12T17:30:00Z", pickup_name: "Tienda B", delivery_lat: 31, delivery_lng: -100 },
      { pod_delivered_at: "2026-11-12T16:00:00Z", delivery_lat: 30.2, delivery_lng: -101.3 },
    ];
    expect(arranqueDeLoPendiente({ ...base, hechos })).toEqual({ punto: { lat: 30.5, lng: -100.5 }, salidaMin: 780 });
    expect(arranqueDeLoPendiente({ ...base, hechos: hechos.filter((h) => !h.pickup_gps_at) })).toEqual({ punto: { lat: 30.2, lng: -101.3 }, salidaMin: 780 });
    // Antes de la hora de salida, la de salida. Y una recogida en una tienda sin coordenadas no cuenta.
    expect(arranqueDeLoPendiente({ ...base, hoy: { fecha: "2026-11-12", minutos: 400 }, hechos })!.salidaMin).toBe(480);
    expect(arranqueDeLoPendiente({ ...base, hechos: [{ pickup_gps_at: "2026-11-12T17:30:00Z", pickup_name: "Otra" }] })).toBeNull();
  });

  it("y con ese arranque el orden cambia: lo que queda cerca del camión va primero, no lo que queda cerca de la base", () => {
    // Pendientes: entregas en 10 y en 50 (ya recogidas). Desde la base (0): 10 y luego 50, y vuelta. Con el camión en 60: 50, 10, base.
    const pendientes = (desde: number): EntradaDeOptimizar => ({
      paradas: [D("lejos"), D("cerca"), D("medio")], puntos: [en(50), en(10), en(30)], cambios: [-1, -1, -1], base: en(desde), fin: en(0), capacidad: 10,
      servicios: [10, 10, 10], salidaMin: 780, tiempos: recta([0, 10, 30, 50, 60]),
    });
    const deLaBase = optimizaSinEmpeorar({ ...pendientes(0), paradas: [D("cerca"), D("lejos"), D("medio")], puntos: [en(10), en(50), en(30)] });
    expect(deLaBase.despues.millas).toBe(100);
    const delCamion = optimizaSinEmpeorar({ ...pendientes(60), paradas: [D("cerca"), D("lejos"), D("medio")], puntos: [en(10), en(50), en(30)] });
    expect(delCamion.paradas).toEqual([D("lejos"), D("medio"), D("cerca")]);
    expect(delCamion.despues.millas).toBe(60);
  });
});
