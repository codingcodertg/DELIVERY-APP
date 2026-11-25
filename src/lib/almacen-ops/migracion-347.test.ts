import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mensajeDeFaltaLa347 } from "@/lib/mensaje-de-error";

// 2026-11-24: la firma pide razón solo si hay diferencia después de pendientes (regla nueva). La 347 se escribe, NO se
// aplica: hasta que el dueño la aplique, la base sigue pidiendo razón en bolsas, y la pantalla lo dice en claro.
const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/347_conteos_real_y_diferencia.sql"), "utf8").replace(/\r\n/g, "\n");

describe("migración 347: la firma pide razón solo si hay diferencia", () => {
  it("redefine warehouse_ops_count_sign y la prueba de diferencia es solo counted − pendientes − sistema", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_count_sign(p_count uuid, p_sheet text, p_note text)");
    expect(SQL).toContain("and l.counted_total - coalesce((select sum(pp.qty) from public.warehouse_count_pending pp where pp.line_id = l.id), 0) - l.system_qty <> 0");
    expect(SQL).not.toContain("unit_of_measure = 'piece' or (l.unit_of_measure = 'box'");
    expect(SQL).not.toContain("and l.product_id is not null and l.system_qty is not null");
  });
  it("concede los permisos de la 336 y no escribe en el registro antes del marcador", () => {
    expect(SQL).toContain("revoke all on function public.warehouse_ops_count_sign(uuid, text, text) from public, anon;");
    expect(SQL).toContain("grant execute on function public.warehouse_ops_count_sign(uuid, text, text) to authenticated;");
    expect(SQL.split("-- @ledger-below")[0]).not.toMatch(/insert into public\.schema_migrations/);
    expect(SQL).toContain("insert into public.schema_migrations (name, checksum) values ('347_conteos_real_y_diferencia.sql', '");
  });
  it("sin la 347 aplicada, el aviso propio sale solo si la pantalla no vio diferencia", () => {
    const e = { message: "warehouse_ops: hay diferencias: escribe la razon antes de firmar" };
    expect(mensajeDeFaltaLa347(e, "en")).toBe("The database still asks for a reason on lines counted in bags (update 347 is pending): write one to sign.");
    expect(mensajeDeFaltaLa347(e, "es")).toBe("La base todavía pide la razón en líneas contadas en bolsas (falta la actualización 347): escriba una para firmar.");
    expect(mensajeDeFaltaLa347({ message: "warehouse_ops: faltan 2 lineas por contar" }, "en")).toBeNull();
  });
});
