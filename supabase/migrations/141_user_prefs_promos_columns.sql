-- ===========================================================================
-- 141 · user_prefs admite una preferencia mas: las columnas de RTG PROMOS
-- ===========================================================================
-- QUE HACE: cambia UNA restriccion. La lista de `key` permitidas en `user_prefs` pasa de
-- ('order_columns', 'routes_columns') a esas dos mas ('promos_columns'). Nada mas: ni una politica, ni un
-- grant, ni el disparador, ni una fila.
--
-- POR QUE ES UNA MIGRACION Y NO UN AJUSTE: la 136 cerro la lista a proposito, para que `user_prefs` no sea un
-- cajon donde cualquiera con sesion guarde lo que quiera. Anadir una preferencia es esto: una linea, revisada.
--
-- OJO AL PARTIR DE DONDE: la ULTIMA definicion de `user_prefs_key_permitida` es la de **137**, no la de la 136.
-- Un `check` no se edita: se quita y se vuelve a poner entero, asi que copiar el cuerpo de la 136 borraria
-- `routes_columns` en silencio y el Gestor de Rutas perderia las columnas de todo el mundo sin que fallara nada.
-- Es la misma trampa que avisan la 131 y la 140; aqui la autocomprobacion la vigila explicitamente.
--
-- `promos_columns` guarda lo mismo que las otras dos y con la misma forma —{ "<rol>": ["code", ...] }—: que
-- columnas ve cada persona en la tabla de promociones. El tope de tamano de la 136 le aplica igual.
--
-- Entre el drop y el add la tabla queda sin lista cerrada; quien aplica esto lo hace en UNA transaccion (la
-- suya), asi que nadie lo ve. Sin begin/commit aqui: una migracion no lleva su propia transaccion.
-- ===========================================================================

alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;
alter table public.user_prefs add constraint user_prefs_key_permitida
  check (key in ('order_columns', 'routes_columns', 'promos_columns'));

-- ---------------------------------------------------------------------------
-- Autocomprobacion (mira la definicion: sobrevive a re-aplicar)
-- ---------------------------------------------------------------------------
do $comprueba$
declare
  def text;
  n   integer;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.user_prefs'::regclass and conname = 'user_prefs_key_permitida';
  if def is null then raise exception '141: falta la restriccion user_prefs_key_permitida'; end if;
  if position('promos_columns' in def) = 0 then
    raise exception '141: la lista de claves debe llevar promos_columns: %', def;
  end if;
  -- Y NO se ha perdido ninguna de las dos que ya habia. Esta es la comprobacion que caza haber
  -- partido del cuerpo de la 136 en vez del de la 137.
  if position('order_columns' in def) = 0 or position('routes_columns' in def) = 0 then
    raise exception '141: se perdio una clave que ya existia (se partio de la 136?): %', def;
  end if;
  -- Sigue siendo una lista CERRADA, ahora de tres: ni mas claves, ni un check que deje pasar cualquiera.
  if (length(def) - length(replace(def, '''::text', ''))) / length('''::text') <> 3 then
    raise exception '141: la lista de claves debe tener exactamente tres: %', def;
  end if;
  -- Lo de la 136 sigue en pie.
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_prefs'::regclass and conname = 'user_prefs_tamano') then
    raise exception '141: falta el tope de tamano de la 136';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'user_prefs';
  if n <> 3 then raise exception '141: user_prefs debe seguir con 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs' and cmd = 'ALL') then
    raise exception '141: user_prefs no debe tener ninguna politica ALL';
  end if;
  if has_table_privilege('authenticated', 'public.user_prefs', 'delete') or has_table_privilege('anon', 'public.user_prefs', 'select') then
    raise exception '141: los permisos de user_prefs cambiaron';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   delete from public.user_prefs where key = 'promos_columns';      -- si no, el check de abajo no entra
--   alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;
--   alter table public.user_prefs add constraint user_prefs_key_permitida
--     check (key in ('order_columns', 'routes_columns'));
-- Se pierden las columnas elegidas en RTG PROMOS; vuelve el defecto. Nada mas.
-- (La lista de la reversion es la de la 137, que es donde estaba antes de esto.)

-- ===========================================================================
-- Ensayo, con ROLLBACK
-- ===========================================================================
--   1  A inserta ('promos_columns', '{"manager":["code","price"]}')      -> 1 fila
--   2  A inserta ('order_columns', ...) y ('routes_columns', ...)          -> 1 fila cada una: lo de antes vale
--   3  A inserta ('lo_que_sea', ...)                                       -> BLOQUEADO (user_prefs_key_permitida)
--   4  B lee                                                              -> 0 filas de A: MENOS que el total
--   5  un admin lee las de A                                              -> 0 filas
--   6  value de 20 KB en promos_columns                                   -> BLOQUEADO (user_prefs_tamano)
--   7  re-aplicar la 141                                                  -> sin error; pg_policies: 3, ninguna ALL
--   8  con filas de las otras dos claves ya guardadas, aplicar la 141     -> sin error: cumplen el check nuevo

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('141_user_prefs_promos_columns.sql', 'c0e0c05212d691f28e4725c629a8b415c0ff1d2b4771879ed5431c28dc067895') on conflict (name) do nothing;
