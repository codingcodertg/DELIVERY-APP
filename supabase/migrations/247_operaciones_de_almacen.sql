-- 247: Operaciones de almacen / Warehouse Ops (2026-11-05).
--
-- La reconstruccion en el hub de la vieja app «Tile Ops» del jefe: una bitacora del piso del almacen. Siete reportes
-- (incidente, infraccion de zona, insubordinacion, infraccion de seguridad, mantenimiento, observacion positiva y
-- merma/danos) que llena cualquiera con el modulo, desde el telefono, con la sesion del hub (sin PIN).
--
-- Que hace:
--   0. 'warehouse_ops' en profiles_module_access_known (la ultima definicion aplicada es la 180: su lista + una palabra).
--   1. public.has_warehouse_ops_access(): admin, o 'warehouse_ops' en module_access.
--   2. public.warehouse_reports: UNA tabla para los siete tipos. Las respuestas del asistente van en `answers` (jsonb);
--      lo que se suma o se filtra tiene columna propia: tienda, autor, empleados del reporte (subject_ids) y, solo en
--      merma, producto, cantidades, costo por pieza congelado al reportar y la perdida en $.
--      Por que una y no dos: la lista, los filtros y la RLS son una sola; el libro de merma es `where kind = 'scrap'`;
--      y no hay dos filas que puedan quedar a medias (en Tile Ops la de scrap_logs fallaba en silencio).
--      Un check obliga a que las columnas de merma esten llenas en merma y vacias en lo demas.
--   3. RLS (solo SELECT; nadie escribe directo): ver la funcion warehouse_ops_can_see.
--   4. public.warehouse_ops_file_report(...): la UNICA forma de crear un reporte. Valida tienda, personas, fotos y
--      cantidades; congela erp.products.cost; calcula la perdida; y, en los tres tipos de RR. HH., escribe en el
--      historial del expediente (recruiting.hr_history), igual que las amonestaciones (D-806/D-807).
--   5. public.warehouse_ops_search_products(q): buscar producto por nombre o SKU sin tener el modulo de Inventario.
--   6. recruiting.hr_history acepta tres tipos nuevos: employee_insubordination, employee_zone_infraction,
--      employee_positive_observation.
--   7. El cubo PRIVADO 'warehouse-ops' (Tile Ops tenia uno publico) y sus politicas.
--
-- Inventario: NO se descuenta nada todavia (el inventario no se usa). La costura: `inventory_movement_id` queda nulo;
-- cuando se use, la funcion 4 llamara a adjust_inventory y guardara aqui el movimiento.
--
-- Sin begin/commit propios. Para deshacer (en este orden):
--   drop function if exists public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb);
--   drop function if exists public.warehouse_ops_search_products(text);
--   drop table if exists public.warehouse_reports;
--   drop function if exists public.warehouse_ops_can_see(text, text, uuid);
--   drop function if exists public.has_warehouse_ops_access();
--   drop policy if exists "warehouse ops bucket read" on storage.objects;
--   drop policy if exists "warehouse ops bucket insert" on storage.objects;
--   delete from storage.objects where bucket_id = 'warehouse-ops'; delete from storage.buckets where id = 'warehouse-ops';
--   delete from recruiting.hr_history where kind in ('employee_insubordination','employee_zone_infraction','employee_positive_observation');
--   y volver a crear hr_history_kind_check con la lista de la 228;
--   update public.profiles set module_access = array_remove(module_access, 'warehouse_ops') where 'warehouse_ops' = any(module_access);
--   y volver a crear profiles_module_access_known con la lista de la 180;
--   delete from public.schema_migrations where name = '247_operaciones_de_almacen.sql';

-- ---------------------------------------------------------------------------
-- 0. La palabra del modulo
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys','leads','customers','warehouse_ops'])
  not valid;

-- ---------------------------------------------------------------------------
-- 1. Quien entra
-- ---------------------------------------------------------------------------
create or replace function public.has_warehouse_ops_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'warehouse_ops' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 2. Quien ve un reporte (la misma regla que src/lib/almacen-ops/visibilidad.ts)
--   - admin: todo.
--   - tipos de RR. HH. (zone, insubordination, positive): el admin o gerente de RR. HH. (recruiting_role), y el gerente
--     de tienda (role = 'manager' con el modulo) de ESA tienda. Nadie mas: ni el autor ni el empleado del reporte.
--   - los demas tipos: el autor; y el gerente de tienda o el supervisor de almacen (permiso 'warehouse_ops_supervisor')
--     de esa tienda, con el modulo.
--   «Esa tienda» = profiles.store, o una de profiles.visible_stores.
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_can_see(r_kind text, r_store text, r_author uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select
      p.role = 'admin'
      or (
        r_kind in ('zone', 'insubordination', 'positive')
        and (
          p.recruiting_role in ('admin', 'manager')
          or (p.role = 'manager' and 'warehouse_ops' = any(coalesce(p.module_access, '{}'))
              and (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))))
        )
      )
      or (
        r_kind not in ('zone', 'insubordination', 'positive')
        and 'warehouse_ops' = any(coalesce(p.module_access, '{}'))
        and (
          r_author = p.id
          or ((p.role = 'manager' or 'warehouse_ops_supervisor' = any(coalesce(p.permissions, '{}')))
              and (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))))
        )
      )
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 3. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.warehouse_reports (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('incident', 'zone', 'insubordination', 'safety', 'maintenance', 'positive', 'scrap')),
  store         text not null,
  author_id     uuid not null references public.profiles(id) on delete restrict,
  author_name   text,
  -- Los empleados del reporte (involucrados / reconocido), por id de perfil = id del expediente de RR. HH.
  subject_ids   uuid[] not null default '{}',
  answers       jsonb not null default '{}'::jsonb,
  -- Rutas dentro del cubo privado 'warehouse-ops' ({autor}/{fichero}).
  photos        text[] not null default '{}',
  -- Solo merma
  product_id    bigint references erp.products(id) on delete set null,
  product_sku   text,
  product_name  text,
  scrap_type    text check (scrap_type in ('damaged', 'sample')),
  boxes         integer check (boxes >= 0),
  pieces_per_box integer check (pieces_per_box >= 1),
  loose_pieces  integer check (loose_pieces >= 0),
  total_pieces  integer check (total_pieces >= 1),
  unit_cost     numeric(12,2),
  total_loss    numeric(14,2),
  return_type   text check (return_type in ('internal', 'customer_return')),
  reason        text check (reason in ('fell', 'strap', 'forklift', 'transportation', 'other')),
  broken_by     uuid[] not null default '{}',
  crma          text,
  -- La costura del inventario: hoy siempre nulo.
  inventory_movement_id bigint,
  constraint warehouse_reports_scrap_shape check (
    (kind = 'scrap' and product_id is not null and scrap_type is not null and total_pieces is not null
       and return_type is not null and reason is not null)
    or (kind <> 'scrap' and product_id is null and scrap_type is null and total_pieces is null and total_loss is null)
  )
);
create index if not exists warehouse_reports_store_at on public.warehouse_reports (store, created_at desc);
create index if not exists warehouse_reports_author on public.warehouse_reports (author_id, created_at desc);
create index if not exists warehouse_reports_kind_at on public.warehouse_reports (kind, created_at desc);
create index if not exists warehouse_reports_subjects on public.warehouse_reports using gin (subject_ids);

alter table public.warehouse_reports enable row level security;
drop policy if exists warehouse_reports_read on public.warehouse_reports;
create policy warehouse_reports_read on public.warehouse_reports
  for select to authenticated using (public.warehouse_ops_can_see(kind, store, author_id));
-- Sin politicas de insert/update/delete: se crea por la funcion 4 y no se edita ni se borra desde la app.
revoke all on public.warehouse_reports from anon;
grant select on public.warehouse_reports to authenticated;
grant all on public.warehouse_reports to service_role;

-- ---------------------------------------------------------------------------
-- 4. El historial de RR. HH. acepta los tres tipos nuevos (la lista de la 228 + tres)
-- ---------------------------------------------------------------------------
alter table recruiting.hr_history drop constraint if exists hr_history_kind_check;
alter table recruiting.hr_history add constraint hr_history_kind_check check (kind in (
  'employee_deactivated', 'employee_leaving_edited', 'employee_reactivated',
  'hub_access_removed', 'hub_access_restored',
  'asset_created', 'asset_edited', 'asset_deleted', 'asset_assigned', 'asset_released', 'asset_released_on_leaving',
  'asset_backed_up', 'asset_status_changed',
  'employee_warning', 'employee_reprimand',
  'employee_insubordination', 'employee_zone_infraction', 'employee_positive_observation'
));

-- ---------------------------------------------------------------------------
-- 5. Buscar producto (lee erp.products sin pedir el modulo de Inventario; solo lo que hace falta)
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_search_products(q text)
  returns table (id bigint, sku text, name text, cost numeric, pieces_per_box integer)
  language plpgsql stable security definer set search_path = public, erp as $$
declare patron text;
begin
  if not public.has_warehouse_ops_access() then raise exception 'warehouse_ops: sin acceso' using errcode = '42501'; end if;
  if length(btrim(coalesce(q, ''))) < 2 then return; end if;
  patron := '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.sku, p.name, p.cost, p.pieces_per_box
    from erp.products p
    where p.record_status <> 'archived' and (p.sku ilike patron or p.name ilike patron)
    order by (p.sku ilike btrim(q)) desc, p.name
    limit 8;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Registrar un reporte
--   p_scrap (solo merma): {product_id, scrap_type, boxes, pieces_per_box, loose_pieces, return_type, reason,
--                          broken_by: [uuid], crma}
-- ---------------------------------------------------------------------------
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
    select pp.id, pp.sku, pp.name, pp.cost into prod from erp.products pp where pp.id = (p_scrap->>'product_id')::bigint;
    if prod.id is null then raise exception 'warehouse_ops: producto desconocido'; end if;
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
        unit_cost, total_loss, return_type, reason, broken_by, crma)
      values ('scrap', p_store, yo, mi_nombre, '{}', coalesce(p_answers, '{}'::jsonb), fotos,
        prod.id, prod.sku, prod.name, p_scrap->>'scrap_type', v_boxes, v_ppb, v_loose, v_total,
        prod.cost, case when prod.cost is null then null else round(prod.cost * v_total, 2) end,
        p_scrap->>'return_type', p_scrap->>'reason', v_broken, nullif(btrim(coalesce(p_scrap->>'crma', '')), ''))
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

revoke all on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) from public, anon;
grant execute on function public.warehouse_ops_file_report(text, text, uuid[], jsonb, text[], jsonb) to authenticated;
revoke all on function public.warehouse_ops_search_products(text) from public, anon;
grant execute on function public.warehouse_ops_search_products(text) to authenticated;
revoke all on function public.warehouse_ops_can_see(text, text, uuid) from public, anon;
grant execute on function public.warehouse_ops_can_see(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. El cubo privado de fotos
--   Sube: quien tiene el modulo, solo a su carpeta ({uid}/...).
--   Lee: quien puede ver un reporte que nombra esa foto (la RLS de warehouse_reports decide), o el que la subio.
--   Nadie borra ni reescribe desde la app.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('warehouse-ops', 'warehouse-ops', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false;

drop policy if exists "warehouse ops bucket read" on storage.objects;
drop policy if exists "warehouse ops bucket insert" on storage.objects;
create policy "warehouse ops bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-ops' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.warehouse_reports r where name = any(r.photos))
  ));
create policy "warehouse ops bucket insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'warehouse-ops' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.has_warehouse_ops_access());

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare def text;
begin
  if not exists (select 1 from storage.buckets where id = 'warehouse-ops' and not public) then
    raise exception '247: el cubo warehouse-ops no es privado';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'warehouse_reports' and cmd <> 'SELECT') then
    raise exception '247: warehouse_reports no debe tener politicas de escritura';
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint where conrelid = 'recruiting.hr_history'::regclass and conname = 'hr_history_kind_check';
  if position('employee_reprimand' in def) = 0 or position('employee_positive_observation' in def) = 0 then
    raise exception '247: hr_history_kind_check incompleto';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('247_operaciones_de_almacen.sql', '27413f2140737b337b7e453127ac53e1b152b6a6368eb81ceb0b7226ae8b7ca1') on conflict (name) do nothing;
