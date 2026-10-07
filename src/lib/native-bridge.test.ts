import { describe, it, expect } from "vitest";
import { missingPermissions, type DriverPermissionState } from "./native-bridge";

// The gate built on this function locks a driver out of the app. Getting it
// wrong in the cautious direction leaves a truck untracked; getting it wrong in
// the strict direction leaves a driver standing at a customer's door unable to
// mark the delivery. These tests pin the second one down.
describe("missingPermissions", () => {
  it("reports nothing when there is no native bridge at all", () => {
    // A browser has none of these settings. Gating there would lock the office
    // out of its own app.
    expect(missingPermissions(null)).toEqual([]);
  });

  it("reports nothing for an APK too old to answer", () => {
    // permissionState() didn't exist before v1.3.3; every field is undefined.
    expect(missingPermissions({})).toEqual([]);
  });

  it("never counts an ABSENT setting as denied", () => {
    // Android 9: no background-location permission, no notification
    // permission, no hibernation. Only battery is readable, and it's granted.
    const old: DriverPermissionState = { location: true, battery: true, sdk: 28 };
    expect(missingPermissions(old)).toEqual([]);
  });

  it("counts only the ones explicitly denied", () => {
    const s: DriverPermissionState = {
      location: true,
      backgroundLocation: false,
      notifications: true,
      battery: false,
      hibernation: true,
    };
    expect(missingPermissions(s)).toEqual(["backgroundLocation", "battery"]);
  });

  it("reports every requirement when a driver denied the lot", () => {
    const s: DriverPermissionState = {
      location: false, backgroundLocation: false, notifications: false, battery: false, hibernation: false,
    };
    expect(missingPermissions(s)).toEqual(["location", "backgroundLocation", "notifications", "battery", "hibernation"]);
  });

  it("is empty once everything is granted, so the gate opens", () => {
    const s: DriverPermissionState = {
      location: true, backgroundLocation: true, notifications: true, battery: true, hibernation: true,
    };
    expect(missingPermissions(s)).toEqual([]);
  });

  it("ignores the descriptive fields that ride along", () => {
    // manufacturer/hasOemSettings/sdk are context, not requirements — and
    // hasOemSettings is false on most phones, which must not read as denied.
    const s: DriverPermissionState = {
      location: true, battery: true, manufacturer: "samsung", hasOemSettings: false, sdk: 34,
    };
    expect(missingPermissions(s)).toEqual([]);
  });

  it("orders the result so the driver is asked in a workable sequence", () => {
    // Background location cannot be granted before foreground location, so
    // foreground must always come first in the list the gate walks.
    const s: DriverPermissionState = { location: false, backgroundLocation: false };
    expect(missingPermissions(s)[0]).toBe("location");
  });
});

describe("D-492 · «No pausar la app»: abre «Info de la app» y dice los pasos", () => {
  it("el botón abre la info de la app; la pantalla dedicada queda de segundo botón; los pasos se ven", async () => {
    const { readFileSync } = await import("node:fs");
    const gate = readFileSync("src/components/DriverGate.tsx", "utf8");
    expect(gate).toContain('else if (k === "hibernation") await openAppSettingsPage();');
    expect(gate).toContain('action: t("Open app info", "Abrir info de la app")');
    expect(gate).toContain("data-pasos-no-pausar");
    expect(gate).toContain("onClick={() => void requestHibernationExemption()}");
    expect(gate).toContain("Pausar actividad de la app si no se usa");
  });
});
