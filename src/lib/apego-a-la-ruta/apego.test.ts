import { describe, it, expect } from "vitest";
import { limpiaRastro, type PuntoDeRastro, type Rastro } from "@/lib/reportes-choferes/rastro";
import { informeDelDia, type EntradaDelDia, type OrdenDelDia } from "@/lib/reportes-choferes/dia";
import { apegoAlCamino, apegoDelDia, apegosDeLaRespuesta, lineaDelPlan, metrosALaLinea, paradasDelPlan, CORREDOR_M, EN_VIVO_MS } from "./apego";

/**
 * «Apego a la ruta» (D-910): la ruta programada contra lo hecho, leída del día de D-907.
 *
 * Los rastros son sintéticos como en `reportes-choferes.test.ts`: el camión manda un punto cada 10 s en marcha. Lo que se
 * prueba es la LECTURA: cómo se cuentan las paradas del plan, el porcentaje, lo fuera de orden y lo saltado, las millas
 * y el tiempo plan/real y sus diferencias, el día a medias en vivo, y el chofer sin plan.
 */

const T0 = Date.parse("2026-11-05T14:00:00Z");           // 08:00 en Texas
const min = (n: number) => T0 + n * 60_000;
const TIENDA = { lat: 26.2041, lng: -98.1686 }, A = { lat: 26.2500, lng: -98.2000 }, B = { lat: 26.3000, lng: -98.1000 }, C = { lat: 26.3500, lng: -98.0500 };
const norte = (p: { lat: number; lng: number }, m: number) => ({ lat: p.lat + m / 111_320, lng: p.lng });
function viaje(a: { lat: number; lng: number }, b: { lat: number; lng: number }, m0: number, m1: number, pasoS = 10): PuntoDeRastro[] {
  const n = Math.max(1, Math.round(((m1 - m0) * 60) / pasoS));
  return Array.from({ length: n + 1 }, (_, i) => ({ t: min(m0) + i * pasoS * 1000, lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n }));
}
const camion = (...trozos: PuntoDeRastro[][]): Rastro => ({ fuente: "camion", puntos: limpiaRastro(trozos.flat()) });

const orden = (id: string, entrega: { lat: number; lng: number }, etaP: number, etaD: number, extra: Partial<OrdenDelDia> = {}): OrdenDelDia => ({
  id, codigo: id.toUpperCase(), tipo: "Customer", tienda: "RDZ Pharr", cliente: `Cliente ${id}`, etapa: "delivered",
  recogida: { ...TIENDA, nombre: "RDZ Pharr" }, entrega: { ...entrega, nombre: `Casa ${id}` }, conRecogida: true,
  ventana: "0830-1700", minRecogida: 10, minEntrega: 15, ordenEnLista: null, toques: {},
  plan: { P: { eta: etaP, primera: etaP, apuntadaEn: T0 - 3_600_000, rehechaEn: null }, D: { eta: etaD, primera: etaD, apuntadaEn: T0 - 3_600_000, rehechaEn: null } }, ...extra,
});
const dia = (ordenes: OrdenDelDia[], rastro: Rastro | null, extra: Partial<EntradaDelDia> = {}) => informeDelDia({
  fecha: "2026-11-05", zona: "America/Chicago", choferId: "c1", chofer: "Ana", ordenes, rastro, tiendas: [{ name: "RDZ Pharr", ...TIENDA }],
  tramo: () => ({ millas: 5, minutos: 12, estimado: false }), instante: (m) => Date.parse("2026-11-05T06:00:00Z") + m * 60_000, ...extra,
});

/** Plan: tienda (08:10) → A (08:50) → B (09:40) → C (10:30). Tres órdenes, recogidas juntas en la tienda. */
const ORDENES = [orden("fw1", A, 490, 530), orden("fw2", B, 490, 580), orden("fw3", C, 490, 630)];
/** Lo hizo en el orden del plan: tienda 08:10–08:30, A 08:50–09:10, B 09:40–10:00, C 10:30–10:50, y se va. */
const EN_ORDEN = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, A, 30, 50), viaje(A, B, 70, 100), viaje(B, C, 120, 150), viaje(C, norte(C, 3000), 170, 180));
/** Hizo B antes que A: tienda, B 08:50–09:10, A 09:40–10:00, C 10:30. */
const B_ANTES = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, B, 30, 50), viaje(B, A, 70, 100), viaje(A, C, 120, 150), viaje(C, norte(C, 3000), 170, 180));
/** Al revés del todo: C, B, A (la tienda primero, que es de donde sale). */
const AL_REVES = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, C, 30, 50), viaje(C, B, 70, 100), viaje(B, A, 120, 150), viaje(A, norte(A, 3000), 170, 180));

describe("las paradas del plan", () => {
  it("son los SITIOS del plan en su orden: las tres recogidas de la tienda son una parada, cada entrega otra", () => {
    const ps = paradasDelPlan(dia(ORDENES, EN_ORDEN).paradas);
    expect(ps.map((p) => p.puesto)).toEqual([1, 2, 3, 4]);
    expect(ps[0]).toMatchObject({ lugar: "RDZ Pharr", esTienda: true, eta: 490 });
    // D-912: cada orden viaja con su id y su factura (aquí sin factura), para que el Recorrido la nombre y abra su ficha.
    expect(ps[0].ordenes).toEqual([{ codigo: "FW1", tipo: "P", id: "fw1", factura: null }, { codigo: "FW2", tipo: "P", id: "fw2", factura: null }, { codigo: "FW3", tipo: "P", id: "fw3", factura: null }]);
    expect(ps.slice(1).map((p) => p.ordenes)).toEqual([[{ codigo: "FW1", tipo: "D", id: "fw1", factura: null }], [{ codigo: "FW2", tipo: "D", id: "fw2", factura: null }], [{ codigo: "FW3", tipo: "D", id: "fw3", factura: null }]]);
    expect(lineaDelPlan(ps)).toEqual([[TIENDA.lat, TIENDA.lng], [A.lat, A.lng], [B.lat, B.lng], [C.lat, C.lng]]);
  });

  it("la visita sale de la detección de D-907 (150 m, 2 min): la llegada es la del rastro", () => {
    const ps = paradasDelPlan(dia(ORDENES, EN_ORDEN).paradas);
    expect(ps.every((p) => p.visitada)).toBe(true);
    // Llegó a A a las 08:50: la llegada es el primer punto a 150 m o menos, unos segundos antes.
    expect(ps[1].llegada).toBeGreaterThan(min(49)); expect(ps[1].llegada).toBeLessThanOrEqual(min(50));
    expect(ps[2].llegada).toBeGreaterThan(min(99)); expect(ps[2].llegada).toBeLessThanOrEqual(min(100));
  });
});

describe("apego al orden", () => {
  it("todo en su orden: 100 %, N de N, nada fuera ni saltado", () => {
    const a = apegoDelDia(dia(ORDENES, EN_ORDEN), EN_ORDEN);
    expect(a.hayPlan).toBe(true);
    expect(a.orden).toEqual({ planeadas: 4, visitadas: 4, enOrden: 4, pct: 100, fueraDeOrden: [], noVisitadas: [] });
    expect(a.paradas.every((p) => p.enOrden)).toBe(true);
  });

  it("una parada adelantada: 3 de 4 (75 %), y dice cuál", () => {
    const a = apegoDelDia(dia(ORDENES, B_ANTES), B_ANTES);
    expect(a.orden.planeadas).toBe(4);
    expect(a.orden.enOrden).toBe(3);
    expect(a.orden.pct).toBe(75);
    expect(a.orden.fueraDeOrden).toHaveLength(1);
    expect(["D FW1", "D FW2"]).toContain(a.orden.fueraDeOrden[0]);
    expect(a.orden.visitadas).toBe(4);
  });

  it("todo al revés: solo la tienda y una entrega pueden quedar en orden (2 de 4, 50 %)", () => {
    const a = apegoDelDia(dia(ORDENES, AL_REVES), AL_REVES);
    expect(a.orden.visitadas).toBe(4);
    expect(a.orden.enOrden).toBe(2);
    expect(a.orden.pct).toBe(50);
    expect(a.orden.fueraDeOrden).toHaveLength(2);
  });

  it("una parada saltada no cuenta como en orden, y sale en «no visitadas»", () => {
    // Tienda → A → C, sin pasar por B; la orden de B sigue abierta.
    const sinB = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, A, 30, 50), viaje(A, C, 70, 150), viaje(C, norte(C, 3000), 170, 180));
    const ordenes = [ORDENES[0], { ...ORDENES[1], etapa: "picked_up" }, ORDENES[2]];
    const a = apegoDelDia(dia(ordenes, sinB), sinB);
    expect(a.orden).toMatchObject({ planeadas: 4, visitadas: 3, enOrden: 3, pct: 75, fueraDeOrden: [] });
    expect(a.orden.noVisitadas).toEqual(["D FW2"]);
    expect(a.paradas[2]).toMatchObject({ visitada: false, enOrden: false, hecha: false });
  });

  it("sin rastro, la parada cuenta por el toque del chofer; sin toque ni rastro, no", () => {
    const ordenes = [
      { ...ORDENES[0], toques: { recogio: { t: min(20), porElChofer: true }, entrego: { t: min(60), porElChofer: true } } },
      { ...ORDENES[1], etapa: "picked_up", toques: { recogio: { t: min(20), porElChofer: true } } },
    ];
    const a = apegoDelDia(dia(ordenes, null), null);
    expect(a.rastro.fuente).toBeNull();
    expect(a.orden).toMatchObject({ planeadas: 3, visitadas: 2, enOrden: 2, pct: 67 });
    expect(a.orden.noVisitadas).toEqual(["D FW2"]);
    expect(a.real).toEqual({ millas: null, minutosManejo: null, minutosTotal: null, desde: null, hasta: null, enVivo: false });
  });
});

describe("sin plan", () => {
  it("un chofer con órdenes pero sin horas del Gestor no tiene ruta programada: `hayPlan: false`, sin ceros que engañen", () => {
    const sinHoras = ORDENES.map((o) => ({ ...o, plan: {} }));
    const a = apegoDelDia(dia(sinHoras, EN_ORDEN), EN_ORDEN);
    expect(a.hayPlan).toBe(false);
    expect(a.paradas).toEqual([]);
    expect(a.orden).toEqual({ planeadas: 0, visitadas: 0, enOrden: 0, pct: null, fueraDeOrden: [], noVisitadas: [] });
    expect(a.plan).toMatchObject({ millas: null, minutosManejo: null, minutosTotal: null, minutosServicio: 0 });
    expect(a.camino.pct).toBeNull();
    expect(a.diferencia).toEqual({ millas: null, millasPct: null, minutos: null, minutosPct: null });
    expect(a.lineaDelPlan).toEqual([]);
    // Lo real sí se sabe aunque no haya plan: el rastro existe.
    expect(a.real.millas).toBeGreaterThan(0);
  });
  it("sin órdenes ni rastro: nada de nada", () => {
    const a = apegoDelDia(dia([], null), null);
    expect(a.hayPlan).toBe(false);
    expect(a.real.minutosTotal).toBeNull();
  });
});

describe("millas y tiempo: plan contra real", () => {
  it("el plan: tramos de la caché + minutos de servicio; lo real: el rastro entero; y las diferencias con su signo", () => {
    const a = apegoDelDia(dia(ORDENES, EN_ORDEN), EN_ORDEN);
    // 3 tramos (tienda→A→B→C) de 5 mi / 12 min; servicio: 3 recogidas × 10 + 3 entregas × 15 = 75 min.
    expect(a.plan).toEqual({ millas: 15, minutosManejo: 36, minutosServicio: 75, minutosTotal: 111, estimado: false, tramos: 3, tramosEstimados: 0 });
    // Real: del primer punto (08:00) al último (11:00) = 180 min; las millas son la recta sintética (≈ 18,6 mi), más que el plan.
    expect(a.real.desde).toBe(min(0)); expect(a.real.hasta).toBe(min(180)); expect(a.real.enVivo).toBe(false);
    expect(a.real.minutosTotal).toBe(180);
    expect(a.real.millas).toBeGreaterThan(15);
    expect(a.real.minutosManejo).toBeGreaterThan(60);
    expect(a.diferencia.millas).toBeCloseTo(a.real.millas! - 15, 1);
    expect(a.diferencia.millasPct).toBe(Math.round(((a.real.millas! - 15) / 15) * 100));
    expect(a.diferencia.minutos).toBe(69);
    expect(a.diferencia.minutosPct).toBe(62);
  });

  it("si menos que el plan, la diferencia es negativa", () => {
    const corto = camion(viaje(norte(TIENDA, 500), TIENDA, 0, 5), viaje(TIENDA, A, 30, 50));
    const a = apegoDelDia(dia([ORDENES[0]], corto), corto);
    expect(a.plan.minutosTotal).toBe(12 + 25);
    expect(a.real.minutosTotal).toBe(50);
    expect(a.diferencia.minutos).toBe(13);
    expect(a.diferencia.millas).toBeLessThan(0);   // ~3,8 mi reales contra 5 del plan
  });

  it("los tramos estimados (sin caché) se marcan", () => {
    const a = apegoDelDia(dia(ORDENES, EN_ORDEN, { tramo: () => ({ millas: 4, minutos: 8, estimado: true }) }), EN_ORDEN);
    expect(a.plan).toMatchObject({ estimado: true, tramosEstimados: 3, millas: 12 });
  });
});

describe("el día a medias, en vivo", () => {
  it("hoy, con el rastro fresco: lo que falta está pendiente y el tiempo real llega hasta ahora", () => {
    // Tienda y A hechas; va camino de B. Último punto hace 5 minutos.
    const aMedias = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, A, 30, 50), viaje(A, norte(A, 2000), 70, 80));
    const ordenes = [ORDENES[0], { ...ORDENES[1], etapa: "picked_up" }, { ...ORDENES[2], etapa: "picked_up" }];
    const ahora = min(85);
    const a = apegoDelDia(dia(ordenes, aMedias), aMedias, { ahora, esHoy: true });
    expect(a.orden).toMatchObject({ planeadas: 4, visitadas: 2, enOrden: 2, pct: 50, fueraDeOrden: [] });
    expect(a.orden.noVisitadas).toEqual(["D FW2", "D FW3"]);
    expect(a.real.enVivo).toBe(true);
    expect(a.real.hasta).toBe(ahora);
    expect(a.real.minutosTotal).toBe(85);
  });
  it("hoy pero con el rastro callado más de 20 min: ya no está en vivo; y un día pasado nunca lo está", () => {
    const aMedias = camion(viaje(norte(TIENDA, 2000), TIENDA, 0, 10), viaje(TIENDA, A, 30, 50));
    expect(apegoDelDia(dia(ORDENES, aMedias), aMedias, { ahora: min(50) + EN_VIVO_MS + 1, esHoy: true }).real).toMatchObject({ enVivo: false, hasta: min(50), minutosTotal: 50 });
    expect(apegoDelDia(dia(ORDENES, aMedias), aMedias, { ahora: min(55), esHoy: false }).real).toMatchObject({ enVivo: false, hasta: min(50) });
  });
});

describe("apego al camino (rectas entre paradas)", () => {
  const LINEA = [TIENDA, A, B, C];
  it("distancia a la línea quebrada", () => {
    expect(metrosALaLinea(A, LINEA)).toBeLessThan(1);
    expect(metrosALaLinea(norte(A, 100), LINEA)).toBeLessThan(110);
    expect(metrosALaLinea(norte(A, 5000), LINEA)).toBeGreaterThan(4000);
    expect(metrosALaLinea(A, [])).toBe(Infinity);
  });
  it("un rastro que va recto de parada a parada: 100 %; uno que se va lejos: menos; sin rastro o sin plan: null", () => {
    const porLaLinea = camion(viaje(TIENDA, A, 0, 20), viaje(A, B, 20, 50), viaje(B, C, 50, 80));
    expect(apegoAlCamino(porLaLinea, LINEA)).toMatchObject({ pct: 100, rectas: true, corredorM: CORREDOR_M });
    const rodeo = camion(viaje(TIENDA, A, 0, 20), viaje(A, norte(A, 8000), 20, 40), viaje(norte(A, 8000), B, 40, 60), viaje(B, C, 60, 90));
    const r = apegoAlCamino(rodeo, LINEA);
    expect(r.pct).toBeLessThan(100); expect(r.pct).toBeGreaterThan(0);
    expect(r.millasDentro).toBeLessThan(r.millas);
    expect(apegoAlCamino(null, LINEA).pct).toBeNull();
    expect(apegoAlCamino(porLaLinea, [TIENDA]).pct).toBeNull();
  });
  it("en el día: se mide contra la línea del plan", () => {
    expect(apegoDelDia(dia(ORDENES, EN_ORDEN), EN_ORDEN).camino.pct).toBeGreaterThanOrEqual(85);   // solo los tramos de llegada/salida se salen
    expect(apegoDelDia(dia(ORDENES, AL_REVES), AL_REVES).camino.pct).toBeLessThan(50);              // C↔A directo no es el camino del plan
  });
});

describe("lo que llega por la red", () => {
  it("se queda solo con lo que tiene forma de apego", () => {
    const bueno = { ...apegoDelDia(dia(ORDENES, EN_ORDEN), EN_ORDEN), driverId: "c1", chofer: "Ana", fecha: "2026-11-05" };
    expect(apegosDeLaRespuesta({ drivers: [bueno, null, { driverId: 3 }, { driverId: "x" }, "no"] })).toEqual([bueno]);
    expect(apegosDeLaRespuesta({})).toEqual([]);
    expect(apegosDeLaRespuesta(null)).toEqual([]);
  });
});
