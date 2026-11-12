-- 297: merma — solo el gerente inicia la aprobación, historial de cambios y borrar reportes de prueba (2026-11-12).
--
-- Reunión con Roberto (11 nov, 11 PM):
--   1. «Iniciar aprobación» (crear el grupo) solo el GERENTE de la tienda, el store_admin o el admin. El supervisor de
--      almacén sigue firmando su línea (293), abre el grupo, desecha y ajusta, saca mermas de un grupo pendiente y quita
--      su firma (296), pero ya no arma el grupo. Nueva `warehouse_ops_can_start_approval(store)` y
--      `warehouse_ops_create_scrap_group` la usa (se reescribe desde su definición actual, sustituyendo solo la puerta).
--   2. Historial: tabla `warehouse_report_log` (solo lectura para la app, misma visibilidad que el reporte) que llenan
--      triggers: alta del reporte, cambio de etapa, fotos, grupo, ediciones de campos (antes → después) y firmas (del
--      reporte y del grupo).
--   3. Borrar un reporte de merma que no es real («Test»): SOLO admin (del hub o de la app). Si está en un grupo
--      pendiente, sale de él (las firmas del grupo se borran; el grupo vacío se borra). Si su grupo ya está aprobado, se
--      rechaza: primero hay que deshacer la aprobación. Devuelve las rutas de sus fotos para que la app las borre del
--      almacenamiento.
--
-- Additive. 237/238/239 intactas.

-- ---------------------------------------------------------------------------
-- 1. Quién inicia la aprobación
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_can_start_approval(r_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      n.nivel = 'admin'
      or (n.nivel = 'store_admin' and t.mia)
      or (n.nivel = 'full' and t.mia and p.role = 'manager')
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
      cross join lateral (select (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))) is true as mia) t
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_can_start_approval(text) from public, anon;
grant execute on function public.warehouse_ops_can_start_approval(text) to authenticated;

do $m$
declare
  f text;
  viejo constant text := 'not public.warehouse_ops_can_manage(la_tienda) then';
  nuevo constant text := 'not public.warehouse_ops_can_start_approval(la_tienda) then';
  n int;
begin
  f := pg_get_functiondef('public.warehouse_ops_create_scrap_group(text,uuid[])'::regprocedure);
  n := (length(f) - length(replace(f, viejo, ''))) / length(viejo);
  if n <> 1 then raise exception '297: esperaba 1 puerta en create_scrap_group, encontre %', n; end if;
  f := replace(f, viejo, nuevo);
  f := replace(f, 'solo quien gestiona esa tienda crea el grupo', 'solo el gerente de la tienda inicia la aprobacion');
  execute f;
end $m$;

-- ---------------------------------------------------------------------------
-- 2. Historial
-- ---------------------------------------------------------------------------
create table if not exists public.warehouse_report_log (
  id bigserial primary key,
  report_id uuid not null references public.warehouse_reports(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  kind text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists warehouse_report_log_report_idx on public.warehouse_report_log (report_id, at);
alter table public.warehouse_report_log enable row level security;
drop policy if exists "warehouse report log read" on public.warehouse_report_log;
create policy "warehouse report log read" on public.warehouse_report_log for select to authenticated
  using (exists (select 1 from public.warehouse_reports r
                 where r.id = warehouse_report_log.report_id and public.warehouse_ops_can_see(r.kind, r.store, r.author_id)));
revoke all on public.warehouse_report_log from public, anon, authenticated;
grant select on public.warehouse_report_log to authenticated;

create or replace function public.warehouse_ops_log(p_report uuid, p_kind text, p_detail jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare yo uuid := auth.uid();
begin
  insert into public.warehouse_report_log (report_id, actor, actor_name, kind, detail)
  values (p_report, yo, (select full_name from public.profiles where id = yo), p_kind, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.warehouse_ops_log(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.warehouse_ops_log_report() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  cambios jsonb := '{}'::jsonb;
  k text;
  -- Campos que se editan a mano (285 y anteriores). Las fechas/actores de etapa y las huellas no cuentan como edición.
  campos constant text[] := array['product_id','product_sku','product_name','unit_cost','boxes','pieces_per_box','loose_pieces',
    'total_pieces','damaged_pieces','sample_pieces','scrap_type','return_type','reason','crma','broken_by','broken_on','store','answers'];
begin
  if tg_op = 'INSERT' then
    perform public.warehouse_ops_log(new.id, 'created', jsonb_build_object('kind', new.kind));
    return new;
  end if;
  if new.kind <> 'scrap' then return new; end if;
  if coalesce(old.stage, '') is distinct from coalesce(new.stage, '') then
    perform public.warehouse_ops_log(new.id, 'stage', jsonb_build_object('de', old.stage, 'a', new.stage));
  end if;
  if cardinality(coalesce(old.photos, '{}')) is distinct from cardinality(coalesce(new.photos, '{}')) then
    perform public.warehouse_ops_log(new.id, 'photos', jsonb_build_object('antes', cardinality(coalesce(old.photos, '{}')), 'despues', cardinality(coalesce(new.photos, '{}'))));
  end if;
  if old.scrap_group_id is distinct from new.scrap_group_id then
    perform public.warehouse_ops_log(new.id, 'group', jsonb_build_object('de', old.scrap_group_id, 'a', new.scrap_group_id,
      'nombre', (select name from public.warehouse_scrap_groups where id = coalesce(new.scrap_group_id, old.scrap_group_id))));
  end if;
  foreach k in array campos loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
      cambios := cambios || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
    end if;
  end loop;
  if cambios <> '{}'::jsonb then perform public.warehouse_ops_log(new.id, 'edited', cambios); end if;
  return new;
end $$;
drop trigger if exists warehouse_report_log_trg on public.warehouse_reports;
create trigger warehouse_report_log_trg after insert or update on public.warehouse_reports
  for each row execute function public.warehouse_ops_log_report();

create or replace function public.warehouse_ops_log_group_sig() returns trigger
  language plpgsql security definer set search_path = public as $$
declare s record; rid uuid;
begin
  s := case when tg_op = 'DELETE' then old else new end;
  for rid in select id from public.warehouse_reports where scrap_group_id = s.group_id loop
    perform public.warehouse_ops_log(rid, 'signature', jsonb_build_object('slot', s.slot, 'accion', case when tg_op = 'DELETE' then 'quitada' else 'firmada' end,
      'firmante', s.signer_name, 'grupo', s.group_id));
  end loop;
  return null;
end $$;
drop trigger if exists warehouse_report_log_group_sig_trg on public.warehouse_scrap_group_signatures;
create trigger warehouse_report_log_group_sig_trg after insert or delete on public.warehouse_scrap_group_signatures
  for each row execute function public.warehouse_ops_log_group_sig();

create or replace function public.warehouse_ops_log_report_sig() returns trigger
  language plpgsql security definer set search_path = public as $$
declare s record;
begin
  s := case when tg_op = 'DELETE' then old else new end;
  if exists (select 1 from public.warehouse_reports where id = s.report_id) then
    perform public.warehouse_ops_log(s.report_id, 'signature', jsonb_build_object('slot', s.slot, 'accion', case when tg_op = 'DELETE' then 'quitada' else 'firmada' end,
      'firmante', s.signer_name));
  end if;
  return null;
end $$;
drop trigger if exists warehouse_report_log_report_sig_trg on public.warehouse_report_signatures;
create trigger warehouse_report_log_report_sig_trg after insert or delete on public.warehouse_report_signatures
  for each row execute function public.warehouse_ops_log_report_sig();

-- ---------------------------------------------------------------------------
-- 3. Borrar un reporte de merma de prueba (solo admin)
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_delete_scrap_report(p_report uuid)
  returns text[] language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
  r record;
  g record;
  fotos text[];
begin
  if yo is null or not (
    exists (select 1 from public.profiles where id = yo and role = 'admin')
    or coalesce(public.warehouse_ops_level_of(yo), '') = 'admin'
  ) then
    raise exception 'warehouse_ops: solo el admin borra un reporte' using errcode = '42501';
  end if;
  select * into r from public.warehouse_reports where id = p_report for update;
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if r.kind <> 'scrap' then raise exception 'warehouse_ops: solo se borran reportes de merma' using errcode = '22023'; end if;
  if r.scrap_group_id is not null then
    select * into g from public.warehouse_scrap_groups where id = r.scrap_group_id for update;
    if g.approved_at is not null then
      raise exception 'warehouse_ops: su grupo ya esta aprobado; primero deshaz la aprobacion' using errcode = '22023';
    end if;
    -- Cambia lo que cubrian las firmas del grupo: se borran (como al sacar una merma, 296).
    delete from public.warehouse_scrap_group_signatures where group_id = g.id;
  end if;
  fotos := coalesce(r.photos, '{}') || coalesce(case when r.approval_sheet is not null then array[r.approval_sheet] end, '{}')
           || coalesce(case when r.adjustment_proof is not null then array[r.adjustment_proof] end, '{}');
  delete from public.warehouse_report_signatures where report_id = r.id;
  delete from public.warehouse_reports where id = r.id;
  if r.scrap_group_id is not null and not exists (select 1 from public.warehouse_reports where scrap_group_id = r.scrap_group_id) then
    delete from public.warehouse_scrap_groups where id = r.scrap_group_id;
  end if;
  -- Los archivos se COMPARTEN entre reportes (una captura de «Ajustada» para muchos, D-963; una hoja firmada adjunta a
  -- varios): solo se devuelven para borrar los que ya NINGÚN otro reporte usa. Va después del delete, en la misma
  -- transacción, así el reporte borrado ya no cuenta.
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
  f := pg_get_functiondef('public.warehouse_ops_create_scrap_group(text,uuid[])'::regprocedure);
  if position('warehouse_ops_can_start_approval(la_tienda)' in f) = 0 then
    raise exception '297: create_scrap_group debe usar can_start_approval';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_can_start_approval(text)'::regprocedure);
  if position('warehouse_ops_supervisor' in f) > 0 then
    raise exception '297: el supervisor no debe poder iniciar la aprobacion';
  end if;
  if has_table_privilege('authenticated', 'public.warehouse_report_log', 'INSERT')
     or has_table_privilege('authenticated', 'public.warehouse_report_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.warehouse_report_log', 'DELETE') then
    raise exception '297: el historial debe ser solo lectura para la app';
  end if;
  if has_function_privilege('authenticated', 'public.warehouse_ops_log(uuid,text,jsonb)', 'execute') then
    raise exception '297: warehouse_ops_log no debe ser llamable desde la app';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_delete_scrap_report(uuid)'::regprocedure);
  if position('for update' in f) = 0 or position('approved_at is not null' in f) = 0 then
    raise exception '297: delete_scrap_report debe bloquear la fila y rechazar grupos aprobados';
  end if;
  if position('x.adjustment_proof = f' in f) = 0 or position('x.approval_sheet = f' in f) = 0 then
    raise exception '297: delete_scrap_report no debe devolver archivos que otro reporte sigue usando';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('297_merma_gerente_inicia_historial_borrar.sql', '9e50eddfb9220bf51536a3c7c7649b3e9b3fcd748b71cbc951770e656eca8e2e') on conflict (name) do nothing;
