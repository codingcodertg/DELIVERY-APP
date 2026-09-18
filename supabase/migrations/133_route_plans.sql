-- 133 · Los planes de ruta: el borrador, sus paradas, y «Publicar ruta» (rama motor-rutas-plan)
--
-- El motor de rutas calcula un plan; hasta ahora no habia donde guardarlo. El Gestor de Rutas de hoy solo
-- guarda, en cada orden, el chofer y la posicion de la parada: millas, minutos, horas de llegada y el porque
-- de cada decision se pierden al cambiar de fecha. Sin el plan guardado no hay comparacion posible contra la
-- hoja manual del despachador, que es lo que el dueno pidio. El plan en papel esta en
-- docs/PLAN-133-route-plans.md y el diseno en docs/route-algorithm-design.md (secciones 6.3 y 7).
--
-- DOS TABLAS
--   · `route_plans`       una fila por corrida: la FOTO de la entrada (ordenes con su `updated_at`, choferes,
--                         matriz de tiempos y trafico por hora), los parametros y pesos con que se hizo, el
--                         resultado, y QUE SE VA A ESCRIBIR en cada orden al publicar (`writes`).
--   · `route_plan_stops`  una fila por parada: chofer, posicion, recogida o entrega, horas, espera, retraso,
--                         carga a bordo. Lo que quedo sin asignar va dentro de `route_plans.result`: son pocas
--                         filas que nunca se consultan sueltas, y una tabla mas es una politica mas que ensayar.
--
-- BORRADOR Y PUBLICADO. Un borrador no toca ninguna orden ni avisa a nadie. Publicar lo hace
-- `publish_route_plan`, y SOLO ella: ningun UPDATE suelto puede pasar un plan a `published`.
--
-- POR QUE `publish_route_plan` ES `SECURITY INVOKER` (el defecto), Y NO `SECURITY DEFINER`
--   Una llamada `rpc` es UNA transaccion y corre con el rol y el JWT de quien llama. Asi publicar es atomico
--   —o se escribe todo o no se escribe nada, tambien si el servidor muere a medias o publican dos a la vez— Y
--   ADEMAS valen la RLS de quien publica, el guard de `deliveries` y sus disparadores. Una `security definer`
--   tambien seria atomica, pero se saltaria justo eso. (La idea es del orquestador; la alternativa que se
--   descarto era escribir orden a orden desde el servidor y deshacer a mano si algo fallaba.)
--
--   Por eso la funcion CUENTA las filas que escribe. Desde la 131 la lectura de `deliveries` se acota por
--   tienda, y un UPDATE solo alcanza las filas que quien escribe puede VER: si a quien publica le marcaron
--   tiendas, alguna orden no se escribiria y PostgREST volveria limpio. Aqui eso es una excepcion, y la
--   excepcion lo deshace todo.
--
-- QUE ESCRIBE EN `deliveries`: `assigned_driver` (el NOMBRE del chofer), `route_seq`, `load_no` y
--   `load_auto = true`. Las mismas cuatro columnas que escribe hoy el Gestor, con el mismo significado, para
--   que «Mi ruta», el mapa, almacen y el manifiesto no se enteren. NO toca el guard: logistica ya edita en
--   misma etapa en draft, pending, approved, fulfilling y ready (vigente la 127), que son las etapas ruteables.
--   Las ordenes que el plan dejo sin asignar no se tocan.
--
-- LOS AVISOS: uno por chofer, no uno por orden. A QUIEN se avisa lo decide el codigo (`avisosAlPublicar`, que
--   compara parada a parada con el plan publicado anterior) y la funcion recibe la lista ya hecha. No abre nada
--   nuevo: cualquiera con sesion ya puede insertar un aviso para cualquiera (`notif insert any`, 001). El id de
--   cada aviso nace en una variable y se devuelve, para pedir el push sin leer de vuelta una fila que es de otra
--   persona (la leccion del aviso al chofer que no llegaba nunca).
--
-- QUIEN
--   Leen admin, logistica, gerente y office; almacen, SOLO los publicados; chofer y ventas, nada (el chofer
--   sigue viendo su dia por `deliveries`, como hoy). Escriben admin y logistica. Un plan publicado NO se edita
--   ni se borra, tampoco con la llave de servicio, salvo para pasar a `superseded` cuando se publica otro.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.route_plans (
  id                uuid primary key default gen_random_uuid(),
  plan_date         date not null,
  status            text not null default 'draft',
  -- 1, 2, 3... dentro de la fecha. Lo pone la base.
  version           integer not null default 0,
  source            text not null default 'engine',
  algorithm_version text,
  params            jsonb not null default '{}'::jsonb,
  -- { "ordenes": [{ "id", "updated_at", ... }], "choferes": [...], "matriz": {...}, "porHora": {...} }
  input             jsonb not null default '{}'::jsonb,
  result            jsonb not null default '{}'::jsonb,
  -- [{ "id", "assigned_driver", "route_seq", "load_no" }]: lo que `publish_route_plan` escribira en deliveries.
  writes            jsonb not null default '[]'::jsonb,
  provider          text,
  traffic           boolean not null default false,
  converged         boolean not null default true,
  total_minutes     integer,
  total_miles       numeric,
  late_minutes      integer,
  unassigned_count  integer,
  parent_plan_id    uuid references public.route_plans(id) on delete set null,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  published_by      uuid references public.profiles(id) on delete set null,
  published_at      timestamptz,
  constraint route_plans_status_allowed check (status in ('draft', 'published', 'superseded', 'discarded')),
  constraint route_plans_source_allowed check (source in ('engine', 'manual_edit', 'manual_import')),
  constraint route_plans_writes_is_array check (jsonb_typeof(writes) = 'array'),
  constraint route_plans_input_is_object check (jsonb_typeof(input) = 'object'),
  -- Publicado sin CUANDO seria un estado que no se puede auditar. El QUIEN no se exige aqui a proposito:
  -- `published_by` es `on delete set null`, y exigirlo haria fallar el borrado de quien publico alguna vez.
  constraint route_plans_published_needs_when
    check (status not in ('published', 'superseded') or published_at is not null)
);

-- Un solo plan publicado por fecha. Lo garantiza la base, no la buena voluntad.
create unique index if not exists route_plans_one_published_idx on public.route_plans (plan_date) where status = 'published';
create index if not exists route_plans_date_idx on public.route_plans (plan_date, created_at desc);

comment on table public.route_plans is
  'Planes de ruta del motor (133): borrador, publicado, sustituido o descartado. Un publicado no se edita; solo `publish_route_plan` publica.';

create table if not exists public.route_plan_stops (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid not null references public.route_plans(id) on delete cascade,
  driver_id           uuid references public.profiles(id) on delete set null,
  -- El nombre en ese momento: es lo que se escribe en deliveries.assigned_driver.
  driver_name         text not null,
  seq                 integer not null,
  kind                text not null,
  delivery_id         uuid references public.deliveries(id) on delete set null,
  -- La orden tal como la numero el motor: "<id>" o "<id>#a" si la partio en cargas.
  order_ref           text not null,
  label               text not null,
  visit               integer not null,
  place               text,
  lat                 double precision,
  lng                 double precision,
  window_start        integer,
  window_end          integer,
  is_hard             boolean not null default false,
  -- Minutos desde la medianoche del dia de la ruta.
  eta                 integer not null,
  etd                 integer not null,
  wait_min            integer not null default 0,
  service_min         integer not null default 0,
  late_min            integer not null default 0,
  load_after          numeric not null default 0,
  leg_minutes         integer not null default 0,
  leg_miles           numeric not null default 0,
  pinned              boolean not null default false,
  -- Vacias al planificar; las llenara la calibracion con lo que paso de verdad.
  actual_arrival_at   timestamptz,
  actual_departure_at timestamptz,
  constraint route_plan_stops_kind_allowed check (kind in ('P', 'D')),
  constraint route_plan_stops_one_per_position unique (plan_id, driver_name, seq)
);

create index if not exists route_plan_stops_plan_idx on public.route_plan_stops (plan_id, driver_name, seq);
create index if not exists route_plan_stops_delivery_idx on public.route_plan_stops (delivery_id);

comment on table public.route_plan_stops is
  'Las paradas de un plan de ruta (133): recogidas y entregas, en orden, con su hora, su carga a bordo y su retraso.';

-- ---------------------------------------------------------------------------
-- Lo que pone la base, y lo que no se reescribe
-- ---------------------------------------------------------------------------
-- Un plan NACE borrador, con su numero de version y con quien lo creo. Nada de eso lo decide el navegador.
create or replace function public.route_plan_stamp()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.status       := 'draft';
  NEW.published_by := null;
  NEW.published_at := null;
  NEW.created_at   := now();
  if auth.uid() is not null then NEW.created_by := auth.uid(); end if;
  NEW.version := coalesce((select max(p.version) from public.route_plans p where p.plan_date = NEW.plan_date), 0) + 1;
  return NEW;
end $$;

drop trigger if exists route_plans_stamp on public.route_plans;
create trigger route_plans_stamp
  before insert on public.route_plans
  for each row execute function public.route_plan_stamp();

-- Las transiciones. La politica dice QUIEN cambia un plan; esto dice QUE puede cambiar, y vale tambien para la
-- llave de servicio, que se salta RLS pero no los disparadores.
--   · draft      -> se edita libremente, y puede pasar a `discarded`.
--   · a `published` SOLO desde `publish_route_plan`, que lo marca con un ajuste local a su transaccion.
--   · published  -> solo a `superseded`, y sin tocar nada mas. Tambien solo desde la funcion.
--   · superseded y discarded -> no cambian. Nada se borra.
create or replace function public.guard_route_plan()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  publicando boolean := coalesce(current_setting('app.route_publishing', true), '') = 'on';
  probe public.route_plans%rowtype;
begin
  if TG_OP = 'DELETE' then
    raise exception 'A route plan is never deleted: discard it instead';
  end if;
  -- Borrar un perfil, o el plan del que salio este, pone a null su referencia (`on delete set null`), y eso
  -- llega aqui como un UPDATE. Es la base limpiando detras de un borrado, no alguien editando: si es lo UNICO
  -- que cambia, pasa, este el plan en el estado que este. Sin esto, borrar a un usuario que creo o publico un
  -- plan fallaria (la misma leccion que el autor de un mensaje de ayuda, en la 126).
  probe := NEW;
  if NEW.created_by is null then probe.created_by := OLD.created_by; end if;
  if NEW.published_by is null then probe.published_by := OLD.published_by; end if;
  if NEW.parent_plan_id is null then probe.parent_plan_id := OLD.parent_plan_id; end if;
  if probe is not distinct from OLD then return NEW; end if;

  if NEW.created_by is distinct from OLD.created_by or NEW.created_at is distinct from OLD.created_at
     or NEW.version is distinct from OLD.version or NEW.plan_date is distinct from OLD.plan_date then
    raise exception 'A route plan keeps its date, version and author';
  end if;

  if OLD.status = 'draft' then
    if NEW.status = 'draft' or NEW.status = 'discarded' then
      if NEW.published_by is not null or NEW.published_at is not null then
        raise exception 'Only publish_route_plan stamps who published';
      end if;
      return NEW;
    end if;
    if NEW.status = 'published' and publicando then return NEW; end if;
    raise exception 'A route plan is published only through publish_route_plan';
  end if;

  if OLD.status = 'published' and NEW.status = 'superseded' and publicando then
    probe := NEW;
    probe.status := OLD.status;
    if probe is not distinct from OLD then return NEW; end if;
  end if;
  raise exception 'A % route plan is history: it cannot be changed', OLD.status;
end $$;

drop trigger if exists route_plans_guard on public.route_plans;
create trigger route_plans_guard
  before update or delete on public.route_plans
  for each row execute function public.guard_route_plan();

-- Las paradas se escriben mientras su plan es un borrador. Despues, solo se les puede apuntar lo que paso de
-- verdad (`actual_*`), que es para lo que estan esas dos columnas.
create or replace function public.guard_route_plan_stop()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  estado text;
  probe public.route_plan_stops%rowtype;
begin
  select p.status into estado from public.route_plans p
   where p.id = (case when TG_OP = 'DELETE' then OLD.plan_id else NEW.plan_id end);
  -- El plan ya no existe: es la cascada de un borrado que el guard del plan ya habria rechazado; se deja pasar.
  if estado is null then return (case when TG_OP = 'DELETE' then OLD else NEW end); end if;
  if estado = 'draft' then return (case when TG_OP = 'DELETE' then OLD else NEW end); end if;
  if TG_OP = 'UPDATE' then
    probe := NEW;
    probe.actual_arrival_at := OLD.actual_arrival_at;
    probe.actual_departure_at := OLD.actual_departure_at;
    -- `driver_id` y `delivery_id` pasan a null si se borra el perfil o la orden (`on delete set null`).
    if NEW.driver_id is null then probe.driver_id := OLD.driver_id; end if;
    if NEW.delivery_id is null then probe.delivery_id := OLD.delivery_id; end if;
    if probe is not distinct from OLD then return NEW; end if;
  end if;
  raise exception 'The stops of a % route plan are history: they cannot be changed', estado;
end $$;

drop trigger if exists route_plan_stops_guard on public.route_plan_stops;
create trigger route_plan_stops_guard
  before insert or update or delete on public.route_plan_stops
  for each row execute function public.guard_route_plan_stop();

revoke execute on function public.route_plan_stamp()      from public, anon, authenticated;
revoke execute on function public.guard_route_plan()      from public, anon, authenticated;
revoke execute on function public.guard_route_plan_stop() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Politicas: una por comando, ninguna FOR ALL
-- ---------------------------------------------------------------------------
alter table public.route_plans      enable row level security;
alter table public.route_plan_stops enable row level security;

-- En esta base una tabla nueva nace con todo concedido a `anon` y `authenticated` (medido al ensayar la 126).
revoke all on public.route_plans      from anon, authenticated;
revoke all on public.route_plan_stops from anon, authenticated;
-- Sin DELETE sobre los planes: un plan se descarta, no se borra.
grant select, insert, update on public.route_plans to authenticated;
grant select, insert, update, delete on public.route_plan_stops to authenticated;

drop policy if exists "route_plans select" on public.route_plans;
drop policy if exists "route_plans insert" on public.route_plans;
drop policy if exists "route_plans update" on public.route_plans;

create policy "route_plans select" on public.route_plans for select to authenticated
  using ((select public.has_deliveries_access())
     and ((select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting')
       or ((select public.current_user_role()) = 'warehouse' and status = 'published')));

create policy "route_plans insert" on public.route_plans for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_plans update" on public.route_plans for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

drop policy if exists "route_plan_stops select" on public.route_plan_stops;
drop policy if exists "route_plan_stops insert" on public.route_plan_stops;
drop policy if exists "route_plan_stops update" on public.route_plan_stops;
drop policy if exists "route_plan_stops delete" on public.route_plan_stops;

-- Se ven las paradas de los planes que se ven: la subconsulta pasa por la politica de `route_plans`, asi que
-- almacen ve las de los publicados y nadie ve las de un plan que no puede leer. Una sola regla, en un sitio.
create policy "route_plan_stops select" on public.route_plan_stops for select to authenticated
  using (exists (select 1 from public.route_plans p where p.id = plan_id));

create policy "route_plan_stops insert" on public.route_plan_stops for insert to authenticated
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics')
     and exists (select 1 from public.route_plans p where p.id = plan_id));

create policy "route_plan_stops update" on public.route_plan_stops for update to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'))
  with check ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

create policy "route_plan_stops delete" on public.route_plan_stops for delete to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics'));

-- ---------------------------------------------------------------------------
-- Publicar
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (no se declara `security definer`): corre como quien llama. Ver la cabecera.
create or replace function public.publish_route_plan(p_plan uuid, p_avisos jsonb default '[]'::jsonb)
  returns jsonb language plpgsql set search_path = public as $$
declare
  rol       text := public.current_user_role();
  plan      public.route_plans%rowtype;
  anterior  uuid;
  viejas    jsonb;
  esperadas integer;
  escritas  integer;
  aviso     jsonb;
  nid       uuid;
  avisados  jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or rol is null or rol not in ('admin', 'logistics') or not public.has_deliveries_access() then
    raise exception 'ROUTE_PLAN_FORBIDDEN: only admin or logistics publish a route' using errcode = '42501';
  end if;

  -- El plan, y el publicado vigente de su fecha, quedan bloqueados hasta el final: dos personas publicando a
  -- la vez se ponen en fila, y la segunda ya no encuentra un borrador o encuentra el plan viejo.
  select * into plan from public.route_plans p where p.id = p_plan for update;
  if not found then raise exception 'ROUTE_PLAN_NOT_FOUND'; end if;
  if plan.status <> 'draft' then raise exception 'ROUTE_PLAN_NOT_DRAFT: %', plan.status; end if;
  select p.id into anterior from public.route_plans p
   where p.plan_date = plan.plan_date and p.status = 'published' for update;

  -- Los avisos son lo UNICO que llega de fuera, asi que se comprueban ANTES de escribir nada: cada uno, para
  -- un chofer que sale en ESTE plan o en el publicado que sustituye (el «te quedaste sin paradas»), y con un
  -- texto de largo razonable. Que cualquiera con sesion pueda ya insertar un aviso (001) no es razon para que
  -- publicar sea ademas un camino para avisar, en nombre del sistema, a quien no toca.
  for aviso in select * from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) loop
    if not exists (select 1 from public.route_plan_stops s
                    where s.driver_id = (aviso->>'driver_id')::uuid and s.plan_id in (p_plan, anterior)) then
      raise exception 'ROUTE_PLAN_BAD_NOTICE: % is not a driver of this plan', aviso->>'driver_id';
    end if;
    if char_length(btrim(coalesce(aviso->>'message', ''))) not between 1 and 300 then
      raise exception 'ROUTE_PLAN_BAD_NOTICE: the message must be 1 to 300 characters';
    end if;
  end loop;

  -- ¿Sigue valiendo? Cada orden de la foto tiene que seguir ahi, en una etapa ruteable, y sin haber cambiado.
  -- Una orden que quien publica NO VE cuenta como que no esta: tampoco la podria escribir.
  select jsonb_agg(jsonb_build_object('id', f->>'id', 'motivo',
           case when d.id is null then 'no_esta'
                when d.stage not in ('pending', 'approved', 'fulfilling', 'ready') then 'fuera_de_etapa'
                else 'cambio' end) order by f->>'id')
    into viejas
    from jsonb_array_elements(coalesce(plan.input->'ordenes', '[]'::jsonb)) f
    left join public.deliveries d on d.id = (f->>'id')::uuid
   where d.id is null
      or d.stage not in ('pending', 'approved', 'fulfilling', 'ready')
      or d.updated_at is distinct from (f->>'updated_at')::timestamptz;
  if viejas is not null then
    raise exception 'ROUTE_PLAN_STALE: %', viejas::text;
  end if;

  -- Escribir, y CONTAR. Las mismas cuatro columnas que escribe el Gestor de Rutas.
  esperadas := jsonb_array_length(plan.writes);
  update public.deliveries d
     set assigned_driver = w->>'assigned_driver',
         route_seq       = (w->>'route_seq')::integer,
         load_no         = (w->>'load_no')::integer,
         load_auto       = true
    from jsonb_array_elements(plan.writes) w
   where d.id = (w->>'id')::uuid;
  get diagnostics escritas = row_count;
  if escritas <> esperadas then
    raise exception 'ROUTE_PLAN_UNSEEN: % of % orders could not be written', esperadas - escritas, esperadas;
  end if;

  -- Marcar. El ajuste es local a esta transaccion: es lo unico que deja pasar estas dos transiciones.
  perform set_config('app.route_publishing', 'on', true);
  update public.route_plans set status = 'superseded' where plan_date = plan.plan_date and status = 'published';
  update public.route_plans set status = 'published', published_by = auth.uid(), published_at = now() where id = p_plan;
  perform set_config('app.route_publishing', 'off', true);

  -- Un aviso por chofer (ya comprobados arriba). El id nace aqui, en una variable: no se lee de vuelta una
  -- fila que es de otra persona.
  for aviso in select * from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) loop
    nid := gen_random_uuid();
    insert into public.notifications (id, user_id, kind, message)
    values (nid, (aviso->>'driver_id')::uuid, 'route_published', btrim(aviso->>'message'));
    avisados := avisados || jsonb_build_object('driver_id', aviso->>'driver_id', 'notification_id', nid);
  end loop;

  return jsonb_build_object('plan_id', p_plan, 'written', escritas, 'notifications', avisados);
end $$;

revoke execute on function public.publish_route_plan(uuid, jsonb) from public, anon;
grant execute on function public.publish_route_plan(uuid, jsonb) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.route_plans'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.route_plan_stops'::regclass) then
    raise exception '133: alguna de las dos tablas quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_plans';
  if n <> 3 then raise exception '133: route_plans tiene % politicas, se esperaban 3', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_plan_stops';
  if n <> 4 then raise exception '133: route_plan_stops tiene % politicas, se esperaban 4', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('route_plans', 'route_plan_stops') and cmd = 'ALL';
  if n <> 0 then raise exception '133: hay % politicas FOR ALL', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'route_plans' and cmd = 'DELETE';
  if n <> 0 then raise exception '133: route_plans tiene politica de DELETE'; end if;

  if has_table_privilege('authenticated', 'public.route_plans', 'DELETE')
     or has_table_privilege('anon', 'public.route_plans', 'SELECT')
     or has_table_privilege('anon', 'public.route_plan_stops', 'SELECT') then
    raise exception '133: permisos de mas sobre las tablas de plan';
  end if;

  -- LO MAS IMPORTANTE: publicar corre como quien llama. Si alguien la volviera `security definer`, se saltaria
  -- la RLS y el guard de quien publica sin que nada mas cambiara.
  if (select prosecdef from pg_proc where oid = 'public.publish_route_plan(uuid, jsonb)'::regprocedure) then
    raise exception '133: publish_route_plan quedo como SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.publish_route_plan(uuid, jsonb)', 'EXECUTE') then
    raise exception '133: anon puede ejecutar publish_route_plan';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'route_plans_one_published_idx') then
    raise exception '133: falta el indice de un solo publicado por fecha';
  end if;
  select count(*) into n from pg_trigger
   where not tgisinternal and ((tgrelid = 'public.route_plans'::regclass and tgname in ('route_plans_stamp', 'route_plans_guard'))
      or (tgrelid = 'public.route_plan_stops'::regclass and tgname = 'route_plan_stops_guard'));
  if n <> 3 then raise exception '133: faltan disparadores (hay % de 3)', n; end if;

  -- Lo que esta migracion promete no tocar.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries'
                    and column_name = 'assigned_driver' and data_type = 'text') then
    raise exception '133: deliveries.assigned_driver ya no es text';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop function if exists public.publish_route_plan(uuid, jsonb);
--   drop table if exists public.route_plan_stops;
--   drop table if exists public.route_plans;
--   drop function if exists public.guard_route_plan_stop();
--   drop function if exists public.guard_route_plan();
--   drop function if exists public.route_plan_stamp();
--   delete from public.schema_migrations where name = '133_route_plans.sql';
--
-- Borra los planes guardados. Si interesan, primero
--   create table route_plans_backup as select * from public.route_plans;
--   create table route_plan_stops_backup as select * from public.route_plan_stops;
-- Lo que publicar escribio en `deliveries` SE QUEDA: son asignaciones validas, las mismas que habria hecho el
-- Gestor de Rutas. Los avisos ya enviados tambien.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Con la 133 aplicada DENTRO de la misma transaccion. Hace falta un dia con ordenes ruteables. <plan> es un
-- borrador creado en A1 con `input.ordenes` = la foto de esas ordenes y `writes` = que escribir en cada una;
-- sus paradas llevan el `driver_id` de tres choferes. `pg_temp.intenta` es el ayudante de la 123.
--
--   set local role authenticated;
--
--   -- A. Logistica SIN tiendas marcadas.
--   set local request.jwt.claims = '{"sub":"<uuid-logistica>","role":"authenticated"}';
--   A1 insert de un plan mandando status='published', version=99, created_by=<otro>              -> PERMITIDO, y queda draft, version 1, created_by = ella
--   A2 insert de sus paradas; update de una; delete de una                                       -> PERMITIDO
--   A3 update public.route_plans set status = 'published' where id = <plan>                      -> BLOQUEADO (solo por la funcion)
--   A4 delete from public.route_plans where id = <plan>                                          -> BLOQUEADO (permiso)
--   A5 select public.publish_route_plan(<plan>, <3 avisos>)                                      -> PERMITIDO
--      despues, como postgres:  14 ordenes con assigned_driver/route_seq/load_no/load_auto       -> 14 filas
--                               select count(*) from notifications where kind = 'route_published' -> 3, no 14
--                               el plan: published, con published_by = ella
--   A6 update del plan publicado (cualquier columna); update / delete de una parada suya          -> BLOQUEADO (historia)
--   A7 update de una parada publicada tocando SOLO actual_arrival_at                             -> PERMITIDO
--   A8 otro borrador de la misma fecha, y publicarlo                                             -> PERMITIDO; el anterior pasa a superseded; sigue habiendo UN published
--   A9 publicar OTRA VEZ el mismo plan                                                           -> BLOQUEADO (ROUTE_PLAN_NOT_DRAFT)
--   A10 publicar con 0 avisos (re-publicar sin cambios)                                          -> PERMITIDO, 0 avisos nuevos
--   A11 publicar con un aviso para alguien que no sale ni en este plan ni en el que sustituye    -> BLOQUEADO (ROUTE_PLAN_BAD_NOTICE), y NADA escrito
--   A12 lo mismo con un texto vacio, o de mas de 300 caracteres                                  -> BLOQUEADO (ROUTE_PLAN_BAD_NOTICE)
--   A13 un aviso «sin ruta» para un chofer que SOLO sale en el publicado que se sustituye         -> PERMITIDO
--
--   -- B. Plan viejo.
--   B1 como postgres: update public.deliveries set delivery_notes = 'x' where id = <una del plan>;  (cambia su updated_at)
--      como logistica: publicar                                                                  -> BLOQUEADO (ROUTE_PLAN_STALE con esa orden), y NADA escrito
--   B2 una orden del plan pasa a picked_up                                                       -> BLOQUEADO (fuera_de_etapa)
--
--   -- C. Logistica CON una tienda marcada (profiles.visible_stores), y un plan con ordenes de otras tiendas.
--   C1 publicar                                                                                  -> BLOQUEADO (ROUTE_PLAN_STALE: no_esta), y NADA escrito: ninguna orden cambia
--
--   -- D. Logistica publica una orden en `pending` (el guard vigente, 127, la deja editar en misma etapa).
--   D1 un plan con una sola orden en pending, publicar                                           -> PERMITIDO
--
--   -- E. Los demas.
--   set local request.jwt.claims = '{"sub":"<uuid-gerente>","role":"authenticated"}';
--   E1 select count(*) from public.route_plans; insert; publicar                                 -> los ve; BLOQUEADO (RLS); BLOQUEADO (ROUTE_PLAN_FORBIDDEN)
--   set local request.jwt.claims = '{"sub":"<uuid-almacen>","role":"authenticated"}';
--   E2 ve los publicados y sus paradas; de un borrador                                           -> los ve; 0 filas
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   E3 select count(*) de planes y de paradas; publicar                                          -> 0 y 0; BLOQUEADO
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   E4 lo mismo                                                                                  -> 0 y 0; BLOQUEADO
--
--   -- F. Ni la llave de servicio. Y borrar un perfil no se atasca.
--   reset role; set local role service_role;
--   F1 update public.route_plans set total_minutes = 1 where status = 'published'                -> BLOQUEADO (historia)
--   F2 update public.route_plans set status = 'published' where status = 'draft'                 -> BLOQUEADO (solo por la funcion)
--   F3 update public.route_plans set published_by = null, created_by = null where status = 'published'
--      (lo que hace `on delete set null` al borrar a quien lo publico; NO borrar un perfil real)  -> PERMITIDO
--   F4 lo mismo tocando ademas otra columna                                                      -> BLOQUEADO (historia)
--
--   rollback;
--
-- No verificado al escribirlo: nada de esto se ha corrido. En particular, que `authenticated` pueda hacer
-- `set_config('app.route_publishing', ...)` dentro de la funcion (es un ajuste con prefijo propio, que
-- cualquier rol puede fijar; PostgREST no deja fijarlo desde fuera porque `set_config` no es una funcion
-- expuesta), y el `for update` sobre filas que pasan por RLS.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('133_route_plans.sql', '7a741fac64c365750b76544fedc76cd28589f5b6140f557b317dcabc51b96f6a') on conflict (name) do nothing;
