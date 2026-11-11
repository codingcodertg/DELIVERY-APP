import { describe, it, expect } from "vitest";
import { esApiMutante, traeCookieDeSesion, mismoOrigen, origenPropio } from "./csrf";

const req = (headers: Record<string, string>) => new Request("https://hub.rtg.app/api/x", { headers });

describe("esApiMutante", () => {
  it("POST a /api es mutante", () => expect(esApiMutante("POST", "/api/invite")).toBe(true));
  it("POST a /api anidado (timetracker) también", () => expect(esApiMutante("POST", "/timetracker/clock-in/api/cron/x")).toBe(true));
  it("GET nunca es mutante", () => expect(esApiMutante("GET", "/api/invite")).toBe(false));
  it("POST fuera de /api no cuenta", () => expect(esApiMutante("POST", "/operaciones/reportes")).toBe(false));
  it("DELETE/PUT/PATCH cuentan", () => {
    for (const m of ["DELETE", "PUT", "PATCH"]) expect(esApiMutante(m, "/api/x")).toBe(true);
  });
});

describe("traeCookieDeSesion", () => {
  it("detecta la cookie de Supabase (troceada incluida)", () => {
    expect(traeCookieDeSesion([{ name: "sb-abcd-auth-token" }])).toBe(true);
    expect(traeCookieDeSesion([{ name: "sb-abcd-auth-token.0" }, { name: "x" }])).toBe(true);
  });
  it("sin la cookie de sesión → false (cron/bearer/público)", () => {
    expect(traeCookieDeSesion([{ name: "otra" }, { name: "rtg_ensenanza" }])).toBe(false);
    expect(traeCookieDeSesion([])).toBe(false);
  });
});

describe("origenPropio / mismoOrigen", () => {
  it("arma el origen desde x-forwarded-host + proto", () => {
    expect(origenPropio(req({ "x-forwarded-host": "hub.rtg.app", "x-forwarded-proto": "https" }))).toBe("https://hub.rtg.app");
  });
  it("mismo origen por Origin → true", () => {
    expect(mismoOrigen(req({ host: "hub.rtg.app", origin: "https://hub.rtg.app" }))).toBe(true);
  });
  it("origen distinto (ataque CSRF) → false (se bloquea)", () => {
    expect(mismoOrigen(req({ host: "hub.rtg.app", origin: "https://evil.com" }))).toBe(false);
  });
  it("Referer de otro origen (sin Origin) → false (se bloquea)", () => {
    expect(mismoOrigen(req({ host: "hub.rtg.app", referer: "https://evil.com/x" }))).toBe(false);
  });
  it("sin Origin, cae al Referer del mismo origen → true", () => {
    expect(mismoOrigen(req({ host: "hub.rtg.app", referer: "https://hub.rtg.app/operaciones" }))).toBe(true);
  });
  it("sin Origin ni Referer → true (llamador nativo/propio; el GPS de Capacitor no manda Origin)", () => {
    expect(mismoOrigen(req({ host: "hub.rtg.app" }))).toBe(true);
  });
});
