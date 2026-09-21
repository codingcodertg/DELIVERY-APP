import { describe, it, expect } from "vitest";
import { avisosDeAgregarMaterial, capacidadDelChofer, CAPACIDAD_DE_FABRICA } from "./agregar-material-avisos";
import type { Delivery } from "./types";

const CHOFER = "Chofer De Prueba";
const FECHA = "2026-01-15";

const orden = (id: string, extra: Partial<Delivery> = {}): Delivery => ({
  id, assigned_driver: CHOFER, delivery_date: FECHA, delivery_windows: null,
  actual_pallets: null, est_pallets: 4, load_no: null, stage: "approved", ...extra,
} as unknown as Delivery);

const ajustes = { driver_capacity: { [CHOFER]: 10 }, default_truck_capacity: 14 };

describe("capacidadDelChofer", () => {
  it("la del chofer por nombre gana a la de flota", () => {
    expect(capacidadDelChofer(CHOFER, ajustes)).toBe(10);
  });
  it("sin la suya, la de flota; sin ninguna, la de fábrica", () => {
    expect(capacidadDelChofer("Otro Chofer", ajustes)).toBe(14);
    expect(capacidadDelChofer("Otro Chofer", {})).toBe(CAPACIDAD_DE_FABRICA);
  });
});

describe("avisosDeAgregarMaterial · capacidad", () => {
  const mia = orden("a");
  const otra = orden("b", { est_pallets: 5 });

  it("avisa cuando el total nuevo se pasa del camión, y dice con qué números", () => {
    const r = avisosDeAgregarMaterial({ pedido: mia, pallets: 6, todas: [mia, otra], settings: ajustes, paradasPublicadas: null });
    expect(r.desborda).toEqual({ chofer: CHOFER, usados: 5, conEsta: 6, capacidad: 10 });
  });

  it("justo en el tope no avisa", () => {
    const r = avisosDeAgregarMaterial({ pedido: mia, pallets: 5, todas: [mia, otra], settings: ajustes, paradasPublicadas: null });
    expect(r.desborda).toBeNull();
  });

  it("cuenta con el total NUEVO, no con el guardado: la orden sola ya desborda", () => {
    const r = avisosDeAgregarMaterial({ pedido: mia, pallets: 11, todas: [mia], settings: ajustes, paradasPublicadas: null });
    expect(r.desborda).toEqual({ chofer: CHOFER, usados: 0, conEsta: 11, capacidad: 10 });
  });

  it("sin chofer asignado no hay camión que desbordar", () => {
    const suelta = orden("a", { assigned_driver: null });
    const r = avisosDeAgregarMaterial({ pedido: suelta, pallets: 50, todas: [suelta, otra], settings: ajustes, paradasPublicadas: null });
    expect(r.desborda).toBeNull();
  });

  it("con viaje puesto, el tope es el del viaje: lo del otro viaje no cuenta", () => {
    const viaje1 = orden("a", { load_no: 1 });
    const viaje2 = orden("b", { est_pallets: 9, load_no: 2 });
    const r = avisosDeAgregarMaterial({ pedido: viaje1, pallets: 6, todas: [viaje1, viaje2], settings: ajustes, paradasPublicadas: null });
    expect(r.desborda).toBeNull();
  });

  it("con viaje puesto, lo del MISMO viaje sí cuenta", () => {
    const viaje1 = orden("a", { load_no: 1 });
    const mismo = orden("b", { est_pallets: 9, load_no: 1 });
    const r = avisosDeAgregarMaterial({ pedido: viaje1, pallets: 6, todas: [viaje1, mismo], settings: ajustes, paradasPublicadas: null });
    expect(r.desborda?.usados).toBe(9);
  });
});

describe("avisosDeAgregarMaterial · plan publicado", () => {
  const mia = orden("a");

  it("avisa si la orden es una parada del plan publicado", () => {
    const r = avisosDeAgregarMaterial({ pedido: mia, pallets: 5, todas: [mia], settings: ajustes, paradasPublicadas: [{ order_ref: "z" }, { order_ref: "a" }] });
    expect(r.enPlanPublicado).toBe(true);
  });

  it("una orden partida en cargas (a#b) sigue siendo la orden a", () => {
    const r = avisosDeAgregarMaterial({ pedido: mia, pallets: 5, todas: [mia], settings: ajustes, paradasPublicadas: [{ order_ref: "a#b" }] });
    expect(r.enPlanPublicado).toBe(true);
  });

  it("no avisa si el plan publicado no la lleva, ni si no hay plan", () => {
    expect(avisosDeAgregarMaterial({ pedido: mia, pallets: 5, todas: [mia], settings: ajustes, paradasPublicadas: [{ order_ref: "z" }] }).enPlanPublicado).toBe(false);
    expect(avisosDeAgregarMaterial({ pedido: mia, pallets: 5, todas: [mia], settings: ajustes, paradasPublicadas: null }).enPlanPublicado).toBe(false);
  });
});

describe("avisosDeAgregarMaterial · solo si los pallets suben", () => {
  const mia = orden("a");
  const otra = orden("b", { est_pallets: 9 });
  const paradas = [{ order_ref: "a" }];

  it("sin tocar pallets, o dejándolos igual, no avisa de nada aunque el camión ya vaya pasado y haya plan", () => {
    for (const pallets of [null, 4, 3, Number.NaN]) {
      const r = avisosDeAgregarMaterial({ pedido: mia, pallets, todas: [mia, otra], settings: ajustes, paradasPublicadas: paradas });
      expect(r).toEqual({ desborda: null, enPlanPublicado: false });
    }
  });
});
