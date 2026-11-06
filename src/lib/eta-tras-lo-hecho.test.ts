import { describe, expect, it } from "vitest";
import { horaHecha, minutosReales, relojDeLaRuta } from "./salida-de-la-medida";
import { conHorasDeAhora, mideLaLista } from "./usa-medida-de-rutas";

// D-691 (2026-10-26) · Roberto, ruta de Julio Jijon: «Something is still off with the ETAs». ✓P3 (#FV182) recogida en
// RDZ Pharr a las 09:37; aun así «Base: salida 10:31» y P1/P2 (pendientes, misma tienda) a las 10:31: el reloj salía de la
// base a la hora de medir y recorría lo hecho como si no. Lo hecho ancla el reloj en su hora real y su sitio.
//
// **Puesto al día por D-906 (2026-11-06)**, con lo que se midió después en los datos de ese mismo día: #FU571, que la
// captura enseñaba «pendiente de recoger» en Pharr, se marcó recogida a las 11:09:00 y entregada a las 11:09:31 en
// Weslaco —iba en el camión desde la mañana, sin marcar—. Por eso una recogida A MEDIAS ya no dice una hora (decía la
// de «ahora») ni suma su carga otra vez: dice «sin marcar», y la ruta sigue desde donde está el camión. Y «ahora» es un
// instante leído en el huso del negocio, no la hora local de quien corre la prueba.

const DIA = "2026-10-20"; // no es el día real de la prueba: sin `ahora`, la medida no lo trata como hoy
const A_LAS = (hhmm: string) => `${DIA}T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, "0")}:${hhmm.slice(3)}:00Z`; // CDT = UTC-5
/** El instante en que en Texas son las `hhmm` de ese día. */
const AHORA_A = (hhmm: string) => new Date(A_LAS(hhmm));
const AHORA = AHORA_A("09:30"); // antes de lo hecho: no sube nada

// La forma de la captura: base en Pharr; las tres recogidas de Pharr (una visita); la entrega de #FU571 en Weslaco; otra.
const P_PHARR = "P:FU571,FV215,FV182";
const puntos = [
  { id: P_PHARR, servicio: 15, tipo: "P" as const, ordenes: ["FU571", "FV215", "FV182"] },
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
  it("la base sale 09:37; lo que falta por marcar en Pharr dice «sin marcar» (no una hora); D1 = 09:37 + 30, sin volver a cargar", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA });
    expect(r.salida).toBe(9 * 60 + 37);
    expect(r.etas[P_PHARR]).toBeUndefined();
    expect(r.sinHora).toEqual({ [P_PHARR]: "sin_marcar" });
    expect(r.etas.FU571).toBe("10:07");
    expect(r.etas.FV215).toBe("10:37"); // 10:07 + 10 + 20
    expect(r.clock).toBe(9 * 60 + 37 + 30 + 10 + 20 + 10 + 40);
  });
  it("control: sin nada hecho, como D-602 (sale ahora, 10:31)", () => {
    const nada = ordenes.map((o) => ({ id: o.id, stage: "ready" }));
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes: nada, fecha: DIA, ahora: AHORA_A("10:31") });
    expect(r.salida).toBe(10 * 60 + 31);
    expect(r.etas[P_PHARR]).toBe("10:31");
    expect(r.etas.FU571).toBe("11:16");
    expect(r.sinHora).toEqual({});
  });
  it("✓P3 en su propia parada, y la medida en el orden en que se hizo: la base sale a su hora menos su tramo, y lo demás sigue desde ella", () => {
    // Lo que mide la pantalla (`enOrdenDeEjecucion`): primero lo hecho. base→Pharr 10 min, Pharr→Pharr 0, →Weslaco 30, vuelta 40.
    const sueltos = [
      { id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"] },
      { id: "P:FU571,FV215", servicio: 15, tipo: "P" as const, ordenes: ["FU571", "FV215"] },
      { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] },
    ];
    const r = relojDeLaRuta({ puntos: sueltos, legs: [600, 0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA });
    expect(r.salida).toBe(9 * 60 + 37 - 10);
    expect(r.etas["P:FV182"]).toBeUndefined(); // hecha entera: su hora es la real
    expect(r.etas["P:FU571,FV215"]).toBe("09:37"); // el camión está en esa tienda
    expect(r.etas.FU571).toBe("10:22"); // 09:37 + 15 + 30
  });
  it("la misma ruta medida en el orden de la LISTA (lo pendiente delante de lo hecho): ya no se le resta lo pendiente a la salida", () => {
    // Hasta D-906: «salida = 09:37 − 10 − 15 − 0 = 09:12» y la recogida pendiente «a las 09:22», en el pasado.
    const enLista = [
      { id: "P:FU571,FV215", servicio: 15, tipo: "P" as const, ordenes: ["FU571", "FV215"], lat: 26.19, lng: -98.18 },
      { id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"], lat: 26.19, lng: -98.18 },
      { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"], lat: 26.16, lng: -97.99 },
    ];
    const r = relojDeLaRuta({ puntos: enLista, legs: [600, 0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("11:00"), base: { lat: 26.3, lng: -98.2 } });
    expect(r.etas["P:FU571,FV215"]).toBe("11:00"); // misma tienda que la hecha: ahora, no 09:22
    expect(r.salida).toBeGreaterThan(9 * 60 + 12);
    expect(r.salida).toBeLessThanOrEqual(9 * 60 + 37);
  });
  it("una entrega hecha más tarde vuelve a anclar: lo siguiente parte de su hora real más su servicio", () => {
    const conEntrega = [...ordenes.slice(0, 2).map((o) => (o.id === "FU571" ? { ...o, stage: "delivered", pickup_gps_at: A_LAS("09:40"), pod_delivered_at: A_LAS("10:50") } : o)), ordenes[2]];
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes: conEntrega, fecha: DIA, ahora: AHORA });
    expect(r.etas.FU571).toBeUndefined();
    expect(r.etas.FV215).toBe("11:20"); // 10:50 + 10 + 20
    expect(r.sinHora).toEqual({ [P_PHARR]: "sin_marcar" }); // FV215 sigue sin marcar en una tienda ya visitada
  });
});

describe("hoy, lo pendiente detrás de lo hecho no llega en el pasado", () => {
  it("P3 hecha a las 09:37 y son las 11:00: D1 = 11:00 + 30; la base sigue saliendo 09:37", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("11:00") });
    expect(r.etas.FU571).toBe("11:30");
    expect(r.etas.FV215).toBe("12:00");
    expect(r.salida).toBe(9 * 60 + 37);
  });
  it("una parada hecha suelta: lo siguiente = ahora + el tramo desde ella", () => {
    const sueltos = [{ id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"] }, { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] }];
    const r = relojDeLaRuta({ puntos: sueltos, legs: [0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("11:00") });
    expect(r.etas.FU571).toBe("11:30");
  });
  it("son las 09:40 y la recogida suelta se marcó 09:37: sale ahora (09:40 + 30); «Recogido» se marca con el camión ya cargado", () => {
    const sueltos = [{ id: "P:FV182", servicio: 5, tipo: "P" as const, ordenes: ["FV182"] }, { id: "FU571", servicio: 10, tipo: "D" as const, ordenes: ["FU571"] }];
    const r = relojDeLaRuta({ puntos: sueltos, legs: [0, 1800, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("09:40") });
    expect(r.etas.FU571).toBe("10:10");
  });
  it("una ENTREGA hecha sí cuenta su descarga: entregada 09:37 con 10 min de servicio y son las 09:40, lo siguiente sale 09:47", () => {
    const dos = [{ id: "A", servicio: 10, tipo: "D" as const, ordenes: ["A"] }, { id: "B", servicio: 10, tipo: "D" as const, ordenes: ["B"] }];
    const hechas = [{ id: "A", stage: "delivered", pod_delivered_at: A_LAS("09:37") }, { id: "B", stage: "picked_up" }];
    const r = relojDeLaRuta({ puntos: dos, legs: [600, 1200, 600], conBase: true, vuelve: true, ordenes: hechas, fecha: DIA, ahora: AHORA_A("09:40") });
    expect(r.etas.B).toBe("10:07"); // 09:37 + 10 + 20
  });
  it("otro día no tiene «ahora»: sigue desde la hora real", () => {
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: new Date("2026-10-21T20:00:00Z") });
    expect(r.etas.FU571).toBe("10:07");
  });
});

describe("el Gestor: la medida y el repintado sin volver a medir", () => {
  const pide = async () => ({ ok: true, json: async () => ({ miles: 50, duration_seconds: 5400, legs }) });
  const lista = [
    { tipo: "P" as const, ordenes: ["FU571", "FV215", "FV182"], tienda: "RDZ Pharr" },
    { tipo: "D" as const, orden: "FU571" }, { tipo: "D" as const, orden: "FV215" },
  ];
  const conPin = (o: { id: string }) => ({ ...o, delivery_lat: 26.1, delivery_lng: -97.9, delivery_duration: "10", delivery_date: DIA });
  it("`mideLaLista` pinta 09:37 en la salida, y «sin marcar» en las recogidas de Pharr con FV182 hecha", async () => {
    const { medida } = await mideLaLista({ lista, ordenes: ordenes.map(conPin), base: [26.19, -98.18], coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), fecha: DIA, pide });
    expect(medida.stat?.start).toBe("09:37");
    expect(medida.etas[P_PHARR]).toBeUndefined();
    expect(medida.sinHora).toEqual({ [P_PHARR]: "sin_marcar" });
  });
  it("`conHorasDeAhora`: hacer la recogida después de medir mueve las horas sin otra llamada", async () => {
    const nada = ordenes.map((o) => conPin({ id: o.id, stage: "ready" } as { id: string }));
    let llamadas = 0;
    const { medida } = await mideLaLista({ lista, ordenes: nada, base: [26.19, -98.18], coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), fecha: DIA, pide: async () => { llamadas++; return pide(); } });
    expect(medida.etas[P_PHARR]).toBe("08:00"); // otro día, sin nada hecho: la salida prevista
    const despues = conHorasDeAhora(medida, ordenes.map(conPin), AHORA);
    expect(llamadas).toBe(1);
    expect(despues.stat?.start).toBe("09:37");
    expect(despues.stat?.miles).toBe(50);
    expect(despues.etas[P_PHARR]).toBeUndefined();
    expect(despues.etas.FU571).toBe("10:07");
  });
});
