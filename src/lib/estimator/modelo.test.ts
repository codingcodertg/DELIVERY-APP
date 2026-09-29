import { describe, expect, it } from "vitest";
import {
  aCentavos, apellidoDe, borradorVacio, extensionDePartida, SALUTATIONS, telefonoAlEscribir, telefonoLimpio, cajasDeLinea, cajasPorDefecto, fechaLarga, hoyLocal, lineaSfVacia,
  lineaUnidadVacia, paraQuienSeImprime, sfReal, totalDeLinea, totalDeMateriales, type SfLine, type UnitLine,
  estadoDelPrecioBajo, porcentajeDeDescuento, precioAplicado, resumenDeTotales, TASA_DE_IMPUESTO, totalRegularDeLinea,
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
  });
  it("una sola palabra es el apellido (D-432: ya no hay campo aparte); vacío solo sin nombre", () => {
    expect(apellidoDe("Gonzalez")).toBe("Gonzalez");
    expect(apellidoDe("   ")).toBe("");
  });
  it("lo que se imprime es tratamiento + apellido, sacado del nombre completo", () => {
    expect(paraQuienSeImprime({ salutation: "Ms.", full_name: "Maria Gonzalez" })).toBe("Ms. Gonzalez");
    expect(paraQuienSeImprime({ salutation: "Mr.", full_name: "  " })).toBe("");
  });
  it("el tratamiento por defecto es «Mr.» (D-432), y va primero en la lista", () => {
    expect(borradorVacio().customer.salutation).toBe("Mr.");
    expect(SALUTATIONS[0]).toBe("Mr.");
    expect([...SALUTATIONS].sort()).toEqual(["Mr.", "Mrs.", "Ms."]);
  });
});

describe("el teléfono del cliente, con forma limpia 956-xxx-xxxx (D-432)", () => {
  it("paréntesis, espacios, puntos y +1 se normalizan", () => {
    expect(telefonoLimpio("(956) 555 0123")).toBe("956-555-0123");
    expect(telefonoLimpio("+1 956 555 0123")).toBe("956-555-0123");
    expect(telefonoLimpio("1-956-555-0123")).toBe("956-555-0123");
    expect(telefonoLimpio("956.555.0123")).toBe("956-555-0123");
    expect(telefonoLimpio("9565550123")).toBe("956-555-0123");
  });
  it("lo que no son 10 dígitos de EE. UU. no se toca: null, y al escribir se deja tal cual", () => {
    expect(telefonoLimpio("555 0123")).toBeNull();
    expect(telefonoLimpio("95655501234")).toBeNull();
    expect(telefonoLimpio("(056) 555 0123")).toBeNull();
    expect(telefonoAlEscribir("555 0123")).toBe("555 0123");
    expect(telefonoAlEscribir("(956) 555 012")).toBe("(956) 555 012");
    expect(telefonoAlEscribir("(956) 555 0123")).toBe("956-555-0123");
  });
});

describe("la extensión de quien prepara sale sola (D-432)", () => {
  it("primero la del expediente; aunque el navegador recuerde otra", () => {
    expect(extensionDePartida(" 214 ", "999")).toEqual({ valor: "214", origen: "expediente" });
  });
  it("sin expediente, la que se escribió en este navegador; sin ninguna, vacía", () => {
    expect(extensionDePartida(null, "305")).toEqual({ valor: "305", origen: "navegador" });
    expect(extensionDePartida("  ", "305")).toEqual({ valor: "305", origen: "navegador" });
    expect(extensionDePartida(null, null)).toEqual({ valor: "", origen: "ninguno" });
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

describe("precio más bajo: Discount % = (Regular − Lower) / Regular × 100 (D-442, la imagen del dueño)", () => {
  it("10 → 8 es 20 %", () => {
    expect(porcentajeDeDescuento(10, 8)).toBe(20);
  });
  it("3.50 → 3.15 es 10 % (sin el 10.000000000000002 del binario)", () => {
    expect(porcentajeDeDescuento(3.5, 3.15)).toBe(10);
  });
  it("a un decimal: 3 → 2 es 33.3 %; 1.89 → 1.70 es 10.1 %", () => {
    expect(porcentajeDeDescuento(3, 2)).toBe(33.3);
    expect(porcentajeDeDescuento(1.89, 1.7)).toBe(10.1);
  });
  it("igual, mayor o vacío: sin descuento, y se dice cuál", () => {
    expect([porcentajeDeDescuento(10, 10), estadoDelPrecioBajo(10, 10)]).toEqual([null, "no-menor"]);
    expect([porcentajeDeDescuento(10, 12), estadoDelPrecioBajo(10, 12)]).toEqual([null, "no-menor"]);
    expect([porcentajeDeDescuento(10, null), estadoDelPrecioBajo(10, null)]).toEqual([null, "sin"]);
  });
  it("regular 0 o vacío: sin descuento (no se divide por cero)", () => {
    expect([porcentajeDeDescuento(0, 0), estadoDelPrecioBajo(0, 0)]).toEqual([null, "sin-regular"]);
    expect([porcentajeDeDescuento(null, 5), estadoDelPrecioBajo(null, 5)]).toEqual([null, "sin-regular"]);
  });
  it("el precio aplicado es el más bajo solo si es un descuento de verdad", () => {
    expect(precioAplicado(10, 8)).toBe(8);
    expect(precioAplicado(10, 12)).toBe(10);
    expect(precioAplicado(10, null)).toBe(10);
  });
});

describe("la línea se calcula con el precio aplicado, y el total regular aparte (D-442)", () => {
  it("por SF: 53 cajas × 23.80 × 1.70 = 2,144.38; a regular 2,384.05", () => {
    const l = carrara({ lower_price_per_sf: 1.7 });
    expect(totalDeLinea(l)).toBe(2144.38);
    expect(totalRegularDeLinea(l)).toBe(2384.05);
  });
  it("un precio más bajo que no es menor no cambia nada", () => {
    expect(totalDeLinea(carrara({ lower_price_per_sf: 2 }))).toBe(2384.05);
  });
  it("por unidad: 3 × 10 con más bajo 8 = 24; regular 30", () => {
    const l: UnitLine = { ...lineaUnidadVacia(), quantity: 3, unit_price: 10, lower_unit_price: 8 };
    expect([totalDeLinea(l), totalRegularDeLinea(l)]).toEqual([24, 30]);
  });
  it("sin precio regular la línea sigue incompleta aunque haya uno más bajo", () => {
    expect(totalDeLinea(carrara({ price_per_sf: null, lower_price_per_sf: 1.5 }))).toBeNull();
  });
});

describe("subtotal → ahorro → impuesto → total (D-442)", () => {
  // Dos líneas: una 10 → 8 y otra sin descuento.
  const conDescuento: UnitLine = { ...lineaUnidadVacia(), quantity: 3, unit_price: 10, lower_unit_price: 8 };
  const sinDescuento: UnitLine = { ...lineaUnidadVacia(), quantity: 1, unit_price: 385 };
  it("la tasa por defecto es 8.25 %", () => {
    expect(TASA_DE_IMPUESTO).toBe(8.25);
  });
  it("subtotal 415.00, ahorro 6.00, impuesto 8.25 % de 409.00 = 33.74, total 442.74", () => {
    expect(resumenDeTotales([conDescuento, sinDescuento])).toEqual({
      subtotal: 415, ahorro: 6, baseImponible: 409, tasa: 8.25, impuesto: 33.74, total: 442.74,
    });
  });
  it("el impuesto va sobre el subtotal YA con el ahorro, no sobre el regular", () => {
    // 8.25 % de 415 sería 34.24: si sale eso, se cobró impuesto sobre lo ahorrado.
    expect(resumenDeTotales([conDescuento, sinDescuento]).impuesto).not.toBe(34.24);
  });
  it("sin precios más bajos el ahorro es 0 y el total es subtotal + impuesto", () => {
    const r = resumenDeTotales([carrara()]);
    expect(r).toEqual({ subtotal: 2384.05, ahorro: 0, baseImponible: 2384.05, tasa: 8.25, impuesto: 196.68, total: 2580.73 });
  });
  it("la base imponible es totalDeMateriales (solo líneas, D-413)", () => {
    expect(resumenDeTotales([conDescuento, sinDescuento]).baseImponible).toBe(totalDeMateriales([conDescuento, sinDescuento]));
  });
});
