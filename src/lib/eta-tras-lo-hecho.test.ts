import { describe, expect, it } from "vitest";
import { horaHecha, minutosReales, relojDeLaRuta } from "./salida-de-la-medida";
import { conHorasDeAhora, mideLaLista } from "./usa-medida-de-rutas";

// D-NEXT (2026-10-26) · Roberto, ruta de Julio Jijon: «Something is still off with the ETAs». ✓P3 (#FV182) recogida en
// RDZ Pharr a las 09:37; aun así «Base: salida 10:31» y P1/P2 (pendientes, misma tienda) a las 10:31: el reloj salía de la
// base a la hora de medir y recorría lo hecho como si no. Lo hecho ancla el reloj en su hora real y su sitio.

const DIA = "2026-10-20"; // no es el día real de la prueba: sin `ahora`, la medida no lo trata como hoy
const A_LAS = (hhmm: string) => `${DIA}T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, "0")}:${hhmm.slice(3)}:00Z`; // CDT = UTC-5
// «Ahora» en hora LOCAL, como D-602 (`salidaDeLaMedida` lee getHours): 09:30, antes de lo hecho, no sube nada.
const LOCAL = (hhmm: string) => new Date(`${DIA}T${hhmm}:00`);
const AHORA = LOCAL("09:30");

// La forma de la captura: base en Pharr; las tres recogidas de Pharr (una visita); la entrega de #FU571 en Weslaco; otra.
const puntos = [
  { id: "P:FU571,FV215,FV182", servicio: 15, tipo: "P" as const, ordenes: ["FU571", "FV215", "FV182"] },
  { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] },
  { id: "FV215", servicio: 10, tipo: "D" as const, ordenes: ["FV215"] },
];
const legs = [0, 1800, 1200, 2400]; // base→Pharr 0 min (es la base), →Weslaco 30, →siguiente 20, vuelta 40
const ordenes = [
  { id: "FU571", stage: "ready" }, { id: "FV215", stage: "ready" },
  { id: "FV182", stage: "picked_up", pickup_gps_at: A_LAS("09:37") },
];

describe("la hora real en la zona del negocio", () => {
  it("09:37 de Pharr; otro día no cuenta", () => {
    expect(minutosReales(A_LAS("09:37"), DIA)).toBe(9 * 60 + 37);
    expect(minutosReales(A_LAS("09:37"), "2026-10-21")).toBeNull();
    expect(minutosReales(null, DIA)).toBeNull();
  });
  it("una recogida agrupada con una orden hecha: llegó a la hora de ésa, y no está hecha entera", () => {
    const porId = new Map(ordenes.map((o) => [o.id, o]));
    expect(horaHecha(puntos[0], porId, DIA)).toEqual({ real: 9 * 60 + 37, entero: false });
    expect(horaHecha(puntos[1], porId, DIA)).toEqual({ real: null, entero: false });
  });
});

describe("la ruta de Julio: lo pendiente sigue desde la última parada hecha, no desde la base a la hora de medir", () => {
  it("las recogidas pendientes de Pharr a las 09:37, la base sale 09:37, y D1 = 09:37 + 15 + 30", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA });
    expect(r.etas["P:FU571,FV215,FV182"]).toBe("09:37");
    expect(r.salida).toBe(9 * 60 + 37);
    expect(r.etas.FU571).toBe("10:22");
    expect(r.etas.FV215).toBe("10:52");
    expect(r.clock).toBe(9 * 60 + 37 + 15 + 30 + 10 + 20 + 10 + 40);
  });
  it("control: sin nada hecho, como D-602 (sale ahora, 10:31)", () => {
    const nada = ordenes.map((o) => ({ id: o.id, stage: "ready" }));
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes: nada, fecha: DIA, ahora: LOCAL("10:31") });
    expect(r.salida).toBe(10 * 60 + 31);
    expect(r.etas["P:FU571,FV215,FV182"]).toBe("10:31");
    expect(r.etas.FU571).toBe("11:16");
  });
  it("✓P3 en su propia parada después de otra: la salida es su hora menos lo de antes; la parada hecha entera no lleva llegada", () => {
    const sueltos = [
      { id: "P:FU571,FV215", servicio: 15, tipo: "P" as const, ordenes: ["FU571", "FV215"] },
      { id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"] },
      { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] },
    ];
    // base→Pharr 10 min, Pharr→Pharr 0, →Weslaco 30, vuelta 40
    const r = relojDeLaRuta({ puntos: sueltos, legs: [600, 0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA });
    expect(r.salida).toBe(9 * 60 + 37 - 10 - 15 - 0);
    expect(r.etas["P:FU571,FV215"]).toBe("09:22");
    expect(r.etas["P:FV182"]).toBeUndefined();
    expect(r.etas.FU571).toBe("10:12"); // 09:37 + 5 + 30
  });
  it("una entrega hecha más tarde vuelve a anclar: lo siguiente parte de su hora real", () => {
    const conEntrega = [...ordenes.slice(0, 2).map((o) => (o.id === "FU571" ? { ...o, stage: "delivered", pickup_gps_at: A_LAS("09:40"), pod_delivered_at: A_LAS("10:50") } : o)), ordenes[2]];
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes: conEntrega, fecha: DIA, ahora: AHORA });
    expect(r.etas.FU571).toBeUndefined();
    expect(r.etas.FV215).toBe("11:20"); // 10:50 + 10 + 20
  });
});

describe("hoy, lo pendiente detrás de lo hecho no llega en el pasado", () => {
  it("P3 hecha a las 09:37 y son las 11:00: P1/P2 (mismo sitio) 11:00, D1 = 11:00 + 15 + 30; la base sigue saliendo 09:37", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: LOCAL("11:00") });
    expect(r.etas["P:FU571,FV215,FV182"]).toBe("11:00");
    expect(r.etas.FU571).toBe("11:45");
    expect(r.etas.FV215).toBe("12:15");
    expect(r.salida).toBe(9 * 60 + 37);
  });
  it("una parada hecha suelta: lo siguiente = ahora + el tramo desde ella", () => {
    const sueltos = [{ id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"] }, { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] }];
    const r = relojDeLaRuta({ puntos: sueltos, legs: [0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: LOCAL("11:00") });
    expect(r.etas.FU571).toBe("11:30");
  });
  it("control: son las 09:40 y la parada hecha suelta acabó 09:42 (09:37 + 5): sigue desde 09:37, D1 = 10:12 (no 09:40 + 30)", () => {
    const sueltos = [{ id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"] }, { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] }];
    const r = relojDeLaRuta({ puntos: sueltos, legs: [0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: LOCAL("09:40") });
    expect(r.etas.FU571).toBe("10:12");
  });
  it("son las 09:40 en la visita agrupada: P1/P2 pendientes no pueden decir 09:37 (pasado), dicen 09:40", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: LOCAL("09:40") });
    expect(r.etas["P:FU571,FV215,FV182"]).toBe("09:40");
    expect(r.etas.FU571).toBe("10:25");
  });
  it("otro día no tiene «ahora»: sigue desde la hora real", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: new Date("2026-10-21T15:00:00") });
    expect(r.etas["P:FU571,FV215,FV182"]).toBe("09:37");
  });
});

describe("el Gestor: la medida y el repintado sin volver a medir", () => {
  const pide = async () => ({ ok: true, json: async () => ({ miles: 50, duration_seconds: 5400, legs }) });
  const lista = [
    { tipo: "P" as const, ordenes: ["FU571", "FV215", "FV182"], tienda: "RDZ Pharr" },
    { tipo: "D" as const, orden: "FU571" }, { tipo: "D" as const, orden: "FV215" },
  ];
  const conPin = (o: { id: string }) => ({ ...o, delivery_lat: 26.1, delivery_lng: -97.9, delivery_duration: "10", delivery_date: DIA });
  it("`mideLaLista` pinta 09:37 en la salida y en las recogidas de Pharr con FV182 hecha", async () => {
    const { medida } = await mideLaLista({ lista, ordenes: ordenes.map(conPin), base: [26.19, -98.18], coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), fecha: DIA, pide });
    expect(medida.stat?.start).toBe("09:37");
    expect(medida.etas["P:FU571,FV215,FV182"]).toBe("09:37");
  });
  it("`conHorasDeAhora`: hacer la recogida después de medir mueve las horas sin otra llamada", async () => {
    const nada = ordenes.map((o) => conPin({ id: o.id, stage: "ready" } as { id: string }));
    let llamadas = 0;
    const { medida } = await mideLaLista({ lista, ordenes: nada, base: [26.19, -98.18], coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), fecha: DIA, pide: async () => { llamadas++; return pide(); } });
    const despues = conHorasDeAhora(medida, ordenes.map(conPin), AHORA);
    expect(llamadas).toBe(1);
    expect(despues.stat?.start).toBe("09:37");
    expect(despues.stat?.miles).toBe(50);
    expect(despues.etas["P:FU571,FV215,FV182"]).toBe("09:37");
  });
});
