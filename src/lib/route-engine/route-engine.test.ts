import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  costeTotal, evaluaPlan, PARAMETROS_POR_DEFECTO, PESOS_POR_DEFECTO, parteOrdenesGrandes, planifica,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type ParadaRef, type Parametros, type Plan,
} from "./index";

/**
 * El núcleo del motor de rutas (D-314). Sin red, sin base, sin reloj: todo son datos inventados.
 *
 * El mapa de las pruebas es una cuadrícula: un punto es «x,y» y de uno a otro se tarda su distancia en
 * manzanas (|dx|+|dy|) en minutos, a 0,6 millas por minuto. Así cada número de abajo se puede comprobar
 * de cabeza. Ningún nombre de tienda, chofer o cuenta es real.
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

const con = (p: Omit<Partial<Parametros>, "pesos"> & { pesos?: Partial<Parametros["pesos"]> }): Parametros => ({
  ...PARAMETROS_POR_DEFECTO, ...p, pesos: { ...PESOS_POR_DEFECTO, ...(p.pesos ?? {}) },
});

const secuencia = (plan: Plan, c: string) => plan.rutas.find((r) => r.chofer === c)!.paradas.map((p) => `${p.tipo}:${p.orden}`);
const parada = (plan: Plan, tipo: "P" | "D", id: string) => plan.rutas.flatMap((r) => r.paradas).find((p) => p.tipo === tipo && p.orden === id)!;
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id))?.chofer ?? null;

/** Lo que tiene que cumplir CUALQUIER plan del motor, se mire por donde se mire. No se fía de las
 *  violaciones que el propio motor declara: vuelve a contar precedencia y carga por su cuenta. */
function esValido(plan: Plan, e: Entrada) {
  expect(plan.violaciones).toEqual([]);
  const original = (id: string) => e.ordenes.find((o) => o.id === id.split("#")[0])!;
  for (const r of plan.rutas) {
    const c = e.choferes.find((x) => x.id === r.chofer)!;
    const aBordo = new Set<string>(r.paradas.filter((p) => p.tipo === "D" && original(p.orden).recogidaHecha).map((p) => p.orden));
    let reloj = c.entrada;
    for (const p of r.paradas) {
      if (p.tipo === "P") { expect(aBordo.has(p.orden), `${p.orden} recogida dos veces`).toBe(false); aBordo.add(p.orden); }
      else { expect(aBordo.has(p.orden), `${p.orden} se entrega sin recogerla`).toBe(true); aBordo.delete(p.orden); }
      expect(p.cargaAlSalir).toBeLessThanOrEqual(c.capacidad);
      expect(p.cargaAlSalir).toBeGreaterThanOrEqual(0);
      expect(p.llegada).toBeGreaterThanOrEqual(reloj);
      expect(p.salida).toBe(p.inicioServicio + p.servicioMin);
      reloj = p.salida;
      const o = original(p.orden);
      if (o.choferFijado) expect(r.chofer).toBe(o.choferFijado);
      if (p.tipo === "D" && o.ventana && o.estrecha) expect(p.inicioServicio).toBeLessThanOrEqual(o.ventana[1]);
    }
    expect([...aBordo], `${r.chofer}: recogidas sin entregar`).toEqual([]);
    expect(r.fin).toBeLessThanOrEqual(c.salida);
  }
  // Cada orden, una sola vez: o en una ruta, o fuera con su motivo.
  const enRuta = plan.rutas.flatMap((r) => r.paradas).filter((p) => p.tipo === "D").map((p) => p.orden);
  expect(new Set(enRuta).size).toBe(enRuta.length);
  for (const s of plan.sinAsignar) expect(enRuta).not.toContain(s.orden);
}

describe("lo básico", () => {
  it("un día sin órdenes es un plan vacío, no un error", () => {
    const plan = planifica(entradaDe([], [chofer("c1"), chofer("c2")]));
    expect(plan.rutas.map((r) => r.paradas.length)).toEqual([0, 0]);
    expect(plan.coste.total).toBe(0);
    expect(plan.sinAsignar).toEqual([]);
    expect(plan.convergio).toBe(true);
  });

  it("una orden: P1 y D1, con su reloj, su carga a bordo y la vuelta a la base", () => {
    const e = entradaDe([orden("a", { destino: punto(30), ventana: [510, 720], pallets: 2.5 })], [chofer("c1")]);
    const plan = planifica(e);
    esValido(plan, e);
    const [p, d] = plan.rutas[0].paradas;
    // Sale a las 8:00 de su base, que es la tienda: carga 20 min (el mínimo; la orden sola pedía 5).
    expect([p.etiqueta, p.llegada, p.servicioMin, p.salida, p.cargaAlSalir]).toEqual(["P1", 480, 20, 500, 2.5]);
    expect([d.etiqueta, d.tramoMin, d.llegada, d.servicioMin, d.salida, d.cargaAlSalir]).toEqual(["D1", 30, 530, 10, 540, 0]);
    expect(plan.rutas[0].fin).toBe(570);
    expect(plan.rutas[0].manejoMin).toBe(60);
    expect(plan.rutas[0].millas).toBe(36);
  });

  it("si llega antes de que abra la ventana, espera; no entra antes", () => {
    const plan = planifica(entradaDe([orden("a", { ventana: [600, 720] })], [chofer("c1")]));
    const d = parada(plan, "D", "a");
    expect([d.llegada, d.esperaMin, d.inicioServicio, d.tardeMin]).toEqual([510, 90, 600, 0]);
  });

  it("cargar en la tienda dura lo MAYOR entre 20 minutos y la suma de lo que se recoge ahí, una vez por visita", () => {
    const pocas = planifica(entradaDe([orden("a"), orden("b", { destino: punto(12) })], [chofer("c1")]));
    expect(pocas.rutas[0].paradas.filter((p) => p.tipo === "P").map((p) => [p.visita, p.servicioMin])).toEqual([[1, 20], [1, 0]]);
    const muchas = planifica(entradaDe([orden("a", { servicioRecogidaMin: 18 }), orden("b", { servicioRecogidaMin: 17, destino: punto(12) })], [chofer("c1")]));
    expect(muchas.rutas[0].paradas.filter((p) => p.tipo === "P").map((p) => p.servicioMin)).toEqual([35, 0]);
  });
});

describe("precedencia y capacidad", () => {
  it("la recogida va antes que la entrega, y las dos con el mismo chofer", () => {
    const ordenes = [1, 2, 3, 4, 5, 6].map((n) => orden(`o${n}`, { origen: punto(n % 2 ? 0 : 40), destino: punto(n * 7, n), pallets: 3 }));
    const e = entradaDe(ordenes, [chofer("c1"), chofer("c2", { base: punto(40) })]);
    const plan = planifica(e);
    esValido(plan, e);
    expect(plan.sinAsignar).toEqual([]);
    for (const o of ordenes) {
      const r = plan.rutas.find((x) => x.chofer === choferDe(plan, o.id))!;
      const ids = r.paradas.map((p) => `${p.tipo}:${p.orden}`);
      expect(ids.indexOf(`P:${o.id}`)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(`P:${o.id}`)).toBeLessThan(ids.indexOf(`D:${o.id}`));
    }
  });

  it("los pallets decimales se suman sin error de redondeo: 0,15 + 0,25 + 0,6 cabe justo en un camión de 1", () => {
    // En coma flotante 0.15 + 0.25 + 0.6 da 0.9999999999999999, y 0.1 + 0.2 da 0.30000000000000004.
    const tres = [orden("a", { pallets: 0.15 }), orden("b", { pallets: 0.25 }), orden("c", { pallets: 0.6 })];
    const c1 = chofer("c1", { capacidad: 1 });
    const todas: ParadaRef[] = [...tres.map((o) => ({ orden: o.id, tipo: "P" as const })), ...tres.map((o) => ({ orden: o.id, tipo: "D" as const }))];
    const justo = evaluaPlan({ secuencias: { c1: todas }, ordenes: tres, choferes: [c1], matriz: matrizDe([punto(0), punto(10)]) });
    expect(justo.violaciones).toEqual([]);
    expect(Math.max(...justo.rutas[0].paradas.map((p) => p.cargaAlSalir))).toBe(1);

    const cuatro = [...tres, orden("d", { pallets: 0.01 })];
    const pasada = evaluaPlan({
      secuencias: { c1: [...cuatro.map((o) => ({ orden: o.id, tipo: "P" as const })), ...cuatro.map((o) => ({ orden: o.id, tipo: "D" as const }))] },
      ordenes: cuatro, choferes: [c1], matriz: matrizDe([punto(0), punto(10)]),
    });
    expect(pasada.violaciones.map((v) => [v.tipo, v.orden])).toEqual([["capacidad", "d"]]);

    // Los de arriba, multiplicados por 100, dan enteros exactos, y una suma en coma flotante también los
    // acertaría (lo cazó un mutante: esa parte de la prueba no distinguía nada). Estos no: 0.07 * 100 es
    // 7.000000000000001, y 0.07 + 0.14 + 0.28 en centésimas flotantes da 49.00000000000001 > 49.
    const malos = [orden("p", { pallets: 0.07 }), orden("q", { pallets: 0.14 }), orden("r", { pallets: 0.28 })];
    const alLimite = evaluaPlan({
      secuencias: { c1: [...malos.map((o) => ({ orden: o.id, tipo: "P" as const })), ...malos.map((o) => ({ orden: o.id, tipo: "D" as const }))] },
      ordenes: malos, choferes: [chofer("c1", { capacidad: 0.49 })], matriz: matrizDe([punto(0), punto(10)]),
    });
    expect(alLimite.violaciones).toEqual([]);
    expect(alLimite.rutas[0].paradas.map((x) => x.cargaAlSalir)).toEqual([0.07, 0.21, 0.49, 0.42, 0.28, 0]);

    const camion = chofer("c1", { capacidad: 0.3 });
    const plan = planifica(entradaDe([orden("x", { pallets: 0.1 }), orden("y", { pallets: 0.2 })], [camion]));
    expect(plan.sinAsignar).toEqual([]);
    expect(Math.max(...plan.rutas[0].paradas.map((p) => p.cargaAlSalir))).toBe(0.3);
  });

  it("lo que no cabe de una vez se lleva en dos viajes: vuelve a la tienda, que es otra parada P", () => {
    const e = entradaDe([orden("a", { pallets: 6 }), orden("b", { pallets: 6, destino: punto(12) })], [chofer("c1", { capacidad: 10 })]);
    const plan = planifica(e);
    esValido(plan, e);
    expect(plan.sinAsignar).toEqual([]);
    expect(plan.rutas[0].paradas.filter((p) => p.tipo === "P").map((p) => p.visita)).toEqual([1, 3]);
  });

  it("una orden mayor que el camión se parte en cargas del MISMO chofer, cada una con lo que cabe", () => {
    const e = entradaDe([orden("grande", { pallets: 25, servicioEntregaMin: 50 }), orden("otra", { destino: punto(5, 5) })], [chofer("c1"), chofer("c2")]);
    const plan = planifica(e);
    expect(plan.partes).toEqual({ grande: ["grande#a", "grande#b", "grande#c"] });
    expect(plan.sinAsignar).toEqual([]);
    expect(new Set(plan.partes.grande.map((id) => choferDe(plan, id))).size).toBe(1);
    expect(plan.partes.grande.map((id) => parada(plan, "P", id).cargaAlSalir)).toEqual([10, 10, 5]);
    expect(plan.partes.grande.map((id) => parada(plan, "D", id).servicioMin)).toEqual([20, 20, 10]);
    expect(plan.violaciones).toEqual([]);
  });

  it("partir es con el camión de quien la lleva: fijada a un chofer pequeño, se parte a su medida", () => {
    const { ordenes, partes } = parteOrdenesGrandes([orden("g", { pallets: 9, choferFijado: "chico" })], [chofer("chico", { capacidad: 4 }), chofer("grande", { capacidad: 12 })]);
    expect(partes).toEqual({ g: ["g#a", "g#b", "g#c"] });
    expect(ordenes.map((o) => o.pallets)).toEqual([4, 4, 1]);
    expect(parteOrdenesGrandes([orden("g", { pallets: 9 })], [chofer("chico", { capacidad: 4 }), chofer("grande", { capacidad: 12 })]).partes).toEqual({});
  });

  it("evaluar una ruta hecha a mano no la rechaza: dice qué incumple", () => {
    const ordenes = [orden("a", { pallets: 6 }), orden("b", { pallets: 5 })];
    const manual = evaluaPlan({
      secuencias: { c1: [{ orden: "a", tipo: "P" }, { orden: "b", tipo: "P" }, { orden: "b", tipo: "D" }, { orden: "a", tipo: "D" }] },
      ordenes, choferes: [chofer("c1", { capacidad: 10 }), chofer("c2")], matriz: matrizDe([punto(0), punto(10)]),
    });
    expect(manual.violaciones.map((v) => v.tipo)).toEqual(["capacidad"]);
    expect(manual.rutas[0].paradas).toHaveLength(4);
    expect(manual.rutas[1].paradas).toEqual([]);
    const alReves = evaluaPlan({ secuencias: { c1: [{ orden: "a", tipo: "D" }, { orden: "a", tipo: "P" }] }, ordenes, choferes: [chofer("c1")], matriz: matrizDe([punto(0), punto(10)]) });
    expect(alReves.violaciones.map((v) => v.tipo)).toContain("precedencia");
  });
});

describe("ventanas, turno y lo que queda fuera con su motivo", () => {
  it("a una ventana estrecha no se llega tarde: si no se puede, queda fuera y dice por qué", () => {
    const plan = planifica(entradaDe([orden("a", { destino: punto(60), ventana: [480, 530], estrecha: true })], [chofer("c1")]));
    expect(plan.sinAsignar).toEqual([{ orden: "a", motivo: "ventana_imposible" }]);
    expect(plan.rutas[0].paradas).toEqual([]);
  });

  it("a una ancha sí, con su retraso a la vista; por encima del tope, no", () => {
    const tarde = planifica(entradaDe([orden("a", { destino: punto(60), ventana: [480, 530] })], [chofer("c1")]));
    expect(tarde.sinAsignar).toEqual([]);
    expect(parada(tarde, "D", "a").tardeMin).toBe(30);
    expect(tarde.coste.tardeMin).toBe(30);

    const demasiado = planifica(entradaDe([orden("a", { destino: punto(60), ventana: [480, 490] })], [chofer("c1")]));
    expect(demasiado.sinAsignar).toEqual([{ orden: "a", motivo: "retraso_sobre_el_tope" }]);
    const conMasTope = planifica(entradaDe([orden("a", { destino: punto(60), ventana: [480, 490] })], [chofer("c1")]), con({ topeTardeAnchaMin: 120 }));
    expect(conMasTope.sinAsignar).toEqual([]);
  });

  it("la estrecha manda sobre el orden más corto: se entrega primero aunque quede más lejos", () => {
    const e = entradaDe([orden("cerca", { destino: punto(10) }), orden("lejos", { destino: punto(40), ventana: [480, 545], estrecha: true })], [chofer("c1", { vuelveABase: false })]);
    const plan = planifica(e);
    esValido(plan, e);
    expect(secuencia(plan, "c1").filter((s) => s.startsWith("D"))).toEqual(["D:lejos", "D:cerca"]);
  });

  it("sin choferes, sin punto, fuera de turno: cada una con su motivo", () => {
    expect(planifica(entradaDe([orden("a")], [])).sinAsignar).toEqual([{ orden: "a", motivo: "sin_chofer_disponible" }]);
    expect(planifica(entradaDe([orden("a", { destino: null }), orden("b", { origen: null })], [chofer("c1")])).sinAsignar)
      .toEqual([{ orden: "a", motivo: "sin_punto" }, { orden: "b", motivo: "sin_punto" }]);
    const corto = planifica(entradaDe([orden("a", { destino: punto(200) })], [chofer("c1", { salida: 600 })]));
    expect(corto.sinAsignar).toEqual([{ orden: "a", motivo: "fuera_de_turno" }]);
  });

  it("si sola cabría y con las demás no, el motivo es que no queda sitio, no que ella sea imposible", () => {
    const ordenes = ["a", "b", "c"].map((id, k) => orden(id, { destino: punto(100 + k), entrada: `2026-01-05 080${k}` }));
    const plan = planifica(entradaDe(ordenes, [chofer("c1", { salida: 480 + 250, capacidad: 1 })]));
    expect(plan.sinAsignar.map((s) => s.motivo)).toEqual(["no_cabe_con_el_resto", "no_cabe_con_el_resto"]);
    expect(choferDe(plan, "a")).toBe("c1");
  });

  it("y eso aunque con OTRO chofer no quepa ni sola: con uno le bastaba, y ese está lleno", () => {
    const ordenes = ["a", "b"].map((id, k) => orden(id, { pallets: 5, destino: punto(100 + k), entrada: `2026-01-05 080${k}` }));
    const plan = planifica(entradaDe(ordenes, [chofer("grande", { salida: 480 + 250, capacidad: 5 }), chofer("chico", { capacidad: 2, salida: 480 + 250 })]));
    expect(plan.partes).toEqual({});
    expect(plan.sinAsignar).toEqual([{ orden: "b", motivo: "no_cabe_con_el_resto" }]);
  });
});

describe("choferes: bases distintas, el que ya puso una persona, lo fijado y lo ya recogido", () => {
  it("cada chofer sale de su base: la orden va con el que la tiene cerca", () => {
    const e = entradaDe(
      [orden("este", { origen: punto(100), destino: punto(110) }), orden("oeste", { origen: punto(0), destino: punto(8) })],
      [chofer("del-este", { base: punto(100) }), chofer("del-oeste", { base: punto(0) })],
    );
    const plan = planifica(e);
    esValido(plan, e);
    expect([choferDe(plan, "este"), choferDe(plan, "oeste")]).toEqual(["del-este", "del-oeste"]);
    expect(plan.rutas.find((r) => r.chofer === "del-este")!.paradas[0].tramoMin).toBe(0);
  });

  it("el chofer que ya puso el despachador se respeta; la posición la decide el motor", () => {
    const e = entradaDe(
      [orden("suya", { origen: punto(100), destino: punto(110), choferFijado: "del-oeste" }), orden("otra", { destino: punto(8) })],
      [chofer("del-este", { base: punto(100) }), chofer("del-oeste", { base: punto(0) })],
    );
    const plan = planifica(e);
    esValido(plan, e);
    expect(choferDe(plan, "suya")).toBe("del-oeste");
    // La posición es libre: con su chofer, lo corto va primero.
    expect(secuencia(plan, "del-oeste")[0]).toBe("P:otra");
    const ex = plan.explicaciones.find((x) => x.orden === "suya")!;
    expect(ex.alternativas).toEqual([{ chofer: "del-este", diferencia: null, motivo: "no_permitido" }]);
  });

  it("si con el chofer fijado no cabe, NO se la da a otro: queda fuera y lo dice", () => {
    const e = entradaDe([orden("a", { destino: punto(300), choferFijado: "c1" })], [chofer("c1", { salida: 600 }), chofer("c2")]);
    const plan = planifica(e);
    expect(plan.sinAsignar).toEqual([{ orden: "a", motivo: "fuera_de_turno" }]);
    expect(planifica(entradaDe([orden("a", { choferFijado: "no-existe" })], [chofer("c1")])).sinAsignar)
      .toEqual([{ orden: "a", motivo: "chofer_fijado_sin_hueco" }]);
  });

  it("las paradas fijadas conservan su chofer y su orden entre sí; lo demás se coloca alrededor", () => {
    // Fijadas en un orden a propósito malo (lo lejano primero): el motor no lo «arregla».
    const fija: ParadaRef[] = [{ orden: "lejos", tipo: "P" }, { orden: "lejos", tipo: "D" }, { orden: "cerca", tipo: "P" }, { orden: "cerca", tipo: "D" }];
    const e = entradaDe(
      [orden("lejos", { destino: punto(50) }), orden("cerca", { destino: punto(5) }), orden("nueva", { destino: punto(48) })],
      [chofer("c1"), chofer("c2", { base: punto(500) })], { secuenciaFijada: { c1: fija } },
    );
    const plan = planifica(e);
    esValido(plan, e);
    const s = secuencia(plan, "c1");
    expect(s.filter((x) => !x.endsWith(":nueva"))).toEqual(["P:lejos", "D:lejos", "P:cerca", "D:cerca"]);
    expect(s).toContain("D:nueva");
    expect(plan.rutas[0].paradas.filter((p) => p.fijada).map((p) => p.orden)).toEqual(["lejos", "lejos", "cerca", "cerca"]);
    expect(parada(plan, "D", "nueva").fijada).toBe(false);
  });

  it("una orden ya recogida va en su camión desde el principio, y solo queda entregarla", () => {
    const e = entradaDe(
      [orden("a-bordo", { pallets: 4, recogidaHecha: true, choferFijado: "c1", destino: punto(20) }), orden("nueva", { pallets: 7, destino: punto(25) })],
      [chofer("c1", { capacidad: 10 })],
    );
    const plan = planifica(e);
    expect(plan.violaciones).toEqual([]);
    expect(secuencia(plan, "c1").filter((x) => x.endsWith("a-bordo"))).toEqual(["D:a-bordo"]);
    // 4 a bordo + 7 no caben: primero entrega lo que lleva, y después recoge.
    expect(secuencia(plan, "c1")).toEqual(["D:a-bordo", "P:nueva", "D:nueva"]);
    expect(planifica(entradaDe([orden("x", { recogidaHecha: true })], [chofer("c1")])).sinAsignar).toEqual([{ orden: "x", motivo: "chofer_fijado_sin_hueco" }]);
    // Lo ya recogido no se parte aunque no quepa: va entero en un camión, y partirlo sería negar lo que ya pasó.
    const enorme = planifica(entradaDe([orden("x", { pallets: 15, recogidaHecha: true, choferFijado: "c1" })], [chofer("c1", { capacidad: 10 })]));
    expect(enorme.partes).toEqual({});
    expect(enorme.sinAsignar).toEqual([{ orden: "x", motivo: "supera_capacidad" }]);
  });
});

describe("builders: van antes, y son los últimos en quedarse fuera", () => {
  it("dos órdenes iguales: la del builder se entrega primero, aunque entrara después", () => {
    const e = entradaDe(
      [orden("mostrador", { entrada: "2026-01-05 0700", destino: punto(10) }), orden("builder", { entrada: "2026-01-05 0900", destino: punto(10, 1), builder: true })],
      [chofer("c1", { vuelveABase: false })],
    );
    expect(secuencia(planifica(e), "c1").filter((s) => s.startsWith("D"))).toEqual(["D:builder", "D:mostrador"]);
  });

  it("cuando no cabe todo, se queda fuera el mostrador, no el builder", () => {
    // El turno da para una sola; la del mostrador entró antes y es la más cercana.
    const ordenes = [orden("mostrador", { entrada: "2026-01-05 0700", destino: punto(90) }), orden("builder", { entrada: "2026-01-05 0900", destino: punto(95), builder: true })];
    const plan = planifica(entradaDe(ordenes, [chofer("c1", { salida: 480 + 240, capacidad: 1 })]));
    expect(plan.sinAsignar.map((s) => s.orden)).toEqual(["mostrador"]);
    expect(choferDe(plan, "builder")).toBe("c1");
  });
});

describe("los pesos de arranque, y que se pueden cambiar", () => {
  it("su orden: un minuto de builder pesa más que uno de manejo, este más que uno tarde, y este más que uno de desequilibrio", () => {
    const uno = (campo: "builder" | "manejoMin" | "tardeMin" | "balanceMin") =>
      costeTotal({ builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, [campo]: 1 }, PESOS_POR_DEFECTO);
    expect(uno("builder")).toBeGreaterThan(uno("manejoMin"));
    expect(uno("manejoMin")).toBeGreaterThan(uno("tardeMin"));
    expect(uno("tardeMin")).toBeGreaterThan(uno("balanceMin"));
    expect(uno("balanceMin")).toBeGreaterThan(0);
  });

  it("las millas cuentan por sí solas: a igual tiempo, gana el camino con menos millas", () => {
    expect(costeTotal({ builder: 0, manejoMin: 0, millas: 1, tardeMin: 0, balanceMin: 0 }, PESOS_POR_DEFECTO)).toBeGreaterThan(0);
    // Dos choferes a los mismos minutos de todo; uno va por autopista (más millas para el mismo tiempo).
    const bases = { autopista: punto(0, 1), calles: punto(0, -1) };
    const e = entradaDe([orden("a", { destino: punto(20) })], [chofer("por-autopista", { base: bases.autopista }), chofer("por-calles", { base: bases.calles })]);
    for (const [b, factor] of [[bases.autopista, 3], [bases.calles, 1]] as const) {
      e.matriz[b][punto(0)] = { minutos: 5, millas: 2 * factor };
      e.matriz[punto(20)][b] = { minutos: 20, millas: 12 * factor };
    }
    expect(choferDe(planifica(e), "a")).toBe("por-calles");
    // Sin peso de millas empatan en todo, y el empate cae en el primero por nombre.
    expect(choferDe(planifica(e, con({ pesos: { millas: 0 } })), "a")).toBe("por-autopista");
  });

  // La tienda en 0, el mostrador a 20 y el builder MÁS ALLÁ, en la misma calle. Ir primero al builder es
  // un desvío: `lejos - 20` minutos de más. Lo que se gana es lo que tarda la entrega del mostrador (15).
  const dosEnLaMismaCalle = (lejos: number) => entradaDe(
    [orden("mostrador", { destino: punto(20), servicioEntregaMin: 15 }), orden("builder", { destino: punto(lejos), builder: true })],
    [chofer("c1", { vuelveABase: false })],
  );
  const entregas = (plan: Plan) => secuencia(plan, "c1").filter((s) => s.startsWith("D"));

  it("un desvío de 10 minutos para adelantar a un builder SÍ se hace", () => {
    const plan = planifica(dosEnLaMismaCalle(30));
    expect(entregas(plan)).toEqual(["D:builder", "D:mostrador"]);
    expect(plan.rutas[0].manejoMin).toBe(40);   // 30 de ir + 10 de volver; en el otro orden serían 30
  });

  it("uno de 90, NO", () => {
    const plan = planifica(dosEnLaMismaCalle(110));
    expect(entregas(plan)).toEqual(["D:mostrador", "D:builder"]);
    expect(plan.rutas[0].manejoMin).toBe(110);  // al revés serían 200
  });

  it("y lo decide el peso, no el código: con el peso del builder a cero, el de 10 tampoco se hace", () => {
    expect(entregas(planifica(dosEnLaMismaCalle(30), con({ pesos: { builder: 0 } })))).toEqual(["D:mostrador", "D:builder"]);
    expect(entregas(planifica(dosEnLaMismaCalle(110), con({ pesos: { builder: 50 } })))).toEqual(["D:builder", "D:mostrador"]);
  });

  // Ruta corta por delante de la ventana ancha: el orden natural llega 8 min tarde; adelantarla son 20 de manejo.
  const anchaAlFondo = entradaDe(
    [orden("ancha", { destino: punto(30), ventana: [480, 532] }), orden("otra", { destino: punto(10) })],
    [chofer("c1", { vuelveABase: false })],
  );

  it("la ruta corta va antes que la ventana ancha: acepta 8 minutos tarde antes que 20 más de manejo", () => {
    const plan = planifica(anchaAlFondo);
    expect(entregas(plan)).toEqual(["D:otra", "D:ancha"]);
    expect(plan.coste.tardeMin).toBe(8);
  });

  it("y eso también es un peso: subiéndolo, llega a tiempo", () => {
    const plan = planifica(anchaAlFondo, con({ pesos: { tarde: 10 } }));
    expect(entregas(plan)).toEqual(["D:ancha", "D:otra"]);
    expect(plan.coste.tardeMin).toBe(0);
  });

  it("el balance reparte cuando el manejo empata, y solo entonces", () => {
    const dosChoferes = [chofer("c1"), chofer("c2")];
    const juntos = (plan: Plan) => choferDe(plan, "a") === choferDe(plan, "b");
    // Una a cada lado de la tienda: llevarlas uno solo o uno cada uno son los mismos 40 minutos de manejo.
    const opuestas = entradaDe([orden("a", { destino: punto(10) }), orden("b", { destino: punto(-10) })], dosChoferes);
    expect(juntos(planifica(opuestas))).toBe(false);
    expect(planifica(opuestas).coste.balanceMin).toBe(0);
    // Sin peso de balance, el empate lo rompe el día más corto: una sola visita a la tienda.
    expect(juntos(planifica(opuestas, con({ pesos: { balance: 0 } })))).toBe(true);
    // Las dos hacia el mismo lado: repartir son 20 minutos más de manejo, y el balance no los compra.
    const vecinas = entradaDe([orden("a", { destino: punto(10, 1) }), orden("b", { destino: punto(10, -1) })], dosChoferes);
    expect(juntos(planifica(vecinas))).toBe(true);
    expect(planifica(vecinas).coste.balanceMin).toBeGreaterThan(0);
  });
});

describe("determinismo", () => {
  const ordenes = Array.from({ length: 12 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, {
    origen: punto(k % 3 === 0 ? 0 : 60), destino: punto((k * 17) % 90, (k * 7) % 11), pallets: 1 + (k % 4) * 1.25,
    builder: k % 5 === 0, entrada: `2026-01-05 08${String(k).padStart(2, "0")}`,
    ventana: k % 4 === 0 ? [480, 660] : null, estrecha: k % 8 === 0,
  }));
  const choferes = [chofer("c1"), chofer("c2", { base: punto(60) }), chofer("c3", { base: punto(60), capacidad: 6 })];

  it("la misma entrada, el mismo plan", () => {
    const e = entradaDe(ordenes, choferes);
    expect(planifica(e)).toEqual(planifica(e));
  });

  it("y no depende del orden en que lleguen las órdenes ni los choferes", () => {
    const e = entradaDe(ordenes, choferes);
    const barajada = { ...e, ordenes: [...ordenes].reverse(), choferes: [choferes[2], choferes[0], choferes[1]] };
    const a = planifica(e), b = planifica(barajada);
    esValido(a, e);
    expect(b).toEqual(a);
  });

  it("a igualdad de todo, la que entró primero va primero; sin fecha de entrada, detrás", () => {
    const iguales = (ids: [string, string | null][]) => entradaDe(ids.map(([id, entrada]) => orden(id, { entrada, codigo: id })), [chofer("c1")]);
    expect(secuencia(planifica(iguales([["z", "2026-01-05 0700"], ["a", "2026-01-05 0900"]])), "c1").filter((s) => s.startsWith("D"))).toEqual(["D:z", "D:a"]);
    expect(secuencia(planifica(iguales([["a", null], ["z", "2026-01-05 0900"]])), "c1").filter((s) => s.startsWith("D"))).toEqual(["D:z", "D:a"]);
    // Y sin fecha ninguna de las dos, por CÓDIGO — con los ids al revés, para que no sea el id quien decida.
    const porCodigo = entradaDe([orden("id-1", { entrada: null, codigo: "B-200" }), orden("id-2", { entrada: null, codigo: "A-100" })], [chofer("c1")]);
    expect(secuencia(planifica(porCodigo), "c1").filter((s) => s.startsWith("D"))).toEqual(["D:id-2", "D:id-1"]);
    // Y sin código tampoco, por id.
    const porId = entradaDe([orden("id-2", { entrada: null, codigo: null }), orden("id-1", { entrada: null, codigo: null })], [chofer("c1")]);
    expect(secuencia(planifica(porId), "c1").filter((s) => s.startsWith("D"))).toEqual(["D:id-1", "D:id-2"]);
  });

  it("no hay azar ni reloj en el motor", () => {
    const dir = join(process.cwd(), "src/lib/route-engine");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const codigo = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      expect(codigo, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|setTimeout|fetch\(|supabase/);
    }
  });
});

describe("explicar", () => {
  const e = entradaDe(
    [orden("a", { destino: punto(10) }), orden("b", { origen: punto(100), destino: punto(95), builder: true }), orden("c", { destino: punto(14) })],
    [chofer("cerca", { base: punto(0) }), chofer("lejos", { base: punto(100) })],
  );
  const plan = planifica(e);

  it("cada orden dice qué aporta al coste, término a término, y cuadra con el total", () => {
    esValido(plan, e);
    const ex = plan.explicaciones.find((x) => x.orden === "b")!;
    expect(ex.chofer).toBe("lejos");
    expect(ex.aporta.manejoMin).toBe(10);
    expect(ex.aporta.builder).toBeGreaterThan(0);
    for (const x of plan.explicaciones) {
      expect(x.aporta.total).toBe(costeTotal(x.aporta, PESOS_POR_DEFECTO));
    }
  });

  it("y cuánto costaría llevarla con otro, desglosado: se ve qué término decidió", () => {
    const alt = plan.explicaciones.find((x) => x.orden === "a")!.alternativas;
    expect(alt.map((x) => x.chofer)).toEqual(["lejos"]);
    const d = alt[0].diferencia!;
    expect(d.manejoMin).toBeGreaterThan(0);
    expect(d.millas).toBeGreaterThan(0);
    expect(d.total).toBe(costeTotal(d, PESOS_POR_DEFECTO));
  });

  it("en un plan que convergió, ninguna alternativa es mejor que lo elegido", () => {
    expect(plan.convergio).toBe(true);
    for (const x of plan.explicaciones) for (const a of x.alternativas) if (a.diferencia) expect(a.diferencia.total).toBeGreaterThanOrEqual(0);
  });

  it("la diferencia es contra el plan ELEGIDO, no contra el plan sin la orden", () => {
    const p = planifica(entradaDe([orden("a")], [chofer("cerca"), chofer("lejos", { base: punto(100) })]));
    expect(choferDe(p, "a")).toBe("cerca");
    expect(p.coste.manejoMin).toBe(20);
    // Con el otro: 100 de ir a la tienda, 10 de entregar y 90 de volver = 200. La diferencia son 180, no 200.
    expect(p.explicaciones[0].alternativas[0].diferencia!.manejoMin).toBe(180);
    expect(p.explicaciones[0].aporta.manejoMin).toBe(20);
  });

  it("si con el otro no se puede, dice por qué", () => {
    const p = planifica(entradaDe([orden("a", { pallets: 8 })], [chofer("grande", { capacidad: 10 }), chofer("chico", { capacidad: 2, base: punto(3) })]));
    expect(choferDe(p, "a")).toBe("grande");
    expect(p.explicaciones[0].alternativas).toEqual([{ chofer: "chico", diferencia: null, motivo: "capacidad" }]);
  });
});

describe("lo que una ruta hecha a mano puede incumplir, y la evaluación lo dice", () => {
  const m = matrizDe([punto(0), punto(10)]);

  it("recoger y no entregar", () => {
    const r = evaluaPlan({ secuencias: { c1: [{ orden: "a", tipo: "P" }] }, ordenes: [orden("a")], choferes: [chofer("c1")], matriz: m });
    expect(r.violaciones.map((v) => [v.tipo, v.orden, v.detalle])).toEqual([["precedencia", "a", "se recoge y no se entrega"]]);
  });

  it("llevarla con un chofer distinto del que fijó el despachador", () => {
    const sec: ParadaRef[] = [{ orden: "a", tipo: "P" }, { orden: "a", tipo: "D" }];
    const r = evaluaPlan({ secuencias: { c1: sec }, ordenes: [orden("a", { choferFijado: "c2" })], choferes: [chofer("c1"), chofer("c2")], matriz: m });
    expect(r.violaciones.map((v) => [v.tipo, v.chofer, v.orden])).toEqual([["chofer_distinto_del_fijado", "c1", "a"], ["chofer_distinto_del_fijado", "c1", "a"]]);
  });

  it("un tramo que la matriz no trae NO vale cero: se dice, y el motor no planifica sobre él", () => {
    const sinVuelta: Matriz = { [punto(0)]: { [punto(10)]: { minutos: 10, millas: 6 } }, [punto(10)]: {} };
    const sec: ParadaRef[] = [{ orden: "a", tipo: "P" }, { orden: "a", tipo: "D" }];
    const r = evaluaPlan({ secuencias: { c1: sec }, ordenes: [orden("a")], choferes: [chofer("c1")], matriz: sinVuelta });
    expect(r.violaciones.map((v) => v.tipo)).toEqual(["sin_tiempo_de_viaje"]);
    const sinIda: Matriz = { [punto(0)]: {}, [punto(10)]: { [punto(0)]: { minutos: 10, millas: 6 } } };
    expect(evaluaPlan({ secuencias: { c1: sec }, ordenes: [orden("a")], choferes: [chofer("c1")], matriz: sinIda }).violaciones.map((v) => [v.tipo, v.orden]))
      .toEqual([["sin_tiempo_de_viaje", "a"]]);
    expect(planifica({ ordenes: [orden("a")], choferes: [chofer("c1")], matriz: sinIda }).sinAsignar).toEqual([{ orden: "a", motivo: "sin_punto" }]);
  });
});

describe("cada mecanismo del motor decide algo", () => {
  // Pesos escritos aquí, no los de por defecto: estas pruebas fijan el ALGORITMO, y no deben moverse el
  // día que alguien afine un peso en Ajustes.
  const fijos = con({ pesos: { builder: 2, manejo: 1, millas: 0.5, tarde: 0.75, balance: 0.1 }, topeTardeAnchaMin: 60, recargaMinimaMin: 20, maxMovimientos: 2000 });
  const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };

  /** Instancias pequeñas de un generador fijo (no es azar: la misma semilla da siempre lo mismo). Las
   *  semillas de abajo salieron de recorrer 400 y quedarse con aquellas donde cada mecanismo cambia el
   *  resultado: quitando la búsqueda local empeoraban 99; el intercambio, 33; el arrepentimiento, 50; y el
   *  reintento, 1 — pero esa una es una orden que se quedaba sin ruta. */
  function instancia(semilla: number): Entrada {
    const r = serie(semilla);
    const tiendas = [punto(0, 0), punto(40, 0)];
    const n = 4 + Math.floor(r() * 3);
    // El ORDEN de las llamadas a r() es parte de la instancia: no reordenar estos campos.
    const ordenes = Array.from({ length: n }, (_, k) => {
      const origen = tiendas[Math.floor(r() * 2)];
      const destino = punto(Math.floor(r() * 60) - 10, Math.floor(r() * 40) - 20);
      const pallets = 1 + Math.floor(r() * 5);
      const builder = r() < 0.3;
      const ventana: [number, number] | null = r() < 0.4 ? [480, 560 + Math.floor(r() * 200)] : null;
      const estrecha = r() < 0.5;
      return orden(`o${k}`, { entrada: `2026-01-05 08${String(k).padStart(2, "0")}`, origen, destino, pallets, builder, ventana, estrecha, servicioRecogidaMin: 5, servicioEntregaMin: 10 });
    });
    const choferes = [0, 1].map((k) => chofer(`c${k}`, { base: tiendas[k], capacidad: 6, salida: 480 + 200 + Math.floor(r() * 120) }));
    return entradaDe(ordenes, choferes);
  }

  it("la búsqueda local mejora lo que dejó la construcción", () => {
    const e = instancia(6);
    const entero = planifica(e, fijos), soloConstruccion = planifica(e, { ...fijos, maxMovimientos: 0 });
    esValido(entero, e);
    expect(entero.movimientos).toBe(3);
    expect(soloConstruccion.convergio).toBe(false);
    expect([entero.coste.total, soloConstruccion.coste.total]).toEqual([23360000, 30320000]);
  });

  it("intercambiar dos órdenes entre dos choferes encuentra lo que recolocar una sola no ve", () => {
    const e = instancia(28);
    const plan = planifica(e, fijos);
    esValido(plan, e);
    expect([plan.coste.total, plan.sinAsignar.length]).toEqual([66620000, 0]);
  });

  it("colocar primero la que más perdería si espera (arrepentimiento), no la primera que llega", () => {
    const e = instancia(13);
    const plan = planifica(e, fijos);
    esValido(plan, e);
    expect([plan.coste.total, plan.sinAsignar.length]).toEqual([31880000, 0]);
  });

  it("lo que quedó fuera se reintenta cuando la mejora abre un hueco: nadie se queda sin ruta", () => {
    const e = instancia(272);
    const plan = planifica(e, fijos);
    esValido(plan, e);
    expect(plan.sinAsignar).toEqual([]);
    expect(planifica(e, { ...fijos, maxMovimientos: 0 }).sinAsignar).toHaveLength(1);
  });

  it("a igual coste gana la ruta que acaba antes: no se espera a una ventana pudiendo entregar otra mientras", () => {
    // Las dos van al mismo sitio, así que el manejo es idéntico en cualquier orden. «espera» entró primero
    // pero su ventana abre a las 10:00; entregar antes la otra no cuesta nada y el día acaba 10 minutos antes.
    const e = entradaDe([orden("espera", { entrada: "2026-01-05 0700", ventana: [600, 720] }), orden("otra", { entrada: "2026-01-05 0900" })], [chofer("c1")]);
    const plan = planifica(e, { ...fijos, maxMovimientos: 0 });
    expect(secuencia(plan, "c1")).toEqual(["P:espera", "P:otra", "D:otra", "D:espera"]);
    expect(plan.rutas[0].fin).toBe(620);
  });

  it("al construir, dos órdenes de la misma tienda se cargan en UNA visita, sin esperar a la mejora", () => {
    const plan = planifica(entradaDe([orden("a"), orden("b", { destino: punto(12) })], [chofer("c1")]), { ...fijos, maxMovimientos: 0 });
    expect(plan.rutas[0].paradas.map((p) => `${p.tipo}${p.visita}`)).toEqual(["P1", "P1", "D2", "D3"]);
  });
});

describe("el tope de cómputo", () => {
  // Un generador fijo, no azar: la misma lista siempre.
  const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };

  it("60 órdenes y 10 choferes: plan válido, dentro del presupuesto", () => {
    const r = serie(7);
    const tiendas = [punto(0, 0), punto(60, 0), punto(0, 60), punto(60, 60)];
    const ordenes = Array.from({ length: 60 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, {
      origen: tiendas[Math.floor(r() * 4)], destino: punto(Math.floor(r() * 70), Math.floor(r() * 70) + 100),
      pallets: Math.round((0.5 + r() * 5) * 100) / 100, builder: r() < 0.3, entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`,
      ventana: r() < 0.3 ? [480, 480 + 120 + Math.floor(r() * 400)] : null,
    }));
    const choferes = Array.from({ length: 10 }, (_, k) => chofer(`c${k}`, { base: tiendas[k % 4], capacidad: 8 + (k % 3) * 2 }));
    const e = entradaDe(ordenes, choferes);
    const t0 = process.hrtime.bigint();
    const plan = planifica(e);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    esValido(plan, e);
    expect(plan.rutas.flatMap((x) => x.paradas).length + 2 * plan.sinAsignar.length).toBe(120);
    // Medido: ~1,2 s en la máquina donde se escribió (2026-09-18); el diseño pide menos de 2 s. El tope de
    // la prueba es holgado a propósito: CI es más lento, y esto caza una regresión de orden de magnitud.
    expect(ms).toBeLessThan(8000);
  }, 60000);

  it("se corta por número de movimientos y lo dice; el plan cortado sigue siendo válido", () => {
    const ordenes = Array.from({ length: 10 }, (_, k) => orden(`o${k}`, { origen: punto(k % 2 ? 0 : 50), destino: punto((k * 13) % 60, k), pallets: 2, builder: k % 3 === 0 }));
    const e = entradaDe(ordenes, [chofer("c1"), chofer("c2", { base: punto(50) })]);
    const entero = planifica(e);
    expect(entero.convergio).toBe(true);
    const cortado = planifica(e, con({ maxMovimientos: 0 }));
    esValido(cortado, e);
    expect(cortado.movimientos).toBe(0);
    // Solo dice «no convergió» si de verdad había algo que mejorar.
    expect(cortado.convergio).toBe(entero.movimientos === 0);
    expect(cortado.coste.total).toBeGreaterThanOrEqual(entero.coste.total);
  });
});
