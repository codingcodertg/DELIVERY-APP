import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lecturaConLoHecho } from "./lectura-del-gestor";
import { lecturaDeLaRuta, type ParadaDelPlanMinima } from "./lectura-de-ruta";

/**
 * El aviso «Esta ruta cambió desde que se publicó el plan» en el Gestor, con una orden ya entregada (D-433).
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
    expect(lecturaDeLaRuta([a, b], 12, paradas).cambioTrasPublicar).toBe(true);
  });
  it("con lo ya entregado, la ruta sigue siendo la publicada: manda el plan y no hay aviso", () => {
    const l = lecturaConLoHecho([a, b], 12, paradas, [h]);
    expect(l.fuente).toBe("plan");
    expect(l.cambioTrasPublicar).toBe(false);
    expect(l.etiquetaDe.get("a")).toBe("D2");
    expect(l.etiquetaDe.get("b")).toBe("D3");
  });
  it("D-443: la lista es la del plan SIN lo ya hecho — ni su recogida ni su entrega —, y lo pendiente, donde el plan lo puso", () => {
    // Hasta D-443 las recogidas de la entregada (P1) se pasaban a la siguiente pendiente. En la lista única, con su cuenta
    // de pallets, una recogida ya hecha contaría pallets que ya no van en el camión: sale con su entrega.
    const l = lecturaConLoHecho([a, b], 12, paradas, [h]);
    expect(l.filas.map((f) => f.etiqueta)).toEqual(["P2", "P3", "D2", "D3"]);
    // La carga de cada parada es la que el plan le dio (lo que cambia `load_after` de una a otra).
    expect(l.filas.map((f) => f.cambio)).toEqual([3, 5, -3, -5]);
  });
  it("si lo hecho es lo último del plan, la lista acaba en la última pendiente", () => {
    const alrevés: ParadaDelPlanMinima[] = [
      { kind: "P", order_ref: "a", seq: 0, label: "P1", load_after: 2, place: "Edinburg" },
      { kind: "D", order_ref: "a", seq: 1, label: "D1", load_after: 0 },
      { kind: "P", order_ref: "h", seq: 2, label: "P2", load_after: 2, place: "McAllen" },
      { kind: "D", order_ref: "h", seq: 3, label: "D2", load_after: 0 },
    ];
    // Publicada antes de D-443, por viajes: h en el viaje 2, puesto 0. Se reconoce, y lo que se pinta es lo pendiente.
    const l = lecturaConLoHecho([{ ...a, route_seq: 0 }], 12, alrevés, [{ ...h, route_seq: 0, load_no: 2 }]);
    expect(l.fuente).toBe("plan");
    expect(l.filas.map((f) => f.etiqueta)).toEqual(["P1", "D1"]);
  });
  it("una pendiente movida a mano SÍ avisa, aunque haya entregadas", () => {
    const l = lecturaConLoHecho([{ ...b, route_seq: 1 }, { ...a, route_seq: 2 }], 12, paradas, [h]);
    expect(l.cambioTrasPublicar).toBe(true);
    expect(l.fuente).toBe("derivada");
    // Y es la lectura de SIEMPRE, la de las pendientes: la entregada no se cuela en la lista.
    expect(l.etiquetaDe.has("h")).toBe(false);
    expect(l.filas.some((f) => (f.tipo === "P" ? f.ordenes.includes("h") : f.orden === "h"))).toBe(false);
    expect([...l.etiquetaDe]).toEqual([...lecturaDeLaRuta([{ ...b, route_seq: 1 }, { ...a, route_seq: 2 }], 12, paradas).etiquetaDe]);
  });
  it("una pendiente añadida SÍ avisa", () => {
    expect(lecturaConLoHecho([a, b, orden("c", 3, "Pharr")], 12, paradas, [h]).cambioTrasPublicar).toBe(true);
  });
  it("una pendiente quitada (a otro chofer) SÍ avisa", () => {
    expect(lecturaConLoHecho([a], 12, paradas, [h]).cambioTrasPublicar).toBe(true);
  });
  it("sin plan, o sin nada hecho, es la lectura de siempre", () => {
    expect(lecturaConLoHecho([a, b], 12, null, [h]).fuente).toBe("derivada");
    expect(lecturaConLoHecho([a, b], 12, paradas, []).cambioTrasPublicar).toBe(true);
  });
});

describe("la pantalla le pasa lo hecho", () => {
  const pagina = readFileSync(join(__dirname, "..", "..", "app", "(app)", "routes", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("la tarjeta y el mapa leen con `lecturaConLoHecho` y lo hecho de esa ruta", () => {
    // D-443: un solo sitio, `lecturaDe`, para la tarjeta, el mapa, el arrastre, «Mejor lugar» y las flechas.
    expect(pagina).toContain("lecturaConLoHecho(stops, capacityFor(driverOf(laneKey)), paradasPublicadasDe(laneKey), hechasDeLaRuta(laneKey, stops));");
    expect(pagina).toContain("const lectura = lecturaDe(u.key, stops);");
    // **Puesto al día por D-467**: el mapa lo pinta `puntosDeLasRutas` (lib/mapa-de-rutas), con la `lecturaDe` que le pasa
    // la pantalla — la misma del Gestor en «Ruta de hoy».
    expect(readFileSync(join(__dirname, "..", "mapa-de-rutas.ts"), "utf8")).toContain("const lectura = e.lecturaDe(laneKey, list);");
    expect(pagina).toContain("lecturaDe, coordsDeTienda, t,");
    expect(pagina).not.toContain("lecturaDeLaRuta(");
  });
});
