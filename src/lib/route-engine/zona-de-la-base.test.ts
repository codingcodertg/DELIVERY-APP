import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import CASO from "./zona-base-caso-real.json";
import {
  costeTotal, entregaFueraDeZona, evaluaPlan, PARAMETROS_POR_DEFECTO, pesoDeRecogida, PESO_DE_ZONA_RECOGIDA_POR_DEFECTO, planifica,
  puntasFueraDeZona, recogidaFueraDeZona, TOLERANCIA_DE_PASO, VERSION_DEL_MOTOR, zonasReclamadas,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Parametros, type Plan,
} from "./index";
import { pesoDeZonaRecogida, pesosDeRuta } from "@/lib/route-settings";
import { entradaDelDia, type DatosDelDia } from "@/lib/route-plan/entrada";

/**
 * La recogida en la tienda de la zona de otro chofer es la punta CARA (D-NEXT, `motor-8`). El dueño, 2026-10-06, con el
 * borrador de ese día: *«it giving ernesto an djulio trips to brownville and then it gives pharr to max and he is from
 * brownsville»*.
 *
 * Con `motor-7` la recogida y la entrega costaban lo mismo (60): una orden que sale de la tienda de Brownsville y va a una
 * ciudad de Ernesto o de Julio costaba una punta con cualquiera de los tres, y decidían el builder y el balance. Y una orden
 * que sale de Pharr hacia una ciudad que no es de nadie (Edcouch) no costaba ninguna punta, ni al de Brownsville. Ahora la
 * recogida en la tienda de otro cuesta `zonaRecogida` (120 por defecto) y cuenta siempre que la tienda tenga dueño.
 */

type Caso = { tiendaDeC: string; entrada: Entrada };
const DIA = (CASO as unknown as Caso);
/** Lo que llevaba «Armar rutas» ese día: los pesos de Ajustes (los de por defecto) y «lo que está de paso». */
const ARMAR: Parametros = { ...PARAMETROS_POR_DEFECTO, dePaso: TOLERANCIA_DE_PASO };
const conPesos = (p: Partial<Parametros["pesos"]>): Parametros => ({ ...ARMAR, pesos: { ...ARMAR.pesos, ...p } });
/** Por chofer, las tiendas donde recoge. */
const recogeEn = (plan: Plan, entrada: Entrada): Record<string, string[]> => {
  const ord = new Map(entrada.ordenes.map((o) => [o.id, o]));
  return Object.fromEntries(plan.rutas.map((r) => [r.chofer, r.paradas.filter((p) => p.tipo === "P").map((p) => ord.get(p.orden.split("#")[0])!.origen!)]));
};

describe("el día de la queja: 2026-10-06, real y anonimizado", () => {
  it("con motor-8, a la tienda de C (Brownsville) solo va C; A solo carga en la suya; y no queda nada fuera ni roto", () => {
    expect(VERSION_DEL_MOTOR).toBe("motor-8");
    const plan = planifica(DIA.entrada, ARMAR);
    const r = recogeEn(plan, DIA.entrada);
    expect(plan.sinAsignar).toEqual([]);
    expect(plan.violaciones).toEqual([]);
    expect(r.A.length + r.B.length + r.C.length).toBe(DIA.entrada.ordenes.length);
    expect(r.A.every((t) => t === "t1")).toBe(true);
    expect(r.B).not.toContain(DIA.tiendaDeC);
    // Las cuatro órdenes de la tienda de C, con C (dos vueltas: 19 pallets en un camión de 10).
    expect(r.C.filter((t) => t === DIA.tiendaDeC).length).toBe(DIA.entrada.ordenes.filter((o) => o.origen === DIA.tiendaDeC).length);
    expect(plan.coste.recogidasFueraDeZona).toBe(1);
  });

  it("con la recogida al precio de la entrega (el peso en 0), A o B vuelven a bajar a la tienda de C: lo que vio el dueño", () => {
    const plan = planifica(DIA.entrada, conPesos({ zonaRecogida: 0 }));
    const r = recogeEn(plan, DIA.entrada);
    expect([...r.A, ...r.B]).toContain(DIA.tiendaDeC);
    expect(plan.coste.recogidasFueraDeZona).toBeGreaterThan(1);
  });
});

describe("las dos puntas, por separado", () => {
  const J = { zonas: ["Norte"] }, M = { zonas: ["Sur"] };
  const recl = zonasReclamadas([J, M]);

  it("la entrega cuenta si su ciudad es de otro; la recogida, si su tienda está en la zona de otro y no está hecha", () => {
    expect(entregaFueraDeZona(J, { zona: "Sur" }, recl)).toBe(1);
    expect(entregaFueraDeZona(M, { zona: "Sur" }, recl)).toBe(0);
    expect(recogidaFueraDeZona(J, { zonaRecogida: "Sur" }, recl)).toBe(1);
    expect(recogidaFueraDeZona(J, { zonaRecogida: "Sur", recogidaHecha: true }, recl)).toBe(0);
    expect(recogidaFueraDeZona(J, { zonaRecogida: "Norte" }, recl)).toBe(0);
    expect(recogidaFueraDeZona({ zonas: [] }, { zonaRecogida: "Sur" }, recl)).toBe(0);
    expect(entregaFueraDeZona({}, { zona: "Sur" }, recl)).toBe(0);
  });

  it("desde motor-8 la recogida cuenta aunque la entrega vaya a una ciudad que no es de nadie", () => {
    expect(puntasFueraDeZona(J, { zona: "Pueblo", zonaRecogida: "Sur" }, recl)).toBe(1);
    expect(puntasFueraDeZona(M, { zona: "Pueblo", zonaRecogida: "Sur" }, recl)).toBe(0);
  });

  it("la entrega cuesta `zona` y la recogida `zonaRecogida` (120 por defecto; con 0, lo mismo que la entrega)", () => {
    expect(PESO_DE_ZONA_RECOGIDA_POR_DEFECTO).toBe(120);
    const d = { builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0, fueraDeZona: 3, recogidasFueraDeZona: 1 };
    const pesos = { ...PARAMETROS_POR_DEFECTO.pesos, zona: 60 };
    expect(costeTotal(d, pesos)).toBe((2 * 60 + 120) * 100_000);
    expect(costeTotal(d, { ...pesos, zonaRecogida: 200 })).toBe((2 * 60 + 200) * 100_000);
    expect(costeTotal(d, { ...pesos, zonaRecogida: 0 })).toBe(3 * 60 * 100_000);
    expect(pesoDeRecogida({ zona: 45, zonaRecogida: 0 })).toBe(45);
    expect(pesoDeRecogida({ zona: 0, zonaRecogida: 200 })).toBe(0);   // zonas apagadas: tampoco la recogida
    // Un desglose guardado antes (sin la clave): todo a `zona`, como entonces.
    expect(costeTotal({ ...d, recogidasFueraDeZona: undefined }, pesos)).toBe(3 * 60 * 100_000);
  });

  it("evaluar una ruta separa la recogida de la entrega, y el plan las suma", () => {
    const e = entradaDe([orden("o", { origen: punto(40), destino: punto(10), zona: "Sur", zonaRecogida: "Sur" })], [chofer("J", { zonas: ["Norte"] }), chofer("M", { zonas: ["Sur"] })]);
    const conJ = evaluaPlan({ ...e, secuencias: { J: [{ orden: "o", tipo: "P" }, { orden: "o", tipo: "D" }] } });
    expect(conJ.rutas.find((r) => r.chofer === "J")).toMatchObject({ fueraDeZona: 2, recogidasFueraDeZona: 1 });
    expect(conJ.rutas.find((r) => r.chofer === "M")).toMatchObject({ fueraDeZona: 0, recogidasFueraDeZona: 0 });
    expect(conJ.coste).toMatchObject({ fueraDeZona: 2, recogidasFueraDeZona: 1 });
  });
});

// ---- La cuadrícula ----------------------------------------------------------------------------------------------------

/** De «x,y» a «x',y'» se tarda |dx|+|dy| minutos, y una milla son 2 minutos. */
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
function orden(id: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada {
  return { id, codigo: id, entrada: "2026-01-05 0800", origen: punto(0), destino: punto(10), pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra };
}
function chofer(id: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada {
  return { id, nombre: id, base: punto(0), capacidad: 20, entrada: 480, salida: 1080, vuelveABase: true, ...extra };
}
function entradaDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Entrada {
  const puntos = new Set<string>();
  for (const o of ordenes) { if (o.origen) puntos.add(o.origen); if (o.destino) puntos.add(o.destino); }
  for (const c of choferes) puntos.add(c.base);
  return { ordenes, choferes, matriz: matrizDe([...puntos]) };
}
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id))?.chofer ?? null;

describe("la regla, en la cuadrícula", () => {
  /**
   * La tienda de la zona de M (Sur) está en x=40; M sale de su casa en x=80, J de x=0. Una orden sale de la tienda Sur hacia
   * x=5, un pueblo que no es de nadie. Con J son unos 94 minutos-equivalentes menos (70 min de manejo, 35 mi y el balance):
   * por eficiencia, J. Pero J tendría que ir a la tienda de la zona de M.
   */
  const e = entradaDe([orden("o", { origen: punto(40), destino: punto(5), zona: "Pueblo", zonaRecogida: "Sur" })],
    [chofer("J", { base: punto(0), zonas: ["Norte"] }), chofer("M", { base: punto(80), zonas: ["Sur"] })]);
  const p = (pesos: Partial<Parametros["pesos"]>): Parametros => ({ ...PARAMETROS_POR_DEFECTO, pesos: { ...PARAMETROS_POR_DEFECTO.pesos, ...pesos } });

  it("con el peso de por defecto (120) la carga M, el de esa tienda; y «por qué aquí» dice que con J sería una recogida fuera", () => {
    const plan = planifica(e, p({}));
    expect(choferDe(plan, "o")).toBe("M");
    expect(plan.explicaciones[0].alternativas.find((x) => x.chofer === "J")!.diferencia).toMatchObject({ fueraDeZona: 1, recogidasFueraDeZona: 1 });
  });

  it("con la recogida a 60 (lo que pesaba en motor-7) gana la eficiencia: J", () => {
    expect(choferDe(planifica(e, p({ zonaRecogida: 60 })), "o")).toBe("J");
    expect(choferDe(planifica(e, p({ zonaRecogida: 0 })), "o")).toBe("J");
  });

  it("con las zonas apagadas (`zona` en 0) no cuenta ninguna punta, tampoco la recogida", () => {
    const plan = planifica(e, p({ zona: 0 }));
    expect(choferDe(plan, "o")).toBe("J");
  });

  it("preferencia, no regla: si M no puede (sin turno), la lleva J", () => {
    const sinM = { ...e, choferes: e.choferes.map((c) => (c.id === "M" ? { ...c, salida: 481 } : c)) };
    const plan = planifica(sinM, p({}));
    expect(plan.sinAsignar).toEqual([]);
    expect(choferDe(plan, "o")).toBe("J");
  });
});

// ---- De Ajustes al motor ----------------------------------------------------------------------------------------------

describe("Ajustes: el peso se guarda en `route_weights.zonaRecogida` y llega al motor", () => {
  it("se lee de `route_weights`; si falta o no es un número ≥ 0, el de por defecto", () => {
    expect(pesosDeRuta({ route_weights: { zonaRecogida: 200 } as never }).zonaRecogida).toBe(200);
    expect(pesosDeRuta({ route_weights: { zonaRecogida: -1 } as never }).zonaRecogida).toBeUndefined();
    expect(pesoDeZonaRecogida({ route_weights: null })).toBe(120);
    expect(pesoDeZonaRecogida({ route_weights: { zonaRecogida: 0 } as never })).toBe(0);
  });

  it("«Armar rutas» lo pasa al motor (entradaDelDia → parametros.pesos)", () => {
    const datos = (rw: object | null): DatosDelDia => ({
      ordenes: [], choferes: [], ajustesDeChofer: [], publicadoAntes: [],
      settings: { stores: [], accounts: [], order_type_rules: {}, route_buckets: [], driver_capacity: {}, default_truck_capacity: null, route_weights: rw, route_hard_windows: null, route_late_cap_min: null } as unknown as DatosDelDia["settings"],
    });
    expect(entradaDelDia(datos({ zonaRecogida: 30 })).parametros.pesos.zonaRecogida).toBe(30);
    expect(entradaDelDia(datos(null)).parametros.pesos.zonaRecogida).toBeUndefined();
  });

  it("la tarjeta del motor enseña el peso y lo guarda con su clave", () => {
    const s = readFileSync(join(process.cwd(), "src/components/RouteEngineSettings.tsx"), "utf8");
    expect(s).toContain("const zonaRecogida = pesoDeZonaRecogida(settings);");
    expect(s).toContain('value={zonaRecogida} paso="10" disabled={!hayColumnas} onSave={(v) => guardaPeso("zonaRecogida", v)} />');
    expect(s).toContain("5 · Zona preferida (por recogida en la tienda de la zona de otro chofer)");
    expect(s).toContain("La recogida cuenta siempre, también cuando la entrega va a una ciudad que no es zona de nadie");
  });
});
