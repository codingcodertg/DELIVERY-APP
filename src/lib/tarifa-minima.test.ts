import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  bloqueoPorTarifaMinima, cobraTarifa, leeTarifaMinima, ofreceDescuento, tarifaMinimaDeTienda, tarifaMinimaQueAplica,
  textoTarifaMinima,
} from "./tarifa-minima";
import { registroDeLugar } from "./named-location";
import type { NamedLocation, UserRole } from "./types";

// D-546. «En mcallen los vendedores no usan descuento de cobro como excepcion. La tarifa es 100 minimo. Tenemos que
// quitarles esa opcion de descuento». Nombres de tienda inventados: el mínimo es un dato de Ajustes, no del repo.
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Con Minimo", address: "1 Calle", tarifa_minima_ventas: 100 },
  { name: "Tienda Libre", address: "2 Calle" },
];
const CLIENTE = "Customer Delivery"; // sin regla explícita → docRef «invoice», cobra tarifa

const bloqueo = (over: Partial<Parameters<typeof bloqueoPorTarifaMinima>[0]> = {}) =>
  bloqueoPorTarifaMinima({ rol: "sales", tienda: "Tienda Con Minimo", tiendas: TIENDAS, tipo: CLIENTE, tarifa: 80, ...over });

describe("el mínimo es un dato de la tienda", () => {
  it("se lee por el nombre normalizado de la tienda «Sold From»", () => {
    expect(tarifaMinimaDeTienda("  tienda con minimo ", TIENDAS)).toBe(100);
    expect(tarifaMinimaDeTienda("Tienda Libre", TIENDAS)).toBeNull();
    expect(tarifaMinimaDeTienda("", TIENDAS)).toBeNull();
    expect(tarifaMinimaDeTienda(null, TIENDAS)).toBeNull();
  });

  it("solo un número mayor que cero es un mínimo; cero, negativo, texto o vacío son «sin mínimo»", () => {
    expect(leeTarifaMinima(100)).toBe(100);
    expect(leeTarifaMinima("100")).toBe(100);
    expect(leeTarifaMinima(0)).toBeNull();
    expect(leeTarifaMinima(-5)).toBeNull();
    expect(leeTarifaMinima("abc")).toBeNull();
    expect(leeTarifaMinima("")).toBeNull();
    expect(leeTarifaMinima(null)).toBeNull();
  });

  it("Datos → Tiendas lo guarda con el registro de la tienda, y vacío quita la clave", () => {
    const prev: NamedLocation = { name: "Tienda Con Minimo", address: "1 Calle" };
    const conMinimo = registroDeLugar(prev, { ...prev, tarifa_minima_ventas: 100 }, { directoryCode: true });
    expect(conMinimo.tarifa_minima_ventas).toBe(100);
    const sinMinimo = registroDeLugar(conMinimo, { ...conMinimo, tarifa_minima_ventas: null }, { directoryCode: true });
    expect("tarifa_minima_ventas" in sinMinimo).toBe(false);
  });
});

describe("solo a ventas", () => {
  it("al vendedor le aplica el mínimo de su tienda; a oficina, gerente y admin, no", () => {
    expect(tarifaMinimaQueAplica("sales", "Tienda Con Minimo", TIENDAS)).toBe(100);
    for (const rol of ["admin", "manager", "warehouse", "logistics", "accounting"] as UserRole[]) {
      expect(tarifaMinimaQueAplica(rol, "Tienda Con Minimo", TIENDAS), rol).toBeNull();
    }
  });

  it("el botón «Descuento» se le quita al vendedor en una tienda con mínimo, y a nadie más", () => {
    expect(ofreceDescuento("sales", "Tienda Con Minimo", TIENDAS)).toBe(false);
    expect(ofreceDescuento("sales", "Tienda Libre", TIENDAS)).toBe(true);
    expect(ofreceDescuento("admin", "Tienda Con Minimo", TIENDAS)).toBe(true);
    expect(ofreceDescuento("manager", "Tienda Con Minimo", TIENDAS)).toBe(true);
  });
});

describe("solo en los tipos que cobran tarifa", () => {
  it("cobra el tipo con factura; no Intertienda, Transfer, Proveedor, ni un tipo de PO; sin tipo, tampoco", () => {
    expect(cobraTarifa(CLIENTE)).toBe(true);
    expect(cobraTarifa("Intertienda")).toBe(false);
    expect(cobraTarifa("Transfer")).toBe(false);
    expect(cobraTarifa("Proveedor")).toBe(false);
    expect(cobraTarifa("Especial", { Especial: { storeToStore: false, docRef: "po" } })).toBe(false);
    expect(cobraTarifa("")).toBe(false);
  });
});

describe("el envío se para por debajo del mínimo", () => {
  it("vendedor, tienda con mínimo, tipo que cobra, 80 < 100 → bloqueado, con la tienda y el mínimo", () => {
    expect(bloqueo()).toEqual({ tienda: "Tienda Con Minimo", minimo: 100 });
  });

  it("justo el mínimo pasa, y por encima también", () => {
    expect(bloqueo({ tarifa: 100 })).toBeNull();
    expect(bloqueo({ tarifa: 150 })).toBeNull();
  });

  it("99,99 no pasa: el mínimo es el número, no el redondeo", () => {
    expect(bloqueo({ tarifa: 99.99 })).not.toBeNull();
  });

  it("tarifa vacía o cero tampoco pasa: si no, dejarla en blanco saltaría el mínimo", () => {
    expect(bloqueo({ tarifa: null })).not.toBeNull();
    expect(bloqueo({ tarifa: 0 })).not.toBeNull();
  });

  it("el gerente o el admin con la misma orden no se bloquean", () => {
    expect(bloqueo({ rol: "manager" })).toBeNull();
    expect(bloqueo({ rol: "admin" })).toBeNull();
  });

  it("una Intertienda o un Transfer del vendedor no se bloquean: no cobran", () => {
    expect(bloqueo({ tipo: "Intertienda", tarifa: null })).toBeNull();
    expect(bloqueo({ tipo: "Transfer", tarifa: 0 })).toBeNull();
  });

  it("en una tienda sin mínimo el vendedor cobra lo que quiera", () => {
    expect(bloqueo({ tienda: "Tienda Libre", tarifa: 10 })).toBeNull();
  });

  it("el mensaje dice la tienda y el mínimo, en los dos idiomas", () => {
    expect(textoTarifaMinima({ tienda: "Tienda Con Minimo", minimo: 100 })).toEqual({
      en: "The minimum delivery fee at Tienda Con Minimo is $100.",
      es: "La tarifa mínima en Tienda Con Minimo es $100.",
    });
  });
});

describe("la ficha usa la regla (anclas de fuente)", () => {
  const modal = readFileSync("src/components/OrderModal.tsx", "utf8").split("\r\n").join("\n");

  it("los dos sitios de la ficha pasan `descuentoOfrecido`, que sale de `ofreceDescuento`", () => {
    expect(modal).toContain("const descuentoOfrecido = ofreceDescuento(me.role, d.store, settings.stores) ? feeSuggestion.discount : null;");
    expect(modal.split("<BotonesDeTarifa tarifa={d.delivery_fee} list={feeSuggestion.list} discount={descuentoOfrecido}").length - 1).toBe(2);
  });

  it("passesChecks para el envío con `bloqueoPorTarifaMinima`, antes de cualquier «¿continuar?»", () => {
    // Nota D-NEXT: la firma lleva `opts` (la pregunta de «Juntar» de Intertienda); el cuerpo que se fija no cambia.
    const i = modal.indexOf("const passesChecks = async (draft: Draft, opts: { facturaYaDecidida?: boolean } = {}): Promise<boolean> => {");
    expect(i).toBeGreaterThan(-1);
    const cabeza = modal.slice(i, modal.indexOf("const miss = computeMissing(draft);", i));
    expect(cabeza).toContain("bloqueoPorTarifaMinima({ rol: me.role, tienda: draft.store, tiendas: settings.stores, tipo: draft.order_type, reglas: settings.order_type_rules, tarifa: draft.delivery_fee })");
    expect(cabeza).toContain("if (bajoMinimo) { const m = textoTarifaMinima(bajoMinimo); notify(t(m.en, m.es)); return false; }");
  });
});
