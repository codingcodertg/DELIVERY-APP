import { describe, expect, it } from "vitest";

import { buscarDireccionAlAbrir, vistaDelSelector } from "@/lib/pin-draft";

// Ayuda abde8b1c (Francisca, 2026-11-05): «NEED TO SEE THE ADDRESS ON THE MAP».
describe("vistaDelSelector", () => {
  const DIR: [number, number] = [26.3479456, -97.9949275]; // 9402 Solana Dr, Monte Alto

  it("sin pin ni punto, abre sobre la dirección encontrada y la marca como referencia", () => {
    expect(vistaDelSelector({ borrador: null, pedido: { delivery_lat: null, delivery_lng: null }, direccion: DIR }))
      .toEqual({ center: DIR, zoom: 16, referencia: DIR });
  });

  it("el borrador y el punto guardado mandan sobre la dirección, sin referencia", () => {
    expect(vistaDelSelector({ borrador: [26.2, -98.2], pedido: {}, direccion: DIR })).toEqual({ center: [26.2, -98.2], referencia: null });
    expect(vistaDelSelector({ borrador: null, pedido: { delivery_lat: 26.1, delivery_lng: -98.1 }, direccion: DIR }))
      .toEqual({ center: [26.1, -98.1], referencia: null });
  });

  it("sin nada, el encuadre de siempre", () => {
    expect(vistaDelSelector({ borrador: null, pedido: {}, direccion: null })).toEqual({ referencia: null });
  });
});

describe("buscarDireccionAlAbrir", () => {
  it("busca si hay dirección y no hay punto; no si ya hay punto o no hay texto", () => {
    expect(buscarDireccionAlAbrir({ delivery_address: "9402 Solana Drive, Monte Alto, TX, USA" })).toBe(true);
    expect(buscarDireccionAlAbrir({ delivery_address: "x", delivery_lat: 0, delivery_lng: 0 })).toBe(true);
    expect(buscarDireccionAlAbrir({ delivery_address: "x", delivery_lat: 26, delivery_lng: -98 })).toBe(false);
    expect(buscarDireccionAlAbrir({ delivery_address: "  " })).toBe(false);
  });
});
