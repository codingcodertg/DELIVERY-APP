import { describe, it, expect } from "vitest";
import { accessibleApps, visibleTools, hubLandingRoute, HUB_TOOLS } from "./hub";

const none = {};

describe("accessibleApps", () => {
  it("gives a catalog-only account just the Product Portal", () => {
    expect(accessibleApps("staff", none).map((a) => a.key)).toEqual(["catalog"]);
  });

  it("gives a delivery-floor role Deliveries but NOT the catalog", () => {
    // A driver has no reason to browse the product master, and the merge is not the moment to
    // hand them one.
    expect(accessibleApps("driver", none).map((a) => a.key)).toEqual(["deliveries"]);
    expect(accessibleApps("warehouse", none).map((a) => a.key)).toEqual(["deliveries"]);
  });

  it("gives an office role both, catalog first", () => {
    expect(accessibleApps("manager", none).map((a) => a.key)).toEqual(["catalog", "deliveries"]);
  });

  it("adds the opt-in modules when their role column is set", () => {
    expect(
      accessibleApps("admin", { recruitingRole: "admin", timetrackerRole: "employee" }).map((a) => a.key)
    ).toEqual(["catalog", "deliveries", "recruiting", "timetracker"]);
  });

  it("keeps a stable order so the hub does not reshuffle between visits", () => {
    const p = { timetrackerRole: "admin", recruitingRole: "admin" };
    expect(accessibleApps("admin", p).map((a) => a.key)).toEqual(
      accessibleApps("admin", p).map((a) => a.key)
    );
  });

  it("gives an unknown or absent role nothing at all", () => {
    expect(accessibleApps(null, none)).toEqual([]);
    expect(accessibleApps("future-role", none)).toEqual([]);
  });

  it("gives every app a route, label and description", () => {
    for (const a of accessibleApps("admin", { recruitingRole: "x", timetrackerRole: "y" })) {
      expect(a.href.startsWith("/")).toBe(true);
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });
});

describe("visibleTools", () => {
  it("shows Users to an admin only", () => {
    expect(visibleTools("admin").map((t) => t.key)).toEqual(["users"]);
    expect(visibleTools("manager")).toEqual([]);
    expect(visibleTools("driver")).toEqual([]);
    expect(visibleTools(null)).toEqual([]);
  });

  it("keeps tools separate from apps — a tool comes with a role, not a grant", () => {
    // Nobody is "granted" Users; they have it because they are an admin. That is why this is a
    // predicate and not a membership list.
    for (const t of HUB_TOOLS) expect(typeof t.visible).toBe("function");
  });
});

describe("hubLandingRoute", () => {
  it("skips the hub when there is exactly one app and no tools", () => {
    // A door with a single option should not be a click.
    expect(hubLandingRoute("driver", none)).toBe("/deliveries");
    expect(hubLandingRoute("staff", none)).toBe("/catalog");
  });

  it("shows the hub when there is a real choice", () => {
    expect(hubLandingRoute("manager", none)).toBeNull();
  });

  it("shows the hub for an admin even with one app, because a tool is worth seeing", () => {
    // An admin with only the catalog still has Users to reach.
    expect(hubLandingRoute("admin", none)).toBeNull();
  });

  it("shows the hub (not a redirect) when there is nothing at all, so the page can explain", () => {
    expect(hubLandingRoute(null, none)).toBeNull();
  });
});
