import { describe, expect, it } from "vitest";
import { evaluaPlan } from "./evalua";
import { soloAnadeRetraso, unaSolaVisita, unaSolaVisitaCuandoCabe, violacionesAnadidas } from "./una-sola-visita";
import { validaLaRuta } from "./validador";
import type { ChoferEntrada, Matriz, OrdenEntrada, ParadaRef } from "./types";

const o = (id: string, origen: string | null, destino: string | null, pallets = 1): OrdenEntrada => ({
  id, codigo: id, origen, destino, pallets, ventana: null, servicioRecogidaMin: 10, servicioEntregaMin: 10,
});
const P = (orden: string): ParadaRef => ({ orden, tipo: "P" });
const D = (orden: string): ParadaRef => ({ orden, tipo: "D" });
const CAP = 10;
const valida = (ordenes: OrdenEntrada[], secuencia: ParadaRef[]) => validaLaRuta({ chofer: { nombre: "Julio", capacidad: CAP }, ordenes, secuencia });
const claves = (ordenes: OrdenEntrada[], secuencia: ParadaRef[]) => valida(ordenes, secuencia).violaciones.map((v) => v.clave);
const firma = (xs: readonly ParadaRef[]) => xs.map((p) => `${p.tipo}:${p.orden}`).sort();

// El caso del validador: a y b recogen en pharr, a se entrega antes de volver a pharr por c.
const ords = [o("a", "pharr", "c1"), o("b", "pharr", "weslaco"), o("c", "pharr", "c2")];
const regreso = [P("a"), P("b"), D("a"), P("c"), D("b"), D("c")];

describe("unaSolaVisita", () => {
  it("un regreso sin justificar se funde: la recogida que vuelve entra en la primera visita a la tienda", () => {
    expect(claves(ords, regreso)).toContain("regreso_a_la_misma_tienda");
    const salida = unaSolaVisita(regreso, ords, CAP);
    expect(salida).toEqual([P("a"), P("b"), P("c"), D("a"), D("b"), D("c")]);
    expect(claves(ords, salida)).not.toContain("regreso_a_la_misma_tienda");
    expect(claves(ords, salida)).not.toContain("carga_antes_de_descarga");
  });

  it("un regreso que lo justifica la capacidad no se toca", () => {
    const grandes = [o("a", "pharr", "c1", 3), o("b", "pharr", "weslaco", 2), o("c", "pharr", "c2", 3)];
    const sec = [P("a"), P("b"), D("a"), P("c"), D("b"), D("c")];
    expect(validaLaRuta({ chofer: { nombre: "Julio", capacidad: 5 }, ordenes: grandes, secuencia: sec }).violaciones.map((v) => v.clave)).not.toContain("regreso_a_la_misma_tienda");
    expect(unaSolaVisita(sec, grandes, 5)).toEqual(sec);
  });

  it("un regreso inevitable (la entrega de una orden recogida después) no se toca, ni siquiera su P de paso", () => {
    const orden = [o("a", "pharr", "c1"), o("b", "c9", "pharr"), o("c", "pharr", "c3")];
    const sec = [P("a"), D("a"), P("b"), P("c"), D("b")];
    expect(claves(orden, sec)).not.toContain("regreso_a_la_misma_tienda");
    expect(unaSolaVisita(sec, orden, CAP)).toEqual(sec);
  });

  it("un regreso con el camión vacío en medio (viaje nuevo) no se toca", () => {
    const orden = [o("a", "pharr", "c1"), o("c", "pharr", "c2")];
    const sec = [P("a"), D("a"), P("c"), D("c")];
    expect(unaSolaVisita(sec, orden, CAP)).toEqual(sec);
  });

  it("las primeras `fijas` paradas no se mueven: si la visita de origen cae en ellas, no se toca", () => {
    expect(unaSolaVisita(regreso, ords, CAP, 2)).toEqual(regreso);
    expect(unaSolaVisita(regreso, ords, CAP, 4)).toEqual(regreso);
  });

  it("es idempotente y no muta la entrada", () => {
    const sec = Object.freeze(regreso.map((p) => Object.freeze({ ...p })));
    const antes = sec.map((p) => ({ ...p }));
    const una = unaSolaVisita(sec, ords, CAP);
    expect(sec).toEqual(antes);
    expect(unaSolaVisita(una, ords, CAP)).toEqual(una);
  });

  it("sale con las mismas paradas que entró", () => {
    expect(firma(unaSolaVisita(regreso, ords, CAP))).toEqual(firma(regreso));
  });

  it("nunca pone una D delante de su propia P ni introduce violaciones de reglas 1 y 5", () => {
    const casos: { ordenes: OrdenEntrada[]; sec: ParadaRef[] }[] = [
      { ordenes: ords, sec: regreso },
      { ordenes: [o("a", "pharr", "c1"), o("b", "c9", "pharr")], sec: [P("a"), D("a"), P("b"), D("b")] },
    ];
    for (const { ordenes, sec } of casos) {
      const antes = new Set(claves(ordenes, sec));
      const salida = unaSolaVisita(sec, ordenes, CAP);
      const nuevas = claves(ordenes, salida).filter((c) => !antes.has(c));
      expect(nuevas.filter((c) => c === "precedencia" || c === "entrega_sin_recogida" || c === "descarga_de_lo_que_no_va_a_bordo")).toEqual([]);
    }
  });
});

describe("soloAnadeRetraso y violacionesAnadidas: se cuenta por tipo y orden", () => {
  const v = (tipo: "ventana_estrecha" | "capacidad" | "retraso_sobre_el_tope" | "fuera_de_turno", orden = "a") => ({ tipo, orden });

  it("añadir llegar tarde a una ventana (estrecha o pasada del tope) sí se acepta", () => {
    expect(soloAnadeRetraso([], [v("ventana_estrecha", "c2")])).toBe(true);
    expect(soloAnadeRetraso([], [v("retraso_sobre_el_tope", "c2")])).toBe(true);
    expect(soloAnadeRetraso([v("capacidad", "x")], [v("capacidad", "x"), v("ventana_estrecha", "c2")])).toBe(true);
  });

  it("añadir capacidad, turno o cualquier otra cosa se rechaza, aunque haya la misma cuenta de violaciones", () => {
    expect(soloAnadeRetraso([], [v("capacidad", "c2")])).toBe(false);
    expect(soloAnadeRetraso([], [v("fuera_de_turno", "c2")])).toBe(false);
    // Cambia una capacidad por un retraso: la cuenta es la misma, pero la capacidad es nueva.
    expect(soloAnadeRetraso([v("ventana_estrecha", "c2")], [v("capacidad", "c2")])).toBe(false);
  });

  it("quitar violaciones nunca cuenta como añadir; una que ya estaba y sigue no cuenta", () => {
    expect(soloAnadeRetraso([v("capacidad", "x")], [])).toBe(true);
    expect(soloAnadeRetraso([v("ventana_estrecha", "c2")], [v("ventana_estrecha", "c2")])).toBe(true);
    expect(violacionesAnadidas([v("ventana_estrecha", "c2")], [v("ventana_estrecha", "c2"), v("ventana_estrecha", "c3")]).map((x) => x.orden)).toEqual(["c3"]);
  });
});

describe("unaSolaVisitaCuandoCabe: cada juntada se adopta por separado", () => {
  // Dos regresos independientes: X (pharr) y Y (weslaco), cada uno con la forma del caso de arriba.
  const pat = (p: string, a: string, b: string, c: string, d1: string, d2: string, d3: string) => ({ ords: [o(a, p, d1), o(b, p, d2), o(c, p, d3)], sec: [P(a), P(b), D(a), P(c), D(b), D(c)] });
  it("si la juntada de X no vale y la de Y sí, se adopta solo la de Y", () => {
    const x = pat("pharr", "a", "b", "c", "c1", "weslaco", "c2");
    const y = pat("dallas", "d", "e", "f", "c3", "c4", "c5");
    const ordenes = [...x.ords, ...y.ords];
    const sec = [...x.sec, P("d"), P("e"), D("d"), P("f"), D("e"), D("f")];
    expect(claves(ordenes, sec)).toContain("regreso_a_la_misma_tienda");
    const salida = unaSolaVisitaCuandoCabe(sec, ordenes, CAP, 0, (_nueva, tiendas) => !tiendas.includes("pharr"));
    // X se queda como estaba (su regreso sigue); Y se juntó: la P de f ya va antes de la D de d.
    expect(salida.findIndex((p) => p.orden === "f" && p.tipo === "P")).toBeLessThan(salida.findIndex((p) => p.orden === "d" && p.tipo === "D"));
    expect(salida.slice(0, 6)).toEqual(sec.slice(0, 6));
    expect(claves(ordenes, salida)).toContain("regreso_a_la_misma_tienda");
    expect(firma(salida)).toEqual(firma(sec));
  });

  it("si todas las juntadas se aceptan, da el mismo resultado que unaSolaVisita", () => {
    expect(unaSolaVisitaCuandoCabe(regreso, ords, CAP, 0, () => true)).toEqual(unaSolaVisita(regreso, ords, CAP));
  });

  it("una juntada que el evaluador marca con CAPACIDAD se rechaza: la ruta queda como estaba", () => {
    // El validador (cap. 10) ve el regreso y propone la juntada: las tres recogidas a bordo a la vez (3 pallets). El evaluador, con
    // el camión de 2 pallets, la mide: añade una violación de capacidad. Esa juntada no se adopta.
    const chico: ChoferEntrada = { id: "A", nombre: "Julio", base: "pharr", capacidad: 2, entrada: 480, salida: 1050, vuelveABase: false };
    const puntos = ["pharr", "c1", "weslaco", "c2"];
    const m: Matriz = {};
    for (const a of puntos) { m[a] = {}; for (const b of puntos) if (a !== b) m[a][b] = { minutos: 10, millas: 6 }; }
    const evalua = (sec: ParadaRef[]) => evaluaPlan({ secuencias: { A: sec }, ordenes: ords, choferes: [chico], matriz: m }).rutas[0];
    const juntada = evalua(unaSolaVisita(regreso, ords, CAP));
    expect(juntada.violaciones.map((v) => v.tipo)).toContain("capacidad");
    const antes = evalua(regreso);
    const salida = unaSolaVisitaCuandoCabe(regreso, ords, CAP, 0, (nueva) => soloAnadeRetraso(antes.violaciones, evalua(nueva).violaciones));
    expect(salida).toEqual(regreso);
  });
  it("con capacidad justa para la juntada, el validador ya no marca regreso y no se toca (capacidad del camión = 2)", () => {
    expect(unaSolaVisitaCuandoCabe(regreso, ords, 2, 0, () => true)).toEqual(regreso);
  });
});
