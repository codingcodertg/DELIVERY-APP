import { describe, expect, it } from "vitest";
import { cuentaDePallets, ordenSinRecoger, recogeEnLaUltimaPasada, type ParadaDeLaLista } from "./lista-unica";
import { optimizaLaLista, type EntradaDeOptimizar, type PuntoEnElMapa, type VentanaDeEntrega } from "./optimiza-la-ruta";
import { TOLERANCIA_DE_PASO } from "./route-engine";
import { claveDePunto } from "./route-times/claves";

/**
 * Recoger en la ÚLTIMA pasada (D-NEXT). El dueño, 2026-10-22, con un «🧭 Optimizar» delante: «if you pickup something up and
 * then come back to the same store later and you haven't delivered it the logic thing would be to pick it up until the second
 * time you arrive so the truck is not just driving around with extra weight».
 *
 * Tiendas, órdenes y puntos INVENTADOS. El caso de la sección 1 tiene la FORMA de una ruta real (cinco órdenes de una misma
 * tienda: una cerca, que se entrega antes de volver a cargar, y cuatro que salen en la segunda pasada), no sus datos.
 */

const P = (id: string, tienda: string | null = "Tienda Sur"): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
const forma = (ps: readonly ParadaDeLaLista[]) => ps.map((p) => (p.tipo === "P" ? `P${p.ordenes.join("+")}` : `D${p.orden}`)).join(" ");

/** Las pasadas de una lista, escritas aparte del módulo: recogidas seguidas en la misma tienda (sin mayúsculas ni espacios). */
function pasadas(ps: readonly ParadaDeLaLista[]): { tienda: string; inicio: number; ordenes: string[] }[] {
  const out: { tienda: string; inicio: number; ordenes: string[] }[] = [];
  ps.forEach((p, k) => {
    if (p.tipo !== "P" || !p.tienda?.trim()) return;
    const t = p.tienda.trim().toLowerCase();
    const previa = out[out.length - 1];
    if (previa && k > 0 && ps[k - 1].tipo === "P" && previa.tienda === t && previa.inicio + previa.ordenes.length === k) previa.ordenes.push(...p.ordenes);
    else out.push({ tienda: t, inicio: k, ordenes: [...p.ordenes] });
  });
  return out;
}
/** ¿Alguna orden se recoge en una pasada y la ruta vuelve a esa tienda antes de entregarla? La regla, dicha al revés. */
function cargaDeMas(ps: readonly ParadaDeLaLista[]): string[] {
  const pas = pasadas(ps);
  const entrega = (id: string) => ps.findIndex((p) => p.tipo === "D" && p.orden === id);
  return pas.flatMap((x, n) => x.ordenes.filter((id) => pas.some((y, m) => m > n && y.tienda === x.tienda && y.inicio < entrega(id))));
}

// ---------------------------------------------------------------------------------------------------------------------
// Puntos en una recta: minutos = millas = la distancia, para que cada número de las pruebas se pueda sacar a mano.

const en = (x: number): PuntoEnElMapa => ({ lat: 26 + x / 1000, lng: -98 });
function tiemposEnRecta(xs: readonly number[]) {
  const t: Record<string, Record<string, { minutos: number; millas: number }>> = {};
  for (const a of xs) for (const b of xs) if (a !== b) (t[claveDePunto(en(a))] ??= {})[claveDePunto(en(b))] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) };
  return t;
}
/** Una entrada en la recta: cada orden, su tienda (x), su entrega (x), sus pallets, sus minutos de carga y su ventana. */
type Orden = { tienda: number; nombre?: string; entrega: number; pallets: number; carga: number; ventana?: VentanaDeEntrega };
function entrada(ps: readonly ParadaDeLaLista[], ordenes: Record<string, Orden>, extra: Partial<EntradaDeOptimizar> = {}): EntradaDeOptimizar {
  const xs = [0, ...Object.values(ordenes).flatMap((o) => [o.tienda, o.entrega])];
  const de = (p: ParadaDeLaLista) => ordenes[p.tipo === "P" ? p.ordenes[0] : p.orden];
  return {
    paradas: ps, base: en(0), capacidad: 10, salidaMin: 480, recargaMinimaMin: 20, tiempos: tiemposEnRecta([...new Set(xs)]),
    puntos: ps.map((p) => en(p.tipo === "P" ? de(p).tienda : de(p).entrega)),
    cambios: ps.map((p) => (p.tipo === "P" ? de(p).pallets : -de(p).pallets)),
    servicios: ps.map((p) => (p.tipo === "P" ? de(p).carga : 0)),
    ventanas: ps.map((p) => (p.tipo === "D" ? de(p).ventana ?? null : null)),
    tolerancia: TOLERANCIA_DE_PASO,
    ...extra,
  };
}
/** Una ruta que la búsqueda no puede mejorar (ni búsqueda local ni exacta): lo que cambie, lo cambia la regla. */
/** Una ruta inventada, con un generador FIJO: una o dos tiendas (la base en la primera), entregas al azar, ventanas en un
 *  tercio, y la lista de partida barajada sin romper la precedencia. Tiempos por «calles» de mentira: la recta por 1.3. */
function inventada(ordenes: number, semilla: number): EntradaDeOptimizar {
  let s = semilla >>> 0;
  const azar = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const ent = (n: number) => Math.floor(azar() * n);
  const punto = () => ({ lat: Math.round((30 + azar() * 0.4) * 1e4) / 1e4, lng: Math.round((-101 - azar() * 0.6) * 1e4) / 1e4 });
  const tiendas = Array.from({ length: 1 + ent(2) }, (_, k) => ({ nombre: `Tienda ${k}`, pt: punto() }));
  const datos = Array.from({ length: ordenes }, (_, k) => ({ id: `o${k}`, t: tiendas[ent(tiendas.length)], d: punto(), pallets: [0.25, 1, 2, 3, 4][ent(5)], carga: [5, 10, 15, 20][ent(4)], descarga: [10, 15, 20][ent(3)],
    ventana: azar() < 0.3 ? { abre: 480, cierra: 600 + ent(300), estrecha: azar() < 0.5 } : null }));
  const lista: { x: typeof datos[number]; tipo: "P" | "D" }[] = [];
  const porRecoger = [...datos], abiertas: typeof datos = [];
  while (porRecoger.length || abiertas.length) {
    if (porRecoger.length && (!abiertas.length || azar() < 0.5)) { const x = porRecoger.splice(ent(porRecoger.length), 1)[0]; lista.push({ x, tipo: "P" }); abiertas.push(x); }
    else lista.push({ x: abiertas.splice(ent(abiertas.length), 1)[0], tipo: "D" });
  }
  const base = tiendas[0].pt;
  const puntos = lista.map(({ x, tipo }) => (tipo === "P" ? x.t.pt : x.d));
  const tiempos: Record<string, Record<string, { minutos: number; millas: number }>> = {};
  for (const a of [base, ...puntos]) for (const b of [base, ...puntos]) {
    if (claveDePunto(a) === claveDePunto(b)) continue;
    const mi = Math.hypot((a.lat - b.lat) * 69, (a.lng - b.lng) * 60) * 1.3;
    (tiempos[claveDePunto(a)] ??= {})[claveDePunto(b)] = { minutos: Math.round(mi * 1.5), millas: Math.round(mi * 100) / 100 };
  }
  return {
    paradas: lista.map(({ x, tipo }) => (tipo === "P" ? P(x.id, x.t.nombre) : D(x.id))), puntos,
    cambios: lista.map(({ x, tipo }) => (tipo === "P" ? x.pallets : -x.pallets)), base, capacidad: [4, 6, 10][ent(3)],
    ventanas: lista.map(({ x, tipo }) => (tipo === "D" ? x.ventana : null)), servicios: lista.map(({ x, tipo }) => (tipo === "P" ? x.carga : x.descarga)),
    salidaMin: 480, recargaMinimaMin: 20, tiempos, tolerancia: TOLERANCIA_DE_PASO,
  };
}
const SOLO_LA_REGLA: Partial<EntradaDeOptimizar> = { sinBusquedaLocal: true, topeDeLaExacta: 0 };

// =====================================================================================================================

describe("1 · la regla, sobre la lista (`recogeEnLaUltimaPasada`)", () => {
  // La forma del caso real: s1 se entrega cerca y se vuelve a la tienda por las otras cuatro. La lista de partida carga s2 y
  // s3 en la PRIMERA pasada —las pasea ida y vuelta hasta s1— aunque se entregan después de la segunda.
  const conCargaDeMas = [P("s1"), P("s2"), P("s3"), D("s1"), P("s4"), P("s5"), D("s5"), D("s4"), D("s2"), D("s3")];

  it("lo que se carga en la primera pasada y se entrega después de volver, se carga en la segunda", () => {
    expect(cargaDeMas(conCargaDeMas)).toEqual(["s2", "s3"]);
    const r = recogeEnLaUltimaPasada(conCargaDeMas);
    expect(forma(r)).toBe("Ps1 Ds1 Ps4 Ps5 Ps2 Ps3 Ds5 Ds4 Ds2 Ds3");
    expect(cargaDeMas(r)).toEqual([]);
  });

  it("si la primera pasada se queda vacía, desaparece: la ruta ya no pasa por la tienda al principio", () => {
    // x sale de la Tienda Sur, pero antes de entregarlo se va a la Tienda Norte, y se vuelve a la Sur por z.
    const ps = [P("x"), P("y", "Tienda Norte"), D("y"), P("z"), D("z"), D("x")];
    const r = recogeEnLaUltimaPasada(ps);
    expect(forma(r)).toBe("Py Dy Pz Px Dz Dx");
    expect(pasadas(r).map((p) => p.tienda)).toEqual(["tienda norte", "tienda sur"]);
  });

  it("a la ÚLTIMA pasada antes de su entrega, no a la última de la ruta; y lo que se entrega antes de volver no se mueve", () => {
    const ps = [P("a"), P("b"), D("b"), P("c"), D("a"), D("c"), P("d"), D("d")];
    // a: pasadas 1, 2 (antes de Da) y 3 (después): a la 2. b: se entrega antes de volver, se queda. c: se entrega antes de la 3.
    expect(forma(recogeEnLaUltimaPasada(ps))).toBe("Pb Db Pc Pa Da Dc Pd Dd");
  });

  it("solo cuenta la MISMA tienda (sin mayúsculas ni espacios de más); una recogida sin tienda no se junta con nada", () => {
    expect(forma(recogeEnLaUltimaPasada([P("a", "Tienda Sur"), D("x"), P("b", " tienda sur "), D("b"), D("a")]))).toBe("Dx Pb Pa Db Da");
    expect(forma(recogeEnLaUltimaPasada([P("a", "Tienda Sur"), D("x"), P("b", "Tienda Norte"), D("b"), D("a")]))).toBe("Pa Dx Pb Db Da");
    expect(forma(recogeEnLaUltimaPasada([P("a", null), D("x"), P("b", null), D("b"), D("a")]))).toBe("Pa Dx Pb Db Da");
  });

  it("una recogida de varias órdenes (una lista vieja) va entera a la última pasada antes de la PRIMERA de sus entregas", () => {
    // Db va después de la pasada de d, pero Da no: la recogida de las dos se queda en la de c.
    const vieja: ParadaDeLaLista[] = [{ tipo: "P", ordenes: ["a", "b"], tienda: "Tienda Sur" }, D("x"), P("c"), D("a"), D("c"), P("d"), D("b"), D("d")];
    expect(forma(recogeEnLaUltimaPasada(vieja))).toBe("Dx Pc Pa+b Da Dc Pd Db Dd");
  });

  it("en 400 listas al azar: las mismas paradas, la precedencia, nunca más carga a bordo, ya cumple la regla, y otra vez no cambia nada", () => {
    let s = 20261022;
    const azar = (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
    let cambiaron = 0;
    for (let vuelta = 0; vuelta < 400; vuelta++) {
      const n = 2 + azar(7);
      const tiendas = ["Tienda Sur", "Tienda Norte", "tienda sur"];
      const pallets = new Map<string, number>();
      const ps: ParadaDeLaLista[] = [];
      const porRecoger = Array.from({ length: n }, (_, k) => `o${k}`), abiertas: string[] = [];
      while (porRecoger.length || abiertas.length) {
        if (porRecoger.length && (!abiertas.length || azar(2))) {
          const id = porRecoger.splice(azar(porRecoger.length), 1)[0];
          pallets.set(id, 1 + azar(4));
          ps.push(P(id, tiendas[azar(3)])); abiertas.push(id);
        } else ps.push(D(abiertas.splice(azar(abiertas.length), 1)[0]));
      }
      const r = recogeEnLaUltimaPasada(ps);
      const carga = (l: readonly ParadaDeLaLista[]) => cuentaDePallets(l.map((p) => (p.tipo === "P" ? pallets.get(p.ordenes[0])! : -pallets.get(p.orden)!)), 10);
      expect([...r].sort((a, b) => forma([a]).localeCompare(forma([b])))).toEqual([...ps].sort((a, b) => forma([a]).localeCompare(forma([b]))));
      expect(ordenSinRecoger(r)).toBeNull();
      expect(carga(r).totales.cargaMaxima).toBeLessThanOrEqual(carga(ps).totales.cargaMaxima);
      // La carga a bordo al llegar a cada entrega, la misma o menos.
      const alEntregar = (l: readonly ParadaDeLaLista[]) => new Map(l.flatMap((p, k) => (p.tipo === "D" ? [[p.orden, carga(l).paradas[k].antes] as const] : [])));
      const antes = alEntregar(ps), despues = alEntregar(r);
      for (const [id, c] of despues) expect(c).toBeLessThanOrEqual(antes.get(id)!);
      expect(cargaDeMas(r)).toEqual([]);
      expect(forma(recogeEnLaUltimaPasada(r))).toBe(forma(r));
      if (forma(r) !== forma(ps)) cambiaron++;
    }
    // Que las listas lleven de verdad la carga de más: si ninguna cambiara, la prueba no probaría nada.
    expect(cambiaron).toBeGreaterThan(60);
  });
});

describe("2 · en «🧭 Optimizar»: lo que sale se recoge en la última pasada, si no rompe nada", () => {
  // El caso de la sección 1 en un mapa inventado: la Tienda Sur en 0 (y la base); s1 cerca (4), s5 cerca (6), s4 a media
  // ruta (25), s3 a la Tienda Centro (55) y s2 lejos (70). Los pallets son los del caso: 1, 4, 0.25, 3 y 2. Capacidad 10.
  const ordenes: Record<string, Orden> = {
    s1: { tienda: 0, entrega: 4, pallets: 1, carga: 15 }, s2: { tienda: 0, entrega: 70, pallets: 4, carga: 15 },
    s3: { tienda: 0, entrega: 55, pallets: 0.25, carga: 15 }, s4: { tienda: 0, entrega: 25, pallets: 3, carga: 15 },
    s5: { tienda: 0, entrega: 6, pallets: 2, carga: 15 },
  };
  const conCargaDeMas = [P("s1"), P("s2"), P("s3"), D("s1"), P("s4"), P("s5"), D("s5"), D("s4"), D("s2"), D("s3")];

  it("el caso: la lista que pasea s2 y s3 hasta s1 y de vuelta sale sin carga de más, y no peor", () => {
    const e = entrada(conCargaDeMas, ordenes);
    const r = optimizaLaLista(e);
    expect(cargaDeMas(r.paradas)).toEqual([]);
    expect(r.despues.exceso).toBe(0);
    expect(r.despues.tarde).toEqual([]);
    expect(r.despues.cargaPalletMi).toBeLessThan(r.antes.cargaPalletMi);
  });

  it("aunque la búsqueda no encuentre nada mejor, la regla se aplica: s2 y s3 pasan a la segunda pasada", () => {
    const e = entrada(conCargaDeMas, ordenes, SOLO_LA_REGLA);
    const r = optimizaLaLista(e);
    expect(r.cambio).toBe(true);
    expect(cargaDeMas(r.paradas)).toEqual([]);
    expect(pasadas(r.paradas).map((p) => [...p.ordenes].sort())).toEqual([["s1"], ["s2", "s3", "s4", "s5"]]);
    // A mano: la primera pasada carga 45 minutos (tres de 15) y se queda en 20; la segunda pasa de 30 a 60. Jornada: +5.
    // Lo que deja de pasear: 4.25 pallets 8 millas (de la tienda a s1 y de vuelta) = 34 pallet·milla.
    expect(r.despues.minutos - r.antes.minutos).toBe(5);
    expect(r.despues.millas).toBe(r.antes.millas);
    expect(Math.round((r.antes.cargaPalletMi - r.despues.cargaPalletMi) * 10) / 10).toBe(34);
  });

  it("si cargarla en la segunda pasada hace llegar tarde, no se mueve; la que no estorba, sí", () => {
    // La primera pasada carga a (4), b (4) y c (10): 18, se queda en la recarga mínima de 20. La segunda carga d (12): 20.
    // Con b, 16 → 20 (no cuesta nada); con c, 22 (+2 minutos); con las dos, 26. Y d tiene una ventana ESTRECHA que cierra
    // justo cuando llega: 480 + 20 + 5 + 5 + 20 + 60 = 590.
    const ventana = (cierra: number): VentanaDeEntrega => ({ abre: 480, cierra, estrecha: true });
    const caso = (cierra: number): Record<string, Orden> => ({
      a: { tienda: 0, entrega: 5, pallets: 1, carga: 4 }, b: { tienda: 0, entrega: 40, pallets: 1, carga: 4 },
      c: { tienda: 0, entrega: 20, pallets: 1, carga: 10 }, d: { tienda: 0, entrega: 60, pallets: 1, carga: 12, ventana: ventana(cierra) },
    });
    const lista = [P("a"), P("b"), P("c"), D("a"), P("d"), D("d"), D("b"), D("c")];
    const justa = optimizaLaLista(entrada(lista, caso(590), SOLO_LA_REGLA));
    expect(justa.antes.tarde).toEqual([]);
    expect(justa.despues.tarde).toEqual([]);
    expect(pasadas(justa.paradas).map((p) => [...p.ordenes].sort())).toEqual([["a", "c"], ["b", "d"]]);
    expect(justa.despues.minutos).toBe(justa.antes.minutos);
    // Con la ventana más holgada, las dos: la jornada crece 6 minutos, dentro de la banda (el 5 % de 170, 9).
    const holgada = optimizaLaLista(entrada(lista, caso(700), SOLO_LA_REGLA));
    expect(pasadas(holgada.paradas).map((p) => [...p.ordenes].sort())).toEqual([["a"], ["b", "c", "d"]]);
    expect(holgada.despues.minutos - holgada.antes.minutos).toBe(6);
  });

  it("y si cuesta más que la banda, tampoco: la carga de más se queda antes que alargar la jornada", () => {
    // Sin ventana: c carga 16 minutos y d 20. La primera pasada (4 + 16) se queda en la recarga mínima con c o sin ella; la
    // segunda pasaría de 20 a 36: 16 minutos más, y la banda de una jornada de 170 es de 9.
    const ordenes2: Record<string, Orden> = {
      a: { tienda: 0, entrega: 5, pallets: 1, carga: 4 }, c: { tienda: 0, entrega: 20, pallets: 1, carga: 16 },
      d: { tienda: 0, entrega: 60, pallets: 1, carga: 20 },
    };
    const r = optimizaLaLista(entrada([P("a"), P("c"), D("a"), P("d"), D("d"), D("c")], ordenes2, SOLO_LA_REGLA));
    expect(r.cambio).toBe(false);
    expect(cargaDeMas(r.paradas)).toEqual(["c"]);
  });

  it("cuando la búsqueda gana, la banda es la del MEJOR orden y no la de lo que había: c no se mueve aunque siga ganando de largo", () => {
    // Capacidad 4: a (3) y d (3) no caben juntas. Lo mejor que existe carga a y c (1) en la primera pasada —4 + 16 minutos,
    // la recarga mínima— y vuelve por d: 170 minutos. Cargar c con d alarga la segunda de 20 a 36: 186, fuera de la banda
    // de 170 (9). La lista de partida va en tres viajes, 230 minutos: con la regla seguiría ganándole, y no vale.
    const ordenes5: Record<string, Orden> = {
      a: { tienda: 0, entrega: 5, pallets: 3, carga: 4 }, c: { tienda: 0, entrega: 20, pallets: 1, carga: 16 },
      d: { tienda: 0, entrega: 60, pallets: 3, carga: 20 },
    };
    const r = optimizaLaLista(entrada([P("a"), D("a"), P("c"), D("c"), P("d"), D("d")], ordenes5, { capacidad: 4 }));
    expect([r.antes.minutos, r.despues.minutos]).toEqual([230, 170]);
    expect(cargaDeMas(r.paradas)).toEqual(["c"]);
  });

  it("y si cuesta minutos, la carga que deja de pasear tiene que llegar al margen de D-464: 0.8 pallet·milla por 7 minutos, no", () => {
    // Capacidad 3.1: c (0.1) cabe con a o con d, a y d no caben juntas. Lo mejor: a y c en la primera pasada (4 + 8, en la
    // recarga mínima), vuelta por d (19 → 20): 168 minutos. Cargar c con d: 27, 7 minutos más (dentro de la banda, 8), por
    // no pasear 0.1 pallet 8 millas. La lista de partida, en tres viajes (228), pierde contra las dos.
    const ordenes6: Record<string, Orden> = {
      a: { tienda: 0, entrega: 4, pallets: 3, carga: 4 }, c: { tienda: 0, entrega: 20, pallets: 0.1, carga: 8 },
      d: { tienda: 0, entrega: 60, pallets: 3, carga: 19 },
    };
    const r = optimizaLaLista(entrada([P("a"), D("a"), P("c"), D("c"), P("d"), D("d")], ordenes6, { capacidad: 3.1 }));
    expect([r.antes.minutos, r.despues.minutos]).toEqual([228, 168]);
    expect(cargaDeMas(r.paradas)).toEqual(["c"]);
  });

  it("la primera pasada que se queda vacía desaparece también aquí: 20 minutos menos de recarga", () => {
    const ordenes3: Record<string, Orden> = {
      x: { tienda: 0, entrega: 25, pallets: 1, carga: 5 }, y: { tienda: 8, nombre: "Tienda Norte", entrega: 10, pallets: 1, carga: 5 },
      z: { tienda: 0, entrega: 20, pallets: 1, carga: 5 },
    };
    const lista = [P("x"), P("y", "Tienda Norte"), D("y"), P("z"), D("z"), D("x")];
    const r = optimizaLaLista(entrada(lista, ordenes3, SOLO_LA_REGLA));
    expect(forma(r.paradas)).toBe("Py Dy Px Pz Dz Dx");
    expect(r.antes.minutos - r.despues.minutos).toBe(20);
  });

  it("por debajo del margen de la carga (D-464, un pallet·milla) el criterio de carga no movía nada; la regla sí, porque no cuesta nada", () => {
    // Capacidad 4: a (3) y c (3) no caben juntas, así que se vuelve a la tienda. b (0.25) sale en la primera pasada y se
    // entrega al final: pasea 0.25 pallets ida y vuelta hasta a, 0.5 pallet·milla. Cargarla en la segunda no cuesta ni un
    // minuto (las dos pasadas siguen en la recarga mínima) ni una milla. Sin la regla, la lista se quedaba como estaba.
    const ordenes4: Record<string, Orden> = {
      a: { tienda: 0, entrega: 1, pallets: 3, carga: 5 }, b: { tienda: 0, entrega: 50, pallets: 0.25, carga: 5 },
      c: { tienda: 0, entrega: 40, pallets: 3, carga: 5 },
    };
    const r = optimizaLaLista(entrada([P("a"), P("b"), D("a"), P("c"), D("c"), D("b")], ordenes4, { capacidad: 4 }));
    expect(r.cambio).toBe(true);
    expect(cargaDeMas(r.paradas)).toEqual([]);
    expect(pasadas(r.paradas).map((p) => [...p.ordenes].sort())).toEqual([["a"], ["b", "c"]]);
    expect([r.despues.minutos, r.despues.millas, r.despues.exceso]).toEqual([r.antes.minutos, r.antes.millas, 0]);
    expect(Math.round((r.antes.cargaPalletMi - r.despues.cargaPalletMi) * 10) / 10).toBe(0.5);
  });
  it("y cuando la búsqueda SÍ mejora la lista, lo que elige también: dos rutas inventadas de 11 órdenes que la exacta no termina", () => {
    // Medido al hacerlo: 150 rutas de este generador, 5 salían con carga de más y quedan 3 (una llegaría tarde a una ventana
    // estrecha, dos se salen de la banda). Estas son las dos que cambian: 576 → 586 minutos y 816 → 594 pallet·milla; y 609
    // → 609 minutos y 1005 → 908.
    for (const [semilla, minutos, carga] of [[7023, 586, 594.3], [7031, 609, 908.1]] as const) {
      const r = optimizaLaLista(inventada(11, semilla));
      expect(r.exacta).toBe(false);
      expect(cargaDeMas(r.paradas), `semilla ${semilla}`).toEqual([]);
      expect([r.despues.minutos, r.despues.cargaPalletMi, r.despues.exceso, r.despues.tarde.length]).toEqual([minutos, carga, 0, 0]);
    }
  }, 120_000);
});
