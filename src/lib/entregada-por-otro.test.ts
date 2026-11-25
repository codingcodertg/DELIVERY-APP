import { describe, expect, it } from "vitest";
import { diaFijoPorLaEntrega, diaQueSeGuarda, esFechaISO, LARGO_MAX_QUIEN, notaDeEntregadaPorOtro, parcheDeEntregadaPorOtro, sugerenciasDeQuien, validaEntregadaPorOtro } from "./entregada-por-otro";

// 23:30 del 24 de noviembre en Texas (UTC-6) cae el 25 en UTC: el día que cuenta es el de Texas.
const ENTREGA_TARDE = "2026-11-25T05:30:00.000Z";

describe("sugerenciasDeQuien", () => {
  it("pone «Warehouse <tienda>» primero, con la tienda tal cual viene en la orden", () => {
    expect(sugerenciasDeQuien("RDZ Brownsville", ["Max", "Ana"], "Max")).toEqual(["Warehouse RDZ Brownsville", "Ana"]);
  });
  it("no repite el prefijo si la tienda ya lo trae", () => {
    expect(sugerenciasDeQuien("Warehouse BRO", [], null)).toEqual(["Warehouse BRO"]);
  });
  it("quita el chofer actual y los duplicados sin importar mayúsculas", () => {
    expect(sugerenciasDeQuien("BRO", ["max", "MAX", "Ana", "ana"], "Max")).toEqual(["Warehouse BRO", "Ana"]);
  });
  it("sin tienda no sugiere «Warehouse» vacío", () => {
    expect(sugerenciasDeQuien(null, ["Ana"], undefined)).toEqual(["Ana"]);
    expect(sugerenciasDeQuien("  ", [], undefined)).toEqual([]);
  });
});

describe("validaEntregadaPorOtro", () => {
  const base = { quien: "Warehouse BRO", dia: "2026-11-24", hoy: "2026-11-25", choferActual: "Max" };
  it("una entrada buena no tiene motivo", () => {
    expect(validaEntregadaPorOtro(base)).toBeNull();
  });
  it("«quien» vacío o solo espacios no vale", () => {
    expect(validaEntregadaPorOtro({ ...base, quien: "   " })).toBe("quien-vacio");
  });
  it("«quien» de más de 80 caracteres no vale; 80 sí", () => {
    expect(validaEntregadaPorOtro({ ...base, quien: "x".repeat(LARGO_MAX_QUIEN) })).toBeNull();
    expect(validaEntregadaPorOtro({ ...base, quien: "x".repeat(LARGO_MAX_QUIEN + 1) })).toBe("quien-largo");
  });
  it("no puede ser el chofer que ya tiene la orden (sin mayúsculas)", () => {
    expect(validaEntregadaPorOtro({ ...base, quien: " max " })).toBe("mismo-chofer");
  });
  it("el día tiene que existir de verdad en formato yyyy-mm-dd", () => {
    expect(validaEntregadaPorOtro({ ...base, dia: "2026-02-31" })).toBe("dia-no-valido");
    expect(validaEntregadaPorOtro({ ...base, dia: "24/11/2026" })).toBe("dia-no-valido");
    expect(validaEntregadaPorOtro({ ...base, dia: "" })).toBe("dia-no-valido");
  });
  it("el día no puede ser después de hoy; hoy sí vale", () => {
    expect(validaEntregadaPorOtro({ ...base, dia: "2026-11-26" })).toBe("dia-futuro");
    expect(validaEntregadaPorOtro({ ...base, dia: "2026-11-25" })).toBeNull();
  });
  it("sin chofer actual no compara", () => {
    expect(validaEntregadaPorOtro({ quien: "Max", dia: "2026-11-24", hoy: "2026-11-25" })).toBeNull();
  });
});

describe("esFechaISO", () => {
  it("acepta años bisiestos y rechaza fechas que no existen", () => {
    expect(esFechaISO("2028-02-29")).toBe(true);
    expect(esFechaISO("2027-02-29")).toBe(false);
  });
});

describe("parcheDeEntregadaPorOtro", () => {
  it("sin hora de entrega: cambia chofer y día, y pone los puestos a null; la etapa no va en el parche", () => {
    const p = parcheDeEntregadaPorOtro({ quien: "  Warehouse BRO ", dia: "2026-11-24", conRecogida: false, podDeLaEntrega: null });
    expect(p).toEqual({ assigned_driver: "Warehouse BRO", delivery_date: "2026-11-24", route_seq: null, load_no: null });
    expect("stage" in p).toBe(false);
    expect("pickup_seq" in p).toBe(false);
  });
  it("con hora de entrega registrada: NO lleva delivery_date (la fecha se queda en su día)", () => {
    const p = parcheDeEntregadaPorOtro({ quien: "Warehouse BRO", dia: "2026-11-20", conRecogida: false, podDeLaEntrega: ENTREGA_TARDE });
    expect(p).toEqual({ assigned_driver: "Warehouse BRO", route_seq: null, load_no: null });
    expect("delivery_date" in p).toBe(false);
  });
  it("con la columna de recogida (154) también pone pickup_seq a null", () => {
    const p = parcheDeEntregadaPorOtro({ quien: "Warehouse BRO", dia: "2026-11-24", conRecogida: true, podDeLaEntrega: null });
    expect(p.pickup_seq).toBeNull();
  });
});

describe("diaFijoPorLaEntrega y diaQueSeGuarda", () => {
  it("la hora de entrega se lee en el día de Texas, no en UTC", () => {
    expect(diaFijoPorLaEntrega(ENTREGA_TARDE)).toBe("2026-11-24");
    expect(diaFijoPorLaEntrega("2026-11-24T18:00:00.000Z")).toBe("2026-11-24");
  });
  it("sin hora (o con una que no es fecha), no hay día fijo", () => {
    expect(diaFijoPorLaEntrega(null)).toBeNull();
    expect(diaFijoPorLaEntrega("")).toBeNull();
    expect(diaFijoPorLaEntrega("no es fecha")).toBeNull();
  });
  it("lo que se guarda: el día de la hora si la hay; si no, el elegido", () => {
    expect(diaQueSeGuarda({ dia: "2026-11-20", podDeLaEntrega: ENTREGA_TARDE })).toBe("2026-11-24");
    expect(diaQueSeGuarda({ dia: "2026-11-23", podDeLaEntrega: null })).toBe("2026-11-23");
  });
});

describe("notaDeEntregadaPorOtro", () => {
  it("escribe las dos lenguas en una línea, con el chofer anterior", () => {
    expect(notaDeEntregadaPorOtro({ quien: "Warehouse BRO", dia: "2026-11-24", anterior: "Max", podDeLaEntrega: null })).toBe(
      "Delivered on 2026-11-24 by Warehouse BRO, not by Max. / Entregada el 2026-11-24 por Warehouse BRO, no por Max.");
  });
  it("sin chofer anterior no pone la parte de «no por»", () => {
    expect(notaDeEntregadaPorOtro({ quien: "Warehouse BRO", dia: "2026-11-24", anterior: null, podDeLaEntrega: null })).toBe(
      "Delivered on 2026-11-24 by Warehouse BRO. / Entregada el 2026-11-24 por Warehouse BRO.");
  });
  it("con hora de entrega, la nota dice el día que de verdad queda guardado (el de la hora)", () => {
    expect(notaDeEntregadaPorOtro({ quien: "Warehouse BRO", dia: "2026-11-20", anterior: "Max", podDeLaEntrega: ENTREGA_TARDE })).toBe(
      "Delivered on 2026-11-24 by Warehouse BRO, not by Max. / Entregada el 2026-11-24 por Warehouse BRO, no por Max.");
  });
});
