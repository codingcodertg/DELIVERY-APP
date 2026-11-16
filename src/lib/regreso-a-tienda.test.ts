import { describe, it, expect } from "vitest";
import {
  accionDeLaParadaEnRutas, bannerDeRegreso, notaDejadaEnTienda, patchCancelarRegreso, patchDejadaEnTienda, patchPedirRegreso,
  regresoPendiente,
} from "./regreso-a-tienda";

const CUANDO = "2026-11-16T15:00:00.000Z";

describe("accionDeLaParadaEnRutas", () => {
  it("antes de recoger, la ✕ de siempre", () => {
    expect(accionDeLaParadaEnRutas({ stage: "ready" })).toBe("quitar");
    expect(accionDeLaParadaEnRutas({ stage: "fulfilling" })).toBe("quitar");
  });
  it("en el camión y sin solicitud, pide el regreso (la ✕ no desasigna)", () => {
    expect(accionDeLaParadaEnRutas({ stage: "picked_up", return_to_store_at: null })).toBe("pedir-regreso");
  });
  it("en el camión con la solicitud pendiente, se puede cancelar", () => {
    expect(accionDeLaParadaEnRutas({ stage: "picked_up", return_to_store_at: CUANDO })).toBe("cancelar-regreso");
  });
  it("sin la columna (la 311 sin aplicar) en el camión, se trata como sin solicitud", () => {
    expect(accionDeLaParadaEnRutas({ stage: "picked_up" })).toBe("pedir-regreso");
  });
  it("una solicitud vieja sobre una orden ya entregada no cambia la ✕", () => {
    expect(accionDeLaParadaEnRutas({ stage: "delivered", return_to_store_at: CUANDO })).toBe("quitar");
  });
});

describe("regresoPendiente y bannerDeRegreso", () => {
  it("sin columna o nula, no hay solicitud", () => {
    expect(regresoPendiente({})).toBe(false);
    expect(regresoPendiente({ return_to_store_at: null })).toBe(false);
    expect(regresoPendiente({ return_to_store_at: CUANDO })).toBe(true);
  });
  it("el banner del chofer solo sale en el camión con solicitud", () => {
    expect(bannerDeRegreso({ stage: "picked_up", return_to_store_at: CUANDO })).toBe(true);
    expect(bannerDeRegreso({ stage: "picked_up" })).toBe(false);
    expect(bannerDeRegreso({ stage: "ready", return_to_store_at: CUANDO })).toBe(false);
  });
});

describe("patches", () => {
  it("pedir el regreso marca cuándo y quién, y no toca al chofer ni la etapa", () => {
    const p = patchPedirRegreso("user-1", CUANDO);
    expect(p).toEqual({ return_to_store_at: CUANDO, return_to_store_by: "user-1" });
    expect(p).not.toHaveProperty("assigned_driver");
    expect(p).not.toHaveProperty("stage");
  });
  it("cancelar limpia la solicitud y deja al chofer", () => {
    expect(patchCancelarRegreso()).toEqual({ return_to_store_at: null, return_to_store_by: null });
    expect(patchCancelarRegreso()).not.toHaveProperty("assigned_driver");
  });
  it("dejada en tienda: sin chofer, sin puesto ni carga, sin solicitud, y sin datos de entrega", () => {
    expect(patchDejadaEnTienda()).toEqual({
      assigned_driver: null, route_seq: null, load_no: null, return_to_store_at: null, return_to_store_by: null,
    });
    const p = patchDejadaEnTienda();
    expect(p).not.toHaveProperty("stage");
    expect(p).not.toHaveProperty("pod_delivered_at");
    expect(p).not.toHaveProperty("pod_signature");
  });
});

describe("notas", () => {
  it("las del historial", () => {
    expect(notaDejadaEnTienda("Ana Pérez")).toBe("Left at store by Ana Pérez");
  });
});
