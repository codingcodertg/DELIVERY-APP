import { describe, expect, it } from "vitest";
import { validaLaRuta, type EntradaDelValidador } from "./validador";
import type { OrdenEntrada, ParadaRef } from "./types";

/** Una orden de prueba: origen y destino son puntos (o null = sin punto), pallets con decimales. */
const o = (id: string, origen: string | null, destino: string | null, pallets: number, extra: Partial<OrdenEntrada> = {}): OrdenEntrada => ({
  id, codigo: id, origen, destino, pallets, ventana: null, servicioRecogidaMin: 10, servicioEntregaMin: 10, ...extra,
});
const P = (orden: string): ParadaRef => ({ orden, tipo: "P" });
const D = (orden: string): ParadaRef => ({ orden, tipo: "D" });
const CHOFER = { nombre: "Julio", capacidad: 10 };

const entrada = (ordenes: OrdenEntrada[], secuencia: ParadaRef[], extra: Partial<EntradaDelValidador> = {}): EntradaDelValidador =>
  ({ chofer: CHOFER, ordenes, secuencia, ...extra });

const claves = (xs: { clave: string }[]): string[] => xs.map((x) => x.clave);

describe("validaLaRuta", () => {
  it("una ruta limpia en dos viajes es válida y no tiene avisos", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2), o("b", "pharr", "weslaco", 3)],
      [P("a"), D("a"), P("b"), D("b")],
    ));
    expect(r.valida).toBe(true);
    expect(r.violaciones).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("regla 2: recoger y entregar en la misma visita, en ese orden, incumple; entregar y luego recoger no", () => {
    const ordenes = [o("y", "pharr", "weslaco", 2), o("x", "weslaco", "c1", 2)];
    const mal = validaLaRuta(entrada(ordenes, [P("y"), P("x"), D("y"), D("x")]));
    expect(mal.valida).toBe(false);
    const v = mal.violaciones.find((x) => x.clave === "carga_antes_de_descarga");
    expect(v).toBeDefined();
    expect(v?.indice).toBe(2);
    expect(v?.lugar).toBe("weslaco");
    expect(v?.ordenes).toEqual(["y", "x"]);

    const bien = validaLaRuta(entrada(ordenes, [P("y"), D("y"), P("x"), D("x")]));
    expect(bien.valida).toBe(true);
    expect(bien.violaciones).toEqual([]);
  });

  it("regla 3: volver a la tienda con la carga todavía a bordo y sin justificación es violación", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2), o("b", "pharr", "weslaco", 1), o("c", "pharr", "c2", 1)],
      [P("a"), P("b"), D("a"), P("c"), D("b"), D("c")],
    ));
    expect(r.valida).toBe(false);
    const v = r.violaciones.find((x) => x.clave === "regreso_a_la_misma_tienda");
    expect(v).toBeDefined();
    expect(v?.regla).toBe(3);
    expect(v?.indice).toBe(3);
    expect(v?.lugar).toBe("pharr");
  });

  it("regla 3: regreso inevitable (una entrega de una orden recogida después de la primera pasada) es aviso, no violación", () => {
    // x es la carga que mantiene el camión encendido; si no, D a vacía el camión y es otro viaje.
    const r = validaLaRuta(entrada(
      [o("x", "pharr", "c9", 1), o("a", "pharr", "edinburg", 1), o("b", "edinburg", "pharr", 1), o("c", "edinburg", "c1", 1)],
      [P("x"), P("a"), D("a"), P("b"), P("c"), D("b"), D("c"), D("x")],
    ));
    expect(r.violaciones.some((x) => x.regla === 3)).toBe(false);
    expect(r.valida).toBe(true);
    const aviso = r.avisos.find((x) => x.clave === "regreso_inevitable");
    expect(aviso?.regla).toBe(3);
    expect(aviso?.lugar).toBe("pharr");
  });

  it("regla 3: regreso justificado por capacidad es aviso, no violación", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 9), o("b", "pharr", "weslaco", 1), o("c", "pharr", "c2", 5)],
      [P("a"), P("b"), D("a"), P("c"), D("b"), D("c")],
      { chofer: { nombre: "Julio", capacidad: 10 } },
    ));
    expect(r.violaciones.some((x) => x.regla === 3)).toBe(false);
    expect(r.avisos.map((x) => x.clave)).toContain("regreso_por_capacidad");
  });

  it("regla 3: volver a la tienda VACÍO (otro viaje) no es violación ni aviso", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2), o("b", "pharr", "c2", 2)],
      [P("a"), D("a"), P("b"), D("b")],
    ));
    expect(r.valida).toBe(true);
    expect(r.avisos).toEqual([]);
  });

  it("regla 4: 11 pallets a bordo con capacidad 10 es sobre_capacidad", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 6), o("b", "pharr", "c2", 5)],
      [P("a"), P("b"), D("a"), D("b")],
    ));
    expect(r.valida).toBe(false);
    const v = r.violaciones.find((x) => x.clave === "sobre_capacidad");
    expect(v?.regla).toBe(4);
    expect(v?.indice).toBe(1);
    expect(v?.detalle).toContain("11");
  });

  it("regla 4: una orden de 18 pallets da orden_mayor_que_el_camion y sobre_capacidad", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 18)],
      [P("a"), D("a")],
    ));
    expect(claves(r.violaciones)).toContain("orden_mayor_que_el_camion");
    expect(claves(r.violaciones)).toContain("sobre_capacidad");
  });

  it("regla 4: 0.15 + 0.15 + 9.7 son exactamente 10 y no pasan de la capacidad", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 0.15), o("b", "pharr", "c2", 0.15), o("c", "pharr", "c3", 9.7)],
      [P("a"), P("b"), P("c"), D("a"), D("b"), D("c")],
    ));
    expect(r.violaciones).toEqual([]);
    expect(r.valida).toBe(true);
  });

  it("regla 5: entregar antes de recoger es descarga_de_lo_que_no_va_a_bordo", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2)],
      [D("a"), P("a")],
    ));
    const v = r.violaciones.find((x) => x.clave === "descarga_de_lo_que_no_va_a_bordo");
    expect(v?.regla).toBe(5);
    expect(v?.indice).toBe(0);
  });

  it("regla 1: entrega sin recogida es entrega_sin_recogida; con recogidaHecha es válida", () => {
    const sin = validaLaRuta(entrada([o("a", "pharr", "c1", 2)], [D("a")]));
    expect(claves(sin.violaciones)).toContain("entrega_sin_recogida");

    const con = validaLaRuta(entrada([o("a", "pharr", "c1", 2, { recogidaHecha: true })], [D("a")]));
    expect(con.valida).toBe(true);
    expect(con.violaciones).toEqual([]);
  });

  it("regla 6: mover una parada ya hecha es parada_hecha_movida", () => {
    const r = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2), o("b", "pharr", "weslaco", 2)],
      [P("b"), P("a"), D("a"), D("b")],
      { hechas: [P("a"), D("a")] },
    ));
    const movidas = r.violaciones.filter((x) => x.clave === "parada_hecha_movida");
    expect(movidas.map((x) => x.indice)).toContain(0);
    expect(r.valida).toBe(false);
  });

  it("regla 7: llegada tarde a una ventana estrecha es violación; a una ancha, solo aviso; sin llegadas, nada", () => {
    const estrecha = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2, { ventana: [500, 600], estrecha: true })],
      [P("a"), D("a")],
      { llegadas: [500, 620] },
    ));
    expect(estrecha.valida).toBe(false);
    expect(claves(estrecha.violaciones)).toContain("fuera_de_ventana_estrecha");

    const ancha = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2, { ventana: [500, 600], estrecha: false })],
      [P("a"), D("a")],
      { llegadas: [500, 620] },
    ));
    expect(ancha.valida).toBe(true);
    const aviso = ancha.avisos.find((x) => x.clave === "fuera_de_ventana");
    expect(aviso?.regla).toBe(7);
    expect(aviso?.detalle).toContain("20");

    const sinLlegadas = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2, { ventana: [500, 600], estrecha: true })],
      [P("a"), D("a")],
    ));
    expect(sinLlegadas.valida).toBe(true);
    expect(sinLlegadas.avisos).toEqual([]);
  });

  it("regla 8: orden esperada que falta es orden_saltada; reportada sin punto, no", () => {
    const falta = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2)],
      [P("a"), D("a")],
      { esperadas: ["a", "x"] },
    ));
    const v = falta.violaciones.find((x) => x.clave === "orden_saltada");
    expect(v?.indice).toBe(-1);
    expect(v?.ordenes).toEqual(["x"]);

    const reportada = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2)],
      [P("a"), D("a")],
      { esperadas: ["a", "x"], reportadasSinPunto: ["x"] },
    ));
    expect(reportada.valida).toBe(true);
  });

  it("regla 8: una parada sin punto es parada_sin_punto, y una orden desconocida no rompe nada", () => {
    const sinPunto = validaLaRuta(entrada(
      [o("y", "pharr", null, 2)],
      [P("y"), D("y")],
    ));
    const v = sinPunto.violaciones.find((x) => x.clave === "parada_sin_punto");
    expect(v?.indice).toBe(1);

    const desconocida = validaLaRuta(entrada(
      [o("a", "pharr", "c1", 2)],
      [P("a"), D("a"), P("zz")],
    ));
    const u = desconocida.violaciones.find((x) => x.clave === "orden_desconocida");
    expect(u?.indice).toBe(2);
    expect(u?.ordenes).toEqual(["zz"]);
    expect(desconocida.valida).toBe(false);
  });

  it("no modifica la entrada", () => {
    const ordenes = Object.freeze([
      Object.freeze(o("a", "pharr", "c1", 6)),
      Object.freeze(o("b", "pharr", "c2", 5, { ventana: [500, 600] })),
    ]) as OrdenEntrada[];
    const secuencia = Object.freeze([P("a"), P("b"), D("a"), D("b")]) as ParadaRef[];
    const hechas = Object.freeze([P("a")]) as ParadaRef[];
    const llegadas = Object.freeze([500, 500, 500, 700]) as number[];
    const esperadas = Object.freeze(["a", "b"]) as string[];
    const e = Object.freeze({ chofer: Object.freeze({ ...CHOFER }), ordenes, secuencia, hechas, llegadas, esperadas }) as EntradaDelValidador;

    expect(() => validaLaRuta(e)).not.toThrow();
    expect(() => validaLaRuta(e)).not.toThrow();
    expect(ordenes.length).toBe(2);
    expect(secuencia.length).toBe(4);
    expect(secuencia[0]).toEqual(P("a"));
  });

  it("regla 2: la entrega de una orden cuya recogida está antes en la misma visita no incumple", () => {
    const r = validaLaRuta(entrada([o("a", "pharr", "pharr", 2)], [P("a"), D("a")]));
    expect(r.violaciones.filter((v) => v.clave === "carga_antes_de_descarga")).toEqual([]);
  });

  it("regla 2: en una visita con una entrega de otra orden después de recoger, sí incumple, por esa otra", () => {
    const ordenes = [o("a", "pharr", "pharr", 2), o("y", "c2", "pharr", 2)];
    const r = validaLaRuta(entrada(ordenes, [P("a"), D("a"), D("y")]));
    const v = r.violaciones.find((x) => x.clave === "carga_antes_de_descarga");
    expect(v).toBeDefined();
    expect(v?.indice).toBe(2);
    expect(v?.ordenes).toEqual(["y", "a"]);
  });
});
