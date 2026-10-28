import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PUESTOS_FIJOS, alternaPuesto, partesDePuesto, puestosParaElegir, tienePuesto } from "./employee-file";

// D-725 (2026-10-28) · «change it from single select to multi-select (checkboxes), since an employee can have more than one position».
describe("puestos con casillas", () => {
  it("varios puestos viajan en el mismo texto, separados por coma, sin repetir", () => {
    expect(partesDePuesto("Sales Representative, Group Representative , sales representative,")).toEqual(["Sales Representative", "Group Representative"]);
    expect(partesDePuesto(null)).toEqual([]);
    expect(alternaPuesto("Driver", "AI Developer")).toBe("Driver, AI Developer");
    expect(alternaPuesto("Driver, AI Developer", "driver")).toBe("AI Developer");
    expect(alternaPuesto("", "Driver")).toBe("Driver");
    expect(tienePuesto("Driver, AI Developer", "ai developer")).toBe(true);
    expect(tienePuesto("Driver", "AI Developer")).toBe(false);
  });
  it("se ofrecen los de Ajustes, los dos fijos del dueño, y el que la persona ya tenga aunque no esté en la lista", () => {
    expect(PUESTOS_FIJOS).toEqual(["AI Developer", "Group Representative"]);
    expect(puestosParaElegir(["Sales Representative", "Warehouse Associate"], "Driver, Sales Representative"))
      .toEqual(["Sales Representative", "Warehouse Associate", "AI Developer", "Group Representative", "Driver"]);
  });
  it("la ficha pinta casillas, sin «Asistencia», con «Remoto» para todos, sin los campos quitados, y la contraseña en «Cuenta del hub»", () => {
    const pagina = readFileSync(new URL("../../app/recruiting/(recruiting)/employees/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain("data-puestos");
    expect(pagina).toContain("alternaPuesto(info.job_title, p)");
    expect(pagina).not.toContain('campo("days_off"');
    expect(pagina).toContain("<option value={TIENDA_REMOTA} disabled={!editaGrupo}");
    for (const quitado of ["remote_pc_status", "rc_user_created", "rc_device_assigned", "tools_cost_year", "tools_note", "app_username"]) {
      expect(pagina, quitado).not.toContain(`campo207("${quitado}"`);
    }
    expect(pagina).toContain('data-accion="contrasena-nueva"');
    expect(pagina).toContain('fetch("/api/reset-password"');
    const dialogo = readFileSync(new URL("../../components/UserDialog.tsx", import.meta.url), "utf8");
    expect(dialogo.replace(/\r\n/g, "\n")).toContain("{!LOCAL_MODE && !desdeExpediente && (\n          <>\n            <div className=\"section-label\">{t(\"Access\", \"Acceso\")}</div>");
  });
});
