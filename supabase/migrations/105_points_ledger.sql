-- 105 · Cimientos del sistema de puntos (D-NEXT): libro mayor, tasas y quien escribe
--
-- El dueno quiere puntos con dos publicos: EMPLEADOS, que suman por hacer las cosas
-- bien (empezando por llegar puntual, que la app ya mide en clockin.scheduled_shifts)
-- y restan por hacerlas mal, y con suficientes puntos canjean un dia libre pagado; y
-- CLIENTES, que suman subiendo fotos de sus proyectos con nuestros productos.
--
-- Este es el encargo 1 de cinco y no trae ni una pantalla. Lo unico que hace es dejar
-- el modelo de datos, sus reglas y sus tasas, de forma que los otros cuatro —puntear a
-- mano, puntualidad automatica, canje, y subida del cliente— no tengan que cambiarlo.
--
-- SE EJECUTA ANTES DE QUE EXISTA EL CODIGO QUE LA USA, a proposito. El 2026-09-10 se
-- fusiono una rama cuya migracion no se habia aplicado: el codigo pidio columnas que no
-- existian y el hub entro en bucle de redirecciones en produccion. Por eso esta migracion
-- no depende de nada del despliegue y es idempotente de arriba abajo (if not exists,
-- drop policy if exists, create or replace): ejecutarla dos veces no hace dano.
--
-- ===========================================================================
-- 1. Un libro mayor, no un saldo
-- ===========================================================================
-- El saldo NO se guarda en ninguna columna: se suma. Un numero guardado se desincroniza
-- del historial en la primera escritura que falle a medias, y cuando alguien pregunta
-- "por que tengo 46 puntos" no hay respuesta. Un libro mayor siempre la tiene.

create table if not exists public.point_events (
  id           uuid primary key default gen_random_uuid(),
  -- Exactamente uno de los dos sujetos (check mas abajo). En la MISMA tabla porque el
  -- canje y las reglas son los mismos; dos tablas duplicarian las dos cosas.
  employee_id  uuid references public.profiles(id) on delete cascade,
  account      text,
  -- Positivo suma, negativo resta. Nunca cero: un evento de cero puntos es ruido que
  -- ensucia el historial que el empleado si puede ver.
  points       integer not null,
  -- Motivo corto y estable ('punctual_day', 'late', 'customer_photo'...). Lo que se
  -- escribe a mano va en `note`.
  reason       text not null,
  kind         text not null default 'manual',
  -- Clave natural de los automaticos, p.ej. 'punctual:<uuid>:2026-09-10'. Con indice
  -- unico: el trabajo diario que los conceda se va a ejecutar dos veces algun dia, y
  -- ese dia no puede pagar dos veces.
  source_key   text,
  granted_by   uuid references public.profiles(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),

  constraint point_events_one_subject
    check ((employee_id is not null) <> (account is not null)),
  constraint point_events_points_not_zero check (points <> 0),
  constraint point_events_kind_allowed    check (kind in ('auto', 'manual')),
  -- Un automatico SIN clave no se puede desduplicar, asi que no se acepta.
  constraint point_events_auto_needs_key  check (kind <> 'auto' or source_key is not null),
  constraint point_events_reason_len      check (char_length(btrim(reason)) between 1 and 80),
  constraint point_events_note_len        check (note is null or char_length(note) <= 500)
);

create unique index if not exists point_events_source_key_uniq
  on public.point_events (source_key) where source_key is not null;
create index if not exists point_events_employee_idx
  on public.point_events (employee_id, created_at desc);
create index if not exists point_events_account_idx
  on public.point_events (account, created_at desc);

comment on table public.point_events is
  'Libro mayor de puntos (D-NEXT). El saldo se suma, nunca se guarda. Append-only: se corrige con un evento contrario.';

-- ===========================================================================
-- 2. Quien escribe, y quien ve que
-- ===========================================================================
-- Sin privilegio de UPDATE/DELETE (cinturon) y sin politica que los permita (tirantes).
alter table public.point_events enable row level security;
revoke all on public.point_events from anon, authenticated;
grant select, insert on public.point_events to authenticated;

-- LECTURA. El empleado ve SUS eventos POSITIVOS y nada mas: el dueno decidio que las
-- restas no se listan. Se hace cumplir aqui, no escondiendolo en la pantalla, porque una
-- pantalla que filtra sigue bajando los datos al navegador. El saldo completo —restas
-- incluidas— lo da la funcion de mas abajo, que devuelve un numero, no las filas.
drop policy if exists "point_events select" on public.point_events;
create policy "point_events select" on public.point_events for select to authenticated
  using (
    public.is_admin()
    or public.current_user_role() = 'manager'
    or (employee_id = (select auth.uid()) and points > 0)
  );

-- ESCRITURA MANUAL. Admin o gerente, firmando con su propio id, y NUNCA sobre si mismo:
-- quien puede darse puntos a si mismo puede canjearse dias libres, que es dinero. Los
-- eventos de cliente (account) los firma tambien una persona.
drop policy if exists "point_events insert manual" on public.point_events;
create policy "point_events insert manual" on public.point_events for insert to authenticated
  with check (
    kind = 'manual'
    and (public.is_admin() or public.current_user_role() = 'manager')
    and granted_by = (select auth.uid())
    and (employee_id is null or employee_id <> (select auth.uid()))
  );

-- Los 'auto' no tienen politica: ningun cliente puede insertarlos. Los escribe el trabajo
-- del servidor con service_role, que salta RLS.
-- UPDATE y DELETE tampoco tienen politica: denegados para authenticated.

-- Append-only de verdad, tambien para service_role, que salta la RLS pero no un trigger.
create or replace function public.guard_point_events_append_only()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'point_events es un libro mayor: se corrige con un evento contrario, no editando (intento de %)', TG_OP;
end $$;

drop trigger if exists point_events_append_only on public.point_events;
create trigger point_events_append_only
  before update or delete on public.point_events
  for each row execute function public.guard_point_events_append_only();

-- Y TRUNCATE, que es la puerta que deja irrelevante a las otras tres: no dispara un
-- trigger de fila, no deja rastro, y vacia el libro entero de un golpe. En Postgres es
-- una operacion aparte y necesita su propio trigger, por sentencia y no por fila.
drop trigger if exists point_events_no_truncate on public.point_events;
create trigger point_events_no_truncate
  before truncate on public.point_events
  for each statement execute function public.guard_point_events_append_only();

-- Y por el otro lado, el privilegio, que no es teorico: el reparto por defecto de
-- postgres en `public` (pg_default_acl) concede arwdDxtm —la D es TRUNCATE— a
-- authenticated y service_role en CADA tabla nueva, asi que esta tabla NACE truncable
-- para los dos. Medido en produccion por el orquestador con has_table_privilege: true
-- para los dos en las 12 tablas de public. El `revoke all` de arriba tapa a
-- authenticated; esta linea tapa a service_role, que es el rol con el que corre casi
-- todo lo del servidor aqui.
--
-- Mismo razonamiento que 081_revoke_anon.sql escribio para anon: TRUNCATE no pasa por
-- RLS —no mira filas, vacia la tabla—, hoy no hay camino para invocarlo (PostgREST no
-- lo expone), «pero es un permiso a una funcion RPC de distancia de ser alcanzable, y
-- no hay ninguna razon para que exista».
--
-- Se le quitan tambien update y delete: esta tabla es append-only para todos, y
-- service_role no es una excepcion. Select e insert se quedan, que son los que usan las
-- rutas del servidor y el trabajo diario de los automaticos.
revoke truncate, update, delete on public.point_events from service_role;

-- ===========================================================================
-- 3. Los saldos, que son funciones y no columnas
-- ===========================================================================
-- El saldo propio incluye las restas aunque el empleado no pueda listarlas. Por eso es
-- SECURITY DEFINER: la RLS de arriba le esconde las filas negativas, y esta funcion las
-- suma sin ensenarlas. Devuelve un entero, nunca filas.
create or replace function public.my_point_balance()
  returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::int
    from public.point_events
   where employee_id = auth.uid();
$$;
revoke execute on function public.my_point_balance() from public, anon;
grant  execute on function public.my_point_balance() to authenticated;

-- El saldo de OTRA persona, para las pantallas de quien puntea. Comprueba el rol ella
-- misma en vez de fiarse de quien la llame: es SECURITY DEFINER, asi que la RLS de la
-- tabla no la frena, y sin esta comprobacion seria una puerta trasera al historial.
create or replace function public.point_balance(target uuid)
  returns integer language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin()
          or public.current_user_role() = 'manager'
          or target = auth.uid()) then
    raise exception 'Only an admin or a manager can read someone else''s point balance';
  end if;
  return coalesce((select sum(points) from public.point_events where employee_id = target), 0)::int;
end $$;
revoke execute on function public.point_balance(uuid) from public, anon;
grant  execute on function public.point_balance(uuid) to authenticated;

-- ===========================================================================
-- 4. Las tasas viven en Ajustes
-- ===========================================================================
-- Cuanto vale un dia puntual y cuanto cuesta un dia libre tienen que poder cambiarse sin
-- desplegar. Valores de partida propuestos por el orquestador: 2 y 100. Van como DEFAULT
-- de la columna, no clavados en el codigo; el codigo solo tiene el mismo numero como
-- respaldo por si la fila llegara con null (fila vieja, o una lectura parcial).
alter table public.settings
  add column if not exists points_per_punctual_day integer not null default 2,
  add column if not exists points_per_day_off      integer not null default 100;

alter table public.settings drop constraint if exists settings_points_punctual_positive;
alter table public.settings add constraint settings_points_punctual_positive
  check (points_per_punctual_day > 0);
alter table public.settings drop constraint if exists settings_points_day_off_positive;
alter table public.settings add constraint settings_points_day_off_positive
  check (points_per_day_off > 0);

-- Quien las edita ya esta resuelto: 100_settings_events_rls.sql deja el UPDATE de
-- public.settings solo a is_admin(). No se toca ninguna politica de settings aqui.

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop trigger if exists point_events_no_truncate on public.point_events;
--   drop trigger if exists point_events_append_only on public.point_events;
--   drop function if exists public.guard_point_events_append_only();
--   drop function if exists public.my_point_balance();
--   drop function if exists public.point_balance(uuid);
--   drop table if exists public.point_events;
--   alter table public.settings drop column if exists points_per_punctual_day,
--                               drop column if exists points_per_day_off;
--
-- Y para una correccion excepcional que SI tenga que editar una fila (no deberia
-- haberla; lo normal es un evento contrario), el trigger se desactiva a proposito y se
-- vuelve a activar en la misma transaccion:
--   alter table public.point_events disable trigger point_events_append_only;
--   ...
--   alter table public.point_events enable trigger point_events_append_only;
--
-- El de TRUNCATE no se desactiva nunca: vaciar el libro no es una correccion.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('105_points_ledger.sql', 'a3d5a531cf887b225ccc01b05890dfca9f79091f12b3ef07470ac9eaffb0c702') on conflict (name) do nothing;
