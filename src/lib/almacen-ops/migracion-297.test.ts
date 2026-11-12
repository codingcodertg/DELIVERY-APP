import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/297_merma_gerente_inicia_historial_borrar.sql"), "utf8");

describe("297: gerente inicia, historial, borrar", () => {
  it("crear el grupo usa can_start_approval, que no incluye al supervisor", () => {
    expect(sql).toContain("'not public.warehouse_ops_can_start_approval(la_tienda) then'");
    const f = sql.slice(sql.indexOf("create or replace function public.warehouse_ops_can_start_approval"), sql.indexOf("revoke all on function public.warehouse_ops_can_start_approval"));
    expect(f).toContain("p.role = 'manager'");
    expect(f).not.toContain("warehouse_ops_supervisor");
  });
  it("el historial es solo lectura y su escritor no se llama desde la app", () => {
    expect(sql).toContain("grant select on public.warehouse_report_log to authenticated");
    expect(sql).toContain("revoke all on function public.warehouse_ops_log(uuid, text, jsonb) from public, anon, authenticated");
  });
  it("borrar: solo admin, bloquea la fila y rechaza grupos aprobados", () => {
    const f = sql.slice(sql.indexOf("create or replace function public.warehouse_ops_delete_scrap_report"));
    expect(f).toContain("role = 'admin'");
    expect(f).toContain("for update");
    expect(f).toContain("approved_at is not null");
  });
});
