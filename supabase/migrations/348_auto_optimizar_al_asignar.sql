-- 348 - Auto-optimizar al asignar: la parada que alguien coloco a mano y el estado de la auto-optimizacion por ruta
-- ===========================================================================
-- Hoy, cuando alguien asigna ordenes a un chofer en el Gestor, la ruta queda con el orden que tenia y la
-- optimizacion es un boton aparte («Optimizar»). Se quiere que, tras una asignacion, la ruta se reacomode sola,
-- SIN pisar las paradas que una persona puso a mano. Para eso hacen falta dos cosas que hoy no existen:
--
--   1. Saber que una parada la coloco una persona: `deliveries.route_fixed`. La auto-optimizacion no la mueve.
--      Lo quita el boton «Optimizar», que rehace toda la ruta (y avisa antes de pisarlas).
--   2. Saber, por ruta y dia, si la auto-optimizacion esta pendiente, hecha o fallo, y con que huella de la ruta
--      (`route_auto_state`). Sin esto, un fallo de red de la consulta de tiempos no deja rastro y no se reintenta.
--
-- Que trae, y SOLO esto:
--   · Una columna nueva en deliveries: route_fixed boolean not null default false. No toca ninguna otra columna.
--   · Una tabla nueva, public.route_auto_state, con clave (plan_date, lane), igual que route_locks (149).
--   · Sus politicas de acceso son las de route_locks: quien lee y quien escribe (ver mas abajo). Como aqui se
--     ACTUALIZA la misma fila (la app hace upsert de estado, huella e intentos), hay ademas una politica de UPDATE
--     con los mismos roles que la de INSERT. No hay DELETE: las filas no se borran.
--
-- Lo que NO hace, a proposito:
--   · No toca load_auto (sigue como esta; nadie lo lee ni lo escribe en los movimientos manuales).
--   · No reescribe la guarda de etapas (guard_delivery_stage, 346): ver el informe de la rama. Un UPDATE que cambia
--     SOLO route_fixed (y route_seq / pickup_seq) lo deja pasar hoy para admin, logistica y gerente, con la misma
--     regla que ya usa el reparto de paradas (route_seq).
--   · No se aplica. Esta migracion se escribe y se queda sin aplicar hasta que el dueno lo diga; la app detecta
--     la columna y la tabla (`hayAutoOptimizar`) y, sin ellas, se comporta como hoy.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion (ver 149 y 124).
-- Idempotente: todo va con `if not exists` / `drop ... if exists`.
--
-- Como deshacer (a mano, en una transaccion propia):
--   drop table if exists public.route_auto_state;             -- se lleva politicas, restricciones y disparador
--   drop function if exists public.route_auto_state_stamp();
--   alter table public.deliveries drop column if exists route_fixed;   -- pierde las paradas fijadas a mano
--   delete from public.schema_migrations where name = '348_auto_optimizar_al_asignar.sql';
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Parada colocada a mano
-- ---------------------------------------------------------------------------
alter table public.deliveries add column if not exists route_fixed boolean not null default false;

comment on column public.deliveries.route_fixed is
  'true = una persona coloco esta parada a mano; la auto-optimizacion no la mueve. Lo quita el boton Optimizar (rehace toda la ruta). (348)';

-- ---------------------------------------------------------------------------
-- 2. Estado de la auto-optimizacion por ruta y dia
-- ---------------------------------------------------------------------------
create table if not exists public.route_auto_state (
  plan_date   date not null,
  lane        text not null,
  estado      text not null check (estado in ('pendiente', 'hecha', 'fallo')),
  huella      text,
  intentos    integer not null default 0,
  nota        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  constraint route_auto_state_pkey primary key (plan_date, lane),
  constraint route_auto_state_lane_not_blank check (btrim(lane) <> '' and char_length(lane) <= 200),
  constraint route_auto_state_intentos_no_negativos check (intentos >= 0)
);

comment on table public.route_auto_state is
  'Estado de la auto-optimizacion al asignar, por ruta y dia (348): pendiente / hecha / fallo, con la huella de la ruta. lane = nombre del chofer o de la ruta temporal, como route_locks.';

-- updated_at y updated_by los pone la base, no el navegador. Sin sesion (psql, llave de servicio) se deja como venga.
create or replace function public.route_auto_state_stamp()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.updated_at := now();
  if auth.uid() is not null then NEW.updated_by := auth.uid(); end if;
  return NEW;
end $$;

revoke execute on function public.route_auto_state_stamp() from public, anon, authenticated;

drop trigger if exists route_auto_state_stamp on public.route_auto_state;
create trigger route_auto_state_stamp
  before insert or update on public.route_auto_state
  for each row execute function public.route_auto_state_stamp();

-- ---------------------------------------------------------------------------
-- Quien lee y quien escribe (los mismos roles que route_locks, 149)
-- ---------------------------------------------------------------------------
alter table public.route_auto_state enable row level security;

-- El revoke va primero: en Supabase los privilegios por defecto dan TODO a anon y authenticated sobre cada
-- tabla nueva, y un grant a secas no quita nada (medido al ensayar la 126).
revoke all on public.route_auto_state from anon, authenticated;
grant select, insert, update on public.route_auto_state to authenticated;

drop policy if exists "route_auto_state select" on public.route_auto_state;
drop policy if exists "route_auto_state insert" on public.route_auto_state;
drop policy if exists "route_auto_state update" on public.route_auto_state;

-- Igual que route_locks (149): leen los roles que ven el plan; escriben admin y logistica.
create policy "route_auto_state select" on public.route_auto_state for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting', 'warehouse'));

create policy "route_auto_state insert" on public.route_auto_state for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_auto_state update" on public.route_auto_state for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries' and column_name = 'route_fixed'
                    and is_nullable = 'NO' and column_default like 'false%') then
    raise exception '348: deliveries.route_fixed no esta o no es boolean not null default false';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.route_auto_state'::regclass) then
    raise exception '348: route_auto_state quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_auto_state';
  if n <> 3 then raise exception '348: route_auto_state tiene % politicas, se esperaban 3', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_auto_state' and cmd = 'ALL';
  if n <> 0 then raise exception '348: hay % politicas FOR ALL', n; end if;

  if has_table_privilege('anon', 'public.route_auto_state', 'SELECT')
     or has_table_privilege('anon', 'public.route_auto_state', 'INSERT')
     or has_table_privilege('authenticated', 'public.route_auto_state', 'DELETE')
     or has_table_privilege('authenticated', 'public.route_auto_state', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.route_auto_state', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.route_auto_state', 'TRIGGER') then
    raise exception '348: permisos de mas sobre route_auto_state';
  end if;
  if not has_table_privilege('authenticated', 'public.route_auto_state', 'SELECT')
     or not has_table_privilege('authenticated', 'public.route_auto_state', 'INSERT')
     or not has_table_privilege('authenticated', 'public.route_auto_state', 'UPDATE') then
    raise exception '348: a authenticated le faltan permisos sobre route_auto_state';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.route_auto_state'::regclass
                  and tgname = 'route_auto_state_stamp' and not tgisinternal) then
    raise exception '348: falta el disparador route_auto_state_stamp';
  end if;
end $comprueba$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('348_auto_optimizar_al_asignar.sql', '80bad19cef49b2ddbdc1ffa96c2a8c73c78d68b1fcecb843ea2bac4a8c8a562a') on conflict (name) do nothing;
