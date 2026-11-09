import { describe, it, expect } from "vitest";
import { MODULE_ACCESS } from "../constants";
import { GRUPOS_DE_PERMISOS, ROL_POR_DEFECTO, columnaDeRol, tieneRolPropio, opcionesDeRol, etiquetaDeRol } from "./permisos-grupos";

describe("GRUPOS_DE_PERMISOS", () => {
  it("cubre TODO MODULE_ACCESS, sin repetir ni inventar", () => {
    const enGrupos = GRUPOS_DE_PERMISOS.flatMap((g) => g.keys).sort();
    const enModulos = MODULE_ACCESS.map((m) => m.key).sort();
    expect(enGrupos).toEqual(enModulos);
    expect(new Set(enGrupos).size).toBe(enGrupos.length); // sin duplicados
  });
});

describe("rol por app", () => {
  it("las cuatro apps con escalafón lo dicen; las demás no", () => {
    expect(tieneRolPropio("recruiting")).toBe(true);
    expect(tieneRolPropio("timetracker")).toBe(true);
    expect(tieneRolPropio("erp")).toBe(true);
    expect(tieneRolPropio("warehouse_ops")).toBe(true);
    for (const k of ["deliveries", "leads", "customers", "promos", "estimator", "surveys"] as const) {
      expect(tieneRolPropio(k), k).toBe(false);
    }
  });

  it("deliveries usa `role` pero NO se edita en línea aquí (se edita en Identidad)", () => {
    expect(columnaDeRol("deliveries")).toBeNull();
  });

  it("la columna de cada app con escalafón es la correcta", () => {
    expect(columnaDeRol("recruiting")).toBe("recruiting_role");
    expect(columnaDeRol("timetracker")).toBe("timetracker_role");
    expect(columnaDeRol("erp")).toBe("erp_role");
    expect(columnaDeRol("warehouse_ops")).toBe("warehouse_ops_role");
  });

  it("el tier por defecto es el más bajo, nunca admin", () => {
    expect(ROL_POR_DEFECTO.recruiting).toBe("recruiter");
    expect(ROL_POR_DEFECTO.timetracker).toBe("employee");
    expect(ROL_POR_DEFECTO.erp).toBe("staff");
    expect(ROL_POR_DEFECTO.warehouse_ops).toBe("scrap_only");
    for (const k of ["recruiting", "timetracker", "erp", "warehouse_ops"] as const) {
      expect(opcionesDeRol(k), k).toContain(ROL_POR_DEFECTO[k]);
    }
  });

  it("las opciones y etiquetas salen de MODULE_ACCESS", () => {
    expect(opcionesDeRol("erp")).toEqual(["staff", "manager", "admin"]);
    expect(opcionesDeRol("leads")).toEqual([]);
    expect(etiquetaDeRol("erp", "staff", "es")).toBe("Personal");
    expect(etiquetaDeRol("erp", "staff", "en")).toBe("Staff");
  });
});
