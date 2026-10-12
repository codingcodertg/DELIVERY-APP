-- 166 - De que tienda sale y en cual termina cada chofer, POR DIA
-- ===========================================================================
-- El dueno, 2026-10-11 (dictado, literal): «choose the driver strarting position LOGISTIC MANAGER, DEFAULT IS
-- THE ONE HE ALREADY WORKS ON». Y el mismo dia: «Need to be able to assign store where driver is starting/
-- ending at. For example, Julio will start in mcallen 10/12/26 to use other truck since his is in
-- maintenance».
--
-- Hasta aqui la tienda de la que sale el camion y a la que vuelve era UNA y fija: la base de Ajustes → Rutas
-- (driver_settings.base_store, 128) o, si no, la tienda del perfil (D-461). No habia donde decir «manana
-- Julio sale de McAllen». Lo que ya habia no servia: driver_settings no tiene fecha (cambiar ahi la base la
-- cambia para siempre), route_plans es la foto de un plan, route_locks (149) dice «no tocar» y
-- driver_availability dice «no disponible».
--
-- ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues del merge, con respaldo hecho y migrate-status
-- antes y despues (node scripts/db/aplica-migracion.mjs 166_base_del_dia.sql corre el ENSAYO con ROLLBACK).
-- La app funciona sin ella: sin la tabla, cada chofer sale y termina en su base de siempre, el selector se
-- ve apagado y lo dice, y «Armar rutas» planifica como hoy (src/lib/base-del-dia.ts, `faltaLaTablaDeBases`).
--
-- Que trae, y SOLO esto:
--   Una tabla nueva, public.driver_day_bases: (plan_date, driver_id) es la clave. Una fila = ese chofer, ese dia,
--   no sale o no termina en su base. start_store / end_store: el NOMBRE de una tienda de Ajustes (settings.stores),
--   o null = lo de siempre. Sin fila, todo como siempre. set_by y set_at los pone la base.
--   Un disparador que sella quien y cuando. Cuatro politicas, una por comando. No toca ninguna otra tabla.
--
-- Decisiones, con su motivo:
--   1. POR driver_id (uuid, FK a profiles) y no por nombre como route_locks: un chofer lee SU fila por
--      auth.uid(), y «Armar rutas» trabaja por id. Las rutas temporales («Ruta 1») no tienen base: no entran.
--   2. SALIDA Y FIN EN LA MISMA FILA (lo pidio el orquestador). null = «lo de siempre»: la salida, su base; el
--      fin, donde salio ese dia (src/lib/base-del-dia.ts lo decide, no la base). Una fila con las dos en null no
--      dice nada: el check la prohibe, y volver a «su base» en las dos es BORRAR la fila.
--   3. La tienda es TEXTO, sin FK: las tiendas viven en settings.stores (jsonb). Una tienda que ya no existe no
--      rompe nada: la app la ignora y cae a la base de siempre.
--   4. LEEN: quien tiene el modulo de Entregas y no es chofer (el Gestor, «Ruta de hoy», que abren todos los
--      roles de entregas, D-467/D-481); y el CHOFER, solo SU fila («Mi ruta» monta el mapa del Gestor, D-514).
--      ESCRIBEN: admin y logistica, que son quienes arman las rutas (los mismos que route_locks, 149).
--   5. NO SE PODAN las filas viejas: una por chofer y dia cambiado, pocas al mes, y dicen quien movio que.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit
-- de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

create table if not exists public.driver_day_bases (
  plan_date   date not null,
  driver_id   uuid not null references public.profiles(id) on delete cascade,
  start_store text,
  end_store   text,
  set_by      uuid references public.profiles(id) on delete set null,
  set_at      timestamptz not null default now(),
  constraint driver_day_bases_pkey primary key (plan_date, driver_id),
  constraint driver_day_bases_algo check (start_store is not null or end_store is not null),
  constraint driver_day_bases_start_ok check (start_store is null or (btrim(start_store) <> '' and char_length(start_store) <= 200)),
  constraint driver_day_bases_end_ok check (end_store is null or (btrim(end_store) <> '' and char_length(end_store) <= 200))
);

comment on table public.driver_day_bases is
  'De que tienda sale (start_store) y en cual termina (end_store) un chofer UN dia (166, 2026-10-11). null = lo de siempre: la base de Ajustes; el fin, donde salio. Sin fila, su base. Lo leen el Gestor, «Armar rutas», «Ruta de hoy» y «Mi ruta».';

-- Quien y cuando lo pone la base, no el navegador. Sin sesion (psql, llave de servicio) se deja como venga.
create or replace function public.driver_day_bases_stamp()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.set_at := now();
  if auth.uid() is not null then NEW.set_by := auth.uid(); end if;
  return NEW;
end $$;

revoke execute on function public.driver_day_bases_stamp() from public, anon, authenticated;

drop trigger if exists driver_day_bases_stamp on public.driver_day_bases;
create trigger driver_day_bases_stamp
  before insert or update on public.driver_day_bases
  for each row execute function public.driver_day_bases_stamp();

-- ---------------------------------------------------------------------------
-- Quien lee y quien escribe
-- ---------------------------------------------------------------------------
-- Una politica POR COMANDO y ninguna FOR ALL: una ALL tambien lee, y las permisivas se suman con OR.
alter table public.driver_day_bases enable row level security;

-- El revoke va primero: en Supabase los privilegios por defecto dan TODO a anon y authenticated sobre cada
-- tabla nueva, y un grant a secas no quita nada (medido al ensayar la 126).
revoke all on public.driver_day_bases from anon, authenticated;
grant select, insert, update, delete on public.driver_day_bases to authenticated;

drop policy if exists "driver_day_bases select" on public.driver_day_bases;
drop policy if exists "driver_day_bases insert" on public.driver_day_bases;
drop policy if exists "driver_day_bases update" on public.driver_day_bases;
drop policy if exists "driver_day_bases delete" on public.driver_day_bases;

create policy "driver_day_bases select" on public.driver_day_bases for select to authenticated
  using (driver_id = (select auth.uid())
     or ((select public.has_deliveries_access())
         and (select public.current_user_role()) <> 'driver'));

create policy "driver_day_bases insert" on public.driver_day_bases for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "driver_day_bases update" on public.driver_day_bases for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "driver_day_bases delete" on public.driver_day_bases for delete to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.driver_day_bases'::regclass) then
    raise exception '166: driver_day_bases quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'driver_day_bases';
  if n <> 4 then raise exception '166: driver_day_bases tiene % politicas, se esperaban 4', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'driver_day_bases' and cmd = 'ALL';
  if n <> 0 then raise exception '166: hay % politicas FOR ALL', n; end if;
  select count(distinct cmd) into n from pg_policies where schemaname = 'public' and tablename = 'driver_day_bases';
  if n <> 4 then raise exception '166: las politicas no cubren select, insert, update y delete (cubren %)', n; end if;

  if has_table_privilege('anon', 'public.driver_day_bases', 'SELECT')
     or has_table_privilege('anon', 'public.driver_day_bases', 'INSERT')
     or has_table_privilege('authenticated', 'public.driver_day_bases', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.driver_day_bases', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.driver_day_bases', 'TRIGGER') then
    raise exception '166: permisos de mas sobre driver_day_bases';
  end if;
  if not has_table_privilege('authenticated', 'public.driver_day_bases', 'SELECT')
     or not has_table_privilege('authenticated', 'public.driver_day_bases', 'INSERT')
     or not has_table_privilege('authenticated', 'public.driver_day_bases', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.driver_day_bases', 'DELETE') then
    raise exception '166: a authenticated le faltan permisos sobre driver_day_bases';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.driver_day_bases'::regclass
                  and tgname = 'driver_day_bases_stamp' and not tgisinternal) then
    raise exception '166: falta el disparador driver_day_bases_stamp';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion (a mano, en una transaccion propia)
-- ===========================================================================
--   drop table if exists public.driver_day_bases;          -- se lleva politicas, restricciones y disparador
--   drop function if exists public.driver_day_bases_stamp();
--   delete from public.schema_migrations where name = '166_base_del_dia.sql';
--
-- Se pierden las salidas y los fines elegidos. La app no se rompe: sin la tabla, base-del-dia.ts lee el fallo
-- como «la tabla no esta», cada chofer vuelve a su base de siempre, el selector se apaga y lo dice, y «Armar
-- rutas» planifica como antes de la 166.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('166_base_del_dia.sql', 'ec2737ae1b37ae1df49389e42414670b465db33fde2d048f93b63c148ecc371a') on conflict (name) do nothing;
