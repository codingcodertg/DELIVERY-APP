-- 151 - Requisitos del camion (skills de OptimoRoute) y encuesta de satisfaccion en el seguimiento
-- ===========================================================================
-- El dueno, 2026-09-27, tras explicarle OptimoRoute: "solos haz 1 3 y 4". El 4 son dos cosas menores:
--   A) una orden puede pedir algo del camion (liftgate, montacargas, camion grande, dos personas) y cada
--      chofer declara lo que tiene; lo automatico no le da una orden a un chofer que no lo tiene;
--   (Auto-asignar queda fuera de esta rama: el orquestador lo saco del alcance porque otra lo reescribe sobre el motor.)
--   B) una encuesta de 1-5 estrellas y comentario en la pagina publica de seguimiento, con la orden entregada.
--
-- Plan en papel: docs/PLAN-151-requisitos-y-encuesta.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues. El numero es 151 y no 150 porque otra
-- rama (avisos al cliente) esta escribiendo la 150; el registro no exige numeros seguidos.
--
-- Que trae, y SOLO esto:
--   1. public.settings.delivery_requirements  text[] not null default '{}'  -- el catalogo, lo edita el admin
--   2. public.deliveries.requirements         text[] not null default '{}'  -- lo que pide cada orden
--   3. public.driver_settings.features        text[] not null default '{}'  -- lo que tiene cada camion
--   4. public.delivery_surveys, una fila por orden (la clave primaria ES la orden), con RLS de solo lectura
--      para admin, logistica y gerente, y SIN ninguna politica de escritura: solo escribe la llave de servicio,
--      desde /api/track/<id>/survey. Un disparador exige que la orden este entregada.
--   NO toca guard_delivery_stage (145), guard_factura_obligatoria (146), ni las politicas de deliveries,
--   settings o driver_settings, ni ninguna fila (los defectos las leen como '{}').
--
-- Decisiones, con su motivo:
--   1. LOS REQUISITOS SON NOMBRES (text[]), no ids de otra tabla. El catalogo es una lista corta que edita el
--      admin (como route_hard_windows, 130); la app compara sin mayusculas y SOLO cuenta lo que esta en el
--      catalogo, asi que quitar uno de la lista lo apaga en todas las ordenes y camiones a la vez. Una tabla de
--      catalogo con FK obligaria a borrar en cascada o a bloquear el borrado; aqui no hace falta ninguna de las dos.
--   2. NOT NULL con defecto '{}': en Postgres 11+ una columna nueva con defecto constante no reescribe la tabla.
--      Sin nulos, "no pide nada" tiene una sola forma.
--   3. QUIEN CAMBIA LOS REQUISITOS DE UNA ORDEN: los mismos que cualquier otro campo (el guard de etapas no mira
--      columnas en "misma etapa"; ver la 147, decision 3, que midio lo mismo para priority). Los del camion: admin
--      y logistica, por las politicas de driver_settings (128). El catalogo: el admin, por las de settings (100).
--   4. LA ENCUESTA NO ES UNA COLUMNA DE deliveries. Las de la 021 (csat_rating, csat_comment) siguen ahi sin
--      usarse (D-043). Una tabla aparte porque (a) su lectura es mas estrecha que la de la orden: el chofer y
--      ventas leen deliveries y NO deben ver la calificacion (D-026, D-043); (b) la escribe la llave de servicio
--      sin pasar por los guards ni por el rastro de ediciones de la orden; (c) "una por orden" es la clave primaria.
--   5. QUIEN LEE LA ENCUESTA: admin, logistica y gerente, con acceso al modulo de Entregas, y solo de ordenes que
--      YA puede ver (el exists sobre deliveries corre con la RLS de quien pregunta: la visibilidad por tienda de la
--      131 vale sola). El recorte fino por "sus tiendas" del Panel lo hace la pantalla, como en D-396.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de
-- dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Requisitos del camion
-- ---------------------------------------------------------------------------
alter table public.settings
  add column if not exists delivery_requirements text[] not null default '{}'::text[];
alter table public.settings drop constraint if exists settings_delivery_requirements_shape;
alter table public.settings
  add constraint settings_delivery_requirements_shape
  check (cardinality(delivery_requirements) <= 30 and array_position(delivery_requirements, null) is null);
comment on column public.settings.delivery_requirements is
  'Catalogo de requisitos del camion (151): nombres, p. ej. Liftgate. Lo edita el admin en Ajustes. Solo cuenta lo que esta aqui.';

alter table public.deliveries
  add column if not exists requirements text[] not null default '{}'::text[];
alter table public.deliveries drop constraint if exists deliveries_requirements_shape;
alter table public.deliveries
  add constraint deliveries_requirements_shape
  check (cardinality(requirements) <= 30 and array_position(requirements, null) is null);
comment on column public.deliveries.requirements is
  'Lo que la orden pide del camion (151): nombres de settings.delivery_requirements. Vacio = nada. Planificar el dia y Mejor lugar no la dan a un chofer que no lo tiene.';

alter table public.driver_settings
  add column if not exists features text[] not null default '{}'::text[];
alter table public.driver_settings drop constraint if exists driver_settings_features_shape;
alter table public.driver_settings
  add constraint driver_settings_features_shape
  check (cardinality(features) <= 30 and array_position(features, null) is null);
comment on column public.driver_settings.features is
  'Lo que tiene el camion de este chofer (151): nombres de settings.delivery_requirements.';

-- ---------------------------------------------------------------------------
-- B. Encuesta de satisfaccion
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_surveys (
  delivery_id uuid primary key references public.deliveries(id) on delete cascade,
  rating      smallint not null,
  comment     text,
  created_at  timestamptz not null default now(),
  constraint delivery_surveys_rating_1_a_5 check (rating between 1 and 5),
  constraint delivery_surveys_comment_len check (comment is null or (char_length(comment) between 1 and 500))
);
comment on table public.delivery_surveys is
  'Encuesta de la pagina publica de seguimiento (151): 1-5 estrellas y comentario, una por orden, solo entregada. La escribe /api/track/<id>/survey con la llave de servicio; la leen admin, logistica y gerente.';

-- Solo una orden ENTREGADA se califica. La ruta ya lo comprueba; esto es la base diciendolo tambien, para que
-- ningun otro camino con la llave de servicio (un guion, una prueba) lo salte. Lee deliveries sin RLS a proposito
-- (security definer): la pregunta es sobre la orden, no sobre quien inserta.
create or replace function public.delivery_surveys_solo_entregada()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.deliveries d where d.id = NEW.delivery_id and d.stage = 'delivered') then
    raise exception 'SURVEY_NOT_DELIVERED: la orden % no esta entregada', NEW.delivery_id using errcode = '23514';
  end if;
  return NEW;
end $$;

revoke execute on function public.delivery_surveys_solo_entregada() from public, anon, authenticated;

drop trigger if exists delivery_surveys_solo_entregada on public.delivery_surveys;
create trigger delivery_surveys_solo_entregada
  before insert or update on public.delivery_surveys
  for each row execute function public.delivery_surveys_solo_entregada();

alter table public.delivery_surveys enable row level security;

-- El revoke va primero: en Supabase los privilegios por defecto dan TODO a anon y authenticated sobre cada
-- tabla nueva, y un grant a secas no quita nada (medido al ensayar la 126).
revoke all on public.delivery_surveys from anon, authenticated;
grant select on public.delivery_surveys to authenticated;
-- La llave de servicio salta la RLS, pero no los privilegios: se le da explicitamente lo que usa la ruta.
grant select, insert on public.delivery_surveys to service_role;

drop policy if exists "delivery_surveys select" on public.delivery_surveys;
create policy "delivery_surveys select" on public.delivery_surveys for select to authenticated
  using ((select public.has_deliveries_access())
     and (select public.current_user_role()) in ('admin', 'logistics', 'manager')
     and exists (select 1 from public.deliveries d where d.id = delivery_surveys.delivery_id));

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
-- Lo de las funciones se mira sobre el CODIGO, sin las lineas de comentario (leccion de la 144).
do $chk$
declare
  guard   text := regexp_replace(regexp_replace(pg_get_functiondef('public.guard_delivery_stage()'::regprocedure),
                                                '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  f146    regprocedure := to_regprocedure('public.guard_factura_obligatoria()');
  factura text;
  n       int;
begin
  -- Las tres columnas: text[], sin nulos, con '{}' por defecto.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and data_type = 'ARRAY' and udt_name = '_text' and is_nullable = 'NO'
     and column_default like '''{}''%'
     and ((table_name = 'settings' and column_name = 'delivery_requirements')
       or (table_name = 'deliveries' and column_name = 'requirements')
       or (table_name = 'driver_settings' and column_name = 'features'));
  if n <> 3 then raise exception '151: de las tres columnas de requisitos, % quedaron como text[] not null default {}', n; end if;

  -- Los guards de deliveries no miran los requisitos: las reglas de quien edita valen igual (como la 147).
  if position('requirements' in guard) > 0 then
    raise exception '151: guard_delivery_stage menciona requirements; esta migracion supone que no';
  end if;
  if f146 is not null then
    factura := regexp_replace(regexp_replace(pg_get_functiondef(f146), '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
    if position('requirements' in factura) > 0 then
      raise exception '151: guard_factura_obligatoria menciona requirements; esta migracion supone que no';
    end if;
  end if;

  -- La encuesta: RLS puesta, UNA politica y de lectura, ninguna de escritura.
  if not (select relrowsecurity from pg_class where oid = 'public.delivery_surveys'::regclass) then
    raise exception '151: delivery_surveys quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'delivery_surveys';
  if n <> 1 then raise exception '151: delivery_surveys tiene % politicas, se esperaba 1', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'delivery_surveys' and cmd <> 'SELECT';
  if n <> 0 then raise exception '151: hay % politicas de escritura (o FOR ALL) en delivery_surveys', n; end if;

  if has_table_privilege('anon', 'public.delivery_surveys', 'SELECT')
     or has_table_privilege('anon', 'public.delivery_surveys', 'INSERT')
     or has_table_privilege('authenticated', 'public.delivery_surveys', 'INSERT')
     or has_table_privilege('authenticated', 'public.delivery_surveys', 'UPDATE')
     or has_table_privilege('authenticated', 'public.delivery_surveys', 'DELETE')
     or has_table_privilege('authenticated', 'public.delivery_surveys', 'TRUNCATE') then
    raise exception '151: permisos de mas sobre delivery_surveys';
  end if;
  if not has_table_privilege('authenticated', 'public.delivery_surveys', 'SELECT')
     or not has_table_privilege('service_role', 'public.delivery_surveys', 'INSERT') then
    raise exception '151: faltan permisos sobre delivery_surveys (lectura de authenticated, insert de service_role)';
  end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.delivery_surveys'::regclass
                  and tgname = 'delivery_surveys_solo_entregada' and not tgisinternal) then
    raise exception '151: falta el disparador delivery_surveys_solo_entregada';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-151-requisitos-y-encuesta.md, seccion 6). Se pega en una transaccion
-- abierta a mano y se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia
-- de aqui abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   drop table if exists public.delivery_surveys;            -- se lleva politica, restricciones y disparador
--   drop function if exists public.delivery_surveys_solo_entregada();
--   alter table public.driver_settings drop constraint if exists driver_settings_features_shape;
--   alter table public.driver_settings drop column if exists features;
--   alter table public.deliveries drop constraint if exists deliveries_requirements_shape;
--   alter table public.deliveries drop column if exists requirements;
--   alter table public.settings drop constraint if exists settings_delivery_requirements_shape;
--   alter table public.settings drop column if exists delivery_requirements;
--   delete from public.schema_migrations where name = '151_requisitos_y_encuesta.sql';
-- Se pierden el catalogo, lo marcado en ordenes y camiones, y las respuestas de la encuesta (si interesan,
-- primero: create table delivery_surveys_backup as select * from public.delivery_surveys;). La app no se rompe:
-- sin las columnas no las pide ni las manda (leeConOpcionales, conRequisitosSiCabe, laBaseTieneRequisitos), y
-- sin la tabla la pagina de seguimiento no ensena la encuesta y el Panel no ensena la tarjeta.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('151_requisitos_y_encuesta.sql', '9ef71064704290ef2e3d09da942b85c861970a512fb11e9c6d9dc9dfe4cd719a') on conflict (name) do nothing;
