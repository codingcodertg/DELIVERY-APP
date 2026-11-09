import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KINDS, PIDEN_MOTIVO, cambiosDeActivo, detalleDeCambios, esDeEmpleado, etiquetaDeHistorial, motivoValido, textoDeActivoParaHistorial,
  textoDeEntrada, type EntradaDeHistorial,
} from "@/lib/recruiting/historial";

const entrada = (p: Partial<EntradaDeHistorial>): EntradaDeHistorial => ({
  id: "1", at: "2026-10-28T17:00:00Z", kind: "asset_released", employee_id: null, employee_name: null, asset_id: null, asset_text: null,
  actor_id: null, actor_name: null, reason: null, detail: null, data: {}, ...p,
});

describe("historial de RR. HH. (D-734)", () => {
  it("cada kind de la librería está en el check de la migración vigente (la 277, que repite la lista y suma asset_reassigned), y al revés", () => {
    // D-936 (277): el check vigente es el de la 277, que repite la lista de la 247 y suma asset_reassigned.
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/277_reasignar_activos_por_puesto.sql"), "utf8");
    const enSql = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((k) => (KINDS as readonly string[]).includes(k) || k.includes("_"));
    for (const k of KINDS) expect(enSql, k).toContain(k);
    const desde = sql.indexOf("hr_history_kind_check check (kind in ("); // la 277 tiene su propio «kind in (» en el check.
    const check = sql.slice(desde, sql.indexOf("))", desde));
    const enCheck = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enCheck.sort()).toEqual([...KINDS].sort());
  });
  it("la migración 212 no deja editar ni borrar: sin política de update/delete/all y sin grant", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/212_historial_de_rrhh.sql"), "utf8");
    expect(sql).not.toMatch(/for (update|delete|all)/i);
    expect(sql).toMatch(/grant select, insert on recruiting\.hr_history to authenticated/);
    expect(sql).not.toMatch(/grant [^;]*\b(update|delete)\b[^;]*to authenticated/i);
  });
  it("toda etiqueta existe en los dos idiomas", () => {
    for (const k of KINDS) {
      expect(etiquetaDeHistorial(k, "en").length).toBeGreaterThan(2);
      expect(etiquetaDeHistorial(k, "es").length).toBeGreaterThan(2);
      expect(etiquetaDeHistorial(k, "en")).not.toBe(etiquetaDeHistorial(k, "es"));
    }
  });
  it("de empleado: baja, alta y acceso; de activo: el resto", () => {
    expect(esDeEmpleado("employee_deactivated")).toBe(true);
    expect(esDeEmpleado("hub_access_removed")).toBe(true);
    expect(esDeEmpleado("asset_assigned")).toBe(false);
  });
  it("el motivo: tres letras de verdad; «.», «x» o espacios no valen", () => {
    expect(motivoValido("x")).toBe(false);
    expect(motivoValido("  .  ")).toBe(false);
    expect(motivoValido("ab")).toBe(false);
    expect(motivoValido(" a  b ")).toBe(true);
    expect(motivoValido("Se fue")).toBe(true);
    expect(motivoValido(null)).toBe(false);
  });
  it("liberar, respaldar, borrar y quitar el acceso piden motivo; asignar y agregar, no", () => {
    expect(PIDEN_MOTIVO).toContain("asset_released");
    expect(PIDEN_MOTIVO).toContain("asset_backed_up");
    expect(PIDEN_MOTIVO).toContain("asset_deleted");
    expect(PIDEN_MOTIVO).toContain("hub_access_removed");
    expect(PIDEN_MOTIVO).not.toContain("asset_assigned");
    expect(PIDEN_MOTIVO).not.toContain("asset_created");
  });
  it("el texto de una fila: qué · activo → persona · detalle · motivo", () => {
    const e = entrada({ kind: "asset_released", asset_text: "✉️ ana@rdz.net", employee_name: "Ana Ruiz", reason: "Se fue de la empresa", detail: "→ pending backup" });
    expect(textoDeEntrada(e, "es")).toBe("Liberado · ✉️ ana@rdz.net → Ana Ruiz · → pending backup · motivo: Se fue de la empresa");
    expect(textoDeEntrada(e, "en")).toBe("Released · ✉️ ana@rdz.net → Ana Ruiz · → pending backup · reason: Se fue de la empresa");
    expect(textoDeEntrada(entrada({ kind: "employee_reactivated", employee_name: "Ana Ruiz" }), "es")).toBe("Reactivado · Ana Ruiz");
  });
  it("el activo se guarda como texto: correo con ✉️, número con 📞 y su extensión", () => {
    expect(textoDeActivoParaHistorial({ kind: "email", value: "ana@rdz.net" })).toBe("✉️ ana@rdz.net");
    // D-850: el número en la forma única del hub aunque la fila lo guarde de antes; la extensión, como «ext. 12».
    expect(textoDeActivoParaHistorial({ kind: "phone", value: "956-555-0123", ext: "12" })).toBe("📞 (956) 555-0123 ext. 12");
    expect(textoDeActivoParaHistorial({ kind: "phone", value: "(956) 555-0123", ext: null })).toBe("📞 (956) 555-0123");
  });
  it("los cambios de un activo: solo lo que cambió, y el detalle los cuenta", () => {
    const c = cambiosDeActivo({ plan: "A", note: null, cost_year: 10 }, { plan: "B", note: null, cost_year: 10 }, ["plan", "note", "cost_year"]);
    expect(c).toEqual({ plan: { de: "A", a: "B" } });
    expect(detalleDeCambios(c)).toBe("plan: A → B");
    expect(detalleDeCambios({})).toBeNull();
  });
});
