import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 330 · listas de conteo. La migración no se aplica desde aquí: esta prueba fija lo que tiene que decir el SQL
// (RLS, funciones definer con search_path vacío, sin escritura directa, envío por record_cycle_count) y que
// termina en la marca del libro, sin la línea del libro (la pone el dueño).
const sql = readFileSync("supabase/migrations/330_listas_de_conteo.sql", "utf8");
const lineas = sql.split(/\r?\n/);

describe("330 · listas de conteo: forma de la migración", () => {
  it("lleva la marca del libro y, justo debajo, su línea de registro", () => {
    const ultima = lineas.filter((l) => l.trim() !== "").at(-1);
    expect(ultima?.startsWith("insert into public.schema_migrations (name, checksum) values ('330_listas_de_conteo.sql',")).toBe(true);
    expect(lineas.filter((l) => l.trim() !== "").at(-2)).toBe("-- @ledger-below");
  });

  it("crea las dos tablas en el esquema erp, con RLS", () => {
    expect(sql).toContain("create table if not exists erp.count_lists");
    expect(sql).toContain("create table if not exists erp.count_list_lines");
    expect(sql).toContain("alter table erp.count_lists enable row level security;");
    expect(sql).toContain("alter table erp.count_list_lines enable row level security;");
  });

  it("el renglón es único por lista y el conteo nunca es negativo", () => {
    expect(sql).toContain("unique (list_id, product_id)");
    expect(sql).toMatch(/counted_qty\s+numeric check \(counted_qty is null or counted_qty >= 0\)/);
  });

  it("la lectura de las tablas es solo para admin y manager, y la escritura directa se quita", () => {
    expect(sql).toMatch(/create policy "count_lists read \(mgr\/admin\)"[\s\S]*?array\['admin', 'manager'\]/);
    expect(sql).toMatch(/revoke insert, update, delete, truncate on erp\.count_lists, erp\.count_list_lines from authenticated;/);
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("toda función nueva es security definer con search_path vacío", () => {
    const funciones = [...sql.matchAll(/create or replace function (erp\.[a-z_]+)\(/g)].map((m) => m[1]);
    expect(funciones.length).toBeGreaterThanOrEqual(9);
    for (const nombre of funciones) {
      const inicio = sql.indexOf(`create or replace function ${nombre}(`);
      const cabecera = sql.slice(inicio, sql.indexOf("$$", inicio));
      expect(cabecera, nombre).toMatch(/security definer set search_path = ''/);
    }
  });

  it("la puerta es admin o manager (la de record_cycle_count)", () => {
    expect(sql).toMatch(/create or replace function erp\.count_list_gate\(\)[\s\S]*?not in \('admin', 'manager'\)/);
  });

  it("enviar pasa por record_cycle_count y rechaza renglones sin contar y listas vacías", () => {
    const inicio = sql.indexOf("create or replace function erp.count_list_submit");
    const fin = sql.indexOf("end $$;", inicio);
    const cuerpo = sql.slice(inicio, fin);
    expect(cuerpo).toContain("erp.record_cycle_count(");
    expect(cuerpo).toContain("'LIST_HAS_UNCOUNTED'");
    expect(cuerpo).toContain("'LIST_EMPTY'");
    expect(cuerpo).toContain("if l.status <> 'open'");
  });

  it("ninguna función se le da a anon ni a public, y las internas no llegan a clientes", () => {
    expect(sql).toContain("revoke execute on function erp.count_list_gate() from public, anon, authenticated;");
    expect(sql).toContain("revoke execute on function erp.count_list_lines_json(bigint, bigint) from public, anon, authenticated;");
    for (const f of ["count_list_create(text, text)", "count_list_submit(bigint)", "count_lists_list(integer, integer)"]) {
      expect(sql).toContain(`revoke execute on function erp.${f} from public, anon;`);
    }
  });

  it("es idempotente: create if not exists / or replace / drop policy if exists", () => {
    expect(sql).not.toMatch(/^create table erp\./m);
    // Cada política nueva va precedida de su drop ... if exists (si no, la segunda pasada revienta).
    const creadas = (sql.match(/^create policy /gm) ?? []).length;
    const borradas = (sql.match(/^drop policy if exists /gm) ?? []).length;
    expect(borradas).toBeGreaterThanOrEqual(creadas);
    expect(sql).toMatch(/drop policy if exists "erp module gate" on erp\.count_lists;/);
  });
});
