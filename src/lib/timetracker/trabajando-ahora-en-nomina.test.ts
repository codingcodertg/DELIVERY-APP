import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { idsActivosAhora } from "./trabajando-ahora-en-nomina";

// 2026-11-25: «Trabajando ahora» salió de Nómina como sección. Su definición (quién trabaja ahora) sigue igual y
// ahora pinta el nombre de cada persona en «Hojas de tiempo» (verde o gris) y la pone primero.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("«Trabajando ahora» ya no es sección de Nómina", () => {
  it("MANAGER_TABS no tiene 'live'", async () => {
    const { MANAGER_TABS } = await import("./constants");
    expect(MANAGER_TABS.map((t) => t.id)).not.toContain("live");
  });

  it("el componente TrabajandoAhora ya no existe", () => {
    expect(existsSync(join(process.cwd(), "src/components/timetracker/TrabajandoAhora.tsx"))).toBe(false);
  });

  it("la ruta vieja /timetracker/live cae en Nómina, sin ?vista=", () => {
    const src = leer("src/app/timetracker/(timetracker)/live/page.tsx");
    expect(src).toContain('redirect("/timetracker/payroll");');
    expect(src).not.toContain("vista=");
  });

  it("Nómina ya no lee ?vista= ni pasa vistaPorUrl a PayrollTabs", () => {
    const src = leer("src/app/timetracker/(timetracker)/payroll/page.tsx");
    expect(src).not.toContain("seccionPorUrl");
    expect(src).not.toContain("vistaPorUrl");
    expect(src).not.toContain("vista?: string");
  });
});

describe("PayrollTabs: sin sección de «Trabajando ahora»", () => {
  const src = leer("src/components/timetracker/PayrollTabs.tsx");

  it("no hay cabecera plegable con aria-expanded ni data-trabajando-ahora", () => {
    expect(src).not.toContain("data-trabajando-ahora");
    expect(src).not.toContain("SeccionDeNomina");
    expect(src).not.toContain("TrabajandoAhora");
  });

  it("los filtros van en la página, antes de las secciones", () => {
    expect(src.indexOf("<FiltrosDeNomina")).toBeGreaterThan(-1);
    expect(src.indexOf("<FiltrosDeNomina")).toBeLessThan(src.indexOf("<PayrollTimesheets"));
  });
});

describe("quién trabaja ahora (la definición de siempre)", () => {
  it("junta a los del cronómetro y a los que fichan, sin repetir", () => {
    const activos = idsActivosAhora([{ employeeUid: "ana" }, { employeeUid: "luis" }], [{ employeeId: "ana" }, { employeeId: "pedro" }]);
    expect([...activos].sort()).toEqual(["ana", "luis", "pedro"]);
  });

  it("sin nadie, el conjunto está vacío", () => {
    expect(idsActivosAhora([], []).size).toBe(0);
  });
});
