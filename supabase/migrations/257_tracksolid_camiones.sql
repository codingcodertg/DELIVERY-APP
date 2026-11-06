-- 257 - TrackSolid Pro: los camiones de la empresa en el mapa del Gestor de Rutas (fase 1).
--
-- Los camiones llevan un rastreador GPS (Jimi IoT / TrackSolid Pro). La app lee su ultima posicion por el
-- Open API de TrackSolid y la pinta en el mapa del Gestor. Esta migracion crea las dos tablas que eso necesita.
-- No cambia ninguna tabla existente y no toca ninguna orden.
--
-- 1) tracksolid_state - UNA fila (id = 1): el token del API y la ultima lectura de posiciones.
--    El token se puede pedir a TrackSolid una sola vez por minuto y dura unas 2 horas. La app es serverless
--    (cada invocacion nace sin memoria), asi que el token se guarda aqui con su caducidad para que todas las
--    invocaciones compartan el mismo. token_requested_at es el "turno": un UPDATE condicional sobre esa columna
--    garantiza que, de dos invocaciones a la vez, solo una pida token.
--    positions / positions_at: la ultima lectura, para no llamar a TrackSolid mas de una vez cada ~30 s aunque
--    haya varias pantallas abiertas, y para tener algo que ensenar si TrackSolid no contesta.
--
-- 2) tracksolid_devices - el enlace que hace el admin en Ajustes: rastreador (IMEI) -> chofer y/o tienda base.
--    driver_id apunta al perfil (no al nombre): si al chofer le cambian el nombre, el camion lo sigue; si se
--    borra el perfil, el enlace queda sin chofer. home_store es el NOMBRE de una tienda de settings.stores,
--    como driver_settings.base_store.
--
-- SEGURIDAD: las dos tablas tienen RLS encendida y NINGUNA politica, y se les quita todo permiso a anon y
-- authenticated. Solo la llave de servicio (las rutas /api/tracksolid/*, que comprueban el permiso antes) las
-- lee o escribe. El token es una credencial: con el se lee donde esta cada camion.
--
-- Idempotente: se puede correr dos veces.

create table if not exists public.tracksolid_state (
  id                 smallint primary key default 1,
  access_token       text,
  refresh_token      text,
  token_expires_at   timestamptz,
  token_requested_at timestamptz,
  positions          jsonb,
  positions_at       timestamptz,
  constraint tracksolid_state_una_fila check (id = 1)
);

insert into public.tracksolid_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.tracksolid_devices (
  imei        text primary key,
  device_name text,
  driver_id   uuid references public.profiles(id) on delete set null,
  home_store  text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint tracksolid_devices_imei_ck check (imei ~ '^[0-9]{10,20}$')
);

create index if not exists tracksolid_devices_driver_idx on public.tracksolid_devices (driver_id) where driver_id is not null;

alter table public.tracksolid_state enable row level security;
alter table public.tracksolid_devices enable row level security;

revoke all on public.tracksolid_state from public, anon, authenticated;
revoke all on public.tracksolid_devices from public, anon, authenticated;
grant all on public.tracksolid_state to service_role;
grant all on public.tracksolid_devices to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Para deshacer:
--   drop table if exists public.tracksolid_devices;
--   drop table if exists public.tracksolid_state;
--
-- Comprobacion despues de aplicar:
--   select id, token_expires_at, positions_at from public.tracksolid_state;   -> una fila, id 1
--   set role authenticated; select * from public.tracksolid_state;            -> permission denied
--   set role anon;          select * from public.tracksolid_devices;          -> permission denied
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('257_tracksolid_camiones.sql', '5e29cabc02a0b82133d7084dd0a187934ba4f6cbfbb381fc96050556179b2ab5') on conflict (name) do nothing;
