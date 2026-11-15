-- ===========================================================================
-- 310 - Indeed por correo: la conexion de Outlook y el registro de correos procesados
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueno, con migrate-status antes y despues.
--
-- QUE HACE. Dos tablas nuevas en recruiting, para que los correos de Indeed que llegan al buzon de la empresa
-- (Microsoft 365, permiso delegado Mail.Read) se conviertan en candidatos sin que nadie los copie a mano:
--   outlook_connection  una sola fila (id = 1): el buzon conectado, el refresh token CIFRADO (AES-256-GCM, la llave
--                       vive en la variable OUTLOOK_TOKEN_KEY, nunca en la base), quien lo conecto y el estado de la
--                       ultima revision. Solo la escribe el servidor con la llave de servicio; ningun usuario la lee.
--   outlook_processed   una fila por correo de Indeed ya visto (message_id = id de Graph): el resultado (created,
--                       duplicate, skipped, failed), el candidato que creo o encontro, y el motivo si no.
--                       Es la ventana de «que paso con cada correo» que el admin ve en la tarjeta de Ajustes.
--
-- SEGURIDAD.
--   - RLS activo en las dos. outlook_connection NO tiene ninguna politica: ni authenticated ni anon la leen ni la
--     escriben; solo el rol de servicio (que salta RLS). El token no sale nunca al navegador.
--   - outlook_processed: solo el admin la lee (public.is_admin(), la misma funcion de la 099). Escribe el servidor.
--
-- LO QUE NO TOCA. Ninguna tabla existente, ninguna politica existente, ningun dato.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La conexion (una fila).
-- ---------------------------------------------------------------------------
create table if not exists recruiting.outlook_connection (
  id                          smallint primary key default 1 check (id = 1),
  mailbox                     text,
  refresh_token_enc           text,
  connected_by                uuid,
  connected_at                timestamptz,
  last_check_at               timestamptz,
  last_error                  text,
  -- El cursor: el correo de Indeed mas reciente que ya se reviso. Cada corrida mira desde aqui menos un margen.
  last_message_received_at    timestamptz
);

alter table recruiting.outlook_connection enable row level security;
-- Sin politicas a proposito: solo el servicio (llave de servicio) lo toca. Se quitan los privilegios de los roles
-- de la app por si la base los hubiera dado por defecto.
revoke all on recruiting.outlook_connection from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Los correos ya procesados.
-- ---------------------------------------------------------------------------
create table if not exists recruiting.outlook_processed (
  message_id        text primary key,
  received_at       timestamptz,
  subject           text,
  from_address      text,
  -- created: candidato nuevo · duplicate: ya existia · noted: mensaje de candidato anotado en su ficha ·
  -- skipped: no se pudo o no toca (con motivo en error) · failed: error al procesar.
  result            text not null check (result in ('created', 'duplicate', 'noted', 'skipped', 'failed')),
  candidate_id      uuid,
  error             text,
  -- Lo que se agendo por el mensaje (llamada con hora): el mismo valor que se pone en `phone_date` del candidato.
  scheduled_at      timestamptz,
  -- Resumen legible de lo detectado y lo agendado (telefono, hora o «cualquier hora», seguimiento, choques).
  detail            text,
  processed_at      timestamptz not null default now()
);

create index if not exists outlook_processed_processed_at_idx on recruiting.outlook_processed (processed_at desc);

alter table recruiting.outlook_processed enable row level security;

drop policy if exists "admin read outlook_processed" on recruiting.outlook_processed;
create policy "admin read outlook_processed" on recruiting.outlook_processed
  for select to authenticated using (public.is_admin());

revoke all on recruiting.outlook_processed from anon;
grant select on recruiting.outlook_processed to authenticated;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('310_outlook_indeed.sql', '95abd67ac5307587cf2d9ac26cc3b19d1db14a0c86fbd7e4fbba388180b49a85') on conflict (name) do nothing;
