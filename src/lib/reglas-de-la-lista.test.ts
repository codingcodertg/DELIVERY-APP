import { describe, expect, it } from "vitest";
import type { ParadaDeLaLista } from "./lista-unica";
import { aLista, aSecuencia, arreglaLaLista, validaLaLista, type OrdenDeLaLista } from "./reglas-de-la-lista";

const P = (tienda: string | null, ...ordenes: string[]): ParadaDeLaLista => ({ tipo: "P", ordenes, tienda });
const D = (orden: string): ParadaDeLaLista => ({ tipo: "D", orden });
const clave = (xs: readonly { clave: string }[]): string[] => xs.map((x) => x.clave);
const copia = (l: ParadaDeLaLista[]): ParadaDeLaLista[] => JSON.parse(JSON.stringify(l));

describe("aSecuencia y aLista", () => {
  const ordenes: OrdenDeLaLista[] = [
    { id: "a", origen: "T", destino: "X", pallets: 2 },
    { id: "b", origen: "T", destino: "Y", pallets: 2 },
    { id: "c", origen: "Z", destino: "W", pallets: 2 },
  ];

  it("ida y vuelta: la lista canónica sale igual", () => {
    const x: ParadaDeLaLista[] = [P("T", "a", "b"), P("Z", "c"), D("c"), D("a"), D("b")];
    expect(aLista(aSecuencia(x), ordenes)).toEqual(x);
  });

  it("ida y vuelta: cada recogida en su tienda, con sus entregas", () => {
    const x: ParadaDeLaLista[] = [P("T", "a"), D("a"), P("T", "b"), D("b")];
    expect(aLista(aSecuencia(x), ordenes)).toEqual(x);
  });

  it("aSecuencia pone una P por orden, en el orden de la fila", () => {
    expect(aSecuencia([P("T", "a", "b"), D("a")])).toEqual([
      { orden: "a", tipo: "P" }, { orden: "b", tipo: "P" }, { orden: "a", tipo: "D" },
    ]);
  });

  it("nunca junta dos recogidas separadas por otra parada", () => {
    const x: ParadaDeLaLista[] = [P("T", "a"), D("c"), P("T", "b"), D("a"), D("b")];
    expect(aLista(aSecuencia(x), ordenes)).toEqual(x);
  });

  it("una orden sin tienda no se junta con otra sin tienda", () => {
    const sinTienda: OrdenDeLaLista[] = [
      { id: "p", origen: null, destino: "X", pallets: 1 },
      { id: "q", origen: null, destino: "Y", pallets: 1 },
    ];
    expect(aLista([{ orden: "p", tipo: "P" }, { orden: "q", tipo: "P" }], sinTienda)).toEqual([P(null, "p"), P(null, "q")]);
  });
});

describe("validaLaLista", () => {
  // Un camión de 10 pallets: en S1 se recoge «a» (destino V); en V se recoge «b» (destino X) antes de entregar «a».
  const ordenesCarga: OrdenDeLaLista[] = [
    { id: "a", origen: "S1", destino: "V", pallets: 2 },
    { id: "b", origen: "V", destino: "X", pallets: 2 },
  ];

  it("una carga antes que una descarga en la misma tienda incumple la regla 2", () => {
    const r = validaLaLista([P("S1", "a"), P("V", "b"), D("a"), D("b")], ordenesCarga, 10);
    expect(r.valida).toBe(false);
    expect(clave(r.violaciones)).toContain("carga_antes_de_descarga");
  });

  it("el mismo viaje con la descarga primero no tiene regla 2", () => {
    const r = validaLaLista([P("S1", "a"), D("a"), P("V", "b"), D("b")], ordenesCarga, 10);
    expect(clave(r.violaciones)).not.toContain("carga_antes_de_descarga");
  });

  it("una orden desconocida se reporta y no revienta", () => {
    const r = validaLaLista([P("T", "zz"), D("zz")], ordenesCarga, 10);
    expect(clave(r.violaciones)).toContain("orden_desconocida");
  });

  it("no cambia la lista de entrada", () => {
    const x: ParadaDeLaLista[] = [P("S1", "a"), P("V", "b"), D("a"), D("b")];
    const antes = copia(x);
    validaLaLista(x, ordenesCarga, 10);
    expect(x).toEqual(antes);
  });
});

describe("arreglaLaLista", () => {
  it("arregla la carga antes que la descarga en el mismo sitio, y la regla 2 desaparece", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "S1", destino: "V", pallets: 2 },
      { id: "b", origen: "V", destino: "X", pallets: 2 },
    ];
    const x: ParadaDeLaLista[] = [P("S1", "a"), P("V", "b"), D("a"), D("b")];
    expect(validaLaLista(x, ordenes, 10).violaciones.length).toBeGreaterThan(0);

    const r = arreglaLaLista(x, ordenes, 10);
    expect(r.cambio).toBe(true);
    expect(clave(validaLaLista(r.lista, ordenes, 10).violaciones)).not.toContain("carga_antes_de_descarga");
    expect(r.lista).toEqual([P("S1", "a"), D("a"), P("V", "b"), D("b")]);
  });

  it("un regreso que se puede evitar se junta: la regla 3 desaparece y las recogidas quedan en UNA fila", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "T", destino: "X", pallets: 2 },
      { id: "c", origen: "Z", destino: "W", pallets: 2 },
      { id: "b", origen: "T", destino: "Y", pallets: 2 },
    ];
    // T, luego Z, y vuelve a T a recoger «b» con el camión todavía cargado: se puede recoger «b» en la primera visita.
    const x: ParadaDeLaLista[] = [P("T", "a"), P("Z", "c"), D("c"), P("T", "b"), D("a"), D("b")];
    const antes = validaLaLista(x, ordenes, 10);
    expect(clave(antes.violaciones)).toContain("regreso_a_la_misma_tienda");

    const r = arreglaLaLista(x, ordenes, 10);
    expect(r.cambio).toBe(true);
    expect(clave(validaLaLista(r.lista, ordenes, 10).violaciones)).not.toContain("regreso_a_la_misma_tienda");
    const recogidasEnT = r.lista.filter((p) => p.tipo === "P" && p.tienda === "T");
    expect(recogidasEnT).toHaveLength(1);
    expect(recogidasEnT[0]).toEqual({ tipo: "P", ordenes: ["a", "b"], tienda: "T" });
  });

  it("un regreso que obliga la capacidad se queda: el validador lo deja como aviso y la lista no cambia", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "T", destino: "X", pallets: 3 },
      { id: "c", origen: "Z", destino: "W", pallets: 3 },
      { id: "b", origen: "T", destino: "Y", pallets: 3 },
    ];
    const x: ParadaDeLaLista[] = [P("T", "a"), P("Z", "c"), D("c"), P("T", "b"), D("a"), D("b")];
    const r = arreglaLaLista(x, ordenes, 5);
    expect(r.cambio).toBe(false);
    expect(r.lista).toEqual(x);
    const v = validaLaLista(x, ordenes, 5);
    expect(clave(v.violaciones)).not.toContain("regreso_a_la_misma_tienda");
    expect(clave(v.avisos)).toContain("regreso_por_capacidad");
  });

  it("las filas ya hechas no se tocan", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "S1", destino: "V", pallets: 2 },
      { id: "b", origen: "V", destino: "X", pallets: 2 },
    ];
    const x: ParadaDeLaLista[] = [P("S1", "a"), P("V", "b"), D("a"), D("b")];
    // La fila de la recogida de «b» ya está hecha: la entrega de «a» no puede pasar delante de ella.
    const r = arreglaLaLista(x, ordenes, 10, 2);
    expect(r.cambio).toBe(false);
    expect(r.lista.slice(0, 2)).toEqual(x.slice(0, 2));
  });

  it("con una fila hecha que no bloquea el arreglo: el resto sí se arregla y la primera fila sigue igual", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "S1", destino: "V", pallets: 2 },
      { id: "b", origen: "V", destino: "X", pallets: 2 },
      { id: "c", origen: "S2", destino: "Q", pallets: 1 },
    ];
    const x: ParadaDeLaLista[] = [P("S2", "c"), P("S1", "a"), P("V", "b"), D("a"), D("b"), D("c")];
    const r = arreglaLaLista(x, ordenes, 10, 1);
    expect(r.lista[0]).toEqual(x[0]);
    expect(validaLaLista(r.lista, ordenes, 10, 1).violaciones.filter((v) => v.clave === "carga_antes_de_descarga")).toEqual([]);
  });

  it("sobre capacidad se avisa y no se arregla", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "T", destino: "X", pallets: 2 },
      { id: "b", origen: "T", destino: "Y", pallets: 2 },
    ];
    const x: ParadaDeLaLista[] = [P("T", "a", "b"), D("a"), D("b")];
    const v = validaLaLista(x, ordenes, 3);
    expect(clave(v.violaciones)).toContain("sobre_capacidad");
    const r = arreglaLaLista(x, ordenes, 3);
    expect(r.cambio).toBe(false);
    expect(r.lista).toEqual(x);
    expect(clave(validaLaLista(r.lista, ordenes, 3).violaciones)).toContain("sobre_capacidad");
  });

  it("una orden desconocida no revienta y la lista no cambia", () => {
    const r = arreglaLaLista([P("T", "zz"), D("zz")], [{ id: "a", origen: "T", destino: "X", pallets: 1 }], 10);
    expect(r.cambio).toBe(false);
    expect(r.lista).toEqual([P("T", "zz"), D("zz")]);
  });

  it("no cambia la lista de entrada", () => {
    const ordenes: OrdenDeLaLista[] = [
      { id: "a", origen: "T", destino: "X", pallets: 2 },
      { id: "c", origen: "Z", destino: "W", pallets: 2 },
      { id: "b", origen: "T", destino: "Y", pallets: 2 },
    ];
    const x: ParadaDeLaLista[] = [P("T", "a"), P("Z", "c"), D("c"), P("T", "b"), D("a"), D("b")];
    const antes = copia(x);
    arreglaLaLista(x, ordenes, 10);
    expect(x).toEqual(antes);
  });
});
