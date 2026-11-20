import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/336_conteos_lotes_y_unidad.sql"), "utf8");

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
