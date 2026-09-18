-- 128 · Lo que el motor de rutas necesita saber de cada chofer: base, camion y turno (rama motor-rutas-modelo)
--
-- El dueno pidio un motor que reparta las ordenes del dia entre los choferes. Para eso hace falta saber de
-- donde sale cada uno, cuanto le cabe y a que hora trabaja, y nada de eso estaba guardado: la base se
-- deducia en caliente (la recogida mas repetida, luego la tienda de la orden, luego la del chofer), la
-- capacidad colgaba del NOMBRE del chofer dentro de `settings.driver_capacity`, y el turno eran dos
-- constantes (08:00 en el Gestor de Rutas, 08:30 en las reglas de agenda). El diseno y las decisiones
-- estan en docs/route-algorithm-design.md (seccion 11) y en la entrada de la rama en DECISIONS.md.
--
-- POR `profile_id`, NO POR NOMBRE. `deliveries.assigned_driver` es el nombre del chofer y de el cuelgan
-- lo que el chofer ve (RLS de lectura, vigente la de la 131), su color y su capacidad de hoy. Esta migracion NO toca nada de
-- eso: la columna, la politica y `settings.driver_capacity` se quedan como estan. El motor trabajara por
-- id y seguira escribiendo el nombre al publicar. Pasar `assigned_driver` a uuid es otra migracion, mas
-- delicada, que este motor no necesita.
--
-- LA BASE ES EL NOMBRE DE UNA TIENDA de `settings.stores`, no una direccion suelta: el dueno dijo «cada
-- chofer su tienda», y las tiendas ya tienen su punto. Que el nombre exista en Ajustes lo comprueba la
-- pantalla; aqui no, porque `stores` es un JSON y una FK no llega hasta ahi.
--
-- NO SIEMBRA DATOS. La tabla nace vacia. Quien rutea, desde donde y con cuanto lo pone el orquestador en
-- produccion despues de aplicar, con el `insert ... select` que esta en el plan
-- (docs/PLAN-128-130-motor-rutas-modelo.md): ningun nombre de persona entra en el repo. Mientras un
-- chofer no tenga fila, la app usa lo de hoy (su capacidad por nombre, o la de flota, o 12; turno
-- 08:00-17:30) y el motor no le da trabajo porque no tiene base.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero. Un `commit` de dentro cierra la
-- transaccion de fuera y convierte un ensayo con ROLLBACK en una aplicacion de verdad.

create table if not exists public.driver_settings (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  -- El nombre de una tienda de settings.stores. null = sin base todavia: el motor no le da trabajo.
  base_store       text,
  -- Con decimales, como los pallets de las ordenes. null = la capacidad que ya tuviera (por nombre, o la de flota).
  capacity_pallets numeric,
  -- Hora local del negocio. Los valores por defecto son los que decidio el orquestador el 2026-09-18.
  shift_start      time not null default '08:00',
  shift_end        time not null default '17:30',
  returns_to_base  boolean not null default true,
  -- false = el motor no le asigna nada. No lo borra ni lo esconde de ningun otro sitio.
  routable         boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id) on delete set null,
  constraint driver_settings_capacity_positive check (capacity_pallets is null or capacity_pallets > 0),
  constraint driver_settings_shift_order check (shift_end > shift_start),
  constraint driver_settings_base_not_blank check (base_store is null or btrim(base_store) <> '')
);

comment on table public.driver_settings is
  'Base, capacidad y turno de cada chofer para el motor de rutas (128). Por profile_id; deliveries.assigned_driver sigue siendo el nombre.';

-- Quien y cuando lo cambio lo pone la base, no el navegador. Sin sesion (llave de servicio, o quien
-- siembra los datos desde psql) no hay a quien preguntar: se deja `updated_by` como venga.
create or replace function public.driver_settings_stamp()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.updated_at := now();
  if auth.uid() is not null then NEW.updated_by := auth.uid(); end if;
  return NEW;
end $$;

revoke execute on function public.driver_settings_stamp() from public, anon, authenticated;

drop trigger if exists driver_settings_stamp on public.driver_settings;
create trigger driver_settings_stamp
  before insert or update on public.driver_settings
  for each row execute function public.driver_settings_stamp();

-- ---------------------------------------------------------------------------
-- Quien lee y quien escribe
-- ---------------------------------------------------------------------------
-- Leen los roles que planifican o necesitan ver el plan: admin, logistica, gerente, office y almacen,
-- y solo con acceso al modulo de Entregas (083). El chofer no: nada de su pantalla lo usa.
-- Escriben admin y logistica, que son quienes publicaran rutas (decision 13 de la seccion 11).
--
-- Una politica POR COMANDO y ninguna FOR ALL: una ALL tambien lee, y las permisivas se suman con OR, asi
-- que una de mas abre lo que las otras cierran. La autocomprobacion de abajo lo mira.
alter table public.driver_settings enable row level security;

-- El `revoke` va primero: en Supabase los privilegios por defecto de `public` dan TODO a `anon` y
-- `authenticated` sobre cada tabla nueva, y un `grant` a secas no quita nada (medido al ensayar la 126).
revoke all on public.driver_settings from anon, authenticated;
grant select, insert, update, delete on public.driver_settings to authenticated;

drop policy if exists "driver_settings select" on public.driver_settings;
drop policy if exists "driver_settings insert" on public.driver_settings;
drop policy if exists "driver_settings update" on public.driver_settings;
drop policy if exists "driver_settings delete" on public.driver_settings;

create policy "driver_settings select" on public.driver_settings for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting', 'warehouse'));

create policy "driver_settings insert" on public.driver_settings for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "driver_settings update" on public.driver_settings for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "driver_settings delete" on public.driver_settings for delete to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.driver_settings'::regclass) then
    raise exception '128: driver_settings quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'driver_settings';
  if n <> 4 then raise exception '128: driver_settings tiene % politicas, se esperaban 4', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'driver_settings' and cmd = 'ALL';
  if n <> 0 then raise exception '128: hay % politicas FOR ALL', n; end if;
  select count(distinct cmd) into n from pg_policies where schemaname = 'public' and tablename = 'driver_settings';
  if n <> 4 then raise exception '128: las politicas no cubren los cuatro comandos (cubren %)', n; end if;

  if has_table_privilege('anon', 'public.driver_settings', 'SELECT')
     or has_table_privilege('anon', 'public.driver_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.driver_settings', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.driver_settings', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.driver_settings', 'TRIGGER') then
    raise exception '128: permisos de mas sobre driver_settings';
  end if;
  if not has_table_privilege('authenticated', 'public.driver_settings', 'SELECT')
     or not has_table_privilege('authenticated', 'public.driver_settings', 'UPDATE') then
    raise exception '128: a authenticated le faltan permisos sobre driver_settings';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.driver_settings'::regclass
                  and tgname = 'driver_settings_stamp' and not tgisinternal) then
    raise exception '128: falta el disparador driver_settings_stamp';
  end if;

  -- Lo que esta migracion promete no tocar.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries'
                    and column_name = 'assigned_driver' and data_type = 'text') then
    raise exception '128: deliveries.assigned_driver ya no es text';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop table if exists public.driver_settings;        -- se lleva politicas, restricciones y disparador
--   drop function if exists public.driver_settings_stamp();
--   delete from public.schema_migrations where name = '128_driver_settings.sql';
--
-- El `drop table` borra las bases, capacidades y turnos que se hayan puesto. Si interesan, primero
--   create table driver_settings_backup as select * from public.driver_settings;
-- La app vuelve sola a lo de antes: capacidad por nombre en settings.driver_capacity, turno por defecto.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Con la 128 aplicada DENTRO de la misma transaccion. <uuid-chofer> es un perfil con rol driver;
-- `pg_temp.intenta` es el ayudante de la 123 (PERMITIDO / SIN FILAS / BLOQUEADO).
--
--   set local role authenticated;
--
--   -- A. Admin.
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   A1 insert (profile_id, base_store, capacity_pallets) = (<uuid-chofer>, 'Tienda de prueba', 10.5)   -> PERMITIDO
--   A2 select updated_by, updated_at from public.driver_settings where profile_id = <uuid-chofer>      -> <uuid-admin>, ahora
--   A3 update ... set capacity_pallets = 0                                                             -> BLOQUEADO (check)
--   A4 update ... set shift_start = '18:00'  (despues de la salida)                                    -> BLOQUEADO (check)
--   A5 update ... set base_store = '   '                                                               -> BLOQUEADO (check)
--   A6 update ... set routable = false                                                                 -> PERMITIDO
--
--   -- B. Logistica: lee y escribe.
--   set local request.jwt.claims = '{"sub":"<uuid-logistica>","role":"authenticated"}';
--   B1 select count(*)                                                                                 -> 1
--   B2 update ... set capacity_pallets = 12                                                            -> PERMITIDO
--
--   -- C. Gerente, office, almacen: leen, no escriben.
--   set local request.jwt.claims = '{"sub":"<uuid-gerente>","role":"authenticated"}';
--   C1 select count(*)                                                                                 -> 1
--   C2 update ... set capacity_pallets = 99                                                            -> SIN FILAS
--   C3 insert de otro chofer                                                                           -> BLOQUEADO (RLS)
--   C4 delete                                                                                          -> SIN FILAS
--
--   -- D. Ventas y el propio chofer: ni leen.
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   D1 select count(*)                                                                                 -> 0
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   D2 select count(*)                                                                                 -> 0
--   D3 update de SU fila                                                                               -> SIN FILAS
--
--   -- E. Lo que no debe cambiar: un chofer sigue viendo sus ordenes por NOMBRE.
--   E1 select count(*) from public.deliveries where assigned_driver = (su full_name)                   -> lo mismo que antes de aplicar
--
--   reset role;
--   rollback;
--
-- No verificado al escribirlo: nada de esto se ha corrido. Una rama no toca produccion.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('128_driver_settings.sql', '5da3b3c32fd2a26a10272d7df2dfb1fa4d05c52ce9996ceb8b32b17b127cbf10') on conflict (name) do nothing;
