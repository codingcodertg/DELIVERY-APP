import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DELIVERY_WINDOW_PRESETS } from "./constants";
import { missingFields } from "./required";
import { vendedoresParaLaOrden } from "./sales-reps";

/** D-1015: decisiones de la reunión del 12 nov con Roberto (Entregas y Leads). */
describe("reunión 12 nov", () => {
  it("«Todo el día» es la primera ventana", () => {
    expect(DELIVERY_WINDOW_PRESETS[0].key).toBe("all_day");
  });
  it("el tipo de origen libre («Other») no exige tienda; los demás sí", () => {
    const reglas = { Other: { docRef: "none" as const, anyOrigin: true }, Customer: { docRef: "invoice" as const, storeToStore: false } };
    expect(missingFields({ order_type: "Other" }, reglas).some((m) => m.key === "store")).toBe(false);
    expect(missingFields({ order_type: "Customer" }, reglas).some((m) => m.key === "store")).toBe(true);
  });
  it("el admin puede elegir a cualquier usuario activo como vendedor (él incluido)", () => {
    const users = [
      { id: "a", full_name: "Admin", role: "admin", store: null },
      { id: "s", full_name: "Ventas", role: "sales", store: "RDZ Pharr" },
      { id: "w", full_name: "Almacén", role: "warehouse", store: "RDZ Pharr" },
      { id: "x", full_name: "De baja", role: "sales", store: "RDZ Pharr", left_at: "2026-10-01" },
    ] as never[];
    const ids = (l: { id: string }[]) => l.map((u) => u.id).sort();
    expect(ids(vendedoresParaLaOrden(users, "RDZ Pharr", null, [], true) as never)).toEqual(["a", "s", "w"]);
    expect(ids(vendedoresParaLaOrden(users, "RDZ Pharr", null, []) as never)).not.toContain("w");
  });
  it("Leads: el STXP Pool va antes que el GOV Pool", () => {
    const src = readFileSync(join(process.cwd(), "src/app/leads/Leads.tsx"), "utf8");
    expect(src.indexOf('data-pestana="privado"')).toBeLessThan(src.indexOf('data-pestana="banco"'));
  });
});
