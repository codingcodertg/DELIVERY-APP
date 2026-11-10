import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RPC_QUE_ESCRIBEN } from "@/lib/ensenanza-general";

const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const SQL = lee("supabase/migrations/285_merma_editar_reporte.sql");

describe("285: editar todo un reporte de merma (admin/gerente)", () => {
  it("crea el RPC warehouse_ops_edit_scrap_report(uuid, jsonb)", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_edit_scrap_report(p_report uuid, p_patch jsonb)");
  });
  it("exige la puerta de gestión (admin/gerente)", () => {
    expect(SQL).toContain("warehouse_ops_can_manage(r.store)");
  });
  it("recalcula la pérdida", () => {
    expect(SQL).toContain("public.warehouse_ops_scrap_loss(");
  });
  it("revierte la aprobación al editar (vuelve a pendiente de firma)", () => {
    expect(SQL).toContain("approved_at = null");
  });
  it("editar una merma desechada/ajustada exige admin", () => {
    expect(SQL).toContain("in ('dumped', 'adjusted')");
    expect(SQL).toContain("in ('admin', 'store_admin')");
  });
  it("rechaza el guardado sin cambios (no borra firmas por un abrir+guardar)", () => {
    expect(SQL).toContain("nada que cambiar");
  });
  it("el producto de catálogo sale de erp.products, no del cliente", () => {
    expect(SQL).toContain("from erp.products");
  });
  it("no la puede ejecutar anon", () => {
    expect(SQL).toContain("revoke all on function public.warehouse_ops_edit_scrap_report(uuid, jsonb) from public, anon;");
  });
  it("el RPC está clasificado como de escritura (modo enseñanza)", () => {
    expect(RPC_QUE_ESCRIBEN).toContain("warehouse_ops_edit_scrap_report");
  });
});
