import { describe, expect, it } from "vitest";
import { PARAMETROS_POR_DEFECTO, evaluaPlan, parteOrdenesGrandes, planifica, type ChoferEntrada, type Matriz, type OrdenEntrada, type Plan } from "@/lib/route-engine";
import { etiquetaDeEntrega, secuenciaPD } from "@/lib/secuencia-pd";
import { escriturasAlPublicar, ordenDeLaParte, type EscrituraDeOrden } from "./publicar";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cambiosTrasPublicar, filasDelViaje, lecturaDeLaRuta, sigueElPlan,type OrdenAsignada, type ParadaDelPlanMinima } from "./lectura-de-ruta";

/** Las etiquetas P/D cuando hay un plan publicado (D-335). Planes de verdad, evaluados por el motor, en una calle inventada. */

const punto = (x: number) => `${x},0`;
function matrizDe(xs: number[]): Matriz {
  const m: Matriz = {};
  for (const a of xs) { m[punto(a)] = {}; for (const b of xs) if (a !== b) m[punto(a)][punto(b)] = { minutos: Math.abs(a - b), millas: Math.abs(a - b) * 0.6 }; }
  return m;
}
const orden = (id: string, origen: number, destino: number, extra: Partial<OrdenEntrada> = {}): OrdenEntrada =>
  ({ id, codigo: id, entrada: "2026-01-05 0800", origen: punto(origen), destino: punto(destino), pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra });
const chofer: ChoferEntrada = { id: "c1", nombre: "Chofer Uno", base: punto(0), capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true };
const LUGAR: Record<string, string> = { [punto(0)]: "Tienda A", [punto(10)]: "Tienda B" };

/** Las paradas como las guarda `route_plan_stops` / las devuelve `my_published_stops`. */
const guardadas = (plan: Pick<Plan, "rutas">): ParadaDelPlanMinima[] =>
  plan.rutas[0].paradas.map((p, seq) => ({ kind: p.tipo, order_ref: p.orden, seq, label: p.etiqueta, load_after: p.cargaAlSalir, place: LUGAR[p.punto] ?? null }));
/** Las órdenes como quedan en `deliveries` tras publicar, agrupadas en viajes como las pinta la pantalla. */
function trasPublicar(plan: Pick<Plan, "rutas">, tiendaDe: Record<string, string>): OrdenAsignada[][] {
  const w = [...escriturasAlPublicar(plan, [chofer])].sort((a, b) => a.load_no - b.load_no || a.route_seq - b.route_seq);
  const viajes: OrdenAsignada[][] = [];
  for (const x of w) (viajes[x.load_no - 1] ??= []).push({ id: x.id, store: tiendaDe[x.id], est_pallets: 1, load_no: x.load_no, route_seq: x.route_seq });
  return viajes.filter(Boolean);
}

// El ejemplo del dueño: se recoge x (Tienda A), se recoge y (Tienda B), se entrega y ANTES que x.
const XS = [0, 10, 12, 30];
const ORDENES = [orden("x", 0, 30), orden("y", 10, 12)];
const TIENDA = { x: "Tienda A", y: "Tienda B" };
const delDueno = evaluaPlan({ secuencias: { c1: [{ orden: "x", tipo: "P" }, { orden: "y", tipo: "P" }, { orden: "y", tipo: "D" }, { orden: "x", tipo: "D" }] }, ordenes: ORDENES, choferes: [chofer], matriz: matrizDe(XS) });

describe("el hueco, reproducido", () => {
  it("para la MISMA orden, el plan y la lectura derivada de lo que ese plan escribió dan etiquetas distintas", () => {
    expect(delDueno.violaciones).toEqual([]);
    expect(delDueno.rutas[0].paradas.map((p) => `${p.etiqueta}:${p.orden}`)).toEqual(["P1:x", "P2:y", "D2:y", "D1:x"]);
    const derivada = etiquetaDeEntrega(secuenciaPD(trasPublicar(delDueno, TIENDA).map((v) => v.map((o) => ({ id: o.id, store: o.store ?? null, pallets: 1 })))));
    expect([...derivada]).toEqual([["y", "D1"], ["x", "D2"]]);              // el plan dice y = D2, x = D1
  });
});

describe("si la ruta sigue siendo la que el plan publicó, manda el plan", () => {
  const paradas = guardadas(delDueno);
  const viajes = trasPublicar(delDueno, TIENDA);

  it("las etiquetas son las del plan, y las recogidas salen DONDE el motor las puso", () => {
    const l = lecturaDeLaRuta(viajes, paradas);
    expect([l.fuente, l.cambioTrasPublicar]).toEqual(["plan", false]);
    expect([...l.etiquetaDe]).toEqual([["y", "D2"], ["x", "D1"]]);
    expect(l.previas.get("y")!.map((f) => [f.tipo, f.etiquetas.join("·"), f.lugar, f.aBordo])).toEqual([["P", "P1", "Tienda A", 1], ["P", "P2", "Tienda B", 2]]);
    expect(l.previas.get("x")).toEqual([]);
    expect(l.alFinal).toEqual([]);
  });

  it("un plan que INTERCALA (recoge a media ruta) se enseña intercalado, no con todas las recogidas delante", () => {
    const intercalado = evaluaPlan({ secuencias: { c1: [{ orden: "x", tipo: "P" }, { orden: "x", tipo: "D" }, { orden: "y", tipo: "P" }, { orden: "y", tipo: "D" }] }, ordenes: [orden("x", 0, 5), orden("y", 10, 12)], choferes: [chofer], matriz: matrizDe([0, 5, 10, 12]) });
    const l = lecturaDeLaRuta(trasPublicar(intercalado, TIENDA), guardadas(intercalado));
    expect(l.fuente).toBe("plan");
    expect(["x", "y"].map((id) => l.previas.get(id)!.map((f) => f.etiquetas.join("·")))).toEqual([["P1"], ["P2"]]);
  });

  it("recogidas seguidas en el MISMO sitio son una sola fila, como una parada física", () => {
    const juntas = evaluaPlan({ secuencias: { c1: [{ orden: "x", tipo: "P" }, { orden: "z", tipo: "P" }, { orden: "z", tipo: "D" }, { orden: "x", tipo: "D" }] }, ordenes: [orden("x", 0, 30), orden("z", 0, 12)], choferes: [chofer], matriz: matrizDe(XS) });
    const l = lecturaDeLaRuta(trasPublicar(juntas, { x: "Tienda A", z: "Tienda A" }), guardadas(juntas));
    expect(l.previas.get("z")!.map((f) => [f.etiquetas.join("·"), f.ordenes, f.lugar, f.aBordo])).toEqual([["P1·P2", ["x", "z"], "Tienda A", 2]]);
  });

  it("un cambio de ETAPA no es tocar la ruta: sigue mandando el plan", () => {
    const enCamino = viajes.map((v) => v.map((o) => ({ ...o, stage: "picked_up" })));
    expect(lecturaDeLaRuta(enCamino, paradas).fuente).toBe("plan");
  });

  it("una orden repartida en cargas lleva TODAS sus etiquetas en su fila, y la entrega de la otra carga sale como fila informativa", () => {
    const grande = [orden("g", 0, 20, { pallets: 15 }), orden("h", 0, 25)];
    const plan = planifica({ ordenes: grande, choferes: [chofer], matriz: matrizDe([0, 20, 25]) }, PARAMETROS_POR_DEFECTO);
    expect(plan.sinAsignar).toEqual([]);
    const partes = plan.rutas[0].paradas.filter((p) => p.tipo === "D" && ordenDeLaParte(p.orden) === "g");
    expect(partes.length).toBeGreaterThan(1);
    const l = lecturaDeLaRuta(trasPublicar(plan, { g: "Tienda A", h: "Tienda A" }), guardadas(plan));
    expect(l.fuente).toBe("plan");
    expect(l.etiquetaDe.get("g")).toBe(partes.map((p) => p.etiqueta).join("·"));
    const informativas = [...l.previas.values(), l.alFinal].flat().filter((f) => f.tipo === "D");
    expect(informativas.map((f) => f.ordenes[0])).toEqual(partes.slice(1).map(() => "g"));
  });
});

describe("el orden en que se PINTAN las filas de un viaje", () => {
  const pinta = (l: ReturnType<typeof lecturaDeLaRuta>, viajes: OrdenAsignada[][]) =>
    viajes.map((v, ti) => filasDelViaje(l, v, ti === viajes.length - 1).map((f) => f.clase === "informa" ? f.fila.etiquetas.join("·") : `${l.etiquetaDe.get(f.orden.id)}#${f.indice}`));

  it("un plan que recoge A MEDIA RUTA, en un solo viaje, se pinta así: la recogida justo antes de su entrega — no en cabeza", () => {
    // x sigue a bordo todo el rato: el camión no se vacía, así que es UN viaje. y se recoge después de entregar z.
    const P = (o: string) => ({ orden: o, tipo: "P" as const }), D = (o: string) => ({ orden: o, tipo: "D" as const });
    const plan = evaluaPlan({ secuencias: { c1: [P("x"), P("z"), D("z"), P("y"), D("y"), D("x")] }, ordenes: [orden("x", 0, 30), orden("z", 0, 5), orden("y", 10, 12)], choferes: [chofer], matriz: matrizDe([0, 5, 10, 12, 30]) });
    expect(plan.violaciones).toEqual([]);
    const viajes = trasPublicar(plan, { x: "Tienda A", z: "Tienda A", y: "Tienda B" });
    expect(viajes.length).toBe(1);
    expect(pinta(lecturaDeLaRuta(viajes, guardadas(plan)), viajes)).toEqual([["P1·P2", "D2#0", "P3", "D3#1", "D1#2"]]);
  });
  it("lo del final va tras la última entrega, y solo en el ÚLTIMO viaje; sin lectura, solo las órdenes", () => {
    const l = { ...lecturaDeLaRuta([], null), alFinal: [{ tipo: "D" as const, etiquetas: ["D9"], ordenes: ["g"], lugar: null, aBordo: 0, sinConteo: false }] };
    const clases = (ultimo: boolean) => filasDelViaje(l, [{ id: "a" }], ultimo).map((f) => f.clase);
    expect([clases(true), clases(false)]).toEqual([["orden", "informa"], ["orden"]]);
    expect(filasDelViaje(null, [{ id: "a" }, { id: "b" }], true).map((f) => f.clase === "orden" && f.indice)).toEqual([0, 1]);
  });
});

describe("lo que el plan deja tras la última entrega de la lista", () => {
  it("la segunda carga de una orden repartida, entregada al final, no se pierde: sale en `alFinal`", () => {
    const partes = parteOrdenesGrandes([orden("g", 0, 20, { pallets: 15 }), orden("h", 0, 25)], [chofer]).ordenes;
    const [ga, gb] = partes.filter((o) => o.id.startsWith("g#")).map((o) => o.id);
    expect([ga, gb]).toEqual(["g#a", "g#b"]);
    const P = (o: string) => ({ orden: o, tipo: "P" as const }), D = (o: string) => ({ orden: o, tipo: "D" as const });
    const plan = evaluaPlan({ secuencias: { c1: [P(ga), D(ga), P("h"), D("h"), P(gb), D(gb)] }, ordenes: partes, choferes: [chofer], matriz: matrizDe([0, 20, 25]) });
    const l = lecturaDeLaRuta(trasPublicar(plan, { g: "Tienda A", h: "Tienda A" }), guardadas(plan));
    expect(l.fuente).toBe("plan");
    expect(l.alFinal.map((f) => [f.tipo, f.ordenes[0], f.etiquetas.join("·")])).toEqual([["P", "g", plan.rutas[0].paradas[4].etiqueta], ["D", "g", plan.rutas[0].paradas[5].etiqueta]]);
    expect(l.etiquetaDe.get("g")).toBe(`${plan.rutas[0].paradas[1].etiqueta}·${plan.rutas[0].paradas[5].etiqueta}`);
  });
});

describe("si alguien tocó la ruta después de publicar, manda la lectura derivada — y se avisa", () => {
  const paradas = guardadas(delDueno);
  const viajes = trasPublicar(delDueno, TIENDA);
  const derivada = (v: OrdenAsignada[][]) => { const l = lecturaDeLaRuta(v, paradas); return [l.fuente, l.cambioTrasPublicar, [...l.etiquetaDe]]; };

  it("OTRO ORDEN, con las mismas órdenes: ya no es la ruta publicada", () => {
    const alReves = [[{ ...viajes[0][1], route_seq: 0 }, { ...viajes[0][0], route_seq: 1 }]];
    expect(sigueElPlan(paradas, alReves.flat())).toBe(false);
    expect(derivada(alReves)).toEqual(["derivada", true, [["x", "D1"], ["y", "D2"]]]);
  });
  it("una orden MÁS, una MENOS, o cambiada de VIAJE", () => {
    const extra: OrdenAsignada = { id: "z", store: "Tienda A", est_pallets: 1, load_no: 1, route_seq: 2 };
    expect(derivada([[...viajes[0], extra]]).slice(0, 2)).toEqual(["derivada", true]);
    expect(derivada([[viajes[0][0]]]).slice(0, 2)).toEqual(["derivada", true]);
    // Cambiada de viaje CONSERVANDO su puesto: lo único que difiere es `load_no`.
    expect(viajes[0][1].route_seq).toBe(1);
    expect(derivada([[viajes[0][0]], [{ ...viajes[0][1], load_no: 2 }]]).slice(0, 2)).toEqual(["derivada", true]);
  });
  it("una orden sin puesto (`route_seq` nulo) no coincide con ningún plan", () => {
    expect(sigueElPlan(paradas, viajes[0].map((o) => ({ ...o, route_seq: null })))).toBe(false);
  });
  it("derivada: las recogidas del viaje van delante de su primera entrega, como en D-334", () => {
    const l = lecturaDeLaRuta([[{ ...viajes[0][1], route_seq: 0 }, { ...viajes[0][0], route_seq: 1 }]], paradas);
    expect(l.previas.get("x")!.map((f) => `${f.etiquetas.join("·")} — ${f.lugar}`)).toEqual(["P1 — Tienda A", "P2 — Tienda B"]);
    expect(l.previas.get("y")).toEqual([]);
  });
});

describe("sin plan publicado, todo sigue como en D-334", () => {
  const viajes: OrdenAsignada[][] = [[{ id: "a", store: "Tienda A", est_pallets: 1, load_no: 1, route_seq: 0 }, { id: "b", store: "Tienda B", est_pallets: 1, load_no: 1, route_seq: 1 }]];
  it("`null` o sin paradas: derivada, y SIN aviso — no hay plan con el que comparar", () => {
    for (const p of [null, []]) { const l = lecturaDeLaRuta(viajes, p); expect([l.fuente, l.cambioTrasPublicar, [...l.etiquetaDe]]).toEqual(["derivada", false, [["a", "D1"], ["b", "D2"]]]); }
  });
  it("sin órdenes no hay nada que leer, con plan o sin él", () => {
    expect(lecturaDeLaRuta([], guardadas(delDueno))).toMatchObject({ fuente: "derivada", cambioTrasPublicar: true });
    expect([...lecturaDeLaRuta([], null).etiquetaDe]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
/** La implementación de ANTES del refactor, copiada tal cual: la vara con la que se mide que publicar escribe lo mismo. */
function escriturasDeAntes(plan: Pick<Plan, "rutas">, choferes: readonly { id: string; nombre: string }[]): EscrituraDeOrden[] {
  const nombreDe = new Map(choferes.map((c) => [c.id, c.nombre]));
  const escrituras = new Map<string, EscrituraDeOrden>();
  for (const r of plan.rutas) {
    const nombre = nombreDe.get(r.chofer);
    if (!nombre) continue;
    let viaje = 1, posicion = 0;
    r.paradas.forEach((p) => {
      if (p.tipo === "D") {
        const id = ordenDeLaParte(p.orden);
        if (!escrituras.has(id)) escrituras.set(id, { id, assigned_driver: nombre, load_no: viaje, route_seq: posicion, load_auto: true });
        posicion++;
        if (p.cargaAlSalir === 0) { viaje++; posicion = 0; }
      }
    });
  }
  return [...escrituras.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

describe("el refactor no cambió lo que publicar escribe", () => {
  it("para planes de verdad —varios choferes, varios viajes, órdenes repartidas— la salida es IDÉNTICA a la de antes", () => {
    const dos = [chofer, { ...chofer, id: "c2", nombre: "Chofer Dos", base: punto(100) }];
    const casos: OrdenEntrada[][] = [
      ORDENES,
      Array.from({ length: 14 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, k % 2 ? 100 : 0, (k % 2 ? 100 : 0) + 3 + k, { pallets: 1 + (k % 4) })),
      [orden("g", 0, 20, { pallets: 25 }), orden("h", 0, 25, { pallets: 3 }), orden("i", 100, 110, { pallets: 9 })],
    ];
    let comparadas = 0;
    for (const ordenes of casos) {
      const xs = [...new Set(ordenes.flatMap((o) => [Number(o.origen!.split(",")[0]), Number(o.destino!.split(",")[0])]).concat([0, 100]))];
      const plan = planifica({ ordenes, choferes: dos, matriz: matrizDe(xs) }, PARAMETROS_POR_DEFECTO);
      const ahora = escriturasAlPublicar(plan, dos);
      expect(ahora).toEqual(escriturasDeAntes(plan, dos));
      comparadas += ahora.length;
    }
    expect(escriturasAlPublicar(delDueno, [chofer])).toEqual(escriturasDeAntes(delDueno, [chofer]));
    expect(comparadas).toBeGreaterThan(15);                       // que la igualdad no sea la de dos listas vacías
  });
});

// D-336: una ruta ordenada a medias. Medido el 2026-09-19: 0 de 8 rutas de la semana estaban así; es un hueco que fallaba callado.
describe("una ruta ordenada a medias", () => {
  const o = (id: string, route_seq: number | null): OrdenAsignada => ({ id, store: "Tienda A", est_pallets: 1, load_no: 1, route_seq });
  it("la orden SIN puesto no gasta número: D1, D2 seguidos, y no aparece en la recogida", () => {
    const l = lecturaDeLaRuta([[o("a", 0), o("suelta", null), o("b", 1)]], null);
    expect([...l.etiquetaDe]).toEqual([["a", "D1"], ["b", "D2"]]);
    expect(l.previas.get("a")?.[0]).toMatchObject({ etiquetas: ["P1", "P2"], ordenes: ["a", "b"], aBordo: 2 });
    expect(l.previas.has("suelta")).toBe(false);
  });
  it("si NINGUNA tiene puesto se numeran todas, como las enseña «Mi ruta»", () => {
    expect([...lecturaDeLaRuta([[o("a", null), o("b", null)]], null).etiquetaDe.values()]).toEqual(["D1", "D2"]);
  });
});

// D-341: EN QUÉ cambió la ruta tras publicar, para el aviso de «Mi ruta». El plan va escrito a mano y con los ids
// DESORDENADOS respecto al alfabeto (m, c, t, f), y las paradas llegan barajadas: nada aquí pasa «porque ya venía ordenado».
describe("en qué cambió la ruta desde que se publicó el plan", () => {
  const p = (seq: number, kind: "P" | "D", order_ref: string, load_after: number): ParadaDelPlanMinima => ({ kind, order_ref, seq, label: `${kind}${seq}`, load_after, place: null });
  // Dos viajes: [m, c] y [t, f]. El camión queda vacío tras entregar c.
  const enSuOrden = [p(0, "P", "m", 1), p(1, "P", "c", 2), p(2, "D", "m", 1), p(3, "D", "c", 0), p(4, "P", "t", 1), p(5, "P", "f", 2), p(6, "D", "t", 1), p(7, "D", "f", 0)];
  const paradas = [enSuOrden[6], enSuOrden[3], enSuOrden[0], enSuOrden[7], enSuOrden[2], enSuOrden[5], enSuOrden[1], enSuOrden[4]];
  const o = (id: string, load_no: number | null, route_seq: number | null): OrdenAsignada => ({ id, store: "Tienda A", est_pallets: 1, load_no, route_seq });
  const publicada = [o("m", 1, 0), o("c", 1, 1), o("t", 2, 0), o("f", 2, 1)];
  const NADA = { anadidas: [], quitadas: [], ordenCambiado: false, viajeCambiado: false };

  it("la ruta publicada, tal cual: `null` — y también sin plan con el que comparar", () => {
    expect(sigueElPlan(paradas, publicada)).toBe(true);
    expect(cambiosTrasPublicar(paradas, publicada)).toBeNull();
    expect(cambiosTrasPublicar(null, publicada)).toBeNull();
    expect(cambiosTrasPublicar([], publicada)).toBeNull();
  });
  it("una parada AÑADIDA en medio: se nombra, y no cuenta como reordenar las demás", () => {
    const hoy = [o("m", 1, 0), o("a", 1, 1), o("c", 1, 2), o("t", 2, 0), o("f", 2, 1)];
    expect(cambiosTrasPublicar(paradas, hoy)).toEqual({ ...NADA, anadidas: ["a"] });
  });
  it("paradas QUITADAS: salen en el orden del plan, y quitar la primera no es reordenar", () => {
    expect(cambiosTrasPublicar(paradas, [o("c", 1, 1), o("t", 2, 0), o("f", 2, 1)])).toEqual({ ...NADA, quitadas: ["m"] });
    expect(cambiosTrasPublicar(paradas, [o("t", 2, 0), o("c", 1, 1)])).toMatchObject({ quitadas: ["m", "f"], anadidas: [] });
    expect(cambiosTrasPublicar(paradas, [])).toEqual({ ...NADA, quitadas: ["m", "c", "t", "f"] });
  });
  it("las mismas paradas en OTRO ORDEN", () => {
    const hoy = [o("c", 1, 0), o("m", 1, 1), o("t", 2, 0), o("f", 2, 1)];
    expect(cambiosTrasPublicar(paradas, hoy)).toEqual({ ...NADA, ordenCambiado: true });
  });
  it("una parada cambiada de VIAJE sin cambiar el orden; y un `load_no` nulo es el viaje 1, no un viaje distinto", () => {
    expect(cambiosTrasPublicar(paradas, [o("m", 1, 0), o("c", 1, 1), o("t", 1, 2), o("f", 2, 1)])).toEqual({ ...NADA, viajeCambiado: true });
    expect(cambiosTrasPublicar(paradas, [o("m", null, 0), o("c", null, 1), o("f", 2, 0), o("t", 2, 1)])).toEqual({ ...NADA, ordenCambiado: true });
  });
  it("añadida, quitada y reordenada A LA VEZ", () => {
    expect(cambiosTrasPublicar(paradas, [o("f", 1, 0), o("z", 1, 1), o("m", 1, 2), o("c", 1, 3)])).toEqual({ anadidas: ["z"], quitadas: ["t"], ordenCambiado: true, viajeCambiado: true });
  });
  it("cambió pero sin pormenor que contar (mismo orden y viaje, puestos renumerados): se avisa igual, con el detalle vacío", () => {
    const renumerada = [o("m", 1, 1), o("c", 1, 2), o("t", 2, 1), o("f", 2, 2)];
    expect(sigueElPlan(paradas, renumerada)).toBe(false);
    expect(cambiosTrasPublicar(paradas, renumerada)).toEqual(NADA);
  });
  it("la lectura lleva ESE detalle, y `cambioTrasPublicar` dice lo mismo que él", () => {
    const hoy = [[o("c", 1, 0), o("m", 1, 1)], [o("t", 2, 0), o("f", 2, 1)]];
    const tocada = lecturaDeLaRuta(hoy, paradas), intacta = lecturaDeLaRuta([publicada.slice(0, 2), publicada.slice(2)], paradas), sinPlan = lecturaDeLaRuta(hoy, null);
    expect([tocada.cambioTrasPublicar, tocada.cambios]).toEqual([true, { ...NADA, ordenCambiado: true }]);
    expect([intacta.fuente, intacta.cambioTrasPublicar, intacta.cambios]).toEqual(["plan", false, null]);
    expect([sinPlan.cambioTrasPublicar, sinPlan.cambios]).toEqual([false, null]);
  });
});

describe("«Mi ruta» pinta el aviso de D-341", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/my-route/page.tsx"), "utf8").split("\r\n").join("\n");
  it("sale de `lectura.cambios`, con sus cuatro partes", () => {
    for (const trozo of ["{lectura.cambios && (", "lectura.cambios.anadidas.map(", "lectura.cambios.quitadas.map(", "{lectura.cambios.ordenCambiado && ", "{lectura.cambios.viajeCambiado && "]) expect(pagina).toContain(trozo);
  });
  it("va FUERA de la lista de paradas: también sale si al chofer le quitaron todas", () => {
    const aviso = pagina.indexOf("{lectura.cambios && ("), lista = pagina.indexOf("{stops.length === 0 ? (");
    expect(aviso).toBeGreaterThan(-1);
    expect(lista).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(lista);
  });
});
