import { describe, expect, it } from "vitest";

import {
  MAX_MILLAS_PLAUSIBLES, boundsGoogleRGV, esRespuestaVigente, millasImposibles, puntoEnElValle,
} from "./distancia-plausible";

describe("millasImposibles (D-878, factura 171838)", () => {
  it("321,3 mi de Pharr a Monte Alto es imposible", () => {
    expect(millasImposibles(321.3)).toBe(true);
  });
  it("las filas medidas en producción con cientos de millas son imposibles", () => {
    for (const m of [2006.9, 1788.7, 1679.7, 1410.8, 1159.2, 975.3, 765.7, 322.3]) expect(millasImposibles(m)).toBe(true);
  });
  it("las entregas reales siguen valiendo, Alice (118 mi) y Corpus desde Brownsville (~160) incluidas", () => {
    for (const m of [0, 7.4, 25.5, 63.5, 107.2, 118, 160, MAX_MILLAS_PLAUSIBLES]) expect(millasImposibles(m)).toBe(false);
  });
  it("sin millas no hay aviso; un valor roto sí", () => {
    expect(millasImposibles(null)).toBe(false);
    expect(millasImposibles(undefined)).toBe(false);
    expect(millasImposibles(Number.NaN)).toBe(true);
    expect(millasImposibles(-3)).toBe(true);
  });
});

describe("puntoEnElValle", () => {
  it("Monte Alto, Pharr y Alice dentro", () => {
    expect(puntoEnElValle(26.3479, -97.9949)).toBe(true);
    expect(puntoEnElValle(26.2041, -98.1686)).toBe(true);
    expect(puntoEnElValle(27.7518, -98.2258)).toBe(true);
  });
  it("Napa (CA), Florida, Scottsdale y Denton fuera", () => {
    expect(puntoEnElValle(38.4274, -122.3943)).toBe(false);
    expect(puntoEnElValle(26.1821, -80.2344)).toBe(false);
    expect(puntoEnElValle(33.7005, -111.8729)).toBe(false);
    expect(puntoEnElValle(33.2486, -97.1548)).toBe(false);
  });
  it("bounds para Google en el formato sur,oeste|norte,este", () => {
    expect(boundsGoogleRGV()).toBe("25.8,-99|27.9,-97");
  });
});

describe("esRespuestaVigente: la respuesta tardía de un trozo de dirección no pisa a la buena", () => {
  it("reproduce la carrera de 171838", () => {
    // Pedido 1: «9402 Solan» (respaldo lento, 321 mi). Pedido 2: la dirección completa (25,5 mi).
    let ultimo = 0;
    const p1 = ++ultimo;
    const p2 = ++ultimo;
    let millas: number | null = null;
    const llega = (n: number, m: number) => { if (esRespuestaVigente(n, ultimo)) millas = m; };
    llega(p2, 25.5); // la buena llega primero
    llega(p1, 321.3); // la vieja llega después
    expect(millas).toBe(25.5);
  });
});

describe("la tarifa no sale de unas millas imposibles", () => {
  it("321,3 mi sin punto: sin sugerencia de precio", async () => {
    const { suggestDeliveryFee } = await import("./pricing");
    const s = suggestDeliveryFee({ delivery_address: "9402 Solana Drive, Monte Alto, TX, USA", route_miles: 321.3 });
    expect(s.breakdown).toBeNull();
    expect(s.list).toBeNull();
    const ok = suggestDeliveryFee({ delivery_address: "9402 Solana Drive, Monte Alto, TX, USA", route_miles: 25.5 });
    expect(ok.list).not.toBeNull();
  });
});
