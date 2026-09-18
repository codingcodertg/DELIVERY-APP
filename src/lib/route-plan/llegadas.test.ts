import { describe, expect, it } from "vitest";
import {
  MINIMO_PARA_PERCENTILES, OPCIONES_POR_DEFECTO, llegadasDeGPS, metrosEntre, realesDelDia, reporteDePrecision, type ParadaDelPlan, type Posicion,
} from "./llegadas";

/** La hora REAL de cada parada, y cuánto se equivocó la estimada (D-328). Coordenadas inventadas, en una línea
 *  norte-sur donde 0,001° de latitud son unos 111 m. */

const TIENDA = { lat: 26.2, lng: -98.2 }, CASA_A = { lat: 26.21, lng: -98.2 }, CASA_B = { lat: 26.23, lng: -98.2 };
const parada = (id: string, seq: number, kind: "P" | "D", donde: { lat: number; lng: number } | null, extra: Partial<ParadaDelPlan> = {}): ParadaDelPlan =>
  ({ id, driver_id: "c1", delivery_id: id.split("-")[0], seq, kind, lat: donde?.lat ?? null, lng: donde?.lng ?? null, eta: 480 + seq * 30, etd: 490 + seq * 30, ...extra });
const DIA = "2026-03-04T";
const pos = (hhmm: string, donde: { lat: number; lng: number }, extra: Partial<Posicion> = {}): Posicion =>
  ({ driver_id: "c1", lat: donde.lat, lng: donde.lng, accuracy_m: 10, recorded_at: `${DIA}${hhmm}:00.000Z`, ...extra });
const hora = (iso: string | null) => iso?.slice(11, 16) ?? null;
const minutoUTC = (iso: string) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

describe("la distancia", () => {
  it("una milésima de grado de latitud son unos 111 m; el mismo punto, cero", () => {
    expect(Math.round(metrosEntre(TIENDA, { lat: 26.201, lng: -98.2 }))).toBe(111);
    expect(metrosEntre(TIENDA, TIENDA)).toBe(0);
  });
});

describe("llegadas deducidas del GPS", () => {
  const ruta = [parada("a-P", 0, "P", TIENDA), parada("a-D", 1, "D", CASA_A), parada("b-D", 2, "D", CASA_B)];

  it("la PRIMERA posición dentro del radio es la llegada y la última seguida, la salida — lleguen como lleguen las posiciones", () => {
    const rastro = [pos("08:40", CASA_A), pos("08:00", TIENDA), pos("08:12", TIENDA), pos("08:25", { lat: 26.205, lng: -98.2 }), pos("08:47", CASA_A), pos("09:10", CASA_B), pos("08:06", TIENDA)];
    const r = llegadasDeGPS(ruta, rastro);
    expect(r.map((x) => [x.paradaId, hora(x.llegada), hora(x.salida), x.posiciones, x.motivo])).toEqual([
      ["a-P", "08:00", "08:12", 3, null], ["a-D", "08:40", "08:47", 2, null], ["b-D", "09:10", "09:10", 1, null],
    ]);
  });

  it("nada se interpola: pasar de largo a 400 m no es llegar, y cada hueco lleva su motivo", () => {
    const r = llegadasDeGPS([...ruta, parada("c-D", 3, "D", null), parada("d-D", 0, "D", CASA_A, { driver_id: null }), parada("e-D", 0, "D", CASA_A, { driver_id: "c2" })],
      [pos("08:00", TIENDA), pos("08:40", { lat: 26.2136, lng: -98.2 }), pos("09:10", CASA_B)]);
    expect(r.map((x) => [x.paradaId, hora(x.llegada), x.motivo])).toEqual([
      ["a-P", "08:00", null], ["a-D", null, "sin_posiciones_cerca"], ["b-D", "09:10", null], ["c-D", null, "sin_punto"], ["d-D", null, "sin_chofer"], ["e-D", null, "sin_posiciones_ese_dia"],
    ]);
  });

  it("una posición que dice ser mala (precisión peor que el tope) no prueba nada; sin dato de precisión, vale", () => {
    expect(llegadasDeGPS([ruta[0]], [pos("08:00", TIENDA, { accuracy_m: 500 })])[0].motivo).toBe("sin_posiciones_ese_dia");
    expect(hora(llegadasDeGPS([ruta[0]], [pos("08:00", TIENDA, { accuracy_m: null })])[0].llegada)).toBe("08:00");
    expect(hora(llegadasDeGPS([ruta[0]], [pos("08:00", TIENDA, { accuracy_m: OPCIONES_POR_DEFECTO.precisionMaxM })])[0].llegada)).toBe("08:00");
  });

  it("volver a la tienda a recargar es OTRA visita: la segunda recogida no toma la hora de la primera", () => {
    const dosViajes = [parada("a-P", 0, "P", TIENDA), parada("a-D", 1, "D", CASA_A), parada("b-P", 2, "P", TIENDA), parada("b-D", 3, "D", CASA_B)];
    const r = llegadasDeGPS(dosViajes, [pos("08:00", TIENDA), pos("08:10", TIENDA), pos("08:40", CASA_A), pos("09:20", TIENDA), pos("09:30", TIENDA), pos("10:00", CASA_B)]);
    expect(r.map((x) => [hora(x.llegada), hora(x.salida)])).toEqual([["08:00", "08:10"], ["08:40", "08:40"], ["09:20", "09:30"], ["10:00", "10:00"]]);
  });

  it("dos recogidas SEGUIDAS en la misma tienda son una visita física: comparten hora, que es lo que pasó", () => {
    const juntas = [parada("a-P", 0, "P", TIENDA), parada("b-P", 1, "P", TIENDA), parada("a-D", 2, "D", CASA_A)];
    const r = llegadasDeGPS(juntas, [pos("08:00", TIENDA), pos("08:15", TIENDA), pos("08:40", CASA_A)]);
    expect(r.map((x) => [hora(x.llegada), hora(x.salida), x.posiciones])).toEqual([["08:00", "08:15", 2], ["08:00", "08:15", 2], ["08:40", "08:40", 1]]);
  });

  it("un hueco largo dentro del radio parte la visita: la salida es la del primer rato, no la de horas después", () => {
    const r = llegadasDeGPS([ruta[0]], [pos("08:00", TIENDA), pos("08:10", TIENDA), pos("12:00", TIENDA)]);
    expect([hora(r[0].llegada), hora(r[0].salida), r[0].posiciones]).toEqual(["08:00", "08:10", 2]);
  });

  it("las posiciones de otro chofer no cuentan para este", () => {
    expect(llegadasDeGPS([ruta[0]], [pos("08:00", TIENDA, { driver_id: "c2" })])[0].motivo).toBe("sin_posiciones_ese_dia");
  });
});

describe("la mejor hora real disponible, y de dónde sale", () => {
  const ruta = [parada("a-P", 0, "P", TIENDA), parada("a-D", 1, "D", CASA_A), parada("b-P", 2, "P", TIENDA), parada("b-D", 3, "D", CASA_B)];
  const sellos = [{ id: "a", pickup_gps_at: `${DIA}08:09:00.000Z`, pod_delivered_at: `${DIA}08:52:00.000Z`, picked_up_by: "c1", delivered_by: "c1" },
    { id: "b", pickup_gps_at: null, pod_delivered_at: "no es una fecha", picked_up_by: "c1", delivered_by: "c1" }];

  it("GPS si lo hay; si no, el TOQUE del chofer — que es el cierre de la parada: la llegada NO se inventa; si no, el motivo", () => {
    const r = realesDelDia(ruta, [pos("08:00", TIENDA)], sellos);
    expect(r.map((x) => [x.paradaId, x.fuente, hora(x.llegada), hora(x.salida), x.motivo])).toEqual([
      ["a-P", "gps", "08:00", "08:00", null], ["a-D", "toque", null, "08:52", null], ["b-P", null, null, null, "sin_posiciones_cerca"], ["b-D", null, null, null, "sin_posiciones_cerca"],
    ]);
  });

  it("la recogida usa el sello de recogida y la entrega el de entrega, no al revés", () => {
    const r = realesDelDia(ruta.slice(0, 2), [], sellos);
    expect(r.map((x) => [x.fuente, hora(x.salida)])).toEqual([["toque", "08:09"], ["toque", "08:52"]]);
  });

  it("una hora que marcó OTRA persona —o no se sabe quién— no mide dónde estuvo el camión: no entra, y se dice", () => {
    const deOficina = [{ ...sellos[0], picked_up_by: "alguien-de-oficina", delivered_by: null }];
    expect(realesDelDia(ruta.slice(0, 2), [], deOficina).map((x) => [x.fuente, x.salida, x.motivo])).toEqual([[null, null, "la_marco_otra_persona"], [null, null, "la_marco_otra_persona"]]);
    // El autor se mira por parada: quien recogió no tiene por qué ser quien entregó.
    const mitad = [{ ...sellos[0], picked_up_by: "c1", delivered_by: "otro" }];
    expect(realesDelDia(ruta.slice(0, 2), [], mitad).map((x) => x.fuente)).toEqual(["toque", null]);
    // Y con GPS da igual quién tocara: manda el GPS.
    expect(realesDelDia(ruta.slice(0, 1), [pos("08:00", TIENDA)], deOficina)[0].fuente).toBe("gps");
  });
});

describe("el reporte: primero cuánto dato hay, después el error — por fuente y nunca mezclado", () => {
  const N = 10;
  const ruta = Array.from({ length: N }, (_, k) => parada(`o${k}-D`, k, "D", { lat: 26.2 + k / 100, lng: -98.2 }, { eta: 480 + k * 30, etd: 490 + k * 30 }));
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  it("las tres cifras suman el total, y la captura dice cuántos choferes con ruta abrieron turno y mandaron posiciones", () => {
    const otra = parada("z-D", 0, "D", CASA_A, { driver_id: "c2" });
    const reales = realesDelDia([...ruta, otra], [pos(hhmm(480 + 7), { lat: 26.2, lng: -98.2 })], [{ id: "o1", pickup_gps_at: null, pod_delivered_at: `${DIA}${hhmm(520 + 4)}:00.000Z`, picked_up_by: null, delivered_by: "c1" },
      { id: "o2", pickup_gps_at: null, pod_delivered_at: `${DIA}${hhmm(550)}:00.000Z`, picked_up_by: null, delivered_by: "oficina" }]);
    const r = reporteDePrecision([...ruta, otra], reales, minutoUTC, ["c1", "c9"], ["c1"], ["c1", "c9"]);
    expect([r.paradas, r.conGPS, r.conToque, r.sinDato]).toEqual([11, 1, 1, { sin_chofer: 0, sin_punto: 0, sin_posiciones_ese_dia: 1, sin_posiciones_cerca: 7, la_marco_otra_persona: 1 }]);
    expect(r.conGPS + r.conToque + Object.values(r.sinDato).reduce((s, x) => s + x, 0)).toBe(r.paradas);
    expect(r.captura).toEqual({ choferesConRuta: 2, hanIniciadoSesion: 1, conTurno: 1, conPosiciones: 1 });        // «c9» tuvo turno y sesión pero no ruta: no cuenta
    expect([r.llegadaPorGPS, r.cierrePorToque]).toEqual([null, null]);                        // con tan pocas, ni mediana
  });

  it("con muestra suficiente: llegada real − ETA por GPS, con su signo; y SOLO sobre las que tienen dato", () => {
    // Llega tarde 0, 2, 4 … 18 min.
    const rastro = ruta.map((p, k) => pos(hhmm(p.eta + 2 * k), { lat: p.lat!, lng: p.lng! }));
    const r = reporteDePrecision(ruta, realesDelDia(ruta, rastro, []), minutoUTC, ["c1"], ["c1"], ["c1"]);
    expect(N).toBeGreaterThanOrEqual(MINIMO_PARA_PERCENTILES);
    expect(r.llegadaPorGPS).toEqual({ n: 10, medianaMin: 8, p90AbsMin: 16, sesgoMin: 9, dentroDe15: 8 });
    expect([r.conGPS, r.cierrePorToque]).toEqual([10, null]);
  });

  it("el toque se mide contra la SALIDA estimada, es otra estadística, y llegar ANTES sale en negativo", () => {
    const sellos = ruta.map((p, k) => ({ id: `o${k}`, pickup_gps_at: null, pod_delivered_at: `${DIA}${hhmm(p.etd - 5)}:00.000Z`, picked_up_by: null, delivered_by: "c1" }));
    const r = reporteDePrecision(ruta, realesDelDia(ruta, [], sellos), minutoUTC, [], [], []);
    expect(r.cierrePorToque).toEqual({ n: 10, medianaMin: -5, p90AbsMin: 5, sesgoMin: -5, dentroDe15: 10 });
    expect([r.llegadaPorGPS, r.conToque, r.captura]).toEqual([null, 10, { choferesConRuta: 1, hanIniciadoSesion: 0, conTurno: 0, conPosiciones: 0 }]);
  });
});

describe("la hora local de la ruta", () => {
  it("minuto y fecha en la zona del negocio, con horario de verano y de invierno — y el día no es el de UTC", async () => {
    const { minutoEnZona, fechaEnZona } = await import("./llegadas");
    expect(minutoEnZona("2026-07-01T13:30:00.000Z", "America/Chicago")).toBe(510);      // verano: UTC−5 → 08:30
    expect(minutoEnZona("2026-01-15T14:30:00.000Z", "America/Chicago")).toBe(510);      // invierno: UTC−6 → 08:30
    expect(minutoEnZona("2026-07-01T05:00:00.000Z", "America/Chicago")).toBe(0);        // medianoche es 0, no 1440
    expect(fechaEnZona("2026-03-05T04:30:00.000Z", "America/Chicago")).toBe("2026-03-04");
    expect(fechaEnZona("2026-03-04T18:00:00.000Z", "America/Chicago")).toBe("2026-03-04");
  });
});

describe("de las filas de la base", () => {
  it("el autor de cada sello es el del ÚLTIMO evento de ese tipo de la orden; otros eventos no cuentan", async () => {
    const { sellosDeOrdenes } = await import("./llegadas");
    const ev = (delivery_id: string, kind: string, created_by: string | null, hhmm: string) => ({ delivery_id, kind, created_by, created_at: `${DIA}${hhmm}:00.000Z` });
    expect(sellosDeOrdenes(
      [{ id: "a", pickup_gps_at: "p", pod_delivered_at: "d" }, { id: "b", pickup_gps_at: null, pod_delivered_at: null }],
      [ev("a", "picked_up", "oficina", "08:00"), ev("a", "picked_up", "c1", "09:00"), ev("a", "delivered", "c1", "10:00"), ev("a", "delivered", "oficina", "09:30"), ev("a", "edited", "otro", "11:00"), ev("z", "delivered", "c9", "08:00")],
    )).toEqual([
      { id: "a", pickup_gps_at: "p", pod_delivered_at: "d", picked_up_by: "c1", delivered_by: "c1" },
      { id: "b", pickup_gps_at: null, pod_delivered_at: null, picked_up_by: null, delivered_by: null },
    ]);
  });

  it("se guardan SOLO las paradas con dato, y la llegada solo si viene del GPS: así la fuente se lee de vuelta", async () => {
    const { actualesParaGuardar } = await import("./llegadas");
    expect(actualesParaGuardar([
      { paradaId: "1", fuente: "gps", llegada: "L", salida: "S", motivo: null }, { paradaId: "2", fuente: "toque", llegada: null, salida: "T", motivo: null },
      { paradaId: "3", fuente: null, llegada: null, salida: null, motivo: "la_marco_otra_persona" },
    ])).toEqual([{ id: "1", actual_arrival_at: "L", actual_departure_at: "S" }, { id: "2", actual_arrival_at: null, actual_departure_at: "T" }]);
  });
});
