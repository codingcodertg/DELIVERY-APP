-- ===========================================================================
-- 258 · Solicitudes de ayuda: DONDE estaba la persona, con palabras, y con que aparato
-- ===========================================================================
-- PEDIDO. El dueno, 2026-11-06: "be more specific in the help request, for example whether it's in the Delivery app
-- main page, or Delivery app route manager, to know what they are looking at when they don't send a screenshot".
-- Hasta ahora la solicitud guardaba `page` como ruta cruda ('/', '/routes', '/operaciones/nuevo/scrap') y la version.
-- Eso no dice que tenia delante quien escribe.
--
-- QUE HACE:
--   1. Tres columnas nuevas en `public.help_requests`, las tres opcionales:
--        location_en / location_es  la ubicacion legible, compuesta por la app al mandar: app + pantalla + lo que
--                                   habia abierto ("Deliveries app · Routes Manager · Unassigned tab"). En los dos
--                                   idiomas, porque la lee el admin en el suyo y no en el de quien escribe.
--        device                     { tipo: phone|tablet|desktop, ancho, alto, navegador, sistema }.
--      `page` se queda como esta: es la ruta exacta y sirve para buscarla en el codigo.
--   2. El guardia de la 120 (`guard_help_request_immutable`) las cuenta como historial: no se editan despues.
--   3. El aviso de la campana al admin cuando la persona escribe en el hilo (`help_message_after_insert`, 126) dice
--      tambien desde donde se pidio la ayuda: 'Help: Ana wrote (Deliveries app · Routes Manager) — "..."'. Es la
--      funcion de la 126 tal cual, con ese parentesis de mas; nada mas cambia (a quien se avisa, cuando se reabre).
--
-- LO QUE NO HACE:
--   * No rellena las solicitudes viejas: se quedan con las columnas nulas y la pantalla deduce el nombre de `page`
--     (`ubicacionDeSolicitud`, src/lib/ayuda-ubicacion.ts). Rellenarlas seria reescribir historial que el guardia
--     protege, con un nombre que se puede calcular al leer.
--   * No cambia politicas ni permisos: las tres de la 120 siguen siendo tres.
--
-- ORDEN CON EL DESPLIEGUE. La app funciona SIN esta migracion: `/api/help` prueba a guardar con las columnas nuevas y,
-- si la base no las conoce, guarda como antes; la bandeja del admin lee con ellas y, si fallan, sin ellas. Aplicarla
-- antes o despues del despliegue da igual; hasta aplicarla, la ubicacion va en el correo pero no queda en la fila.
--
-- DATOS PERSONALES. La ubicacion la compone la app con el nombre de la pantalla y, como mucho, el identificador que ya
-- esta en pantalla (numero de orden o de factura, nombre de la cuenta). No lleva telefonos, direcciones ni correos.
--
-- REVERSION y ENSAYO (al final).
-- ---------------------------------------------------------------------------

alter table public.help_requests
  add column if not exists location_en text,
  add column if not exists location_es text,
  add column if not exists device      jsonb;

-- El tope es el mismo que aplica la ruta (`LIMITE_DE_UBICACION`): una ubicacion es una linea, no un parrafo.
do $limites$
begin
  if not exists (select 1 from pg_constraint where conname = 'help_requests_location_len') then
    alter table public.help_requests add constraint help_requests_location_len
      check (coalesce(char_length(location_en), 0) <= 300 and coalesce(char_length(location_es), 0) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'help_requests_device_is_object') then
    alter table public.help_requests add constraint help_requests_device_is_object
      check (device is null or jsonb_typeof(device) = 'object');
  end if;
end $limites$;

comment on column public.help_requests.location_en is
  'Donde estaba quien escribe, legible y en ingles: app + pantalla + pestana/ficha abierta (258). Nulo en las de antes.';
comment on column public.help_requests.location_es is
  'Lo mismo que location_en, en espanol (258).';
comment on column public.help_requests.device is
  'El aparato: { tipo, ancho, alto, navegador, sistema } (258). Nulo en las de antes.';

-- ---------------------------------------------------------------------------
-- El historial no se reescribe: tambien lo nuevo
-- ---------------------------------------------------------------------------
create or replace function public.guard_help_request_immutable()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.user_id is distinct from OLD.user_id
     or NEW.created_at  is distinct from OLD.created_at
     or NEW.message     is distinct from OLD.message
     or NEW.files       is distinct from OLD.files
     or NEW.page        is distinct from OLD.page
     or NEW.location_en is distinct from OLD.location_en
     or NEW.location_es is distinct from OLD.location_es
     or NEW.device      is distinct from OLD.device
     or NEW.sender_name is distinct from OLD.sender_name
     or NEW.sender_email is distinct from OLD.sender_email
     or NEW.role_label  is distinct from OLD.role_label
     or NEW.app_version is distinct from OLD.app_version
     or NEW.lang        is distinct from OLD.lang then
    raise exception 'A help request is history: only its status and the email result can change';
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- Al entrar un mensaje: reabrir y avisar, diciendo desde donde se pidio la ayuda
-- ---------------------------------------------------------------------------
-- La funcion de la 126, con una sola diferencia: `donde`. Sin ubicacion guardada (una solicitud de antes) el aviso
-- sale exactamente como salia.
create or replace function public.help_message_after_insert()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  s       public.help_requests%rowtype;
  destino uuid;
  asomo   text;
  donde   text;
begin
  if NEW.author_id is null then return NEW; end if;
  select * into s from public.help_requests r where r.id = NEW.request_id;
  if not found then return NEW; end if;

  -- Lo justo del mensaje para reconocerlo en la campana, en una linea.
  asomo := btrim(regexp_replace(NEW.body, '\s+', ' ', 'g'));
  if char_length(asomo) > 60 then asomo := rtrim(left(asomo, 59)) || '…'; end if;

  -- Desde donde se pidio la ayuda, entre parentesis y con tope: la campana es estrecha. El aviso al admin va en
  -- ingles, como hasta ahora, y por eso se lee `location_en`.
  donde := btrim(coalesce(s.location_en, ''));
  if char_length(donde) > 80 then donde := rtrim(left(donde, 79)) || '…'; end if;
  if donde <> '' then donde := ' (' || donde || ')'; end if;

  if NEW.author_id = s.user_id then
    -- Escribe quien la abrio. Contestar a una atendida la devuelve a pendiente; que escriba el admin
    -- no reabre nada, que por eso esta rama del `if` es la unica que toca el estado.
    if s.status = 'atendida' then
      update public.help_requests
         set status = 'pendiente', attended_by = null, attended_at = null
       where id = s.id;
    end if;

    -- El admin que ya esta en el hilo: el ultimo que escribio en el...
    select m.author_id into destino
      from public.help_messages m
      join public.profiles p on p.id = m.author_id and p.role = 'admin'
     where m.request_id = s.id and m.author_id <> NEW.author_id
     order by m.created_at desc
     limit 1;
    -- ...y si ninguno escribio, quien la atendio (`s` se leyo ANTES de reabrirla).
    if destino is null then
      select p.id into destino from public.profiles p
       where p.id = s.attended_by and p.role = 'admin' and p.id <> NEW.author_id;
    end if;

    if destino is not null then
      insert into public.notifications (user_id, kind, message)
      values (destino, 'ayuda_mensaje', 'Help: ' || coalesce(NEW.author_name, 'someone') || ' wrote' || donde || ' — “' || asomo || '”');
    else
      insert into public.notifications (user_id, kind, message)
      select p.id, 'ayuda_mensaje', 'Help: ' || coalesce(NEW.author_name, 'someone') || ' wrote' || donde || ' — “' || asomo || '”'
        from public.profiles p
       where p.role = 'admin' and p.id <> NEW.author_id;
    end if;
  elsif s.user_id is not null then
    -- Escribe un admin: a quien la abrio, en el idioma en que escribio. El id del aviso ES el del mensaje.
    insert into public.notifications (id, user_id, kind, message)
    values (NEW.id, s.user_id, 'ayuda_respuesta',
      case when lower(btrim(coalesce(s.lang, ''))) like 'es%'
        then 'Respuesta a tu solicitud de ayuda: «' || asomo || '»'
        else 'Reply to your help request: “' || asomo || '”' end);
  end if;
  return NEW;
end $$;

-- Las funciones de disparador no se llaman a mano (`create or replace` conserva los permisos; se repite por si acaso).
revoke execute on function public.help_message_after_insert()    from public, anon, authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'help_requests'
     and column_name in ('location_en', 'location_es', 'device');
  if n <> 3 then raise exception '258: help_requests tiene % de las 3 columnas nuevas', n; end if;

  -- La 120 sigue como estaba: sus tres politicas, su guardia y RLS.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'help_requests';
  if n <> 3 then raise exception '258: help_requests tiene % politicas, se esperaban 3', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.help_requests'::regclass) then
    raise exception '258: help_requests quedo sin RLS';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.help_requests'::regclass and tgname = 'help_requests_guard_immutable') then
    raise exception '258: falta el guardia de help_requests';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.help_messages'::regclass and tgname = 'help_messages_after_insert') then
    raise exception '258: falta el disparador de avisos de help_messages';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   1. Volver a crear `guard_help_request_immutable()` y `help_message_after_insert()` con el cuerpo de la 120 y de
--      la 126 (copiar de esos ficheros): las de aqui leen las columnas que se van a borrar.
--   2. alter table public.help_requests
--        drop constraint if exists help_requests_location_len,
--        drop constraint if exists help_requests_device_is_object,
--        drop column if exists location_en, drop column if exists location_es, drop column if exists device;
--   3. delete from public.schema_migrations where name = '258_ayuda_ubicacion_clara.sql';
--   La app sigue funcionando sin las columnas (guarda y lee como antes).
--
-- ===========================================================================
-- Ensayo, con ROLLBACK
-- ===========================================================================
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   insert into public.help_requests (user_id, message, page, location_en, location_es, device)
--   values ('<uuid-vendedor>', 'no carga', '/routes', 'Deliveries app · Routes Manager', 'App de Entregas · Gestor de Rutas',
--           '{"tipo":"phone","ancho":390,"alto":844,"navegador":"Chrome 141","sistema":"Android"}');    -- 1 fila
--   insert into public.help_requests (user_id, message, device) values ('<uuid-vendedor>', 'x', '[]');  -- ERROR: device_is_object
--   insert into public.help_messages (request_id, author_id, body) values (<la de arriba>, '<uuid-vendedor>', 'sigue igual');
--   reset role;
--   select message from public.notifications where kind = 'ayuda_mensaje' order by created_at desc limit 1;
--     -> 'Help: <nombre> wrote (Deliveries app · Routes Manager) — “sigue igual”'
--   update public.help_requests set location_en = 'otra' where id = <la de arriba>;                     -- ERROR del guardia
--   rollback;
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('258_ayuda_ubicacion_clara.sql', 'dc6b4a3425b2fa84b254000c9f83195cb47299db4edf9bdda87d39cf70d22e8e') on conflict (name) do nothing;
