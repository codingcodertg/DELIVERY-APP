import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGENES_DE_MERMA, etiquetaDeOpcion } from "./pasos";
import { cuentaComoPerdida, perdidaDeMerma } from "./perdida";
import { origenDeMerma } from "./datos";

describe("298: origen «Proveedor» en la merma (Roberto, 12 nov)", () => {
  it("la opción existe con sus etiquetas ES/EN", () => {
    expect(ORIGENES_DE_MERMA.map((o) => o.v)).toEqual(["internal", "customer_return", "supplier"]);
    expect(etiquetaDeOpcion("scrap", "return_type", "supplier", "es")).toBe("Proveedor");
    expect(etiquetaDeOpcion("scrap", "return_type", "supplier", "en")).toBe("Supplier");
  });
  it("cuenta como pérdida igual que interno (sin lógica de CRMA)", () => {
    expect(cuentaComoPerdida({ return_type: "supplier", crma: null })).toBe(true);
    expect(perdidaDeMerma(10, { damaged: 3, sample: 0 }, { return_type: "supplier", crma: null })).toBe(30);
  });
  it("el origen guardado se normaliza sin perder supplier", () => {
    expect(origenDeMerma("supplier")).toBe("supplier");
    expect(origenDeMerma("customer_return")).toBe("customer_return");
    expect(origenDeMerma("algo")).toBe("internal");
  });
  it("la migración 298 admite supplier en el CHECK y en las dos funciones", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/298_merma_origen_proveedor.sql"), "utf8");
    expect(sql).toContain("'supplier'::text");
    expect(sql).toContain("warehouse_ops_file_report(text,text,uuid[],jsonb,text[],jsonb)");
    expect(sql).toContain("warehouse_ops_edit_scrap_origin(uuid,text,text)");
  });
});
