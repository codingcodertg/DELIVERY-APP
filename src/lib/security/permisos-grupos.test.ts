import { describe, it, expect } from "vitest";
import { MODULE_ACCESS } from "../constants";
import { GRUPOS_DE_PERMISOS, PERFILES_DE_ROL, ROL_POR_DEFECTO, columnaDeRol, tieneRolPropio, opcionesDeRol, etiquetaDeRol } from "./permisos-grupos";
import { MODULOS_DE_GERENTE } from "../hub-usuarios-permisos";
import { CAP_TODAS_LAS_TIENDAS } from "../todas-las-tiendas";

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

describe("PERFILES_DE_ROL (D-947)", () => {
  const claves = MODULE_ACCESS.map((m) => m.key);
  it("cada perfil tiene rol, módulos válidos y etiqueta en los dos idiomas", () => {
    for (const p of PERFILES_DE_ROL) {
      expect(p.label_es, p.id).toBeTruthy();
      expect(p.label_en, p.id).toBeTruthy();
      expect(p.modules.length, p.id).toBeGreaterThan(0);
      for (const k of p.modules) expect(claves, `${p.id}:${k}`).toContain(k);
      expect(p.modules, p.id).toContain("deliveries"); // todos entran por Entregas
    }
  });
  it("el perfil de Vendedor y el de Almacén traen lo que el dueño nombró", () => {
    const sales = PERFILES_DE_ROL.find((p) => p.id === "sales")!;
    expect(sales.role).toBe("sales");
    expect(sales.modules).toContain("estimator");
    const wh = PERFILES_DE_ROL.find((p) => p.id === "warehouse")!;
    expect(wh.role).toBe("warehouse");
    expect(wh.modules).toContain("warehouse_ops");
  });
  it("el Supervisor regional es un Gerente de Oficina que ve todas las tiendas", () => {
    const reg = PERFILES_DE_ROL.find((p) => p.id === "regional")!;
    expect(reg.role).toBe("manager");
    expect(reg.caps).toContain(CAP_TODAS_LAS_TIENDAS);
    expect([...reg.modules].sort()).toEqual([...MODULOS_DE_GERENTE].sort());
  });
});
