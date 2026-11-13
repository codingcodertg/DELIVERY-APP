-- 301: merma — el ADMIN borra un reporte aunque su grupo ya esté aprobado, y cada borrado deja HISTORIAL (2026-11-12).
--
-- Reunión con Roberto (12 nov, 8:52 PM): «borré 5 reportes de prueba y siguen ahí». La causa: esos 5 («Test»,
-- «testing») están en un grupo YA APROBADO, y `warehouse_ops_delete_scrap_report` (297, 299) se niega: «su grupo ya
-- está aprobado; primero deshaz la aprobación». La pantalla lo decía en una línea gris y parecía que no pasaba nada
-- (eso ya está arreglado en la app: cada falla sale en rojo con su motivo).
--
-- Lo que cambia aquí:
--   1. El ADMIN (admin del hub, o nivel «admin» de la app) puede borrar un reporte aunque su grupo esté aprobado. El
--      gerente de la tienda sigue SIN poder: para él la respuesta es la de antes. El grupo aprobado conserva sus firmas
--      (la hoja queda como se firmó, con un reporte menos); si se queda vacío, se borra con sus firmas.
--   2. Tabla `warehouse_deleted_reports`: una fila por reporte borrado, con quién, cuándo y una COPIA del reporte tal
--      como estaba («deletions should have a history»). La escribe solo la función; la lee solo el admin.
--
-- Todo lo demás de la 297/299 sigue igual: quién puede borrar (admin, o quien inicia la aprobación en esa tienda), solo
-- reportes de merma, el grupo PENDIENTE pierde sus firmas, y los archivos que otro reporte comparte nunca se devuelven
-- para borrar.
--
-- Additive (una tabla nueva y una función reescrita entera). 237/238/239 intactas.
--
-- Rollback: volver a correr la sección de `warehouse_ops_delete_scrap_report` de la 297 y luego la 299;
--           drop table if exists public.warehouse_deleted_reports;

-- ===========================================================================
-- 1. El historial de borrados
-- ===========================================================================
create table if not exists public.warehouse_deleted_reports (
  id bigint generated always as identity primary key,
  report_id uuid not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  deleted_by_name text,
  store text,
  product text,
  group_id uuid,
  group_was_approved boolean not null default false,
  snapshot jsonb not null
);
create index if not exists warehouse_deleted_reports_at_idx on public.warehouse_deleted_reports (deleted_at desc);
alter table public.warehouse_deleted_reports enable row level security;
drop policy if exists "warehouse deleted reports read" on public.warehouse_deleted_reports;
create policy "warehouse deleted reports read" on public.warehouse_deleted_reports for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
         or coalesce(public.warehouse_ops_level_of((select auth.uid())), '') = 'admin');
revoke all on public.warehouse_deleted_reports from public, anon, authenticated;
grant select on public.warehouse_deleted_reports to authenticated;

-- ===========================================================================
-- 2. Borrar un reporte de merma (la función entera, desde su definición actual: 297 + 299)
-- ===========================================================================
create or replace function public.warehouse_ops_delete_scrap_report(p_report uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  yo uuid := auth.uid();
  r record;
  g record;
  fotos text[];
  es_admin boolean;
  aprobado boolean := false;
begin
  if yo is null then raise exception 'warehouse_ops: sin acceso' using errcode = '42501'; end if;
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then raise exception 'warehouse_ops: solo se borran reportes de merma' using errcode = '22023'; end if;
  es_admin := exists (select 1 from public.profiles where id = yo and role = 'admin')
              or coalesce(public.warehouse_ops_level_of(yo), '') = 'admin';
  if not (es_admin or public.warehouse_ops_can_start_approval(r.store)) then
    raise exception 'warehouse_ops: solo el admin o el gerente de la tienda borra un reporte' using errcode = '42501';
  end if;
  if r.scrap_group_id is not null then
    select * into g from public.warehouse_scrap_groups where id = r.scrap_group_id for update;
    if g.approved_at is not null then
      -- 301: un grupo aprobado solo lo toca el admin. Sus firmas se quedan: la hoja queda como se firmo.
      if not es_admin then
        raise exception 'warehouse_ops: su grupo ya esta aprobado; primero deshaz la aprobacion (o pide a un admin que lo borre)' using errcode = '22023';
      end if;
      aprobado := true;
    else
      -- Cambia lo que cubrian las firmas del grupo pendiente: se borran (como al sacar una merma, 296).
      delete from public.warehouse_scrap_group_signatures where group_id = g.id;
    end if;
  end if;
  -- 301: el historial, ANTES de borrar: quien, cuando y la copia del reporte.
  insert into public.warehouse_deleted_reports (report_id, deleted_by, deleted_by_name, store, product, group_id, group_was_approved, snapshot)
  values (r.id, yo, (select full_name from public.profiles where id = yo), r.store, coalesce(r.product_name, r.product_sku),
          r.scrap_group_id, aprobado, row_to_json(r)::jsonb);
  fotos := coalesce(r.photos, '{}') || coalesce(case when r.approval_sheet is not null then array[r.approval_sheet] end, '{}')
           || coalesce(case when r.adjustment_proof is not null then array[r.adjustment_proof] end, '{}');
  delete from public.warehouse_report_signatures where report_id = r.id;
  delete from public.warehouse_reports where id = r.id;
  if r.scrap_group_id is not null and not exists (select 1 from public.warehouse_reports where scrap_group_id = r.scrap_group_id) then
    -- El grupo se quedo vacio: se va, con sus firmas (las de un grupo aprobado seguian ahi).
    delete from public.warehouse_scrap_group_signatures where group_id = r.scrap_group_id;
    delete from public.warehouse_scrap_groups where id = r.scrap_group_id;
  end if;
  -- Los archivos se COMPARTEN entre reportes (una captura de «Ajustada» para muchos, D-963; una hoja firmada adjunta a
  -- varios): solo se devuelven para borrar los que ya NINGUN otro reporte usa. Va despues del delete, en la misma
  -- transaccion, asi el reporte borrado ya no cuenta.
  select coalesce(array_agg(distinct f), '{}') into fotos
    from unnest(fotos) f
   where not exists (select 1 from public.warehouse_reports x
                      where f = any(coalesce(x.photos, '{}')) or x.approval_sheet = f or x.adjustment_proof = f);
  return fotos;
end $$;
revoke all on function public.warehouse_ops_delete_scrap_report(uuid) from public, anon;
grant execute on function public.warehouse_ops_delete_scrap_report(uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.warehouse_ops_delete_scrap_report(uuid)'::regprocedure);
  if position('insert into public.warehouse_deleted_reports' in f) = 0 then
    raise exception '301: delete_scrap_report debe dejar historial del borrado';
  end if;
  if position('warehouse_ops_can_start_approval(r.store)' in f) = 0 then
    raise exception '301: se perdio la puerta del gerente de la tienda (299)';
  end if;
  if position('if not es_admin then' in f) = 0 or position('primero deshaz la aprobacion' in f) = 0 then
    raise exception '301: el grupo aprobado debe seguir cerrado para quien no es admin';
  end if;
  if position('x.adjustment_proof = f' in f) = 0 or position('x.approval_sheet = f' in f) = 0 then
    raise exception '301: se perdio la salvaguarda de los archivos compartidos (297)';
  end if;
  if position('security definer' in lower(f)) = 0 then
    raise exception '301: debe seguir siendo security definer';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_delete_scrap_report(uuid)', 'execute') then
    raise exception '301: anon no debe ejecutar delete_scrap_report';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.warehouse_deleted_reports'::regclass) then
    raise exception '301: warehouse_deleted_reports debe tener RLS';
  end if;
  if has_table_privilege('anon', 'public.warehouse_deleted_reports', 'select')
     or has_table_privilege('authenticated', 'public.warehouse_deleted_reports', 'insert')
     or has_table_privilege('authenticated', 'public.warehouse_deleted_reports', 'update')
     or has_table_privilege('authenticated', 'public.warehouse_deleted_reports', 'delete') then
    raise exception '301: warehouse_deleted_reports es solo lectura para la app y cerrada a anon';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('301_merma_borrar_aprobadas_e_historial.sql', '4b05a09bbd4b949af9b641e0d9f1c31072fbf9896b189783e757b41ad595c6ba') on conflict (name) do nothing;
