-- ===========================================================================
-- 314 - Indeed por Gmail: la conexion de Gmail (IMAP con contrasena de aplicacion)
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueno, con migrate-status antes y despues.
--
-- QUE HACE. Una tabla nueva en recruiting, para leer por IMAP el Gmail personal del dueno, al que llegan los
-- correos de Indeed (regla de Outlook de careers@ que redirige, y reenvios en lote). Reusa `outlook_processed`
-- (migracion 310) para la dedupe y el registro: las claves de Gmail llevan el prefijo `gmail:`.
--   gmail_connection   una sola fila (id = 1): el correo de Gmail, la contrasena de aplicacion CIFRADA (AES-256-GCM,
--                      con la llave OUTLOOK_TOKEN_KEY, nunca en la base), el cursor (UIDVALIDITY + ultimo UID
--                      procesado), la fecha y el error de la ultima revision, y los contadores acumulados.
--
-- SEGURIDAD.
--   - RLS activo. gmail_connection NO tiene ninguna politica: ni authenticated ni anon la leen ni la escriben; solo
--     el rol de servicio (que salta RLS). La contrasena cifrada no sale nunca al navegador.
--   - Los privilegios de anon y authenticated se quitan explicitamente.
--   - outlook_processed no cambia: sigue con su politica de solo lectura para el admin (310).
--
-- LO QUE NO TOCA. Ninguna tabla existente, ninguna politica existente, ningun dato.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La conexion (una fila).
-- ---------------------------------------------------------------------------
create table if not exists recruiting.gmail_connection (
  id                  smallint primary key default 1 check (id = 1),
  -- Gmail personal que recibe los correos de Indeed (solo la direccion; la contrasena va cifrada abajo).
  gmail_address       text,
  -- Contrasena de aplicacion de Google, cifrada (formato v1:<iv>:<tag>:<cuerpo>, contexto «gmail:app-password»).
  app_password_enc    text,
  connected_by        uuid,
  connected_at        timestamptz,
  -- Cursor: UIDVALIDITY de la INBOX cuando se guardo el UID, y el ultimo UID de correo de Indeed ya procesado.
  uidvalidity         bigint,
  last_uid            bigint not null default 0,
  -- Ultima revision (cron o «Revisar ahora») y su error corto, si lo hubo.
  last_run_at         timestamptz,
  last_error          text,
  -- Contadores acumulados desde que se conecto (para la tarjeta).
  total_revisados     integer not null default 0,
  total_creados       integer not null default 0,
  total_notas         integer not null default 0,
  total_omitidos      integer not null default 0,
  total_fallidos      integer not null default 0
);

alter table recruiting.gmail_connection enable row level security;
-- Sin politicas a proposito: solo el servicio (llave de servicio) lo toca. Se quitan los privilegios de los roles
-- de la app por si la base los hubiera dado por defecto.
revoke all on recruiting.gmail_connection from anon, authenticated;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('314_gmail_indeed.sql', 'e27946fd703c873c3ebe098198392f520b04e2bea8550d8ccdf499271f0c4289') on conflict (name) do nothing;
