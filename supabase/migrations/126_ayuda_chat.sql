-- 126 · Una solicitud de ayuda es una conversacion (rama ayuda-chat)
--
-- El dueno: «work on a help chat feature so i can chat with the people and be back and forth».
-- Hasta aqui era de un solo sentido: la persona escribe (120), el admin la atiende y se le avisa
-- (D-301), fin. La decision que acompana a esto esta en DECISIONS.md, en la entrada de la rama.
--
-- QUE ANADE
--   · `help_messages`: lo que se escribe en el hilo DESPUES de la solicitud. La solicitud original se
--     queda donde esta, en `help_requests`, y la pantalla la pinta como primer mensaje: no se migra nada.
--   · `help_reads`: hasta cuando ha leido cada persona cada hilo. De ahi salen los «no leidos».
--     `notifications` no vale para eso: «marcar todas leidas» en la campana no es haber leido el hilo,
--     y no distingue un hilo de otro.
--   · Un disparador que, al entrar un mensaje, REABRE la solicitud si contesta quien la abrio, y AVISA
--     a la otra parte por la campana. Lo hace la base y no el cliente: asi el aviso no se puede omitir
--     ni falsear, y ningun cliente inserta en `notifications` una fila que no puede leer (la leccion del
--     aviso al chofer: un INSERT ... RETURNING aplica la politica de lectura a la fila devuelta).
--
-- QUIEN
--   Lee y escribe en un hilo quien lo abrio y cualquier admin; nadie mas. Una solicitud cuya cuenta se
--   borro (`user_id` nulo) queda solo para el admin. Nadie edita ni borra un mensaje, tampoco la llave
--   de servicio: es historial, como la 120.
--
-- A QUIEN SE AVISA (la misma regla que `aQuienSeAvisa` en src/lib/help-thread.ts; una prueba las compara)
--   · Escribe un admin       -> a quien abrio la solicitud, si su cuenta existe. El id del aviso ES el
--                               id del mensaje: el cliente lo conoce (lo genero el) y puede pedir el
--                               push sin que nadie le devuelva una fila ajena.
--   · Escribe quien la abrio -> al admin que ya esta en ese hilo: el ultimo admin que escribio en el, y
--                               si ninguno, quien la atendio. Solo si no hay ninguno, a todos los admins
--                               (son cuatro, medido 2026-09-18: avisarles siempre serian cuatro campanas
--                               por mensaje). Aqui el id lo genera la base: puede haber varias filas.
--   · Nunca a quien lo escribio. Sin SMS ni correo: solo la campana.
--
-- ADJUNTOS: solo quien abrio la solicitud. Lo que suba un admin queda en SU carpeta de `help-files`, y
--   la 119 no deja a la persona abrirlo. Que el admin adjunte pide una politica nueva en
--   storage.objects (leer un objeto citado en un mensaje de un hilo propio), y no es esta migracion.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero. Un `commit` de dentro cierra la
-- transaccion de fuera y convierte un ensayo con ROLLBACK en una aplicacion de verdad.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.help_messages (
  -- Lo genera el cliente (o el default): el mismo id sirve de id del aviso cuando escribe un admin.
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.help_requests(id) on delete cascade,
  -- `set null`, como la 120: borrar una cuenta no borra lo que dijo. Para eso esta el nombre en texto.
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  body        text not null,
  -- [{ "path": "<uuid-del-autor>/...", "nombre": "captura.png" }, ...] — la CLAVE del cubo, no un enlace.
  files       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  constraint help_messages_body_len check (char_length(btrim(body)) between 1 and 5000),
  constraint help_messages_files_is_array check (jsonb_typeof(files) = 'array')
);

create index if not exists help_messages_request_idx on public.help_messages (request_id, created_at);

comment on table public.help_messages is
  'Los mensajes del hilo de una solicitud de ayuda (126). Lee y escribe quien la abrio y el admin; nadie edita ni borra.';

create table if not exists public.help_reads (
  request_id uuid not null references public.help_requests(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (request_id, user_id)
);

comment on table public.help_reads is
  'Hasta cuando ha leido cada persona cada hilo de ayuda (126). Cada uno ve y escribe solo su fila.';

-- ---------------------------------------------------------------------------
-- Quien participa en un hilo
-- ---------------------------------------------------------------------------
-- `security definer` para que las politicas de abajo no dependan de la politica de lectura de
-- `help_requests`: la pregunta es una sola y se contesta aqui.
create or replace function public.can_see_help_request(rid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false)
      or exists (select 1 from public.help_requests r where r.id = rid and r.user_id = auth.uid());
$$;

revoke execute on function public.can_see_help_request(uuid) from public, anon;
grant execute on function public.can_see_help_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Politicas: una por comando, ninguna FOR ALL
-- ---------------------------------------------------------------------------
-- Una politica ALL tambien lee, y las permisivas se suman con OR: una de mas abre lo que las otras
-- cierran. Por eso aqui no hay ninguna, y la autocomprobacion de abajo lo mira.
alter table public.help_messages enable row level security;
alter table public.help_reads    enable row level security;

-- Sin `update` ni `delete` en los mensajes: ni politica ni permiso. El `revoke` va primero y no es
-- adorno: en Supabase los privilegios por defecto del esquema `public` dan TODO a `anon` y
-- `authenticated` sobre cada tabla nueva, asi que un `grant` a secas no quita nada. (No medido desde
-- la rama; si los defaults no estuvieran, el `revoke` no hace nada y la autocomprobacion pasa igual.)
revoke all on public.help_messages from anon, authenticated;
revoke all on public.help_reads    from anon, authenticated;
grant select, insert on public.help_messages to authenticated;
grant select, insert, update on public.help_reads to authenticated;

drop policy if exists "help_messages select" on public.help_messages;
drop policy if exists "help_messages insert" on public.help_messages;

create policy "help_messages select" on public.help_messages for select to authenticated
  using ((select public.can_see_help_request(request_id)));

-- Escribe en su propio nombre, y solo en un hilo en el que participa.
create policy "help_messages insert" on public.help_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and (select public.can_see_help_request(request_id)));

drop policy if exists "help_reads select own" on public.help_reads;
drop policy if exists "help_reads insert own" on public.help_reads;
drop policy if exists "help_reads update own" on public.help_reads;

create policy "help_reads select own" on public.help_reads for select to authenticated
  using (user_id = (select auth.uid()));

create policy "help_reads insert own" on public.help_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.can_see_help_request(request_id)));

create policy "help_reads update own" on public.help_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.can_see_help_request(request_id)));

-- ---------------------------------------------------------------------------
-- Lo que pone la base, no el cliente
-- ---------------------------------------------------------------------------
-- El nombre y la hora de un mensaje los pone la base: el nombre sale del perfil de quien escribe, no
-- de lo que mande el navegador. Y los adjuntos: solo quien abrio la solicitud, y solo de SU carpeta.
-- Sin sesion (llave de servicio) no hay a quien preguntar y se deja como venga.
create or replace function public.help_message_before_insert()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  duenio uuid;
  ajeno  int;
begin
  if auth.uid() is null then return NEW; end if;
  NEW.created_at  := now();
  NEW.author_name := (select p.full_name from public.profiles p where p.id = NEW.author_id);
  if jsonb_array_length(NEW.files) > 0 then
    select r.user_id into duenio from public.help_requests r where r.id = NEW.request_id;
    if NEW.author_id is distinct from duenio then
      raise exception 'Only the person who opened the request can attach files';
    end if;
    select count(*) into ajeno from jsonb_array_elements(NEW.files) f
     where coalesce(f->>'path', '') not like (NEW.author_id::text || '/%');
    if ajeno > 0 then
      raise exception 'An attachment must live in its author''s own folder';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists help_messages_before_insert on public.help_messages;
create trigger help_messages_before_insert
  before insert on public.help_messages
  for each row execute function public.help_message_before_insert();

-- La hora de lectura tambien: nadie marca como leido lo que todavia no se ha escrito.
create or replace function public.help_read_stamp()
  returns trigger language plpgsql set search_path = public as $$
begin
  NEW.read_at := now();
  return NEW;
end $$;

drop trigger if exists help_reads_stamp on public.help_reads;
create trigger help_reads_stamp
  before insert or update on public.help_reads
  for each row execute function public.help_read_stamp();

-- ---------------------------------------------------------------------------
-- El historial no se reescribe
-- ---------------------------------------------------------------------------
-- Ni desde la pantalla ni con la llave de servicio, que se salta RLS pero no los disparadores. Dos
-- excepciones, y las dos son la base limpiando detras de un borrado, no alguien editando:
--   · `author_id` pasa a null cuando se borra la cuenta del autor (`on delete set null`). Sin esto,
--     borrar un usuario que escribio alguna vez en un hilo fallaria.
--   · el mensaje se va con su solicitud (`on delete cascade`): para cuando este disparador corre, la
--     solicitud ya no existe. Borrar un mensaje de una solicitud que SIGUE ahi no se puede.
create or replace function public.guard_help_message_immutable()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  probe public.help_messages%rowtype;
begin
  if TG_OP = 'DELETE' then
    if exists (select 1 from public.help_requests r where r.id = OLD.request_id) then
      raise exception 'A help message is history: it cannot be deleted';
    end if;
    return OLD;
  end if;
  probe := NEW;
  probe.author_id := OLD.author_id;
  if NEW.author_id is null and probe is not distinct from OLD then return NEW; end if;
  raise exception 'A help message is history: it cannot be edited';
end $$;

drop trigger if exists help_messages_guard_immutable on public.help_messages;
create trigger help_messages_guard_immutable
  before update or delete on public.help_messages
  for each row execute function public.guard_help_message_immutable();

-- ---------------------------------------------------------------------------
-- Al entrar un mensaje: reabrir y avisar
-- ---------------------------------------------------------------------------
create or replace function public.help_message_after_insert()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  s       public.help_requests%rowtype;
  destino uuid;
  asomo   text;
begin
  if NEW.author_id is null then return NEW; end if;
  select * into s from public.help_requests r where r.id = NEW.request_id;
  if not found then return NEW; end if;

  -- Lo justo del mensaje para reconocerlo en la campana, en una linea.
  asomo := btrim(regexp_replace(NEW.body, '\s+', ' ', 'g'));
  if char_length(asomo) > 60 then asomo := rtrim(left(asomo, 59)) || '…'; end if;

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
      values (destino, 'ayuda_mensaje', 'Help: ' || coalesce(NEW.author_name, 'someone') || ' wrote — “' || asomo || '”');
    else
      insert into public.notifications (user_id, kind, message)
      select p.id, 'ayuda_mensaje', 'Help: ' || coalesce(NEW.author_name, 'someone') || ' wrote — “' || asomo || '”'
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

drop trigger if exists help_messages_after_insert on public.help_messages;
create trigger help_messages_after_insert
  after insert on public.help_messages
  for each row execute function public.help_message_after_insert();

-- Las funciones de disparador no se llaman a mano.
revoke execute on function public.help_message_before_insert()   from public, anon, authenticated;
revoke execute on function public.help_message_after_insert()    from public, anon, authenticated;
revoke execute on function public.guard_help_message_immutable() from public, anon, authenticated;
revoke execute on function public.help_read_stamp()              from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tiempo real: un canal por hilo abierto, filtrado por `request_id`
-- ---------------------------------------------------------------------------
do $pub$
begin
  alter publication supabase_realtime add table public.help_messages;
exception when duplicate_object then null;
end $pub$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.help_messages'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.help_reads'::regclass) then
    raise exception '126: alguna de las dos tablas quedo sin RLS';
  end if;

  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'help_messages';
  if n <> 2 then raise exception '126: help_messages tiene % politicas, se esperaban 2', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'help_reads';
  if n <> 3 then raise exception '126: help_reads tiene % politicas, se esperaban 3', n; end if;

  -- Ninguna FOR ALL, y ninguna para UPDATE o DELETE sobre los mensajes.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('help_messages', 'help_reads') and cmd = 'ALL';
  if n <> 0 then raise exception '126: hay % politicas FOR ALL', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'help_messages' and cmd in ('UPDATE', 'DELETE');
  if n <> 0 then raise exception '126: help_messages tiene politica de UPDATE o DELETE'; end if;

  if has_table_privilege('authenticated', 'public.help_messages', 'UPDATE')
     or has_table_privilege('authenticated', 'public.help_messages', 'DELETE')
     or has_table_privilege('anon', 'public.help_messages', 'SELECT')
     or has_table_privilege('anon', 'public.help_reads', 'SELECT') then
    raise exception '126: permisos de mas sobre las tablas del hilo';
  end if;

  select count(*) into n from pg_trigger
   where tgrelid = 'public.help_messages'::regclass and not tgisinternal
     and tgname in ('help_messages_before_insert', 'help_messages_after_insert', 'help_messages_guard_immutable');
  if n <> 3 then raise exception '126: faltan disparadores en help_messages (hay % de 3)', n; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.help_reads'::regclass and tgname = 'help_reads_stamp') then
    raise exception '126: falta el disparador de help_reads';
  end if;

  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'help_messages') then
    raise exception '126: help_messages no esta en la publicacion de tiempo real';
  end if;

  -- La 120 sigue como estaba: sus tres politicas y su guardia.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'help_requests';
  if n <> 3 then raise exception '126: help_requests tiene % politicas, se esperaban 3', n; end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   alter publication supabase_realtime drop table public.help_messages;
--   drop table if exists public.help_reads;
--   drop table if exists public.help_messages;       -- se lleva politicas, indice y disparadores
--   drop function if exists public.help_message_after_insert();
--   drop function if exists public.help_message_before_insert();
--   drop function if exists public.guard_help_message_immutable();
--   drop function if exists public.help_read_stamp();
--   drop function if exists public.can_see_help_request(uuid);
--   delete from public.schema_migrations where name = '126_ayuda_chat.sql';
--
-- Ojo: el `drop table` borra las conversaciones. Si ya hay alguna que interese, primero
--   create table help_messages_backup as select * from public.help_messages;
-- `help_requests` no se toca: las solicitudes originales sobreviven a la reversion. Los avisos ya
-- escritos en `notifications` se quedan; con el codigo viejo, pulsarlos no lleva a ningun sitio.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Con la 126 aplicada DENTRO de la misma transaccion. Hacen falta: <uuid-persona> (no admin) con una
-- solicitud suya ATENDIDA <sol-suya>; <uuid-otro> (no admin, sin relacion con ella); <uuid-admin> y
-- <uuid-admin-2>. `pg_temp.intenta` es el ayudante de la 123: PERMITIDO / SIN FILAS / BLOQUEADO.
--
--   -- A. La persona, en su hilo.
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-persona>","role":"authenticated"}';
--   A1 insert (request_id, author_id, body) = (<sol-suya>, <uuid-persona>, 'sigue pasando')      -> PERMITIDO
--   A2 lo mismo con author_id = <uuid-admin>                                                     -> BLOQUEADO (RLS)
--   A3 insert en una solicitud de OTRA persona                                                   -> BLOQUEADO (RLS)
--   A4 update public.help_messages set body = 'x' where request_id = <sol-suya>                  -> BLOQUEADO (permiso)
--   A5 delete from public.help_messages where request_id = <sol-suya>                            -> BLOQUEADO (permiso)
--   A6 insert con files = [{"path":"<uuid-admin>/x.png"}]                                        -> BLOQUEADO (carpeta ajena)
--   A7 upsert en help_reads de SU fila                                                           -> PERMITIDO
--   A8 insert en help_reads con user_id = <uuid-admin>                                           -> BLOQUEADO (RLS)
--   Tras A1, como postgres:
--     select status, attended_by from public.help_requests where id = <sol-suya>;                -> pendiente, null
--     select user_id, kind from public.notifications where kind = 'ayuda_mensaje' ...;           -> UNA fila, para quien la atendio
--     select author_name from public.help_messages ...;                                          -> el nombre del perfil, no lo enviado
--
--   -- B. Otra persona.
--   set local request.jwt.claims = '{"sub":"<uuid-otro>","role":"authenticated"}';
--   B1 select count(*) from public.help_messages where request_id = <sol-suya>                   -> 0
--   B2 insert en <sol-suya> como <uuid-otro>                                                     -> BLOQUEADO (RLS)
--   B3 insert en help_reads de <sol-suya>                                                        -> BLOQUEADO (RLS)
--
--   -- C. Un admin.
--   set local request.jwt.claims = '{"sub":"<uuid-admin-2>","role":"authenticated"}';
--   C1 select count(*) de los mensajes de <sol-suya>                                             -> los de A1
--   C2 insert con id = <uuid-fijo>, en <sol-suya>, como <uuid-admin-2>                           -> PERMITIDO
--   C3 insert con files no vacio                                                                 -> BLOQUEADO (solo adjunta quien la abrio)
--   C4 update / delete de un mensaje                                                             -> BLOQUEADO (permiso)
--   Tras C2, como postgres:
--     select id, user_id, kind from public.notifications where id = <uuid-fijo>;                 -> <uuid-persona>, ayuda_respuesta
--     select status from public.help_requests where id = <sol-suya>;                             -> el que tenia: el admin NO reabre
--   Y la persona vuelve a escribir (A1 otra vez): el aviso va SOLO a <uuid-admin-2>, el ultimo que escribio.
--
--   -- D. Ni la llave de servicio (reset role; sin claims).
--   D1 update public.help_messages set body = 'x' where id = <uuid-fijo>                         -> BLOQUEADO (guardia)
--   D2 delete from public.help_messages where id = <uuid-fijo>                                   -> BLOQUEADO (guardia)
--   D3 delete from public.help_requests where id = <sol-suya>                                    -> PERMITIDO, y se lleva sus mensajes (cascade)
--   D4 delete from public.profiles where id = <un autor de prueba>  (solo si hay uno desechable) -> su author_id queda null; NO ensayar con una cuenta real
--
--   rollback;
--
-- No verificado al escribirlo: nada de esto se ha corrido. En particular D3 descansa en que, durante un
-- borrado en cascada, el disparador del hijo ya no ve la fila del padre; si no fuera asi, D3 saldria
-- BLOQUEADO y habria que decidir si eso molesta (hoy nadie borra solicitudes).

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('126_ayuda_chat.sql', 'cf94b710d51717e9f77df4e9c00d7cf64d93d5ceff964f93063873d082a9c3bc') on conflict (name) do nothing;
