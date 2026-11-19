import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RPC_QUE_ESCRIBEN } from "../ensenanza-general";

/**
 * La forma de la migración 333 (conteos: revisión de órdenes pendientes, sistema vs contado y etapas nuevas). No se
 * puede aplicar aquí: la prueba fija lo que tiene que decir el archivo (conversión de etapas en orden, tabla con RLS
 * de solo lectura, funciones con puertas y sin anon, autocomprobación, y la línea del ledger dejada al dueño).
 */
const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/333_conteos_revision_y_sistema.sql"), "utf8");
const pos = (s: string) => {
  const i = SQL.indexOf(s);
  expect(i, `falta: ${s}`).toBeGreaterThanOrEqual(0);
  return i;
};

describe("333: la conversión de etapas de los conteos en curso", () => {
  it("reviewing_orders pasa a counting, y review firmado pasa a sign_off; review sin firma se queda en review", () => {
    expect(SQL).toContain("update public.warehouse_counts set stage = 'counting' where stage = 'reviewing_orders';");
    expect(SQL).toContain("update public.warehouse_counts set stage = 'sign_off' where stage = 'review' and signed_at is not null;");
    expect(SQL).not.toMatch(/set stage = 'review' where stage = 'review'/);
  });
  it("la conversión corre ANTES de la restricción nueva (y la vieja se quita antes de convertir)", () => {
    const quita = pos("alter table public.warehouse_counts drop constraint if exists warehouse_counts_stage_check;");
    const convierte = pos("update public.warehouse_counts set stage = 'counting' where stage = 'reviewing_orders';");
    const pone = pos("alter table public.warehouse_counts add constraint warehouse_counts_stage_check");
    expect(quita).toBeLessThan(convierte);
    expect(convierte).toBeLessThan(pone);
  });
  it("la restricción nueva tiene los cinco pasos de Roberto y cancelled; ya no acepta reviewing_orders", () => {
    expect(SQL).toContain("check (stage in ('organizing', 'counting', 'review', 'sign_off', 'adjusted', 'cancelled'));");
    expect(SQL).not.toMatch(/check \(stage in \([^)]*reviewing_orders/);
  });
});

describe("333: columnas y tabla nueva", () => {
  it("firma con razón y el sistema con quién y cuándo", () => {
    expect(SQL).toContain("add column if not exists sign_note text");
    expect(SQL).toContain("system_qty_set_by uuid references auth.users(id) on delete set null");
    expect(SQL).toContain("system_qty_set_by_name text");
    expect(SQL).toContain("system_qty_set_at timestamptz");
  });
  it("warehouse_count_pending: factura obligatoria, cantidad > 0, cascada con el conteo y la línea", () => {
    expect(SQL).toContain("create table if not exists public.warehouse_count_pending");
    expect(SQL).toMatch(/count_id uuid not null references public\.warehouse_counts\(id\) on delete cascade/);
    expect(SQL).toMatch(/line_id uuid not null references public\.warehouse_count_lines\(id\) on delete cascade/);
    expect(SQL).toContain("invoice_no text not null check (btrim(invoice_no) <> '' and length(invoice_no) <= 40)");
    expect(SQL).toContain("qty numeric(12,2) not null check (qty > 0)");
  });
  it("RLS de solo lectura igual que las líneas (sin políticas de escritura; la prueba de la 274 lo exige)", () => {
    expect(SQL).toContain("alter table public.warehouse_count_pending enable row level security;");
    expect(SQL).toContain("create policy warehouse_count_pending_read on public.warehouse_count_pending for select to authenticated");
    expect(SQL).toContain("using (exists (select 1 from public.warehouse_counts c where c.id = count_id and public.warehouse_ops_in_store(c.store)))");
    expect(SQL).not.toMatch(/create policy [a-z_]+ on public\.warehouse_count_pending for (insert|update|delete|all)/);
    expect(SQL).toContain("revoke all on public.warehouse_count_pending from anon;");
    expect(SQL).toContain("grant select on public.warehouse_count_pending to authenticated;");
  });
});

describe("333: funciones con sus puertas, sin anon y con search_path fijo", () => {
  const nuevas = [
    "warehouse_ops_pending_add(uuid, text, int, int, int, text)",
    "warehouse_ops_pending_update(uuid, text, int, int, int, text)",
    "warehouse_ops_pending_delete(uuid)",
    "warehouse_ops_count_set_system(uuid, numeric)",
    "warehouse_ops_count_back(uuid, text)",
    "warehouse_ops_count_sign(uuid, text, text)",
    "warehouse_ops_count_adjust(uuid, text[])",
    "warehouse_ops_count_recount(uuid, text)",
    "warehouse_ops_count_advance(uuid, text, text)",
    "warehouse_ops_count_products(text, text, text, text, text, bigint)",
    "warehouse_ops_count_vendors(text)",
    "warehouse_ops_create_count(text, text, text, text, text, bigint, text)",
  ];
  it("cada función se crea o redefine, es security definer con search_path pinned y no se da a anon", () => {
    for (const f of nuevas) {
      expect(SQL, f).toContain(`function public.${f.split("(")[0]}(`);
      expect(SQL, f).toContain(`revoke all on function public.${f} from public, anon`);
    }
    expect((SQL.match(/security definer set search_path = public/g) ?? []).length).toBeGreaterThanOrEqual(nuevas.length - 2);
    expect(SQL).toMatch(/security definer set search_path = public, erp as \$\$/);
  });
  it("el gerente (can_manage) en recontar, poner el sistema, volver, firmar y ajustar; el personal (in_store) en pendientes y avanzar", () => {
    expect(SQL).toMatch(/if not public\.warehouse_ops_can_manage\(c\.store\) then raise exception 'warehouse_ops: solo el gerente pone la cantidad del sistema'/);
    expect(SQL).toMatch(/if not public\.warehouse_ops_can_manage\(c\.store\) then raise exception 'warehouse_ops: solo el gerente regresa el conteo'/);
    expect(SQL).toMatch(/if not public\.warehouse_ops_can_manage\(c\.store\) then raise exception 'warehouse_ops: solo el gerente firma el conteo'/);
    expect(SQL).toMatch(/if not public\.warehouse_ops_in_store\(c\.store\) then raise exception 'warehouse_ops: sin acceso a esa tienda'/);
  });
  it("las órdenes pendientes solo se escriben en la etapa review; el sistema solo en sign_off", () => {
    expect(SQL).toMatch(/if c\.stage <> 'review' then raise exception 'warehouse_ops: las ordenes pendientes se revisan despues de contar'/);
    expect(SQL).toMatch(/if c\.stage <> 'sign_off' then raise exception 'warehouse_ops: la cantidad del sistema se pone en la firma'/);
  });
  it("firmar exige el conteo completo, el sistema en todas las líneas y la razón si hay diferencia después de pendientes", () => {
    expect(SQL).toContain("faltan % cantidades del sistema");
    expect(SQL).toContain("hay diferencias: escribe la razon antes de firmar");
    expect(SQL).toContain("coalesce((select sum(pp.qty) from public.warehouse_count_pending pp where pp.line_id = l.id), 0) - l.system_qty <> 0");
  });
  it("ajustar sigue exigiendo la firma y ahora desde sign_off", () => {
    expect(SQL).toContain("primero hay que firmar el conteo");
    expect(SQL).toMatch(/if c\.stage <> 'sign_off' then raise exception 'warehouse_ops: el conteo no esta en firma'/);
  });
  it("la firma vieja de dos argumentos se borra (no quedan dos firmas)", () => {
    expect(SQL).toContain("drop function if exists public.warehouse_ops_count_sign(uuid, text);");
  });
  it("la comparación de proveedor y medida es normalizada, y la nota de proveedor + medida es opcional", () => {
    expect(SQL).toContain("create or replace function public.warehouse_ops_norm_nombre(t text)");
    expect(SQL).toContain("create or replace function public.warehouse_ops_norm_medida(t text)");
    expect(SQL).toContain("elsif p_scope_kind = 'vendor_size' and not sin_nota and length(btrim(p_note)) < 2");
  });
});

describe("333: autocomprobación, ledger y RPC clasificadas", () => {
  it("termina con la autocomprobación y la línea del ledger justo tras su marcador", () => {
    expect(SQL).toContain("do $chk$");
    expect(SQL).toContain("-- @ledger-below");
    expect(SQL.split("-- @ledger-below")[1].trim().startsWith("insert into public.schema_migrations")).toBe(true);
  });
  it("no contiene nada de aplicar contra una base (--escribe ni comandos)", () => {
    expect(SQL).not.toMatch(/--escribe/);
  });
  it("cada RPC nueva que la app llama está clasificada como escritura en la lista de la enseñanza", () => {
    for (const r of ["warehouse_ops_pending_add", "warehouse_ops_pending_update", "warehouse_ops_pending_delete", "warehouse_ops_count_set_system", "warehouse_ops_count_back"]) {
      expect(RPC_QUE_ESCRIBEN as readonly string[], r).toContain(r);
    }
  });
});
