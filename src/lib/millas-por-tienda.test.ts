import { describe, expect, it } from "vitest";
import { mkDelivery } from "@/lib/__fixtures";
import {
  destinoDeParada, millasPorTienda, paradasDeMillas, SIN_CHOFER, tiendaQuePaga, TOPE_MILLAS_CREIBLES,
} from "./millas-por-tienda";
import type { NamedLocation } from "./types";

/**
 * Millas y reparto del gas por tienda en el Panel (D-738, 2026-10-29). Las reglas del informe de
 * octubre, medidas con órdenes de mentira: qué cuenta como viaje, qué es una parada, de dónde salen
 * las millas y quién paga una Intertienda.
 */

const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "1 Norte", lat: 26.2, lng: -98.2 },
  { name: "Tienda Sur", address: "2 Sur", lat: 26.0, lng: -98.2 },
  { name: "Tienda Sin Pin", address: "3 Nadie" },
];
const REGLAS = { Intertienda: { storeToStore: true, homeIsDestination: true, docRef: "any" as const } };

const orden = (over: Parameters<typeof mkDelivery>[0] = {}) =>
  mkDelivery({
    stage: "delivered", store: "Tienda Norte", pickup_name: null, delivery_name: "Cliente X", delivery_address: "100 Main St, McAllen, TX 78501",
    delivery_lat: null, delivery_lng: null, route_miles: 10, assigned_driver: "Chofer A", delivery_date: "2026-10-05", ...over,
  });

describe("qué cuenta como viaje", () => {
  it("entregadas y recogidas sí; abiertas, anuladas y rechazadas no", () => {
    const ps = paradasDeMillas([
      orden({ stage: "delivered", delivery_address: "a" }),
      orden({ stage: "picked_up", delivery_address: "b" }),
      orden({ stage: "approved", delivery_address: "c" }),
      orden({ stage: "canceled", delivery_address: "d" }),
      orden({ stage: "rejected", delivery_address: "e" }),
      orden({ stage: "ready", delivery_address: "f" }),
    ], TIENDAS);
    expect(ps.map((p) => p.destino).sort()).toEqual(["a", "b"]);
  });
});

describe("una parada = mismo día, chofer, tienda que paga y destino", () => {
  it("dos órdenes al mismo sitio el mismo día son UNA parada con las millas de la mayor, no la suma", () => {
    const ps = paradasDeMillas([orden({ route_miles: 10 }), orden({ route_miles: 12.5 })], TIENDAS);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ ordenes: 2, millas: 12.5, estimada: false, sinDato: false, chofer: "Chofer A", paga: "Tienda Norte" });
  });
  it("otro día, otro chofer u otro destino: otra parada", () => {
    const ps = paradasDeMillas([
      orden(), orden({ delivery_date: "2026-10-06" }), orden({ assigned_driver: "Chofer B" }), orden({ delivery_address: "200 Other Rd, Pharr, TX" }),
    ], TIENDAS);
    expect(ps).toHaveLength(4);
  });
  it("la dirección escrita de dos maneras es el mismo destino (país, ZIP, comas y mayúsculas fuera)", () => {
    expect(destinoDeParada({ id: "1", delivery_address: "100 Main St., McAllen, TX 78501, USA", delivery_lat: null, delivery_lng: null }))
      .toBe(destinoDeParada({ id: "2", delivery_address: "100 main st  mcallen tx", delivery_lat: null, delivery_lng: null }));
    const ps = paradasDeMillas([
      orden({ delivery_address: "100 Main St., McAllen, TX 78501, USA" }), orden({ delivery_address: "100 main st mcallen tx" }),
    ], TIENDAS);
    expect(ps).toHaveLength(1);
  });
  it("sin dirección, las coordenadas; sin nada, cada orden es su propia parada", () => {
    expect(destinoDeParada({ id: "1", delivery_address: "", delivery_lat: 26.12346, delivery_lng: -98.2 })).toBe("26.1235,-98.2000");
    expect(destinoDeParada({ id: "z", delivery_address: null, delivery_lat: null, delivery_lng: null })).toBe("?z");
  });
  it("sin chofer también cuenta: va a «(sin chofer)»", () => {
    const [p] = paradasDeMillas([orden({ assigned_driver: null })], TIENDAS);
    expect(p.chofer).toBe(SIN_CHOFER);
    expect(p.millas).toBe(10);
  });
});

describe("de dónde salen las millas", () => {
  const destinoConPin = { delivery_lat: 26.3, delivery_lng: -98.2 }; // ~6,9 mi en línea recta desde Norte → ×1,3 ≈ 9
  it("la de Google cuando la orden salió de su tienda y es creíble", () => {
    const [p] = paradasDeMillas([orden({ route_miles: 42.4, ...destinoConPin })], TIENDAS);
    expect(p).toMatchObject({ millas: 42.4, estimada: false });
  });
  it("estimada (recta ×1,3) cuando Google no es creíble", () => {
    const [p] = paradasDeMillas([orden({ route_miles: TOPE_MILLAS_CREIBLES + 1, ...destinoConPin })], TIENDAS);
    expect(p.estimada).toBe(true);
    expect(p.millas).toBeGreaterThan(8.5);
    expect(p.millas).toBeLessThan(9.5);
    expect(p.sinDato).toBe(false);
  });
  it("estimada cuando falta la de Google", () => {
    const [p] = paradasDeMillas([orden({ route_miles: null, ...destinoConPin })], TIENDAS);
    expect(p).toMatchObject({ estimada: true, sinDato: false });
  });
  it("estimada cuando se recogió en OTRA tienda (la de Google va de otro sitio)", () => {
    const [p] = paradasDeMillas([orden({ route_miles: 3, pickup_name: "Tienda Sur", ...destinoConPin })], TIENDAS);
    expect(p.estimada).toBe(true);
    expect(p.millas).not.toBe(3);
  });
  it("recogida en la propia tienda (escrita distinto) sigue siendo real", () => {
    const [p] = paradasDeMillas([orden({ route_miles: 3, pickup_name: " tienda norte " })], TIENDAS);
    expect(p).toMatchObject({ millas: 3, estimada: false });
  });
  it("sin Google creíble y sin pin (de la orden o de la tienda): 0 y sin dato", () => {
    expect(paradasDeMillas([orden({ route_miles: null })], TIENDAS)[0]).toMatchObject({ millas: 0, estimada: true, sinDato: true });
    expect(paradasDeMillas([orden({ route_miles: null, store: "Tienda Sin Pin", ...destinoConPin })], TIENDAS)[0]).toMatchObject({ millas: 0, sinDato: true });
  });
  it("en una parada con una orden real y otra sin dato manda la real", () => {
    const [p] = paradasDeMillas([orden({ route_miles: null }), orden({ route_miles: 7 })], TIENDAS);
    expect(p).toMatchObject({ ordenes: 2, millas: 7, estimada: false, sinDato: false });
  });
});

describe("quién paga el gas", () => {
  it("una orden de cliente la paga la tienda que la creó", () => {
    expect(tiendaQuePaga({ store: "Tienda Norte", delivery_name: "Cliente X", order_type: "Customer" }, REGLAS)).toBe("Tienda Norte");
  });
  it("una Intertienda la paga la tienda que RECIBE (regla del dueño, 2026-10-29)", () => {
    expect(tiendaQuePaga({ store: "Tienda Norte", delivery_name: "Tienda Sur", order_type: "Intertienda" }, REGLAS)).toBe("Tienda Sur");
    const [p] = paradasDeMillas([orden({ order_type: "Intertienda", delivery_name: "Tienda Sur", route_miles: 40 })], TIENDAS, REGLAS);
    expect(p).toMatchObject({ tienda: "Tienda Norte", paga: "Tienda Sur", entreTiendas: true, millas: 40 });
  });
  it("por la regla del tipo, no por su nombre: «Transfer» (de tienda a tienda) también; un tipo de cliente con destino de tienda, no", () => {
    expect(tiendaQuePaga({ store: "Tienda Norte", delivery_name: "Tienda Sur", order_type: "Transfer" })).toBe("Tienda Sur");
    expect(tiendaQuePaga({ store: "Tienda Norte", delivery_name: "Tienda Sur", order_type: "Customer" })).toBe("Tienda Norte");
  });
  it("de tienda a tienda sin destino escrito: la que la creó", () => {
    expect(tiendaQuePaga({ store: "Tienda Norte", delivery_name: "  ", order_type: "Intertienda" }, REGLAS)).toBe("Tienda Norte");
  });
});

describe("la tabla por tienda", () => {
  const paradas = paradasDeMillas([
    orden({ route_miles: 30 }),                                                                        // Norte, real
    orden({ route_miles: 20, delivery_address: "b", delivery_lat: 26.3, delivery_lng: -98.2 }),          // Norte, real
    orden({ route_miles: null, delivery_address: "c" }),                                                 // Norte, sin dato
    orden({ store: "Tienda Sur", route_miles: 40, delivery_address: "d" }),                              // Sur, real
    orden({ store: "Tienda Sur", route_miles: null, delivery_address: "e", delivery_lat: 26.1, delivery_lng: -98.2 }), // Sur, estimada ≈ 9
    orden({ order_type: "Intertienda", delivery_name: "Tienda Sur", route_miles: 10, delivery_address: "f" }),   // la paga Sur
  ], TIENDAS, REGLAS);
  const { filas, total } = millasPorTienda(paradas);

  it("una fila por tienda que paga, de más a menos millas, y el total", () => {
    expect(filas.map((f) => f.tienda)).toEqual(["Tienda Sur", "Tienda Norte"]);
    const sur = filas[0], norte = filas[1];
    expect(norte).toMatchObject({ paradas: 3, ordenes: 3, millasReales: 50, millas: 50, paradasEstimadas: 1, paradasSinDato: 1 });
    expect(sur.paradas).toBe(3);
    expect(sur.millasReales).toBe(50);
    expect(sur.millasEstimadas).toBeGreaterThan(8);
    expect(sur.millas).toBe(Math.round((sur.millasReales + sur.millasEstimadas) * 10) / 10);
    expect(total.paradas).toBe(6);
    expect(total.millas).toBe(Math.round((norte.millas + sur.millas) * 10) / 10);
  });
  it("el % del gas sale de las millas de cada una sobre las de todas, y suma 100", () => {
    const suma = filas.reduce((s, f) => s + (f.pctGas ?? 0), 0);
    expect(Math.abs(suma - 100)).toBeLessThan(0.2);
    expect(filas[0].pctGas).toBeGreaterThan(50);
    expect(filas[0].pctGas).toBe(Math.round((filas[0].millas / total.millas) * 1000) / 10);
    expect(total.pctGas).toBe(100);
  });
  it("sin millas, sin porcentaje (no 0 ni NaN)", () => {
    const r = millasPorTienda(paradasDeMillas([orden({ route_miles: null })], TIENDAS));
    expect(r.filas[0].pctGas).toBeNull();
    expect(r.total.pctGas).toBeNull();
    expect(millasPorTienda([])).toEqual({ filas: [], total: expect.objectContaining({ paradas: 0, millas: 0, pctGas: null }) });
  });
});
