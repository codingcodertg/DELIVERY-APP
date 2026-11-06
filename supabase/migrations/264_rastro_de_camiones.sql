-- 264 - El rastro de cada camion, por dia (Reportes de choferes).
--
-- PEDIDO. El duenio, 2026-11-06: "now that we have more information, I want better reports and metrics for
-- drivers: scheduled route vs real route, estimated time vs real time, time per stop."
--
-- QUE GUARDA. TrackSolid Pro guarda por donde anduvo cada camion (jimi.device.track.list: un punto cada ~10 s
-- con el camion en marcha) pero solo 3 meses, y solo deja pedir 7 dias por llamada. Esta tabla es la copia de la
-- empresa: una fila por rastreador (imei) y dia LOCAL (America/Chicago), con los puntos de ese dia.
--
--   * points      : [[segundos_de_epoca, lat, lng, mph], ...] en orden de hora. mph = -1 si el rastreador no la dio.
--   * point_count : cuantos puntos (para mirar la tabla sin abrir el json).
--   * complete    : true si se leyo con el dia ya terminado: no se vuelve a pedir. false = el dia iba por la mitad
--                   (se refresca al volver a pedirlo).
--   * fetched_at  : cuando se leyo de TrackSolid.
--
-- QUIEN LA ESCRIBE. La app, al calcular un reporte que necesita un dia que no esta (/api/driver-reports), y el
-- cron diario /api/cron/truck-tracks, que guarda los ultimos 7 dias de cada rastreador para que no se pierda
-- nada cuando TrackSolid lo borre a los 3 meses.
--
-- ORDEN CON EL DESPLIEGUE. Se puede aplicar ANTES de desplegar: es una tabla nueva que el codigo de antes no
-- conoce, y no cambia ninguna tabla existente ni toca ninguna orden. Y el codigo nuevo funciona SIN ella: si no
-- esta, le pregunta a TrackSolid cada vez y no guarda nada.
--
-- SEGURIDAD: igual que la 257 y la 261. RLS encendida y NINGUNA politica; sin permisos para anon ni
-- authenticated. Solo la llave de servicio (las dos rutas de arriba, que comprueban el permiso o el secreto
-- del cron antes). Donde estuvo un camion a cada hora es dato de la empresa: no lo lee ningun navegador.
--
-- Idempotente: se puede correr dos veces.

create table if not exists public.truck_track_days (
  imei        text not null,
  day         date not null,
  points      jsonb not null default '[]'::jsonb,
  point_count integer not null default 0,
  complete    boolean not null default false,
  fetched_at  timestamptz not null default now(),
  primary key (imei, day),
  constraint truck_track_days_imei_ck check (imei ~ '^[0-9]{10,20}$'),
  constraint truck_track_days_points_ck check (jsonb_typeof(points) = 'array')
);

create index if not exists truck_track_days_por_dia on public.truck_track_days (day);

alter table public.truck_track_days enable row level security;

revoke all on public.truck_track_days from public, anon, authenticated;
grant all on public.truck_track_days to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Para deshacer:
--   drop table if exists public.truck_track_days;
--   y borrar la fila del registro. (Se pierde la copia; TrackSolid conserva sus ultimos 3 meses.)
--
-- Comprobacion despues de aplicar:
--   select count(*) from public.truck_track_days;                          -> 0
--   set role authenticated; select * from public.truck_track_days;         -> permission denied
--   set role anon;          select * from public.truck_track_days;         -> permission denied
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('264_rastro_de_camiones.sql', '4c07e3b1afc31129c33bb7f1e8b8028cb97244f371ac694b0b7a49c7a257e2b2') on conflict (name) do nothing;
