import { describe, it, expect } from "vitest";
import { esTraslado, separaTraslados } from "./traslados-de-chofer";
import type { OrderTypeRules } from "./required";

// Las reglas de los tipos de orden de la demo (`demo-data.ts`): Customer, Intertienda, Transfer, Proveedor.
const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" },
  Proveedor: { storeToStore: false, hasCustomer: false, docRef: "hidden" },
};

describe("esTraslado", () => {
  it("una entrega a cliente no es traslado", () => {
    expect(esTraslado("Customer", REGLAS)).toBe(false);
    expect(esTraslado("Cliente", undefined)).toBe(false);
    expect(esTraslado(null, REGLAS)).toBe(false);
  });

  it("Intertienda y Transfer son traslados, con reglas explícitas y sin ellas", () => {
    expect(esTraslado("Intertienda", REGLAS)).toBe(true);
    expect(esTraslado("Transfer", REGLAS)).toBe(true);
    expect(esTraslado("Intertienda", undefined)).toBe(true);
    expect(esTraslado("Transfer", undefined)).toBe(true);
  });

  it("un proveedor no lleva cliente detrás: cuenta como traslado, no como entrega", () => {
    expect(esTraslado("Proveedor", REGLAS)).toBe(true);
  });

  it("un tipo nuevo con cliente explícito sigue siendo entrega a cliente", () => {
    const reglas = { Cliente2: { storeToStore: false, hasCustomer: true, docRef: "invoice" as const } };
    expect(esTraslado("Cliente2", reglas)).toBe(false);
  });
});

describe("separaTraslados", () => {
  it("reparte las órdenes de un chofer como Juan (sobre todo Intertienda) y conserva el orden", () => {
    const ordenes = [
      { id: "1", order_type: "Intertienda" },
      { id: "2", order_type: "Customer" },
      { id: "3", order_type: "Intertienda" },
      { id: "4", order_type: "Intertienda" },
      { id: "5", order_type: "Customer" },
    ];
    const { clientes, traslados } = separaTraslados(ordenes, REGLAS);
    expect(clientes.map((o) => o.id)).toEqual(["2", "5"]);
    expect(traslados.map((o) => o.id)).toEqual(["1", "3", "4"]);
  });

  it("una lista vacía da dos listas vacías", () => {
    expect(separaTraslados([], REGLAS)).toEqual({ clientes: [], traslados: [] });
  });
});
