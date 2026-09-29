import { describe, expect, it } from "vitest";
import { PARAMETROS_POR_DEFECTO, evaluaPlan, parteOrdenesGrandes, planifica, type ChoferEntrada, type Matriz, type OrdenEntrada, type Plan } from "@/lib/route-engine";
import { escriturasAlPublicar, ordenDeLaParte, posicionesPorViajeHistoricas } from "./publicar";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cambiosTrasPublicar, esProvisional, esProvisionalLaFila, lecturaDeLaRuta, sigueElPlan, type LecturaDeRuta, type OrdenAsignada, type ParadaDelPlanMinima } from "./lectura-de-ruta";

/**
 * Cómo se LEE la ruta de un chofer (D-335; una sola lista desde D-443). Planes de verdad, evaluados por el motor, en una
 * calle inventada.
 */

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
/** Las órdenes como quedan en `deliveries` tras publicar (D-443: puesto seguido y posición de la recogida). Sin la 154
 *  (`conRecogida` falso) la base no guarda la recogida: la clave ni siquiera viene. */
function trasPublicar(plan: Pick<Plan, "rutas">, tiendaDe: Record<string, string>, conRecogida = true): OrdenAsignada[] {
  return [...escriturasAlPublicar(plan, [chofer])].sort((a, b) => a.route_seq - b.route_seq)
    .map((x) => ({ id: x.id, store: tiendaDe[x.id], est_pallets: 1, load_no: null, route_seq: x.route_seq, ...(conRecogida ? { pickup_seq: x.pickup_seq ?? null } : {}) }));
}
const pinta = (l: LecturaDeRuta) => l.filas.map((f) => f.etiqueta);
const P = (o: string) => ({ orden: o, tipo: "P" as const }), D = (o: string) => ({ orden: o, tipo: "D" as const });

// El ejemplo del dueño: se recoge x (Tienda A), se recoge y (Tienda B), se entrega y ANTES que x.
const XS = [0, 10, 12, 30];
const ORDENES = [orden("x", 0, 30), orden("y", 10, 12)];
const TIENDA = { x: "Tienda A", y: "Tienda B" };
const delDueno = evaluaPlan({ secuencias: { c1: [P("x"), P("y"), D("y"), D("x")] }, ordenes: ORDENES, choferes: [chofer], matriz: matrizDe(XS) });

describe("el hueco de D-335, y cómo lo cierra la posición de la recogida (D-443)", () => {
  it("SIN la 154, la lectura de lo guardado no sabe dónde iba cada recogida: pone las del bloque delante, y numera distinto que el plan", () => {
    expect(delDueno.violaciones).toEqual([]);
    expect(delDueno.rutas[0].paradas.map((p) => `${p.etiqueta}:${p.orden}`)).toEqual(["P1:x", "P2:y", "D2:y", "D1:x"]);
    const l = lecturaDeLaRuta(trasPublicar(delDueno, TIENDA, false), 10, null);
    expect(pinta(l)).toEqual(["P1", "P2", "D1", "D2"]);
    expect([...l.etiquetaDe]).toEqual([["y", "D1"], ["x", "D2"]]);              // el plan dice y = D2, x = D1
  });
  it("CON la 154, lo guardado se lee IGUAL que el plan, sin mirar el plan: la recogida está donde el motor la puso", () => {
    const l = lecturaDeLaRuta(trasPublicar(delDueno, TIENDA), 10, null);
    expect(l.fuente).toBe("derivada");
    expect(pinta(l)).toEqual(["P1", "P2", "D2", "D1"]);
  });
});

describe("si la ruta sigue siendo la que el plan publicó, manda el plan", () => {
  const paradas = guardadas(delDueno);
  const ordenes = trasPublicar(delDueno, TIENDA);

  it("las etiquetas son las del plan, y las recogidas salen DONDE el motor las puso", () => {
    const l = lecturaDeLaRuta(ordenes, 10, paradas);
    expect([l.fuente, l.cambioTrasPublicar]).toEqual(["plan", false]);
    expect([...l.etiquetaDe]).toEqual([["y", "D2"], ["x", "D1"]]);
    expect(l.filas.map((f) => [f.tipo, f.etiqueta, f.tipo === "P" ? f.lugar : f.orden, f.cambio])).toEqual([
      ["P", "P1", "Tienda A", 1], ["P", "P2", "Tienda B", 1], ["D", "D2", "y", -1], ["D", "D1", "x", -1],
    ]);
  });
  it("también sin la 154: la ruta publicada se reconoce por el puesto de sus entregas, y manda el plan", () => {
    expect(lecturaDeLaRuta(trasPublicar(delDueno, TIENDA, false), 10, paradas).fuente).toBe("plan");
  });

  it("un plan que RECOGE A MEDIA RUTA se enseña así: la recogida justo antes de su entrega, en la misma lista", () => {
    // x sigue a bordo todo el rato; y se recoge después de entregar z.
    const plan = evaluaPlan({ secuencias: { c1: [P("x"), P("z"), D("z"), P("y"), D("y"), D("x")] }, ordenes: [orden("x", 0, 30), orden("z", 0, 5), orden("y", 10, 12)], choferes: [chofer], matriz: matrizDe([0, 5, 10, 12, 30]) });
    expect(plan.violaciones).toEqual([]);
    const tiendas = { x: "Tienda A", z: "Tienda A", y: "Tienda B" };
    const conPlan = lecturaDeLaRuta(trasPublicar(plan, tiendas), 10, guardadas(plan));
    expect(conPlan.fuente).toBe("plan");
    expect(pinta(conPlan)).toEqual(["P1", "P2", "D2", "P3", "D3", "D1"]);
    // Y lo guardado, leído sin el plan, dice lo mismo (con la 154).
    expect(pinta(lecturaDeLaRuta(trasPublicar(plan, tiendas), 10, null))).toEqual(["P1", "P2", "D2", "P3", "D3", "D1"]);
  });

  it("recogidas seguidas en el MISMO sitio van cada una en su fila (D-444; hasta ahí, una sola)", () => {
    const juntas = evaluaPlan({ secuencias: { c1: [P("x"), P("z"), D("z"), D("x")] }, ordenes: [orden("x", 0, 30), orden("z", 0, 12)], choferes: [chofer], matriz: matrizDe(XS) });
    const l = lecturaDeLaRuta(trasPublicar(juntas, { x: "Tienda A", z: "Tienda A" }), 10, guardadas(juntas));
    expect(l.filas.slice(0, 2)).toMatchObject([
      { tipo: "P", etiqueta: "P1", ordenes: ["x"], lugar: "Tienda A", cambio: 1, indice: 0 },
      { tipo: "P", etiqueta: "P2", ordenes: ["z"], lugar: "Tienda A", cambio: 1, indice: 1 },
    ]);
    expect(l.paradas.slice(0, 2)).toEqual([{ tipo: "P", ordenes: ["x"], tienda: "Tienda A" }, { tipo: "P", ordenes: ["z"], tienda: "Tienda A" }]);
  });

  it("un cambio de ETAPA no es tocar la ruta: sigue mandando el plan", () => {
    expect(lecturaDeLaRuta(ordenes.map((o) => ({ ...o, stage: "picked_up" })), 10, paradas).fuente).toBe("plan");
  });

  it("una orden repartida en cargas lleva TODAS sus etiquetas, y la entrega de la otra carga es una fila que no se mueve", () => {
    const grande = [orden("g", 0, 20, { pallets: 15 }), orden("h", 0, 25)];
    const plan = planifica({ ordenes: grande, choferes: [chofer], matriz: matrizDe([0, 20, 25]) }, PARAMETROS_POR_DEFECTO);
    expect(plan.sinAsignar).toEqual([]);
    const partes = plan.rutas[0].paradas.filter((p) => p.tipo === "D" && ordenDeLaParte(p.orden) === "g");
    expect(partes.length).toBeGreaterThan(1);
    const l = lecturaDeLaRuta(trasPublicar(plan, { g: "Tienda A", h: "Tienda A" }), 10, guardadas(plan));
    expect(l.fuente).toBe("plan");
    expect(l.etiquetaDe.get("g")).toBe(partes.map((p) => p.etiqueta).join("·"));
    const otras = l.filas.filter((f) => f.tipo === "D" && f.otraCarga);
    expect(otras.map((f) => (f.tipo === "D" ? [f.orden, f.indice] : null))).toEqual(partes.slice(1).map(() => ["g", null]));
    // Las paradas que se mueven llevan UNA entrega de g.
    expect(l.paradas.filter((p) => p.tipo === "D" && p.orden === "g").length).toBe(1);
  });

  it("la segunda carga de una orden repartida, entregada al final, no se pierde", () => {
    const partes = parteOrdenesGrandes([orden("g", 0, 20, { pallets: 15 }), orden("h", 0, 25)], [chofer]).ordenes;
    const [ga, gb] = partes.filter((o) => o.id.startsWith("g#")).map((o) => o.id);
    expect([ga, gb]).toEqual(["g#a", "g#b"]);
    const plan = evaluaPlan({ secuencias: { c1: [P(ga), D(ga), P("h"), D("h"), P(gb), D(gb)] }, ordenes: partes, choferes: [chofer], matriz: matrizDe([0, 20, 25]) });
    const l = lecturaDeLaRuta(trasPublicar(plan, { g: "Tienda A", h: "Tienda A" }), 10, guardadas(plan));
    expect(l.fuente).toBe("plan");
    expect(pinta(l).slice(-2)).toEqual([plan.rutas[0].paradas[4].etiqueta, plan.rutas[0].paradas[5].etiqueta]);
    expect(l.etiquetaDe.get("g")).toBe(`${plan.rutas[0].paradas[1].etiqueta}·${plan.rutas[0].paradas[5].etiqueta}`);
  });
});

describe("si alguien tocó la ruta después de publicar, manda lo guardado — y se avisa", () => {
  const paradas = guardadas(delDueno);
  const ordenes = trasPublicar(delDueno, TIENDA, false);
  const lee = (v: OrdenAsignada[]) => { const l = lecturaDeLaRuta(v, 10, paradas); return [l.fuente, l.cambioTrasPublicar, [...l.etiquetaDe]]; };

  it("OTRO ORDEN, con las mismas órdenes: ya no es la ruta publicada", () => {
    const alReves = [{ ...ordenes[1], route_seq: 0 }, { ...ordenes[0], route_seq: 1 }];
    expect(sigueElPlan(paradas, alReves)).toBe(false);
    expect(lee(alReves)).toEqual(["derivada", true, [["x", "D1"], ["y", "D2"]]]);
  });
  it("una orden MÁS o una MENOS", () => {
    const extra: OrdenAsignada = { id: "z", store: "Tienda A", est_pallets: 1, route_seq: 2 };
    expect(lee([...ordenes, extra]).slice(0, 2)).toEqual(["derivada", true]);
    expect(lee([ordenes[0]]).slice(0, 2)).toEqual(["derivada", true]);
  });
  it("con la 154, una RECOGIDA movida también es tocar la ruta (el puesto de las entregas es el mismo)", () => {
    const conRecogida = trasPublicar(delDueno, TIENDA);
    expect(sigueElPlan(paradas, conRecogida)).toBe(true);
    const movida = conRecogida.map((o) => (o.id === "y" ? { ...o, pickup_seq: 0.5 } : o));
    expect(sigueElPlan(paradas, movida)).toBe(false);
  });
  it("una orden sin puesto (`route_seq` nulo) no coincide con ningún plan", () => {
    expect(sigueElPlan(paradas, ordenes.map((o) => ({ ...o, route_seq: null })))).toBe(false);
  });
});

describe("sin plan publicado", () => {
  const ordenes: OrdenAsignada[] = [{ id: "a", store: "Tienda A", est_pallets: 1, route_seq: 0 }, { id: "b", store: "Tienda B", est_pallets: 1, route_seq: 1 }];
  it("`null` o sin paradas: lo guardado, y SIN aviso — no hay plan con el que comparar", () => {
    for (const p of [null, []]) { const l = lecturaDeLaRuta(ordenes, 10, p); expect([l.fuente, l.cambioTrasPublicar, [...l.etiquetaDe]]).toEqual(["derivada", false, [["a", "D1"], ["b", "D2"]]]); }
  });
  it("sin órdenes no hay nada que leer, con plan o sin él", () => {
    expect(lecturaDeLaRuta([], 10, guardadas(delDueno))).toMatchObject({ fuente: "derivada", cambioTrasPublicar: true });
    expect([...lecturaDeLaRuta([], 10, null).etiquetaDe]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
/** Lo que publicar escribía ANTES de D-443, copiado tal cual: la vara con la que se mide que una ruta publicada entonces se
 *  sigue reconociendo (`posicionesPorViajeHistoricas`). */
function escriturasDeAntes(plan: Pick<Plan, "rutas">): { id: string; load_no: number; route_seq: number }[] {
  const escrituras = new Map<string, { id: string; load_no: number; route_seq: number }>();
  for (const r of plan.rutas) {
    let viaje = 1, posicion = 0;
    r.paradas.forEach((p) => {
      if (p.tipo === "D") {
        const id = ordenDeLaParte(p.orden);
        if (!escrituras.has(id)) escrituras.set(id, { id, load_no: viaje, route_seq: posicion });
        posicion++;
        if (p.cargaAlSalir === 0) { viaje++; posicion = 0; }
      }
    });
  }
  return [...escrituras.values()];
}

describe("una ruta publicada ANTES de D-443 (por viajes) se sigue reconociendo", () => {
  it("`posicionesPorViajeHistoricas` es lo que se escribía, para planes de verdad —varios viajes, órdenes repartidas—", () => {
    const casos: OrdenEntrada[][] = [
      ORDENES,
      Array.from({ length: 14 }, (_, k) => orden(`o${String(k).padStart(2, "0")}`, 0, 3 + k, { pallets: 1 + (k % 4) })),
      [orden("g", 0, 20, { pallets: 25 }), orden("h", 0, 25, { pallets: 3 })],
    ];
    let comparadas = 0;
    for (const ordenes of casos) {
      const xs = [...new Set(ordenes.flatMap((o) => [Number(o.origen!.split(",")[0]), Number(o.destino!.split(",")[0])]).concat([0]))];
      const plan = planifica({ ordenes, choferes: [chofer], matriz: matrizDe(xs) }, PARAMETROS_POR_DEFECTO);
      const hist = posicionesPorViajeHistoricas(plan.rutas[0].paradas);
      expect(hist).toEqual(escriturasDeAntes(plan));
      // Esas órdenes, guardadas como se guardaban, siguen siendo «la ruta publicada».
      expect(sigueElPlan(guardadas(plan), hist.map((x) => ({ id: x.id, load_no: x.load_no, route_seq: x.route_seq })))).toBe(true);
      comparadas += hist.length;
    }
    expect(comparadas).toBeGreaterThan(10);
  });
});

// D-336 → D-443: una ruta ordenada A MEDIAS. La lista lleva la recogida y la entrega de TODAS sus órdenes; lo que no tiene
// puesto va al final y se marca provisional fila a fila. No queda ningún número que saltar.
describe("una ruta ordenada a medias", () => {
  const o = (id: string, route_seq: number | null): OrdenAsignada => ({ id, store: "Tienda A", est_pallets: 1, route_seq });
  it("la orden SIN puesto va al final, con su recogida y su entrega; sus filas son provisionales", () => {
    const ordenes = [o("a", 0), o("suelta", null), o("b", 1)];
    const l = lecturaDeLaRuta(ordenes, 10, null);
    expect(pinta(l)).toEqual(["P1", "P2", "P3", "D1", "D2", "D3"]);
    expect([...l.etiquetaDe]).toEqual([["a", "D1"], ["b", "D2"], ["suelta", "D3"]]);
    const porId = new Map(ordenes.map((x) => [x.id, x]));
    expect(l.filas.map((f) => esProvisionalLaFila(f, porId))).toEqual([false, false, true, false, false, true]);
  });
  it("si NINGUNA tiene puesto se numeran todas, como las enseña «Mi ruta»", () => {
    expect([...lecturaDeLaRuta([o("a", null), o("b", null)], 10, null).etiquetaDe.values()]).toEqual(["D1", "D2"]);
  });
});

// D-341: EN QUÉ cambió la ruta tras publicar, para el aviso de «Mi ruta». El plan va escrito a mano y con los ids
// DESORDENADOS respecto al alfabeto (m, c, t, f), y las paradas llegan barajadas: nada aquí pasa «porque ya venía ordenado».
describe("en qué cambió la ruta desde que se publicó el plan", () => {
  const p = (seq: number, kind: "P" | "D", order_ref: string, load_after: number): ParadaDelPlanMinima => ({ kind, order_ref, seq, label: `${kind}${seq}`, load_after, place: null });
  // Una lista con una recarga a media ruta: [m, c] y, ya vacío, [t, f].
  const enSuOrden = [p(0, "P", "m", 1), p(1, "P", "c", 2), p(2, "D", "m", 1), p(3, "D", "c", 0), p(4, "P", "t", 1), p(5, "P", "f", 2), p(6, "D", "t", 1), p(7, "D", "f", 0)];
  const paradas = [enSuOrden[6], enSuOrden[3], enSuOrden[0], enSuOrden[7], enSuOrden[2], enSuOrden[5], enSuOrden[1], enSuOrden[4]];
  const o = (id: string, route_seq: number | null, load_no: number | null = null): OrdenAsignada => ({ id, store: "Tienda A", est_pallets: 1, load_no, route_seq });
  const publicada = [o("m", 0), o("c", 1), o("t", 2), o("f", 3)];
  const NADA = { anadidas: [], quitadas: [], ordenCambiado: false };

  it("la ruta publicada, tal cual: `null` — y también sin plan con el que comparar", () => {
    expect(sigueElPlan(paradas, publicada)).toBe(true);
    expect(cambiosTrasPublicar(paradas, publicada)).toBeNull();
    expect(cambiosTrasPublicar(null, publicada)).toBeNull();
    expect(cambiosTrasPublicar([], publicada)).toBeNull();
  });
  it("la MISMA ruta publicada antes de D-443, guardada por viajes (puesto dentro de cada viaje), también es la publicada", () => {
    expect(sigueElPlan(paradas, [o("m", 0, 1), o("c", 1, 1), o("t", 0, 2), o("f", 1, 2)])).toBe(true);
  });
  it("una parada AÑADIDA en medio: se nombra, y no cuenta como reordenar las demás", () => {
    expect(cambiosTrasPublicar(paradas, [o("m", 0), o("a", 1), o("c", 2), o("t", 3), o("f", 4)])).toEqual({ ...NADA, anadidas: ["a"] });
  });
  it("paradas QUITADAS: salen en el orden del plan, y quitar la primera no es reordenar", () => {
    expect(cambiosTrasPublicar(paradas, [o("c", 1), o("t", 2), o("f", 3)])).toEqual({ ...NADA, quitadas: ["m"] });
    expect(cambiosTrasPublicar(paradas, [o("t", 2), o("c", 1)])).toMatchObject({ quitadas: ["m", "f"], anadidas: [] });
    expect(cambiosTrasPublicar(paradas, [])).toEqual({ ...NADA, quitadas: ["m", "c", "t", "f"] });
  });
  it("las mismas paradas en OTRO ORDEN", () => {
    expect(cambiosTrasPublicar(paradas, [o("c", 0), o("m", 1), o("t", 2), o("f", 3)])).toEqual({ ...NADA, ordenCambiado: true });
  });
  it("añadida, quitada y reordenada A LA VEZ", () => {
    expect(cambiosTrasPublicar(paradas, [o("f", 0), o("z", 1), o("m", 2), o("c", 3)])).toEqual({ anadidas: ["z"], quitadas: ["t"], ordenCambiado: true });
  });
  it("cambió pero sin pormenor que contar (mismo orden, puestos renumerados): se avisa igual, con el detalle vacío", () => {
    const renumerada = [o("m", 1), o("c", 2), o("t", 3), o("f", 4)];
    expect(sigueElPlan(paradas, renumerada)).toBe(false);
    expect(cambiosTrasPublicar(paradas, renumerada)).toEqual(NADA);
  });
  it("la lectura lleva ESE detalle, y `cambioTrasPublicar` dice lo mismo que él", () => {
    const hoy = [o("c", 0), o("m", 1), o("t", 2), o("f", 3)];
    const tocada = lecturaDeLaRuta(hoy, 10, paradas), intacta = lecturaDeLaRuta(publicada, 10, paradas), sinPlan = lecturaDeLaRuta(hoy, 10, null);
    expect([tocada.cambioTrasPublicar, tocada.cambios]).toEqual([true, { ...NADA, ordenCambiado: true }]);
    expect([intacta.fuente, intacta.cambioTrasPublicar, intacta.cambios]).toEqual(["plan", false, null]);
    expect([sinPlan.cambioTrasPublicar, sinPlan.cambios]).toEqual([false, null]);
  });
});

describe("«Mi ruta» pinta el aviso de D-341", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/my-route/page.tsx"), "utf8").split("\r\n").join("\n");
  it("sale de `lectura.cambios`, con sus tres partes (el «pasó a otro viaje» se fue con los viajes, D-443)", () => {
    for (const trozo of ["{lectura.cambios && (", "lectura.cambios.anadidas.map(", "lectura.cambios.quitadas.map(", "{lectura.cambios.ordenCambiado && "]) expect(pagina).toContain(trozo);
    expect(pagina).not.toContain("viajeCambiado");
  });
  it("va FUERA de la lista de paradas: también sale si al chofer le quitaron todas", () => {
    const aviso = pagina.indexOf("{lectura.cambios && ("), lista = pagina.indexOf("{stops.length === 0 ? (");
    expect(aviso).toBeGreaterThan(-1);
    expect(lista).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(lista);
  });
  it("«Mi ruta» lee la MISMA lista que el Gestor, con la capacidad del camión, y la pinta con su cuenta (D-443)", () => {
    expect(pagina).toContain("const lectura = useMemo(() => lecturaDeLaRuta(stops, capacidad, verAtrasadas ? null : planPublicado?.paradas ?? null), [stops, capacidad, planPublicado, verAtrasadas]);");
    expect(pagina).toContain("const cuenta = useMemo(() => cuentaDePallets(lectura.filas.map((f) => f.cambio), capacidad), [lectura, capacidad]);");
    expect(pagina).toContain("{lectura.filas.map((f, fi) => {");
    for (const x of ["truckloads`", "groupIntoLoads", "splitIntoTrips", "filasDelViaje", "trips.map("]) expect(pagina).not.toContain(x);
  });
});

// D-379: una ruta que nadie ordenó enseña su P/D provisional. Las tiendas van INTERCALADAS (B, A, B): el número de recogida
// no coincide con el de la fila, así que una implementación que numerara por fila no pasaría.
describe("D-379: una ruta que nadie ordenó enseña su P/D provisional", () => {
  const o = (id: string, store: string, route_seq: number | null = null): OrdenAsignada => ({ id, store, est_pallets: 1, route_seq });
  const viaje = [o("a", "Tienda B"), o("b", "Tienda A"), o("c", "Tienda B")];
  const l = lecturaDeLaRuta(viaje, 10, null);

  it("es provisional solo si NINGUNA orden tiene puesto: ni a medias, ni vacía", () => {
    expect(esProvisional(viaje)).toBe(true);
    expect(esProvisional([o("a", "Tienda B", 0), o("b", "Tienda A")])).toBe(false);
    expect(esProvisional([])).toBe(false);
  });
  it("las filas llevan sus recogidas (una por tienda), y ninguna D sale antes que su P", () => {
    expect(pinta(l)).toEqual(["P1", "P2", "P3", "D1", "D3", "D2"]);
    const etiquetas = l.filas.flatMap((f) => f.etiqueta.split("·"));
    for (const d of etiquetas.filter((x) => x.startsWith("D"))) {
      const p = "P" + d.slice(1);
      expect(etiquetas.indexOf(p), p).toBeGreaterThan(-1);
      expect(etiquetas.indexOf(p), `${p} antes que ${d}`).toBeLessThan(etiquetas.indexOf(d));
    }
  });
});
