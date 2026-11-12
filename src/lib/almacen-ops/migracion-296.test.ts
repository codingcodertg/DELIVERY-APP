import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/296_merma_deshacer.sql"), "utf8").replace(/\r\n/g, "\n");
const funcion = (nombre: string) => {
  const i = sql.indexOf(`create or replace function public.${nombre}(`);
  return sql.slice(i, sql.indexOf("end $$;", i));
};

describe("296 · deshacer en la base", () => {
  it("sacar del grupo y borrar grupo: bloquean el grupo, exigen gestionar la tienda y nunca con el grupo aprobado", () => {
    for (const f of [funcion("warehouse_ops_remove_from_scrap_group"), funcion("warehouse_ops_delete_scrap_group")]) {
      expect(f).toMatch(/from public\.warehouse_scrap_groups where id = \w+ for update/);
      expect(f).toContain("warehouse_ops_can_manage(g.store)");
      expect(f).toContain("if g.approved_at is not null then");
      expect(f).toContain("delete from public.warehouse_scrap_group_signatures");
    }
  });
  it("deshacer la etapa: SOLO admin / store_admin (reunión 11 nov), un paso, y la aprobación saca la merma del grupo", () => {
    const f = funcion("warehouse_ops_set_scrap_stage");
    expect(f).toContain("not in ('admin', 'store_admin')");
    expect(f).toContain("warehouse_ops_can_manage(r.store)");
    expect(f).toContain("de - a <> 1 or p_stage = 'documented'");
    expect(f).toContain("scrap_group_id = case when r.stage = 'approved' then null else scrap_group_id end");
  });
  it("datos: ninguna merma sin aprobar se queda dentro de un grupo aprobado (lo que Roberto vio el 11 nov)", () => {
    expect(sql).toContain("g.approved_at is not null");
    expect(sql).toContain("no debe quedar una merma sin aprobar dentro de un grupo aprobado");
  });
  it("quitar la firma bloquea el grupo; anon no ejecuta lo nuevo", () => {
    expect(funcion("warehouse_ops_unsign_scrap_group")).toMatch(/where id = p_group for update/);
    expect(sql).toContain("revoke all on function public.warehouse_ops_remove_from_scrap_group(uuid) from public, anon;");
    expect(sql).toContain("revoke all on function public.warehouse_ops_delete_scrap_group(uuid) from public, anon;");
  });
});
