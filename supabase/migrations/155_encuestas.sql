-- ===========================================================================
-- 155 - Encuestas de clientes: la tabla de respuestas, la funcion con la que el sitio publico las
--       guarda, el rol de base que usa ese sitio, y la lectura para la app «Encuestas» del hub
-- ===========================================================================
-- Plan en papel: docs/PLAN-155-encuestas.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-09-29) pidio una encuesta de clientes en dos partes: un sitio publico en Vercel que
-- rellena el cliente, y una app en el hub para ver los resultados. "Customers must only ever have
-- access to the Vercel survey site, never to RTG hub or anything else in the database."
--
-- QUE TRAE:
--   0. 'surveys' en profiles_module_access_known (la ULTIMA definicion es la 148: se parte de su
--      cuerpo y se anade una palabra).
--   1. has_surveys_access(): admin, o 'surveys' en module_access. Misma forma que has_estimator_access().
--   2. Tres validadores inmutables que usan los CHECK de la tabla.
--   3. public.survey_responses con sus CHECK: la base rechaza una fila incoherente aunque alguien la
--      escriba sin pasar por la funcion (service-role, SQL a mano).
--   4. RLS: UNA politica, de SELECT, para quien tiene el modulo. Nadie tiene INSERT, UPDATE ni DELETE
--      por la API: se escribe solo por las dos funciones de abajo.
--   5. submit_survey_response(jsonb): la UNICA puerta del sitio publico. Valida todo y mete una fila.
--   6. mark_survey_contacted(uuid, boolean): marcar o desmarcar «contactado» desde la app. Solo toca
--      contacted y contacted_at, y pone la hora la base.
--   7. El rol encuesta_web: NOLOGIN al crearse. La contrasena y el LOGIN NO van en el repo: los pone
--      el orquestador aparte (alter role encuesta_web login password '...'), ver el plan, seccion 9.
--
-- LO QUE NO TOCA: ninguna tabla existente salvo la restriccion de profiles de la seccion 0. Ningun
-- dato: no hay UPDATE ni INSERT sobre filas que ya esten. Ningun privilegio de otro rol.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. La restriccion que prohibe la palabra. LO UNICO QUE TOCA ALGO EXISTENTE.
-- ---------------------------------------------------------------------------
-- La 148 la dejo en: check (module_access is null or module_access <@
--   array['deliveries','recruiting','timetracker','erp','promos','estimator']) not valid
-- (medido en produccion el 2026-09-29, solo lectura: es exactamente esa). Sin anadir 'surveys',
-- conceder el modulo desde Usuarios revienta contra ella. Se conserva `not valid` por la razon de la
-- 095: las filas viejas no se re-examinan; las altas y los cambios si.
alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys'])
  not valid;

-- ---------------------------------------------------------------------------
-- 1. Quien ve los resultados. Mismo idioma que has_estimator_access() (148).
-- ---------------------------------------------------------------------------
-- El admin siempre: quien reparte el modulo no puede quedarse fuera de el. El resto, solo con la
-- casilla. De partida no la tiene nadie que no sea admin.
create or replace function public.has_surveys_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'admin' or 'surveys' = any(coalesce(module_access, '{}'))
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 2. Validadores para los CHECK. Inmutables y sin leer ninguna tabla.
-- ---------------------------------------------------------------------------
-- Las ocho claves estables de las areas. Si algun dia cambian, cambian aqui, en la funcion de la
-- seccion 5 y en src/lib/encuestas/areas.ts (una prueba compara las tres).
create or replace function public.survey_areas_valid(p_areas text[])
  returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_areas is not null
     and array_position(p_areas, null) is null
     and p_areas <@ array['staff_service','wait_time','product_availability','product_quality',
                          'pricing','delivery_pickup','returns_exchanges','other']::text[]
     and cardinality(p_areas) = (select count(distinct x) from unnest(p_areas) x);
$$;

-- Cada calificacion es un numero entero del 1 al 5, y las claves son EXACTAMENTE las areas elegidas.
-- `(value)::text` de un numero jsonb da su forma canonica: 3 -> '3', 3.0 -> '3.0', "3" es texto.
create or replace function public.survey_ratings_valid(p_ratings jsonb, p_areas text[])
  returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_ratings is not null
     and jsonb_typeof(p_ratings) = 'object'
     and not exists (select 1 from jsonb_each(p_ratings) e
                      where jsonb_typeof(e.value) <> 'number' or e.value::text !~ '^[1-5]$')
     and (select coalesce(array_agg(k order by k), '{}'::text[]) from jsonb_object_keys(p_ratings) k)
       = (select coalesce(array_agg(a order by a), '{}'::text[]) from unnest(p_areas) a);
$$;

-- Un campo de texto del payload: ausente o null -> null; si no es texto, error; recortado; en blanco
-- -> null. Asi "" y "   " valen lo mismo que no mandarlo, y las reglas de abajo solo miran null.
create or replace function public.survey_payload_text(p_payload jsonb, p_key text)
  returns text language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if not (p_payload ? p_key) or jsonb_typeof(p_payload -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_payload -> p_key) <> 'string' then
    raise exception 'survey: % must be text or null', p_key using errcode = '22023';
  end if;
  return nullif(btrim(p_payload ->> p_key), '');
end $$;

-- ---------------------------------------------------------------------------
-- 3. La tabla. Los CHECK repiten las reglas de la funcion: la funcion da el mensaje claro, la tabla
--    garantiza que ni siquiera una escritura a mano deja una fila incoherente.
-- ---------------------------------------------------------------------------
create table if not exists public.survey_responses (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  nothing_to_improve  boolean not null,
  selected_areas      text[] not null default '{}',
  other_text          text,
  ratings             jsonb not null default '{}'::jsonb,
  wants_contact       boolean not null,
  contact_name        text,
  contact_phone       text,
  contact_email       text,
  contacted           boolean not null default false,
  contacted_at        timestamptz,
  constraint survey_responses_areas check (public.survey_areas_valid(selected_areas)),
  -- «Nada, todo estuvo bien» es exclusiva: con ella no hay areas; sin ella, al menos una.
  constraint survey_responses_nothing check (
    (nothing_to_improve and cardinality(selected_areas) = 0)
    or (not nothing_to_improve and cardinality(selected_areas) >= 1)
  ),
  constraint survey_responses_ratings check (public.survey_ratings_valid(ratings, selected_areas)),
  constraint survey_responses_other check (
    case when 'other' = any(selected_areas)
         then other_text is not null and length(btrim(other_text)) between 1 and 500
         else other_text is null end
  ),
  -- Contacto presente si lo pidio (nombre, y telefono o correo); si no, los tres nulos.
  constraint survey_responses_contact check (
    case when wants_contact
         then contact_name is not null and length(btrim(contact_name)) between 1 and 120
              and (contact_phone is not null or contact_email is not null)
         else contact_name is null and contact_phone is null and contact_email is null end
  ),
  constraint survey_responses_phone check (
    contact_phone is null
    or (length(contact_phone) <= 30
        and contact_phone ~ '^[0-9+().[:space:]-]+$'
        and length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) between 7 and 15)
  ),
  constraint survey_responses_email check (
    contact_email is null
    or (length(contact_email) <= 254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint survey_responses_contacted check (
    (contacted and contacted_at is not null) or (not contacted and contacted_at is null)
  )
);

create index if not exists survey_responses_created_idx on public.survey_responses (created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Privilegios y RLS. Una tabla nueva nace con todo concedido a anon y authenticated (los default
--    privileges de postgres en public, medidos el 2026-09-29): se revoca y se concede lo justo.
--    authenticated: SOLO select, y la politica lo deja en quien tiene el modulo. Nadie escribe por la
--    API: el sitio escribe por submit_survey_response y la app marca por mark_survey_contacted.
-- ---------------------------------------------------------------------------
revoke all on public.survey_responses from public, anon, authenticated;
grant select on public.survey_responses to authenticated;

alter table public.survey_responses enable row level security;

drop policy if exists "survey_responses select" on public.survey_responses;
create policy "survey_responses select" on public.survey_responses for select to authenticated
  using ((select public.has_surveys_access()));

-- ---------------------------------------------------------------------------
-- 5. La puerta del sitio publico. Definer: escribe como el dueno de la tabla, que salta la RLS; el
--    rol del sitio no tiene NINGUN privilegio sobre la tabla.
-- ---------------------------------------------------------------------------
-- No se confia en nada del sitio: cada regla de la encuesta se comprueba aqui y un fallo lanza
-- 22023 con un mensaje que empieza por 'survey: ' y dice que falta. Campos desconocidos: error, para
-- que un cambio de forma en el sitio se note el primer dia en vez de perderse en silencio.
create or replace function public.submit_survey_response(payload jsonb)
  returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_key     text;
  v_area    text;
  v_el      jsonb;
  v_nothing boolean;
  v_areas   text[] := '{}';
  v_other   text;
  v_ratings jsonb;
  v_wants   boolean;
  v_name    text;
  v_phone   text;
  v_email   text;
  v_id      uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'survey: the payload must be a JSON object' using errcode = '22023';
  end if;
  if length(payload::text) > 8000 then
    raise exception 'survey: the payload is too large' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(payload) loop
    if v_key not in ('nothing_to_improve', 'selected_areas', 'other_text', 'ratings', 'wants_contact',
                     'contact_name', 'contact_phone', 'contact_email') then
      raise exception 'survey: unknown field "%"', v_key using errcode = '22023';
    end if;
  end loop;

  -- Tipos.
  if jsonb_typeof(payload -> 'nothing_to_improve') is distinct from 'boolean' then
    raise exception 'survey: nothing_to_improve must be true or false' using errcode = '22023';
  end if;
  v_nothing := (payload ->> 'nothing_to_improve')::boolean;
  if jsonb_typeof(payload -> 'wants_contact') is distinct from 'boolean' then
    raise exception 'survey: wants_contact must be true or false' using errcode = '22023';
  end if;
  v_wants := (payload ->> 'wants_contact')::boolean;
  if jsonb_typeof(payload -> 'selected_areas') is distinct from 'array' then
    raise exception 'survey: selected_areas must be a list' using errcode = '22023';
  end if;
  if jsonb_typeof(payload -> 'ratings') is distinct from 'object' then
    raise exception 'survey: ratings must be an object' using errcode = '22023';
  end if;
  v_ratings := payload -> 'ratings';

  -- Areas: claves conocidas y sin repetir.
  for v_el in select value from jsonb_array_elements(payload -> 'selected_areas') loop
    if jsonb_typeof(v_el) <> 'string' then
      raise exception 'survey: every selected area must be a text key' using errcode = '22023';
    end if;
    v_area := v_el #>> '{}';
    if v_area not in ('staff_service', 'wait_time', 'product_availability', 'product_quality',
                      'pricing', 'delivery_pickup', 'returns_exchanges', 'other') then
      raise exception 'survey: unknown area "%"', v_area using errcode = '22023';
    end if;
    if v_area = any(v_areas) then
      raise exception 'survey: area "%" is repeated', v_area using errcode = '22023';
    end if;
    v_areas := v_areas || v_area;
  end loop;

  v_other := public.survey_payload_text(payload, 'other_text');
  v_name  := public.survey_payload_text(payload, 'contact_name');
  v_phone := public.survey_payload_text(payload, 'contact_phone');
  v_email := public.survey_payload_text(payload, 'contact_email');

  -- «Nada, todo estuvo bien» es exclusiva.
  if v_nothing then
    if cardinality(v_areas) > 0 then
      raise exception 'survey: "nothing to improve" cannot be combined with other areas' using errcode = '22023';
    end if;
  elsif cardinality(v_areas) = 0 then
    raise exception 'survey: choose at least one area, or "nothing to improve"' using errcode = '22023';
  end if;

  -- «Other» exige su texto; sin «Other», no hay texto.
  if 'other' = any(v_areas) then
    if v_other is null then
      raise exception 'survey: "other" needs its text' using errcode = '22023';
    end if;
    if length(v_other) > 500 then
      raise exception 'survey: other_text is longer than 500 characters' using errcode = '22023';
    end if;
  elsif v_other is not null then
    raise exception 'survey: other_text is only for the "other" area' using errcode = '22023';
  end if;

  -- Calificaciones: exactamente las areas elegidas, cada una un entero del 1 al 5.
  for v_key in select jsonb_object_keys(v_ratings) loop
    if not (v_key = any(v_areas)) then
      raise exception 'survey: rating for "%", which was not selected', v_key using errcode = '22023';
    end if;
  end loop;
  foreach v_area in array v_areas loop
    if not (v_ratings ? v_area) then
      raise exception 'survey: missing rating for "%"', v_area using errcode = '22023';
    end if;
    if jsonb_typeof(v_ratings -> v_area) <> 'number' or (v_ratings -> v_area)::text !~ '^[1-5]$' then
      raise exception 'survey: the rating for "%" must be a whole number from 1 to 5', v_area using errcode = '22023';
    end if;
  end loop;

  -- Contacto.
  if v_wants then
    if v_name is null then
      raise exception 'survey: a name is required to be contacted' using errcode = '22023';
    end if;
    if length(v_name) > 120 then
      raise exception 'survey: the name is longer than 120 characters' using errcode = '22023';
    end if;
    if v_phone is null and v_email is null then
      raise exception 'survey: a phone or an email is required to be contacted' using errcode = '22023';
    end if;
    if v_phone is not null and (length(v_phone) > 30 or v_phone !~ '^[0-9+().[:space:]-]+$') then
      raise exception 'survey: the phone number is not valid' using errcode = '22023';
    end if;
    if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
      raise exception 'survey: the phone number must have 7 to 15 digits' using errcode = '22023';
    end if;
    if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      raise exception 'survey: the email is not valid' using errcode = '22023';
    end if;
  elsif v_name is not null or v_phone is not null or v_email is not null then
    raise exception 'survey: contact details are only kept when wants_contact is true' using errcode = '22023';
  end if;

  insert into public.survey_responses
    (nothing_to_improve, selected_areas, other_text, ratings, wants_contact, contact_name, contact_phone, contact_email)
  values
    (v_nothing, v_areas, v_other, v_ratings, v_wants, v_name, v_phone, v_email)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Marcar «contactado». Funcion y no UPDATE sobre la tabla: con una politica de UPDATE y grant de
--    columnas, el navegador podria poner cualquier contacted_at (una fecha inventada); aqui la pone
--    la base, y la tabla sigue sin ninguna escritura por la API.
-- ---------------------------------------------------------------------------
-- Solo filas que pidieron contacto. Volver a marcar conserva la hora del primer marcado; desmarcar la
-- borra. Devuelve la hora que quedo (null al desmarcar).
create or replace function public.mark_survey_contacted(p_id uuid, p_value boolean)
  returns timestamptz language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_at timestamptz;
begin
  if not public.has_surveys_access() then
    raise exception 'survey: only someone with the Surveys module can mark a response as contacted' using errcode = '42501';
  end if;
  if p_id is null or p_value is null then
    raise exception 'survey: response id and value are required' using errcode = '22023';
  end if;
  update public.survey_responses
     set contacted = p_value,
         contacted_at = case when not p_value then null
                             when contacted then contacted_at
                             else now() end
   where id = p_id and wants_contact
  returning contacted_at into v_at;
  if not found then
    raise exception 'survey: no response with that id asked to be contacted' using errcode = 'P0002';
  end if;
  return v_at;
end $$;

-- ---------------------------------------------------------------------------
-- 7. El rol del sitio publico.
-- ---------------------------------------------------------------------------
-- NOLOGIN al crearse, y si ya existe NO se toca su LOGIN: re-ejecutar el fichero no debe dejar al
-- sitio fuera. Sin superuser, createdb, createrole, replication ni bypassrls (los defectos de
-- CREATE ROLE; la autocomprobacion lo mira en vez de alterarlos, porque cambiar bypassrls exige
-- tenerlo).
do $rol$
begin
  if not exists (select 1 from pg_roles where rolname = 'encuesta_web') then
    create role encuesta_web nologin;
  end if;
end $rol$;

-- Un tope por sentencia: el sitio solo llama una funcion corta, y una conexion colgada no debe
-- ocupar la base.
alter role encuesta_web set statement_timeout = '5s';

-- Lo que tiene: USAGE en public y EXECUTE en submit. Y nada mas explicito: se revoca todo lo que
-- se le hubiera dado a el por nombre (en un rol nuevo no hay nada; en una re-ejecucion, limpia).
--
-- LO QUE NO SE PUEDE REVOCAR POR ROL: lo concedido a PUBLIC. Medido el 2026-09-29 (solo lectura):
--   * PUBLIC tiene USAGE en el esquema public (`=U/pg_database_owner`): el grant de abajo es
--     redundante, se deja para que sea explicito.
--   * 30 funciones de public tienen EXECUTE para PUBLIC; 19 son disparadores (no se pueden llamar a
--     mano) y 11 devuelven boolean o text (is_admin, current_user_role, has_*_access...). Ninguna
--     devuelve filas. Esta 155 NO las toca: el plan, seccion 9, lo explica y deja el endurecimiento
--     opcional aparte.
--   * Ninguna tabla ni vista de un esquema con USAGE para PUBLIC tiene privilegios para PUBLIC.
--   Los default privileges de postgres y supabase_admin en public nombran a anon, authenticated y
--   service_role, nunca a PUBLIC para tablas: lo que se cree despues NO le llega a encuesta_web.
revoke all on all tables    in schema public from encuesta_web;
revoke all on all sequences in schema public from encuesta_web;
revoke all on all functions in schema public from encuesta_web;
revoke all on schema public from encuesta_web;
grant usage on schema public to encuesta_web;

-- Las funciones nuevas: nadie por PUBLIC. Los default privileges de postgres las dan a anon,
-- authenticated y service_role; se quitan las que no tocan.
revoke execute on function public.submit_survey_response(jsonb)          from public, anon, authenticated;
revoke execute on function public.mark_survey_contacted(uuid, boolean)   from public, anon, authenticated, encuesta_web;
revoke execute on function public.has_surveys_access()                   from public, anon;
revoke execute on function public.survey_areas_valid(text[])             from public, anon, authenticated;
revoke execute on function public.survey_ratings_valid(jsonb, text[])    from public, anon, authenticated;
revoke execute on function public.survey_payload_text(jsonb, text)       from public, anon, authenticated;

grant execute on function public.submit_survey_response(jsonb)           to encuesta_web, service_role;
grant execute on function public.mark_survey_contacted(uuid, boolean)    to authenticated;
grant execute on function public.has_surveys_access()                    to authenticated;

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n   int;
  col text;
  r   record;
begin
  -- La restriccion acepta 'surveys' y no perdio ninguna de las seis de la 148, ni recupero 'clockin'.
  foreach col in array array['deliveries', 'recruiting', 'timetracker', 'erp', 'promos', 'estimator', 'surveys'] loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
                     and conname = 'profiles_module_access_known'
                     and pg_get_constraintdef(oid) like '%''' || col || '''%') then
      raise exception '155: profiles_module_access_known no acepta %', col;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
               and conname = 'profiles_module_access_known'
               and pg_get_constraintdef(oid) like '%clockin%') then
    raise exception '155: profiles_module_access_known volvio a aceptar clockin';
  end if;

  -- RLS puesta, UNA politica y de SELECT, mirando el modulo.
  if not (select relrowsecurity from pg_class where oid = 'public.survey_responses'::regclass) then
    raise exception '155: survey_responses sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'survey_responses';
  if n <> 1 then raise exception '155: survey_responses debe tener 1 politica, tiene %', n; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'survey_responses'
                   and cmd = 'SELECT' and qual ~ 'has_surveys_access') then
    raise exception '155: la politica de survey_responses no es SELECT con has_surveys_access';
  end if;

  -- anon nada; authenticated solo leer; encuesta_web nada sobre la tabla.
  foreach col in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('anon', 'public.survey_responses', col) then
      raise exception '155: anon tiene % en survey_responses', col;
    end if;
    if has_table_privilege('encuesta_web', 'public.survey_responses', col) then
      raise exception '155: encuesta_web tiene % en survey_responses', col;
    end if;
    if col <> 'select' and has_table_privilege('authenticated', 'public.survey_responses', col) then
      raise exception '155: authenticated tiene % en survey_responses', col;
    end if;
  end loop;

  -- Quien ejecuta que.
  if not has_function_privilege('encuesta_web', 'public.submit_survey_response(jsonb)', 'execute') then
    raise exception '155: encuesta_web no puede ejecutar submit_survey_response';
  end if;
  if has_function_privilege('anon', 'public.submit_survey_response(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.submit_survey_response(jsonb)', 'execute') then
    raise exception '155: anon o authenticated pueden ejecutar submit_survey_response';
  end if;
  if has_function_privilege('encuesta_web', 'public.mark_survey_contacted(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.mark_survey_contacted(uuid, boolean)', 'execute') then
    raise exception '155: encuesta_web o anon pueden ejecutar mark_survey_contacted';
  end if;

  -- El rol: sin atributos peligrosos y sin pertenecer a ningun otro rol.
  if exists (select 1 from pg_roles where rolname = 'encuesta_web'
               and (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls)) then
    raise exception '155: encuesta_web tiene un atributo que no debe';
  end if;
  if exists (select 1 from pg_auth_members where member = 'encuesta_web'::regrole) then
    raise exception '155: encuesta_web pertenece a otro rol';
  end if;

  -- Ninguna tabla, vista ni secuencia a su alcance, en NINGUN esquema donde tenga USAGE.
  for r in
    select c.oid::regclass::text as rel
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
       and s.nspname not in ('pg_catalog', 'information_schema')
       and has_schema_privilege('encuesta_web', s.oid, 'usage')
       and (has_table_privilege('encuesta_web', c.oid, 'select')
            or has_table_privilege('encuesta_web', c.oid, 'insert')
            or has_table_privilege('encuesta_web', c.oid, 'update')
            or has_table_privilege('encuesta_web', c.oid, 'delete'))
  loop
    raise exception '155: encuesta_web alcanza %', r.rel;
  end loop;

  -- Ninguna funcion a su alcance que devuelva filas, salvo submit (que devuelve un uuid). Las que
  -- quedan por PUBLIC devuelven boolean, text o trigger (medido); una nueva que devolviera una tabla
  -- o un json haria fallar esto, que es justo lo que se quiere saber.
  for r in
    select p.oid::regprocedure::text as fn
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname not in ('pg_catalog', 'information_schema')
       and has_schema_privilege('encuesta_web', s.oid, 'usage')
       and has_function_privilege('encuesta_web', p.oid, 'execute')
       and p.oid <> 'public.submit_survey_response(jsonb)'::regprocedure
       and (p.proretset or p.prorettype not in ('boolean'::regtype, 'text'::regtype, 'trigger'::regtype))
  loop
    raise exception '155: encuesta_web puede ejecutar %, que devuelve datos', r.fn;
  end loop;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: en el plan (docs/PLAN-155-encuestas.md, seccion 6). Aqui no va
-- ejecutable a proposito: cualquier sentencia de este fichero corre al aplicarlo.
-- ===========================================================================

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia; por eso lleva begin/commit y el fichero no)
-- ---------------------------------------------------------------------------
-- AVISO: el drop BORRA las respuestas guardadas: de eso protege el pg_dump. Quitar la palabra de los
-- perfiles va ANTES que la restriccion, o la siguiente escritura del perfil de quien la tenga falla.
-- El rol se borra al final; si tiene LOGIN y el sitio esta conectado, `drop role` falla hasta que
-- se corte (primero: alter role encuesta_web nologin; y cortar sus conexiones).
--
--   begin;
--   update public.profiles set module_access = array_remove(module_access, 'surveys')
--    where 'surveys' = any (coalesce(module_access, '{}'));
--   drop function if exists public.mark_survey_contacted(uuid, boolean);
--   drop function if exists public.submit_survey_response(jsonb);
--   drop table    if exists public.survey_responses;
--   drop function if exists public.survey_payload_text(jsonb, text);
--   drop function if exists public.survey_ratings_valid(jsonb, text[]);
--   drop function if exists public.survey_areas_valid(text[]);
--   drop function if exists public.has_surveys_access();
--   -- La restriccion EXACTAMENTE como la dejo la 148.
--   alter table public.profiles drop constraint if exists profiles_module_access_known;
--   alter table public.profiles add constraint profiles_module_access_known
--     check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator'])
--     not valid;
--   revoke usage on schema public from encuesta_web;
--   drop role if exists encuesta_web;
--   delete from public.schema_migrations where name = '155_encuestas.sql';
--   commit;
-- La app no se rompe: sin la tabla, la pantalla dice que la 155 no esta aplicada.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('155_encuestas.sql', 'd620288042d90b2732edc715416264df93cf1f9b13734272f431b42158dbed7d') on conflict (name) do nothing;
