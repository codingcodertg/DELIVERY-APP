-- ===========================================================================
-- 312 - Cachés de Google Maps: geocodificación, lugares del mercado, rutas optimizadas y distancias
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño, con migrate-status antes y después.
--
-- QUE HACE. Cuatro tablas nuevas, sin tocar ninguna existente:
--   geocode_cache    dirección normalizada → lat/lng que contestó Google. Sin caducidad (una dirección no cambia de sitio).
--   places_cache     clave de la búsqueda de lugares de una categoría → la lista ya traída. Caduca a los 7 días (en código).
--   route_opt_cache  clave de la optimización (paradas, opciones, fecha y hora) → la ruta. Caduca a los 60 min (en código).
--   distance_cache   par origen→destino → la distancia y el tiempo que contestó Google. Caduca a los 30 días (en código).
--
-- SEGURIDAD. Solo las lee y escribe el servidor con la clave de servicio, que salta el RLS. Por eso el RLS queda ACTIVADO
-- y SIN políticas, y no se da ningún permiso a anon ni a authenticated: nadie más que el servidor llega a estas tablas.
--
-- SI NO ESTÁ APLICADA. El código las trata como si no existieran (la ruta responde igual que hoy, sin caché).
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- ===========================================================================

create table if not exists public.geocode_cache (
  address_key text primary key,
  lat double precision not null,
  lng double precision not null,
  formatted text,
  created_at timestamptz not null default now()
);

create table if not exists public.places_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.route_opt_cache (
  cache_key text primary key,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.distance_cache (
  pair_key text primary key,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;
alter table public.places_cache enable row level security;
alter table public.route_opt_cache enable row level security;
alter table public.distance_cache enable row level security;

revoke all on public.geocode_cache, public.places_cache, public.route_opt_cache, public.distance_cache from public, anon, authenticated;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('312_cache_google_maps.sql', '75b95a90f9924765f5217aecba1f1f5e2b7906a813ef9f03b8544fcc88a84ef3') on conflict (name) do nothing;
