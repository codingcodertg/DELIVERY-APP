import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entradaDeTimeTracker, hrefDeTrackTime, RUTA_DE_PAYROLL, RUTA_DE_TRACK_TIME } from "./pantalla-de-entrada";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("entradaDeTimeTracker · a dónde cae quien entra en /timetracker", () => {
  it("admin sin marca → Nómina (la pantalla por defecto nueva)", () => {
    expect(entradaDeTimeTracker({ esAdmin: true, ver: undefined })).toBe("payroll");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: null })).toBe("payroll");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: "" })).toBe("payroll");
  });

  it("admin con ?ver=track → Registrar tiempo", () => {
    expect(entradaDeTimeTracker({ esAdmin: true, ver: "track" })).toBe("track");
  });

  it("valores raros de ver cuentan como sin marca", () => {
    expect(entradaDeTimeTracker({ esAdmin: true, ver: "payroll" })).toBe("payroll");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: "TRACK" })).toBe("payroll");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: "track " })).toBe("payroll");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: ["track"] })).toBe("payroll");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: "../x" })).toBe("payroll");
  });

  it("quien no es admin va siempre a Registrar tiempo, con o sin marca", () => {
    expect(entradaDeTimeTracker({ esAdmin: false, ver: undefined })).toBe("track");
    expect(entradaDeTimeTracker({ esAdmin: false, ver: "track" })).toBe("track");
    expect(entradaDeTimeTracker({ esAdmin: false, ver: "payroll" })).toBe("track");
  });
});

describe("hrefDeTrackTime · el enlace de la pestaña", () => {
  it("admin: /timetracker?ver=track; los demás: /timetracker tal cual", () => {
    expect(hrefDeTrackTime(true)).toBe("/timetracker?ver=track");
    expect(hrefDeTrackTime(false)).toBe("/timetracker");
  });

  it("el enlace del admin, leído de vuelta, cae en Registrar tiempo (no en Nómina)", () => {
    const url = new URL(hrefDeTrackTime(true), "https://x.test");
    expect(entradaDeTimeTracker({ esAdmin: true, ver: url.searchParams.get("ver") ?? undefined })).toBe("track");
  });

  it("las constantes de ruta", () => {
    expect(RUTA_DE_TRACK_TIME).toBe("/timetracker");
    expect(RUTA_DE_PAYROLL).toBe("/timetracker/payroll");
  });
});

describe("cableado: la raíz redirige por la función, y la barra usa hrefDeTrackTime", () => {
  it("la página de Registrar tiempo lee ver y redirige a Nómina solo con entradaDeTimeTracker", () => {
    const src = leer("src/app/timetracker/(timetracker)/page.tsx");
    expect(src).toContain("entradaDeTimeTracker({");
    expect(src).toContain('redirect(RUTA_DE_PAYROLL)');
    expect(src).toContain("timetracker_role");
  });

  it("la pestaña de Registrar tiempo del admin lleva la marca (pestanasPara lo cambia)", () => {
    const src = leer("src/lib/timetracker/vista-empleado.ts");
    expect(src).toContain("hrefDeTrackTime(");
  });

  it("la barra reconoce la pestaña activa aunque la URL lleve ?ver=", () => {
    const src = leer("src/lib/timetracker/barra.ts");
    expect(src).toContain('const ruta = href.split("?")[0];');
    expect(src).toContain('if (ruta === "/timetracker") return pathname === "/timetracker";');
  });

  it("los enlaces «ir al cronómetro» del componente usan hrefDeTrackTime", () => {
    const src = leer("src/components/timetracker/Cronometro.tsx");
    expect(src.split("hrefDeTrackTime(").length - 1).toBeGreaterThanOrEqual(2);
  });
});
