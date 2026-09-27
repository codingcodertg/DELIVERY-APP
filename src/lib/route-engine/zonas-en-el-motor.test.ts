import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  costeTotal, evaluaPlan, fueraDeSuZona, PARAMETROS_POR_DEFECTO, PESO_DE_ZONA_POR_DEFECTO, PESOS_POR_DEFECTO, planifica, restaDesglose,
  zonasReclamadas, type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Parametros, type Plan,
} from "./index";

/**
 * Zonas preferidas por chofer en «Planificar el día» (D-NEXT, T-0412). El dueño, 2026-09-27: *«ernesto is mcallen mission
 * and julio is phar thats their preferences as well as maximo is brownsville only if possible»*, y después: *«Preferencia,
 * no regla»*. Cuadrícula como `requisitos-en-el-motor.test.ts`: de «x,y» a «x',y'» se tarda |dx|+|dy| minutos. Las zonas
 * se llaman Norte, Sur…: nada es real.
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
  id, nombre: id, base: punto(0), capacidad: 20, entrada: 480, salida: 1080, vuelveABase: true, ...extra,
});
function entradaDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Entrada {
  const puntos = new Set<string>();
  for (const o of ordenes) { if (o.origen) puntos.add(o.origen); if (o.destino) puntos.add(o.destino); }
  for (const c of choferes) puntos.add(c.base);
  return { ordenes, choferes, matriz: matrizDe([...puntos]) };
}
const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id || p.orden.startsWith(`${id}#`)))?.chofer ?? null;
const sinZonas = (e: Entrada): Entrada => ({ ...e, choferes: e.choferes.map(({ zonas: _z, ...c }) => { void _z; return c; }) });
const secuencias = (p: Plan) => p.rutas.map((r) => [r.chofer, r.paradas.map((x) => `${x.tipo}:${x.orden}`)]);

// ---- La huella: sin zonas, el plan de siempre ---------------------------------------------------------------------

/** El MISMO día de `prioridad-y-reparto.test.ts` (grabado con `motor-1`), con lo que se le quiera añadir. */
function diaGrabado(extraOrden?: (k: number) => Partial<OrdenEntrada>, extraChofer?: (k: number) => Partial<ChoferEntrada>) {
  const r = serie(11);
  const tiendas = [punto(0, 0), punto(60, 0), punto(0, 60)];
  const ordenes = Array.from({ length: 30 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, {
    origen: tiendas[Math.floor(r() * 3)], destino: punto(Math.floor(r() * 70), Math.floor(r() * 70) + 20),
    pallets: Math.round((0.5 + r() * 5) * 100) / 100, builder: r() < 0.3, entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`,
    ventana: r() < 0.4 ? [480, 480 + 60 + Math.floor(r() * 300)] : null, estrecha: r() < 0.2,
    ...(extraOrden?.(k) ?? {}),
  }));
  const choferes = Array.from({ length: 4 }, (_, k) => chofer(`c${k}`, { base: tiendas[k % 3], capacidad: 6 + (k % 3) * 2, salida: 480 + 480, ...(extraChofer?.(k) ?? {}) }));
  return entradaDe(ordenes, choferes);
}
const huella = (plan: Plan) => createHash("sha256").update(JSON.stringify({ ...plan, version: "motor-1" })).digest("hex");
/** La de `prioridad-y-reparto.test.ts`: el plan de `motor-1`, grabado antes de D-415. */
const HUELLA_DE_MOTOR_1 = "08fdb1c2308cf94599a6e07b3e8e164d66049e8d6cd2ead3a904792a1884afb8";

describe("sin zonas configuradas, el motor planifica EXACTAMENTE lo mismo que antes", () => {
  it("el día grabado da el plan de motor-1 byte a byte: sin zonas, con órdenes que traen zona pero nadie la prefiere, y con listas vacías", () => {
    expect(huella(planifica(diaGrabado()))).toBe(HUELLA_DE_MOTOR_1);
    expect(huella(planifica(diaGrabado((k) => ({ zona: k % 2 ? "Norte" : "Sur" }))))).toBe(HUELLA_DE_MOTOR_1);
    expect(huella(planifica(diaGrabado((k) => ({ zona: k % 2 ? "Norte" : "Sur" }), () => ({ zonas: [] }))))).toBe(HUELLA_DE_MOTOR_1);
  });

  it("y con zonas, el día grabado cambia (si no, la huella no probaría nada)", () => {
    const con = diaGrabado((k) => ({ zona: k % 2 ? "Norte" : "Sur" }), (k) => ({ zonas: [k % 2 ? "Norte" : "Sur"] }));
    expect(huella(planifica(con))).not.toBe(HUELLA_DE_MOTOR_1);
  });
});

// ---- Qué cuenta como fuera de zona --------------------------------------------------------------------------------

describe("fuera de zona", () => {
  const reclamadas = zonasReclamadas([{ zonas: ["McAllen", " Mission "] }, { zonas: ["Pharr"] }, {}]);

  it("las zonas reclamadas son las de todos, sin mayúsculas ni espacios de más", () => {
    expect([...reclamadas].sort()).toEqual(["mcallen", "mission", "pharr"]);
  });

  it("solo está fuera un chofer CON zonas que lleva una entrega de la zona de otro", () => {
    expect(fueraDeSuZona({ zonas: ["Pharr"] }, { zona: "mcallen" }, reclamadas)).toBe(true);
    expect(fueraDeSuZona({ zonas: ["Pharr"] }, { zona: "PHARR" }, reclamadas)).toBe(false);
    // Un chofer sin zonas nunca paga.
    expect(fueraDeSuZona({ zonas: [] }, { zona: "McAllen" }, reclamadas)).toBe(false);
    expect(fueraDeSuZona({}, { zona: "McAllen" }, reclamadas)).toBe(false);
    // Una ciudad que nadie prefiere va por millas: nadie paga por llevarla.
    expect(fueraDeSuZona({ zonas: ["Pharr"] }, { zona: "Edinburg" }, reclamadas)).toBe(false);
    // Sin ciudad, tampoco.
    expect(fueraDeSuZona({ zonas: ["Pharr"] }, { zona: "" }, reclamadas)).toBe(false);
    expect(fueraDeSuZona({ zonas: ["Pharr"] }, {}, reclamadas)).toBe(false);
  });

  it("cada entrega fuera de zona cuesta el peso `zona` (por defecto 60, como 60 minutos de manejo); 0 lo apaga", () => {
    const d = { builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, fueraDeZona: 2 };
    expect(PESO_DE_ZONA_POR_DEFECTO).toBe(60);
    expect(costeTotal(d, PESOS_POR_DEFECTO)).toBe(costeTotal({ ...d, fueraDeZona: 0, manejoMin: 120 }, PESOS_POR_DEFECTO));
    expect(costeTotal(d, { ...PESOS_POR_DEFECTO, zona: 10 })).toBe(costeTotal({ ...d, fueraDeZona: 0, manejoMin: 20 }, PESOS_POR_DEFECTO));
    expect(costeTotal(d, { ...PESOS_POR_DEFECTO, zona: 0 })).toBe(0);
  });

  it("evaluar un plan cuenta las entregas fuera de zona por ruta y en total, y solo si alguien tiene zonas", () => {
    const ordenes = [orden("a", { zona: "Norte" }), orden("b", { zona: "Norte" }), orden("c", { zona: "Sur" })];
    const choferes = [chofer("N", { zonas: ["Norte"] }), chofer("S", { zonas: ["Sur"] })];
    const e = entradaDe(ordenes, choferes);
    const secuencias = { N: [{ orden: "a", tipo: "P" as const }, { orden: "a", tipo: "D" as const }, { orden: "c", tipo: "P" as const }, { orden: "c", tipo: "D" as const }], S: [{ orden: "b", tipo: "P" as const }, { orden: "b", tipo: "D" as const }] };
    const r = evaluaPlan({ secuencias, ordenes, choferes, matriz: e.matriz });
    expect(r.rutas.map((x) => x.fueraDeZona)).toEqual([1, 1]);
    expect(r.coste.fueraDeZona).toBe(2);
    const sin = evaluaPlan({ secuencias, ordenes, choferes: sinZonas(e).choferes, matriz: e.matriz });
    expect("fueraDeZona" in sin.coste).toBe(false);
    expect(sin.rutas.every((x) => !("fueraDeZona" in x))).toBe(true);
    expect(r.coste.total - sin.coste.total).toBe(costeTotal({ builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, fueraDeZona: 2 }, PESOS_POR_DEFECTO));
  });

  it("la diferencia entre dos desgloses lleva la de zonas solo si alguno la trae", () => {
    const a = { builder: 0, manejoMin: 5, millas: 1, tardeMin: 0, balanceMin: 0, total: 10 };
    expect("fueraDeZona" in restaDesglose(a, a)).toBe(false);
    expect(restaDesglose({ ...a, fueraDeZona: 3 }, { ...a, fueraDeZona: 1 }).fueraDeZona).toBe(2);
    expect(restaDesglose({ ...a, fueraDeZona: 1 }, a).fueraDeZona).toBe(1);
    expect(restaDesglose(a, { ...a, fueraDeZona: 1 }).fueraDeZona).toBe(-1);
  });
});

// ---- Lo que pidió el dueño ----------------------------------------------------------------------------------------

/**
 * Dos choferes que cargan en la misma tienda (0,0). N vive al SUR (0,-8) y prefiere el Norte; S vive al NORTE (0,8) y
 * prefiere el Sur. Por millas, cada uno se llevaría lo de su lado de casa, que es la zona del otro: así las zonas tienen
 * que ganarle a la geografía, y la prueba no pasa por casualidad.
 */
const tienda = punto(0, 0);
const diaDeDosZonas = (n = 4, extraN: Partial<ChoferEntrada> = {}) => entradaDe([
  ...Array.from({ length: n }, (_, k) => orden(`norte${k}`, { origen: tienda, destino: punto(k * 3, 25), zona: "Norte", entrada: `2026-01-05 080${k}` })),
  ...Array.from({ length: n }, (_, k) => orden(`sur${k}`, { origen: tienda, destino: punto(k * 3, -25), zona: "Sur", entrada: `2026-01-05 081${k}` })),
], [chofer("N", { base: punto(0, -8), zonas: ["Norte"], ...extraN }), chofer("S", { base: punto(0, 8), zonas: ["Sur"] })]);

describe("con capacidad y ventanas de sobra, cada orden va al chofer de su zona", () => {
  it("todas las del Norte con N y todas las del Sur con S", () => {
    const e = diaDeDosZonas();
    const plan = planifica(e);
    expect(plan.sinAsignar).toEqual([]);
    for (const o of e.ordenes) expect({ o: o.id, c: choferDe(plan, o.id) }).toEqual({ o: o.id, c: o.zona === "Norte" ? "N" : "S" });
    expect(plan.coste.fueraDeZona).toBe(0);
  });

  it("sin zonas, las mismas órdenes van por millas: cada chofer se lleva lo de al lado de su casa (la zona del otro)", () => {
    const plan = planifica(sinZonas(diaDeDosZonas()));
    expect(plan.sinAsignar).toEqual([]);
    expect(diaDeDosZonas().ordenes.filter((o) => choferDe(plan, o.id) === (o.zona === "Norte" ? "N" : "S")).length).toBeLessThan(4);
  });

  it("con el peso en 0, las zonas no deciden nada: el mismo reparto que sin zonas", () => {
    const cero: Parametros = { ...PARAMETROS_POR_DEFECTO, pesos: { ...PARAMETROS_POR_DEFECTO.pesos, zona: 0 } };
    expect(secuencias(planifica(diaDeDosZonas(), cero))).toEqual(secuencias(planifica(sinZonas(diaDeDosZonas()))));
  });

  it("«¿por qué aquí?»: con el chofer de la otra zona el plan sale con una entrega más fuera de zona", () => {
    const plan = planifica(diaDeDosZonas());
    const x = plan.explicaciones.find((e) => e.orden === "norte0")!;
    expect(x.chofer).toBe("N");
    expect(x.alternativas.find((a) => a.chofer === "S")!.diferencia!.fueraDeZona).toBe(1);
  });
});

describe("preferencia, no regla: nunca deja una orden fuera por la zona", () => {
  it("si la zona de N tiene más de lo que le cabe, lo que sobra lo lleva S, y no queda nada fuera", () => {
    // N solo tiene turno para dos entregas del Norte (la cuenta: con tres acabaría a los 128 min de un turno de 115): su zona no le cabe entera.
    const e = diaDeDosZonas(4, { salida: 480 + 115 });
    const plan = planifica(e);
    expect(plan.sinAsignar).toEqual([]);
    const delNorte = e.ordenes.filter((o) => o.zona === "Norte");
    expect(delNorte.some((o) => choferDe(plan, o.id) === "N")).toBe(true);
    expect(delNorte.some((o) => choferDe(plan, o.id) === "S")).toBe(true);
    // Y lo del Sur, todo con S: la zona de S no se la queda N.
    for (const o of e.ordenes.filter((x) => x.zona === "Sur")) expect(choferDe(plan, o.id)).toBe("S");
  });

  it("una orden de una ciudad que nadie prefiere va por millas, como sin zonas", () => {
    const e = entradaDe([
      orden("oeste0", { origen: tienda, destino: punto(-30, -5), zona: "Oeste" }),
      orden("oeste1", { origen: tienda, destino: punto(-30, 6), zona: "Oeste" }),
    ], [chofer("N", { base: punto(0, -8), zonas: ["Norte"] }), chofer("S", { base: punto(0, 8), zonas: ["Sur"] })]);
    const con = planifica(e);
    expect(secuencias(con)).toEqual(secuencias(planifica(sinZonas(e))));
    expect(con.coste.fueraDeZona).toBe(0);
  });

  it("un chofer sin zonas lleva lo que le quede cerca sin coste de más, aunque sea de la zona de otro", () => {
    const e = entradaDe([orden("norte0", { origen: tienda, destino: punto(0, 25), zona: "Norte" })],
      [chofer("N", { base: punto(0, -30), zonas: ["Norte"] }), chofer("L", { base: punto(0, 20) })]);
    const plan = planifica(e);
    expect(choferDe(plan, "norte0")).toBe("L");
    expect(plan.coste.fueraDeZona).toBe(0);
  });

  /** Un día inventado con 2-3 choferes, cada uno con una zona de cuatro, y órdenes repartidas por la cuadrícula. */
  function diaInventado(sem: number): Entrada {
    const r = serie(sem);
    const tiendas = [punto(0, 0), punto(40, 0), punto(0, 40)];
    const ZONAS = ["N", "S", "E", "O"];
    const ordenes: OrdenEntrada[] = Array.from({ length: 8 + Math.floor(r() * 14) }, (_, k) => {
      const x = Math.floor(r() * 80) - 20, y = Math.floor(r() * 80) - 20;
      return orden(`o${k}`, {
        entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`, origen: tiendas[Math.floor(r() * 3)], destino: punto(x, y),
        pallets: Math.round((0.5 + r() * 5) * 100) / 100, ventana: r() < 0.4 ? [480, 480 + 60 + Math.floor(r() * 240)] : null, estrecha: r() < 0.3,
        zona: ZONAS[(x > 20 ? 1 : 0) + (y > 20 ? 2 : 0)],
      });
    });
    const choferes = Array.from({ length: 2 + Math.floor(r() * 2) }, (_, k) => chofer(`c${k}`, {
      base: tiendas[k % 3], capacidad: 5 + Math.floor(r() * 6), salida: 480 + 240 + Math.floor(r() * 180), zonas: [ZONAS[k]],
    }));
    return entradaDe(ordenes, choferes);
  }

  it("el día inventado 5: repartir por zonas dejaría una orden más fuera, y el motor se queda con el plan sin zonas", () => {
    // Medido al escribirlo: planificando solo con zonas, 99 de 600 días inventados dejaban más órdenes fuera que sin ellas
    // (el 5 es el primero). Con la vuelta sin zonas, ninguno.
    const e = diaInventado(5);
    const sin = planifica(sinZonas(e)).sinAsignar.length;
    expect(planifica(e).sinAsignar.length).toBeLessThanOrEqual(sin);
  });

  it("en 150 días inventados, con zonas nunca queda fuera más que sin ellas", () => {
    for (let s = 1; s <= 150; s++) {
      const e = diaInventado(s);
      expect({ dia: s, fuera: planifica(e).sinAsignar.length <= planifica(sinZonas(e)).sinAsignar.length }).toEqual({ dia: s, fuera: true });
    }
  }, 120_000);
});
