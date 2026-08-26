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

  it("never hides Deliveries, whatever else is granted", () => {
    // accessibleModules prepends the deliveries card unconditionally; a module
    // added to MODULES must not displace it.
    expect(accessibleModules(["erp"])[0].key).toBe("deliveries");
    expect(accessibleModules(null)[0].key).toBe("deliveries");
  });

  it("counts toward the module selector, so an admin with it lands on /home", () => {
    expect(landingRoute({ role: "admin", module_access: ["erp"] })).toBe("/home");
  });

  it("does not override a driver's landing route", () => {
    // A driver granted the ERP still starts their day on the driver screen —
    // the same rule recruiting already has, and the one D-052's bugs came from.
    expect(landingRoute({ role: "driver", module_access: ["erp"] })).toBe("/driver");
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
