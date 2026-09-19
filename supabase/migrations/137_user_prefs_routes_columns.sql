-- ===========================================================================
-- 137 · user_prefs admite una preferencia mas: las columnas del Gestor de Rutas
-- ===========================================================================
-- QUE HACE: cambia UNA restriccion. La lista de `key` permitidas en `user_prefs` (136) pasa de
-- ('order_columns') a ('order_columns', 'routes_columns'). Nada mas: ni una politica, ni un grant, ni el
-- disparador, ni una fila.
--
-- POR QUE ES UNA MIGRACION Y NO UN AJUSTE: la 136 cerro la lista a proposito, para que `user_prefs` no sea un cajon
-- donde cualquiera con sesion guarde lo que quiera. Anadir una preferencia es esto: una linea, revisada.
--
-- `routes_columns` guarda lo mismo que `order_columns` y con la misma forma —{ "<rol>": ["invoice", ...] }—: que
-- columnas ve cada persona en las tablas del Gestor de Rutas. El tope de tamano de la 136 le aplica igual.
--
-- Se quita y se vuelve a poner la restriccion: un `check` no se edita. Entre las dos sentencias la tabla queda sin
-- lista cerrada; quien aplica esto lo hace en UNA transaccion (la suya), asi que nadie lo ve. Sin begin/commit aqui:
-- una migracion no lleva su propia transaccion.
-- ===========================================================================

alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;
alter table public.user_prefs add constraint user_prefs_key_permitida check (key in ('order_columns', 'routes_columns'));

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
  if def is null then raise exception '137: falta la restriccion user_prefs_key_permitida'; end if;
  if position('order_columns' in def) = 0 or position('routes_columns' in def) = 0 then
    raise exception '137: la lista de claves debe llevar order_columns y routes_columns: %', def;
  end if;
  -- Sigue siendo una lista CERRADA de dos: ni mas claves, ni un check que deje pasar cualquiera.
  if (length(def) - length(replace(def, '''::text', ''))) / length('''::text') <> 2 then
    raise exception '137: la lista de claves debe tener exactamente dos: %', def;
  end if;
  -- Lo de la 136 sigue en pie.
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_prefs'::regclass and conname = 'user_prefs_tamano') then
    raise exception '137: falta el tope de tamano de la 136';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'user_prefs';
  if n <> 3 then raise exception '137: user_prefs debe seguir con 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs' and cmd = 'ALL') then
    raise exception '137: user_prefs no debe tener ninguna politica ALL';
  end if;
  if has_table_privilege('authenticated', 'public.user_prefs', 'delete') or has_table_privilege('anon', 'public.user_prefs', 'select') then
    raise exception '137: los permisos de user_prefs cambiaron';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   delete from public.user_prefs where key = 'routes_columns';      -- si no, el check de abajo no entra
--   alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;
--   alter table public.user_prefs add constraint user_prefs_key_permitida check (key in ('order_columns'));
-- Se pierden las columnas elegidas en el Gestor; vuelve el defecto. Nada mas.

-- ===========================================================================
-- Ensayo, con ROLLBACK
-- ===========================================================================
--   1  A inserta ('routes_columns', '{"logistics":["invoice"]}')       -> 1 fila
--   2  A inserta ('order_columns', ...) — lo de antes sigue valiendo     -> 1 fila
--   3  A inserta ('lo_que_sea', ...)                                     -> BLOQUEADO (user_prefs_key_permitida)
--   4  B lee                                                            -> 0 filas de A: MENOS que el total
--   5  un admin lee las de A                                            -> 0 filas
--   6  value de 20 KB en routes_columns                                 -> BLOQUEADO (user_prefs_tamano)
--   7  re-aplicar la 137                                                -> sin error; pg_policies: 3, ninguna ALL
--   8  con filas `order_columns` ya guardadas, aplicar la 137           -> sin error: las filas que hay cumplen el check nuevo

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('137_user_prefs_routes_columns.sql', 'e1f044647c7e4f79982395d10bf0c43edaba2fb8c4ab5306a370ed9fb1dbb7e2') on conflict (name) do nothing;
