import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GRUPOS, GRUPOS_QUE_NO_VE_EL_VENDEDOR, esVendedor, puedeAsignarVendedores } from "./reglas";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

// D-NEXT (2026-10-28) · El dueño: «Salesperson: can only view and open the customers assigned to them … Manager: can view
// all customers of their store, and can assign customers to salespeople. Admin: can view everything». Y en la ficha: «hide
// these sections completely — Archivos, Campos ocultos, Crédito y términos»; el contacto «label on the left, value on the right».
describe("clientes por rol", () => {
  it("asignan admin y gerente; el vendedor es solo sales", () => {
    expect(puedeAsignarVendedores("admin")).toBe(true);
    expect(puedeAsignarVendedores("manager")).toBe(true);
    expect(puedeAsignarVendedores("sales")).toBe(false);
    expect(puedeAsignarVendedores("accounting")).toBe(false);
    expect(esVendedor("sales")).toBe(true);
    expect(esVendedor("manager")).toBe(false);
    expect(GRUPOS_QUE_NO_VE_EL_VENDEDOR).toEqual(["credito"]);
    expect(GRUPOS.map((g) => g.key)).toContain("credito");
  });
  it("la 210: el vendedor solo los suyos, el gerente su tienda por código, y la política con tres argumentos", () => {
    const sql = leer("supabase/migrations/210_clientes_por_rol.sql");
    expect(sql).toContain("create or replace function erp.customers_ve_la_fila(p_rep uuid, p_creador uuid, p_store text)");
    expect(sql).toContain("when p.role = 'sales' then (p_rep = auth.uid() or p_creador = auth.uid())");
    expect(sql).toContain("or upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)");
    expect(sql).toContain("when 'rdz mcallen'     then 'MCA'");
    expect(sql).toContain("using ((select erp.customers_ve_la_fila(rep_id, created_by, store))) with check (true);");
    expect(sql).toContain("drop function if exists erp.customers_ve_la_fila(uuid, uuid);");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
  it("la ficha esconde al vendedor crédito, campos ocultos y archivos; el contacto lleva etiqueta a la izquierda", () => {
    const ficha = leer("src/app/customers/FichaDeCliente.tsx");
    expect(ficha).toContain("filasPorGrupo().filter(({ grupo }) => !esVendedor || !GRUPOS_QUE_NO_VE_EL_VENDEDOR.includes(grupo.key))");
    expect(ficha).toContain("{!esVendedor && (\n        <div className=\"space-y-4 self-start\" data-solo-no-vendedor>");
    expect(ficha).toContain("esVendedor={esVendedor} t={t} />");
    for (const campo of ["contact_name", "contact_title", "phone", "email"]) {
      expect(ficha).toContain(`<div className={FILA_DE_CONTACTO} data-campo="${campo}">`);
    }
    expect(ficha).toContain('{t("Name", "Nombre")}</span>');
    expect(ficha).toContain('{t("Phone", "Teléfono")}</span>');
    // La página y la ventana pasan el rol.
    expect(leer("src/app/customers/page.tsx")).toContain("esVendedor={esVendedor(role)}");
    expect(leer("src/app/customers/[id]/page.tsx")).toContain("esVendedor={esVendedor(role)}");
    expect(leer("src/app/customers/Clientes.tsx")).toContain("esVendedor={esVendedor}");
  });
});
