import { describe, it, expect } from "vitest";
import { accessibleModules, MODULES, MODULE_ACCESS, landingRoute } from "@/lib/constants";

/**
 * The ERP's wiring into the hub and the Users dialog (D-090).
 *
 * Everything here is reachable without a browser, which matters: the pages
 * themselves redirect to /login before they render, so the only thing that can
 * be proven cheaply is that the registry says what it should.
 */
describe("ERP module wiring", () => {
  it("is a hub card pointing at the catalog", () => {
    const erp = MODULES.find((m) => m.key === "erp");
    expect(erp).toBeDefined();
    expect(erp!.href).toBe("/erp/catalog");
  });

  it("appears in the hub only for someone granted it", () => {
    const withErp = accessibleModules(["erp"]).map((m) => m.key);
    const without = accessibleModules(["recruiting"]).map((m) => m.key);
    expect(withErp).toContain("erp");
    expect(without).not.toContain("erp");
  });

  it("no desplaza a Entregas cuando ambas están otorgadas", () => {
    // Entregas dejó de anteponerse siempre (D-100), pero cuando está, va primera:
    // un módulo nuevo en MODULES no debe colarse por delante.
    expect(accessibleModules(["erp", "deliveries"])[0].key).toBe("deliveries");
    // Y sin Entregas otorgada, el ERP se dibuja solo — no aparece una tarjeta de
    // Entregas que la base le va a devolver vacía.
    expect(accessibleModules(["erp"]).map((m) => m.key)).toEqual(["erp"]);
  });

  it("cuenta para el selector: con ERP y Entregas se aterriza en /home", () => {
    expect(landingRoute({ role: "admin", module_access: ["deliveries", "erp"] })).toBe("/home");
  });

  it("con SOLO el ERP se entra directo al ERP", () => {
    expect(landingRoute({ role: "admin", module_access: ["erp"] })).toBe("/erp/catalog");
  });

  it("no le cambia el aterrizaje a un chofer que tenga Entregas", () => {
    // Un chofer con el ERP sigue empezando el día en su pantalla — la misma regla que
    // ya tenía recruiting, y de donde salieron los fallos de D-052.
    expect(landingRoute({ role: "driver", module_access: ["deliveries", "erp"] })).toBe("/driver");
  });

  it("is an opt-in module with a checkbox and no role tier of its own", () => {
    const erp = MODULE_ACCESS.find((m) => m.key === "erp");
    expect(erp).toBeDefined();
    expect(erp!.alwaysOn).toBe(false);
    expect(erp!.accessColumn).toBe("module_access");
    // The point of the entry: cost visibility is admin/manager on `role`, which
    // the Deliveries block already edits. A roleColumn here would be a second
    // copy of the same fact, free to drift.
    expect(erp!.roleColumn).toBeUndefined();
    expect(erp!.roleKeys).toEqual([]);
  });

  it("keeps every module aimed at a different profiles column", () => {
    // The rule 057/058 encode: two modules writing the same column is the
    // role/recruiting_role confusion that produced D-052's bugs. Absent is not
    // the same as "role" — the ERP reads that column but never writes it.
    const columns = MODULE_ACCESS.map((m) => m.roleColumn).filter(Boolean);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("gives every module a distinct key and href", () => {
    const keys = MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const hrefs = MODULES.map((m) => m.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
