import { describe, it, expect } from "vitest";
import { accessibleModules, hasCatalogAccess } from "./modules";

const none = {};

describe("accessibleModules", () => {
  it("gives deliveries to every role that came from the deliveries app", () => {
    for (const r of ["admin", "manager", "driver", "warehouse", "logistics", "sales", "accounting"]) {
      expect(accessibleModules(r, none)).toContain("deliveries");
    }
  });

  it("does NOT give deliveries to the catalog's own baseline role", () => {
    // `staff` exists only in the catalog; it never had deliveries duties, and the merge is not the
    // moment to hand it any.
    expect(accessibleModules("staff", none)).not.toContain("deliveries");
  });

  it("fails closed on a null or unknown role", () => {
    expect(accessibleModules(null, none)).toEqual([]);
    expect(accessibleModules(undefined, none)).toEqual([]);
    expect(accessibleModules("something-new", none)).toEqual([]);
  });

  it("grants recruiting/timetracker from their own role column, matching the RLS helpers", () => {
    // has_recruiting_access() / has_timetracker_access() (v4_74) test exactly this: the per-module
    // role column being non-null. UI visibility has to agree with RLS or one of them is a lie.
    expect(accessibleModules("staff", { recruitingRole: "recruiter" })).toEqual(["recruiting"]);
    expect(accessibleModules("staff", { timetrackerRole: "employee" })).toEqual(["timetracker"]);
  });

  it("also honours an explicit module_access grant", () => {
    expect(accessibleModules("staff", { moduleAccess: ["recruiting", "timetracker"] })).toEqual([
      "recruiting",
      "timetracker",
    ]);
  });

  it("treats an empty module_access array as no grant, not as all", () => {
    expect(accessibleModules("staff", { moduleAccess: [] })).toEqual([]);
  });

  it("returns modules in a stable order regardless of how they were granted", () => {
    const mods = accessibleModules("admin", {
      timetrackerRole: "admin",
      recruitingRole: "admin",
    });
    expect(mods).toEqual(["deliveries", "recruiting", "timetracker"]);
  });
});

describe("hasCatalogAccess", () => {
  it("is limited to the catalog's own three roles", () => {
    expect(hasCatalogAccess("admin")).toBe(true);
    expect(hasCatalogAccess("manager")).toBe(true);
    expect(hasCatalogAccess("staff")).toBe(true);
  });

  it("excludes every delivery-floor role the merge added", () => {
    for (const r of ["driver", "warehouse", "logistics", "sales", "accounting"]) {
      expect(hasCatalogAccess(r)).toBe(false);
    }
  });

  it("fails closed on null/unknown", () => {
    expect(hasCatalogAccess(null)).toBe(false);
    expect(hasCatalogAccess(undefined)).toBe(false);
    expect(hasCatalogAccess("future-role")).toBe(false);
  });
});
