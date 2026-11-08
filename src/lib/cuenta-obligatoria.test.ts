import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVISO_CUENTA_OBLIGATORIA, ROLES_CON_CUENTA_OBLIGATORIA, faltaLaCuenta, pideCuenta } from "./cuenta-obligatoria";

const reglas = {
  Customer: { storeToStore: false, docRef: "invoice" as const },
  Intertienda: { storeToStore: true, docRef: "any" as const },
  Proveedor: { storeToStore: false, hasCustomer: false, docRef: "hidden" as const },
};

describe("pideCuenta — a quién y en qué tipo", () => {
  it("ventas en una orden de cliente: sí", () => {
    expect(pideCuenta("sales", "Customer", reglas)).toBe(true);
    // Sin reglas configuradas también: «Customer» cae en el respaldo de tipo con cliente.
    expect(pideCuenta("sales", "Customer")).toBe(true);
    expect(pideCuenta("sales", "Delivery")).toBe(true);
  });
  it("ventas en Intertienda o a un proveedor: no (no hay cliente detrás)", () => {
    expect(pideCuenta("sales", "Intertienda", reglas)).toBe(false);
    expect(pideCuenta("sales", "Proveedor", reglas)).toBe(false);
    expect(pideCuenta("sales", "Intra-Tienda")).toBe(false);
  });
  it("los demás roles siguen como hoy", () => {
    for (const rol of ["admin", "manager", "accounting", "logistics", "warehouse", "driver"]) {
      expect(pideCuenta(rol, "Customer", reglas)).toBe(false);
    }
    expect(pideCuenta(null, "Customer", reglas)).toBe(false);
    expect(pideCuenta(undefined, "Customer", reglas)).toBe(false);
  });
  it("hoy la lista es solo ventas", () => {
    expect([...ROLES_CON_CUENTA_OBLIGATORIA]).toEqual(["sales"]);
  });
});

describe("faltaLaCuenta — si hay que parar el guardado", () => {
  it("ventas, cliente, sin cuenta: para", () => {
    expect(faltaLaCuenta("sales", { order_type: "Customer", account: null }, reglas)).toBe(true);
    expect(faltaLaCuenta("sales", { order_type: "Customer", account: "   " }, reglas)).toBe(true);
    expect(faltaLaCuenta("sales", { order_type: "Customer" }, reglas)).toBe(true);
  });
  it("con cuenta, no para; «Venta al mostrador» cuenta como cuenta", () => {
    expect(faltaLaCuenta("sales", { order_type: "Customer", account: "ACME" }, reglas)).toBe(false);
    expect(faltaLaCuenta("sales", { order_type: "Customer", account: "Venta al mostrador" }, reglas)).toBe(false);
  });
  it("Intertienda sin cuenta o la oficina sin cuenta: no para", () => {
    expect(faltaLaCuenta("sales", { order_type: "Intertienda", account: null }, reglas)).toBe(false);
    expect(faltaLaCuenta("manager", { order_type: "Customer", account: null }, reglas)).toBe(false);
  });
  it("el aviso es bilingüe", () => {
    expect(AVISO_CUENTA_OBLIGATORIA.en).toBe("Account is required");
    expect(AVISO_CUENTA_OBLIGATORIA.es).toBe("La cuenta es obligatoria");
  });
});

describe("la ficha de la orden la aplica", () => {
  const src = readFileSync(join(__dirname, "..", "components", "OrderModal.tsx"), "utf8");
  it("el tope duro de enviar/guardar mira la cuenta y pinta y enfoca el campo", () => {
    expect(src).toContain('from "@/lib/cuenta-obligatoria"');
    expect(src).toMatch(/const blockSubmit = [\s\S]*?faltaLaCuenta\(me\.role, draft, settings\.order_type_rules\)/);
    expect(src).toContain("AVISO_CUENTA_OBLIGATORIA.en, AVISO_CUENTA_OBLIGATORIA.es");
    expect(src).toContain('data-campo="account"');
    expect(src).toMatch(/<AccountCombo[\s\S]*?invalid=\{missingSet\.has\("account"\)\}/);
  });
});
