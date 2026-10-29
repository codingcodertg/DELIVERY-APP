-- ===========================================================================
-- 214 · user_prefs admite una preferencia mas: el orden de las apps del hub (D-739)
-- ===========================================================================
-- QUE HACE: cambia UNA restriccion. La lista de `key` permitidas en `user_prefs` pasa de
-- ('order_columns', 'routes_columns', 'promos_columns') a esas tres mas ('hub_order'). Nada mas: ni una politica,
-- ni un grant, ni el disparador, ni una fila.
--
-- El dueño (2026-10-29): «para los administradores solamente, deja que el admin pueda rearrange las aplicaciones
-- para que esten en el orden que mejor le convenga». El orden es de cada persona (la politica de la 136 ya lo
-- ata a auth.uid()), y la pantalla solo lo ofrece al admin; la base no mira el rol, como con las otras claves.
--
-- OJO AL PARTIR DE DONDE: la ULTIMA definicion de `user_prefs_key_permitida` es la de **141**, no la de la 136 ni
-- la de la 137. Un `check` no se edita: se quita y se vuelve a poner entero, asi que copiar una lista vieja
-- borraria `promos_columns` en silencio. La autocomprobacion lo vigila.
--
-- `hub_order` guarda `{ "modules": ["deliveries", "customers", ...] }`: las claves de modulo en el orden elegido.
-- El tope de tamano de la 136 le aplica igual.
--
-- Entre el drop y el add la tabla queda sin lista cerrada; quien aplica esto lo hace en UNA transaccion (la
-- suya). Sin begin/commit aqui: una migracion no lleva su propia transaccion.
-- ===========================================================================

alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;
alter table public.user_prefs add constraint user_prefs_key_permitida
  check (key in ('order_columns', 'routes_columns', 'promos_columns', 'hub_order'));

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
  if def is null then raise exception '214: falta la restriccion user_prefs_key_permitida'; end if;
  if position('hub_order' in def) = 0 then
    raise exception '214: la lista de claves debe llevar hub_order: %', def;
  end if;
  -- Y NO se ha perdido ninguna de las tres que ya habia (haber partido de la 136 o la 137 en vez de la 141).
  if position('order_columns' in def) = 0 or position('routes_columns' in def) = 0 or position('promos_columns' in def) = 0 then
    raise exception '214: se perdio una clave que ya existia: %', def;
  end if;
  -- Sigue siendo una lista CERRADA, ahora de cuatro.
  if (length(def) - length(replace(def, '''::text', ''))) / length('''::text') <> 4 then
    raise exception '214: la lista de claves debe tener exactamente cuatro: %', def;
  end if;
  -- Lo de la 136 sigue en pie.
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_prefs'::regclass and conname = 'user_prefs_tamano') then
    raise exception '214: falta el tope de tamano de la 136';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'user_prefs';
  if n <> 3 then raise exception '214: user_prefs debe seguir con 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_prefs' and cmd = 'ALL') then
    raise exception '214: user_prefs no debe tener ninguna politica ALL';
  end if;
  if has_table_privilege('authenticated', 'public.user_prefs', 'delete') or has_table_privilege('anon', 'public.user_prefs', 'select') then
    raise exception '214: los permisos de user_prefs cambiaron';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   delete from public.user_prefs where key = 'hub_order';      -- si no, el check de abajo no entra
--   alter table public.user_prefs drop constraint if exists user_prefs_key_permitida;
--   alter table public.user_prefs add constraint user_prefs_key_permitida
--     check (key in ('order_columns', 'routes_columns', 'promos_columns'));
-- Se pierde el orden elegido del hub; vuelve el de siempre. El navegador de cada admin conserva su copia.

-- ===========================================================================
-- Ensayo, con ROLLBACK
-- ===========================================================================
--   1  A inserta ('hub_order', '{"modules":["customers","deliveries"]}')   -> 1 fila
--   2  A inserta las otras tres claves                                      -> 1 fila cada una: lo de antes vale
--   3  A inserta ('lo_que_sea', ...)                                        -> BLOQUEADO (user_prefs_key_permitida)
--   4  B lee                                                               -> 0 filas de A: MENOS que el total
--   5  re-aplicar la 214                                                   -> sin error; pg_policies: 3, ninguna ALL

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('214_user_prefs_hub_order.sql', '7c8527addf8b718cf8b4a7e6bfd576a77ceb1398ceaeb62bbf4a47da0a213369') on conflict (name) do nothing;
