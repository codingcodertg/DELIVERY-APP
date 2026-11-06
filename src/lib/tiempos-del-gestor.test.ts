import { describe, expect, it } from "vitest";
import { POSICION_RECIENTE_MIN, enOrdenDeEjecucion, loQueLeQuedaAlCamion, millasEntre, relojDeLaRuta, type PuntoDelReloj } from "./salida-de-la-medida";
import { conHorasDeAhora, firmaDeLaForma, horasDeLaMedida, mideLaLista } from "./usa-medida-de-rutas";
import { textoDeLaLlegada } from "./medida-de-ruta";
import type { ParadaDeLaLista } from "./lista-unica";

/* D-906 (2026-11-06) · Roberto (admin), en el Gestor de Rutas a las 09:25: «Something is off with the times». La ruta de
 * Ernesto Castillo decía «Base: salida 01:43» y sus paradas pendientes 02:04, 02:51, 03:11 … 07:18 —de madrugada—; lo ya
 * hecho, «prevista 14:52, real 08:55, −357 min». Ernesto había empezado por el final de su lista.
 *
 * Aquí va esa ruta con sus tiendas de verdad (las coordenadas de Ajustes) y las horas reales de ese día; los pines de los
 * clientes son aproximados y los ids, sus códigos de orden. El «router» de la prueba mide en línea recta a 30 mph: lo que
 * se prueba es el reloj, no las carreteras. */

const DIA = "2026-11-06"; // Texas en CST: UTC−6
const A_LAS = (hhmm: string, s = "00") => `${DIA}T${String(Number(hhmm.slice(0, 2)) + 6).padStart(2, "0")}:${hhmm.slice(3)}:${s}Z`;
const AHORA_A = (hhmm: string) => new Date(A_LAS(hhmm));
const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

const TIENDAS: Record<string, { lat: number; lng: number }> = {
  "RDZ Edinburg": { lat: 26.3087493, lng: -98.2084674 }, "RDZ McAllen": { lat: 26.2082975, lng: -98.2685755 },
  "RDZ Pharr": { lat: 26.204119, lng: -98.168577 }, "RDZ Brownsville": { lat: 25.9591834, lng: -97.5094019 },
};
const BASE = TIENDAS["RDZ McAllen"];
const PIN: Record<string, { lat: number; lng: number }> = {
  FW186: { lat: 26.23, lng: -98.24 }, FW183: { lat: 26.215, lng: -98.25 }, FW182: { lat: 26.258, lng: -98.318 }, FW187: { lat: 26.216, lng: -98.325 },
  FW160: TIENDAS["RDZ Brownsville"], FW167: TIENDAS["RDZ Brownsville"], FW175: TIENDAS["RDZ Brownsville"], FW177: TIENDAS["RDZ Brownsville"],
  FW170: TIENDAS["RDZ McAllen"], FW176: TIENDAS["RDZ McAllen"], FW184: TIENDAS["RDZ McAllen"],
};
type Orden = { id: string; stage: string; pickup_gps_at?: string | null; pod_delivered_at?: string | null; delivery_lat: number; delivery_lng: number; delivery_duration: string; pickup_duration: string; delivery_date: string };
const orden = (id: string, stage: string, extra: Partial<Orden> = {}): Orden => ({ id, stage, delivery_lat: PIN[id].lat, delivery_lng: PIN[id].lng, delivery_duration: "10", pickup_duration: "8", delivery_date: DIA, ...extra });
// Como estaba a las 09:25: lo de Pharr (el final de la lista) ya hecho; todo lo demás, pendiente.
const ORDENES: Orden[] = [
  orden("FW186", "fulfilling"), orden("FW183", "fulfilling"), orden("FW182", "fulfilling"), orden("FW187", "pending"),
  orden("FW160", "approved"), orden("FW167", "fulfilling"), orden("FW175", "approved"), orden("FW177", "approved"),
  orden("FW170", "delivered", { pickup_gps_at: A_LAS("08:14", "16"), pod_delivered_at: A_LAS("08:14", "20") }),
  orden("FW176", "delivered", { pickup_gps_at: A_LAS("08:55", "23"), pod_delivered_at: A_LAS("08:55", "41") }),
  orden("FW184", "delivered", { pickup_gps_at: A_LAS("08:55", "19"), pod_delivered_at: A_LAS("08:55", "45") }),
];
// La lista del día, en el orden de la tabla de la captura.
const LISTA: ParadaDeLaLista[] = [
  { tipo: "P", ordenes: ["FW182", "FW183", "FW167", "FW186"], tienda: "RDZ Edinburg" },
  { tipo: "D", orden: "FW186" }, { tipo: "D", orden: "FW183" }, { tipo: "D", orden: "FW182" },
  { tipo: "P", ordenes: ["FW187"], tienda: "RDZ McAllen" }, { tipo: "D", orden: "FW187" },
  { tipo: "P", ordenes: ["FW160", "FW175", "FW177"], tienda: "RDZ McAllen" },
  { tipo: "D", orden: "FW160" }, { tipo: "D", orden: "FW167" }, { tipo: "D", orden: "FW175" },
  { tipo: "P", ordenes: ["FW170"], tienda: "RDZ Pharr" }, { tipo: "D", orden: "FW170" },
  { tipo: "D", orden: "FW177" },
  { tipo: "P", ordenes: ["FW176", "FW184"], tienda: "RDZ Pharr" }, { tipo: "D", orden: "FW176" }, { tipo: "D", orden: "FW184" },
];
const nombre = (p: ParadaDeLaLista) => (p.tipo === "P" ? `P:${p.ordenes.join(",")}` : p.orden);
const PENDIENTES_EN_LISTA = ["P:FW182,FW183,FW167,FW186", "FW186", "FW183", "FW182", "P:FW187", "FW187", "P:FW160,FW175,FW177", "FW160", "FW167", "FW175", "FW177"];

/** El router de la prueba: los tramos del camino que se le pide, en línea recta a 30 mph. Apunta en `pedidos` lo que se le pidió. */
const routerDeLaPrueba = (pedidos: string[][] = []) => async (_url: string, init: RequestInit) => {
  const cuerpo = JSON.parse(String(init.body)) as { stops: { id: string; lat: number; lng: number }[]; roundtrip: boolean };
  pedidos.push(cuerpo.stops.map((s) => s.id));
  const camino = cuerpo.roundtrip ? [...cuerpo.stops, cuerpo.stops[0]] : cuerpo.stops;
  const legs = camino.slice(1).map((p, i) => Math.round((millasEntre(camino[i], p) / 30) * 3600));
  return { ok: true, json: async () => ({ miles: 100, duration_seconds: legs.reduce((a, b) => a + b, 0), legs, geometry: [], provider: "prueba", traffic: false }) };
};
const mide = (lista: readonly ParadaDeLaLista[], ordenes: readonly Orden[], ahora: Date, pedidos: string[][] = [], extras = {}) =>
  mideLaLista({ lista, ordenes, base: [BASE.lat, BASE.lng], coordsDeTienda: (n) => TIENDAS[n ?? ""] ?? null, fecha: DIA, pide: routerDeLaPrueba(pedidos), ahora, extras });

describe("la captura de Roberto: Ernesto empezó por el final de su lista", () => {
  it("el camino se pide en el orden en que la ruta se está haciendo: lo hecho por su hora real, luego lo pendiente en el orden de la lista", async () => {
    const pedidos: string[][] = [];
    await mide(LISTA, ORDENES, AHORA_A("09:25"), pedidos);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toEqual(["__depot__", "P:FW170", "FW170", "P:FW176,FW184", "FW176", "FW184", ...PENDIENTES_EN_LISTA]);
    expect(enOrdenDeEjecucion(LISTA, ORDENES, DIA).map(nombre)).toEqual(pedidos[0].slice(1));
  });
  it("la base ya no «sale» a la 01:43: sale poco antes de su primera parada hecha (08:14 en Pharr)", async () => {
    const { medida } = await mide(LISTA, ORDENES, AHORA_A("09:25"));
    const salida = min(medida.stat!.start);
    expect(salida).toBeGreaterThanOrEqual(min("07:45"));
    expect(salida).toBeLessThan(min("08:14"));
  });
  it("lo pendiente ya no «llega» de madrugada: todas las horas son de ahora (09:25) en adelante y suben en el orden de la lista", async () => {
    const { medida } = await mide(LISTA, ORDENES, AHORA_A("09:25"));
    const horas = PENDIENTES_EN_LISTA.map((id) => medida.etas[id]);
    expect(horas.every(Boolean)).toBe(true);
    expect(medida.sinHora).toEqual({});
    const m = horas.map(min);
    expect(Math.min(...m)).toBeGreaterThanOrEqual(min("09:25"));
    for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThanOrEqual(m[i - 1]);
    // La primera pendiente (recoger en Edinburg) sale AHORA de McAllen, donde se entregó lo último (08:55): 09:25 + su tramo.
    const tramo = Math.round((millasEntre(TIENDAS["RDZ McAllen"], TIENDAS["RDZ Edinburg"]) / 30) * 60);
    expect(m[0]).toBe(min("09:25") + tramo);
    // Y la vuelta a la base es después de la última parada, no las 09:01.
    expect(min(medida.stat!.end)).toBeGreaterThan(m[m.length - 1]);
  });
  it("lo ya hecho no lleva llegada estimada: la suya es la del plan y su hora real", async () => {
    const { medida } = await mide(LISTA, ORDENES, AHORA_A("09:25"));
    for (const id of ["P:FW170", "FW170", "P:FW176,FW184", "FW176", "FW184"]) expect(medida.etas[id]).toBeUndefined();
  });
  it("con la medida de ANTES (en el orden de la lista) y sin volver a medir, el reloj tampoco inventa la madrugada", () => {
    // Lo que pasa el instante entre que el chofer marca algo fuera de orden y llega la medida nueva: los puntos siguen en
    // el orden de la lista. El salto «última hecha → primera pendiente» se estima con las coordenadas.
    const puntos: PuntoDelReloj[] = LISTA.map((p) => {
      const c = p.tipo === "P" ? TIENDAS[p.tienda!] : PIN[p.orden];
      return { id: nombre(p), servicio: p.tipo === "P" ? 20 : 10, tipo: p.tipo, ordenes: p.tipo === "P" ? p.ordenes : [p.orden], lat: c.lat, lng: c.lng };
    });
    const camino = [BASE, ...puntos.map((p) => ({ lat: p.lat!, lng: p.lng! })), BASE];
    const legs = camino.slice(1).map((p, i) => Math.round((millasEntre(camino[i], p) / 30) * 3600));
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes: ORDENES, fecha: DIA, ahora: AHORA_A("09:25"), base: BASE, fin: BASE });
    expect(r.salida).toBeGreaterThanOrEqual(min("07:45"));
    const m = PENDIENTES_EN_LISTA.map((id) => min(r.etas[id]));
    expect(Math.min(...m)).toBeGreaterThanOrEqual(min("09:25"));
    for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThanOrEqual(m[i - 1]);
  });
});

describe("la forma de la ruta: hacerla en orden no vuelve a medir; hacerla fuera de orden, sí", () => {
  const firma = (ordenes: readonly Orden[]) => firmaDeLaForma(DIA, "Ernesto Castillo", ordenes, LISTA, "RDZ McAllen>RDZ McAllen");
  const nada = ORDENES.map((o) => ({ ...o, stage: "ready", pickup_gps_at: null, pod_delivered_at: null }));
  it("recoger en Edinburg y entregar la primera, en el orden de la lista: la misma forma (D-584)", () => {
    const enOrden = nada.map((o) => (["FW182", "FW183", "FW167", "FW186"].includes(o.id) ? { ...o, stage: o.id === "FW186" ? "delivered" : "picked_up", pickup_gps_at: A_LAS("08:30"), pod_delivered_at: o.id === "FW186" ? A_LAS("09:05") : null } : o));
    expect(firma(enOrden)).toBe(firma(nada));
  });
  it("empezar por el final (lo de Pharr): otra forma, y esa ruta se mide en el orden nuevo", () => {
    expect(firma(ORDENES)).not.toBe(firma(nada));
  });
  it("toques dados a la vez no reordenan: tres recogidas marcadas en el mismo minuto se quedan en el orden de la lista", () => {
    const lista: ParadaDeLaLista[] = [{ tipo: "P", ordenes: ["a"], tienda: "X" }, { tipo: "P", ordenes: ["b"], tienda: "Y" }, { tipo: "D", orden: "a" }, { tipo: "D", orden: "b" }];
    const ordenes = [{ id: "a", stage: "picked_up", pickup_gps_at: A_LAS("12:18", "49") }, { id: "b", stage: "picked_up", pickup_gps_at: A_LAS("12:18", "15") }];
    expect(enOrdenDeEjecucion(lista, ordenes, DIA)).toEqual(lista);
    // Con media hora de diferencia sí: la de la tienda Y fue antes.
    const otras = [{ id: "a", stage: "picked_up", pickup_gps_at: A_LAS("12:48") }, ordenes[1]];
    expect(enOrdenDeEjecucion(lista, otras, DIA).map(nombre)).toEqual(["P:b", "P:a", "a", "b"]);
  });
  it("lo hecho sin hora real va delante (ya pasó, no se sabe cuándo); una recogida a medias va con lo hecho, no se vuelve a ella", () => {
    const lista: ParadaDeLaLista[] = [{ tipo: "P", ordenes: ["a", "b"], tienda: "X" }, { tipo: "D", orden: "a" }, { tipo: "D", orden: "c" }, { tipo: "D", orden: "b" }];
    const ordenes = [{ id: "a", stage: "delivered", pickup_gps_at: A_LAS("09:00"), pod_delivered_at: A_LAS("09:40") }, { id: "b", stage: "ready" }, { id: "c", stage: "delivered" }];
    expect(enOrdenDeEjecucion(lista, ordenes, DIA).map(nombre)).toEqual(["c", "P:a,b", "a", "b"]);
  });
});

describe("un tramo que no se sabe no vale 0: la parada dice «sin hora», no una hora falsa", () => {
  const A = { lat: 26.2, lng: -98.2 }, B = { lat: 26.3, lng: -98.2 }, C = { lat: 26.3, lng: -98.1 };
  const puntos: PuntoDelReloj[] = [
    { id: "a", servicio: 10, tipo: "D", ordenes: ["a"], ...A }, { id: "b", servicio: 10, tipo: "D", ordenes: ["b"], ...B }, { id: "c", servicio: 10, tipo: "D", ordenes: ["c"], ...C },
  ];
  const ordenes = [{ id: "a", stage: "picked_up" }, { id: "b", stage: "picked_up" }, { id: "c", stage: "picked_up" }];
  const base = { lat: 26.1, lng: -98.2 };
  const reloj = (legs: number[]) => relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("07:00"), base, fin: base });
  it("control: con todos los tramos, todas las horas y la vuelta", () => {
    const r = reloj([600, 900, 900, 1200]);
    expect(r.etas).toEqual({ a: "08:10", b: "08:35", c: "09:00" });
    expect(r.sinHora).toEqual({});
    expect(r.clock).toBe(min("09:10") + 20);
  });
  it("el router devolvió menos tramos de los que hay: desde ahí, sin hora (antes valían 0 y las paradas «llegaban» pegadas)", () => {
    const r = reloj([600, 900]);
    expect(r.etas).toEqual({ a: "08:10", b: "08:35" });
    expect(r.sinHora).toEqual({ c: "sin_tramo" });
    expect(r.clock).toBeNull();
  });
  it("un 0 entre dos sitios que están lejos no es un tramo; ni un NaN, ni un negativo", () => {
    for (const malo of [0, Number.NaN, -5]) {
      const r = reloj([600, malo, 900, 1200]);
      expect(r.etas).toEqual({ a: "08:10" });
      expect(r.sinHora).toEqual({ b: "sin_tramo", c: "sin_tramo" });
    }
  });
  it("un 0 entre dos puntos en el MISMO sitio sí vale (dos recogidas en la tienda, la base que es la tienda)", () => {
    const juntos = [puntos[0], { ...puntos[1], ...A }, puntos[2]];
    const r = relojDeLaRuta({ puntos: juntos, legs: [600, 0, 900, 1200], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("07:00"), base, fin: base });
    expect(r.etas).toEqual({ a: "08:10", b: "08:20", c: "08:45" });
  });
  it("la tarjeta y la fila de la base: una hora que no se sabe va vacía; la celda de la parada dice «sin hora» y por qué", () => {
    const h = horasDeLaMedida({ puntos, legs: [600, 900], conBase: true, vuelve: true, fecha: DIA, driveMin: 25, base, fin: base }, ordenes, AHORA_A("07:00"));
    expect(h.stat.start).toBe("08:00");
    expect(h.stat.end).toBe("");
    const celda = textoDeLaLlegada(h.etas.c, "medida", h.sinHora.c, true);
    expect(celda).toMatchObject({ texto: "sin hora", falta: true });
    expect(celda.titulo).toContain("falta el tiempo de viaje de un tramo");
    expect(textoDeLaLlegada(undefined, "medida", "sin_tramo", false).texto).toBe("no time");
    // Mientras se mide, sigue diciendo «calculando…».
    expect(textoDeLaLlegada(undefined, "calculando", "sin_tramo", true).texto).toBe("calculando…");
  });
});

describe("dónde está el camión: en el último toque real, y los toques dicen menos de lo que parece", () => {
  const TIENDA = { lat: 26.2, lng: -98.17 }, CLIENTE = { lat: 26.16, lng: -98.0 }, OTRO = { lat: 26.17, lng: -97.99 };
  const puntos: PuntoDelReloj[] = [
    { id: "P:a,b", servicio: 20, tipo: "P", ordenes: ["a", "b"], ...TIENDA },
    { id: "a", servicio: 10, tipo: "D", ordenes: ["a"], ...CLIENTE },
    { id: "b", servicio: 10, tipo: "D", ordenes: ["b"], ...OTRO },
  ];
  const legs = [0, 1800, 300, 2400]; // la base es la tienda; tienda→cliente 30 min; cliente→otro 5; vuelta 40
  it("«Recogido» y «Entregado» marcados con 31 segundos (Julio, 26 de octubre: 11:09:00 y 11:09:31): el camión está en casa del cliente, no en la tienda", () => {
    const ordenes = [{ id: "a", stage: "delivered", pickup_gps_at: `2026-11-06T17:09:00Z`, pod_delivered_at: `2026-11-06T17:09:31Z` }, { id: "b", stage: "picked_up", pickup_gps_at: `2026-11-06T17:09:00Z` }];
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("11:10"), base: TIENDA, fin: TIENDA });
    // Sale del cliente (11:09 + 10 de descarga) con los 5 minutos hasta el otro: no vuelve a contar los 30 desde la tienda.
    expect(r.etas).toEqual({ b: "11:24" });
  });
  it("una recogida A MEDIAS: a lo que falta por marcar no se le pone hora ni se manda al camión de vuelta a la tienda", () => {
    // `a` recogida y entregada; `b`, de la misma visita a la tienda, sin marcar. A las 10:31 (la captura del 26 de octubre).
    const ordenes = [{ id: "a", stage: "delivered", pickup_gps_at: A_LAS("09:37", "19"), pod_delivered_at: A_LAS("09:37", "59") }, { id: "b", stage: "ready" }];
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("10:31"), base: TIENDA, fin: TIENDA });
    expect(r.etas["P:a,b"]).toBeUndefined();
    expect(r.sinHora).toEqual({ "P:a,b": "sin_marcar" });
    expect(r.etas.b).toBe("10:36"); // ahora + 5 min desde el cliente: sin los 30 de ir a la tienda y volver
    const celda = textoDeLaLlegada(r.etas["P:a,b"], "medida", r.sinHora["P:a,b"], true);
    expect(celda.texto).toBe("sin marcar");
    expect(celda.titulo).toContain("no está marcada como recogida");
    expect(textoDeLaLlegada(undefined, "medida", "sin_marcar", false).texto).toBe("not marked");
  });
  it("el camión volvió a la tienda a por más: está ahí desde su ÚLTIMO toque, no desde el primero de la mañana", () => {
    const ordenes = [{ id: "a", stage: "picked_up", pickup_gps_at: A_LAS("08:12") }, { id: "b", stage: "picked_up", pickup_gps_at: A_LAS("12:25") }];
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("12:00"), base: TIENDA, fin: TIENDA });
    expect(r.salida).toBe(min("08:12")); // la base (la tienda) salió con el primer toque
    expect(r.etas.a).toBe("12:55"); // 12:25 + 30
  });
  it("todo hecho: la vuelta a la base es la de la última parada, no «ahora»", () => {
    const ordenes = [{ id: "a", stage: "delivered", pickup_gps_at: A_LAS("09:00"), pod_delivered_at: A_LAS("10:00") }, { id: "b", stage: "delivered", pickup_gps_at: A_LAS("09:00"), pod_delivered_at: A_LAS("10:30") }];
    const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("16:00"), base: TIENDA, fin: TIENDA });
    expect(r.etas).toEqual({});
    expect(r.clock).toBe(min("10:30") + 10 + 40);
  });
  it("cosas hechas y ninguna hora real: la salida no se sabe (no se inventa); hoy lo pendiente sigue desde ahora, otro día se queda sin hora", () => {
    const ordenes = [{ id: "a", stage: "delivered" }, { id: "b", stage: "picked_up" }];
    const hoy = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: AHORA_A("11:00"), base: TIENDA, fin: TIENDA });
    expect(hoy.salida).toBeNull();
    expect(hoy.etas).toEqual({ b: "11:05" });
    const otroDia = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora: new Date("2026-11-07T18:00:00Z"), base: TIENDA, fin: TIENDA });
    expect(otroDia.etas).toEqual({});
    expect(otroDia.sinHora).toEqual({ b: "sin_tramo" });
    expect(horasDeLaMedida({ puntos, legs, conBase: true, vuelve: true, fecha: DIA, driveMin: 75, base: TIENDA, fin: TIENDA }, ordenes, AHORA_A("11:00")).stat.start).toBe("");
  });
});

describe("la salida prevista: la entrada del turno del chofer, y hoy nunca antes de ahora", () => {
  const puntos: PuntoDelReloj[] = [{ id: "a", servicio: 10, tipo: "D", ordenes: ["a"] }];
  const ordenes = [{ id: "a", stage: "picked_up" }];
  const reloj = (ahora: Date, salidaPrevistaMin?: number) => relojDeLaRuta({ puntos, legs: [900, 900], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora, salidaPrevistaMin });
  it("sin turno, las 08:00; con turno a las 07:00 o a las 09:30, ésa", () => {
    const ayer = new Date("2026-11-05T22:00:00Z");
    expect(reloj(ayer).salida).toBe(min("08:00"));
    expect(reloj(ayer, min("07:00")).etas.a).toBe("07:15");
    expect(reloj(ayer, min("09:30")).etas.a).toBe("09:45");
  });
  it("hoy, pasada la hora del turno y sin nada hecho: sale ahora", () => {
    expect(reloj(AHORA_A("10:10"), min("07:00")).etas.a).toBe("10:25");
    expect(reloj(AHORA_A("06:10"), min("07:00")).etas.a).toBe("07:15");
  });
});

describe("la posición del camión (TrackSolid): acorta el primer tramo en lo que ya lleva recorrido, y nada más", () => {
  // De A a B hay ~27,6 millas hacia el este; el router dice 40 minutos. El camión entregó en A a las 10:00 (10 min de descarga).
  const A = { lat: 26.2, lng: -98.2 }, B = { lat: 26.2, lng: -97.755 };
  const puntos: PuntoDelReloj[] = [{ id: "a", servicio: 10, tipo: "D", ordenes: ["a"], ...A }, { id: "b", servicio: 10, tipo: "D", ordenes: ["b"], ...B }];
  const ordenes = [{ id: "a", stage: "delivered", pod_delivered_at: A_LAS("10:00") }, { id: "b", stage: "picked_up" }];
  const AHORA = AHORA_A("10:30");
  const reloj = (camion?: { lat: number; lng: number; en: Date | string } | null, ahora = AHORA) => relojDeLaRuta({ puntos, legs: [600, 2400, 2400], conBase: true, vuelve: true, ordenes, fecha: DIA, ahora, camion });
  const hace = (m: number) => new Date(AHORA.getTime() - m * 60_000);
  it("sin posición: sale ahora (10:30) y hace el tramo entero: 11:10", () => {
    expect(reloj().etas.b).toBe("11:10");
    expect(reloj(null).etas.b).toBe("11:10");
  });
  it("a medio camino hace 2 minutos: le queda la mitad del tramo: 10:50", () => {
    const medio = { lat: 26.2, lng: (A.lng + B.lng) / 2, en: hace(2) };
    expect(loQueLeQuedaAlCamion(A, B, medio, AHORA)).toBeCloseTo(0.5, 2);
    expect(reloj(medio).etas.b).toBe("10:50");
  });
  it("ya está en la parada siguiente: llega ahora", () => {
    expect(reloj({ ...B, en: hace(1) }).etas.b).toBe("10:30");
  });
  it(`una posición de hace más de ${POSICION_RECIENTE_MIN} minutos no se usa (el 6 de noviembre la del camión de Ernesto tenía 25)`, () => {
    const medio = { lat: 26.2, lng: (A.lng + B.lng) / 2 };
    expect(reloj({ ...medio, en: hace(POSICION_RECIENTE_MIN + 1) }).etas.b).toBe("11:10");
    expect(reloj({ ...medio, en: "no es una fecha" }).etas.b).toBe("11:10");
    expect(reloj({ ...medio, en: hace(POSICION_RECIENTE_MIN - 1) }).etas.b).toBe("10:50");
  });
  it("si el camión sigue en la parada anterior, o se alejó, el tramo no cambia: nunca lo alarga", () => {
    expect(reloj({ ...A, en: hace(1) }).etas.b).toBe("11:10");
    const lejos = { lat: 26.2, lng: -98.6, en: hace(1) }; // al oeste de A: más lejos de B que A
    expect(loQueLeQuedaAlCamion(A, B, lejos, AHORA)).toBe(1);
    expect(reloj(lejos).etas.b).toBe("11:10");
  });
  it("sin nada hecho todavía no se usa (el camión puede estar aparcado en cualquier sitio), ni otro día", () => {
    const medio = { lat: 26.2, lng: (A.lng + B.lng) / 2, en: hace(2) };
    const nada = [{ id: "a", stage: "picked_up" }, { id: "b", stage: "picked_up" }];
    const sinHechas = relojDeLaRuta({ puntos, legs: [600, 2400, 2400], conBase: true, vuelve: true, ordenes: nada, fecha: DIA, ahora: AHORA, camion: medio, base: A });
    expect(sinHechas.etas).toEqual({ a: "10:40", b: "11:30" });
    expect(reloj({ ...medio, en: new Date("2026-11-07T16:28:00Z") }, new Date("2026-11-07T16:30:00Z")).etas.b).toBe("10:50"); // otro día: 10:00 + 10 + 40, sin camión
  });
  it("`conHorasDeAhora` rehace las horas con el camión sin volver a medir", async () => {
    let llamadas = 0;
    const lista: ParadaDeLaLista[] = [{ tipo: "D", orden: "a" }, { tipo: "D", orden: "b" }];
    const conPin = [{ ...ordenes[0], delivery_lat: A.lat, delivery_lng: A.lng, delivery_duration: "10" }, { ...ordenes[1], delivery_lat: B.lat, delivery_lng: B.lng, delivery_duration: "10" }];
    const { medida } = await mideLaLista({ lista, ordenes: conPin, base: [26.3, -98.2], coordsDeTienda: () => null, fecha: DIA, ahora: AHORA, pide: async () => { llamadas++; return { ok: true, json: async () => ({ miles: 60, duration_seconds: 5400, legs: [600, 2400, 2400] }) }; } });
    expect(medida.etas.b).toBe("11:10");
    const conCamion = conHorasDeAhora(medida, conPin, AHORA, { camion: { lat: 26.2, lng: (A.lng + B.lng) / 2, en: hace(2) } });
    expect(conCamion.etas.b).toBe("10:50");
    expect(llamadas).toBe(1);
  });
});

describe("pase lo que pase: lo pendiente sube en el orden de la medida y hoy nunca cae en el pasado", () => {
  // Rutas al azar (con semilla): paradas hechas en cualquier orden, a cualquier hora, con y sin hora real.
  let semilla = 20261106;
  const azar = () => { semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0; return semilla / 2 ** 32; };
  it("500 rutas al azar", () => {
    for (let caso = 0; caso < 500; caso++) {
      const n = 2 + Math.floor(azar() * 9);
      const puntos: PuntoDelReloj[] = [], ordenes: { id: string; stage: string; pickup_gps_at?: string; pod_delivered_at?: string }[] = [];
      for (let i = 0; i < n; i++) {
        const id = `o${i}`, hecha = azar() < 0.45, conHora = azar() < 0.85;
        const hora = `${String(8 + Math.floor(azar() * 6)).padStart(2, "0")}:${String(Math.floor(azar() * 60)).padStart(2, "0")}`;
        puntos.push({ id, servicio: Math.floor(azar() * 30), tipo: "D", ordenes: [id], lat: 26 + azar() * 0.4, lng: -98.4 + azar() * 0.9 });
        ordenes.push({ id, stage: hecha ? "delivered" : "picked_up", ...(hecha && conHora ? { pod_delivered_at: A_LAS(hora) } : {}) });
      }
      const legs = Array.from({ length: n + 1 }, () => Math.floor(azar() * 3000));
      const ahora = AHORA_A(`${String(7 + Math.floor(azar() * 10)).padStart(2, "0")}:${String(Math.floor(azar() * 60)).padStart(2, "0")}`);
      const base = { lat: 26.2, lng: -98.27 };
      const r = relojDeLaRuta({ puntos, legs, conBase: true, vuelve: true, ordenes, fecha: DIA, ahora, base, fin: base });
      const ahoraMin = ahora.getUTCHours() * 60 + ahora.getUTCMinutes() - 360;
      const horas = puntos.filter((p) => r.etas[p.id]).map((p) => min(r.etas[p.id]));
      for (let i = 0; i < horas.length; i++) {
        // (pasada la medianoche el reloj da la vuelta: esas rutas imposibles no se miran)
        if (horas[i] < 6 * 60) continue;
        expect(horas[i], `caso ${caso}: en el pasado`).toBeGreaterThanOrEqual(ahoraMin);
        if (i > 0 && horas[i - 1] >= 6 * 60) expect(horas[i], `caso ${caso}: baja`).toBeGreaterThanOrEqual(horas[i - 1]);
      }
      // Lo hecho nunca lleva llegada estimada, y cada pendiente tiene hora o dice por qué no.
      for (const p of puntos) {
        const hecha = ordenes.find((o) => o.id === p.id)!.stage === "delivered";
        if (hecha) expect(r.etas[p.id]).toBeUndefined();
        else expect(!!r.etas[p.id] || !!r.sinHora[p.id]).toBe(true);
      }
      if (r.salida != null) expect(r.salida).toBeGreaterThanOrEqual(0);
    }
  });
});
