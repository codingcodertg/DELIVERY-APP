import { describe, expect, it } from "vitest";
import { planifica, type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Plan } from "@/lib/route-engine";
import {
  ETAPAS_RUTEABLES, ROUTE_PUBLISHED_KIND, avisosAlPublicar, escriturasAlPublicar, firmaDeRuta, ordenDeLaParte, textoDelAviso,
} from "./publicar";

/** Publicar una ruta: lo que se decide, sin red ni base (D-NEXT). Planes de verdad, salidos del motor, sobre una
 *  calle inventada donde un minuto es una manzana. */

const punto = (x: number) => `${x},0`;
function matrizDe(puntos: string[]): Matriz {
  const m: Matriz = {};
  for (const a of puntos) { m[a] = {}; for (const b of puntos) if (a !== b) { const d = Math.abs(Number(a.split(",")[0]) - Number(b.split(",")[0])); m[a][b] = { minutos: d, millas: d * 0.6 }; } }
  return m;
}
const orden = (id: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada =>
  ({ id, codigo: id, entrada: "2026-01-05 0800", origen: punto(0), destino: punto(10), pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra });
const chofer = (id: string, nombre: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada =>
  ({ id, nombre, base: punto(0), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true, ...extra });
function planDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Plan {
  const puntos = new Set<string>([...ordenes.flatMap((o) => [o.origen!, o.destino!]), ...choferes.map((c) => c.base)]);
  const e: Entrada = { ordenes, choferes, matriz: matrizDe([...puntos]) };
  return planifica(e);
}

describe("qué escribe publicar en cada orden", () => {
  const choferes = [chofer("id-1", "Chofer Uno")];

  it("el NOMBRE del chofer, el viaje y la posición de la entrega dentro del viaje — y `load_auto`", () => {
    const plan = planDe([orden("a", { destino: punto(10) }), orden("b", { destino: punto(20) })], choferes);
    expect(escriturasAlPublicar(plan, choferes)).toEqual([
      { id: "a", assigned_driver: "Chofer Uno", load_no: 1, route_seq: 0, load_auto: true },
      { id: "b", assigned_driver: "Chofer Uno", load_no: 1, route_seq: 1, load_auto: true },
    ]);
  });

  it("cuando el camión se vacía y vuelve a cargar, es otro viaje, y la posición vuelve a empezar", () => {
    const plan = planDe([orden("a", { pallets: 6, destino: punto(10) }), orden("b", { pallets: 6, destino: punto(12) })], choferes);
    const e = escriturasAlPublicar(plan, choferes);
    expect(e.map((x) => [x.load_no, x.route_seq]).sort()).toEqual([[1, 0], [2, 0]]);
  });

  it("vaciarse en la ÚLTIMA entrega no abre un viaje que no existe", () => {
    const plan = planDe([orden("a")], choferes);
    expect(escriturasAlPublicar(plan, choferes)).toEqual([{ id: "a", assigned_driver: "Chofer Uno", load_no: 1, route_seq: 0, load_auto: true }]);
  });

  it("una orden partida en cargas es UNA fila: se queda con el viaje y la posición de su primera entrega", () => {
    const plan = planDe([orden("grande", { pallets: 25 })], choferes);
    expect(Object.keys(plan.partes)).toEqual(["grande"]);
    expect(escriturasAlPublicar(plan, choferes)).toEqual([{ id: "grande", assigned_driver: "Chofer Uno", load_no: 1, route_seq: 0, load_auto: true }]);
    expect([ordenDeLaParte("grande#b"), ordenDeLaParte("sin-partir")]).toEqual(["grande", "sin-partir"]);
  });

  it("lo que quedó sin asignar no se escribe, y un chofer que no está en la lista tampoco", () => {
    const plan = planDe([orden("cabe"), orden("no-cabe", { destino: punto(900) })], [chofer("id-1", "Chofer Uno", { salida: 600 })]);
    expect(plan.sinAsignar.map((s) => s.orden)).toEqual(["no-cabe"]);
    expect(escriturasAlPublicar(plan, choferes).map((x) => x.id)).toEqual(["cabe"]);
    expect(escriturasAlPublicar(plan, [])).toEqual([]);
  });

  it("cada chofer con lo suyo", () => {
    const dos = [chofer("id-1", "Chofer Uno", { base: punto(0) }), chofer("id-2", "Chofer Dos", { base: punto(100) })];
    const plan = planDe([orden("oeste", { destino: punto(8) }), orden("este", { origen: punto(100), destino: punto(108) })], dos);
    expect(escriturasAlPublicar(plan, dos).map((x) => [x.id, x.assigned_driver])).toEqual([["este", "Chofer Dos"], ["oeste", "Chofer Uno"]]);
  });
});

describe("qué órdenes entran a un plan", () => {
  it("las etapas ruteables son las cuatro del Gestor de Rutas", () => {
    expect([...ETAPAS_RUTEABLES]).toEqual(["pending", "approved", "fulfilling", "ready"]);
  });
});

describe("a quién se avisa: un aviso por chofer, no uno por orden", () => {
  const dos = [chofer("id-1", "Chofer Uno", { base: punto(0) }), chofer("id-2", "Chofer Dos", { base: punto(100) })];
  const catorce = Array.from({ length: 14 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, { origen: punto(k % 2 ? 100 : 0), destino: punto((k % 2 ? 100 : 0) + 3 + k) }));

  it("la primera vez, a cada chofer con paradas: 14 órdenes a 2 choferes son 2 avisos", () => {
    const plan = planDe(catorce, dos);
    expect(plan.sinAsignar).toEqual([]);
    const avisos = avisosAlPublicar(plan, null);
    expect(avisos.map((a) => [a.chofer, a.motivo])).toEqual([["id-1", "nueva"], ["id-2", "nueva"]]);
    expect(avisos.reduce((s, a) => s + a.paradas, 0)).toBe(28);
    expect(avisos[0].primeraSalida).toBe(480);
  });

  it("al re-publicar lo mismo, NINGUNO — aunque cambien las horas", () => {
    const plan = planDe(catorce, dos);
    const masTarde: Plan = { ...plan, rutas: plan.rutas.map((r) => ({ ...r, paradas: r.paradas.map((p) => ({ ...p, llegada: p.llegada + 7, salida: p.salida + 7 })) })) };
    expect(avisosAlPublicar(masTarde, plan)).toEqual([]);
  });

  it("solo a quien le cambió la lista o el orden; y a quien se quedó sin paradas, que se quedó", () => {
    const antes = planDe(catorce, dos);
    const conUnaMas = planDe([...catorce, orden("nueva", { destino: punto(40) })], dos);
    expect(avisosAlPublicar(conUnaMas, antes).map((a) => [a.chofer, a.motivo])).toEqual([["id-1", "cambio"]]);
    const soloElOeste = planDe(catorce.filter((o) => o.origen === punto(0)), dos);
    expect(avisosAlPublicar(soloElOeste, antes).map((a) => [a.chofer, a.motivo, a.paradas])).toEqual([["id-2", "sin_ruta", 0]]);
    // Y si el chofer ya ni aparece en el plan nuevo.
    const sinElDos: Plan = { ...soloElOeste, rutas: soloElOeste.rutas.filter((r) => r.chofer !== "id-2") };
    expect(avisosAlPublicar(sinElDos, antes).map((a) => [a.chofer, a.motivo])).toEqual([["id-2", "sin_ruta"]]);
  });

  it("un chofer sin paradas —ni antes ni ahora, esté o no en el plan nuevo— no recibe nada", () => {
    const p = (chofer: string, n: number) => ({ chofer, paradas: Array.from({ length: n }, (_, k) => ({ tipo: "D" as const, orden: `o${k}`, llegada: 500 })) });
    // «vacio» está en los dos planes sin paradas; «ido» estaba, sin paradas, y ya no está.
    expect(avisosAlPublicar({ rutas: [p("con", 2), p("vacio", 0)] }, { rutas: [p("con", 2), p("vacio", 0), p("ido", 0)] })).toEqual([]);
    expect(avisosAlPublicar({ rutas: [p("con", 2), p("vacio", 0)] }, null).map((a) => a.chofer)).toEqual(["con"]);
  });

  it("el mismo juego de paradas en otro orden SÍ es un cambio", () => {
    const plan = planDe([orden("a", { destino: punto(10) }), orden("b", { destino: punto(20) })], [dos[0]]);
    const alReves: Plan = { ...plan, rutas: plan.rutas.map((r) => ({ ...r, paradas: [...r.paradas].reverse() })) };
    expect(firmaDeRuta(plan.rutas[0])).toBe("P:a>P:b>D:a>D:b");
    expect(avisosAlPublicar(alReves, plan).map((a) => a.motivo)).toEqual(["cambio"]);
  });

  it("el texto dice cuántas paradas y a qué hora la primera; una sola parada, en singular", () => {
    expect(ROUTE_PUBLISHED_KIND).toBe("route_published");
    expect(textoDelAviso({ chofer: "x", motivo: "nueva", paradas: 6, primeraSalida: 485 }, "2026-01-06")).toBe("Your route for 2026-01-06 is ready: 6 stops, first stop 08:05");
    expect(textoDelAviso({ chofer: "x", motivo: "cambio", paradas: 1, primeraSalida: null }, "2026-01-06")).toBe("Your route for 2026-01-06 changed: 1 stop");
    expect(textoDelAviso({ chofer: "x", motivo: "sin_ruta", paradas: 0, primeraSalida: null }, "2026-01-06")).toBe("Your route for 2026-01-06 changed: you have no stops now");
  });
});
