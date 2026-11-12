-- 298: merma — nuevo origen «Proveedor» (supplier) además de Interno y Devolución de cliente (2026-11-12).
--
-- Roberto (12 nov): «On scrap we need to add supplier as an option, besides internal and customer». Material que llegó
-- dañado del proveedor. Cuenta como pérdida igual que «internal» (`warehouse_ops_scrap_loss` solo pone $0 a la
-- devolución de cliente sin CRMA; supplier cae en el caso normal). El CRMA sigue siendo solo de la devolución de cliente.
--
-- Cambios, sin tocar nada más:
--   · CHECK `warehouse_reports_return_type_check`: admite 'supplier'.
--   · `warehouse_ops_file_report` y `warehouse_ops_edit_scrap_origin`: su validación `v_origen not in ('internal',
--     'customer_return')` admite 'supplier'. Se reescriben desde su definición ACTUAL sustituyendo solo esa condición y se
--     comprueba que ocurrió (como la 294). `warehouse_ops_edit_scrap_report` (285) valida por el CHECK, no cambia.
--
-- Additive. 237/238/239 intactas.

alter table public.warehouse_reports drop constraint if exists warehouse_reports_return_type_check;
alter table public.warehouse_reports add constraint warehouse_reports_return_type_check
  check (return_type = any (array['internal'::text, 'customer_return'::text, 'supplier'::text]));

do $m$
declare
  f text;
  viejo constant text := 'v_origen not in (''internal'', ''customer_return'')';
  nuevo constant text := 'v_origen not in (''internal'', ''customer_return'', ''supplier'')';
  fn text;
begin
  foreach fn in array array[
    'public.warehouse_ops_file_report(text,text,uuid[],jsonb,text[],jsonb)',
    'public.warehouse_ops_edit_scrap_origin(uuid,text,text)'
  ] loop
    f := pg_get_functiondef(fn::regprocedure);
    if position(viejo in f) = 0 then
      raise exception '298: no encontre la validacion de origen en %', fn;
    end if;
    execute replace(f, viejo, nuevo);
  end loop;
end $m$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  if not exists (select 1 from pg_constraint where conname = 'warehouse_reports_return_type_check'
                 and pg_get_constraintdef(oid) like '%supplier%') then
    raise exception '298: el CHECK de return_type debe admitir supplier';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_file_report(text,text,uuid[],jsonb,text[],jsonb)'::regprocedure);
  if position('''customer_return'', ''supplier'')' in f) = 0 then
    raise exception '298: warehouse_ops_file_report debe admitir supplier';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_edit_scrap_origin(uuid,text,text)'::regprocedure);
  if position('''customer_return'', ''supplier'')' in f) = 0 then
    raise exception '298: warehouse_ops_edit_scrap_origin debe admitir supplier';
  end if;
  if public.warehouse_ops_scrap_loss(10, 3, 'supplier', null) <> 30 then
    raise exception '298: la merma de proveedor debe contar como perdida';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('298_merma_origen_proveedor.sql', '991a8db823fc12049b51e59518b80ccf283ea7c6b4273811b37a13f8923153a3') on conflict (name) do nothing;
