-- ===========================================================================
-- 329 - RingCentral de los choferes: las extensiones de los choferes y todas sus llamadas con grabacion
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueno, con migrate-status antes y despues.
--
-- QUE HACE. La app «RingCentral» (/ringcentral, solo admin) guarda, en `public`, las extensiones de RingCentral que el
-- admin marca como choferes y TODAS sus llamadas (entrantes y salientes) con su grabacion. Lo llena el cron rc-choferes
-- (src/app/api/cron/rc-choferes) con la llave de servicio. Es independiente de la 326 (las comunicaciones de candidatos,
-- del dueno): aqui no se empareja nada con candidatos.
--
-- DONDE VIVEN. En `public`, no en un esquema nuevo: PostgREST ya expone `public` y la app lo usa sin tocar la
-- configuracion (un esquema nuevo habria exigido anadirlo a los esquemas expuestos de la API).
--
--   rc_driver_extensions   una fila por extension marcada como chofer (id de RingCentral como clave). `active` = sigue
--                          siendo chofer; al desmarcar no se borra, se pone en false, para no perder sus llamadas.
--                          No lleva `driver_profile_id`: no hay un vinculo trivial entre una extension y un perfil del
--                          hub, y adivinarlo mezclaria personas.
--   rc_driver_calls        una fila por llamada de una extension de chofer. La clave unica es (extension, id de la
--                          llamada) y NO solo el id de la llamada: una llamada entre dos choferes aparece en los dos
--                          registros y se guarda una vez por chofer, para que cada uno la vea en su lista.
--   rc_driver_sync_state   el cursor de cada extension (hasta donde llego), cuando corrio por ultima vez y el ultimo
--                          error («sin_permiso», «limite», «listado»).
--   Bucket rc-driver-recordings  PRIVADO, sin politicas para los clientes: los audios salen firmados (10 minutos) por
--                          el servidor, a un admin que ya paso la comprobacion.
--
-- SEGURIDAD (RLS, la misma funcion `public.is_admin()` de la 099 que usa la 326):
--   - rc_driver_extensions: solo el admin lee, agrega y cambia (select/insert/update). No se borra desde la app.
--   - rc_driver_calls y rc_driver_sync_state: solo el admin lee. No tienen politicas de escritura: las escribe el
--     servidor con la llave de servicio, que salta RLS.
--   - anon no ve ni toca nada. Los grants a authenticated son los mismos que las politicas permiten.
--
-- LO QUE NO TOCA. Ninguna tabla, politica ni dato existente (ni la 326 ni recruiting.rc_comms).
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Las extensiones de los choferes.
-- ---------------------------------------------------------------------------
create table if not exists public.rc_driver_extensions (
  rc_extension_id   text primary key,
  extension_number  text not null,
  name              text not null default '',
  active            boolean not null default true,
  added_by          uuid references public.profiles(id) on delete set null,
  added_at          timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.rc_driver_extensions enable row level security;

drop policy if exists "admin read rc_driver_extensions" on public.rc_driver_extensions;
create policy "admin read rc_driver_extensions" on public.rc_driver_extensions
  for select to authenticated using (public.is_admin());

drop policy if exists "admin insert rc_driver_extensions" on public.rc_driver_extensions;
create policy "admin insert rc_driver_extensions" on public.rc_driver_extensions
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin update rc_driver_extensions" on public.rc_driver_extensions;
create policy "admin update rc_driver_extensions" on public.rc_driver_extensions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.rc_driver_extensions from anon, authenticated;
grant select, insert, update on public.rc_driver_extensions to authenticated;

create index if not exists rc_driver_extensions_active_idx on public.rc_driver_extensions (active);

-- ---------------------------------------------------------------------------
-- 2. Las llamadas de los choferes, con su grabacion.
-- ---------------------------------------------------------------------------
create table if not exists public.rc_driver_calls (
  id                  uuid primary key default gen_random_uuid(),
  -- Id del registro del call log de RingCentral. Con la extension forma la clave (ver el encabezado).
  rc_call_id          text not null,
  rc_extension_id     text not null references public.rc_driver_extensions(rc_extension_id) on delete cascade,
  direction           text not null check (direction in ('in', 'out')),
  started_at          timestamptz not null,
  duration_s          int,
  from_number         text,
  from_name           text,
  to_number           text,
  to_name             text,
  -- Resultado de RingCentral («Accepted», «Missed», «Voicemail»...).
  result              text,
  -- Grabacion: la URL de RingCentral mientras esta pendiente; la ruta en el bucket cuando ya se bajo.
  recording_uri       text,
  recording_path      text,
  recording_pending   boolean not null default false,
  -- Intentos de bajar la grabacion: tras varios fallos el servidor deja de intentarla (no tapa a las demas).
  recording_intentos  int not null default 0,
  created_at          timestamptz not null default now(),
  unique (rc_extension_id, rc_call_id)
);

create index if not exists rc_driver_calls_extension_started_idx on public.rc_driver_calls (rc_extension_id, started_at desc);
create index if not exists rc_driver_calls_started_idx on public.rc_driver_calls (started_at desc);
create index if not exists rc_driver_calls_pending_idx on public.rc_driver_calls (started_at desc) where recording_pending;

alter table public.rc_driver_calls enable row level security;

drop policy if exists "admin read rc_driver_calls" on public.rc_driver_calls;
create policy "admin read rc_driver_calls" on public.rc_driver_calls
  for select to authenticated using (public.is_admin());

revoke all on public.rc_driver_calls from anon, authenticated;
grant select on public.rc_driver_calls to authenticated;

-- ---------------------------------------------------------------------------
-- 3. El cursor y el estado de la lectura, por extension.
-- ---------------------------------------------------------------------------
create table if not exists public.rc_driver_sync_state (
  rc_extension_id   text primary key references public.rc_driver_extensions(rc_extension_id) on delete cascade,
  -- Hasta cuando se leyo sin errores (la siguiente corrida vuelve 2 horas antes, por el solape).
  cursor_at         timestamptz,
  last_run_at       timestamptz,
  -- Null cuando la ultima corrida salio bien. Valores: «sin_permiso», «limite», «listado».
  last_error_code   text,
  updated_at        timestamptz not null default now()
);

alter table public.rc_driver_sync_state enable row level security;

drop policy if exists "admin read rc_driver_sync_state" on public.rc_driver_sync_state;
create policy "admin read rc_driver_sync_state" on public.rc_driver_sync_state
  for select to authenticated using (public.is_admin());

revoke all on public.rc_driver_sync_state from anon, authenticated;
grant select on public.rc_driver_sync_state to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Las grabaciones: bucket privado, sin politicas para los clientes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rc-driver-recordings', 'rc-driver-recordings', false)
on conflict (id) do update set public = false;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('329_ringcentral_choferes.sql', 'd762bd4393ae31a0be5087ea8f612e148bf3ecce839c09d04398f80d46c4aff1') on conflict (name) do nothing;
