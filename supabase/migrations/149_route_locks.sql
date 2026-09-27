-- 149 - El candado de ruta, compartido: una fila por ruta y dia que ve todo logistica
-- ===========================================================================
-- El dueno comparo el Gestor con OptimoRoute (2026-09-26/27): "quiero que mires como funciona y lo copies".
-- En OptimoRoute una ruta bloqueada (lockType ROUTES) la respeta todo el equipo y el planificador del
-- servidor. Aqui, desde D-411, el candado vivia en el localStorage de quien lo ponia: otra persona de
-- logistica no lo veia, y "Planificar el dia" (el motor, en el servidor) no lo conocia.
--
-- Plan en papel: docs/PLAN-149-candado-compartido.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues. El numero es 149 y no 148 porque
-- otra rama (/estimator) puede estar escribiendo la 148; el registro no exige numeros seguidos.
--
-- Que trae, y SOLO esto:
--   Una tabla nueva, public.route_locks: (plan_date, lane) es la clave; locked_by y locked_at los pone la
--   base. `lane` es la clave de la ruta en el Gestor: el NOMBRE del chofer (como deliveries.assigned_driver)
--   o el de la ruta temporal (settings.route_buckets). Sin FK a profiles por el nombre: la clave del Gestor
--   es texto, y un chofer renombrado deja un candado huerfano de un dia, que no bloquea a nadie.
--   Un disparador que sella quien y cuando. Tres politicas, una por comando. No toca ninguna otra tabla.
--
-- Decisiones, con su motivo:
--   1. BLOQUEAR ES INSERTAR, DESBLOQUEAR ES BORRAR. Sin UPDATE: no hay nada que editar en un candado. Dos
--      personas que bloquean a la vez: la segunda choca con la clave primaria y la app lo lee como "ya estaba
--      bloqueada" (23505), que es la verdad.
--   2. LEEN los roles que ven el plan (los mismos que driver_settings, 128): admin, logistica, gerente,
--      office y almacen, con acceso al modulo de Entregas. ESCRIBEN admin y logistica, que son quienes
--      arman las rutas. El chofer y ventas, nada.
--   3. NO SE PODAN las filas viejas. Son una por ruta bloqueada y dia: decenas al mes. La app solo lee las de
--      los ultimos 14 dias; lo de antes queda como historia de quien bloqueo que.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit
-- de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

create table if not exists public.route_locks (
  plan_date  date not null,
  lane       text not null,
  locked_by  uuid references public.profiles(id) on delete set null,
  locked_at  timestamptz not null default now(),
  constraint route_locks_pkey primary key (plan_date, lane),
  constraint route_locks_lane_not_blank check (btrim(lane) <> '' and char_length(lane) <= 200)
);

comment on table public.route_locks is
  'Rutas bloqueadas del Gestor por dia (149, D-411): lo automatico (Optimizar, Auto-asignar, Mejor lugar, Planificar el dia) no las toca. lane = nombre del chofer o de la ruta temporal.';

-- Quien y cuando lo pone la base, no el navegador. Sin sesion (psql, llave de servicio) se deja como venga.
create or replace function public.route_locks_stamp()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.locked_at := now();
  if auth.uid() is not null then NEW.locked_by := auth.uid(); end if;
  return NEW;
end $$;

revoke execute on function public.route_locks_stamp() from public, anon, authenticated;

drop trigger if exists route_locks_stamp on public.route_locks;
create trigger route_locks_stamp
  before insert on public.route_locks
  for each row execute function public.route_locks_stamp();

-- ---------------------------------------------------------------------------
-- Quien lee y quien escribe
-- ---------------------------------------------------------------------------
-- Una politica POR COMANDO y ninguna FOR ALL: una ALL tambien lee, y las permisivas se suman con OR.
alter table public.route_locks enable row level security;

-- El revoke va primero: en Supabase los privilegios por defecto dan TODO a anon y authenticated sobre cada
-- tabla nueva, y un grant a secas no quita nada (medido al ensayar la 126).
revoke all on public.route_locks from anon, authenticated;
grant select, insert, delete on public.route_locks to authenticated;

drop policy if exists "route_locks select" on public.route_locks;
drop policy if exists "route_locks insert" on public.route_locks;
drop policy if exists "route_locks delete" on public.route_locks;

create policy "route_locks select" on public.route_locks for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting', 'warehouse'));

create policy "route_locks insert" on public.route_locks for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_locks delete" on public.route_locks for delete to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.route_locks'::regclass) then
    raise exception '149: route_locks quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_locks';
  if n <> 3 then raise exception '149: route_locks tiene % politicas, se esperaban 3', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_locks' and cmd in ('ALL', 'UPDATE');
  if n <> 0 then raise exception '149: hay % politicas FOR ALL o UPDATE', n; end if;
  select count(distinct cmd) into n from pg_policies where schemaname = 'public' and tablename = 'route_locks';
  if n <> 3 then raise exception '149: las politicas no cubren select, insert y delete (cubren %)', n; end if;

  if has_table_privilege('anon', 'public.route_locks', 'SELECT')
     or has_table_privilege('anon', 'public.route_locks', 'INSERT')
     or has_table_privilege('authenticated', 'public.route_locks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.route_locks', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.route_locks', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.route_locks', 'TRIGGER') then
    raise exception '149: permisos de mas sobre route_locks';
  end if;
  if not has_table_privilege('authenticated', 'public.route_locks', 'SELECT')
     or not has_table_privilege('authenticated', 'public.route_locks', 'INSERT')
     or not has_table_privilege('authenticated', 'public.route_locks', 'DELETE') then
    raise exception '149: a authenticated le faltan permisos sobre route_locks';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.route_locks'::regclass
                  and tgname = 'route_locks_stamp' and not tgisinternal) then
    raise exception '149: falta el disparador route_locks_stamp';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion (a mano, en una transaccion propia)
-- ===========================================================================
--   drop table if exists public.route_locks;              -- se lleva politicas, restricciones y disparador
--   drop function if exists public.route_locks_stamp();
--   delete from public.schema_migrations where name = '149_route_locks.sql';
--
-- Se pierden los candados puestos. La app no se rompe: sin la tabla, rutas-bloqueadas.ts lee el fallo como
-- "la tabla no esta" y vuelve al candado de este navegador (localStorage), y lo dice en el boton y en el
-- aviso; "Planificar el dia" deja de conocer los candados, como antes de la 149.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('149_route_locks.sql', '5af9c712f2adc0679fde3222c5cc247724cede84a758186ed2a679f315115abf') on conflict (name) do nothing;
