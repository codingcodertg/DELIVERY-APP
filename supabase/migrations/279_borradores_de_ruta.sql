-- 279 · Borradores de ruta: versiones nombradas (Opción 1/2/3) de las rutas de un día, para comparar y cambiar
--
-- El dueño (9 nov): poder guardar varias versiones de las rutas de un día y cargar la que quiera. Hoy el planificador
-- solo arma UN borrador temporal; al publicar o recargar se pierde. Esta tabla guarda cada versión con su nombre y una
-- foto de a qué chofer y en qué orden va cada parada (`payload`: [{id, assigned_driver, route_seq}]). Cargar un borrador
-- es escribir esa foto de vuelta en `deliveries` (lo hace la acción del servidor con la sesión de quien carga, así que
-- pasa por la RLS y el guard de siempre). La tabla NO toca `deliveries`: solo guarda y lee la foto.
--
-- SOLO ADMIN Y LOGÍSTICA, leer y escribir (como quien publica rutas, decisión de la 128). Nadie más.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero.

create table if not exists public.route_drafts (
  id              uuid primary key default gen_random_uuid(),
  day             date not null,
  name            text not null,
  payload         jsonb not null default '[]'::jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint route_drafts_name_not_blank check (btrim(name) <> ''),
  constraint route_drafts_name_len check (length(name) <= 60)
);

comment on table public.route_drafts is
  'Borradores nombrados de las rutas de un día (279): foto de chofer+orden por parada. Solo admin y logística.';

create index if not exists route_drafts_day_idx on public.route_drafts (day);

-- ---------------------------------------------------------------------------
-- Quién lee y quién escribe: solo admin y logística, y con acceso al módulo de Entregas (083).
-- Una política POR COMANDO y ninguna FOR ALL (la misma forma que driver_settings, 128).
-- ---------------------------------------------------------------------------
alter table public.route_drafts enable row level security;

-- En Supabase los privilegios por defecto de `public` dan todo a anon/authenticated sobre una tabla nueva; el revoke va primero.
revoke all on public.route_drafts from anon, authenticated;
grant select, insert, update, delete on public.route_drafts to authenticated;

drop policy if exists "route_drafts select" on public.route_drafts;
drop policy if exists "route_drafts insert" on public.route_drafts;
drop policy if exists "route_drafts update" on public.route_drafts;
drop policy if exists "route_drafts delete" on public.route_drafts;

create policy "route_drafts select" on public.route_drafts for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_drafts insert" on public.route_drafts for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_drafts update" on public.route_drafts for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_drafts delete" on public.route_drafts for delete to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

-- ===========================================================================
-- Autocomprobación
-- ===========================================================================
do $chk$
declare n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.route_drafts'::regclass) then
    raise exception '279: route_drafts quedó sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_drafts';
  if n <> 4 then raise exception '279: route_drafts tiene % políticas, se esperaban 4', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_drafts' and cmd = 'ALL';
  if n <> 0 then raise exception '279: hay % políticas FOR ALL', n; end if;
  select count(distinct cmd) into n from pg_policies where schemaname = 'public' and tablename = 'route_drafts';
  if n <> 4 then raise exception '279: las políticas no cubren los cuatro comandos (cubren %)', n; end if;
  if has_table_privilege('anon', 'public.route_drafts', 'SELECT')
     or has_table_privilege('anon', 'public.route_drafts', 'INSERT') then
    raise exception '279: permisos de más sobre route_drafts';
  end if;
end $chk$;

-- ===========================================================================
-- Reversión
--   drop table if exists public.route_drafts;   -- se lleva políticas e índice
--   delete from public.schema_migrations where name = '279_borradores_de_ruta.sql';
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('279_borradores_de_ruta.sql', '67fa25ab6dbc94e7201b61b9ce5c73faa649e80558420d63f3b36de1fe6022ba') on conflict (name) do nothing;
