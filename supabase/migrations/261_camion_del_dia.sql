-- 261 - El camion de cada chofer, por dia (Gestor de Rutas).
--
-- La 257 guarda el camion HABITUAL de cada chofer (tracksolid_devices.driver_id, que el admin pone en
-- Ajustes). Pero los choferes cambian de camion: esta tabla guarda la excepcion de UN dia, que pone quien
-- planifica las rutas desde la cabecera de la ruta del chofer.
--
-- Una fila = "ese dia, ese chofer lleva ESE camion" (imei) o "ese dia va SIN camion" (imei null).
-- Sin fila, vale el habitual de la 257. El camion habitual de un chofer que ese dia se le dio a otro
-- queda para el otro: el primero sale sin camion hasta que se le ponga uno.
--
-- UN camion no puede ir con dos choferes el mismo dia: lo garantiza el indice unico (day, imei). La app
-- ofrece intercambiarlos; esto es la red por si dos personas lo cambian a la vez.
--
-- No cambia ninguna tabla existente y no toca ninguna orden. Aditiva: el codigo de antes no la lee, y el
-- codigo nuevo, si no esta, se comporta como sin asignaciones por dia.
--
-- SEGURIDAD: igual que la 257. RLS encendida y NINGUNA politica; sin permisos para anon ni authenticated.
-- Solo la llave de servicio (la ruta /api/tracksolid/assignments, que comprueba el permiso antes).
--
-- Idempotente: se puede correr dos veces.

create table if not exists public.truck_day_assignments (
  day        date not null,
  driver_id  uuid not null references public.profiles(id) on delete cascade,
  imei       text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (day, driver_id),
  constraint truck_day_assignments_imei_ck check (imei is null or imei ~ '^[0-9]{10,20}$')
);

create unique index if not exists truck_day_assignments_un_camion_por_dia
  on public.truck_day_assignments (day, imei) where imei is not null;

alter table public.truck_day_assignments enable row level security;

revoke all on public.truck_day_assignments from public, anon, authenticated;
grant all on public.truck_day_assignments to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Para deshacer:
--   drop table if exists public.truck_day_assignments;
--
-- Comprobacion despues de aplicar:
--   select count(*) from public.truck_day_assignments;                          -> 0
--   set role authenticated; select * from public.truck_day_assignments;         -> permission denied
--   set role anon;          select * from public.truck_day_assignments;         -> permission denied
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('261_camion_del_dia.sql', 'e760c20ca317452046ed7c84d74297af6107343be6776fc31cd58bcc51e4e515') on conflict (name) do nothing;
