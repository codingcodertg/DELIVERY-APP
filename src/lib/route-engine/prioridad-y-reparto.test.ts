import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  costeDeRutas, evaluaPlan, MINUTOS_POR_ORDEN_EN_BALANCE, PARAMETROS_POR_DEFECTO, PESOS_POR_DEFECTO, planifica,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type ParadaRef, type Parametros, type Plan, type PrioridadDeOrden,
} from "./index";

/**
 * Prioridad por orden y opciones de reparto en el motor (D-NEXT). El dueño, con los enlaces de OptimoRoute (2026-09-26/27):
 * «quiero que mires como funciona y lo copies». El mapa es la misma cuadrícula que `route-engine.test.ts`: de «x,y» a
 * «x',y'» se tarda |dx|+|dy| minutos, a 0,6 millas por minuto. Nada es real.
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
function entradaDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Entrada {
  const puntos = new Set<string>();
  for (const o of ordenes) { if (o.origen) puntos.add(o.origen); if (o.destino) puntos.add(o.destino); }
  for (const c of choferes) puntos.add(c.base);
  return { ordenes, choferes, matriz: matrizDe([...puntos]) };
}
const con = (p: Partial<Parametros>): Parametros => ({ ...PARAMETROS_POR_DEFECTO, ...p });
const fueraIds = (plan: Plan) => plan.sinAsignar.map((s) => s.orden);
const entregas = (plan: Plan, c: string) => plan.rutas.find((r) => r.chofer === c)!.paradas.filter((p) => p.tipo === "D").map((p) => p.orden);
const usados = (plan: Plan) => plan.rutas.filter((r) => r.paradas.length > 0).length;

/** Un generador fijo, no azar: la misma serie siempre. */
const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };

// ---- No-regresión: sin prioridad y con las opciones sin tocar, el mismo plan que `motor-1` ----------------------

/** Un día de 30 órdenes y 4 choferes, con ventanas, duras, builders, tres tiendas, turnos cortos (10 quedan fuera) y
 *  mejora (4 movimientos). Su plan se grabó con el motor de ANTES de este cambio (`origin/main`, aa6e3d85). */
function diaGrabado(prioridad?: (k: number) => PrioridadDeOrden | undefined) {
  const r = serie(11);
  const tiendas = [punto(0, 0), punto(60, 0), punto(0, 60)];
  const ordenes = Array.from({ length: 30 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, {
    origen: tiendas[Math.floor(r() * 3)], destino: punto(Math.floor(r() * 70), Math.floor(r() * 70) + 20),
    pallets: Math.round((0.5 + r() * 5) * 100) / 100, builder: r() < 0.3, entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`,
    ventana: r() < 0.4 ? [480, 480 + 60 + Math.floor(r() * 300)] : null, estrecha: r() < 0.2,
    ...(prioridad?.(k) ? { prioridad: prioridad(k) } : {}),
  }));
  const choferes = Array.from({ length: 4 }, (_, k) => chofer(`c${k}`, { base: tiendas[k % 3], capacidad: 6 + (k % 3) * 2, salida: 480 + 480 }));
  return entradaDe(ordenes, choferes);
}
/** La huella del plan entero (rutas, horas, coste, fuera, explicaciones…), con la versión de antes para compararla. */
const huella = (plan: Plan) => createHash("sha256").update(JSON.stringify({ ...plan, version: "motor-1" })).digest("hex");
const HUELLA_DE_MOTOR_1 = "08fdb1c2308cf94599a6e07b3e8e164d66049e8d6cd2ead3a904792a1884afb8";

describe("sin prioridad ni opciones, el motor planifica EXACTAMENTE lo mismo que antes", () => {
  it("el día grabado da el mismo plan, byte a byte, que motor-1", () => {
    const plan = planifica(diaGrabado());
    expect([plan.sinAsignar.length, plan.coste.total, plan.movimientos]).toEqual([10, 641620000, 4]);
    expect(huella(plan)).toBe(HUELLA_DE_MOTOR_1);
  });

  it("y también con todas en «normal» escrito, y con las opciones puestas a su valor por defecto", () => {
    expect(huella(planifica(diaGrabado(() => "normal")))).toBe(HUELLA_DE_MOTOR_1);
    // Un valor que no es de los cuatro (un plan guardado a mano, un error) cuenta como normal, no como crítica.
    expect(huella(planifica(diaGrabado(() => "urgente" as PrioridadDeOrden)))).toBe(HUELLA_DE_MOTOR_1);
    expect(huella(planifica(diaGrabado(), con({ balancePor: "tiempo", usarTodos: false })))).toBe(HUELLA_DE_MOTOR_1);
    // Un plan guardado antes de este cambio no trae las opciones en sus `params`: sin ellas, lo mismo.
    const { balancePor: _b, usarTodos: _u, ...viejos } = PARAMETROS_POR_DEFECTO;
    void _b; void _u;
    expect(huella(planifica(diaGrabado(), viejos))).toBe(HUELLA_DE_MOTOR_1);
  });

  it("y con prioridades puestas, el plan CAMBIA (la prueba de arriba no es una tautología)", () => {
    expect(huella(planifica(diaGrabado((k) => (k % 7 === 0 ? "critical" : k % 5 === 0 ? "low" : undefined))))).not.toBe(HUELLA_DE_MOTOR_1);
  });
});

// ---- Prioridad: qué se queda fuera ------------------------------------------------------------------------------

describe("prioridad: cuando no cabe todo, se queda fuera lo de menos prioridad", () => {
  // Camión de 1 pallet y turno que da para UNA sola (20 de carga + 90 de ida + 10 de entrega + 90 de vuelta = 210 de
  // 240; con las dos, dos viajes); «a» entró antes y está más cerca. Es el caso de los builders de `route-engine.test.ts`.
  const dosQueNoCaben = (pa?: PrioridadDeOrden, pb?: PrioridadDeOrden, extraB: Partial<OrdenEntrada> = {}) => entradaDe(
    [orden("a", { entrada: "2026-01-05 0700", destino: punto(90), prioridad: pa }), orden("b", { entrada: "2026-01-05 0900", destino: punto(95), prioridad: pb, ...extraB })],
    [chofer("c1", { salida: 480 + 240, capacidad: 1 })],
  );

  it("crítica dentro y normal fuera con capacidad justa", () => {
    expect(fueraIds(planifica(dosQueNoCaben()))).toEqual(["b"]);                 // control: sin prioridad, entra la que entró antes
    const plan = planifica(dosQueNoCaben("normal", "critical"));
    expect(fueraIds(plan)).toEqual(["a"]);
    expect(entregas(plan, "c1")).toEqual(["b"]);
  });

  it("alta sobre normal, y normal sobre baja", () => {
    expect(fueraIds(planifica(dosQueNoCaben(undefined, "high")))).toEqual(["a"]);
    expect(fueraIds(planifica(dosQueNoCaben("low", undefined)))).toEqual(["a"]);
    // Y la de menos prioridad, aunque haya entrado antes y esté más cerca, es la que cede.
    expect(fueraIds(planifica(dosQueNoCaben("high", "critical")))).toEqual(["a"]);
  });

  it("una crítica que necesita el sitio de DOS normales también entra: la construcción la coloca antes que a ellas", () => {
    // Turno de 130: las dos normales cerca caben juntas (60); la crítica lejos, sola (130); con cualquiera de ellas, no.
    // Ceder el sitio cambia UNA por una: aquí no basta, y lo que decide es colocar primero lo de más prioridad.
    const e = entradaDe([
      orden("n1", { entrada: "2026-01-05 0700", destino: punto(10) }), orden("n2", { entrada: "2026-01-05 0701", destino: punto(10) }),
      orden("critica", { entrada: "2026-01-05 0900", destino: punto(50), prioridad: "critical" }),
    ], [chofer("c1", { salida: 480 + 130 })]);
    expect(fueraIds(planifica({ ...e, ordenes: e.ordenes.map((o) => ({ ...o, prioridad: undefined })) }))).toEqual(["critica"]);   // control
    expect(fueraIds(planifica(e))).toEqual(["n1", "n2"]);
  });

  it("una prioridad que no es de las cuatro cuenta como normal, también mezclada con normales", () => {
    expect(fueraIds(planifica(dosQueNoCaben("normal", "urgente" as PrioridadDeOrden)))).toEqual(["b"]);
    expect(fueraIds(planifica(dosQueNoCaben("urgente" as PrioridadDeOrden, "high")))).toEqual(["a"]);
  });

  it("la prioridad manda sobre el builder: una crítica entra antes que un builder normal", () => {
    expect(fueraIds(planifica(dosQueNoCaben(undefined, undefined, { builder: true })))).toEqual(["a"]);     // control: el builder gana
    expect(fueraIds(planifica(dosQueNoCaben("critical", undefined, { builder: true })))).toEqual(["b"]);
    // Y cuando la crítica necesita el sitio de DOS builders (ceder el sitio cambia una por una, no basta): la
    // construcción la coloca antes que a ellos.
    const dosBuilders = entradaDe([
      orden("b1", { entrada: "2026-01-05 0700", destino: punto(10), builder: true }), orden("b2", { entrada: "2026-01-05 0701", destino: punto(10), builder: true }),
      orden("critica", { entrada: "2026-01-05 0900", destino: punto(50), prioridad: "critical" }),
    ], [chofer("c1", { salida: 480 + 130 })]);
    expect(fueraIds(planifica(dosBuilders))).toEqual(["b1", "b2"]);
  });

  /** Tras planificar, ¿alguna de fuera cabría quitando UNA de menos prioridad de su ruta? Se prueba a mano, con la
   *  evaluación, en todas las posiciones: no se fía de lo que diga el motor. */
  function cedeMal(e: Entrada, plan: Plan): string[] {
    const RANGO: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    const rango = (o: OrdenEntrada) => RANGO[o.prioridad ?? "normal"];
    const malos: string[] = [];
    for (const s of plan.sinAsignar) {
      const o = e.ordenes.find((x) => x.id === s.orden)!;
      for (const ruta of plan.rutas) {
        const c = e.choferes.find((x) => x.id === ruta.chofer)!;
        const seq: ParadaRef[] = ruta.paradas.map((p) => ({ orden: p.orden, tipo: p.tipo }));
        for (const q of new Set(seq.map((p) => p.orden))) {
          if (rango(e.ordenes.find((x) => x.id === q)!) <= rango(o)) continue;
          const sin = seq.filter((p) => p.orden !== q);
          for (let i = 0; i <= sin.length; i++) for (let j = i; j <= sin.length; j++) {
            const prueba = [...sin.slice(0, i), { orden: o.id, tipo: "P" as const }, ...sin.slice(i, j), { orden: o.id, tipo: "D" as const }, ...sin.slice(j)];
            if (!evaluaPlan({ secuencias: { [c.id]: prueba }, ordenes: e.ordenes, choferes: [c], matriz: e.matriz }).violaciones.length) malos.push(`${o.id} cabría quitando ${q}`);
          }
        }
      }
    }
    return [...new Set(malos)];
  }
  /** Días pequeños y apretados, con prioridades mezcladas. */
  function diaApretado(semilla: number): Entrada {
    const r = serie(semilla);
    const PR: PrioridadDeOrden[] = ["low", "normal", "normal", "high", "critical"];
    const n = 4 + Math.floor(r() * 5);
    const ordenes = Array.from({ length: n }, (_, k) => orden(`o${k}`, {
      entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`, destino: punto(Math.floor(r() * 60) - 30, Math.floor(r() * 60) - 30),
      pallets: 1 + Math.floor(r() * 6), ventana: r() < 0.4 ? [480, 480 + 40 + Math.floor(r() * 200)] : null, estrecha: r() < 0.5,
      prioridad: PR[Math.floor(r() * 5)], builder: r() < 0.2,
    }));
    const nc = 1 + Math.floor(r() * 2);
    const choferes = Array.from({ length: nc }, (_, k) => chofer(`c${k}`, { capacidad: 6 + Math.floor(r() * 6), salida: 480 + 90 + Math.floor(r() * 120) }));
    return entradaDe(ordenes, choferes);
  }

  it("ceder el sitio: la mejora reordena y abre un hueco que ya ocupó una baja; la normal de fuera entra y la baja sale", () => {
    // Los dos días de 400 en los que, sin «ceder el sitio», una normal se quedaba fuera cabiendo si salía una baja.
    for (const semilla of [295, 297]) {
      const e = diaApretado(semilla);
      expect(cedeMal(e, planifica(e)), `día ${semilla}`).toEqual([]);
    }
  });

  it("y en 400 días apretados, ninguna de fuera cabría quitando una de menos prioridad", () => {
    const malos: string[] = [];
    for (let s = 1; s <= 400; s++) {
      const e = diaApretado(s), plan = planifica(e);
      for (const m of cedeMal(e, plan)) malos.push(`día ${s}: ${m}`);
      // Y la que cede no se pierde: toda orden está en una ruta o en «sin asignar», una sola vez.
      const cuentas = [...plan.rutas.flatMap((r) => r.paradas.filter((p) => p.tipo === "D").map((p) => p.orden)), ...plan.sinAsignar.map((x) => x.orden)].sort();
      expect(cuentas, `día ${s}`).toEqual(e.ordenes.map((o) => o.id).sort());
    }
    expect(malos).toEqual([]);
  }, 60000);
});

// ---- Prioridad: el orden dentro de la ruta --------------------------------------------------------------------

describe("prioridad: a igualdad, las críticas y altas van antes en la ruta, sin romper ventanas", () => {
  // Dos entregas que cuestan lo mismo en cualquier orden: tienda en 0, destinos (10,0) y (10,1). 10+1+11 = 11+1+10.
  const gemelas = (pa?: PrioridadDeOrden, extraZ: Partial<OrdenEntrada> = {}) => entradaDe(
    [orden("z", { entrada: "2026-01-05 0700", destino: punto(10, 0), ...extraZ }), orden("a", { entrada: "2026-01-05 0900", destino: punto(10, 1), prioridad: pa })],
    [chofer("c1")],
  );

  it("sin prioridad, la que entró primero; con «a» crítica o alta, «a» primero, al mismo coste", () => {
    const control = planifica(gemelas());
    expect(entregas(control, "c1")).toEqual(["z", "a"]);
    for (const p of ["critical", "high"] as const) {
      const plan = planifica(gemelas(p));
      expect(entregas(plan, "c1"), p).toEqual(["a", "z"]);
      expect(plan.coste.total, p).toBe(control.coste.total);
    }
    expect(entregas(planifica(gemelas("low")), "c1")).toEqual(["z", "a"]);
    // Y entre dos que empujan, la crítica antes que la alta aunque la alta entrara primero.
    expect(entregas(planifica(gemelas("critical", { prioridad: "high" })), "c1")).toEqual(["a", "z"]);
  });

  it("también cuando la otra ya estaba puesta: una parada fijada a mano no adelanta a la crítica que se coloca después", () => {
    // «z» la fijó el despachador; el motor mete «a» alrededor. Delante o detrás cuesta lo mismo: la crítica, delante.
    const fijada = (pa?: PrioridadDeOrden) => ({ ...gemelas(pa), secuenciaFijada: { c1: [{ orden: "z", tipo: "P" as const }, { orden: "z", tipo: "D" as const }] } });
    expect(entregas(planifica(fijada()), "c1")).toEqual(["z", "a"]);
    expect(entregas(planifica(fijada("critical")), "c1")).toEqual(["a", "z"]);
    expect(entregas(planifica(fijada("high")), "c1")).toEqual(["a", "z"]);
  });

  it("pero no rompe una ventana dura: si «z» tiene que ir primero, va primero aunque «a» sea crítica", () => {
    // Carga 480-500, a (10,0) a las 510. Con «a» delante, «z» llegaría a las 522: pasada su ventana dura de 515.
    const plan = planifica(gemelas("critical", { ventana: [480, 515], estrecha: true }));
    expect(entregas(plan, "c1")).toEqual(["z", "a"]);
    expect(plan.violaciones).toEqual([]);
  });

  it("la prioridad solo desempata: si adelantar la crítica cuesta manejo, no se adelanta", () => {
    // Misma calle, sin volver: (10,0) y luego (10,2) son 12 min; al revés, 14. La crítica, la más lejana, va segunda.
    const e = entradaDe([
      orden("cerca", { entrada: "2026-01-05 0700", destino: punto(10, 0) }), orden("lejos", { entrada: "2026-01-05 0900", destino: punto(10, 2), prioridad: "critical" }),
    ], [chofer("c1", { vuelveABase: false })]);
    expect(entregas(planifica(e), "c1")).toEqual(["cerca", "lejos"]);
  });
});

// ---- Opciones de reparto -------------------------------------------------------------------------------------

describe("repartir por tiempo o por número de órdenes (OptimoRoute balanceBy)", () => {
  it("el balance por órdenes cuenta entregas, cada una como MINUTOS_POR_ORDEN_EN_BALANCE minutos", () => {
    const e = entradaDe([orden("largo", { destino: punto(100) }), orden("s1", { destino: punto(5) }), orden("s2", { destino: punto(5, 1) })], [chofer("c1"), chofer("c2")]);
    const r = evaluaPlan({ secuencias: { c1: [{ orden: "largo", tipo: "P" }, { orden: "largo", tipo: "D" }], c2: [{ orden: "s1", tipo: "P" }, { orden: "s2", tipo: "P" }, { orden: "s1", tipo: "D" }, { orden: "s2", tipo: "D" }] }, ordenes: e.ordenes, choferes: e.choferes, matriz: e.matriz });
    // Por tiempo: 230 min contra 58. Por órdenes: 1 entrega contra 2.
    expect(costeDeRutas(r.rutas, PESOS_POR_DEFECTO).balanceMin).toBe(r.rutas[0].duracionMin - r.rutas[1].duracionMin);
    expect(costeDeRutas(r.rutas, PESOS_POR_DEFECTO, "ordenes").balanceMin).toBe(MINUTOS_POR_ORDEN_EN_BALANCE);
    expect(costeDeRutas(r.rutas, PESOS_POR_DEFECTO, "tiempo")).toEqual(costeDeRutas(r.rutas, PESOS_POR_DEFECTO));
    // Y evaluar un plan con la opción (lo que hacen el ajuste a mano y la hoja importada) la usa.
    const porOrdenes = evaluaPlan({ secuencias: { c1: r.rutas[0].paradas, c2: r.rutas[1].paradas }, ordenes: e.ordenes, choferes: e.choferes, matriz: e.matriz, parametros: con({ balancePor: "ordenes" }) });
    expect(porOrdenes.coste.balanceMin).toBe(MINUTOS_POR_ORDEN_EN_BALANCE);
  });

  it("el mismo día se reparte distinto: por tiempo, el del viaje largo lleva menos órdenes; por órdenes, las mismas", () => {
    // Una lejos y cuatro cerca, con el balance fuerte para que decida.
    const e = entradaDe([
      orden("largo", { destino: punto(100) }),
      ...[1, 2, 3, 4].map((k) => orden(`s${k}`, { destino: punto(8, k), entrada: `2026-01-05 080${k}` })),
    ], [chofer("c1"), chofer("c2")]);
    const cuenta = (plan: Plan) => [entregas(plan, "c1").length, entregas(plan, "c2").length].sort();
    expect(cuenta(planifica(e, con({ pesos: { ...PESOS_POR_DEFECTO, balance: 3 } })))).toEqual([1, 4]);
    expect(cuenta(planifica(e, con({ pesos: { ...PESOS_POR_DEFECTO, balance: 3 }, balancePor: "ordenes" })))).toEqual([2, 3]);
  });
});

describe("usar todos los choferes disponibles", () => {
  // Tres órdenes al mismo sitio: lo barato es llevarlas juntas, un solo chofer.
  const juntas = () => entradaDe([1, 2, 3].map((k) => orden(`o${k}`, { destino: punto(10), entrada: `2026-01-05 080${k}` })), [chofer("c1"), chofer("c2"), chofer("c3")]);

  it("sin la opción, un chofer lleva las tres; con ella, cada chofer lleva una", () => {
    expect(usados(planifica(juntas()))).toBe(1);
    const plan = planifica(juntas(), con({ usarTodos: true }));
    expect(usados(plan)).toBe(3);
    expect(plan.sinAsignar).toEqual([]);
    expect(plan.violaciones).toEqual([]);
  });

  it("con más choferes que órdenes, usa tantos como órdenes, y ninguna se parte para llenar a otro", () => {
    const e = entradaDe([orden("o1", { destino: punto(10) }), orden("o2", { destino: punto(10) })], [chofer("c1"), chofer("c2"), chofer("c3")]);
    expect(usados(planifica(e, con({ usarTodos: true })))).toBe(2);
  });

  /** Días variados: dos bases, turnos y camiones distintos. */
  function diaVariado(semilla: number): Entrada {
    const r = serie(semilla);
    const n = 3 + Math.floor(r() * 6);
    const ordenes = Array.from({ length: n }, (_, k) => orden(`o${k}`, {
      entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`, origen: punto(r() < 0.5 ? 0 : 40), destino: punto(Math.floor(r() * 60) - 30, Math.floor(r() * 60) - 30),
      pallets: 1 + Math.floor(r() * 6), ventana: r() < 0.4 ? [480, 480 + 40 + Math.floor(r() * 200)] : null, estrecha: r() < 0.5, builder: r() < 0.3,
    }));
    const nc = 2 + Math.floor(r() * 3);
    const choferes = Array.from({ length: nc }, (_, k) => chofer(`c${k}`, { base: punto(k % 2 ? 40 : 0), capacidad: 4 + Math.floor(r() * 8), salida: 480 + 60 + Math.floor(r() * 200), vuelveABase: r() < 0.7 }));
    return entradaDe(ordenes, choferes);
  }

  it("nunca deja fuera una orden que sin la opción tenía ruta (el día 1794, donde repartir cerraba el hueco de otra)", () => {
    const e = diaVariado(1794);
    const sin = planifica(e), conTodos = planifica(e, con({ usarTodos: true }));
    expect(sin.sinAsignar).toEqual([]);
    expect(conTodos.sinAsignar).toEqual([]);
  });

  it("y en 400 días variados, ni una orden más fuera, ni un chofer menos usado", () => {
    let masUsados = 0;
    for (let s = 1001; s <= 1400; s++) {
      const e = diaVariado(s);
      const a = planifica(e), b = planifica(e, con({ usarTodos: true }));
      expect(b.sinAsignar.length, `día ${s}`).toBeLessThanOrEqual(a.sinAsignar.length);
      expect(usados(b), `día ${s}`).toBeGreaterThanOrEqual(usados(a));
      if (usados(b) > usados(a)) masUsados++;
    }
    // Medido al escribirlo (2026-09-27): en 80 de los 400 la opción usa más choferes. Que no sea cero: la opción hace algo.
    expect(masUsados).toBeGreaterThan(40);
  }, 60000);

  it("determinista: la misma entrada, el mismo plan, también con las opciones", () => {
    const e = diaGrabado((k) => (k % 4 === 0 ? "high" : undefined));
    const p = con({ usarTodos: true, balancePor: "ordenes" });
    expect(planifica(e, p)).toEqual(planifica(e, p));
    expect(planifica({ ...e, ordenes: [...e.ordenes].reverse(), choferes: [...e.choferes].reverse() }, p)).toEqual(planifica(e, p));
  });
});
