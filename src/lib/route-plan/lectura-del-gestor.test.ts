import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lecturaConLoHecho } from "./lectura-del-gestor";
import { filasDelViaje, lecturaDeLaRuta, type ParadaDelPlanMinima } from "./lectura-de-ruta";

/**
 * El aviso «Esta ruta cambió desde que se publicó el plan» en el Gestor, con una orden ya entregada (D-NEXT).
 * Plan publicado de un viaje: P h (McAllen) · P a (Edinburg) · D h · P b (Pharr) · D a · D b. Publicar escribió
 * h = puesto 0, a = 1, b = 2, todas en el viaje 1. `h` ya se entregó: el Gestor no la pinta.
 */
const paradas: ParadaDelPlanMinima[] = [
  { kind: "P", order_ref: "h", seq: 0, label: "P1", load_after: 2, place: "McAllen" },
  { kind: "P", order_ref: "a", seq: 1, label: "P2", load_after: 5, place: "Edinburg" },
  { kind: "D", order_ref: "h", seq: 2, label: "D1", load_after: 3 },
  { kind: "P", order_ref: "b", seq: 3, label: "P3", load_after: 8, place: "Pharr" },
  { kind: "D", order_ref: "a", seq: 4, label: "D2", load_after: 5 },
  { kind: "D", order_ref: "b", seq: 5, label: "D3", load_after: 0 },
];
const orden = (id: string, route_seq: number, store: string) => ({ id, route_seq, load_no: 1, store, est_pallets: 2 });
const h = orden("h", 0, "McAllen"), a = orden("a", 1, "Edinburg"), b = orden("b", 2, "Pharr");

describe("`lecturaConLoHecho`: entregar no es tocar la ruta (D-335)", () => {
  it("el hueco, reproducido: solo con las pendientes, la librería dice que la ruta cambió", () => {
    expect(lecturaDeLaRuta([[a, b]], paradas).cambioTrasPublicar).toBe(true);
  });
  it("con lo ya entregado, la ruta sigue siendo la publicada: manda el plan y no hay aviso", () => {
    const l = lecturaConLoHecho([[a, b]], paradas, [h]);
    expect(l.fuente).toBe("plan");
    expect(l.cambioTrasPublicar).toBe(false);
    expect(l.etiquetaDe.get("a")).toBe("D2");
    expect(l.etiquetaDe.get("b")).toBe("D3");
  });
  it("las recogidas que iban antes de la entrega ya hecha pasan a la siguiente pendiente: no se pierde ninguna fila", () => {
    const l = lecturaConLoHecho([[a, b]], paradas, [h]);
    const filas = filasDelViaje(l, [a, b], true).map((f) => (f.clase === "orden" ? `orden ${f.orden.id}` : f.fila.etiquetas.join("·")));
    expect(filas).toEqual(["P1", "P2", "P3", "orden a", "orden b"]);
  });
  it("si lo hecho es lo último del plan, lo que iba antes sale al final", () => {
    const alrevés: ParadaDelPlanMinima[] = [
      { kind: "P", order_ref: "a", seq: 0, label: "P1", load_after: 2, place: "Edinburg" },
      { kind: "D", order_ref: "a", seq: 1, label: "D1", load_after: 0 },
      { kind: "P", order_ref: "h", seq: 2, label: "P2", load_after: 2, place: "McAllen" },
      { kind: "D", order_ref: "h", seq: 3, label: "D2", load_after: 0 },
    ];
    const l = lecturaConLoHecho([[{ ...a, route_seq: 0 }]], alrevés, [{ ...h, route_seq: 0, load_no: 2 }]);
    expect(l.fuente).toBe("plan");
    expect(l.alFinal.map((f) => f.etiquetas.join("·"))).toEqual(["P2"]);
  });
  it("una pendiente movida a mano SÍ avisa, aunque haya entregadas", () => {
    const l = lecturaConLoHecho([[{ ...b, route_seq: 1 }, { ...a, route_seq: 2 }]], paradas, [h]);
    expect(l.cambioTrasPublicar).toBe(true);
    expect(l.fuente).toBe("derivada");
    // Y es la lectura de SIEMPRE, la de las pendientes: la entregada no se cuela como un viaje más ni deja recogidas al final.
    expect(l.etiquetaDe.has("h")).toBe(false);
    expect(l.alFinal).toEqual([]);
    expect([...l.etiquetaDe]).toEqual([...lecturaDeLaRuta([[{ ...b, route_seq: 1 }, { ...a, route_seq: 2 }]], paradas).etiquetaDe]);
  });
  it("una pendiente añadida SÍ avisa", () => {
    expect(lecturaConLoHecho([[a, b, orden("c", 3, "Pharr")]], paradas, [h]).cambioTrasPublicar).toBe(true);
  });
  it("una pendiente quitada (a otro chofer) SÍ avisa", () => {
    expect(lecturaConLoHecho([[a]], paradas, [h]).cambioTrasPublicar).toBe(true);
  });
  it("sin plan, o sin nada hecho, es la lectura de siempre", () => {
    expect(lecturaConLoHecho([[a, b]], null, [h]).fuente).toBe("derivada");
    expect(lecturaConLoHecho([[a, b]], paradas, []).cambioTrasPublicar).toBe(true);
  });
});

describe("la pantalla le pasa lo hecho", () => {
  const pagina = readFileSync(join(__dirname, "..", "..", "app", "(app)", "routes", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("la tarjeta y el mapa leen con `lecturaConLoHecho` y lo hecho de esa ruta", () => {
    expect(pagina).toContain("const lectura = lecturaConLoHecho(trips, paradasPublicadasDe(u.driver), hechasDeLaRuta(u.key, stops));");
    expect(pagina).toContain("paradasPublicadasDe(list[0].assigned_driver), hechasDeLaRuta(laneKey, list));");
    expect(pagina).not.toContain("lecturaDeLaRuta(");
  });
});
