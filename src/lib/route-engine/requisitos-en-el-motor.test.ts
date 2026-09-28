import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  faltanEnElCamion, parteOrdenesGrandes, planifica, VERSION_DEL_MOTOR,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Plan,
} from "./index";

/**
 * Requisitos del camión en «Planificar el día» (D-418, OptimoRoute `skills` / `vehicleFeatures`). El dueño, 2026-09-27:
 * *«solos haz 1 3 y 4»*. Misma cuadrícula que `prioridad-y-reparto.test.ts`: de «x,y» a «x',y'» se tarda |dx|+|dy|
 * minutos. Nada es real.
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
const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id || p.orden.startsWith(`${id}#`)))?.chofer ?? null;

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

describe("sin requisitos, el motor planifica EXACTAMENTE lo mismo que antes", () => {
  it("el día grabado da el plan de motor-1 byte a byte, aunque los camiones declaren cosas", () => {
    expect(huella(planifica(diaGrabado()))).toBe(HUELLA_DE_MOTOR_1);
    expect(huella(planifica(diaGrabado(undefined, (k) => ({ habilidades: k % 2 ? ["Liftgate"] : [] }))))).toBe(HUELLA_DE_MOTOR_1);
    expect(huella(planifica(diaGrabado(() => ({ requisitos: [] }))))).toBe(HUELLA_DE_MOTOR_1);
  });

  it("y si TODOS los camiones tienen lo que piden, también: el requisito no quita a nadie", () => {
    const todos = diaGrabado((k) => (k % 3 === 0 ? { requisitos: ["liftgate "] } : {}), () => ({ habilidades: ["Liftgate", "Montacargas"] }));
    expect(huella(planifica(todos))).toBe(HUELLA_DE_MOTOR_1);
  });

  it("la versión pasó a motor-3 con los requisitos, a motor-4 con las zonas (D-421) y a motor-5 con el umbral de zona (D-NEXT)", () => {
    expect(VERSION_DEL_MOTOR).toBe("motor-5");
  });
});

describe("una orden solo va con un chofer cuyo camión lo tiene todo", () => {
  it("la de liftgate va con el del liftgate aunque le quede más lejos", () => {
    // Choferes en 0 y en 100; la orden sale y se entrega cerca del de 0. Sin requisito iría con él.
    const o = orden("L", { origen: punto(0), destino: punto(10) });
    const cerca = chofer("cerca", { base: punto(0) }), lejos = chofer("lejos", { base: punto(100) });
    const e = (req?: string[], hab?: string[]) => {
      const x = entradaDe([{ ...o, ...(req ? { requisitos: req } : {}) }], [cerca, { ...lejos, ...(hab ? { habilidades: hab } : {}) }]);
      x.matriz = matrizDe([punto(0), punto(10), punto(100)]);
      return x;
    };
    expect(choferDe(planifica(e()), "L")).toBe("cerca");
    const plan = planifica(e(["Liftgate"], ["LIFTGATE"]));
    expect(choferDe(plan, "L")).toBe("lejos");
    expect(plan.sinAsignar).toEqual([]);
  });

  it("si ninguno lo tiene, queda fuera con `falta_requisito` y dice qué le falta al que menos le falta", () => {
    const plan = planifica(entradaDe(
      [orden("A", { requisitos: ["Liftgate", "Montacargas"] }), orden("B")],
      [chofer("uno", { habilidades: ["Liftgate"] }), chofer("dos")],
    ));
    expect(plan.sinAsignar).toEqual([{ orden: "A", motivo: "falta_requisito", faltan: ["Montacargas"] }]);
    expect(choferDe(plan, "B")).not.toBeNull();
  });

  it("«¿por qué aquí?»: con el que no lo tiene, dice `falta_requisito` y qué; con el que sí, sus cuentas", () => {
    const plan = planifica(entradaDe(
      [orden("A", { requisitos: ["Liftgate"] })],
      [chofer("uno", { habilidades: ["Liftgate"] }), chofer("dos", { habilidades: ["Montacargas"] }), chofer("tres", { habilidades: ["Liftgate"] })],
    ));
    const e = plan.explicaciones.find((x) => x.orden === "A")!;
    const dos = e.alternativas.find((a) => a.chofer === "dos")!;
    expect(dos).toEqual({ chofer: "dos", diferencia: null, motivo: "falta_requisito", faltan: ["Liftgate"] });
    const otro = e.alternativas.find((a) => a.chofer !== "dos")!;
    expect(otro.diferencia).not.toBeNull();
  });

  it("el chofer que fijó una persona se respeta aunque su camión no lo tenga (el motor no deshace lo de nadie)", () => {
    const plan = planifica(entradaDe([orden("A", { requisitos: ["Liftgate"], choferFijado: "dos" })], [chofer("uno", { habilidades: ["Liftgate"] }), chofer("dos")]));
    expect(choferDe(plan, "A")).toBe("dos");
    expect(plan.sinAsignar).toEqual([]);
    // Y con los demás, lo que manda es que está atada a su chofer, no el camión.
    const fijada = planifica(entradaDe([orden("A", { requisitos: ["Liftgate"], choferFijado: "uno" })], [chofer("uno", { habilidades: ["Liftgate"] }), chofer("dos")]));
    expect(fijada.explicaciones[0].alternativas).toEqual([{ chofer: "dos", diferencia: null, motivo: "no_permitido" }]);
  });

  it("una orden grande se parte por el camión MÁS GRANDE DE LOS QUE LO TIENEN", () => {
    const o = orden("G", { pallets: 12, requisitos: ["Liftgate"] });
    const { partes } = parteOrdenesGrandes([o], [chofer("grande", { capacidad: 20 }), chofer("chico", { capacidad: 5, habilidades: ["Liftgate"] })]);
    expect(partes.G).toEqual(["G#a", "G#b", "G#c"]);
    // Sin requisito, cabe entera en el grande.
    expect(parteOrdenesGrandes([{ ...o, requisitos: [] }], [chofer("grande", { capacidad: 20 }), chofer("chico", { capacidad: 5 })]).partes).toEqual({});
  });

  it("faltanEnElCamion compara sin mayúsculas ni espacios de más", () => {
    expect(faltanEnElCamion(chofer("x", { habilidades: [" dos  personas ", "LIFTGATE"] }), orden("o", { requisitos: ["Dos personas", "Liftgate", "Montacargas"] }))).toEqual(["Montacargas"]);
    expect(faltanEnElCamion(chofer("x"), orden("o"))).toEqual([]);
  });

  it("en 300 días inventados, ninguna orden con requisitos acaba con un chofer que no los tiene", () => {
    const CATALOGO = ["Liftgate", "Montacargas", "Grande"];
    let conRequisito = 0, fuera = 0;
    for (let dia = 0; dia < 300; dia++) {
      const r = serie(1000 + dia);
      const choferes = Array.from({ length: 3 }, (_, k) => chofer(`c${k}`, {
        base: punto(k * 20), habilidades: CATALOGO.filter(() => r() < 0.5), capacidad: 6 + Math.floor(r() * 6),
      }));
      const ordenes = Array.from({ length: 6 }, (_, k) => orden(`d${dia}o${k}`, {
        origen: punto(Math.floor(r() * 3) * 20), destino: punto(Math.floor(r() * 60), Math.floor(r() * 30)),
        pallets: 1 + Math.floor(r() * 4), requisitos: CATALOGO.filter(() => r() < 0.3),
      }));
      const plan = planifica(entradaDe(ordenes, choferes));
      for (const o of ordenes) {
        if (o.requisitos!.length) conRequisito++;
        const c = choferDe(plan, o.id);
        if (!c) { fuera++; continue; }
        expect(faltanEnElCamion(choferes.find((x) => x.id === c)!, o)).toEqual([]);
      }
      for (const s of plan.sinAsignar.filter((x) => x.motivo === "falta_requisito")) {
        const o = ordenes.find((x) => x.id === s.orden)!;
        expect(choferes.every((c) => faltanEnElCamion(c, o).length > 0)).toBe(true);
      }
    }
    // El barrido mide algo: hay órdenes con requisitos, y algunas quedan fuera por ellos.
    expect(conRequisito).toBeGreaterThan(400);
    expect(fuera).toBeGreaterThan(0);
  });
});
