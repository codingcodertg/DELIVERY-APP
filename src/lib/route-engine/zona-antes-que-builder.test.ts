import { describe, expect, it } from "vitest";
import CASOS from "./zona-casos-reales.json";
import { millasEnLineaRecta, FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS } from "@/lib/route-times/proveedores";
import {
  PARAMETROS_POR_DEFECTO, planifica, UMBRAL_DE_ZONA_POR_DEFECTO_MI,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Parametros, type Plan,
} from "./index";

/**
 * La zona, antes que el builder y el balance (D-423, T-0413, hija de T-0412). El dueño, 2026-09-27, literal: *«no
 * edingur o weslaco se pueden dividir entre ernesto y julio y por emergencia con maximo, maximo siempre tiene priorirdad
 * en brownivlle y nunca mandes a otro conductor por una ruta que sea inefeciente y que seria mejor con otro conducto
 * siempre que piense todo eso arma ese algoritnmo asi»*.
 *
 * Dos días reales anonimizados (`zona-casos-reales.json`) y una cuadrícula inventada para cada regla por separado.
 */

// ---- Los días reales ------------------------------------------------------------------------------------------------

type Dia = { caso: string; choferes: ChoferEntrada[]; ordenes: OrdenEntrada[]; puntos: Record<string, { lat: number; lng: number }> };
const DIAS = (CASOS as unknown as { dias: Record<string, Dia> }).dias;

/** La matriz que usa «Planificar el día» sin Google ni OSRM (`proveedorEstimado`), sobre los pins redondeados. */
function matrizEstimada(puntos: Dia["puntos"]): Matriz {
  const m: Matriz = {};
  for (const [a, pa] of Object.entries(puntos)) {
    m[a] = {};
    for (const [b, pb] of Object.entries(puntos)) {
      if (a === b) continue;
      const millas = Math.round(millasEnLineaRecta(pa, pb) * FACTOR_DE_RODEO * 100) / 100;
      m[a][b] = { minutos: Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60), millas };
    }
  }
  return m;
}
const entradaReal = (fecha: string): Entrada => ({ ordenes: DIAS[fecha].ordenes, choferes: DIAS[fecha].choferes, matriz: matrizEstimada(DIAS[fecha].puntos) });
const con = (zona: number, zonaMillas?: number): Parametros =>
  ({ ...PARAMETROS_POR_DEFECTO, pesos: { ...PARAMETROS_POR_DEFECTO.pesos, zona, ...(zonaMillas === undefined ? {} : { zonaMillas }) } });
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id || p.orden.startsWith(`${id}#`)))?.chofer ?? null;

// Motor entero sobre días reales: ~2 s solo, más de 5 s con la suite en paralelo (medido 2026-09-27). Límite propio.
describe("los dos casos medidos con días reales", { timeout: 30_000 }, () => {
  it("2026-09-07: la entrega de la zona de C (la de Maximo) se la llevaba A por el builder y el balance, con +0 mi para C; ahora va con C", () => {
    const e = entradaReal("2026-09-07"), caso = DIAS["2026-09-07"].caso;
    // Antes (umbral 0 = motor-4): A, fuera de su zona, aunque C la hacía con las mismas millas.
    const antes = planifica(e, con(60, 0));
    expect(choferDe(antes, caso)).toBe("A");
    const alt = antes.explicaciones.find((x) => x.orden === caso)!.alternativas.find((a) => a.chofer === "C")!.diferencia!;
    expect(alt.millas).toBeLessThan(UMBRAL_DE_ZONA_POR_DEFECTO_MI);
    expect(alt.tardeMin).toBeLessThanOrEqual(0);
    // Ahora, con el umbral de por defecto: con C, su zona.
    const ahora = planifica(e, con(60));
    expect(choferDe(ahora, caso)).toBe("C");
    // Sin dejar nada fuera, sin romper nada, sin más minutos tarde y sin más de un 1 % de millas.
    expect(ahora.sinAsignar.length).toBe(antes.sinAsignar.length);
    expect(ahora.violaciones).toEqual([]);
    expect(ahora.coste.tardeMin).toBeLessThanOrEqual(antes.coste.tardeMin);
    expect(ahora.coste.millas).toBeLessThanOrEqual(antes.coste.millas * 1.01);
    expect(ahora.coste.fueraDeZona!).toBeLessThan(antes.coste.fueraDeZona!);
  });

  // D-427: esta orden es la #FT205 que el dueño señaló — se RECOGE en la tienda de la zona de C. Este fixture no trae la
  // zona de la recogida, así que prueba solo el umbral de D-423; con ella (`zona-recogida-caso-real.json`) va con C.
  it("2026-09-28: una entrega de la zona de A y B se iba con C por el balance (con peso 30), aunque B la hacía con menos millas; ahora va con B", () => {
    const e = entradaReal("2026-09-28"), caso = DIAS["2026-09-28"].caso;
    const antes = planifica(e, con(30, 0));
    expect(choferDe(antes, caso)).toBe("C");
    const ahora = planifica(e, con(30));
    expect(choferDe(ahora, caso)).toBe("B");
    expect(ahora.sinAsignar.length).toBe(antes.sinAsignar.length);
    expect(ahora.coste.millas).toBeLessThanOrEqual(antes.coste.millas * 1.01);
  });
});

// ---- Cada regla, en una cuadrícula ------------------------------------------------------------------------------------

/** De «x,y» a «x',y'» se tarda |dx|+|dy| minutos, y una milla son 2 minutos (30 mph, como la estimación). */
const punto = (x: number, y = 0) => `${x},${y}`;
function matrizDe(puntos: string[]): Matriz {
  const m: Matriz = {};
  for (const a of puntos) {
    m[a] = {};
    for (const b of puntos) {
      if (a === b) continue;
      const [ax, ay] = a.split(",").map(Number), [bx, by] = b.split(",").map(Number);
      const minutos = Math.abs(ax - bx) + Math.abs(ay - by);
      m[a][b] = { minutos, millas: minutos / 2 };
    }
  }
  return m;
}
const orden = (id: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
  id, codigo: id, entrada: "2026-01-05 0800", origen: punto(0), destino: punto(10), pallets: 1, ventana: null,
  servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra,
});
const chofer = (id: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada => ({
  id, nombre: id, base: punto(0), capacidad: 20, entrada: 480, salida: 1080, vuelveABase: true, ...extra,
});
function entradaDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Entrada {
  const puntos = new Set<string>();
  for (const o of ordenes) { if (o.origen) puntos.add(o.origen); if (o.destino) puntos.add(o.destino); }
  for (const c of choferes) puntos.add(c.base);
  return { ordenes, choferes, matriz: matrizDe([...puntos]) };
}

/**
 * S prefiere la zona «Sur» y tiene fijada (por una persona) una entrega de allí con ventana dura temprana y una hora de
 * descarga; L prefiere el «Norte» y no tiene nada. Llega un builder del Sur cerca de la tienda. Con S, el builder espera
 * a que S acabe (+100 min de builder) y S carga el día: el builder y el balance se lo dan a L. `x` es dónde vive S: con
 * él, el plan hace exactamente `x` millas más que con L (la cuadrícula es de Manhattan: la cuenta está en `alt.millas`).
 */
const diaDelBuilder = (x: number, builder: Partial<OrdenEntrada> = {}) => entradaDe([
  orden("deS", { origen: punto(0), destino: punto(20, 0), zona: "Sur", entrada: "2026-01-05 0600", ventana: [480, 530], estrecha: true, servicioEntregaMin: 60, choferFijado: "S" }),
  orden("builder", { origen: punto(0), destino: punto(0, 10), zona: "Sur", builder: true, entrada: "2026-01-05 0700", ...builder }),
], [chofer("L", { zonas: ["Norte"] }), chofer("S", { base: punto(x, 0), zonas: ["Sur"] })]);
const millasDeMasConS = (e: Entrada) => {
  const p = planifica(e, con(20, 0));
  return p.explicaciones.find((x) => x.orden === "builder")!.alternativas.find((a) => a.chofer === "S")!.diferencia;
};

describe("la zona le gana al builder y al balance por debajo del umbral, y la eficiencia manda por encima", () => {
  it("con las mismas millas, el builder va con el chofer de su zona aunque llegue más tarde (sin el umbral, con el otro)", () => {
    const e = diaDelBuilder(0);
    expect(millasDeMasConS(e)).toMatchObject({ millas: 0, tardeMin: 0 });
    expect(choferDe(planifica(e, con(20, 0)), "builder")).toBe("L");
    expect(choferDe(planifica(e, con(20)), "builder")).toBe("S");
    expect(choferDe(planifica(e, con(60)), "builder")).toBe("S");
  });

  it("4 millas de más (menos que el umbral de 5): con el de su zona; 5 o 6 (el umbral o más): se queda con el otro", () => {
    expect(millasDeMasConS(diaDelBuilder(4))!.millas).toBe(4);
    expect(choferDe(planifica(diaDelBuilder(4), con(20, 5)), "builder")).toBe("S");
    expect(millasDeMasConS(diaDelBuilder(5))!.millas).toBe(5);
    expect(choferDe(planifica(diaDelBuilder(5), con(20, 5)), "builder")).toBe("L");
    expect(choferDe(planifica(diaDelBuilder(6), con(20, 5)), "builder")).toBe("L");
    // Y el umbral es el de Ajustes: con 7, las 6 millas ya caben.
    expect(choferDe(planifica(diaDelBuilder(6), con(20, 7)), "builder")).toBe("S");
  });

  it("nunca a costa de llegar tarde: si con el de su zona la ventana ancha se pasa (50 min, dentro del tope), se queda con el otro", () => {
    const e = diaDelBuilder(0, { builder: false, ventana: [480, 560] });
    expect(millasDeMasConS(e)).toMatchObject({ millas: 0, tardeMin: 50 });
    expect(choferDe(planifica(e, con(20)), "builder")).toBe("L");
  });

  it("umbral 0 o peso 0: las zonas vuelven a ser solo el peso (o nada), como en motor-4", () => {
    const e = diaDelBuilder(0);
    expect(choferDe(planifica(e, con(20, 0)), "builder")).toBe("L");
    expect(choferDe(planifica(e, con(0, 5)), "builder")).toBe("L");
  });

  it("no deja vacío a un chofer con «usar todos»: si el builder es lo único de L, se queda con L", () => {
    const e = diaDelBuilder(0);
    const p = planifica(e, { ...con(20), usarTodos: true });
    expect(choferDe(p, "builder")).toBe("L");
    expect(p.rutas.every((r) => r.paradas.length > 0)).toBe(true);
  });
});

// ---- La vuelta de mejora de después no deshace lo que volvió ---------------------------------------------------------

const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
/** Un día inventado: 2-3 choferes con una zona cada uno, dos tiendas, órdenes por la cuadrícula con builders y ventanas. */
function diaInventado(sem: number): Entrada {
  const r = serie(sem), tiendas = [punto(0, 0), punto(20, 0)], Z = ["N", "S", "E"];
  const ordenes = Array.from({ length: 5 + Math.floor(r() * 7) }, (_, k) => {
    const x = Math.floor(r() * 50) - 10, y = Math.floor(r() * 40) - 20;
    return orden(`o${k}`, {
      entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`, origen: tiendas[Math.floor(r() * 2)], destino: punto(x, y), pallets: 1 + Math.floor(r() * 3),
      ventana: r() < 0.4 ? [480, 480 + 40 + Math.floor(r() * 200)] : null, estrecha: r() < 0.3, builder: r() < 0.4, servicioEntregaMin: 10 + Math.floor(r() * 40),
      zona: Z[(x > 15 ? 1 : 0) + (y > 5 ? 1 : 0)],
    });
  });
  const choferes = Array.from({ length: 2 + Math.floor(r() * 2) }, (_, k) => chofer(`c${k}`, {
    base: tiendas[k % 2], capacidad: 6 + Math.floor(r() * 6), salida: 480 + 300 + Math.floor(r() * 200), zonas: [Z[k]],
  }));
  return entradaDe(ordenes, choferes);
}

describe("la mejora de después del repaso no saca de su zona lo que volvió", () => {
  it("el día inventado 10: sin proteger el intercambio, un cambio de dos entregas volvía a dejar una fuera de zona", () => {
    // Medido al escribirlo: quitando la protección del intercambio, los días 10, 13 y 18 (de los 18 primeros) acaban con
    // una o dos entregas más fuera de zona. Con ella, el 10 acaba con todas en su zona.
    const p = planifica(diaInventado(10));
    expect(p.coste.fueraDeZona).toBe(0);
    expect(p.sinAsignar.length).toBe(planifica(diaInventado(10), con(60, 0)).sinAsignar.length);
  });
});

