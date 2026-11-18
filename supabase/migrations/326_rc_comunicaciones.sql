-- ===========================================================================
-- 326 - Comunicaciones de RingCentral en la ficha del candidato
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueno, con migrate-status antes y despues.
--
-- QUE HACE. Guarda, en recruiting, los SMS (enviados y recibidos) y las llamadas, con su grabacion, de la linea de
-- RingCentral del dueno, emparejados por telefono con un candidato. Lo llena el cron rc-comms
-- (src/app/api/cron/rc-comms), que escribe con la llave de servicio. Nunca guarda nada de numeros que no son de un
-- candidato: las llamadas personales del dueno no entran.
--   rc_comms        una fila por SMS o llamada (kind + rc_id unicos). Tiene la grabacion en el bucket privado
--                   rc-recordings (recording_path) o pendiente de bajar (recording_pending + recording_uri).
--   rc_sync_state   una sola fila (id = 1): hasta donde llego la lectura de llamadas y de SMS.
--
-- SEGURIDAD.
--   - RLS activo en las dos. rc_comms: solo el admin la lee (public.is_admin(), la misma funcion de la 310), porque
--     las grabaciones de la linea del dueno son sensibles. No tiene politicas de escritura: escribe el servidor.
--   - rc_sync_state: ninguna politica; ni authenticated ni anon la leen ni la escriben.
--   - Bucket rc-recordings PRIVADO y sin politicas de storage para los clientes: los audios solo salen firmados por
--     el servidor (URL de 10 minutos) a un admin que ya paso la comprobacion.
--
-- LO QUE NO TOCA. Ninguna tabla existente, ninguna politica existente, ningun dato.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Las comunicaciones (una fila por SMS o llamada).
-- ---------------------------------------------------------------------------
create table if not exists recruiting.rc_comms (
  id                  uuid primary key default gen_random_uuid(),
  -- Id de RingCentral (registro del call log o del message store). Con `kind` forma la clave de la fila.
  rc_id               text not null,
  kind                text not null check (kind in ('call', 'sms')),
  candidate_id        uuid not null references recruiting.candidates(id) on delete cascade,
  -- El telefono del candidato, en 10 digitos (el mismo criterio que el emparejamiento del cron).
  phone               text not null,
  direction           text not null check (direction in ('in', 'out')),
  at                  timestamptz not null,
  -- Llamadas: duracion en segundos y resultado de RingCentral («Accepted», «Missed»...). SMS: estado del mensaje.
  duration_s          int,
  result              text,
  -- SMS: el texto.
  body                text,
  -- Grabacion: la ruta en el bucket privado cuando ya se bajo; la URL de RingCentral mientras esta pendiente.
  recording_path      text,
  recording_uri       text,
  recording_pending   boolean not null default false,
  created_at          timestamptz default now(),
  unique (kind, rc_id)
);

create index if not exists rc_comms_candidate_at_idx on recruiting.rc_comms (candidate_id, at desc);
create index if not exists rc_comms_pending_idx on recruiting.rc_comms (at) where recording_pending;

alter table recruiting.rc_comms enable row level security;

drop policy if exists "admin read rc_comms" on recruiting.rc_comms;
create policy "admin read rc_comms" on recruiting.rc_comms
  for select to authenticated using (public.is_admin());

revoke all on recruiting.rc_comms from anon, authenticated;
grant select on recruiting.rc_comms to authenticated;

-- ---------------------------------------------------------------------------
-- 2. El cursor de la lectura (una fila).
-- ---------------------------------------------------------------------------
create table if not exists recruiting.rc_sync_state (
  id          smallint primary key default 1 check (id = 1),
  calls_from  timestamptz,
  sms_from    timestamptz,
  updated_at  timestamptz not null default now()
);

insert into recruiting.rc_sync_state (id) values (1) on conflict (id) do nothing;

alter table recruiting.rc_sync_state enable row level security;
-- Sin politicas a proposito: solo el servicio lo toca.
revoke all on recruiting.rc_sync_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Las grabaciones: bucket privado, sin politicas para los clientes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rc-recordings', 'rc-recordings', false)
on conflict (id) do update set public = false;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('326_rc_comunicaciones.sql', '471cc6a87eaf8f8c4ef2fbbd46932f6ab80155b736d2a51d23e0d5d60f3e7254') on conflict (name) do nothing;
