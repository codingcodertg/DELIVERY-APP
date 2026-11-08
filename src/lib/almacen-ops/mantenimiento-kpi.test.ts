import { describe, expect, it } from "vitest";
import { colorDelPct, diasLaboralesTranscurridos, kpiDeMantenimiento, lunesDe, totalDelKpi } from "./mantenimiento-kpi";

/** 273: el KPI de mantenimiento del gerente: listas de la semana contra las esperadas, y lo que necesita reparación. */
const eq = (id: string, store: string, status: "in_service" | "needs_repair" | "out_of_service" = "in_service", active = true) => ({ id, store, status, active });
const li = (equipment_id: string, store: string, shift_date: string) => ({ equipment_id, store, shift_date });

describe("la semana", () => {
  it("el lunes de la semana, también en domingo y cruzando mes", () => {
    expect(lunesDe("2026-11-11")).toBe("2026-11-09"); // miércoles
    expect(lunesDe("2026-11-09")).toBe("2026-11-09"); // lunes
    expect(lunesDe("2026-11-15")).toBe("2026-11-09"); // domingo
    expect(lunesDe("2026-11-01")).toBe("2026-10-26"); // domingo, cruza mes
  });
  it("los días laborales transcurridos: lunes a sábado hasta hoy; el domingo cierra la semana entera", () => {
    expect(diasLaboralesTranscurridos("2026-11-09")).toEqual(["2026-11-09"]);
    expect(diasLaboralesTranscurridos("2026-11-11")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(diasLaboralesTranscurridos("2026-11-14")).toHaveLength(6);
    expect(diasLaboralesTranscurridos("2026-11-15")).toHaveLength(6); // domingo: no se suma
    expect(diasLaboralesTranscurridos("2026-11-11", [1, 2, 3, 4, 5])).toHaveLength(3);
  });
});

describe("el KPI por tienda", () => {
  const hoy = "2026-11-11"; // miércoles: 3 días laborales
  const equipos = [eq("f1", "Pharr"), eq("f2", "Pharr"), eq("f3", "Pharr", "needs_repair"), eq("f4", "Pharr", "out_of_service"), eq("f5", "Pharr", "in_service", false), eq("m1", "McAllen")];
  it("esperadas = en servicio × días; hechas = equipo + día distintos de la semana; una lista repetida no suma", () => {
    const listas = [
      li("f1", "Pharr", "2026-11-09"), li("f1", "Pharr", "2026-11-10"), li("f1", "Pharr", "2026-11-11"),
      li("f2", "Pharr", "2026-11-09"), li("f2", "Pharr", "2026-11-09"), // repetida el mismo día: cuenta una
      li("f3", "Pharr", "2026-11-10"), // needs_repair: cuenta como hecha pero no se esperaba
      li("f5", "Pharr", "2026-11-10"), // dado de baja: no cuenta
      li("f1", "Pharr", "2026-11-07"), // la semana pasada: no cuenta
      li("f1", "Pharr", "2026-11-12"), // mañana (reloj adelantado): no cuenta
    ];
    const k = kpiDeMantenimiento(equipos, listas, hoy);
    const pharr = k.find((x) => x.tienda === "Pharr")!;
    expect(pharr.enServicio).toBe(2);
    expect(pharr.esperadas).toBe(6);
    expect(pharr.hechas).toBe(5);
    expect(pharr.pct).toBe(83);
    expect(pharr.necesitanReparacion).toBe(1);
    expect(pharr.fueraDeServicio).toBe(1);
    expect(pharr.sinListaHoy).toEqual(["f2"]);
    const mcallen = k.find((x) => x.tienda === "McAllen")!;
    expect(mcallen).toMatchObject({ enServicio: 1, esperadas: 3, hechas: 0, pct: 0, sinListaHoy: ["m1"] });
    expect(k.map((x) => x.tienda)).toEqual(["McAllen", "Pharr"]);
  });
  it("una tienda pedida sin equipo sale con ceros y pct null; el porcentaje nunca pasa de 100", () => {
    const k = kpiDeMantenimiento([], [], hoy, ["Edinburg"]);
    expect(k).toEqual([{ tienda: "Edinburg", enServicio: 0, esperadas: 0, hechas: 0, pct: null, necesitanReparacion: 0, fueraDeServicio: 0, sinListaHoy: [] }]);
    const k2 = kpiDeMantenimiento([eq("f1", "Pharr"), eq("f3", "Pharr", "needs_repair")], [li("f1", "Pharr", "2026-11-09"), li("f3", "Pharr", "2026-11-09")], "2026-11-09");
    expect(k2[0].pct).toBe(100);
  });
  it("en domingo nadie está «sin lista hoy»", () => {
    const k = kpiDeMantenimiento([eq("f1", "Pharr")], [], "2026-11-15");
    expect(k[0].sinListaHoy).toEqual([]);
    expect(k[0].esperadas).toBe(6);
  });
  it("el total y el color", () => {
    const k = kpiDeMantenimiento(equipos, [li("f1", "Pharr", "2026-11-09"), li("m1", "McAllen", "2026-11-09")], hoy);
    const t = totalDelKpi(k);
    expect(t).toMatchObject({ enServicio: 3, esperadas: 9, hechas: 2, pct: 22, necesitanReparacion: 1, fueraDeServicio: 1 });
    expect(totalDelKpi([]).pct).toBeNull();
    expect(colorDelPct(null)).toBe("gris");
    expect(colorDelPct(95)).toBe("verde");
    expect(colorDelPct(90)).toBe("verde");
    expect(colorDelPct(75)).toBe("ambar");
    expect(colorDelPct(22)).toBe("rojo");
  });
});
