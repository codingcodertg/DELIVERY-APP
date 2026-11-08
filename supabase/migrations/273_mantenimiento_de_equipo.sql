-- 273: Mantenimiento: inventario de equipo, lista diaria, refacciones y bitacora de uso (Warehouse Ops) (2026-11-08).
--
-- El dueño y Roberto (gerente de almacen), 2026-11-08: fase 1 de los KPI de almacen. Hasta hoy «Mantenimiento» era
-- un reporte de cuatro pasos (warehouse_reports.kind = 'maintenance') con el equipo fijo en codigo (Montacargas #1,
-- #2, patin, otro). Desde esta migracion cada tienda tiene su inventario de equipo, su lista diaria por equipo, sus
-- refacciones / herramientas y quien esta usando cada equipo. El reporte de mantenimiento sigue igual; la pantalla
-- le ofrece el equipo de la tienda cuando lo hay.
--
-- Que hace:
--   1. Tablas (todas con RLS de lectura para quien tiene Warehouse Ops EN ESA TIENDA, sin politicas de escritura):
--        public.warehouse_equipment        el equipo: tienda, clase (forklift / pallet_jack / electric_jack / other),
--                                          nombre, marca, modelo, serie, año, estado (in_service / needs_repair /
--                                          out_of_service), horometro, notas, fotos (rutas en el cubo 'warehouse-ops'),
--                                          activo, quien lo creo / edito.
--        public.warehouse_checklists       la lista diaria: equipo, quien, cuando, dia de turno, puntos (jsonb:
--                                          [{id, result: ok|fail|na, note}]), resultado (ok / fail), horometro, fotos.
--        public.warehouse_parts            refacciones, herramientas y consumibles: tienda, equipo (opcional), nombre,
--                                          clase (part / tool / consumable), existencia, minimo, estado (ok / needed /
--                                          ordered / received), quien la pidio y cuando, notas.
--        public.warehouse_equipment_usage  quien usa cada equipo: inicio, fin (nulo mientras lo tiene), horometro al
--                                          empezar y al terminar, notas. UN solo uso abierto por equipo (indice unico).
--   2. public.warehouse_ops_in_store(tienda): ¿tiene nivel en la app (265) y esa tienda es suya (o es admin)? Es la
--      puerta de lectura de las cuatro tablas y de lo que hace el personal (lista diaria, uso, pedir refaccion).
--      La gestion (alta / edicion de equipo, refacciones a pedidas / recibidas) es warehouse_ops_can_manage (265):
--      gerente / supervisor full de la tienda, store_admin en las suyas, admin.
--   3. RPC (security definer, mismas puertas que la merma):
--        warehouse_ops_save_equipment(...)     gestor: alta o edicion de un equipo (p_id nulo = alta).
--        warehouse_ops_file_checklist(...)     personal: guarda la lista diaria. Cada punto es ok / fail / na; un
--                                              fail exige nota. Si algo fallo, el resultado es 'fail' y el equipo pasa
--                                              a needs_repair (si estaba in_service). Guarda el horometro en el equipo
--                                              si vino. Una lista por equipo y dia por persona (se puede repetir si otra
--                                              persona la hace; la KPI cuenta equipo+dia distintos).
--        warehouse_ops_request_part(...)       personal: marca «se necesita» una refaccion (nueva o existente) con nota.
--        warehouse_ops_save_part(...)          gestor: alta / edicion completa, incluido el estado (ok -> needed ->
--                                              ordered -> received -> ok, o needed directo desde cualquier estado).
--        warehouse_ops_start_usage(...)        personal: «empiezo a usarlo»; falla si otro lo tiene o esta fuera de servicio.
--        warehouse_ops_stop_usage(...)         el mismo usuario (o un gestor) lo cierra.
--   4. El cubo 'warehouse-ops' deja ver las fotos del equipo y de las listas a quien ve la fila (la politica de lectura
--      suma las dos tablas; la de escritura no cambia: cada quien sube a su carpeta).
--
-- ORDEN: aplicar ANTES de desplegar la pantalla; sin esta migracion la seccion «Mantenimiento» dice que falta la 273
-- y el reporte de mantenimiento sigue con el equipo fijo. Depende de la 265 (warehouse_ops_level_of,
-- warehouse_ops_can_manage) y de la 247 (cubo).
--
-- Sin begin/commit propios. Para deshacer:
--   drop function if exists public.warehouse_ops_stop_usage(uuid, numeric, text);
--   drop function if exists public.warehouse_ops_start_usage(uuid, numeric);
--   drop function if exists public.warehouse_ops_save_part(uuid, text, uuid, text, text, numeric, numeric, text, text);
--   drop function if exists public.warehouse_ops_request_part(uuid, text, uuid, text, text, text);
--   drop function if exists public.warehouse_ops_file_checklist(uuid, date, jsonb, numeric, text[]);
--   drop function if exists public.warehouse_ops_save_equipment(uuid, text, text, text, text, text, text, int, text, numeric, text, text[], boolean);
--   drop table if exists public.warehouse_equipment_usage; drop table if exists public.warehouse_parts;
--   drop table if exists public.warehouse_checklists; drop table if exists public.warehouse_equipment;
--   drop function if exists public.warehouse_ops_in_store(text);
--   volver a crear la politica "warehouse ops bucket read" como en la 270;
--   delete from public.schema_migrations where name = '273_mantenimiento_de_equipo.sql';

-- ---------------------------------------------------------------------------
-- 1. La puerta de lectura: nivel en la app y la tienda es suya (o admin)
-- ---------------------------------------------------------------------------
create or replace function public.warehouse_ops_in_store(r_store text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select n.nivel = 'admin'
        or (n.nivel <> '' and (p.store = r_store or r_store = any(coalesce(p.visible_stores, '{}'))))
    from public.profiles p
      cross join lateral (select coalesce(public.warehouse_ops_level_of(p.id), '') as nivel) n
    where p.id = auth.uid()
  ), false);
$$;
revoke all on function public.warehouse_ops_in_store(text) from public, anon;
grant execute on function public.warehouse_ops_in_store(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Las tablas
-- ---------------------------------------------------------------------------
create table if not exists public.warehouse_equipment (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  kind text not null check (kind in ('forklift', 'pallet_jack', 'electric_jack', 'other')),
  name text not null check (btrim(name) <> ''),
  brand text,
  model text,
  serial text,
  year int check (year is null or year between 1950 and 2100),
  status text not null default 'in_service' check (status in ('in_service', 'needs_repair', 'out_of_service')),
  hour_meter numeric(10,1) check (hour_meter is null or hour_meter >= 0),
  notes text,
  photos text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists warehouse_equipment_store on public.warehouse_equipment (store, active, name);

create table if not exists public.warehouse_checklists (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.warehouse_equipment(id) on delete cascade,
  store text not null,
  done_by uuid not null references auth.users(id) on delete cascade,
  done_by_name text,
  done_at timestamptz not null default now(),
  shift_date date not null,
  items jsonb not null default '[]'::jsonb,
  result text not null check (result in ('ok', 'fail')),
  failed_items text[] not null default '{}',
  hour_meter numeric(10,1) check (hour_meter is null or hour_meter >= 0),
  photos text[] not null default '{}'
);
create index if not exists warehouse_checklists_equipment_day on public.warehouse_checklists (equipment_id, shift_date desc);
create index if not exists warehouse_checklists_store_day on public.warehouse_checklists (store, shift_date desc);

create table if not exists public.warehouse_parts (
  id uuid primary key default gen_random_uuid(),
  store text not null,
  equipment_id uuid references public.warehouse_equipment(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  kind text not null default 'part' check (kind in ('part', 'tool', 'consumable')),
  qty_on_hand numeric(10,2) not null default 0 check (qty_on_hand >= 0),
  min_qty numeric(10,2) not null default 0 check (min_qty >= 0),
  status text not null default 'ok' check (status in ('ok', 'needed', 'ordered', 'received')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_name text,
  requested_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists warehouse_parts_store_status on public.warehouse_parts (store, status, name);

create table if not exists public.warehouse_equipment_usage (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.warehouse_equipment(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  hour_meter_start numeric(10,1) check (hour_meter_start is null or hour_meter_start >= 0),
  hour_meter_end numeric(10,1) check (hour_meter_end is null or hour_meter_end >= 0),
  notes text,
  check (ended_at is null or ended_at >= started_at)
);
-- Un solo uso abierto por equipo.
create unique index if not exists warehouse_equipment_usage_open on public.warehouse_equipment_usage (equipment_id) where ended_at is null;
create index if not exists warehouse_equipment_usage_equipment on public.warehouse_equipment_usage (equipment_id, started_at desc);

-- RLS: lectura para quien tiene la app en esa tienda; nada de escritura directa (todo por RPC).
alter table public.warehouse_equipment enable row level security;
alter table public.warehouse_checklists enable row level security;
alter table public.warehouse_parts enable row level security;
alter table public.warehouse_equipment_usage enable row level security;
drop policy if exists warehouse_equipment_read on public.warehouse_equipment;
create policy warehouse_equipment_read on public.warehouse_equipment for select to authenticated using (public.warehouse_ops_in_store(store));
drop policy if exists warehouse_checklists_read on public.warehouse_checklists;
create policy warehouse_checklists_read on public.warehouse_checklists for select to authenticated using (public.warehouse_ops_in_store(store));
drop policy if exists warehouse_parts_read on public.warehouse_parts;
create policy warehouse_parts_read on public.warehouse_parts for select to authenticated using (public.warehouse_ops_in_store(store));
drop policy if exists warehouse_equipment_usage_read on public.warehouse_equipment_usage;
create policy warehouse_equipment_usage_read on public.warehouse_equipment_usage for select to authenticated
  using (exists (select 1 from public.warehouse_equipment e where e.id = equipment_id and public.warehouse_ops_in_store(e.store)));
revoke all on public.warehouse_equipment, public.warehouse_checklists, public.warehouse_parts, public.warehouse_equipment_usage from anon;
grant select on public.warehouse_equipment, public.warehouse_checklists, public.warehouse_parts, public.warehouse_equipment_usage to authenticated;
grant all on public.warehouse_equipment, public.warehouse_checklists, public.warehouse_parts, public.warehouse_equipment_usage to service_role;

-- ---------------------------------------------------------------------------
-- 3. Las RPC
-- ---------------------------------------------------------------------------
-- El nombre de quien llama, para no hacer un join a profiles desde la pantalla.
create or replace function public.warehouse_ops_caller_name()
  returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(coalesce(full_name, '')), '') from public.profiles where id = auth.uid();
$$;
revoke all on function public.warehouse_ops_caller_name() from public, anon, authenticated;

-- 3a. Equipo: alta o edicion (gestor)
create or replace function public.warehouse_ops_save_equipment(
  p_id uuid, p_store text, p_kind text, p_name text, p_brand text, p_model text, p_serial text, p_year int,
  p_status text, p_hour_meter numeric, p_notes text, p_photos text[], p_active boolean)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); r record; nuevo uuid; f text;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  if p_store is null or btrim(p_store) = '' then raise exception 'warehouse_ops: falta la tienda' using errcode = '22023'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'warehouse_ops: falta el nombre del equipo' using errcode = '22023'; end if;
  if not public.warehouse_ops_can_manage(p_store) then
    raise exception 'warehouse_ops: solo el gerente de la tienda da de alta o edita el equipo' using errcode = '42501';
  end if;
  -- Las fotos son de la carpeta de quien llama (la misma regla que la merma).
  foreach f in array coalesce(p_photos, '{}') loop
    if split_part(f, '/', 1) <> yo::text and not exists (select 1 from public.warehouse_equipment e where e.id = p_id and f = any(e.photos)) then
      raise exception 'warehouse_ops: foto no valida' using errcode = '22023';
    end if;
  end loop;
  if p_id is null then
    insert into public.warehouse_equipment (store, kind, name, brand, model, serial, year, status, hour_meter, notes, photos, active, created_by, updated_by)
    values (btrim(p_store), p_kind, btrim(p_name), nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''), nullif(btrim(p_serial), ''), p_year,
            coalesce(p_status, 'in_service'), p_hour_meter, nullif(btrim(p_notes), ''), coalesce(p_photos, '{}'), coalesce(p_active, true), yo, yo)
    returning id into nuevo;
    return nuevo;
  end if;
  select * into r from public.warehouse_equipment where id = p_id;
  if r.id is null then raise exception 'warehouse_ops: equipo desconocido'; end if;
  -- No se cambia de tienda a un equipo con historial: la lista diaria y los usos llevan la tienda.
  if r.store <> btrim(p_store) then raise exception 'warehouse_ops: el equipo no cambia de tienda' using errcode = '22023'; end if;
  update public.warehouse_equipment set
    kind = p_kind, name = btrim(p_name), brand = nullif(btrim(p_brand), ''), model = nullif(btrim(p_model), ''), serial = nullif(btrim(p_serial), ''),
    year = p_year, status = coalesce(p_status, status), hour_meter = p_hour_meter, notes = nullif(btrim(p_notes), ''),
    photos = coalesce(p_photos, '{}'), active = coalesce(p_active, active), updated_by = yo, updated_at = now()
  where id = p_id;
  return p_id;
end $$;
revoke all on function public.warehouse_ops_save_equipment(uuid, text, text, text, text, text, text, int, text, numeric, text, text[], boolean) from public, anon;
grant execute on function public.warehouse_ops_save_equipment(uuid, text, text, text, text, text, text, int, text, numeric, text, text[], boolean) to authenticated;

-- 3b. La lista diaria (personal de la tienda)
create or replace function public.warehouse_ops_file_checklist(p_equipment uuid, p_shift_date date, p_items jsonb, p_hour_meter numeric, p_photos text[])
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  yo uuid := auth.uid(); e record; it jsonb; fallos text[] := '{}'; n int := 0; nuevo uuid; f text;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into e from public.warehouse_equipment where id = p_equipment;
  if e.id is null then raise exception 'warehouse_ops: equipo desconocido'; end if;
  if not public.warehouse_ops_in_store(e.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if not e.active then raise exception 'warehouse_ops: el equipo esta dado de baja' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'warehouse_ops: la lista no tiene puntos' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it->>'id', '') = '' or coalesce(it->>'result', '') not in ('ok', 'fail', 'na') then
      raise exception 'warehouse_ops: punto de la lista no valido' using errcode = '22023';
    end if;
    if it->>'result' = 'fail' then
      if coalesce(btrim(it->>'note'), '') = '' then
        raise exception 'warehouse_ops: un punto que fallo necesita una nota' using errcode = '22023';
      end if;
      fallos := fallos || (it->>'id');
    end if;
    n := n + 1;
  end loop;
  foreach f in array coalesce(p_photos, '{}') loop
    if split_part(f, '/', 1) <> yo::text then raise exception 'warehouse_ops: foto no valida' using errcode = '22023'; end if;
  end loop;
  insert into public.warehouse_checklists (equipment_id, store, done_by, done_by_name, shift_date, items, result, failed_items, hour_meter, photos)
  values (e.id, e.store, yo, public.warehouse_ops_caller_name(), coalesce(p_shift_date, current_date), p_items,
          case when cardinality(fallos) > 0 then 'fail' else 'ok' end, fallos, p_hour_meter, coalesce(p_photos, '{}'))
  returning id into nuevo;
  -- Un fallo marca el equipo como «necesita reparacion» (si estaba en servicio); el horometro leido se guarda en el equipo.
  update public.warehouse_equipment set
    status = case when cardinality(fallos) > 0 and status = 'in_service' then 'needs_repair' else status end,
    hour_meter = case when p_hour_meter is not null and p_hour_meter >= coalesce(hour_meter, 0) then p_hour_meter else hour_meter end,
    updated_by = yo, updated_at = now()
  where id = e.id;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_file_checklist(uuid, date, jsonb, numeric, text[]) from public, anon;
grant execute on function public.warehouse_ops_file_checklist(uuid, date, jsonb, numeric, text[]) to authenticated;

-- 3c. Pedir una refaccion (personal): nueva, o una existente pasa a «se necesita»
create or replace function public.warehouse_ops_request_part(p_id uuid, p_store text, p_equipment uuid, p_name text, p_kind text, p_note text)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); r record; nuevo uuid; tienda text;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  if p_id is not null then
    select * into r from public.warehouse_parts where id = p_id;
    if r.id is null then raise exception 'warehouse_ops: refaccion desconocida'; end if;
    if not public.warehouse_ops_in_store(r.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
    update public.warehouse_parts set status = 'needed', requested_by = yo, requested_by_name = public.warehouse_ops_caller_name(), requested_at = now(),
      notes = case when nullif(btrim(p_note), '') is null then notes else nullif(btrim(p_note), '') end, updated_by = yo, updated_at = now()
    where id = p_id;
    return p_id;
  end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'warehouse_ops: falta el nombre' using errcode = '22023'; end if;
  tienda := btrim(coalesce(p_store, ''));
  if p_equipment is not null then
    select store into tienda from public.warehouse_equipment where id = p_equipment;
    if tienda is null then raise exception 'warehouse_ops: equipo desconocido'; end if;
  end if;
  if tienda = '' then raise exception 'warehouse_ops: falta la tienda' using errcode = '22023'; end if;
  if not public.warehouse_ops_in_store(tienda) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  insert into public.warehouse_parts (store, equipment_id, name, kind, status, requested_by, requested_by_name, requested_at, notes, updated_by)
  values (tienda, p_equipment, btrim(p_name), coalesce(p_kind, 'part'), 'needed', yo, public.warehouse_ops_caller_name(), now(), nullif(btrim(p_note), ''), yo)
  returning id into nuevo;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_request_part(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.warehouse_ops_request_part(uuid, text, uuid, text, text, text) to authenticated;

-- 3d. Refaccion completa (gestor): alta / edicion / cambio de estado
create or replace function public.warehouse_ops_save_part(
  p_id uuid, p_store text, p_equipment uuid, p_name text, p_kind text, p_qty_on_hand numeric, p_min_qty numeric, p_status text, p_notes text)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); r record; nuevo uuid; tienda text := btrim(coalesce(p_store, ''));
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'warehouse_ops: falta el nombre' using errcode = '22023'; end if;
  if p_id is not null then
    select * into r from public.warehouse_parts where id = p_id;
    if r.id is null then raise exception 'warehouse_ops: refaccion desconocida'; end if;
    tienda := r.store;
  end if;
  if tienda = '' then raise exception 'warehouse_ops: falta la tienda' using errcode = '22023'; end if;
  if not public.warehouse_ops_can_manage(tienda) then
    raise exception 'warehouse_ops: solo el gerente de la tienda edita las refacciones' using errcode = '42501';
  end if;
  if p_equipment is not null and not exists (select 1 from public.warehouse_equipment e where e.id = p_equipment and e.store = tienda) then
    raise exception 'warehouse_ops: el equipo no es de esa tienda' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.warehouse_parts (store, equipment_id, name, kind, qty_on_hand, min_qty, status, notes, updated_by,
                                        requested_by, requested_by_name, requested_at)
    values (tienda, p_equipment, btrim(p_name), coalesce(p_kind, 'part'), coalesce(p_qty_on_hand, 0), coalesce(p_min_qty, 0), coalesce(p_status, 'ok'),
            nullif(btrim(p_notes), ''), yo,
            case when coalesce(p_status, 'ok') = 'needed' then yo end, case when coalesce(p_status, 'ok') = 'needed' then public.warehouse_ops_caller_name() end,
            case when coalesce(p_status, 'ok') = 'needed' then now() end)
    returning id into nuevo;
    return nuevo;
  end if;
  update public.warehouse_parts set
    equipment_id = p_equipment, name = btrim(p_name), kind = coalesce(p_kind, kind), qty_on_hand = coalesce(p_qty_on_hand, qty_on_hand),
    min_qty = coalesce(p_min_qty, min_qty), status = coalesce(p_status, status), notes = nullif(btrim(p_notes), ''),
    requested_by = case when coalesce(p_status, status) = 'needed' and status <> 'needed' then yo else requested_by end,
    requested_by_name = case when coalesce(p_status, status) = 'needed' and status <> 'needed' then public.warehouse_ops_caller_name() else requested_by_name end,
    requested_at = case when coalesce(p_status, status) = 'needed' and status <> 'needed' then now() else requested_at end,
    updated_by = yo, updated_at = now()
  where id = p_id;
  return p_id;
end $$;
revoke all on function public.warehouse_ops_save_part(uuid, text, uuid, text, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.warehouse_ops_save_part(uuid, text, uuid, text, text, numeric, numeric, text, text) to authenticated;

-- 3e. Empezar a usar un equipo (personal)
create or replace function public.warehouse_ops_start_usage(p_equipment uuid, p_hour_meter numeric)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); e record; nuevo uuid;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into e from public.warehouse_equipment where id = p_equipment for update;
  if e.id is null then raise exception 'warehouse_ops: equipo desconocido'; end if;
  if not public.warehouse_ops_in_store(e.store) then raise exception 'warehouse_ops: sin acceso a esa tienda' using errcode = '42501'; end if;
  if not e.active or e.status = 'out_of_service' then
    raise exception 'warehouse_ops: el equipo esta fuera de servicio' using errcode = '22023';
  end if;
  if exists (select 1 from public.warehouse_equipment_usage u where u.equipment_id = e.id and u.ended_at is null) then
    raise exception 'warehouse_ops: alguien mas lo esta usando' using errcode = '23505';
  end if;
  insert into public.warehouse_equipment_usage (equipment_id, user_id, user_name, hour_meter_start)
  values (e.id, yo, public.warehouse_ops_caller_name(), p_hour_meter) returning id into nuevo;
  return nuevo;
end $$;
revoke all on function public.warehouse_ops_start_usage(uuid, numeric) from public, anon;
grant execute on function public.warehouse_ops_start_usage(uuid, numeric) to authenticated;

-- 3f. Dejar de usarlo (quien lo abrio, o un gestor de la tienda)
create or replace function public.warehouse_ops_stop_usage(p_usage uuid, p_hour_meter numeric, p_notes text)
  returns void language plpgsql volatile security definer set search_path = public as $$
declare yo uuid := auth.uid(); u record; tienda text;
begin
  if yo is null then raise exception 'warehouse_ops: sin sesion' using errcode = '42501'; end if;
  select * into u from public.warehouse_equipment_usage where id = p_usage;
  if u.id is null then raise exception 'warehouse_ops: uso desconocido'; end if;
  if u.ended_at is not null then raise exception 'warehouse_ops: ese uso ya se cerro' using errcode = '22023'; end if;
  select store into tienda from public.warehouse_equipment where id = u.equipment_id;
  if u.user_id <> yo and not public.warehouse_ops_can_manage(tienda) then
    raise exception 'warehouse_ops: solo quien lo abrio (o el gerente) lo cierra' using errcode = '42501';
  end if;
  update public.warehouse_equipment_usage set ended_at = now(), hour_meter_end = p_hour_meter, notes = nullif(btrim(p_notes), '') where id = p_usage;
  update public.warehouse_equipment set
    hour_meter = case when p_hour_meter is not null and p_hour_meter >= coalesce(hour_meter, 0) then p_hour_meter else hour_meter end,
    updated_at = now()
  where id = u.equipment_id;
end $$;
revoke all on function public.warehouse_ops_stop_usage(uuid, numeric, text) from public, anon;
grant execute on function public.warehouse_ops_stop_usage(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El cubo: las fotos del equipo y de las listas se ven como las del reporte
-- ---------------------------------------------------------------------------
drop policy if exists "warehouse ops bucket read" on storage.objects;
create policy "warehouse ops bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-ops' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.warehouse_reports r where name = any(r.photos) or name = r.approval_sheet or name = r.adjustment_proof)
    or exists (select 1 from public.warehouse_equipment e where name = any(e.photos))
    or exists (select 1 from public.warehouse_checklists c where name = any(c.photos))
  ));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text; tbl text;
begin
  foreach tbl in array array['warehouse_equipment', 'warehouse_checklists', 'warehouse_parts', 'warehouse_equipment_usage'] loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = tbl and rowsecurity) then
      raise exception '273: % no existe o no tiene RLS', tbl;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and cmd <> 'SELECT') then
      raise exception '273: % no debe tener politicas de escritura', tbl;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = tbl and cmd = 'SELECT' and qual like '%warehouse_ops_in_store%') then
      raise exception '273: la lectura de % no pasa por warehouse_ops_in_store', tbl;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'warehouse_equipment_usage_open' and indexdef like '%UNIQUE%' and indexdef like '%ended_at IS NULL%') then
    raise exception '273: falta el indice de un solo uso abierto por equipo';
  end if;
  foreach f in array array[
    'public.warehouse_ops_save_equipment(uuid, text, text, text, text, text, text, int, text, numeric, text, text[], boolean)',
    'public.warehouse_ops_file_checklist(uuid, date, jsonb, numeric, text[])',
    'public.warehouse_ops_request_part(uuid, text, uuid, text, text, text)',
    'public.warehouse_ops_save_part(uuid, text, uuid, text, text, numeric, numeric, text, text)',
    'public.warehouse_ops_start_usage(uuid, numeric)',
    'public.warehouse_ops_stop_usage(uuid, numeric, text)',
    'public.warehouse_ops_in_store(text)', 'public.warehouse_ops_caller_name()'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception '273: anon ejecuta %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.warehouse_ops_caller_name()', 'execute') then raise exception '273: caller_name no es para la app'; end if;
  f := pg_get_functiondef('public.warehouse_ops_save_equipment(uuid, text, text, text, text, text, text, int, text, numeric, text, text[], boolean)'::regprocedure);
  if position('warehouse_ops_can_manage(p_store)' in f) = 0 then raise exception '273: save_equipment no pasa por can_manage'; end if;
  f := pg_get_functiondef('public.warehouse_ops_save_part(uuid, text, uuid, text, text, numeric, numeric, text, text)'::regprocedure);
  if position('warehouse_ops_can_manage(tienda)' in f) = 0 then raise exception '273: save_part no pasa por can_manage'; end if;
  f := pg_get_functiondef('public.warehouse_ops_file_checklist(uuid, date, jsonb, numeric, text[])'::regprocedure);
  if position('warehouse_ops_in_store(e.store)' in f) = 0 or position('necesita una nota' in f) = 0 or position('''needs_repair''' in f) = 0 then
    raise exception '273: file_checklist no usa las puertas (tienda, nota al fallar, needs_repair)';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_start_usage(uuid, numeric)'::regprocedure);
  if position('warehouse_ops_in_store(e.store)' in f) = 0 or position('alguien mas lo esta usando' in f) = 0 then
    raise exception '273: start_usage no usa las puertas';
  end if;
  f := pg_get_functiondef('public.warehouse_ops_stop_usage(uuid, numeric, text)'::regprocedure);
  if position('u.user_id <> yo and not public.warehouse_ops_can_manage(tienda)' in f) = 0 then raise exception '273: stop_usage: lo cierra quien lo abrio o el gerente'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'warehouse ops bucket read' and qual like '%warehouse_equipment%' and qual like '%warehouse_checklists%') then
    raise exception '273: la lectura del cubo no deja ver las fotos del equipo y de las listas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('273_mantenimiento_de_equipo.sql', 'b81a9a8555b9bfae0a16ea018c86a28f309df3cb6e14396f6e4e47f61f185ba8') on conflict (name) do nothing;
