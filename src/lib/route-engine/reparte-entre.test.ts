import { describe, expect, it } from "vitest";
import { entradaDelReparto, paradasSinPartes, reparteEntre } from "./reparte-entre";
import { planifica } from "./planifica";
import { PARAMETROS_POR_DEFECTO } from "./evalua";
import { TOLERANCIA_DE_PASO } from "./de-paso";
import type { ChoferEntrada, Entrada, Matriz, OrdenEntrada, ParadaRef, Parametros } from "./types";

/**
 * «Asignar a…» varios choferes desde el Gestor (D-NEXT). El dueño, 2026-10-06: «elijo 10 ordenes y las asigno a 2 conductos
 * y el sistema automaticmaente sabe a quien darselas». Un mapa inventado: dos tiendas (norte y sur) y entregas cerca de una
 * o de otra; tiempos en línea recta, para que «quién la lleva» se pueda razonar a mano.
 */

type P = { lat: number; lng: number };
const PUNTOS: Record<string, P> = {
  "tienda:norte": { lat: 26.30, lng: -98.20 }, "tienda:sur": { lat: 26.10, lng: -98.20 },
  "orden:n1": { lat: 26.32, lng: -98.21 }, "orden:n2": { lat: 26.31, lng: -98.18 }, "orden:n3": { lat: 26.33, lng: -98.19 }, "orden:n4": { lat: 26.29, lng: -98.22 },
  "orden:s1": { lat: 26.08, lng: -98.21 }, "orden:s2": { lat: 26.09, lng: -98.18 }, "orden:s3": { lat: 26.07, lng: -98.19 }, "orden:s4": { lat: 26.11, lng: -98.22 },
  "orden:lejos": { lat: 25.90, lng: -97.50 },
};
const millas = (a: P, b: P) => Math.sqrt(((a.lat - b.lat) * 69) ** 2 + ((a.lng - b.lng) * 62) ** 2);
const matriz = (): Matriz => {
  const m: Matriz = {};
  for (const a of Object.keys(PUNTOS)) { m[a] = {}; for (const b of Object.keys(PUNTOS)) if (a !== b) { const mi = Math.round(millas(PUNTOS[a], PUNTOS[b]) * 100) / 100; m[a][b] = { minutos: Math.round((mi / 30) * 60), millas: mi }; } }
  return m;
};
const chofer = (id: string, base: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada => ({ id, nombre: id.toUpperCase(), base, capacidad: 10, entrada: 480, salida: 1050, vuelveABase: true, ...extra });
const orden = (id: string, origen: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
  id, codigo: id, entrada: `2026-10-06 ${String(800 + Number(id.replace(/\D/g, "") || 0)).padStart(4, "0")}`, origen, destino: `orden:${id}`, pallets: 2, ventana: null,
  servicioRecogidaMin: 5, servicioEntregaMin: 10, choferFijado: null, ...extra,
});
const PARAMETROS: Parametros = { ...PARAMETROS_POR_DEFECTO, dePaso: TOLERANCIA_DE_PASO };
const P = (orden: string): ParadaRef => ({ orden, tipo: "P" });
const D = (orden: string): ParadaRef => ({ orden, tipo: "D" });

/** El día entero como lo da `entradaDelDia`: cuatro órdenes del norte, cuatro del sur, tres choferes. */
const dia = (): Entrada => ({
  ordenes: [
    orden("n1", "tienda:norte"), orden("n2", "tienda:norte"), orden("n3", "tienda:norte"), orden("n4", "tienda:norte"),
    orden("s1", "tienda:sur"), orden("s2", "tienda:sur"), orden("s3", "tienda:sur"), orden("s4", "tienda:sur"),
  ],
  choferes: [chofer("ana", "tienda:norte"), chofer("beto", "tienda:sur"), chofer("ceci", "tienda:norte")],
  matriz: matriz(),
});
const choferDe = (r: ReturnType<typeof reparteEntre>, id: string) => r.rutas.find((x) => x.nuevas.includes(id))?.chofer ?? null;
const ordenesDe = (paradas: readonly ParadaRef[]) => paradas.filter((p) => p.tipo === "D").map((p) => p.orden);

describe("la entrada que ve el motor", () => {
  it("solo los choferes elegidos, y solo las seleccionadas más lo que esos choferes ya llevan; lo demás del día no entra", () => {
    const { entrada } = entradaDelReparto({
      entrada: dia(), seleccionadas: ["n1", "s1"], elegidos: ["ana", "beto"],
      yaLlevan: { ana: [P("n2"), D("n2")], beto: [P("s2"), D("s2")], ceci: [P("n3"), D("n3")] },
    });
    expect(entrada.choferes.map((c) => c.id)).toEqual(["ana", "beto"]);
    expect(entrada.ordenes.map((o) => o.id).sort()).toEqual(["n1", "n2", "s1", "s2"]);
  });
  it("las seleccionadas entran LIBRES (sin chofer fijado) aunque hoy estén con un elegido; lo que el elegido ya lleva, fijado a él y en su orden", () => {
    const { entrada } = entradaDelReparto({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "n1" ? { ...o, choferFijado: "ana" } : o)) },
      seleccionadas: ["n1"], elegidos: ["ana"], yaLlevan: { ana: [P("n1"), P("n2"), D("n2"), D("n1"), P("n3"), D("n3")] },
    });
    const porId = new Map(entrada.ordenes.map((o) => [o.id, o]));
    expect(porId.get("n1")!.choferFijado).toBeNull();
    expect(porId.get("n2")!.choferFijado).toBe("ana");
    expect(porId.get("n3")!.choferFijado).toBe("ana");
    expect(entrada.secuenciaFijada).toEqual({ ana: [P("n2"), D("n2"), P("n3"), D("n3")] });
  });
  it("lo que lleva un chofer NO elegido no entra, ni se fija; y una seleccionada que no está en el día se dice como ignorada", () => {
    const r = entradaDelReparto({ entrada: dia(), seleccionadas: ["n1", "fantasma"], elegidos: ["ana"], yaLlevan: { beto: [P("s2"), D("s2")] } });
    expect(r.entrada.ordenes.map((o) => o.id)).toEqual(["n1"]);
    expect(r.entrada.secuenciaFijada).toBeUndefined();
    expect(r.ignoradas).toEqual(["fantasma"]);
  });
  it("una parada de `yaLlevan` de una orden que ya no está en el día se ignora (sin fijar nada roto)", () => {
    const r = entradaDelReparto({ entrada: dia(), seleccionadas: ["n1"], elegidos: ["ana"], yaLlevan: { ana: [P("entregada"), D("entregada")] } });
    expect(r.entrada.secuenciaFijada).toBeUndefined();
    expect(r.entrada.ordenes.map((o) => o.id)).toEqual(["n1"]);
  });
});

describe("el reparto", () => {
  it("es EXACTAMENTE el motor de «Armar rutas» sobre esa entrada: la misma secuencia por chofer que `planifica`", () => {
    const peticion = { entrada: dia(), parametros: PARAMETROS, seleccionadas: ["n1", "n2", "s1", "s2", "n3"], elegidos: ["ana", "beto"], yaLlevan: { ana: [P("n4"), D("n4")], beto: [P("s3"), D("s3")] } };
    const r = reparteEntre(peticion);
    const directo = planifica(entradaDelReparto(peticion).entrada, PARAMETROS);
    for (const ruta of r.rutas) {
      const suya = directo.rutas.find((x) => x.chofer === ruta.chofer)!;
      expect(ruta.paradas).toEqual(paradasSinPartes(suya.paradas));
    }
    expect(r.plan.version).toBe(directo.version);
  });
  it("«10 órdenes a 2 choferes»: el sistema sabe a quién darle cada una — las del norte al de la base norte, las del sur al del sur", () => {
    const r = reparteEntre({ entrada: dia(), parametros: PARAMETROS, seleccionadas: ["n1", "n2", "n3", "n4", "s1", "s2", "s3", "s4"], elegidos: ["ana", "beto"], yaLlevan: {} });
    expect(r.completo).toBe(true);
    for (const id of ["n1", "n2", "n3", "n4"]) expect(choferDe(r, id), id).toBe("ana");
    for (const id of ["s1", "s2", "s3", "s4"]) expect(choferDe(r, id), id).toBe("beto");
    expect(r.rutas.map((x) => [x.chofer, x.nuevas.length])).toEqual([["ana", 4], ["beto", 4]]);
  });
  it("solo entre los ELEGIDOS: con el del sur fuera, lo del sur va con un chofer del norte aunque haya otro con base en el sur", () => {
    const r = reparteEntre({ entrada: dia(), parametros: PARAMETROS, seleccionadas: ["s1", "s2"], elegidos: ["ana", "ceci"], yaLlevan: {} });
    expect(r.completo).toBe(true);
    expect(r.rutas.map((x) => x.chofer)).toEqual(["ana", "ceci"]);
    expect(["ana", "ceci"]).toContain(choferDe(r, "s1"));
    expect(["ana", "ceci"]).toContain(choferDe(r, "s2"));
  });
  it("con UN solo elegido, todas van con él, en el mejor orden que el motor encuentra", () => {
    const r = reparteEntre({ entrada: dia(), parametros: PARAMETROS, seleccionadas: ["n1", "s1", "n2", "s2"], elegidos: ["ana"], yaLlevan: {} });
    expect(r.completo).toBe(true);
    expect(r.rutas).toHaveLength(1);
    expect(r.rutas[0].nuevas.sort()).toEqual(["n1", "n2", "s1", "s2"]);
    // Las del norte antes de bajar al sur (o al revés), nunca alternando: es lo que mide el motor.
    const ordenes = ordenesDe(r.rutas[0].paradas).map((o) => o[0]);
    expect(ordenes.join("")).toMatch(/^(nnss|ssnn)$/);
  });
  it("lo que el elegido ya lleva se queda con él y EN SU ORDEN; las seleccionadas se insertan alrededor", () => {
    const r = reparteEntre({
      entrada: dia(), parametros: PARAMETROS, seleccionadas: ["n3"], elegidos: ["ana"],
      // Un orden a mano, a propósito «raro»: n4 antes que n2 aunque el motor preferiría otro.
      yaLlevan: { ana: [P("n4"), D("n4"), P("n2"), D("n2")] },
    });
    expect(r.completo).toBe(true);
    const suyas = ordenesDe(r.rutas[0].paradas);
    expect(suyas).toHaveLength(3);
    expect(suyas.filter((o) => o !== "n3")).toEqual(["n4", "n2"]);
    expect(r.rutas[0].nuevas).toEqual(["n3"]);
    expect(r.rutas[0].ruta.violaciones).toEqual([]);
  });
  it("una seleccionada que estaba con un chofer NO elegido se mueve: sale en `nuevas` del elegido que le toca", () => {
    const r = reparteEntre({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "n1" ? { ...o, choferFijado: "ceci" } : o)) },
      parametros: PARAMETROS, seleccionadas: ["n1"], elegidos: ["ana", "beto"], yaLlevan: { ceci: [P("n1"), D("n1")] },
    });
    expect(choferDe(r, "n1")).toBe("ana");
    expect(r.rutas.map((x) => x.chofer)).toEqual(["ana", "beto"]);
  });
  it("lo que no cabe se devuelve con su porqué y `completo` es false — no se reparte a medias sin decirlo", () => {
    // s1 pide liftgate y el camión de Beto no lo tiene (D-418): con solo Beto, no va. Lo que Beto ya lleva no se toca.
    const r = reparteEntre({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "s1" ? { ...o, requisitos: ["liftgate"] } : o)) },
      parametros: PARAMETROS, seleccionadas: ["s1"], elegidos: ["beto"],
      yaLlevan: { beto: [P("s2"), P("s3"), D("s2"), D("s3")] },
    });
    expect(r.completo).toBe(false);
    expect(r.sinAsignar).toEqual([{ orden: "s1", motivo: "falta_requisito", faltan: ["liftgate"] }]);
    expect(r.rutas[0].nuevas).toEqual([]);
    expect(ordenesDe(r.rutas[0].paradas)).toEqual(["s2", "s3"]);
  });
  it("con la misma orden que no cabe pero OTRO elegido que sí puede, va con el otro y entra todo", () => {
    const r = reparteEntre({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "s1" ? { ...o, requisitos: ["liftgate"] } : o)), choferes: [chofer("ana", "tienda:norte", { habilidades: ["liftgate"] }), chofer("beto", "tienda:sur")] },
      parametros: PARAMETROS, seleccionadas: ["s1"], elegidos: ["beto", "ana"],
      yaLlevan: { beto: [P("s2"), P("s3"), D("s2"), D("s3")] },
    });
    expect(r.completo).toBe(true);
    expect(choferDe(r, "s1")).toBe("ana");
  });
  it("la capacidad se respeta como en «Armar rutas»: si hace falta, el motor vuelve a la tienda antes de cargar la nueva, y nunca se pasa", () => {
    const r = reparteEntre({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (["s1", "s2", "s3"].includes(o.id) ? { ...o, pallets: 4 } : o)) },
      parametros: PARAMETROS, seleccionadas: ["s1"], elegidos: ["beto"],
      yaLlevan: { beto: [P("s2"), P("s3"), D("s2"), D("s3")] },
    });
    expect(r.completo).toBe(true);
    expect(r.rutas[0].ruta.violaciones).toEqual([]);
    expect(Math.max(...r.rutas[0].ruta.paradas.map((p) => p.cargaAlSalir))).toBeLessThanOrEqual(10);
    expect(ordenesDe(r.rutas[0].paradas).filter((o) => o !== "s1")).toEqual(["s2", "s3"]);
  });
  it("una orden mayor que el camión se parte por dentro (como en «Armar rutas») y sale como UNA orden, una P y una D", () => {
    const r = reparteEntre({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "n1" ? { ...o, pallets: 15 } : o)) },
      parametros: PARAMETROS, seleccionadas: ["n1"], elegidos: ["ana"], yaLlevan: {},
    });
    expect(r.plan.partes.n1).toEqual(["n1#a", "n1#b"]);
    expect(r.rutas[0].paradas).toEqual([P("n1"), D("n1")]);
    expect(r.rutas[0].nuevas).toEqual(["n1"]);
  });
  it("sin ningún elegido que exista en la entrada, nada se asigna y todas quedan sin chofer", () => {
    const r = reparteEntre({ entrada: dia(), parametros: PARAMETROS, seleccionadas: ["n1", "s1"], elegidos: ["nadie"], yaLlevan: {} });
    expect(r.rutas).toEqual([]);
    expect(r.sinAsignar.map((s) => [s.orden, s.motivo])).toEqual([["n1", "sin_chofer_disponible"], ["s1", "sin_chofer_disponible"]]);
    expect(r.completo).toBe(false);
  });
  it("una seleccionada sin punto en el mapa no cabe en nadie, y se dice", () => {
    const r = reparteEntre({
      entrada: { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "n1" ? { ...o, destino: null } : o)) },
      parametros: PARAMETROS, seleccionadas: ["n1", "n2"], elegidos: ["ana"], yaLlevan: {},
    });
    expect(r.sinAsignar).toEqual([{ orden: "n1", motivo: "sin_punto" }]);
    expect(r.rutas[0].nuevas).toEqual(["n2"]);
  });
  it("planifica con los PARÁMETROS del día (los de Ajustes, como «Armar rutas»), no con los de defecto: con tope de retraso 0, una entrega que llega tarde no cabe", () => {
    // s4 cierra su ventana (ancha) a las 08:01: se llega unos minutos tarde. Con el tope de siempre (60 min) cabe; con tope 0, no.
    const entrada = { ...dia(), ordenes: dia().ordenes.map((o) => (o.id === "s4" ? { ...o, ventana: [480, 481] as [number, number] } : o)) };
    const conTope = reparteEntre({ entrada, parametros: PARAMETROS, seleccionadas: ["s4"], elegidos: ["beto"], yaLlevan: {} });
    expect(conTope.completo).toBe(true);
    expect(conTope.rutas[0].ruta.tardeMin).toBeGreaterThan(0);
    const sinTope = reparteEntre({ entrada, parametros: { ...PARAMETROS, topeTardeAnchaMin: 0 }, seleccionadas: ["s4"], elegidos: ["beto"], yaLlevan: {} });
    expect(sinTope.sinAsignar).toEqual([{ orden: "s4", motivo: "retraso_sobre_el_tope" }]);
  });
  it("la misma petición da el mismo reparto (determinista, como el motor)", () => {
    const pide = () => reparteEntre({ entrada: dia(), parametros: PARAMETROS, seleccionadas: ["n1", "n2", "s1", "s2", "n3", "s3"], elegidos: ["ana", "beto"], yaLlevan: { ana: [P("n4"), D("n4")] } });
    expect(pide()).toEqual(pide());
  });
});

describe("las paradas sin partes", () => {
  it("junta las cargas de una orden partida en su primera P y su primera D, y deja el resto como está", () => {
    expect(paradasSinPartes([P("a#a"), P("b"), D("a#a"), P("a#b"), D("b"), D("a#b")])).toEqual([P("a"), P("b"), D("a"), D("b")]);
  });
});
