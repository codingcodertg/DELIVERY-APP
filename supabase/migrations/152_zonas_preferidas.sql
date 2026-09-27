-- 152 - Zonas preferidas por chofer (T-0412)
-- ===========================================================================
-- El dueno, 2026-09-27: "ernesto is mcallen mission and julio is phar thats their preferences as well as
-- maximo is brownsville only if possible". Preguntado: "Preferencia, no regla". El motor de rutas le da primero
-- a cada chofer las entregas de su zona; si su zona no llena el dia, u otra zona se queda sin chofer, lleva de
-- otra. Una zona es una CIUDAD de entrega (la de la columna "Ciudad de entrega" del Gestor).
--
-- Plan en papel: docs/PLAN-152-zonas-preferidas.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador,
-- despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- Que trae, y SOLO esto:
--   public.driver_settings.preferred_zones  text[] not null default '{}'  -- sus ciudades preferidas
--     con un check de forma: <= 20, sin nulos, sin textos vacios ni de mas de 60 caracteres.
--   NO toca las politicas de driver_settings (128): la columna nueva queda bajo las mismas (leen admin,
--   logistica, gerente, office y almacen con acceso a Entregas; escriben admin y logistica). NO toca ninguna
--   fila (el defecto las lee como '{}'), ni deliveries, ni settings.
--
-- Decisiones, con su motivo:
--   1. NOMBRES (text[]), no ids de otra tabla, como driver_settings.features (151). No hay tabla de ciudades:
--      la lista que ofrece Ajustes sale de las direcciones de las ordenes y de las tiendas. La app compara sin
--      mayusculas; una ciudad que ya no sale en ninguna orden simplemente no cuenta.
--   2. NOT NULL con defecto '{}': en Postgres 11+ una columna nueva con defecto constante no reescribe la tabla.
--      Sin nulos, "sin zonas" tiene una sola forma.
--   3. El peso de la preferencia NO necesita columna: vive dentro de settings.route_weights (jsonb, 130), como
--      las opciones de reparto de la 415. Su unico check (settings_route_weights_is_object) sigue valiendo.
--   4. El largo de cada nombre se comprueba con una funcion inmutable: un check no admite subconsultas.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de
-- dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

create or replace function public.zonas_preferidas_validas(z text[])
  returns boolean language sql immutable set search_path = public as $$
  select cardinality(z) <= 20
     and array_position(z, null) is null
     and not exists (select 1 from unnest(z) as x where btrim(x) = '' or char_length(x) > 60);
$$;

comment on function public.zonas_preferidas_validas(text[]) is
  'Forma de driver_settings.preferred_zones (152): <= 20 zonas, sin nulos, cada una con texto y <= 60 caracteres.';

alter table public.driver_settings
  add column if not exists preferred_zones text[] not null default '{}'::text[];
alter table public.driver_settings drop constraint if exists driver_settings_preferred_zones_shape;
alter table public.driver_settings
  add constraint driver_settings_preferred_zones_shape check (public.zonas_preferidas_validas(preferred_zones));
comment on column public.driver_settings.preferred_zones is
  'Zonas preferidas del chofer (152): ciudades de entrega, p. ej. McAllen. Preferencia, no regla: el motor le da primero lo de su zona.';

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $chk$
declare
  n int;
begin
  -- La columna: text[], sin nulos, con '{}' por defecto.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'driver_settings' and column_name = 'preferred_zones'
     and data_type = 'ARRAY' and udt_name = '_text' and is_nullable = 'NO' and column_default like '''{}''%';
  if n <> 1 then raise exception '152: driver_settings.preferred_zones no quedo como text[] not null default {}'; end if;

  -- El check de forma, puesto y haciendo su trabajo (sobre valores, sin tocar filas).
  if not exists (select 1 from pg_constraint where conrelid = 'public.driver_settings'::regclass
                  and conname = 'driver_settings_preferred_zones_shape' and contype = 'c') then
    raise exception '152: falta el check driver_settings_preferred_zones_shape';
  end if;
  if not public.zonas_preferidas_validas(array['McAllen', 'Mission']::text[])
     or not public.zonas_preferidas_validas('{}'::text[])
     or public.zonas_preferidas_validas(array['McAllen', null]::text[])
     or public.zonas_preferidas_validas(array['  ']::text[])
     or public.zonas_preferidas_validas(array[repeat('x', 61)]::text[])
     or public.zonas_preferidas_validas(array_fill('x'::text, array[21])) then
    raise exception '152: zonas_preferidas_validas no dice lo que debe';
  end if;

  -- Las politicas de driver_settings siguen siendo las cuatro de la 128, una por comando y ninguna FOR ALL.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'driver_settings';
  if n <> 4 then raise exception '152: driver_settings tiene % politicas, se esperaban las 4 de la 128', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'driver_settings' and cmd = 'ALL';
  if n <> 0 then raise exception '152: hay % politicas FOR ALL en driver_settings', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.driver_settings'::regclass) then
    raise exception '152: driver_settings quedo sin RLS';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-152-zonas-preferidas.md, seccion 6). Se pega en una transaccion abierta
-- a mano y se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui
-- abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   alter table public.driver_settings drop constraint if exists driver_settings_preferred_zones_shape;
--   alter table public.driver_settings drop column if exists preferred_zones;
--   drop function if exists public.zonas_preferidas_validas(text[]);
--   delete from public.schema_migrations where name = '152_zonas_preferidas.sql';
-- Se pierden las zonas que se hayan puesto (si interesan, primero:
--   create table driver_settings_zonas_backup as select profile_id, preferred_zones from public.driver_settings;).
-- La app no se rompe: sin la columna no la pide ni la manda (leeConOpcionales, y Ajustes no ensena la columna),
-- y el motor planifica sin zonas, exactamente como antes.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('152_zonas_preferidas.sql', 'a4decf34fd39ac75368c87fb2c1c205502a5b1e22e192c1206b6d052ab85fb52') on conflict (name) do nothing;
