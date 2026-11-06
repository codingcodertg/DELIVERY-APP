-- ===========================================================================
-- 262 · Solicitudes de ayuda: quien la escribio puede ELIMINARLA (y el admin, cualquiera)
-- ===========================================================================
-- PEDIDO. Roberto (admin), 2026-11-06, desde «My help requests»: "Maybe add option to eliminate request". En la
-- captura marco una solicitud suya, todavia abierta, a la que el mismo habia contestado "Disregard this request": no
-- tenia como retirarla, y seguia contando como pendiente en la bandeja.
--
-- QUE HACE:
--   1. Tres columnas nuevas en `public.help_requests`, nulas mientras la solicitud esta viva:
--        deleted_at       cuando se elimino
--        deleted_by       quien (el id de su perfil; sin llave foranea, ver abajo)
--        deleted_by_name  su nombre en texto, como `sender_name` en la 120
--      Es un borrado BLANDO: la fila, su hilo y sus adjuntos siguen ahi. Las solicitudes son el registro de lo que
--      se pidio y de lo que se arreglo; lo que cambia es que dejan de listarse y de contar.
--   2. El guardia de la 120 (`guard_help_request_immutable`) aprende la eliminacion, en vez de saltarselo nadie:
--        * eliminar: solo quien la escribio o un admin; el guardia pone quien, su nombre y la hora (no el cliente);
--        * restaurar: solo un admin; limpia las tres columnas;
--        * quien y cuando se elimino no se reescriben despues;
--        * una solicitud eliminada no cambia de estado (ni se atiende ni se reabre) hasta que se restaura.
--      Lo demas del guardia es el de la 258, linea por linea.
--   3. Dos funciones, que son la puerta de la app (la politica de UPDATE de la 120 es solo del admin, y quien escribio
--      la solicitud no pasa por ella):
--        delete_help_request(p_id)   -> quien la escribio o un admin
--        restore_help_request(p_id)  -> solo un admin
--   4. En el hilo de una solicitud eliminada no se escribe (`help_messages_not_on_deleted`): si no, una respuesta la
--      «reabriria» sin que nadie la viera en ninguna lista.
--
-- LO QUE NO HACE:
--   * No toca `status`. Una pendiente eliminada sigue diciendo 'pendiente' en la fila, y al restaurarla vuelve tal
--     cual estaba. Lo que deja de contarla como abierta es `deleted_at`: las pantallas de la app ya lo miran, y
--     cualquier consulta de fuera que cuente pendientes tiene que anadir `and deleted_at is null`.
--   * No borra nada del cubo `help-files`: los adjuntos se quedan donde estan.
--   * No cambia politicas: las tres de la 120 siguen siendo tres. Quien la escribio sigue pudiendo LEER su fila
--     eliminada por la API; es la pantalla la que no la lista.
--
-- POR QUE `deleted_by` NO TIENE LLAVE FORANEA. Con `on delete set null`, borrar la cuenta de quien elimino algo
-- cambiaria la fila por detras y habria que abrirle un hueco al guardia. Sin llave, el id se queda como dato de
-- auditoria aunque la cuenta ya no exista, y el nombre esta en texto.
--
-- ORDEN CON EL DESPLIEGUE. Da igual antes que despues:
--   * migracion primero: la app vieja no conoce las columnas ni las funciones y sigue como estaba; nada se elimina;
--   * despliegue primero: la app lee con las columnas nuevas y, si la base no las conoce, sin ellas; mientras tanto
--     no ensena el boton de eliminar.
--
-- SIN `begin`/`commit` PROPIOS: quien aplica envuelve el fichero.
-- REVERSION y ENSAYO (al final).
-- ---------------------------------------------------------------------------

alter table public.help_requests
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid,
  add column if not exists deleted_by_name text;

-- Eliminada sin quien seria un estado que no se puede auditar (la misma idea que `attended_needs_who` en la 120);
-- y viva con restos de una eliminacion, tampoco.
do $limites$
begin
  if not exists (select 1 from pg_constraint where conname = 'help_requests_deleted_needs_who') then
    alter table public.help_requests add constraint help_requests_deleted_needs_who
      check (
        (deleted_at is null and deleted_by is null and deleted_by_name is null)
        or (deleted_at is not null and deleted_by is not null)
      );
  end if;
end $limites$;

comment on column public.help_requests.deleted_at is
  'Cuando se elimino la solicitud (262). Nulo = viva. Borrado blando: la fila, el hilo y los adjuntos se conservan.';
comment on column public.help_requests.deleted_by is
  'Quien la elimino: id de su perfil, sin llave foranea a proposito (262).';
comment on column public.help_requests.deleted_by_name is
  'El nombre de quien la elimino, en texto (262).';

-- ---------------------------------------------------------------------------
-- El historial no se reescribe; eliminar y restaurar SI, y solo asi
-- ---------------------------------------------------------------------------
-- La primera mitad es el guardia de la 258 tal cual. La segunda es nueva.
-- `auth.uid()` nulo = llave de servicio (sin sesion): no hay a quien preguntarle el rol, asi que se le deja eliminar
-- y restaurar, pero tiene que decir quien (`deleted_by`), que el `check` de arriba tampoco perdona.
create or replace function public.guard_help_request_immutable()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  yo uuid := auth.uid();
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

  if OLD.deleted_at is null and NEW.deleted_at is not null then
    -- ELIMINAR. Quien la escribio o un admin.
    if yo is not null then
      if not (coalesce(public.is_admin(), false) or coalesce(OLD.user_id = yo, false)) then
        raise exception 'Only the person who wrote a help request, or an admin, can remove it'
          using errcode = '42501';
      end if;
      -- Quien y cuando los pone la base, no lo que mande el navegador.
      NEW.deleted_by := yo;
      NEW.deleted_at := now();
    elsif NEW.deleted_by is null then
      raise exception 'A removed help request needs who removed it (deleted_by)';
    end if;
    if yo is not null or NEW.deleted_by_name is null then
      NEW.deleted_by_name := (select p.full_name from public.profiles p where p.id = NEW.deleted_by);
    end if;
    -- Eliminar es solo eliminar: el estado se queda como estaba, para que restaurarla la devuelva igual.
    if NEW.status is distinct from OLD.status
       or NEW.attended_by is distinct from OLD.attended_by
       or NEW.attended_at is distinct from OLD.attended_at then
      raise exception 'Removing a help request does not change its status';
    end if;

  elsif OLD.deleted_at is not null and NEW.deleted_at is null then
    -- RESTAURAR. Solo un admin.
    if yo is not null and not coalesce(public.is_admin(), false) then
      raise exception 'Only an admin can restore a removed help request' using errcode = '42501';
    end if;
    NEW.deleted_by := null;
    NEW.deleted_by_name := null;

  elsif OLD.deleted_at is not null then
    -- SIGUE ELIMINADA. Ni se reescribe quien/cuando, ni cambia de estado. (El resultado del correo si puede
    -- llegar: la ruta lo anota justo despues de guardar.)
    if NEW.deleted_at is distinct from OLD.deleted_at
       or NEW.deleted_by is distinct from OLD.deleted_by
       or NEW.deleted_by_name is distinct from OLD.deleted_by_name then
      raise exception 'Who removed a help request, and when, is history: it cannot be rewritten';
    end if;
    if NEW.status is distinct from OLD.status
       or NEW.attended_by is distinct from OLD.attended_by
       or NEW.attended_at is distinct from OLD.attended_at then
      raise exception 'This help request was removed: restore it before changing its status';
    end if;

  elsif NEW.deleted_by is not null or NEW.deleted_by_name is not null then
    -- VIVA, y alguien intenta dejarle restos de una eliminacion.
    raise exception 'A help request that is not removed has no remover';
  end if;

  return NEW;
end $$;

-- El disparador es el de la 120; se vuelve a crear por si acaso, con el mismo nombre.
drop trigger if exists help_requests_guard_immutable on public.help_requests;
create trigger help_requests_guard_immutable
  before update on public.help_requests
  for each row execute function public.guard_help_request_immutable();

-- ---------------------------------------------------------------------------
-- La puerta de la app: eliminar y restaurar
-- ---------------------------------------------------------------------------
-- `security definer` porque quien escribio la solicitud no pasa la politica de UPDATE de la 120 (es solo del admin),
-- y abrirle esa politica le dejaria tocar tambien el estado. Aqui solo puede hacer esto. La regla de quien puede
-- esta DOS veces a proposito: aqui, para contestar sin tocar la fila, y en el guardia, que es quien manda (la
-- sesion es la misma dentro de la funcion: `auth.uid()` sigue siendo quien llama).
--
-- «No existe» y «no es tuya» contestan lo mismo: asi nadie averigua por aqui que ids existen.
-- Eliminar una ya eliminada no es un error (dos toques al boton): devuelve la hora que ya tenia.
create or replace function public.delete_help_request(p_id uuid)
  returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  s      public.help_requests%rowtype;
  cuando timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in to remove a help request' using errcode = '42501';
  end if;
  select * into s from public.help_requests r where r.id = p_id for update;
  if not found or not (coalesce(public.is_admin(), false) or coalesce(s.user_id = auth.uid(), false)) then
    raise exception 'Help request not found, or it is not yours to remove' using errcode = '42501';
  end if;
  if s.deleted_at is not null then return s.deleted_at; end if;
  update public.help_requests set deleted_at = now(), deleted_by = auth.uid()
   where id = p_id returning deleted_at into cuando;
  return cuando;
end $$;

-- Restaurar una que no esta eliminada tampoco es un error: devuelve `false` y no toca nada.
create or replace function public.restore_help_request(p_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare
  s public.help_requests%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Only an admin can restore a removed help request' using errcode = '42501';
  end if;
  select * into s from public.help_requests r where r.id = p_id for update;
  if not found then
    raise exception 'Help request not found' using errcode = '42501';
  end if;
  if s.deleted_at is null then return false; end if;
  update public.help_requests set deleted_at = null, deleted_by = null, deleted_by_name = null where id = p_id;
  return true;
end $$;

revoke execute on function public.delete_help_request(uuid)  from public, anon;
revoke execute on function public.restore_help_request(uuid) from public, anon;
grant  execute on function public.delete_help_request(uuid)  to authenticated;
grant  execute on function public.restore_help_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- En el hilo de una eliminada no se escribe
-- ---------------------------------------------------------------------------
-- Un disparador aparte y no un cambio en `help_message_before_insert` (126): asi aquella funcion no se copia.
-- Vale tambien para la llave de servicio.
create or replace function public.help_message_not_on_deleted()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.help_requests r where r.id = NEW.request_id and r.deleted_at is not null) then
    raise exception 'This help request was removed: restore it before writing in it';
  end if;
  return NEW;
end $$;

drop trigger if exists help_messages_not_on_deleted on public.help_messages;
create trigger help_messages_not_on_deleted
  before insert on public.help_messages
  for each row execute function public.help_message_not_on_deleted();

-- Las funciones de disparador no se llaman a mano.
revoke execute on function public.guard_help_request_immutable() from public, anon, authenticated;
revoke execute on function public.help_message_not_on_deleted()  from public, anon, authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'help_requests'
     and column_name in ('deleted_at', 'deleted_by', 'deleted_by_name');
  if n <> 3 then raise exception '262: help_requests tiene % de las 3 columnas nuevas', n; end if;

  -- La 120 sigue como estaba: sus tres politicas, RLS y su guardia.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'help_requests';
  if n <> 3 then raise exception '262: help_requests tiene % politicas, se esperaban 3', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.help_requests'::regclass) then
    raise exception '262: help_requests quedo sin RLS';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.help_requests'::regclass and tgname = 'help_requests_guard_immutable') then
    raise exception '262: falta el guardia de help_requests';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.help_messages'::regclass and tgname = 'help_messages_not_on_deleted') then
    raise exception '262: falta el disparador que cierra el hilo de una eliminada';
  end if;

  -- Las dos puertas: para quien tiene sesion, y para nadie mas.
  if has_function_privilege('anon', 'public.delete_help_request(uuid)', 'execute')
     or has_function_privilege('anon', 'public.restore_help_request(uuid)', 'execute') then
    raise exception '262: anon puede eliminar o restaurar solicitudes';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_help_request(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.restore_help_request(uuid)', 'execute') then
    raise exception '262: authenticated no puede llamar a las funciones de eliminar/restaurar';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   1. Si ya hay solicitudes eliminadas, decidir antes que se hace con ellas: al quitar la columna vuelven a
--      listarse todas.   select id, deleted_at, deleted_by_name from public.help_requests where deleted_at is not null;
--   2. drop trigger if exists help_messages_not_on_deleted on public.help_messages;
--      drop function if exists public.help_message_not_on_deleted();
--      drop function if exists public.delete_help_request(uuid);
--      drop function if exists public.restore_help_request(uuid);
--   3. Volver a crear `guard_help_request_immutable()` con el cuerpo de la 258 (copiar de ese fichero): la de aqui
--      lee las columnas que se van a borrar.
--   4. alter table public.help_requests
--        drop constraint if exists help_requests_deleted_needs_who,
--        drop column if exists deleted_at, drop column if exists deleted_by, drop column if exists deleted_by_name;
--   5. delete from public.schema_migrations where name = '262_ayuda_eliminar_solicitud.sql';
--   La app sigue funcionando sin las columnas (lee como antes y esconde el boton).
--
-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- <uuid-persona> (no admin) con una solicitud suya PENDIENTE <sol-suya>; <uuid-otro> (no admin); <uuid-admin>.
--
--   begin;
--   set local role authenticated;
--
--   -- A. Otra persona: ni la elimina ni se entera de si existe.
--   set local request.jwt.claims = '{"sub":"<uuid-otro>","role":"authenticated"}';
--   select public.delete_help_request('<sol-suya>');                                   -- ERROR 42501
--   select public.restore_help_request('<sol-suya>');                                  -- ERROR 42501
--
--   -- B. Quien la escribio.
--   set local request.jwt.claims = '{"sub":"<uuid-persona>","role":"authenticated"}';
--   update public.help_requests set deleted_at = now(), deleted_by = '<uuid-persona>'
--    where id = '<sol-suya>';                                                          -- 0 filas (politica de la 120)
--   select public.delete_help_request('<sol-suya>');                                   -- la hora
--   select public.delete_help_request('<sol-suya>');                                   -- la MISMA hora
--   select status, deleted_by, deleted_by_name from public.help_requests where id = '<sol-suya>';
--                                                                                      -- pendiente, <uuid-persona>, su nombre
--   insert into public.help_messages (request_id, author_id, body)
--   values ('<sol-suya>', '<uuid-persona>', 'sigo aqui');                              -- ERROR: was removed
--   select public.restore_help_request('<sol-suya>');                                  -- ERROR 42501
--
--   -- C. Un admin.
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   update public.help_requests set status = 'atendida', attended_by = '<uuid-admin>', attended_at = now()
--    where id = '<sol-suya>';                                                          -- ERROR: restore it before
--   update public.help_requests set deleted_by_name = 'otro' where id = '<sol-suya>';  -- ERROR: cannot be rewritten
--   select public.restore_help_request('<sol-suya>');                                  -- true
--   select public.restore_help_request('<sol-suya>');                                  -- false
--   select status, deleted_at, deleted_by from public.help_requests where id = '<sol-suya>';   -- pendiente, null, null
--   update public.help_requests set deleted_at = now(), deleted_by = '<uuid-otro>'
--    where id = '<sol-suya>';                                                          -- 1 fila...
--   select deleted_by from public.help_requests where id = '<sol-suya>';               -- ...pero <uuid-admin>: lo pone el guardia
--   update public.help_requests set message = 'reescrita' where id = '<sol-suya>';     -- ERROR del guardia (120)
--
--   -- D. La llave de servicio (reset role; sin claims): tiene que decir quien.
--   reset role;  reset request.jwt.claims;
--   update public.help_requests set deleted_at = null where id = '<sol-suya>';                          -- 1 fila
--   update public.help_requests set deleted_at = now() where id = '<sol-suya>';                         -- ERROR: needs who
--   update public.help_requests set deleted_at = now(), deleted_by = '<uuid-admin>' where id = '<sol-suya>';  -- 1 fila
--   update public.help_requests set email_ok = true where id = '<sol-suya>';                            -- 1 fila
--
--   rollback;
--
-- Ensayado al escribirlo, entero y dos veces seguidas (es idempotente), en un Postgres en memoria (PGlite) con la
-- 120, la 126 y la 258 aplicadas antes y sustitutos de `profiles`, `is_admin()` y `auth.uid()`: los casos de arriba
-- salieron como dicen. NO se ha corrido contra la base real.
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('262_ayuda_eliminar_solicitud.sql', '527e0099cd31697c8bfd62f9af62d8814b0fad4f8f5ce2f48637cefa530de03e') on conflict (name) do nothing;
