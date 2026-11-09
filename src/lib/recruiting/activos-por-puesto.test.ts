import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  activosDelPuesto, esReasignable, mismoPuesto, normalizaPuesto, parcheReasignar, sugerenciasDeActivosPorPuesto,
} from "./activos-por-puesto";
import type { Activo } from "./activos";

// D-936 (2026-11-09) · Roberto: reasignar el correo/teléfono libres al relevo del mismo puesto (de Maricella a Christy).
const a = (x: Partial<Activo>): Activo => ({
  id: "x", kind: "email", value: "a@b.c", ext: null, phone_type: null, status: "available", employee_id: null,
  last_employee_id: null, plan: null, cost_year: null, note: null, position: null, updated_at: null, ...x,
});

describe("reasignar activos por puesto", () => {
  it("normaliza el puesto (acentos, mayúsculas, espacios) y compara tolerante", () => {
    expect(normalizaPuesto("  Accounts   Receivable ")).toBe("accounts receivable");
    expect(normalizaPuesto("")).toBeNull();
    expect(mismoPuesto("Accounts Receivable", "accounts   receivable")).toBe(true);
    expect(mismoPuesto("Cajera", "Cajero")).toBe(false);
    expect(mismoPuesto(null, "x")).toBe(false);
  });

  it("solo son reasignables los que no están asignados", () => {
    expect(esReasignable(a({ status: "available" }))).toBe(true);
    expect(esReasignable(a({ status: "pending_backup" }))).toBe(true);
    expect(esReasignable(a({ status: "not_in_use" }))).toBe(true);
    expect(esReasignable(a({ status: "assigned" }))).toBe(false);
  });

  it("sugiere primero los del mismo puesto, y no los que están asignados", () => {
    const activos = [
      a({ id: "correo-ar", kind: "email", value: "ar@rtg.net", position: "Accounts Receivable", status: "pending_backup" }),
      a({ id: "tel-ar", kind: "phone", value: "(956) 555-0101", position: "accounts receivable", status: "available" }),
      a({ id: "correo-otro", kind: "email", value: "ventas@rtg.net", position: "Sales", status: "available" }),
      a({ id: "asignado", kind: "email", value: "x@rtg.net", position: "Accounts Receivable", status: "assigned", employee_id: "u1" }),
    ];
    const sug = sugerenciasDeActivosPorPuesto(activos, "accounts receivable");
    expect(sug.map((s) => s.id)).toEqual(["correo-ar", "tel-ar", "correo-otro"]); // del puesto primero, el asignado fuera
    const soloDelPuesto = activosDelPuesto(activos, "Accounts Receivable");
    expect(soloDelPuesto.map((s) => s.id)).toEqual(["correo-ar", "tel-ar"]);
    expect(activosDelPuesto(activos, "")).toEqual([]);
  });

  it("el parche de reasignación: asigna y marca el puesto; null si estaba asignado", () => {
    expect(parcheReasignar({ status: "available", position: "Sales" }, "u2", "Accounts Receivable"))
      .toEqual({ status: "assigned", employee_id: "u2", position: "Accounts Receivable" });
    // sin puesto nuevo conserva el que traía
    expect(parcheReasignar({ status: "pending_backup", position: "Sales" }, "u2"))
      .toEqual({ status: "assigned", employee_id: "u2", position: "Sales" });
    expect(parcheReasignar({ status: "assigned", position: null }, "u2")).toBeNull();
  });

  it("la 277 agrega position y el tipo de historial, y la acción es solo del admin", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/277_reasignar_activos_por_puesto.sql", import.meta.url), "utf8");
    expect(sql).toContain("add column if not exists position text");
    expect(sql).toContain("'asset_reassigned'");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    const acciones = readFileSync(new URL("../../app/recruiting/actions/activos.ts", import.meta.url), "utf8");
    expect(acciones).toContain("export async function reasignarActivo");
    expect(acciones).toContain('yo.role !== "admin"');
  });
});
