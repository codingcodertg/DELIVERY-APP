import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { conTiendaDeLaRecogida, esTransferenciaSinVenta, tiendaDeLaRecogida } from "./transferencia-sin-venta";
import { missingFields } from "./required";
import { aplicaTipo, type ContextoDelUsuario } from "./order-sites";
import type { NamedLocation, OrderTypeRule } from "./types";

/** Una transferencia no vende: sin «Vendido desde», y `store` sigue a la recogida (D-741, 2026-10-29). */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave" },
  { name: "Tienda Sur", address: "200 Sur Blvd" },
];
const REGLAS: Record<string, OrderTypeRule> = {
  Transfer: { docRef: "estimate", storeToStore: true },
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Customer: { docRef: "invoice", storeToStore: false },
};

describe("qué tipo es una transferencia sin venta", () => {
  it("de tienda a tienda sin tienda que reciba fija: Transfer sí; Intertienda y Customer no", () => {
    expect(esTransferenciaSinVenta(REGLAS.Transfer)).toBe(true);
    expect(esTransferenciaSinVenta(REGLAS.Intertienda)).toBe(false);
    expect(esTransferenciaSinVenta(REGLAS.Customer)).toBe(false);
    expect(esTransferenciaSinVenta({})).toBe(false);
  });
});

describe("`store` sigue a la recogida", () => {
  it("si la recogida es una tienda de Ajustes (sin mayúsculas ni espacios), esa; si no, vacío", () => {
    expect(tiendaDeLaRecogida(" tienda norte ", TIENDAS)).toBe("Tienda Norte");
    expect(tiendaDeLaRecogida("Bodega Azul", TIENDAS)).toBe("");
    expect(tiendaDeLaRecogida(null, TIENDAS)).toBe("");
  });
  it("solo en una transferencia; en los demás tipos no se toca", () => {
    const p = { pickup_name: "Tienda Sur", store: "Tienda Norte" };
    expect(conTiendaDeLaRecogida(p, TIENDAS, REGLAS.Transfer).store).toBe("Tienda Sur");
    expect(conTiendaDeLaRecogida({ pickup_name: "Bodega Azul", store: "Tienda Norte" }, TIENDAS, REGLAS.Transfer).store).toBe("");
    expect(conTiendaDeLaRecogida(p, TIENDAS, REGLAS.Intertienda).store).toBe("Tienda Norte");
    expect(conTiendaDeLaRecogida(p, TIENDAS, REGLAS.Customer).store).toBe("Tienda Norte");
  });
  it("al elegir el tipo Transfer, `store` deja de ser la tienda del vendedor y sigue a la recogida", () => {
    const c: ContextoDelUsuario = { rol: "sales", miTienda: "Tienda Norte", tipos: Object.keys(REGLAS), tiendas: TIENDAS, reglas: REGLAS };
    // Sin recogida elegida, se propone la tienda del vendedor como recogida y `store` la sigue; sin tienda, nada.
    const t = aplicaTipo({ order_type: "Customer", store: "Tienda Norte", pickup_name: "", pickup_address: "" }, "Transfer", c);
    expect(t.pickup_name).toBe("Tienda Norte");
    expect(t.pickup_address).toBe("100 Norte Ave");
    expect(t.store).toBe("Tienda Norte");
    const sinTienda = aplicaTipo({ order_type: "Customer", store: "", pickup_name: "", pickup_address: "" }, "Transfer", { ...c, miTienda: null });
    expect(sinTienda.store).toBe("");
    expect(sinTienda.pickup_name ?? "").toBe("");
    const conRecogida = aplicaTipo({ order_type: "Customer", store: "Tienda Norte", pickup_name: "Tienda Sur", pickup_address: "200 Sur Blvd" }, "Transfer", c);
    expect(conRecogida.store).toBe("Tienda Sur");
    // Control: a Customer le sigue poniendo la tienda del vendedor.
    expect(aplicaTipo({ order_type: "", store: "" }, "Customer", c).store).toBe("Tienda Norte");
  });
});

describe("qué se exige", () => {
  const base = { order_type: "Transfer", pickup_name: "Tienda Sur", pickup_address: "200 Sur Blvd", delivery_name: "Tienda Norte", delivery_address: "100 Norte Ave", delivery_date: "2026-11-02", delivery_windows: "AM", est_pallets: 1, estimate_num: "E1" };
  it("en una transferencia no se pide «Tienda (Vendido desde)»; la recogida y el destino sí", () => {
    const faltan = missingFields({ ...base, store: "" }, REGLAS).map((f) => f.key);
    expect(faltan).not.toContain("store");
    expect(missingFields({ ...base, store: "", pickup_name: "" }, REGLAS).map((f) => f.key)).toContain("pickup_name");
    expect(missingFields({ ...base, store: "", delivery_name: "" }, REGLAS).map((f) => f.key)).toContain("delivery_name");
  });
  it("control: a una Intertienda y a un Customer se les sigue pidiendo", () => {
    expect(missingFields({ ...base, order_type: "Intertienda", store: "" }, REGLAS).map((f) => f.key)).toContain("store");
    expect(missingFields({ ...base, order_type: "Customer", store: "" }, REGLAS).map((f) => f.key)).toContain("store");
  });
});

describe("la ficha", () => {
  const modal = leer("src/components/OrderModal.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  it("la fila de «Vendido desde» (las dos veces) va tras la condición de transferencia, y nada más", () => {
    // D-782 suma la segunda condición: con recogida libre (Otro, Proveedor) y tienda ya puesta, «Vendido desde» no se pinta.
    expect(modal.split("{!sinVenta && !(recogidaLibreDelTipo && !!d.store) && (").length - 1).toBe(2);
    expect(modal).toContain("const sinVenta = esTransferenciaSinVenta(reglaDelTipo);");
    expect(modal).not.toContain("{false && (");
  });
  it("la recogida de una transferencia arrastra `store`", () => {
    expect(modal).toContain("onName={(v) => setD((p) => conTiendaDeLaRecogida({ ...p, pickup_name: v }, settings.stores, reglaDelTipo))}");
  });
});
