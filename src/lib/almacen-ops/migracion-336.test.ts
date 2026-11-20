import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/336_conteos_lotes_y_unidad.sql"), "utf8").replace(/\r\n/g, "\n");

describe("migración 336 (conteos: lotes, unidad, producto libre, medida opcional)", () => {
  it("agrega unidad y lotes a la línea, con sus restricciones", () => {
    expect(SQL).toContain("add column if not exists unit_of_measure text");
    expect(SQL).toContain("check (unit_of_measure is null or unit_of_measure in ('box', 'bag', 'piece'))");
    expect(SQL).toContain("add column if not exists lots jsonb not null default '[]'::jsonb");
    expect(SQL).toContain("jsonb_array_length(lots) <= 20");
  });
  it("las funciones nuevas existen y piden sesión, tienda y etapa counting", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_count_lots(p_line uuid, p_unit text, p_lots jsonb)");
    expect(SQL).toContain("create or replace function public.warehouse_ops_count_add_line(p_count uuid, p_name text)");
    expect(SQL.match(/if c\.stage <> 'counting'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(SQL).toContain("if not public.warehouse_ops_in_store(c.store)");
  });
  it("la cantidad de cada lote debe ser un número (no 'NaN' ni 'Infinity') y tiene tope", () => {
    expect(SQL).toContain("if jsonb_typeof(x->'qty') is distinct from 'number' then");
    expect(SQL).toContain("if q > 1000000 then");
    expect(SQL.indexOf("jsonb_typeof(x->'qty')")).toBeLessThan(SQL.indexOf("q := (x->>'qty')::numeric;"));
    expect(SQL).toContain("if total <= 0 then raise exception 'warehouse_ops: falta lo contado'");
  });
  it("el total que se compara va en piezas; lo no comparable se marca y no entra a la firma", () => {
    expect(SQL).toContain("add column if not exists counted_comparable boolean not null default true");
    expect(SQL).toContain("comparable := l.product_id is not null and (p_unit = 'piece' or (p_unit = 'box' and coalesce(l.pieces_per_box, 0) > 0));");
    expect(SQL).toContain("counted_total = case when comparable and p_unit = 'box' then round(total * l.pieces_per_box, 2) else round(total, 2) end");
    expect(SQL).toContain("counted_comparable = comparable,");
    expect(SQL).toContain("and l.counted_comparable\n      and l.counted_total - coalesce(");
  });
  it("la foto de cada lote debe ser de quien la sube", () => {
    expect(SQL).toContain("split_part(x->>'photo', '/', 1) <> yo::text");
  });
  it("la medida es opcional en la base y el título no se rompe sin medida", () => {
    expect(SQL).not.toContain("falta la medida");
    expect(SQL).toContain("(nullif(btrim(coalesce(p_size, '')), '') is null or public.warehouse_ops_norm_medida(p.size_in) = public.warehouse_ops_norm_medida(p_size))");
    expect(SQL).toContain("titulo := btrim(p_vendor) || case when btrim(coalesce(p_size, '')) <> ''");
  });
  it("el recontar borra los lotes; no escribe en el registro de migraciones", () => {
    expect(SQL).toContain("counted_at = null, lots = '[]'::jsonb, unit_of_measure = null, recount_requested = true");
    expect(SQL).not.toMatch(/insert into public\.schema_migrations/);
  });
});
