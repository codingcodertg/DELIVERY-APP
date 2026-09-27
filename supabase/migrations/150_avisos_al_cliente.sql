-- 150 - Avisos al cliente, como OptimoRoute: la noche antes y "en camino"
-- ===========================================================================
-- El dueno, 2026-09-27, tras explicarle OptimoRoute (optimoroute.com/customer-notifications): "solos haz 1 3 y 4".
-- El 1: un aviso al cliente la NOCHE ANTES de la entrega y otro cuando el chofer VA EN CAMINO, por SMS o correo
-- segun su preferencia, con el enlace de seguimiento (/track/<id>) y opcion de darse de baja.
--
-- Plan en papel: docs/PLAN-150-avisos-al-cliente.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues
-- del merge, con respaldo hecho y migrate-status antes y despues. 147, 148 y 149 estan aplicadas; 150 es la
-- siguiente libre.
--
-- Que trae, y SOLO esto:
--   1. settings: tres columnas. Los dos interruptores (noche antes / en camino) nacen en FALSE: hasta que el admin
--      los encienda en Ajustes no sale nada. La hora de la noche antes (hora de Texas, 12-20), 18 por defecto.
--   2. deliveries: tres columnas. customer_email (opcional), notify_pref (both | sms | email | none, 'both' por
--      defecto = lo que haya) y customer_lang (en | es | null; null = el aviso va en ingles y espanol a la vez).
--   3. public.customer_notifications: el REGISTRO de lo enviado. Una fila por orden, tipo de aviso y dia de entrega
--      (clave unica): es lo que hace el envio idempotente (se reclama la fila ANTES de mandar). El dia entra en la
--      clave porque una orden reprogramada es otra entrega y su cliente tiene que enterarse de la fecha nueva. Guarda a quien, por que canal, que
--      dijo el proveedor, cuantos segmentos de SMS (el coste) y el token de la baja.
--   4. public.customer_notify_optouts: las BAJAS, por contacto (telefono E.164 o correo en minusculas). Valen para
--      todas las ordenes de ese contacto.
--
-- Decisiones, con su motivo:
--   a. Registro y bajas los escribe SOLO la llave de servicio (el cron, /api/avisos-cliente/*). Ningun rol de la app
--      escribe: authenticated no tiene INSERT/UPDATE/DELETE, y ninguna politica de escritura. Los lee el admin (para
--      auditar y ver el coste). anon, nada: la pagina de baja no lee la base, llama a una ruta del servidor.
--   b. customer_notifications.delivery_id SIN clave foranea: una orden borrada (142) no debe llevarse el registro de
--      lo que se le mando y se cobro.
--   c. customer_email sin validar el formato en la base (solo el largo): un correo mal tecleado no puede tumbar el
--      guardado de la orden entera. Que sea valido lo decide el envio (correoValido), que lo salta si no.
--   d. No toca guard_delivery_stage (145) ni guard_factura_obligatoria (146): las columnas nuevas siguen las reglas
--      de siempre de "quien edita la orden en esa etapa". La autocomprobacion exige que no las mencionen.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. settings
-- ---------------------------------------------------------------------------
alter table public.settings add column if not exists notify_night_before_enabled boolean not null default false;
alter table public.settings add column if not exists notify_on_the_way_enabled   boolean not null default false;
alter table public.settings add column if not exists notify_night_before_hour    smallint not null default 18;

alter table public.settings drop constraint if exists settings_notify_night_before_hour_range;
alter table public.settings add constraint settings_notify_night_before_hour_range
  check (notify_night_before_hour between 12 and 20);

-- ---------------------------------------------------------------------------
-- 2. deliveries
-- ---------------------------------------------------------------------------
alter table public.deliveries add column if not exists customer_email text;
alter table public.deliveries add column if not exists notify_pref    text not null default 'both';
alter table public.deliveries add column if not exists customer_lang  text;

alter table public.deliveries drop constraint if exists deliveries_customer_email_length;
alter table public.deliveries add constraint deliveries_customer_email_length
  check (customer_email is null or char_length(customer_email) <= 320);
alter table public.deliveries drop constraint if exists deliveries_notify_pref_allowed;
alter table public.deliveries add constraint deliveries_notify_pref_allowed
  check (notify_pref in ('both', 'sms', 'email', 'none'));
alter table public.deliveries drop constraint if exists deliveries_customer_lang_allowed;
alter table public.deliveries add constraint deliveries_customer_lang_allowed
  check (customer_lang is null or customer_lang in ('en', 'es'));

-- ---------------------------------------------------------------------------
-- 3. El registro de lo enviado
-- ---------------------------------------------------------------------------
create table if not exists public.customer_notifications (
  id           uuid primary key default gen_random_uuid(),
  delivery_id  uuid not null,
  kind         text not null,
  service_date date not null,
  sms_to       text,
  email_to     text,
  sms_status   text,
  email_status text,
  sms_segments smallint,
  provider     text,
  error        text,
  unsub_token  text not null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  constraint customer_notifications_once        unique (delivery_id, kind, service_date),
  constraint customer_notifications_token_unico unique (unsub_token),
  constraint customer_notifications_kind_allowed check (kind in ('night_before', 'on_the_way')),
  constraint customer_notifications_sms_status  check (sms_status   is null or sms_status   in ('sent', 'dry_run', 'failed')),
  constraint customer_notifications_mail_status check (email_status is null or email_status in ('sent', 'dry_run', 'failed')),
  constraint customer_notifications_token_forma check (unsub_token ~ '^[A-Za-z0-9_-]{16}$'),
  constraint customer_notifications_a_alguien   check (sms_to is not null or email_to is not null)
);

comment on table public.customer_notifications is
  'Avisos al cliente enviados (150): uno por orden, tipo (night_before, on_the_way) y dia de entrega (service_date). Lo escribe solo la llave de servicio; lo lee el admin. sms_segments = coste. unsub_token = enlace de baja.';

create index if not exists customer_notifications_created_at on public.customer_notifications (created_at);

-- ---------------------------------------------------------------------------
-- 4. Las bajas
-- ---------------------------------------------------------------------------
create table if not exists public.customer_notify_optouts (
  contact             text primary key,
  channel             text not null,
  source_notification uuid,
  created_at          timestamptz not null default now(),
  constraint customer_notify_optouts_channel check (channel in ('sms', 'email')),
  constraint customer_notify_optouts_contact check (btrim(contact) <> '' and char_length(contact) <= 320)
);

comment on table public.customer_notify_optouts is
  'Bajas de los avisos al cliente (150): telefono E.164 o correo en minusculas. Valen para todas sus ordenes. Las escribe /api/avisos-cliente/baja (llave de servicio).';

-- ---------------------------------------------------------------------------
-- Quien lee y quien escribe
-- ---------------------------------------------------------------------------
-- El revoke va primero: en Supabase los privilegios por defecto dan TODO a anon y authenticated sobre cada tabla
-- nueva, y un grant a secas no quita nada (medido al ensayar la 126).
alter table public.customer_notifications  enable row level security;
alter table public.customer_notify_optouts enable row level security;

revoke all on public.customer_notifications  from anon, authenticated;
revoke all on public.customer_notify_optouts from anon, authenticated;
grant select on public.customer_notifications  to authenticated;
grant select on public.customer_notify_optouts to authenticated;

drop policy if exists "customer_notifications select admin"  on public.customer_notifications;
drop policy if exists "customer_notify_optouts select admin" on public.customer_notify_optouts;

create policy "customer_notifications select admin" on public.customer_notifications for select to authenticated
  using ((select public.is_admin()));
create policy "customer_notify_optouts select admin" on public.customer_notify_optouts for select to authenticated
  using ((select public.is_admin()));

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
  t text;
  guard text;
  f146 regprocedure := to_regprocedure('public.guard_factura_obligatoria()');
begin
  -- settings
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'settings'
     and ((column_name in ('notify_night_before_enabled', 'notify_on_the_way_enabled') and data_type = 'boolean' and column_default = 'false')
       or (column_name = 'notify_night_before_hour' and data_type = 'smallint' and column_default = '18'))
     and is_nullable = 'NO';
  if n <> 3 then raise exception '150: settings no tiene las 3 columnas de avisos como se esperaba (tiene %)', n; end if;
  if exists (select 1 from public.settings where notify_night_before_enabled or notify_on_the_way_enabled) then
    raise exception '150: algun aviso quedo ENCENDIDO al migrar; deben nacer apagados';
  end if;

  -- deliveries
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'deliveries'
     and column_name in ('customer_email', 'notify_pref', 'customer_lang');
  if n <> 3 then raise exception '150: deliveries tiene % de las 3 columnas de avisos', n; end if;
  if exists (select 1 from public.deliveries where notify_pref <> 'both') then
    raise exception '150: hay ordenes con notify_pref distinto de both recien migrada';
  end if;

  -- RLS y politicas de las dos tablas nuevas
  foreach t in array array['customer_notifications', 'customer_notify_optouts'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '150: % quedo sin RLS', t;
    end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t;
    if n <> 1 then raise exception '150: % tiene % politicas, se esperaba 1 (select admin)', t, n; end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    if n <> 0 then raise exception '150: % tiene politicas que no son SELECT', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT')
       or has_table_privilege('anon', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then
      raise exception '150: permisos de mas sobre %', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception '150: a authenticated le falta SELECT sobre % (la politica decide quien)', t;
    end if;
  end loop;

  -- Los guards no se enteran de las columnas nuevas (se mira el codigo sin comentarios: leccion de la 144).
  guard := regexp_replace(regexp_replace(pg_get_functiondef('public.guard_delivery_stage()'::regprocedure), '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  if guard ~ '(customer_email|notify_pref|customer_lang)' then
    raise exception '150: guard_delivery_stage menciona una columna de avisos; esta migracion supone que no';
  end if;
  if f146 is null then
    raise notice '150: la 146 no esta aplicada; no hay guard_factura_obligatoria que mirar';
  else
    guard := regexp_replace(regexp_replace(pg_get_functiondef(f146), '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
    if guard ~ '(customer_email|notify_pref|customer_lang)' then
      raise exception '150: guard_factura_obligatoria menciona una columna de avisos; esta migracion supone que no';
    end if;
  end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-150-avisos-al-cliente.md, seccion 6). Se pega en una transaccion abierta a
-- mano y se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui abajo
-- corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (a mano, en una transaccion propia)
-- ===========================================================================
--   drop table if exists public.customer_notify_optouts;   -- se lleva politicas y restricciones
--   drop table if exists public.customer_notifications;
--   alter table public.deliveries drop constraint if exists deliveries_customer_lang_allowed;
--   alter table public.deliveries drop constraint if exists deliveries_notify_pref_allowed;
--   alter table public.deliveries drop constraint if exists deliveries_customer_email_length;
--   alter table public.deliveries drop column if exists customer_lang;
--   alter table public.deliveries drop column if exists notify_pref;
--   alter table public.deliveries drop column if exists customer_email;
--   alter table public.settings drop constraint if exists settings_notify_night_before_hour_range;
--   alter table public.settings drop column if exists notify_night_before_hour;
--   alter table public.settings drop column if exists notify_on_the_way_enabled;
--   alter table public.settings drop column if exists notify_night_before_enabled;
--   delete from public.schema_migrations where name = '150_avisos_al_cliente.sql';
--
-- Se pierden el registro de lo enviado, las bajas (!) y los correos/preferencias de las ordenes. Las bajas son
-- importantes: si se revierte y luego se vuelve a aplicar, quien se dio de baja volveria a recibir avisos. Antes de
-- revertir: \copy public.customer_notify_optouts to 'bajas-150.csv' csv header
-- La app no se rompe: sin las columnas, Ajustes dice "falta aplicar la 150" y no ensena los interruptores, la ficha
-- no ensena ni manda los campos (conAvisosSiCabe), el cron lee settings, falla con 502 y no manda nada, y el aviso
-- "en camino" no se pide (el interruptor no existe = apagado).

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('150_avisos_al_cliente.sql', '4754be718409974b2ec90d75a9b235fe30045e592368693252fea71bc5f8faf2') on conflict (name) do nothing;
