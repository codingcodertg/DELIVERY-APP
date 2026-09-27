import { describe, expect, it } from "vitest";
import {
  aCentavos, apellidoDe, borradorVacio, cajasDeLinea, cajasPorDefecto, fechaLarga, hoyLocal, lineaSfVacia,
  lineaUnidadVacia, paraQuienSeImprime, sfReal, totalDeLinea, totalDeMateriales, type SfLine, type UnitLine,
} from "./modelo";

// Los datos son los del documento del dueño («Estimate print outs app copy», plantilla 3): 1,250 SF
// pedidos, 23.80 SF/caja, $1.89/SF → 53 cajas, 1,261.40 SF reales. El documento pone de total $2,383.57,
// pero 1,261.40 × 1.89 = **$2,384.05**: su ejemplo está redondeado a mano (2,383.57 / 1,261.40 = 1.8896).
// Se prueba la cuenta, no el ejemplo.
const carrara = (patch: Partial<SfLine> = {}): SfLine => ({
  ...lineaSfVacia(), customer_category: "24x48 Tile", customer_note: "Main Floor",
  requested_sf: 1250, sf_per_box: 23.8, price_per_sf: 1.89, ...patch,
});

describe("cajas de por defecto: las completas que cubren lo pedido", () => {
  it("1,250 SF a 23.80 SF/caja son 53 cajas (52.52 hacia arriba)", () => {
    expect(cajasPorDefecto(1250, 23.8)).toBe(53);
  });
  it("una división exacta no pide una caja de más", () => {
    expect(cajasPorDefecto(1250, 25)).toBe(50);
    expect(cajasPorDefecto(100, 10)).toBe(10);
  });
  it("una pizca por encima de lo exacto sí pide la siguiente", () => {
    expect(cajasPorDefecto(100.5, 10)).toBe(11);
  });
  it("sin SF pedidos o sin SF/caja no hay cajas que inventar", () => {
    expect(cajasPorDefecto(null, 23.8)).toBeNull();
    expect(cajasPorDefecto(1250, null)).toBeNull();
    expect(cajasPorDefecto(0, 23.8)).toBeNull();
  });
  it("las que escribe el vendedor mandan sobre las de por defecto", () => {
    expect(cajasDeLinea(carrara())).toBe(53);
    expect(cajasDeLinea(carrara({ boxes: 60 }))).toBe(60);
  });
});

describe("Actual SF y total de la línea", () => {
  it("Actual SF = cajas × SF/caja: 53 × 23.80 = 1,261.40", () => {
    expect(sfReal(carrara())).toBe(1261.4);
  });
  it("Line Total = cajas × SF/caja × $/SF = $2,384.05 (el SF real, no el pedido)", () => {
    expect(totalDeLinea(carrara())).toBe(2384.05);
    // Con el SF pedido saldría 2,362.50: el cliente paga las cajas completas.
    expect(totalDeLinea(carrara())).not.toBe(2362.5);
  });
  it("con cajas escritas a mano, el total las usa", () => {
    expect(totalDeLinea(carrara({ boxes: 50, sf_per_box: 25 }))).toBe(2362.5);
  });
  it("una línea a medias no suma: devuelve null", () => {
    expect(totalDeLinea(carrara({ price_per_sf: null }))).toBeNull();
    expect(totalDeLinea(carrara({ sf_per_box: null }))).toBeNull();
  });
  it("una línea sin SF: «Installation Materials, 1 Lot, $385»", () => {
    const lote: UnitLine = { ...lineaUnidadVacia(), customer_category: "Installation Materials", quantity: 1, unit_price: 385 };
    expect(totalDeLinea(lote)).toBe(385);
    expect(totalDeLinea({ ...lote, quantity: 3 })).toBe(1155);
  });
});

describe("el total de materiales", () => {
  it("suma las líneas", () => {
    const lote: UnitLine = { ...lineaUnidadVacia(), customer_category: "Installation Materials", quantity: 1, unit_price: 385 };
    const mosaico = carrara({ customer_category: "Mosaic", requested_sf: 25, sf_per_box: 10, price_per_sf: 8.99 });
    // 53 × 23.8 × 1.89 = 2384.05 · 3 × 10 × 8.99 = 269.70 · 385
    expect(totalDeMateriales([carrara(), mosaico, lote])).toBe(3038.75);
  });
  it("una línea incompleta cuenta cero, no rompe la suma", () => {
    expect(totalDeMateriales([carrara(), carrara({ price_per_sf: null })])).toBe(2384.05);
  });
  it("redondea a centavos con el medio hacia arriba", () => {
    expect(aCentavos(2384.046)).toBe(2384.05);
    expect(aCentavos(2384.044)).toBe(2384.04);
    expect(aCentavos(1.005)).toBe(1.01);
  });
});

describe("el cliente: nombre completo dentro, «Ms. Apellido» fuera", () => {
  it("el apellido sale del nombre completo", () => {
    expect(apellidoDe("Maria Gonzalez")).toBe("Gonzalez");
    expect(apellidoDe("  Maria   de la Cruz ")).toBe("Cruz");
    expect(apellidoDe("Maria")).toBe("");
  });
  it("lo que se imprime es tratamiento + apellido", () => {
    expect(paraQuienSeImprime({ salutation: "Ms.", last_name: "Gonzalez" })).toBe("Ms. Gonzalez");
    expect(paraQuienSeImprime({ salutation: "Mr.", last_name: "  " })).toBe("");
  });
});

describe("fechas", () => {
  it("validez del mismo día: el borrador nace con hoy", () => {
    expect(borradorVacio("2026-09-08").valid_through).toBe("2026-09-08");
  });
  it("hoy en hora LOCAL, no UTC", () => {
    expect(hoyLocal(new Date(2026, 8, 8, 23, 30))).toBe("2026-09-08");
  });
  it("«September 8, 2026», sin que una zona horaria mueva el día", () => {
    expect(fechaLarga("2026-09-08")).toBe("September 8, 2026");
    expect(fechaLarga("2026-12-31")).toBe("December 31, 2026");
    expect(fechaLarga("x")).toBe("");
  });
});
