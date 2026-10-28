import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { telefonoDeFicha } from "./employee-file";
import {
  activosDeLaFila, cuentaPorEstado, estadoInicial, etiquetaDeEstado, libres, losDe, parcheAsignar, parcheLiberar, porPersona,
  textoDeTelefono, valorDeActivo, type Activo,
} from "./activos";

// D-730 (2026-10-28) · «add a "Company Assets" section to the UI to track paid company emails and phone numbers».
const a = (x: Partial<Activo>): Activo => ({
  id: "x", kind: "email", value: "a@b.c", ext: null, phone_type: null, status: "available", employee_id: null, last_employee_id: null,
  plan: null, cost_year: null, note: null, updated_at: null, ...x,
});

describe("activos de la empresa", () => {
  it("el valor se guarda con el formato de la app: correo en minúsculas, número 956-xxx-xxxx", () => {
    expect(valorDeActivo("email", " SalesRHC@RDZTileGroup.net ")).toBe("salesrhc@rdztilegroup.net");
    expect(valorDeActivo("phone", "19568171583")).toBe("956-817-1583");
    expect(valorDeActivo("phone", "(956) 817-1529")).toBe("956-817-1529");
    expect(valorDeActivo("email", "")).toBeNull();
    // D-731: la misma forma que el expediente, sin importarla (el guion de carga importa este fichero con node).
    for (const n of ["19568171583", "(956) 817-1529", "ext. 12", "956 563-9505"]) expect(valorDeActivo("phone", n)).toBe(telefonoDeFicha(n));
    expect(textoDeTelefono({ value: "956-817-1583", ext: "111" })).toBe("956-817-1583 · ext. 111");
  });
  it("solo se asigna lo disponible; al liberar, el correo queda pendiente de respaldo y el número disponible", () => {
    expect(parcheAsignar({ status: "available" }, "e1")).toEqual({ status: "assigned", employee_id: "e1" });
    expect(parcheAsignar({ status: "pending_backup" }, "e1")).toBeNull();
    expect(parcheAsignar({ status: "assigned" }, "e1")).toBeNull();
    expect(parcheLiberar({ kind: "email", employee_id: "e1" })).toEqual({ status: "pending_backup", employee_id: null, last_employee_id: "e1" });
    expect(parcheLiberar({ kind: "phone", employee_id: "e1" })).toEqual({ status: "available", employee_id: null, last_employee_id: "e1" });
    expect(parcheLiberar({ kind: "phone", employee_id: "e1" }, "not_in_use").status).toBe("not_in_use");
    expect(parcheLiberar({ kind: "phone", employee_id: "e1" }, "assigned").status).toBe("available");
  });
  it("libres, los de una persona, cuentas y la vista por persona", () => {
    const lista = [
      a({ id: "1", kind: "email", value: "a@x.com", status: "assigned", employee_id: "e1" }),
      a({ id: "2", kind: "email", value: "b@x.com" }),
      a({ id: "3", kind: "email", value: "c@x.com", status: "pending_backup" }),
      a({ id: "4", kind: "phone", value: "956-555-0100", ext: "101", status: "assigned", employee_id: "e1" }),
      a({ id: "5", kind: "phone", value: "956-555-0101", status: "not_in_use" }),
    ];
    expect(libres(lista, "email").map((x) => x.id)).toEqual(["2"]);
    expect(libres(lista, "phone")).toEqual([]);
    expect(losDe(lista, "e1").map((x) => x.id)).toEqual(["1", "4"]);
    expect(cuentaPorEstado(lista)).toEqual({ assigned: 2, available: 1, not_in_use: 1, pending_backup: 1 });
    const v = porPersona(lista, [{ id: "e1", full_name: "Ana" }, { id: "e2", full_name: "Bo" }]);
    expect(v[0].email?.id).toBe("1"); expect(v[0].phone?.id).toBe("4"); expect(v[1].email).toBeNull(); expect(v[1].phone).toBeNull();
    expect(etiquetaDeEstado("pending_backup", "es")).toBe("Pendiente de respaldo");
  });
  it("una fila del archivo RTG EMAILS da su correo (con plan y costo) y su número (ext., físico o app)", () => {
    const fila = { "FIRST NAME": "Zulema", "LAST NAME": "Resendez", "EMAIL": "SalesRHC@rdztilegroup.net", "EMAIL TYPE": "Microsoft 365 Email Essentials with Security",
      " COST/YR ": " $116.91 ", "WORK PHONE": "19568171583", "EXT #": "111", "SERIAL #": "F04EA467AC52", "QB Initials": "ZR" };
    const r = activosDeLaFila(fila);
    expect(r.nombre).toBe("Zulema Resendez");
    expect(r.email).toEqual({ kind: "email", value: "salesrhc@rdztilegroup.net", ext: null, phone_type: null, plan: "Microsoft 365 Email Essentials with Security", cost_year: 116.91, note: null });
    expect(r.phone).toMatchObject({ kind: "phone", value: "956-817-1583", ext: "111", phone_type: "physical" });
    expect(activosDeLaFila({ ...fila, "SERIAL #": "Wireless" }).phone?.phone_type).toBe("app");
    expect(activosDeLaFila({ ...fila, "EMAIL TYPE": "Currently No Email", "EMAIL": "" }).email).toBeNull();
    expect(activosDeLaFila({ ...fila, "WORK PHONE": "CURRENT RC?" }).phone).toBeNull();
  });
  it("el estado con que nace: con persona asignado; TERMINATED deja el correo por respaldar y el número libre; DELETE-BACKUP por respaldar", () => {
    const sinPersona = activosDeLaFila({ "FIRST NAME": "Pending", "LAST NAME": "EXTRA", "EMAIL": "salesrhc2@rdztilegroup.net" });
    expect(sinPersona.nombre).toBeNull();
    expect(estadoInicial("email", sinPersona, false)).toBe("available");
    const term = activosDeLaFila({ "FIRST NAME": "Alberto", "LAST NAME": "Garza", "QB Initials": "TERMINATED", "EMAIL": "projects@rdztilegroup.net", "WORK PHONE": "19568171656" });
    expect(term.nombre).toBeNull(); expect(term.terminado).toBe(true);
    expect(estadoInicial("email", term, false)).toBe("pending_backup");
    expect(estadoInicial("phone", term, false)).toBe("available");
    const borrar = activosDeLaFila({ "FIRST NAME": "EXTRA", "LAST NAME": "DELETE-BACKUP", "EMAIL": "hresendez@rdztilegroup.net" });
    expect(estadoInicial("email", borrar, false)).toBe("pending_backup");
    expect(estadoInicial("phone", term, true)).toBe("assigned");
  });
  it("la 211, la pestaña, la ficha y la baja", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/211_activos_de_empresa.sql", import.meta.url), "utf8");
    expect(sql).toContain("create table if not exists recruiting.company_assets (");
    expect(sql).toContain("constraint company_assets_value_unica unique (kind, value)");
    expect(sql).toContain("constraint company_assets_asignado_con_persona check ((status = 'assigned') = (employee_id is not null))");
    expect(sql).toContain("for select using ((select public.current_recruiting_role()) in ('admin', 'manager'))");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
    const hr = readFileSync(new URL("../../app/recruiting/actions/hr.ts", import.meta.url), "utf8");
    expect(hr).toContain("await liberaActivosDeLaBaja(supabase, fileId, userId);");
    const pagina = readFileSync(new URL("../../app/recruiting/(recruiting)/employees/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain('<Seccion id="activos" titulo={t("COMPANY ASSETS", "ACTIVOS DE LA EMPRESA")}>');
    const constantes = readFileSync(new URL("./constants.ts", import.meta.url), "utf8");
    expect(constantes).toContain('{ id: "assets", label: "🧰 Company assets", href: "/recruiting/assets", roles: ["admin", "manager"], grupo: "hr" }');
  });
});
