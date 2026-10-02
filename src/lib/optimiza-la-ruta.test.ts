import { describe, expect, it } from "vitest";
import { ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";
import {
  MAX_PARADAS_DE_LA_EXACTA, mideLaLista, minutosEnCadaParada, optimizaLaLista, TOPE_DE_PASOS,
  type EntradaDeOptimizar, type MedidaDeLaLista, type PuntoEnElMapa, type TiemposDeLaRuta, type VentanaDeEntrega,
} from "./optimiza-la-ruta";
import { evaluaRuta, PARAMETROS_POR_DEFECTO, type ChoferEntrada, type Matriz, type OrdenEntrada, type ParadaRef } from "./route-engine";
import { claveDePunto } from "./route-times/claves";
import { FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS, millasEnLineaRecta } from "./route-times/proveedores";
import REALES from "./optimizar-casos-reales.json";

/**
 * «🧭 Optimizar» una ruta, rehecho (D-NEXT). El dueño, 2026-10-02: «sigamos trabajando en el alrgoritmo de optimizar ruta
 * porque sigue muy mal ineficente».
 *
 * Lo que se fija aquí:
 *   1. la CUENTA —horas, millas, retrasos, exceso— es la del motor de «Armar rutas» (`evaluaRuta`);
 *   2. cuando dice «exacta», es el mejor orden que EXISTE: comprobado contra la fuerza bruta (todas las permutaciones) y
 *      contra una búsqueda exhaustiva con memoria escrita aparte, con otra formulación;
 *   3. las rutas REALES (anonimizadas) donde el Optimizar de D-456 perdía: cuánto perdía, y que ahora sale el óptimo;
 *   4. lo que no se rompe nunca: las mismas paradas, la precedencia, la capacidad, y no salir peor de lo que se entró;
 *   5. el orden de los objetivos: capacidad → ventanas (las estrechas primero) → jornada → millas.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Aparejos: una cuenta ESCRITA APARTE de la del módulo, la fuerza bruta y la búsqueda exhaustiva con memoria.

/** Las pruebas que buscan de verdad (fuerza bruta, exhaustiva, cien rutas) llevan su propio tope: en CI la máquina es más lenta. */
const LARGA = 120_000;
const P = (id: string, tienda: string | null = "T"): ParadaDeLaLista => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): ParadaDeLaLista => ({ tipo: "D", orden: id });
const forma = (ps: readonly ParadaDeLaLista[]) => ps.map((p) => (p.tipo === "P" ? `P${p.ordenes.join("+")}` : `D${p.orden}`)).join(" ");
const clave = (p: PuntoEnElMapa | null | undefined) => (p ? claveDePunto(p) : null);

/** [exceso en centésimas, minutos tarde en ventana estrecha, en las demás, minutos de jornada, centésimas de milla]. */
type Nota = [number, number, number, number, number];
const menor = (a: Nota, b: Nota) => { for (let k = 0; k < 5; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };

/** La cuenta de la prueba. No comparte ni una línea con `optimiza-la-ruta.ts`: si las dos se equivocan, no será igual. */
function cuenta(e: EntradaDeOptimizar, orden: readonly number[]): Nota {
  const salida = e.salidaMin ?? 480, recarga = e.recargaMinimaMin ?? 20;
  const cap = e.capacidad ? Math.round(e.capacidad * 100) : null;
  const tramo = (a: PuntoEnElMapa, b: PuntoEnElMapa): [number, number] => {
    if (clave(a) === clave(b)) return [0, 0];
    const t = e.tiempos?.[clave(a)!]?.[clave(b)!];
    if (t) return [Math.round(t.minutos), Math.round(t.millas * 100)];
    const mi = Math.round(millasEnLineaRecta(a, b) * FACTOR_DE_RODEO * 100) / 100;
    return [Math.round((mi / MILLAS_POR_HORA_ESTIMADAS) * 60), Math.round(mi * 100)];
  };
  let reloj = salida, sitio = e.base, carga = 0, exceso = 0, tE = 0, tA = 0, cmi = 0;
  const mismaVisita = (a: number, b: number) => {
    const p = e.paradas[a], q = e.paradas[b];
    return p.tipo === "P" && q.tipo === "P" && !!p.tienda && p.tienda === q.tienda && clave(e.puntos[a]) === clave(e.puntos[b]);
  };
  for (let k = 0; k < orden.length; k++) {
    const i = orden[k], p = e.paradas[i], pt = e.puntos[i];
    if (pt) { if (sitio) { const [min, mi] = tramo(sitio, pt); reloj += min; cmi += mi; } sitio = pt; }
    if (p.tipo === "P") {
      if (!(k > 0 && mismaVisita(orden[k - 1], i))) {
        let suma = 0;
        for (let j = k; j < orden.length && (j === k || mismaVisita(i, orden[j])); j++) suma += e.servicios?.[orden[j]] ?? 0;
        reloj += Math.max(recarga, suma);
      }
    } else {
      const v = e.ventanas?.[i];
      let inicio = reloj;
      if (v) { if (reloj < v.abre) inicio = v.abre; if (inicio > v.cierra) { if (v.estrecha) tE += inicio - v.cierra; else tA += inicio - v.cierra; } }
      reloj = inicio + (e.servicios?.[i] ?? 0);
    }
    carga += Math.round((e.cambios[i] ?? 0) * 100);
    if (cap != null && carga > cap) exceso += carga - cap;
  }
  if (e.base && sitio) { const [min, mi] = tramo(sitio, e.base); reloj += min; cmi += mi; }
  return [exceso, tE, tA, reloj - salida, cmi];
}
const antesDe = (e: EntradaDeOptimizar) => e.paradas.map((p) => (p.tipo === "D" ? e.paradas.findIndex((q) => q.tipo === "P" && q.ordenes.includes(p.orden)) : -1));
const indicesDe = (e: EntradaDeOptimizar, ps: readonly ParadaDeLaLista[]) => ps.map((p) => e.paradas.indexOf(p));
const notaDeLaMedida = (m: MedidaDeLaLista): [number, number, number, number, number] => [
  Math.round(m.exceso * 100), m.tarde.filter((t) => t.estrecha).reduce((s, t) => s + t.minutos, 0),
  m.tarde.filter((t) => !t.estrecha).reduce((s, t) => s + t.minutos, 0), m.minutos, Math.round(m.millas * 10),
];

/** FUERZA BRUTA: todas las permutaciones que no entregan antes de recoger. Para listas de hasta 10 paradas. */
function fuerzaBruta(e: EntradaDeOptimizar): Nota {
  const m = e.paradas.length, antes = antesDe(e);
  let mejor: Nota | null = null;
  const orden: number[] = [], usada = new Array<boolean>(m).fill(false);
  const baja = () => {
    if (orden.length === m) { const n = cuenta(e, orden); if (!mejor || menor(n, mejor)) mejor = n; return; }
    for (let i = 0; i < m; i++) {
      if (usada[i] || (antes[i] >= 0 && !usada[antes[i]])) continue;
      usada[i] = true; orden.push(i); baja(); orden.pop(); usada[i] = false;
    }
  };
  baja();
  return mejor!;
}

/**
 * BÚSQUEDA EXHAUSTIVA CON MEMORIA, con otra formulación que la del módulo: aquí las recogidas de una visita a una tienda
 * entran DE GOLPE (un subconjunto de las pendientes de esa tienda), y de cada estado —qué va hecho, dónde está el camión y
 * si acaba de cargar ahí— se guardan todas las notas que ninguna otra mejora en todo. Sin cotas ni podas. Llega a 8 órdenes.
 */
function exhaustiva(e: EntradaDeOptimizar): Nota {
  const m = e.paradas.length, antes = antesDe(e);
  const salida = e.salidaMin ?? 480, recarga = e.recargaMinimaMin ?? 20, cap = e.capacidad ? Math.round(e.capacidad * 100) : null;
  const cambio = e.cambios.map((c) => Math.round((c ?? 0) * 100)), serv = e.paradas.map((_, i) => e.servicios?.[i] ?? 0);
  const grupo = e.paradas.map((p, i) => (p.tipo === "P" && p.tienda ? `${p.tienda}|${clave(e.puntos[i])}` : null));
  const viaje = (de: PuntoEnElMapa | null, a: PuntoEnElMapa | null): [number, number] => {
    if (!de || !a || clave(de) === clave(a)) return [0, 0];
    const t = e.tiempos?.[clave(de)!]?.[clave(a)!];
    if (t) return [Math.round(t.minutos), Math.round(t.millas * 100)];
    const mi = Math.round(millasEnLineaRecta(de, a) * FACTOR_DE_RODEO * 100) / 100;
    return [Math.round((mi / MILLAS_POR_HORA_ESTIMADAS) * 60), Math.round(mi * 100)];
  };
  type Estado = { hechas: number; sitio: PuntoEnElMapa | null; visita: string | null; notas: Nota[] };
  const porCuenta: Map<string, Estado>[] = Array.from({ length: m + 1 }, () => new Map());
  const bits = (x: number) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
  const domina = (a: Nota, b: Nota) => a.every((x, k) => x <= b[k]);
  const pon = (hechas: number, sitio: PuntoEnElMapa | null, visita: string | null, n: Nota) => {
    const mapa = porCuenta[bits(hechas)], k = `${hechas}|${clave(sitio)}|${visita}`;
    const est = mapa.get(k) ?? { hechas, sitio, visita, notas: [] };
    if (est.notas.some((o) => domina(o, n))) return;
    est.notas = est.notas.filter((o) => !domina(n, o));
    est.notas.push(n);
    mapa.set(k, est);
  };
  pon(0, e.base, null, [0, 0, 0, salida, 0]);
  for (let c = 0; c < m; c++) {
    for (const est of porCuenta[c].values()) {
      let carga = 0;
      for (let i = 0; i < m; i++) if (est.hechas & (1 << i)) carga += cambio[i];
      const libres = e.paradas.map((_, i) => i).filter((i) => !(est.hechas & (1 << i)) && (antes[i] < 0 || est.hechas & (1 << antes[i])));
      for (const [exc, tE, tA, t, cmi] of est.notas) {
        // Una entrega, o una recogida suelta (sin tienda).
        for (const k of libres) {
          if (grupo[k] != null) continue;
          const [min, mi] = viaje(est.sitio, e.puntos[k]);
          const p = e.paradas[k];
          let nE = tE, nA = tA, fin = t + min;
          if (p.tipo === "P") fin += Math.max(recarga, serv[k]);
          else {
            const v = e.ventanas?.[k];
            if (v) { if (fin < v.abre) fin = v.abre; if (fin > v.cierra) { if (v.estrecha) nE += fin - v.cierra; else nA += fin - v.cierra; } }
            fin += serv[k];
          }
          const tras = carga + cambio[k];
          pon(est.hechas | (1 << k), e.puntos[k] ?? est.sitio, null, [exc + (cap != null && tras > cap ? tras - cap : 0), nE, nA, fin, cmi + mi]);
        }
        // Una visita a una tienda: cualquier subconjunto de sus recogidas pendientes, de golpe. (Dos visitas seguidas a la
        // misma tienda son UNA: por eso no se repite la tienda de la que se acaba de cargar.)
        for (const g of new Set(libres.map((k) => grupo[k]).filter((x): x is string => x != null && x !== est.visita))) {
          const suyas = libres.filter((k) => grupo[k] === g);
          const [min, mi] = viaje(est.sitio, e.puntos[suyas[0]]);
          for (let sub = 1; sub < 1 << suyas.length; sub++) {
            const van = suyas.filter((_, x) => sub & (1 << x)).sort((a, b) => cambio[a] - cambio[b]);
            let tras = carga, exceso = exc, hechas = est.hechas;
            for (const k of van) { tras += cambio[k]; if (cap != null && tras > cap) exceso += tras - cap; hechas |= 1 << k; }
            pon(hechas, e.puntos[suyas[0]] ?? est.sitio, g, [exceso, tE, tA, t + min + Math.max(recarga, van.reduce((s, k) => s + serv[k], 0)), cmi + mi]);
          }
        }
      }
    }
  }
  let mejor: Nota | null = null;
  for (const est of porCuenta[m].values()) {
    const [min, mi] = e.base ? viaje(est.sitio, e.base) : [0, 0];
    for (const [exc, tE, tA, t, cmi] of est.notas) { const n: Nota = [exc, tE, tA, t + min - salida, cmi + mi]; if (!mejor || menor(n, mejor)) mejor = n; }
  }
  return mejor!;
}

/** Un generador FIJO (congruencial): las listas inventadas son siempre las mismas. */
function generador(semilla: number) {
  let s = semilla >>> 0;
  const azar = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { azar, ent: (n: number) => Math.floor(azar() * n) };
}

/**
 * Una ruta inventada con la forma de las reales: pocas tiendas (varias órdenes salen de la misma), entregas que coinciden
 * en el mismo sitio o en otra tienda, ventanas estrechas y anchas, y tiempos por calles que no son simétricos.
 */
function inventa(ordenes: number, semilla: number, o: { sinPunto?: boolean; sinBase?: boolean; capacidad?: number; cierre?: number; juntas?: boolean } = {}): EntradaDeOptimizar {
  const { azar, ent } = generador(semilla);
  const punto = (): PuntoEnElMapa => ({ lat: Math.round((30 + azar() * 0.4) * 1e4) / 1e4, lng: Math.round((-101 - azar() * 0.6) * 1e4) / 1e4 });
  const tiendas = Array.from({ length: 1 + ent(3) }, (_, k) => ({ nombre: `Tienda ${k}`, pt: punto() }));
  const sitios = Array.from({ length: 2 + ent(4) }, punto);
  const datos = Array.from({ length: ordenes }, (_, k) => {
    const t = tiendas[ent(tiendas.length)];
    const r = azar();
    const ventana: VentanaDeEntrega | null = r < 0.25 ? { abre: 510, cierra: 600, estrecha: true } : r < 0.4 ? { abre: 510, cierra: 720, estrecha: true }
      : r < 0.9 ? { abre: 510, cierra: o.cierre ?? 1050, estrecha: false } : null;
    return { id: `o${k}`, t, d: azar() < 0.25 ? tiendas[ent(tiendas.length)].pt : sitios[ent(sitios.length)], pallets: [0.15, 1, 2, 3, 4, 6][ent(6)], ventana,
      carga: [1, 4, 8, 12, 24, 32][ent(6)], descarga: [1, 5, 10, 15, 30, 40][ent(6)] };
  });
  // La lista de partida: cada orden con su recogida y enseguida su entrega (`juntas`), o barajada sin romper la precedencia.
  const lista: { x: typeof datos[number]; tipo: "P" | "D" }[] = [];
  if (o.juntas) for (const x of datos) lista.push({ x, tipo: "P" }, { x, tipo: "D" });
  else {
    const porRecoger = [...datos], abiertas: typeof datos = [];
    while (porRecoger.length || abiertas.length) {
      if (porRecoger.length && (!abiertas.length || azar() < 0.5)) { const x = porRecoger.splice(ent(porRecoger.length), 1)[0]; lista.push({ x, tipo: "P" }); abiertas.push(x); }
      else lista.push({ x: abiertas.splice(ent(abiertas.length), 1)[0], tipo: "D" });
    }
  }
  const base = o.sinBase && azar() < 0.5 ? null : azar() < 0.6 ? tiendas[0].pt : punto();
  const puntos = lista.map(({ x, tipo }) => (o.sinPunto && azar() < 0.08 ? null : tipo === "P" ? x.t.pt : x.d));
  const todos = [base, ...puntos].filter((p): p is PuntoEnElMapa => !!p);
  const tiempos: Record<string, Record<string, { minutos: number; millas: number }>> = {};
  for (const a of todos) for (const b of todos) {
    if (clave(a) === clave(b)) continue;
    const mi = Math.hypot((a.lat - b.lat) * 69, (a.lng - b.lng) * 60) * (1.15 + azar() * 0.5);
    (tiempos[clave(a)!] ??= {})[clave(b)!] = { minutos: Math.round(mi * (1.2 + azar())), millas: Math.round(mi * 100) / 100 };
  }
  return {
    paradas: lista.map(({ x, tipo }) => (tipo === "P" ? P(x.id, x.t.nombre) : D(x.id))), puntos,
    cambios: lista.map(({ x, tipo }) => (tipo === "P" ? x.pallets : -x.pallets)), base, capacidad: o.capacidad ?? [4, 6, 10, 12][ent(4)],
    ventanas: lista.map(({ x, tipo }) => (tipo === "D" ? x.ventana : null)), servicios: lista.map(({ x, tipo }) => (tipo === "P" ? x.carga : x.descarga)),
    salidaMin: 480, recargaMinimaMin: 20, tiempos,
  };
}

/** ¿El resultado es el óptimo `o`? Lo es si mide lo mismo, o si la entrada ya lo era salvo el margen que no vale un cambio. */
function esElOptimo(e: EntradaDeOptimizar, r: ReturnType<typeof optimizaLaLista>, o: Nota): boolean {
  const suya = cuenta(e, indicesDe(e, r.paradas));
  return suya[0] === o[0] && suya[1] === o[1] && suya[2] === o[2] && suya[3] === o[3] && suya[4] - o[4] < 10;
}

// ---------------------------------------------------------------------------------------------------------------------
// Las rutas reales, anonimizadas.

type CasoReal = {
  id: string; que: string; capacidad: number; base: PuntoEnElMapa; basePantalla: PuntoEnElMapa | null;
  paradas: ParadaDeLaLista[]; puntos: (PuntoEnElMapa | null)[]; cambios: number[]; ventanas: (VentanaDeEntrega | null)[]; servicios: number[];
  tiempos: Record<string, Record<string, [number, number]>>; viejo: number[];
  medido: Record<"guardado" | "viejo" | "optimo", { millas: number; minutos: number; exceso: number; tarde: number; tardeMin: number }>;
};
const CASOS = (REALES as unknown as { casos: CasoReal[] }).casos;
const caso = (id: string) => CASOS.find((c) => c.id === id)!;
const tiemposDe = (c: CasoReal): TiemposDeLaRuta =>
  Object.fromEntries(Object.entries(c.tiempos).map(([a, fila]) => [a, Object.fromEntries(Object.entries(fila).map(([b, [minutos, millas]]) => [b, { minutos, millas }]))]));
/** La entrada de un caso real, con las paradas en el orden `orden` (por defecto, el guardado). */
function entradaDe(c: CasoReal, orden: readonly number[] = c.paradas.map((_, i) => i)): EntradaDeOptimizar {
  return {
    paradas: orden.map((i) => c.paradas[i]), puntos: orden.map((i) => c.puntos[i]), cambios: orden.map((i) => c.cambios[i]), base: c.base, capacidad: c.capacidad,
    ventanas: orden.map((i) => c.ventanas[i]), servicios: orden.map((i) => c.servicios[i]), salidaMin: 480, recargaMinimaMin: 20, tiempos: tiemposDe(c),
  };
}
const resumen = (m: MedidaDeLaLista) => ({ millas: m.millas, minutos: m.minutos, exceso: m.exceso, tarde: m.tarde.length, tardeMin: m.tarde.reduce((s, t) => s + t.minutos, 0) });

// =====================================================================================================================
describe("1 · la cuenta: las horas, las millas y los retrasos se ponen como en «Armar rutas»", () => {
  /** La misma lista, evaluada por el motor (`evaluaRuta`): órdenes con su origen y su destino, y la matriz por nombre de punto. */
  function porElMotor(c: CasoReal, orden: readonly number[]) {
    const nombre = (i: number) => (c.paradas[i].tipo === "P" ? `tienda:${(c.paradas[i] as { tienda: string }).tienda}` : `orden:${(c.paradas[i] as { orden: string }).orden}`);
    const puntoDe = new Map<string, PuntoEnElMapa>([["base", c.base]]);
    c.paradas.forEach((_, i) => puntoDe.set(nombre(i), c.puntos[i]!));
    const matriz: Matriz = {};
    for (const [a, pa] of puntoDe) for (const [b, pb] of puntoDe) {
      if (a === b) continue;
      const t = clave(pa) === clave(pb) ? [0, 0] : c.tiempos[clave(pa)!][clave(pb)!];
      (matriz[a] ??= {})[b] = { minutos: t[0], millas: t[1] };
    }
    const ordenes = new Map<string, OrdenEntrada>();
    c.paradas.forEach((p, i) => {
      if (p.tipo !== "D") return;
      const iP = c.paradas.findIndex((q) => q.tipo === "P" && q.ordenes.includes(p.orden)), v = c.ventanas[i];
      ordenes.set(p.orden, {
        id: p.orden, origen: nombre(iP), destino: nombre(i), pallets: -c.cambios[i], ventana: v ? [v.abre, v.cierra] : null, estrecha: !!v?.estrecha,
        servicioRecogidaMin: c.servicios[iP], servicioEntregaMin: c.servicios[i],
      });
    });
    const chofer: ChoferEntrada = { id: "c", nombre: "Chofer", base: "base", capacidad: c.capacidad, entrada: 480, salida: 24 * 60, vuelveABase: true };
    const paradas: ParadaRef[] = orden.map((i) => { const p = c.paradas[i]; return p.tipo === "P" ? { orden: p.ordenes[0], tipo: "P" } : { orden: p.orden, tipo: "D" }; });
    // Sin tope de retraso: aquí se compara la cuenta, no qué deja el motor fuera.
    return evaluaRuta(chofer, paradas, { ordenes, matriz, parametros: { ...PARAMETROS_POR_DEFECTO, topeTardeAnchaMin: 24 * 60 } });
  }

  it("en las rutas reales, en el orden guardado, en el del Optimizar viejo y en el nuevo: los mismos minutos, millas y retraso que `evaluaRuta`", () => {
    for (const c of CASOS) {
      const nuevo = indicesDe(entradaDe(c), optimizaLaLista(entradaDe(c)).paradas);
      for (const orden of [c.paradas.map((_, i) => i), c.viejo, nuevo]) {
        const mia = mideLaLista(entradaDe(c, orden)), suya = porElMotor(c, orden);
        expect({ minutos: mia.minutos, manejo: mia.manejoMin, millas: mia.millas, tarde: mia.tarde.reduce((s, t) => s + t.minutos, 0) }, c.id)
          .toEqual({ minutos: suya.duracionMin, manejo: suya.manejoMin, millas: Math.round(suya.millas * 10) / 10, tarde: suya.tardeMin });
        // Y la capacidad: el motor dice «se pasa» justo cuando aquí hay exceso.
        expect(suya.violaciones.some((v) => v.tipo === "capacidad"), c.id).toBe(mia.exceso > 0);
      }
    }
  });
  it("la cuenta del módulo es la de la prueba (escrita aparte), también sin base, con paradas sin punto y pasándose de la capacidad", () => {
    for (let s = 0; s < 120; s++) {
      const e = inventa(2 + (s % 5), 7000 + s, { sinPunto: s % 3 === 0, sinBase: s % 4 === 0, capacidad: s % 2 ? 4 : undefined, cierre: s % 5 === 0 ? 700 : undefined });
      expect(notaDeLaMedida(mideLaLista(e)), `semilla ${s}`).toEqual(((n) => [n[0], n[1], n[2], n[3], Math.round(n[4] / 10)])(cuenta(e, e.paradas.map((_, i) => i))));
    }
  });
  it("recoger en la misma tienda de una vez dura lo MAYOR entre la recarga mínima y la suma; por separado, una recarga cada vez", () => {
    const tienda = { lat: 30, lng: -101 }, casa = { lat: 30.1, lng: -101 };
    const tiempos = { [clave(tienda)!]: { [clave(casa)!]: { minutos: 10, millas: 7 } }, [clave(casa)!]: { [clave(tienda)!]: { minutos: 10, millas: 7 } } };
    const con = (paradas: ParadaDeLaLista[], servicios: number[]) => mideLaLista({
      paradas, puntos: paradas.map((p) => (p.tipo === "P" ? tienda : casa)), cambios: paradas.map((p) => (p.tipo === "P" ? 1 : -1)), base: tienda, capacidad: 10,
      servicios, tiempos, recargaMinimaMin: 20,
    });
    // Juntas, 4 + 5 = 9 minutos de carga: manda la recarga mínima, 20. Y 10 de ida, 2 + 3 de descarga, 10 de vuelta.
    expect(con([P("1"), P("2"), D("1"), D("2")], [4, 5, 2, 3]).minutos).toBe(20 + 10 + 2 + 3 + 10);
    // Juntas, 15 + 12 = 27: manda la suma.
    expect(con([P("1"), P("2"), D("1"), D("2")], [15, 12, 2, 3]).minutos).toBe(27 + 10 + 2 + 3 + 10);
    // Por separado son dos visitas: dos recargas y dos viajes.
    expect(con([P("1"), D("1"), P("2"), D("2")], [4, 2, 5, 3]).minutos).toBe(20 + 10 + 2 + 10 + 20 + 10 + 3 + 10);
    // Y `minutosEnCadaParada`, que usa la medida de la tarjeta, dice lo mismo fila a fila.
    expect(minutosEnCadaParada([P("1"), P("2"), D("1"), D("2")], [4, 5, 2, 3])).toEqual([20, 0, 2, 3]);
    expect(minutosEnCadaParada([P("1"), P("2"), D("1"), D("2")], [15, 12, 2, 3])).toEqual([27, 0, 2, 3]);
    expect(minutosEnCadaParada([P("1"), D("1"), P("2"), D("2")], [4, 2, 5, 3])).toEqual([20, 2, 20, 3]);
    // Otra tienda, o una recogida sin tienda, es otra visita.
    expect(minutosEnCadaParada([P("1", "A"), P("2", "B"), P("3", null), P("4", null)], [4, 5, 6, 7])).toEqual([20, 20, 20, 20]);
  });
  it("los minutos parados de `minutosEnCadaParada` son los de la cuenta: jornada = manejo + paradas (sin ventanas, sin esperas)", () => {
    for (let s = 0; s < 40; s++) {
      const e = { ...inventa(2 + (s % 6), 9100 + s), ventanas: undefined };
      const m = mideLaLista(e);
      expect(m.minutos - m.manejoMin, `semilla ${s}`).toBe(minutosEnCadaParada(e.paradas, e.servicios!).reduce((a, b) => a + b, 0));
    }
  });
  it("una entrega espera si llega antes de que abra su ventana, y llega tarde si pasa de su cierre", () => {
    const base = { lat: 30, lng: -101 }, casa = { lat: 30.1, lng: -101 };
    const tiempos = { [clave(base)!]: { [clave(casa)!]: { minutos: 5, millas: 3 } }, [clave(casa)!]: { [clave(base)!]: { minutos: 5, millas: 3 } } };
    const e = (ventana: VentanaDeEntrega): EntradaDeOptimizar => ({ paradas: [P("1"), D("1")], puntos: [base, casa], cambios: [1, -1], base, capacidad: 10, servicios: [1, 10], ventanas: [null, ventana], tiempos, salidaMin: 480 });
    // Sale 08:00, carga hasta 08:20, llega 08:25: la ventana abre 08:30 → espera 5. Jornada: 20 + 5 + 5 (espera) + 10 + 5.
    expect(mideLaLista(e({ abre: 510, cierra: 600, estrecha: true }))).toMatchObject({ minutos: 45, manejoMin: 10, tarde: [] });
    // La ventana cerraba a las 08:15: llega 10 minutos tarde, y se dice a qué orden.
    expect(mideLaLista(e({ abre: 480, cierra: 495, estrecha: true })).tarde).toEqual([{ orden: "1", minutos: 10, estrecha: true }]);
  });
});

// =====================================================================================================================
describe("2 · cuando dice «exacta», es el mejor orden que existe", () => {
  it("contra la FUERZA BRUTA (todas las permutaciones): 90 listas inventadas de 2 a 4 órdenes, con todo lo raro", () => {
    for (let s = 0; s < 90; s++) {
      const e = inventa(2 + (s % 3), 100 + s, { sinPunto: s % 5 === 0, sinBase: s % 7 === 0, capacidad: s % 4 === 0 ? 4 : undefined, cierre: s % 3 === 0 ? 700 : undefined });
      const r = optimizaLaLista(e), bruta = fuerzaBruta(e);
      expect(r.exacta, `semilla ${s}`).toBe(true);
      expect(esElOptimo(e, r, bruta), `semilla ${s}: ${JSON.stringify(cuenta(e, indicesDe(e, r.paradas)))} contra ${JSON.stringify(bruta)}`).toBe(true);
      // Y la búsqueda exhaustiva con memoria (el aparejo de las listas grandes) da lo mismo que la fuerza bruta.
      expect(exhaustiva(e), `semilla ${s}`).toEqual(bruta);
    }
  }, LARGA);
  it("contra la búsqueda exhaustiva con memoria: 24 listas de 5 a 7 órdenes (hasta 14 paradas)", () => {
    for (let s = 0; s < 24; s++) {
      const e = inventa(5 + (s % 3), 500 + s, { sinPunto: s % 6 === 0, sinBase: s % 9 === 0, capacidad: s % 4 === 0 ? 6 : undefined, cierre: s % 3 === 0 ? 760 : undefined });
      const r = optimizaLaLista(e);
      expect(r.exacta, `semilla ${s}`).toBe(true);
      expect(esElOptimo(e, r, exhaustiva(e)), `semilla ${s}`).toBe(true);
    }
  }, LARGA);
  it("la exacta SOLA (sin búsqueda local, partiendo de la lista como está) da el mismo óptimo: no vive de lo que encuentre la local", () => {
    // Si la búsqueda local ya trae el óptimo, la exacta solo lo confirma y un fallo suyo no se vería. Aquí todo lo hace ella.
    for (let s = 0; s < 60; s++) {
      const e = inventa(2 + (s % 3), 100 + s, { sinPunto: s % 5 === 0, sinBase: s % 7 === 0, capacidad: s % 4 === 0 ? 4 : undefined, cierre: s % 3 === 0 ? 700 : undefined });
      const r = optimizaLaLista({ ...e, sinBusquedaLocal: true });
      expect(r.exacta, `semilla ${s}`).toBe(true);
      expect(r.trabajo.medidas, `semilla ${s}`).toBe(0);
      expect(esElOptimo(e, r, fuerzaBruta(e)), `semilla ${s}`).toBe(true);
    }
    for (let s = 0; s < 18; s++) {
      const e = inventa(5 + (s % 3), 500 + s, { sinPunto: s % 6 === 0, sinBase: s % 9 === 0, capacidad: s % 4 === 0 ? 6 : undefined, cierre: s % 3 === 0 ? 760 : undefined });
      const r = optimizaLaLista({ ...e, sinBusquedaLocal: true });
      expect(r.exacta, `semilla ${s}`).toBe(true);
      expect(esElOptimo(e, r, exhaustiva(e)), `semilla ${s}`).toBe(true);
    }
    // Y en las rutas reales de hasta ocho órdenes.
    for (const c of CASOS.filter((x) => x.paradas.length <= 16)) expect(resumen(optimizaLaLista({ ...entradaDe(c), sinBusquedaLocal: true }).despues), c.id).toEqual(c.medido.optimo);
  }, LARGA);
  it("la búsqueda local SOLA (con la exacta apagada) también llega al óptimo en listas de 4 a 7 órdenes, y no dice que es exacta", () => {
    for (let s = 0; s < 8; s++) {
      const e = inventa(4 + (s % 4), 800 + s, { cierre: s % 3 === 0 ? 760 : undefined });
      const r = optimizaLaLista({ ...e, topeDeLaExacta: 0 });
      expect(r.exacta, `semilla ${s}`).toBe(false);
      expect(esElOptimo(e, r, exhaustiva(e)), `semilla ${s}`).toBe(true);
    }
  }, LARGA);
});

// =====================================================================================================================
describe("3 · las rutas reales donde el Optimizar de D-456 perdía", () => {
  it("el fichero trae lo medido —guardado, viejo, óptimo— y la cuenta de hoy da esos mismos números", () => {
    expect(CASOS.map((c) => c.id)).toEqual(["ocho-ordenes-base-equivocada", "siete-ordenes-dos-viajes", "once-ordenes-ventanas", "cinco-ordenes-atascada",
      "tres-ordenes-base-equivocada", "cuatro-ordenes-ventana", "cinco-ordenes-peor-que-antes", "seis-ordenes-retraso-inevitable"]);
    for (const c of CASOS) {
      expect(resumen(mideLaLista(entradaDe(c))), c.id).toEqual(c.medido.guardado);
      expect(resumen(mideLaLista(entradaDe(c, c.viejo))), c.id).toEqual(c.medido.viejo);
      // El orden del viejo era una lista válida de las mismas paradas.
      expect([...c.viejo].sort((a, b) => a - b), c.id).toEqual(c.paradas.map((_, i) => i));
      expect(ordenSinRecoger(c.viejo.map((i) => c.paradas[i])), c.id).toBeNull();
    }
  });
  it("en las ocho, el viejo NO daba el mejor orden: más jornada, más millas o más retraso que el óptimo", () => {
    const pierde = (a: CasoReal["medido"]["viejo"], o: CasoReal["medido"]["optimo"]) => a.exceso > o.exceso || a.tardeMin > o.tardeMin || (a.tardeMin === o.tardeMin && a.minutos > o.minutos);
    for (const c of CASOS) expect(pierde(c.medido.viejo, c.medido.optimo), c.id).toBe(true);
    // Sumadas las ocho: el viejo, 2.575 minutos de jornada, 938 de retraso y 1.083,6 millas; el mejor orden, 2.410, 44 y 931.
    const suma = (k: "viejo" | "optimo", campo: "minutos" | "tardeMin" | "millas") => Math.round(CASOS.reduce((s, c) => s + c.medido[k][campo], 0) * 10) / 10;
    expect({ viejo: [suma("viejo", "minutos"), suma("viejo", "tardeMin"), suma("viejo", "millas")], optimo: [suma("optimo", "minutos"), suma("optimo", "tardeMin"), suma("optimo", "millas")] })
      .toEqual({ viejo: [2575, 938, 1083.6], optimo: [2410, 44, 931] });
  });
  it("la base equivocada: con ocho órdenes dejaba la ruta PEOR de como estaba —82 millas y 82 minutos más, y dos entregas tarde—", () => {
    const c = caso("ocho-ordenes-base-equivocada");
    expect(c.basePantalla).not.toEqual(c.base);
    expect(c.medido.guardado).toEqual({ millas: 161.4, minutos: 424, exceso: 0, tarde: 1, tardeMin: 91 });
    expect(c.medido.viejo).toEqual({ millas: 243, minutos: 506, exceso: 0, tarde: 2, tardeMin: 394 });
    const r = optimizaLaLista(entradaDe(c));
    expect(resumen(r.despues)).toEqual({ millas: 156.7, minutos: 428, exceso: 0, tarde: 1, tardeMin: 41 });
    expect(r.exacta).toBe(true);
    expect(r.cambio).toBe(true);
    // 4 minutos más de jornada a cambio de 50 minutos menos de retraso en una ventana estrecha: las ventanas mandan.
    expect(r.despues.tarde).toEqual([{ orden: expect.any(String), minutos: 41, estrecha: true }]);
  });
  it("dos viajes donde cabía uno: 364 → 296 minutos sin llegar tarde a nada (el viejo lo dejaba en 252, con 38 minutos de retraso)", () => {
    const c = caso("siete-ordenes-dos-viajes");
    const r = optimizaLaLista(entradaDe(c));
    expect(resumen(r.antes)).toEqual({ millas: 242.4, minutos: 364, exceso: 0, tarde: 0, tardeMin: 0 });
    expect(resumen(r.despues)).toEqual({ millas: 156.8, minutos: 296, exceso: 0, tarde: 0, tardeMin: 0 });
    expect(c.medido.viejo).toMatchObject({ minutos: 252, tarde: 1, tardeMin: 38 });
    expect(r.exacta).toBe(true);
    // La búsqueda local sola también lo encuentra: pide mover varias órdenes a la vez y pasar por un retraso (la vara blanda).
    expect(resumen(optimizaLaLista({ ...entradaDe(c), topeDeLaExacta: 0 }).despues)).toEqual(resumen(r.despues));
  });
  it("once órdenes y dos ventanas estrechas: de 342 minutos tarde a ninguno, con 70 minutos menos de jornada (el viejo subía el retraso a 431)", () => {
    const c = caso("once-ordenes-ventanas");
    const r = optimizaLaLista(entradaDe(c));
    expect(resumen(r.antes)).toEqual({ millas: 166.8, minutos: 498, exceso: 0, tarde: 2, tardeMin: 342 });
    expect(resumen(r.despues)).toEqual({ millas: 122.2, minutos: 428, exceso: 0, tarde: 0, tardeMin: 0 });
    expect(c.medido.viejo).toMatchObject({ minutos: 472, tarde: 2, tardeMin: 431 });
    // 22 paradas: la exacta la termina, y es el mejor orden que existe.
    expect(r.exacta).toBe(true);
  });
  it("en las de hasta cinco órdenes, el óptimo está comprobado por FUERZA BRUTA, y el nuevo lo da", () => {
    for (const id of ["cinco-ordenes-atascada", "tres-ordenes-base-equivocada", "cuatro-ordenes-ventana", "cinco-ordenes-peor-que-antes"]) {
      const c = caso(id), e = entradaDe(c);
      const bruta = fuerzaBruta(e);
      const r = optimizaLaLista(e);
      expect(esElOptimo(e, r, bruta), id).toBe(true);
      expect(resumen(r.despues), id).toEqual(c.medido.optimo);
      // Y desde el orden que dejaba el viejo, también: el resultado no depende de por dónde se entre.
      const desdeElViejo = optimizaLaLista(entradaDe(c, c.viejo));
      expect(resumen(desdeElViejo.despues), id).toEqual(c.medido.optimo);
    }
  }, LARGA);
  it("en las de seis a ocho órdenes, el óptimo está comprobado por la búsqueda exhaustiva con memoria, y el nuevo lo da", () => {
    for (const id of ["seis-ordenes-retraso-inevitable", "siete-ordenes-dos-viajes", "ocho-ordenes-base-equivocada"]) {
      const c = caso(id), e = entradaDe(c);
      expect(esElOptimo(e, optimizaLaLista(e), exhaustiva(e)), id).toBe(true);
    }
  }, LARGA);
  it("el retraso que no se puede quitar se baja todo lo que se puede: de 43 minutos tarde a 3 (el viejo, 15), y lo dice", () => {
    const c = caso("seis-ordenes-retraso-inevitable");
    const r = optimizaLaLista(entradaDe(c));
    expect(resumen(r.despues)).toEqual({ millas: 96.2, minutos: 321, exceso: 0, tarde: 1, tardeMin: 3 });
    expect(c.medido.viejo).toMatchObject({ minutos: 299, tardeMin: 15 });
    expect(r.exacta).toBe(true);
  });
  it("el orden más corto que llega 43 minutos tarde NO se elige: un minuto más de jornada llega a tiempo", () => {
    const c = caso("cuatro-ordenes-ventana");
    expect(c.medido.viejo).toEqual({ millas: 56.1, minutos: 194, exceso: 0, tarde: 1, tardeMin: 43 });
    const r = optimizaLaLista(entradaDe(c, c.viejo));
    expect(resumen(r.despues)).toEqual({ millas: 56.2, minutos: 195, exceso: 0, tarde: 0, tardeMin: 0 });
    expect(r.cambio).toBe(true);
  });
});

// =====================================================================================================================
describe("4 · lo que no se rompe nunca", () => {
  const SEMILLAS = Array.from({ length: 60 }, (_, s) => s);
  const opciones = (s: number) => ({ sinPunto: s % 5 === 0, sinBase: s % 6 === 0, capacidad: s % 3 === 0 ? 5 : undefined, cierre: s % 4 === 0 ? 720 : undefined, juntas: s % 2 === 0 });
  // Sesenta rutas de 2 a 10 órdenes (hasta 20 paradas), con todo lo raro. Se optimizan UNA vez, la primera que hace falta.
  let hechas: { s: number; e: EntradaDeOptimizar; r: ReturnType<typeof optimizaLaLista> }[] | null = null;
  const lasSesenta = () => (hechas ??= SEMILLAS.map((s) => { const e = inventa(2 + (s % 9), 3000 + s, opciones(s)); return { s, e, r: optimizaLaLista(e) }; }));
  it("las mismas paradas, ni una más ni una menos; y una entrega nunca antes que su recogida", () => {
    for (const { s, e, r } of lasSesenta()) {
      expect([...indicesDe(e, r.paradas)].sort((a, b) => a - b), `semilla ${s}`).toEqual(e.paradas.map((_, i) => i));
      expect(ordenSinRecoger(r.paradas), `semilla ${s}`).toBeNull();
    }
  }, LARGA);
  it("NUNCA sale peor de lo que entró: ni más exceso, ni más retraso, ni —a igualdad— más jornada", () => {
    let mejoran = 0;
    for (const { s, e, r } of lasSesenta()) {
      const antes = cuenta(e, e.paradas.map((_, i) => i)), despues = cuenta(e, indicesDe(e, r.paradas));
      expect(menor(antes, despues), `semilla ${s}: ${JSON.stringify(antes)} → ${JSON.stringify(despues)}`).toBe(false);
      // Y `cambio` dice la verdad: hay orden nuevo justo cuando mide mejor.
      expect(r.cambio, `semilla ${s}`).toBe(menor(despues, antes));
      if (r.cambio) mejoran++;
    }
    expect(mejoran).toBeGreaterThan(40);
  }, LARGA);
  it("si la entrada no se pasaba de la capacidad, la salida tampoco; si se pasaba, se pasa menos o igual", () => {
    let seQuita = 0;
    for (const s of SEMILLAS) {
      const e = inventa(3 + (s % 6), 4000 + s, { capacidad: 4 + (s % 3), juntas: s % 2 === 0 });
      const r = optimizaLaLista(e);
      expect(r.excesoDespues, `semilla ${s}`).toBeLessThanOrEqual(r.excesoAntes);
      if (r.excesoAntes > 0 && r.excesoDespues === 0) seQuita++;
    }
    // No es una prueba vacía: hay listas que entraban pasándose y salen sin pasarse.
    expect(seQuita).toBeGreaterThan(5);
  }, LARGA);
  it("es determinista: la misma lista da el mismo orden, también en una ruta grande (donde hay sacudidas «al azar»)", () => {
    for (const [ordenes, s] of [[4, 1], [7, 2], [9, 3], [16, 4]] as const) {
      const e = inventa(ordenes, 6000 + s, { juntas: true });
      const a = optimizaLaLista(e), b = optimizaLaLista(e);
      expect(forma(a.paradas), `${ordenes} órdenes`).toBe(forma(b.paradas));
      expect(a.trabajo).toEqual(b.trabajo);
    }
  }, LARGA);
  it("pulsar otra vez sobre lo ya optimizado no cambia nada (si era exacta, ya no hay nada mejor)", () => {
    for (const s of SEMILLAS.slice(0, 30)) {
      const e = inventa(2 + (s % 6), 5000 + s, opciones(s));
      const r = optimizaLaLista(e);
      const orden = indicesDe(e, r.paradas);
      const otraVez = optimizaLaLista({ ...e, paradas: r.paradas, puntos: orden.map((i) => e.puntos[i]), cambios: orden.map((i) => e.cambios[i]), ventanas: orden.map((i) => e.ventanas![i]), servicios: orden.map((i) => e.servicios![i]) });
      expect(otraVez.cambio, `semilla ${s}`).toBe(false);
      expect(forma(otraVez.paradas), `semilla ${s}`).toBe(forma(r.paradas));
    }
  });
  it("con menos de tres paradas no hay orden que elegir; y una lista que ya rompe la precedencia no se toca", () => {
    const pt = { lat: 30, lng: -101 };
    expect(optimizaLaLista({ paradas: [P("1"), D("1")], puntos: [pt, pt], cambios: [1, -1], base: pt, capacidad: 10 })).toMatchObject({ cambio: false, exacta: true });
    const rota = [D("1"), P("1"), P("2"), D("2")];
    const r = optimizaLaLista({ paradas: rota, puntos: rota.map(() => pt), cambios: [-1, 1, 1, -1], base: pt, capacidad: 10 });
    expect(r.cambio).toBe(false);
    expect(forma(r.paradas)).toBe(forma(rota));
  });
  it("si lo que hay ya es lo mejor, no cambia nada y dice que es el óptimo: no hay nada que guardar", () => {
    const c = caso("cuatro-ordenes-ventana");
    const r = optimizaLaLista(entradaDe(c));
    expect(r.cambio).toBe(false);
    expect(r.exacta).toBe(true);
    expect(forma(r.paradas)).toBe(forma(c.paradas));
    expect(r.despues).toEqual(r.antes);
  });
});

// =====================================================================================================================
describe("5 · el orden de los objetivos: capacidad → ventanas (las estrechas mandan) → jornada → millas", () => {
  // Una recta: la base en 0, y cada punto a `x` minutos y `x` millas de ella.
  const en = (x: number): PuntoEnElMapa => ({ lat: 30 + x / 1000, lng: -101 });
  const recta = (xs: number[]): TiemposDeLaRuta => {
    const t: Record<string, Record<string, { minutos: number; millas: number }>> = {};
    for (const a of xs) for (const b of xs) if (a !== b) (t[clave(en(a))!] ??= {})[clave(en(b))!] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) };
    return t;
  };
  it("la capacidad manda sobre el retraso y sobre la jornada: no carga las dos de una vez si no caben", () => {
    // Dos órdenes de 4 en un camión de 5: lo más corto es cargar las dos y repartir, pero no caben.
    const paradas = [P("1"), D("1"), P("2"), D("2")], puntos = [en(0), en(30), en(0), en(40)];
    const e = (capacidad: number): EntradaDeOptimizar => ({ paradas, puntos, cambios: [4, -4, 4, -4], base: en(0), capacidad, tiempos: recta([0, 30, 40]), servicios: [5, 5, 5, 5] });
    const libre = optimizaLaLista(e(99));
    expect(forma(libre.paradas)).toBe("P1 P2 D1 D2");
    expect(libre.despues.minutos).toBe(20 + 30 + 5 + 10 + 5 + 40);
    const justo = optimizaLaLista(e(5));
    expect(justo.cambio).toBe(false);
    expect(justo.excesoDespues).toBe(0);
    expect(justo.despues.minutos).toBeGreaterThan(libre.despues.minutos);
  });
  it("una lista que SE PASA sale sin pasarse, aunque la jornada sea más larga", () => {
    const paradas = [P("1"), P("2"), D("1"), D("2")], puntos = [en(0), en(0), en(30), en(40)];
    const r = optimizaLaLista({ paradas, puntos, cambios: [4, 4, -4, -4], base: en(0), capacidad: 5, tiempos: recta([0, 30, 40]), servicios: [5, 5, 5, 5] });
    expect(r.excesoAntes).toBe(3);
    expect(r.excesoDespues).toBe(0);
    expect(r.cambio).toBe(true);
    expect(r.despues.minutos).toBeGreaterThan(r.antes.minutos);
  });
  it("llegar a tiempo manda sobre la jornada: va primero a la ventana que cierra pronto aunque sea dar un rodeo", () => {
    // La entrega 1 está a 60 minutos y cierra a las 09:30; la 2, a 10 minutos y sin prisa. Lo corto es 2 y luego 1… y llega tarde.
    const paradas = [P("1"), P("2"), D("2"), D("1")], puntos = [en(0), en(0), en(-10), en(60)];
    const ventanas = [null, null, { abre: 480, cierra: 1050, estrecha: false }, { abre: 480, cierra: 570, estrecha: true }];
    const e: EntradaDeOptimizar = { paradas, puntos, cambios: [1, 1, -1, -1], base: en(0), capacidad: 10, tiempos: recta([0, -10, 60]), servicios: [5, 5, 5, 5], ventanas, salidaMin: 480 };
    expect(mideLaLista(e).tarde).toEqual([{ orden: "1", minutos: 20 + 10 + 5 + 70 + 480 - 570, estrecha: true }]);
    const r = optimizaLaLista(e);
    expect(forma(r.paradas)).toBe("P1 P2 D1 D2");
    expect(r.despues.tarde).toEqual([]);
    // Sin ventanas, el orden corto se queda: es el mismo tiempo en una recta, y no hay por qué tocarlo.
    expect(optimizaLaLista({ ...e, ventanas: undefined }).cambio).toBe(false);
  });
  it("las ventanas ESTRECHAS mandan sobre las demás: si no se puede llegar a las dos, se llega a la estrecha", () => {
    // Dos entregas en direcciones opuestas, las dos cierran a las 09:00. Solo da tiempo a una.
    const paradas = [P("a"), P("b"), D("a"), D("b")], puntos = [en(0), en(0), en(35), en(-35)];
    const e = (estrechaA: boolean): EntradaDeOptimizar => ({
      paradas, puntos, cambios: [1, 1, -1, -1], base: en(0), capacidad: 10, tiempos: recta([0, 35, -35]), servicios: [5, 5, 5, 5], salidaMin: 480,
      ventanas: [null, null, { abre: 480, cierra: 540, estrecha: estrechaA }, { abre: 480, cierra: 540, estrecha: !estrechaA }],
    });
    const conA = optimizaLaLista(e(true)), conB = optimizaLaLista(e(false));
    expect(forma(conA.paradas)).toBe("Pa Pb Da Db");
    expect(conA.despues.tarde).toEqual([{ orden: "b", minutos: expect.any(Number), estrecha: false }]);
    expect(forma(conB.paradas)).toBe("Pa Pb Db Da");
    expect(conB.despues.tarde).toEqual([{ orden: "a", minutos: expect.any(Number), estrecha: false }]);
  });
  it("a igual jornada, menos millas; y un cambio que solo ahorra centésimas de milla no vale la pena", () => {
    const paradas = [P("1"), P("2"), D("1"), D("2")], puntos = [en(0), en(0), en(20), en(21)];
    const t = (millasDeVuelta: number): TiemposDeLaRuta => {
      const m = JSON.parse(JSON.stringify(recta([0, 20, 21]))) as Record<string, Record<string, { minutos: number; millas: number }>>;
      // Volver de 21 y de 20 tarda lo mismo… pero por otro camino mide distinto.
      m[clave(en(20))!][clave(en(0))!] = { minutos: 21, millas: millasDeVuelta };
      m[clave(en(21))!][clave(en(20))!] = { minutos: 1, millas: 1 };
      m[clave(en(0))!][clave(en(21))!] = { minutos: 20, millas: 20 };
      return m;
    };
    const e = (millasDeVuelta: number): EntradaDeOptimizar => ({ paradas, puntos, cambios: [1, 1, -1, -1], base: en(0), capacidad: 10, tiempos: t(millasDeVuelta), servicios: [5, 5, 5, 5] });
    // D1 D2: 20 + 1 + 21 = 42 min, 20 + 1 + 21 = 42 mi.  D2 D1: 20 + 1 + 21 = 42 min, 20 + 1 + vuelta.
    const gana = optimizaLaLista(e(15));
    expect(forma(gana.paradas)).toBe("P1 P2 D2 D1");
    expect(gana.despues.minutos).toBe(gana.antes.minutos);
    expect(gana.despues.millas).toBe(36);
    expect(optimizaLaLista(e(20.95)).cambio).toBe(false);
    // La búsqueda local SOLA también desempata por millas (sin la exacta detrás que lo arregle)…
    expect(forma(optimizaLaLista({ ...e(15), topeDeLaExacta: 0 }).paradas)).toBe("P1 P2 D2 D1");
    // …y la exacta SOLA, que parte de un orden que empata en tiempo, encuentra el de menos millas: empatar no es podar.
    expect(forma(optimizaLaLista({ ...e(15), sinBusquedaLocal: true }).paradas)).toBe("P1 P2 D2 D1");
  });
  it("recoge en la misma tienda DE UNA VEZ, y solo vuelve si la capacidad obliga", () => {
    // Tres órdenes de la misma tienda (que es la base), a entregar por la misma carretera. Guardadas de una en una: tres visitas.
    const paradas = [P("1"), D("1"), P("2"), D("2"), P("3"), D("3")], puntos = [en(0), en(10), en(0), en(20), en(0), en(30)];
    const e = (capacidad: number): EntradaDeOptimizar => ({ paradas, puntos, cambios: [3, -3, 3, -3, 3, -3], base: en(0), capacidad, tiempos: recta([0, 10, 20, 30]), servicios: [5, 5, 5, 5, 5, 5] });
    const visitas = (ps: readonly ParadaDeLaLista[]) => ps.filter((p, i) => p.tipo === "P" && (i === 0 || ps[i - 1].tipo !== "P")).length;
    expect(visitas(paradas)).toBe(3);
    const cabe = optimizaLaLista(e(10));
    expect(visitas(cabe.paradas)).toBe(1);
    // Dentro de la visita, las recogidas salen en el orden en que estaban. (Las entregas, por la recta, miden igual de ida que de vuelta.)
    expect(forma(cabe.paradas).startsWith("P1 P2 P3 D")).toBe(true);
    expect(cabe.despues.minutos).toBe(20 + 30 + 15 + 30);
    // En un camión de 6 caben dos: dos visitas, no tres ni una.
    const noCabe = optimizaLaLista(e(6));
    expect(visitas(noCabe.paradas)).toBe(2);
    expect(noCabe.excesoDespues).toBe(0);
  });
});

// =====================================================================================================================
describe("6 · de dónde sale, y con qué se mide", () => {
  const en = (lat: number): PuntoEnElMapa => ({ lat, lng: -101 });
  const estimado = (a: PuntoEnElMapa, b: PuntoEnElMapa) => Math.round(millasEnLineaRecta(a, b) * FACTOR_DE_RODEO * 100) / 100;
  it("sale de la BASE y vuelve a ella; sin base, la ruta es abierta: de la primera parada a la última", () => {
    const paradas = [P("1"), D("1"), P("2", "U")], puntos = [en(30.5), en(31), en(30.5)];
    const con = mideLaLista({ paradas, puntos, cambios: [1, -1, 1], base: en(30), capacidad: 10 });
    const sin = mideLaLista({ paradas, puntos, cambios: [1, -1, 1], base: null, capacidad: 10 });
    const medio = estimado(en(30), en(30.5));
    expect(con.millas).toBeCloseTo(Math.round(4 * medio * 10) / 10, 5);
    expect(sin.millas).toBeCloseTo(Math.round(2 * medio * 10) / 10, 5);
    // Con otra base, otro orden: la base decide por dónde se empieza.
    const e = (base: PuntoEnElMapa): EntradaDeOptimizar => ({ paradas: [P("1", "A"), D("1"), P("2", "B"), D("2")], puntos: [en(30.1), en(30.2), en(30.9), en(30.8)], cambios: [1, -1, 1, -1], base, capacidad: 10 });
    expect(forma(optimizaLaLista(e(en(30))).paradas.slice(0, 1))).toBe("P1");
    expect(forma(optimizaLaLista(e(en(31))).paradas.slice(0, 1))).toBe("P2");
  });
  it("sin tiempos por calles estima en línea recta —el rodeo y la velocidad del último escalón del motor— y lo dice", () => {
    const paradas = [P("1"), P("2"), D("1"), D("2")], puntos = [en(30), en(30), en(30.9), en(30.1)];
    const r = optimizaLaLista({ paradas, puntos, cambios: [1, 1, -1, -1], base: en(30), capacidad: 10 });
    expect(r.medida).toBe("estimada");
    expect(r.antes.millas).toBeCloseTo(Math.round((estimado(en(30), en(30.9)) + estimado(en(30.9), en(30.1)) + estimado(en(30.1), en(30))) * 10) / 10, 5);
    expect(r.antes.manejoMin).toBe([[30, 30.9], [30.9, 30.1], [30.1, 30]].reduce((s, [a, b]) => s + Math.round((estimado(en(a), en(b)) / MILLAS_POR_HORA_ESTIMADAS) * 60), 0));
    // Con todos los tramos, «real»; con algunos, «mixta».
    const c = caso("cinco-ordenes-atascada");
    expect(optimizaLaLista(entradaDe(c)).medida).toBe("real");
    const cojos = tiemposDe(c) as Record<string, Record<string, unknown>>;
    const quitado = Object.keys(cojos)[0];
    const sinUno = Object.fromEntries(Object.entries(cojos).filter(([k]) => k !== quitado)) as TiemposDeLaRuta;
    expect(optimizaLaLista({ ...entradaDe(c), tiempos: sinUno }).medida).toBe("mixta");
  });
  it("por calles y en línea recta NO dan el mismo orden: por eso se pide la matriz", () => {
    // Dos entregas: la A está más cerca en línea recta pero hay que dar un rodeo de 50 minutos (un puente); la B está más lejos y es directa.
    const base = en(30), a = { lat: 30.1, lng: -101.02 }, b = { lat: 30.3, lng: -101 };
    const paradas = [P("a"), P("b"), D("b"), D("a")], puntos = [base, base, b, a];
    const k = clave;
    const tiempos: TiemposDeLaRuta = {
      [k(base)!]: { [k(a)!]: { minutos: 50, millas: 30 }, [k(b)!]: { minutos: 20, millas: 15 } },
      [k(a)!]: { [k(base)!]: { minutos: 50, millas: 30 }, [k(b)!]: { minutos: 15, millas: 10 } },
      [k(b)!]: { [k(base)!]: { minutos: 20, millas: 15 }, [k(a)!]: { minutos: 15, millas: 10 } },
    };
    const comun = { paradas, puntos, cambios: [1, 1, -1, -1], base, capacidad: 10, ventanas: [null, null, null, { abre: 480, cierra: 540, estrecha: true }], salidaMin: 480 };
    // En línea recta, A queda a 7 millas: ir primero a A llega a tiempo. Por calles son 50 minutos: llega tarde por cualquier lado,
    // y lo menos tarde es por B (20 + 15 = 35 minutos, no 50).
    expect(forma(optimizaLaLista(comun).paradas)).toBe("Pa Pb Da Db");
    expect(forma(optimizaLaLista({ ...comun, tiempos }).paradas)).toBe("Pa Pb Db Da");
  });
  it("una parada sin punto en el mapa no suma camino, se queda en la lista y se dice cuántas son", () => {
    const paradas = [P("1"), P("2"), P("3", null), D("1"), D("2"), D("3")];
    const puntos = [en(30), en(30), null, en(30.9), en(30.1), null];
    const r = optimizaLaLista({ paradas, puntos, cambios: [1, 1, 1, -1, -1, -1], base: en(30), capacidad: 10 });
    expect(r.sinPunto).toBe(2);
    expect(r.paradas).toHaveLength(6);
    expect(ordenSinRecoger(r.paradas)).toBeNull();
    // La misma ruta sin las dos paradas sin punto recorre lo mismo.
    const sin = optimizaLaLista({ paradas: [P("1"), P("2"), D("1"), D("2")], puntos: [en(30), en(30), en(30.9), en(30.1)], cambios: [1, 1, -1, -1], base: en(30), capacidad: 10 });
    expect(r.despues.millas).toBe(sin.despues.millas);
  });
});

// =====================================================================================================================
describe("7 · hasta dónde llega la exacta, y lo que tarda", () => {
  it(`con más de ${MAX_PARADAS_DE_LA_EXACTA} paradas no se intenta: la búsqueda local, sin pasar de su presupuesto, y lo dice`, () => {
    const e = inventa(16, 31337, { juntas: true, capacidad: 12 });
    expect(e.paradas.length).toBeGreaterThan(MAX_PARADAS_DE_LA_EXACTA);
    const r = optimizaLaLista(e);
    expect(r.exacta).toBe(false);
    expect(r.trabajo.etiquetas).toBe(0);
    expect(r.trabajo.medidas).toBeGreaterThan(1000);
    // El presupuesto se cuenta en paradas medidas: no puede pasarse más que lo que le queda a la última bajada.
    expect(r.trabajo.medidas * e.paradas.length).toBeLessThan(TOPE_DE_PASOS * 1.5);
    // Y aun así mejora, y mucho: cada orden con su recogida y su entrega seguidas son 16 viajes a las tiendas.
    const antes = cuenta(e, e.paradas.map((_, i) => i)), despues = cuenta(e, indicesDe(e, r.paradas));
    expect(menor(despues, antes)).toBe(true);
    expect(ordenSinRecoger(r.paradas)).toBeNull();
  });
  it("las SACUDIDAS rinden: 14 órdenes (28 paradas) bajan a 679 minutos sin llegar tarde a nada; solo bajando se quedaba en 737", () => {
    // Medido el 2026-10-02 con y sin sacudidas sobre esta misma lista (y otras 27: mejoraban 18 y no empeoraban ninguna).
    const e = inventa(14, 31337, { juntas: true, capacidad: 12 });
    const r = optimizaLaLista(e);
    expect(r.exacta).toBe(false);
    expect(notaDeLaMedida(r.despues).slice(0, 3)).toEqual([0, 0, 0]);
    expect(r.despues.minutos).toBeLessThanOrEqual(679);
    expect(r.antes.minutos).toBe(1272);
  }, LARGA);
  it("en una ruta grande se arranca también del VECINO MÁS CERCANO, y cuenta: 16 órdenes con 684 minutos de retraso en ventanas estrechas; sin él, 719", () => {
    // Medido el 2026-10-02 con y sin ese arranque: en una ruta que la exacta no intenta solo hay dos (lo que hay y este).
    const r = optimizaLaLista(inventa(16, 42007, { juntas: true, capacidad: 12 }));
    expect(r.exacta).toBe(false);
    expect(notaDeLaMedida(r.despues)[0]).toBe(0);
    expect(notaDeLaMedida(r.despues)[1]).toBeLessThanOrEqual(684);
  }, LARGA);
  it("la INSERCIÓN MÁS BARATA es el tercer arranque, y cuenta: 11 órdenes que la exacta no termina quedan en 775 minutos; sin ella, en 937", () => {
    // Medido el 2026-10-02 con y sin ese arranque sobre 280 listas: cambia 5, y 4 a mejor. Esta es una.
    const r = optimizaLaLista(inventa(11, 43023, { cierre: 760 }));
    expect(r.exacta).toBe(false);
    expect(notaDeLaMedida(r.despues).slice(0, 2)).toEqual([0, 22]);
    expect(notaDeLaMedida(r.despues)[2]).toBeLessThanOrEqual(764);
    expect(r.despues.minutos).toBeLessThanOrEqual(775);
  }, LARGA);
  it("con el tope a cero la exacta se rinde, y la búsqueda local da igualmente un orden válido y no peor", () => {
    const c = caso("once-ordenes-ventanas");
    const r = optimizaLaLista({ ...entradaDe(c), topeDeLaExacta: 0 });
    expect(r.exacta).toBe(false);
    expect(resumen(r.despues)).toEqual(c.medido.optimo);
  });
  it("una ruta real de once órdenes se resuelve EXACTA sin pasar del tope de etiquetas", () => {
    const r = optimizaLaLista(entradaDe(caso("once-ordenes-ventanas")));
    expect(r.exacta).toBe(true);
    expect(r.trabajo.etiquetas).toBeGreaterThan(1000);
    expect(r.trabajo.etiquetas).toBeLessThan(600_000);
  });
});
