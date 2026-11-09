import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAVES_CHECKLIST, PASOS_CHECKLIST, combinaChecklist, esFaseValida, esItemValido,
  etiquetaDeEstadoItem, etiquetaDePaso, normalizaEstadoItem, resumenChecklist,
} from "./checklist";

// D-934 (2026-11-09) · Roberto: «signed email, RingCentral number, QuickBooks access, SharePoint/app access, and app risk».
describe("checklist de alta y baja", () => {
  it("la plantilla tiene los cinco pasos que nombró Roberto, en orden", () => {
    expect(CLAVES_CHECKLIST).toEqual(["email_signed", "ringcentral", "quickbooks", "sharepoint", "app_risk"]);
  });

  it("el alta y la baja tienen textos distintos (la baja es la acción en reversa), bilingües", () => {
    const paso = PASOS_CHECKLIST[0];
    expect(etiquetaDePaso(paso, "onboarding", "es")).toBe("Correo firmado");
    expect(etiquetaDePaso(paso, "offboarding", "es")).toBe("Liberar correo firmado");
    expect(etiquetaDePaso(paso, "onboarding", "en")).toBe("Signed email");
    expect(etiquetaDePaso(paso, "offboarding", "en")).toBe("Release signed email");
  });

  it("fase e ítem válidos", () => {
    expect(esFaseValida("onboarding")).toBe(true);
    expect(esFaseValida("offboarding")).toBe(true);
    expect(esFaseValida("otra")).toBe(false);
    expect(esItemValido("quickbooks")).toBe(true);
    expect(esItemValido("inventado")).toBe(false);
  });

  it("un estado desconocido o vacío cae en «pendiente»", () => {
    expect(normalizaEstadoItem("done")).toBe("done");
    expect(normalizaEstadoItem("na")).toBe("na");
    expect(normalizaEstadoItem("")).toBe("pending");
    expect(normalizaEstadoItem("lo-que-sea")).toBe("pending");
    expect(etiquetaDeEstadoItem("na", "es")).toBe("N/A");
    expect(etiquetaDeEstadoItem("done", "en")).toBe("Done");
  });

  it("combina la plantilla con lo guardado: siempre los cinco pasos, los que faltan como pendientes", () => {
    const items = combinaChecklist("onboarding", [
      { item_key: "email_signed", status: "done", done_by_name: "Ana", done_at: "2026-11-09", note: null },
      { item_key: "quickbooks", status: "na", done_by_name: null, done_at: null, note: "no aplica" },
    ]);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({ key: "email_signed", status: "done", done_by_name: "Ana" });
    expect(items[1].status).toBe("pending"); // ringcentral, sin fila
    expect(items[2]).toMatchObject({ key: "quickbooks", status: "na", note: "no aplica" });
  });

  it("el resumen cuenta hechos, pendientes y n-a, y «completo» cuando nada queda pendiente", () => {
    const items = combinaChecklist("onboarding", [
      { item_key: "email_signed", status: "done" },
      { item_key: "ringcentral", status: "done" },
      { item_key: "quickbooks", status: "na" },
      { item_key: "sharepoint", status: "done" },
      { item_key: "app_risk", status: "done" },
    ]);
    const r = resumenChecklist(items);
    expect(r).toEqual({ total: 5, hechos: 4, pendientes: 0, na: 1, completo: true });
    const incompleto = combinaChecklist("onboarding", [{ item_key: "email_signed", status: "done" }]);
    expect(resumenChecklist(incompleto).completo).toBe(false);
  });

  it("la 275 crea la tabla con sus políticas, y el expediente pinta la sección", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/275_checklist_alta_y_baja.sql", import.meta.url), "utf8");
    expect(sql).toContain("create table if not exists recruiting.employee_checklist (");
    expect(sql).toContain("constraint employee_checklist_unica unique (employee_file_id, phase, item_key)");
    expect(sql).toContain("check (phase in ('onboarding', 'offboarding'))");
    expect(sql).toContain("for select using ((select public.current_recruiting_role()) in ('admin', 'manager'))");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    const pagina = readFileSync(new URL("../../app/recruiting/(recruiting)/employees/page.tsx", import.meta.url), "utf8");
    expect(pagina).toContain("<ChecklistDelEmpleado");
  });
});
