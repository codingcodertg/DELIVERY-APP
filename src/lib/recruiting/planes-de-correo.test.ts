import { describe, expect, it } from "vitest";
import { PLANES_DE_CORREO, planDeCorreo, tooltipDelPlan } from "./planes-de-correo";

// D-725 (2026-10-28) · «hover over their plan, show a tooltip with the plan details: plan name, what it costs, and what it includes».
describe("planes de correo del archivo RTG EMAILS", () => {
  it("los tres de la leyenda con su precio por fila, y el cuarto que solo aparece en una fila", () => {
    expect(PLANES_DE_CORREO.map((p) => [p.nombre, p.costoAnual])).toEqual([
      ["Microsoft 365 Secure Business Professional", 259.8],
      ["Microsoft 365 Email Plus with Security", 129.9],
      ["Microsoft 365 Email Essentials with Security", 116.91],
      ["Microsoft 365 Secure Online Essentials", 129.9],
    ]);
    expect(planDeCorreo("microsoft 365  email plus with security")?.incluye).toContain("250k emails/mo");
    expect(planDeCorreo("Currently No Email")).toBeNull();
    expect(planDeCorreo("")).toBeNull();
  });
  it("el tooltip lleva nombre, costo y qué incluye, en el idioma de quien mira", () => {
    const es = tooltipDelPlan("Microsoft 365 Email Essentials with Security", "es")!;
    expect(es).toContain("Microsoft 365 Email Essentials with Security");
    expect(es).toContain("$116.91 al año");
    expect(es).toContain("Incluye: 10 GB of storage · 50k emails/mo");
    expect(tooltipDelPlan("Microsoft 365 Secure Business Professional", "en")).toContain("$259.80 per year");
    expect(tooltipDelPlan("Currently No Email", "en")).toBeNull();
  });
});
