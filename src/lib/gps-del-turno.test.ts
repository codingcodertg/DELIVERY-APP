import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { appDelTurno, avisoDeGps, porQueNoReporta } from "./gps-del-turno";
import { trackingGaps } from "./tracking-health";
import type { DriverLocation, DriverShift, Profile } from "./types";

// D-713. El turno dice desde qué app se marcó y cómo va su GPS, y la oficina lo ve junto al nombre. Datos que
// contradicen: un UA de APK con `nativa=false` (la APK sin bridge sigue siendo APK), un turno viejo sin columnas.

describe("appDelTurno", () => {
  it("la APK con su versión; el navegador por lo que no es", () => {
    expect(appDelTurno("Mozilla/5.0 (Linux; Android 14) RDZDeliveries/6", true)).toBe("apk/6");
    expect(appDelTurno("Mozilla/5.0 (Linux; Android 14) RDZDeliveries/6", false)).toBe("apk/6");
    expect(appDelTurno("Mozilla/5.0 (Linux; Android 14) Chrome/130", false)).toBe("navegador");
    expect(appDelTurno(null, true)).toBe("apk/?");
    expect(appDelTurno(null, false)).toBe("navegador");
  });
});

describe("avisoDeGps", () => {
  it("solo en turno, y solo lo que el chofer puede arreglar", () => {
    expect(avisoDeGps({ enTurno: false, nativa: false, estado: "off" })).toBeNull();
    expect(avisoDeGps({ enTurno: true, nativa: false, estado: "off" })).toEqual({ tipo: "navegador" });
    expect(avisoDeGps({ enTurno: true, nativa: true, estado: "denied" })).toEqual({ tipo: "sin_permiso" });
    expect(avisoDeGps({ enTurno: true, nativa: true, estado: "unavailable" })).toEqual({ tipo: "sin_gps" });
    expect(avisoDeGps({ enTurno: true, nativa: true, estado: "starting" })).toBeNull();
    expect(avisoDeGps({ enTurno: true, nativa: true, estado: "live" })).toBeNull();
  });
});

describe("porQueNoReporta", () => {
  it("navegador, permiso, sin GPS; nada para un turno viejo", () => {
    expect(porQueNoReporta({ app: "navegador", gps: null }, true)).toBe("navegador, no la app");
    expect(porQueNoReporta({ app: "apk/6", gps: "denied" }, true)).toBe("apk/6, sin permiso de ubicación");
    expect(porQueNoReporta({ app: "apk/6", gps: "unavailable" }, false)).toBe("apk/6, no GPS");
    expect(porQueNoReporta({ app: null, gps: null }, true)).toBeNull();
    expect(porQueNoReporta(null, true)).toBeNull();
    expect(porQueNoReporta({ app: "apk/6", gps: "live" }, true)).toBe("apk/6");
  });
});

describe("trackingGaps lleva app y gps del turno", () => {
  const users = [{ id: "d1", full_name: "Max" }, { id: "d2", full_name: "Julio" }] as Profile[];
  const ahora = Date.parse("2026-10-27T15:00:00Z");
  const turno = (id: string, driver_id: string, extra: Partial<DriverShift>): DriverShift =>
    ({ id, driver_id, started_at: "2026-10-27T13:00:00Z", ended_at: null, note: null, device_id: null, created_at: "2026-10-27T13:00:00Z", app: null, gps: null, gps_at: null, ...extra });
  it("el hueco dice desde dónde se marcó y el último estado", () => {
    const shifts = [turno("s1", "d1", { app: "navegador" }), turno("s2", "d2", { app: "apk/6", gps: "denied" })];
    const gaps = trackingGaps(users, shifts, [] as DriverLocation[], ahora);
    expect(gaps.map((g) => [g.driver, g.app, g.gps])).toEqual([["Max", "navegador", null], ["Julio", "apk/6", "denied"]]);
  });
  it("un chofer que reporta no sale aunque su turno diga navegador", () => {
    const shifts = [turno("s1", "d1", { app: "navegador" })];
    const loc = [{ driver_id: "d1", recorded_at: new Date(ahora - 60_000).toISOString() }] as DriverLocation[];
    expect(trackingGaps(users, shifts, loc, ahora)).toEqual([]);
  });
});

describe("la migración 206 y quién escribe", () => {
  const raiz = new URL("../../", import.meta.url);
  const lee = (p: string) => readFileSync(new URL(p, raiz), "utf8");
  it("la 206 añade las tres columnas y la entrada las escribe", () => {
    const sql = lee("supabase/migrations/206_turno_dice_app_y_gps.sql");
    for (const col of ["app text", "gps text", "gps_at timestamptz"]) expect(sql).toContain(col);
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
    const provider = lee("src/lib/data-provider.tsx");
    // Las dos entradas —la directa y la de la cola sin red— llevan `app`; el rastreador escribe `gps`.
    expect(provider.match(/from\("driver_shifts"\)\.insert\(\{[^}]*\bapp\b/g) ?? []).toHaveLength(2);
    expect(provider).toContain('.update({ gps, gps_at: new Date().toISOString() })');
  });
  it("el rastreador ya no tira el estado y la barra enseña el aviso 📡", () => {
    const tracker = lee("src/components/LocationTracker.tsx");
    expect(tracker).toContain("const { status, native } = useLiveLocation(track);");
    expect(tracker).toContain("avisoDeGps({");
    const barra = lee("src/components/TopBar.tsx");
    expect(barra).toContain("trackingGaps(users, shifts, driverLocations)");
    expect(barra).toContain('data-aviso-gps');
  });
});
