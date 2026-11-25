import { describe, expect, it } from "vitest";
import { descargaPrimero } from "./descarga-primero";
import { validaLaRuta, type EntradaDelValidador } from "./validador";
import type { OrdenEntrada, ParadaRef } from "./types";

/** Una orden de prueba: origen y destino son puntos (o null = sin punto). */
const o = (id: string, origen: string | null, destino: string | null, pallets = 2): OrdenEntrada => ({
  id, codigo: id, origen, destino, pallets, ventana: null, servicioRecogidaMin: 10, servicioEntregaMin: 10,
});
const P = (orden: string): ParadaRef => ({ orden, tipo: "P" });
const D = (orden: string): ParadaRef => ({ orden, tipo: "D" });
const ordenados = (xs: readonly ParadaRef[]): string[] => xs.map((p) => `${p.tipo}:${p.orden}`).sort();

// Todas en pharr: x y w recogen allí; y y z entregan allí (el punto de una D es su destino).
const ordenes = [
  o("x", "pharr", "c1"),
  o("y", "c2", "pharr"),
  o("z", "pharr", "c3"),
  o("w", "c4", "pharr"),
];

describe("descargaPrimero", () => {
  it("dentro de una visita, las entregas van antes que las recogidas", () => {
    expect(descargaPrimero([P("x"), D("y"), P("z"), D("w")], ordenes)).toEqual([D("y"), D("w"), P("x"), P("z")]);
  });

  it("una visita que ya va bien se queda igual", () => {
    const bien = [D("y"), D("w"), P("x"), P("z")];
    expect(descargaPrimero(bien, ordenes)).toEqual(bien);
  });

  it("dos visitas separadas en el mismo sitio, con otro sitio en medio, no se juntan", () => {
    const ords = [o("a", "pharr", "c1"), o("m", "c9", "mcallen"), o("b", "c2", "pharr")];
    const sec = [P("a"), D("m"), D("b")];
    expect(descargaPrimero(sec, ords)).toEqual(sec);
  });

  it("las primeras `fijas` paradas no se tocan ni se mezclan con la visita de después", () => {
    const sec = [P("x"), D("y")];
    expect(descargaPrimero(sec, ordenes, 1)).toEqual([P("x"), D("y")]);
    expect(descargaPrimero(sec, ordenes)).toEqual([D("y"), P("x")]);
  });

  it("una orden desconocida o sin punto corta la visita y se queda donde está", () => {
    const sec = [P("x"), P("ghost"), D("y")];
    expect(descargaPrimero(sec, ordenes)).toEqual([P("x"), P("ghost"), D("y")]);
    const sinPunto = [...ordenes, o("s", null, "c7")];
    const sec2 = [P("x"), P("s"), D("y")];
    expect(descargaPrimero(sec2, sinPunto)).toEqual([P("x"), P("s"), D("y")]);
  });

  it("sale con las mismas paradas que entró", () => {
    const sec = [P("x"), D("y"), P("z"), D("w"), D("x")];
    expect(ordenados(descargaPrimero(sec, ordenes))).toEqual(ordenados(sec));
  });

  it("es idempotente", () => {
    const una = descargaPrimero([P("x"), D("y"), P("z"), D("w")], ordenes);
    expect(descargaPrimero(una, ordenes)).toEqual(una);
  });

  it("no muta la entrada", () => {
    const sec = Object.freeze([P("x"), D("y"), P("z"), D("w")].map((p) => Object.freeze(p)));
    const antes = [...sec];
    const salida = descargaPrimero(sec, ordenes);
    expect(sec).toEqual(antes);
    expect(salida).not.toBe(sec);
  });

  it("quita la carga antes de la descarga que el validador marca como violación", () => {
    const ords = [o("y", "pharr", "weslaco"), o("x", "weslaco", "c1")];
    const mal: ParadaRef[] = [P("y"), P("x"), D("y"), D("x")];
    const entrada = (sec: ParadaRef[]): EntradaDelValidador => ({ chofer: { nombre: "Julio", capacidad: 10 }, ordenes: ords, secuencia: sec });
    expect(validaLaRuta(entrada(mal)).violaciones.some((v) => v.clave === "carga_antes_de_descarga")).toBe(true);
    const normalizada = descargaPrimero(mal, ords);
    expect(validaLaRuta(entrada(normalizada)).violaciones.some((v) => v.clave === "carga_antes_de_descarga")).toBe(false);
  });
});
