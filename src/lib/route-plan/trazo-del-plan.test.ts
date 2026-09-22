import { describe, expect, it } from "vitest";
import { puntosDelTrazoPublicado } from "./trazo-del-plan";

/** D-352 · La línea del mapa sigue el plan publicado. Los datos llegan DESORDENADOS a propósito (por `seq`). */
describe("puntosDelTrazoPublicado", () => {
  const tiendas = [{ name: "Tienda Norte", lat: 26.30, lng: -98.16 }, { name: "Tienda Sur", lat: 26.10, lng: -97.99 }];
  const ordenes = [
    { id: "a", delivery_lat: 26.16, lng: 0, delivery_lng: -97.99 },
    { id: "b", delivery_lat: 26.15, delivery_lng: -97.82 },
    { id: "c", delivery_lat: null, delivery_lng: null },
  ];
  it("P con el punto de su tienda, D con el de su orden, en el orden del plan y no en el que llegan", () => {
    const paradas = [
      { kind: "D" as const, order_ref: "b", seq: 3 },
      { kind: "P" as const, order_ref: "a", seq: 1, place: " tienda norte " },
      { kind: "D" as const, order_ref: "a", seq: 2 },
    ];
    expect(puntosDelTrazoPublicado(paradas, ordenes, tiendas)).toEqual([
      { id: "P:1", lat: 26.30, lng: -98.16 }, { id: "D:a", lat: 26.16, lng: -97.99 }, { id: "D:b", lat: 26.15, lng: -97.82 },
    ]);
  });
  it("una parada sin punto se salta sin romper el trazo; una orden partida (a#b) usa el punto de la orden", () => {
    const paradas = [
      { kind: "P" as const, order_ref: "c", seq: 1, place: "Tienda que no existe" },
      { kind: "D" as const, order_ref: "c", seq: 2 },
      { kind: "D" as const, order_ref: "a#b", seq: 3 },
      { kind: "D" as const, order_ref: "b", seq: 4 },
    ];
    expect(puntosDelTrazoPublicado(paradas, ordenes, tiendas).map((p) => p.id)).toEqual(["D:a#b", "D:b"]);
  });
  it("dos recogidas seguidas en la misma tienda son un solo punto", () => {
    const paradas = [
      { kind: "P" as const, order_ref: "a", seq: 1, place: "Tienda Sur" },
      { kind: "P" as const, order_ref: "b", seq: 2, place: "Tienda Sur" },
      { kind: "D" as const, order_ref: "a", seq: 3 },
    ];
    expect(puntosDelTrazoPublicado(paradas, ordenes, tiendas).map((p) => p.id)).toEqual(["P:1", "D:a"]);
  });
});

describe("el Gestor pide ese trazo SIN optimizar y lo pinta en vez del trazo viejo", () => {
  it("optimize:false, roundtrip:false, y la línea del plan pisa la del optimizador", async () => {
    const { readFileSync } = await import("node:fs");
    const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(pagina).toContain("const puntos = puntosDelTrazoPublicado(paradas, deliveries, settings.stores ?? []);");
    expect(pagina).toContain("body: JSON.stringify({ stops: puntos, roundtrip: false, optimize: false, date }),");
    expect(pagina).toContain("if ((trazosDelPlan[driver]?.length ?? 0) > 1) continue;");
  });
});
