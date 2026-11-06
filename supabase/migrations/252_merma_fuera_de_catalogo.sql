-- 252: Merma fuera de catalogo (Warehouse Ops, D-883) (2026-11-05).
--
-- Roberto (admin): «por ahora que puedan poner cosas aunque no esten en la base; el gerente lo cambia despues».
--   1. warehouse_reports.product_not_in_catalog: la merma se puede guardar con un nombre escrito a mano (sin product_id)
--      y, si lo saben, un costo por pieza. El check de forma acepta product_id nulo SOLO si es fuera de catalogo.
--      Tambien edited_by / edited_at: quien corrigio el producto despues.
--   2. warehouse_ops_file_report: la misma de la 247, salvo que p_scrap puede traer {free_name, unit_cost} en lugar
--      de product_id.
--   3. warehouse_ops_edit_scrap_product(report, product_id, name, cost): el gerente (o supervisor de almacen) de esa
--      tienda, o el admin, vincula la merma a un producto real (copia sku, nombre y costo del catalogo) o corrige el
--      nombre y el costo a mano. Recalcula la perdida.
--
-- Sin begin/commit propios. Para deshacer: borrar (o vincular) las filas con product_not_in_catalog, volver a crear la
-- funcion y el check de la 247, drop function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric),
-- drop de las tres columnas y delete from public.schema_migrations where name = '252_merma_fuera_de_catalogo.sql'.

-- 1. Columnas y forma
alter table public.warehouse_reports
  add column if not exists product_not_in_catalog boolean not null default false,
  add column if not exists edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists edited_at timestamptz;

alter table public.warehouse_reports drop constraint if exists warehouse_reports_scrap_shape;
alter table public.warehouse_reports add constraint warehouse_reports_scrap_shape check (
  (kind = 'scrap' and (product_id is not null or (product_not_in_catalog and product_name is not null))
     and scrap_type is not null and total_pieces is not null and return_type is not null and reason is not null)
  or (kind <> 'scrap' and product_id is null and not product_not_in_catalog and scrap_type is null
     and total_pieces is null and total_loss is null)
);
create index if not exists warehouse_reports_not_in_catalog on public.warehouse_reports (store) where product_not_in_catalog;

-- 2. Registrar un reporte (la de la 247 + fuera de catalogo)
create or replace function public.warehouse_ops_file_report(
  p_kind text, p_store text, p_subject_ids uuid[], p_answers jsonb, p_photos text[], p_scrap jsonb
) returns uuid
  language plpgsql volatile security definer set search_path = public, erp, recruiting as $$
declare
  yo uuid := auth.uid();
  mi_nombre text;
  nuevo uuid;
  sujetos uuid[] := coalesce(p_subject_ids, '{}');
  fotos text[] := coalesce(p_photos, '{}');
  prod record;
  v_boxes int; v_ppb int; v_loose int; v_total int;
  v_broken uuid[] := '{}';
  v_hr_kind text;
  v_texto text;
  s uuid;
  v_libre boolean := false;
  v_nombre text;
  v_costo numeric;
begin
  if yo is null or not public.has_warehouse_ops_access() then
    raise exception 'warehouse_ops: sin acceso' using errcode = '42501';
  end if;
  if p_kind not in ('incident', 'zone', 'insubordination', 'safety', 'maintenance', 'positive', 'scrap') then
    raise exception 'warehouse_ops: tipo desconocido %', p_kind;
  end if;
  if not exists (select 1 from public.settings st, jsonb_array_elements(coalesce(st.stores, '[]'::jsonb)) e
                 where st.id = 1 and e->>'name' = p_store) then
    raise exception 'warehouse_ops: tienda desconocida %', p_store;
  end if;
  if exists (select 1 from unnest(sujetos) u where not exists (select 1 from public.profiles pr where pr.id = u)) then
    raise exception 'warehouse_ops: empleado desconocido';
  end if;
  if p_kind in ('incident', 'zone', 'insubordination', 'safety', 'positive') and cardinality(sujetos) = 0 then
    raise exception 'warehouse_ops: falta el empleado';
  end if;
  if p_kind = 'positive' and cardinality(sujetos) <> 1 then
    raise exception 'warehouse_ops: la observacion positiva es de un empleado';
  end if;
  if cardinality(fotos) > 6 or exists (select 1 from unnest(fotos) f where split_part(f, '/', 1) <> yo::text) then
    raise exception 'warehouse_ops: foto no valida';
  end if;
  select full_name into mi_nombre from public.profiles where id = yo;

  if p_kind = 'scrap' then
    if p_scrap is null then raise exception 'warehouse_ops: faltan los datos de la merma'; end if;
    if nullif(p_scrap->>'product_id', '') is not null then
      select pp.id, pp.sku, pp.name, pp.cost into prod from erp.products pp where pp.id = (p_scrap->>'product_id')::bigint;
      if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
      v_libre := false;
    else
      -- Fuera de catalogo (252): nombre escrito a mano y, si lo saben, el costo por pieza. Un gerente lo corrige luego.
      v_nombre := left(btrim(coalesce(p_scrap->>'free_name', '')), 200);
      if length(v_nombre) < 2 then raise exception 'warehouse_ops: falta el producto'; end if;
      v_costo := nullif(p_scrap->>'unit_cost', '')::numeric;
      if v_costo is not null and (v_costo < 0 or v_costo > 100000) then raise exception 'warehouse_ops: costo no valido'; end if;
      select null::bigint as id, null::text as sku, v_nombre as name, round(v_costo, 2) as cost into prod;
      v_libre := true;
    end if;
    v_boxes := coalesce((p_scrap->>'boxes')::int, 0);
    v_ppb   := coalesce((p_scrap->>'pieces_per_box')::int, 1);
    v_loose := coalesce((p_scrap->>'loose_pieces')::int, 0);
    if v_boxes < 0 or v_loose < 0 or v_ppb < 1 then raise exception 'warehouse_ops: cantidades no validas'; end if;
    v_total := v_boxes * v_ppb + v_loose;
    if v_total < 1 then raise exception 'warehouse_ops: cero piezas'; end if;
    select coalesce(array_agg(x::uuid), '{}') into v_broken from jsonb_array_elements_text(coalesce(p_scrap->'broken_by', '[]'::jsonb)) x;
    if exists (select 1 from unnest(v_broken) u where not exists (select 1 from public.profiles pr where pr.id = u)) then
      raise exception 'warehouse_ops: empleado desconocido';
    end if;
    insert into public.warehouse_reports (kind, store, author_id, author_name, subject_ids, answers, photos,
        product_id, product_sku, product_name, scrap_type, boxes, pieces_per_box, loose_pieces, total_pieces,
        unit_cost, total_loss, return_type, reason, broken_by, crma, product_not_in_catalog)
      values ('scrap', p_store, yo, mi_nombre, '{}', coalesce(p_answers, '{}'::jsonb), fotos,
        prod.id, prod.sku, prod.name, p_scrap->>'scrap_type', v_boxes, v_ppb, v_loose, v_total,
        prod.cost, case when prod.cost is null then null else round(prod.cost * v_total, 2) end,
        p_scrap->>'return_type', p_scrap->>'reason', v_broken, nullif(btrim(coalesce(p_scrap->>'crma', '')), ''), v_libre)
      returning id into nuevo;
    return nuevo;
  end if;

  insert into public.warehouse_reports (kind, store, author_id, author_name, subject_ids, answers, photos)
    values (p_kind, p_store, yo, mi_nombre, sujetos, coalesce(p_answers, '{}'::jsonb), fotos)
    returning id into nuevo;

  -- El gancho al expediente: una fila por empleado en el historial de RR. HH., como las amonestaciones.
  v_hr_kind := case p_kind when 'insubordination' then 'employee_insubordination'
                           when 'zone' then 'employee_zone_infraction'
                           when 'positive' then 'employee_positive_observation' end;
  if v_hr_kind is not null then
    v_texto := left(coalesce(p_answers->>'description', ''), 1000);
    foreach s in array sujetos loop
      insert into recruiting.hr_history (kind, employee_id, employee_name, actor_id, actor_name, reason, detail, data)
        values (v_hr_kind,
          (select ef.id from recruiting.employee_files ef where ef.id = s),
          (select full_name from public.profiles where id = s),
          yo, mi_nombre, nullif(v_texto, ''),
          'Warehouse Ops · ' || p_store,
          jsonb_build_object('source', 'warehouse_ops', 'report_id', nuevo, 'profile_id', s, 'store', p_store,
                             'answers', coalesce(p_answers, '{}'::jsonb)));
    end loop;
  end if;
  return nuevo;
end $$;


-- 3. Corregir el producto de una merma (gerente/supervisor de la tienda, o admin)
create or replace function public.warehouse_ops_edit_scrap_product(
  p_report uuid, p_product_id bigint, p_name text, p_cost numeric
) returns void
  language plpgsql volatile security definer set search_path = public, erp as $$
declare
  yo uuid := auth.uid();
  r record;
  prod record;
  v_nombre text;
begin
  select * into r from public.warehouse_reports where id = p_report and kind = 'scrap';
  if r.id is null then raise exception 'warehouse_ops: reporte desconocido'; end if;
  if yo is null or not exists (
    select 1 from public.profiles p where p.id = yo and (
      p.role = 'admin'
      or ('warehouse_ops' = any(coalesce(p.module_access, '{}'))
          and (p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
          and (p.store = r.store or r.store = any(coalesce(p.visible_stores, '{}'))))
    )
  ) then
    raise exception 'warehouse_ops: solo el gerente de la tienda corrige la merma' using errcode = '42501';
  end if;
  if p_product_id is not null then
    select pp.id, pp.sku, pp.name, pp.cost into prod from erp.products pp where pp.id = p_product_id;
    if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
    update public.warehouse_reports set product_id = prod.id, product_sku = prod.sku, product_name = prod.name,
        unit_cost = prod.cost, total_loss = case when prod.cost is null then null else round(prod.cost * total_pieces, 2) end,
        product_not_in_catalog = false, edited_by = yo, edited_at = now()
      where id = p_report;
  else
    v_nombre := left(btrim(coalesce(p_name, '')), 200);
    if length(v_nombre) < 2 then raise exception 'warehouse_ops: falta el producto'; end if;
    if p_cost is not null and (p_cost < 0 or p_cost > 100000) then raise exception 'warehouse_ops: costo no valido'; end if;
    update public.warehouse_reports set product_id = null, product_sku = null, product_name = v_nombre,
        unit_cost = round(p_cost, 2), total_loss = case when p_cost is null then null else round(round(p_cost, 2) * total_pieces, 2) end,
        product_not_in_catalog = true, edited_by = yo, edited_at = now()
      where id = p_report;
  end if;
end $$;

revoke all on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) from public, anon;
grant execute on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) to authenticated;
revoke all on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) from public, anon;
grant execute on function public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric) to authenticated;

do $chk$
begin
  if position('free_name' in pg_get_functiondef('public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb)'::regprocedure)) = 0 then
    raise exception '252: warehouse_ops_file_report no acepta fuera de catalogo';
  end if;
  if has_function_privilege('anon', 'public.warehouse_ops_edit_scrap_product(uuid, bigint, text, numeric)', 'execute') then
    raise exception '252: anon corrige merma';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '252: warehouse_reports no debe tener politicas de escritura';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('252_merma_fuera_de_catalogo.sql', '29067517919d080f843709026ec80cb59f339051cceefeda9c59fae149f52055') on conflict (name) do nothing;
