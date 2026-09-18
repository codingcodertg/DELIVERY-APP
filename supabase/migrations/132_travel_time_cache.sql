-- 132 · La cache de tiempos de viaje del motor de rutas (rama motor-rutas-tiempos)
--
-- El motor de rutas necesita saber cuanto se tarda de un sitio a otro. Preguntarselo a Google cada vez
-- cuesta dinero, y la regla del proyecto es gastar lo minimo y nunca en bucle. Hoy la unica cache que hay es
-- la de `/api/optimize-route`: vive en la memoria del proceso, dura 10 minutos y no la comparte nadie. Esta
-- es una tabla: la comparten todas las corridas y todas las personas, y volver a planificar el mismo dia no
-- cuesta ni una llamada. El diseno esta en docs/route-algorithm-design.md (secciones 3 y 5).
--
-- LA CLAVE: origen, destino, dia de la semana, bloque horario de media hora, y si es con trafico.
--   · origen y destino son «lat,lng» a 5 decimales (~1 m).
--   · SIN trafico el tiempo no depende del dia ni de la hora: se guarda UNA fila, con weekday = -1 y
--     block = -1. Caduca a los 90 dias.
--   · CON trafico, una fila por dia de la semana (0 = domingo) y media hora de salida (0-47). Caduca a los 28:
--     cuatro semanas del mismo dia y la misma media hora.
--   La caducidad la decide el codigo al leer (`estaVigente`), no un borrado: una fila vieja se pisa cuando se
--   vuelve a preguntar.
--
-- NO GUARDA NADA DE NADIE: dos coordenadas redondeadas y una duracion. Ni la orden, ni el cliente, ni el chofer.
--
-- SIN NINGUNA POLITICA, Y ES A PROPOSITO. RLS activada y cero politicas = ningun navegador lee ni escribe.
-- Solo el servidor, con la llave de servicio, que se salta RLS. La razon no es la privacidad: es que quien
-- pudiera escribir aqui podria falsear los tiempos con los que se planifican las rutas, y quien pudiera
-- llenarla, hacer gastar. Por eso a `anon` y `authenticated` se les quita todo y no se les da nada; el unico
-- `grant` del fichero es para `service_role`, el servidor.
--
-- `fetched_at` y `provider` sirven ademas para el TOPE DE GASTO: el codigo cuenta cuantas filas de pago
-- (provider = 'google') se guardaron hoy antes de pedir mas. De ahi el indice.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero.

create table if not exists public.travel_time_cache (
  origin_key text        not null,
  dest_key   text        not null,
  weekday    smallint    not null,
  block      smallint    not null,
  traffic    boolean     not null,
  minutes    integer     not null,
  miles      numeric     not null,
  provider   text        not null,
  fetched_at timestamptz not null default now(),
  primary key (origin_key, dest_key, weekday, block, traffic),
  constraint travel_time_cache_weekday check (weekday between -1 and 6),
  constraint travel_time_cache_block check (block between -1 and 47),
  -- Sin trafico no hay dia ni bloque; con trafico, los dos.
  constraint travel_time_cache_shape check ((traffic and weekday >= 0 and block >= 0) or (not traffic and weekday = -1 and block = -1)),
  constraint travel_time_cache_not_negative check (minutes >= 0 and miles >= 0),
  constraint travel_time_cache_provider check (provider in ('google', 'osrm', 'estimado'))
);

create index if not exists travel_time_cache_spend_idx on public.travel_time_cache (fetched_at) where provider = 'google';

comment on table public.travel_time_cache is
  'Tiempos de viaje cacheados para el motor de rutas (132). Solo el servidor con la llave de servicio: RLS activada y ninguna politica.';

alter table public.travel_time_cache enable row level security;

-- En esta base una tabla nueva nace con todo concedido a `anon` y `authenticated` (medido al ensayar la 126).
-- A ellos no se les da nada despues.
revoke all on public.travel_time_cache from anon, authenticated;
-- Y al servidor se le da explicito, en vez de fiarlo a los privilegios por defecto: si no lo tuviera, la
-- cache fallaria en silencio (el codigo trata una cache que falla como una cache vacia) y se pagaria todo.
grant select, insert, update, delete on public.travel_time_cache to service_role;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
  privilegio text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.travel_time_cache'::regclass) then
    raise exception '132: travel_time_cache quedo sin RLS';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'travel_time_cache';
  if n <> 0 then raise exception '132: travel_time_cache tiene % politicas, se esperaba ninguna', n; end if;
  foreach privilegio in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('anon', 'public.travel_time_cache', privilegio)
       or has_table_privilege('authenticated', 'public.travel_time_cache', privilegio) then
      raise exception '132: anon o authenticated tienen % sobre travel_time_cache', privilegio;
    end if;
  end loop;
  foreach privilegio in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if not has_table_privilege('service_role', 'public.travel_time_cache', privilegio) then
      raise exception '132: a service_role le falta % sobre travel_time_cache', privilegio;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'travel_time_cache_spend_idx') then
    raise exception '132: falta el indice del tope de gasto';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop table if exists public.travel_time_cache;
--   delete from public.schema_migrations where name = '132_travel_time_cache.sql';
--
-- No se pierde nada que no se pueda volver a preguntar; solo cuesta las llamadas de rellenarla otra vez.

-- ===========================================================================
-- Ensayo, con ROLLBACK
-- ===========================================================================
-- Con la 132 aplicada DENTRO de la misma transaccion. `pg_temp.intenta` es el ayudante de la 123.
--
--   -- A. Ningun navegador: ni el admin.
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   A1 select count(*) from public.travel_time_cache                                          -> BLOQUEADO (permission denied)
--   A2 insert de una fila valida                                                              -> BLOQUEADO (permission denied)
--   set local role anon;
--   A3 select count(*) from public.travel_time_cache                                          -> BLOQUEADO (permission denied)
--
--   -- B. El servidor, como la llave de servicio.
--   reset role;
--   set local role service_role;
--   B1 insert ('26.20000,-98.20000','26.30000,-98.10000', -1, -1, false, 18, 11.2, 'google')  -> PERMITIDO
--   B2 la misma clave otra vez con `on conflict ... do update`                                -> PERMITIDO, sigue habiendo UNA fila
--   B3 con trafico: (…, 2, 17, true, 24, 11.2, 'google')                                      -> PERMITIDO
--   B4 con trafico y sin dia: (…, -1, -1, true, …)                                            -> BLOQUEADO (check de forma)
--   B5 sin trafico y con bloque: (…, -1, 17, false, …)                                        -> BLOQUEADO (check de forma)
--   B6 block = 48, o minutes = -1, o provider = 'otro'                                        -> BLOQUEADO (check)
--   B7 select count(*) … where provider = 'google' and fetched_at >= date_trunc('day', now()) -> 2  (lo que cuenta el tope)
--
--   rollback;
--
-- No verificado al escribirlo: nada de esto se ha corrido. Una rama no toca produccion.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('132_travel_time_cache.sql', 'c8f4373f10b25981209f5194218b65edf4c7724e557ff3a76f8ed34b855cc4c7') on conflict (name) do nothing;
