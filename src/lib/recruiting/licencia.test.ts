import { describe, expect, it } from "vitest";
import { DOC_KINDS, avisoDeLicencia, estadoDeLicencia } from "./hr";
import { readFileSync } from "node:fs";

// D-725 (2026-10-28) · «Only ask for the expiration date … Track the expiration date and show an alert when an employee's
// license is about to expire, so we can request the new document».
describe("la licencia", () => {
  it("solo pide el vencimiento", () => {
    const lic = DOC_KINDS.find((d) => d.key === "license")!;
    expect(lic.expires).toBe(true);
    expect(lic.soloVence).toBe(true);
    expect(DOC_KINDS.filter((d) => d.soloVence).map((d) => d.key)).toEqual(["license"]);
  });
  it("vencida, por vencer (30 días) o nada; sin fecha, nada", () => {
    expect(estadoDeLicencia("2026-10-27", "2026-10-28")).toBe("vencida");
    expect(estadoDeLicencia("2026-10-28", "2026-10-28")).toBe("por_vencer");
    expect(estadoDeLicencia("2026-11-27", "2026-10-28")).toBe("por_vencer");
    expect(estadoDeLicencia("2026-11-28", "2026-10-28")).toBeNull();
    expect(estadoDeLicencia(null, "2026-10-28")).toBeNull();
    expect(estadoDeLicencia("rara", "2026-10-28")).toBeNull();
  });
  it("el aviso dice cuándo", () => {
    expect(avisoDeLicencia("2026-11-09", "2026-10-28", "en")).toBe("License expires in 12 days (2026-11-09)");
    expect(avisoDeLicencia("2026-01-02", "2026-10-28", "es")).toBe("Licencia vencida el 2026-01-02");
    expect(avisoDeLicencia("2027-01-02", "2026-10-28", "es")).toBeNull();
  });
  it("la lista trae el vencimiento de la licencia y la pantalla lo avisa; la ficha no pide la fecha de emisión", () => {
    const lib = readFileSync(new URL("./employee-file.ts", import.meta.url), "utf8");
    expect(lib).toContain("licencia_vence: venceDe.get(f.id as string) ?? null,");
    const accion = readFileSync(new URL("../../app/recruiting/actions/hr.ts", import.meta.url), "utf8");
    expect(accion).toContain('.select("employee_id, kind, signed_at, expires_at")');
    const pantalla = readFileSync(new URL("../../app/recruiting/(recruiting)/employees/page.tsx", import.meta.url), "utf8");
    expect(pantalla).toContain("{!k.soloVence && (");
    expect(pantalla).toContain('data-insignia="licencia"');
    expect(pantalla).toContain('data-filtro="licencia"');
  });
});
