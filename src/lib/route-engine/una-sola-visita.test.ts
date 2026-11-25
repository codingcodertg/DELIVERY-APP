import { describe, expect, it } from "vitest";
import { unaSolaVisita } from "./una-sola-visita";
import { validaLaRuta } from "./validador";
import type { OrdenEntrada, ParadaRef } from "./types";

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
