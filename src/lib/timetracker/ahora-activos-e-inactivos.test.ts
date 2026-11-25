import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idsActivosAhora, sinActividadAhora } from "@/lib/timetracker/trabajando-ahora-en-nomina";

// «Trabajando ahora» (2026-11-24): los activos en verde arriba; los que no están activos, en negro, debajo.

const persona = (id: string, extra: Partial<{ active: boolean; deletedAt: string | null }> = {}) => ({
  id, active: true, deletedAt: null, ...extra,
});

describe("quién está activo ahora", () => {
  it("junta a los del cronómetro y a los que fichan, sin repetir", () => {
    const activos = idsActivosAhora([{ employeeUid: "ana" }, { employeeUid: "luis" }], [{ employeeId: "ana" }, { employeeId: "pedro" }]);
    expect([...activos].sort()).toEqual(["ana", "luis", "pedro"]);
  });
});

describe("quién NO está activo ahora", () => {
  const todas = [persona("ana"), persona("luis"), persona("pedro"), persona("marta"), persona("baja", { active: false }), persona("borrada", { deletedAt: "2026-10-01" })];

  it("son los activos de la empresa que no están activos, y no las dadas de baja", () => {
    const activos = new Set(["ana"]);
    expect(sinActividadAhora(todas, activos, null).map((p) => p.id)).toEqual(["luis", "pedro", "marta"]);
  });

  it("con filtro de Nómina, solo quien se ve con él", () => {
    expect(sinActividadAhora(todas, new Set(["ana"]), new Set(["luis", "marta"])).map((p) => p.id)).toEqual(["luis", "marta"]);
  });

  it("si todos están activos, no queda nadie en negro", () => {
    expect(sinActividadAhora([persona("ana")], new Set(["ana"]), null)).toEqual([]);
  });
});

describe("«Trabajando ahora» pinta los estados con sus clases y el atributo", () => {
  const src = readFileSync(join(process.cwd(), "src/components/timetracker/TrabajandoAhora.tsx"), "utf8");

  it("activos: clase tt-ahora-activo y data-activo=\"si\"", () => {
    expect(src).toContain("tt-ahora-activo");
    expect(src).toContain('data-activo="si"');
  });

  it("sin actividad: clase tt-ahora-inactivo y data-activo=\"no\"", () => {
    expect(src).toContain("tt-ahora-inactivo");
    expect(src).toContain('data-activo="no"');
  });

  it("el contador de cabecera dice trabajando ahora y sin actividad", () => {
    expect(src).toContain('t("mgr.live.countNow"');
  });

  it("los colores son tokens de la hoja, no literales en el componente", () => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
