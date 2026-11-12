import { describe, expect, it } from "vitest";
import { particionaParaDeshacer, resumenDeDeshacer } from "./bloque";
import { etapaAlDeshacer } from "./etapas";

const m = (id: string, stage: string) => ({ id, kind: "scrap" as const, stage, photos: ["x"], created_at: "2026-11-11T12:00:00Z" });

describe("296 · deshacer un paso", () => {
  it("cada etapa regresa a la de antes; fotografiada y documentada no", () => {
    expect(etapaAlDeshacer(m("a", "adjusted"))).toBe("dumped");
    expect(etapaAlDeshacer(m("a", "dumped"))).toBe("approved");
    expect(etapaAlDeshacer(m("a", "approved"))).toBe("photographed");
    expect(etapaAlDeshacer(m("a", "photographed"))).toBeNull();
    expect(etapaAlDeshacer(m("a", "documented"))).toBeNull();
  });
  it("en bloque: agrupa por destino y omite lo que no tiene qué deshacer", () => {
    const p = particionaParaDeshacer([m("1", "approved"), m("2", "dumped"), m("3", "approved"), m("4", "photographed")]);
    expect(p.elegibles.map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(p.omitidos.map((x) => x.id)).toEqual(["4"]);
    expect(p.porDestino.get("photographed")?.map((x) => x.id)).toEqual(["1", "3"]);
    expect(p.porDestino.get("approved")?.map((x) => x.id)).toEqual(["2"]);
    expect(resumenDeDeshacer(3, 1, "es")).toBe("3 regresadas un paso · 1 omitida (no tenía qué deshacer)");
    expect(resumenDeDeshacer(1, 0, "en")).toBe("1 moved back one step");
  });
});

import { documentoDeGrupo, esAdminParaDeshacer } from "./etapas";

describe("reunión 11 nov · un solo estado de grupo y deshacer solo admin", () => {
  it("o la hoja firmada (aprobada en adelante) o el grupo (pendiente), nunca los dos", () => {
    const g = (stage: string) => ({ ...m("x", stage), scrap_group_id: "g1" });
    expect(documentoDeGrupo(g("photographed"))).toBe("grupo");
    expect(documentoDeGrupo(g("approved"))).toBe("hoja-firmada");
    expect(documentoDeGrupo(g("dumped"))).toBe("hoja-firmada");
    expect(documentoDeGrupo(m("x", "approved"))).toBeNull();
    // grupo de práctica (no está en la base)
    expect(documentoDeGrupo(m("x", "photographed"), "practica-1")).toBe("grupo");
  });
  it("deshacer etapa: admin / store_admin sí, gerente no", () => {
    const q = (role: string, nivel: string | null) => ({ id: "u", role, store: "A", module_access: ["warehouse_ops"], warehouse_ops_role: nivel });
    expect(esAdminParaDeshacer(q("admin", null))).toBe(true);
    expect(esAdminParaDeshacer(q("manager", "store_admin"))).toBe(true);
    expect(esAdminParaDeshacer(q("manager", null))).toBe(false);
    expect(esAdminParaDeshacer(q("warehouse", null))).toBe(false);
  });
});
