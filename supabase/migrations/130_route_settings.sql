-- 130 · Los ajustes del motor de rutas: pesos, ventanas duras y tope de retraso (rama motor-rutas-modelo)
--
-- El dueno pidio que los objetivos del motor fueran «ponderados y configurables, no fijos en el codigo…
-- para poder afinarlos despues comparando contra dias reales». Estas son las tres cosas que se afinan, en
-- la fila unica de `settings`, editables por el admin:
--
--   · `route_weights`       los cinco pesos, en el orden del dueno: builder temprano > ruta corta (manejo y
--                           millas) > ventana ancha > balance.
--   · `route_hard_windows`  las ventanas a las que no se llega tarde NUNCA («estrechas»). Es una LISTA y no
--                           una regla de duracion porque el dueno puso de ejemplo 08:30-12:00, que dura
--                           tres horas y media. Los cinco slots de la app no se tocan: esto solo dice
--                           cuales de ellos son duros.
--   · `route_late_cap_min`  cuanto retraso admite, como mucho, una ventana que no es dura.
--
-- Los valores por defecto son los que decidio el orquestador por delegacion del dueno el 2026-09-18
-- (docs/route-algorithm-design.md, seccion 11), y los MISMOS que tiene el codigo para cuando el ajuste
-- falta (src/lib/route-settings.ts). Una prueba compara los dos.
--
-- COMO COLUMNAS DECLARADAS, no como claves sueltas que la app escribe y ninguna migracion crea: de esas
-- ya hay seis en `settings` (cancel_reasons, pickup_locations, delivery_locations, role_permissions,
-- rc_calls_enabled, rc_auto_sms_enabled), que existen en produccion y no en el repo.
--
-- NO TOCA POLITICAS. `settings` la lee cualquiera con sesion y la escribe solo el admin (100).
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero.

alter table public.settings
  add column if not exists route_weights jsonb not null
    default '{"builder": 2, "manejo": 1, "millas": 0.5, "tarde": 0.75, "balance": 0.1}'::jsonb,
  add column if not exists route_hard_windows text[] not null
    default '{0830-1000,0830-1200}'::text[],
  add column if not exists route_late_cap_min integer not null
    default 60;

alter table public.settings drop constraint if exists settings_route_weights_is_object;
alter table public.settings
  add constraint settings_route_weights_is_object check (jsonb_typeof(route_weights) = 'object');

alter table public.settings drop constraint if exists settings_route_late_cap_not_negative;
alter table public.settings
  add constraint settings_route_late_cap_not_negative check (route_late_cap_min >= 0);

comment on column public.settings.route_weights is
  'Pesos del motor de rutas: builder, manejo, millas, tarde, balance. Lo que falte usa el valor por defecto del codigo. 130';
comment on column public.settings.route_hard_windows is
  'Ventanas "HHMM-HHMM" a las que no se llega tarde nunca. Tienen que ser slots de la app. 130';
comment on column public.settings.route_late_cap_min is
  'Minutos de retraso que admite, como mucho, una ventana que no es dura. 130';

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
-- Se comprueban los VALORES POR DEFECTO DE LAS COLUMNAS, no los de la fila: la fila la afinara el admin, y
-- volver a aplicar este fichero despues tiene que seguir pasando.
do $comprueba$
declare
  f record;
  expresion text;
  pesos jsonb;
begin
  select route_weights, route_hard_windows, route_late_cap_min into f from public.settings where id = 1;
  if not found then raise exception '130: no existe la fila unica de settings'; end if;
  if f.route_weights is null or f.route_hard_windows is null or f.route_late_cap_min is null then
    raise exception '130: la fila de settings quedo con algun ajuste de rutas a null';
  end if;

  -- `pg_get_expr` devuelve el TEXTO de la expresion ('{...}'::jsonb), no su valor: se evalua. Es una
  -- constante que sale del catalogo, no de nada que escriba un usuario.
  select pg_get_expr(d.adbin, d.adrelid) into strict expresion
    from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.settings'::regclass and a.attname = 'route_weights';
  execute 'select (' || expresion || ')::jsonb' into pesos;
  -- Los cinco pesos, y en el orden del dueno. `millas` va con `manejo`: los dos son «ruta corta».
  if not (pesos ?& array['builder', 'manejo', 'millas', 'tarde', 'balance']) then
    raise exception '130: al valor por defecto de route_weights le falta algun peso';
  end if;
  if not ((pesos->>'builder')::numeric > (pesos->>'manejo')::numeric
      and (pesos->>'manejo')::numeric  > (pesos->>'tarde')::numeric
      and (pesos->>'tarde')::numeric   > (pesos->>'balance')::numeric
      and (pesos->>'balance')::numeric > 0) then
    raise exception '130: los pesos por defecto no respetan el orden del dueno';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'settings' and column_name = 'route_hard_windows'
                    and column_default like '%0830-1000,0830-1200%') then
    raise exception '130: el valor por defecto de route_hard_windows no son las dos ventanas decididas';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'settings' and column_name = 'route_late_cap_min'
                    and column_default = '60') then
    raise exception '130: el valor por defecto de route_late_cap_min no es 60';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   alter table public.settings drop constraint if exists settings_route_weights_is_object;
--   alter table public.settings drop constraint if exists settings_route_late_cap_not_negative;
--   alter table public.settings drop column if exists route_weights,
--                               drop column if exists route_hard_windows,
--                               drop column if exists route_late_cap_min;
--   delete from public.schema_migrations where name = '130_route_settings.sql';
--
-- Se pierde lo que el admin haya afinado. La app vuelve sola a los valores por defecto del codigo.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   A1 update public.settings set route_weights = route_weights || '{"builder": 3}' where id = 1        -> PERMITIDO
--   A2 update public.settings set route_weights = '[1,2]'::jsonb where id = 1                           -> BLOQUEADO (check)
--   A3 update public.settings set route_late_cap_min = -5 where id = 1                                  -> BLOQUEADO (check)
--   A4 update public.settings set route_hard_windows = '{}' where id = 1                                -> PERMITIDO (ninguna es dura)
--   set local request.jwt.claims = '{"sub":"<uuid-logistica>","role":"authenticated"}';
--   B1 select route_weights from public.settings where id = 1                                           -> la ve
--   B2 update public.settings set route_late_cap_min = 90 where id = 1                                  -> SIN FILAS (solo admin, 100)
--   reset role;
--   rollback;
--
-- No verificado al escribirlo: nada de esto se ha corrido. Una rama no toca produccion.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('130_route_settings.sql', 'abb14656428e1c87f55c6a333580b47433ac2cdc0e058a02172958c70407656c') on conflict (name) do nothing;
