-- 120 · Las solicitudes de ayuda se guardan (rama hub-solicitudes-de-ayuda)
--
-- El dueño: «en mi usuario de Andrés, créame una vista para ver todas las solicitudes de ayuda en el
-- hub». Hoy no hay historial que enseñar: `/api/help` manda un correo y no guarda nada (D-284 le anadio
-- los adjuntos, tambien sin guardar). Si el correo no llega —o llega a una bandeja que nadie mira—, la
-- solicitud se perdio y nadie se entera.
--
-- ---------------------------------------------------------------------------
-- Que se guarda, y por que asi
-- ---------------------------------------------------------------------------
-- Lo que el correo ya llevaba, mas el resultado del envio. Dos decisiones que no son obvias:
--
--   · **Los adjuntos se guardan por su CLAVE del cubo, no por su enlace.** El enlace del correo es
--     firmado y caduca a los 30 dias (D-284); guardarlo seria guardar algo que manana no abre nada.
--     Con la clave, la pantalla firma uno nuevo cada vez que se abre.
--   · **El nombre de quien escribe se guarda tambien como texto**, no solo el `user_id`. Una cuenta
--     borrada dejaria la fila sin nombre, y el historial es justo lo que no puede quedarse mudo.
--
-- El resultado del envio se escribe DESPUES, cuando la ruta sabe si Resend acepto. La fila se crea
-- antes de intentarlo: si la llamada al correo revienta, la solicitud ya esta guardada, que es
-- exactamente lo que el dueño quiere ver.

create table if not exists public.help_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  -- Quien escribe. `set null` y no `cascade`: borrar una cuenta no puede borrar el historial de
  -- soporte; para eso esta el nombre en texto.
  user_id      uuid references public.profiles(id) on delete set null,
  sender_name  text,
  sender_email text,
  role_label   text,
  -- Desde donde escribio y con que version, que es la mitad de poder reproducir el problema.
  page         text,
  app_version  text,
  lang         text,
  message      text not null,
  -- [{ "path": "<uuid>/2026-...-captura.png", "nombre": "captura.png" }, ...]
  files        jsonb not null default '[]'::jsonb,
  -- El envio del correo: a donde, si salio y, si no, por que.
  email_to     text,
  email_ok     boolean,
  email_error  text,
  -- Lo unico que se cambia despues: atenderla.
  status       text not null default 'pendiente',
  attended_by  uuid references public.profiles(id) on delete set null,
  attended_at  timestamptz,

  constraint help_requests_message_len check (char_length(btrim(message)) between 1 and 5000),
  constraint help_requests_status_allowed check (status in ('pendiente', 'atendida')),
  -- Atendida sin quien ni cuando seria un estado que no se puede auditar.
  constraint help_requests_attended_needs_who
    check (status <> 'atendida' or (attended_by is not null and attended_at is not null)),
  constraint help_requests_files_is_array check (jsonb_typeof(files) = 'array')
);

-- La pantalla lista por fecha descendente y filtra por persona: ese es el indice.
create index if not exists help_requests_created_idx on public.help_requests (created_at desc);
create index if not exists help_requests_user_idx    on public.help_requests (user_id, created_at desc);

comment on table public.help_requests is
  'Solicitudes de ayuda del boton de ayuda (120). Las lee el admin en el hub; quien la manda ve las suyas.';

-- ---------------------------------------------------------------------------
-- Quien ve y quien escribe
-- ---------------------------------------------------------------------------
-- Escribe cualquiera con sesion, **para si mismo**: `user_id` tiene que ser el suyo, y por eso no se
-- puede sembrar el historial en nombre de otra persona. Lee el admin todo; quien la mando, las suyas.
-- Cambiarla es solo del admin, y ademas el guardia de abajo acota QUE columnas.

alter table public.help_requests enable row level security;

grant select, insert, update on public.help_requests to authenticated;

drop policy if exists "help_requests select" on public.help_requests;
drop policy if exists "help_requests insert own" on public.help_requests;
drop policy if exists "help_requests update admin" on public.help_requests;

create policy "help_requests select" on public.help_requests for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

create policy "help_requests insert own" on public.help_requests for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "help_requests update admin" on public.help_requests for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- El historial no se reescribe
-- ---------------------------------------------------------------------------
-- La politica dice QUIEN cambia; esto dice QUE. Lo que conto la persona —mensaje, pagina, adjuntos,
-- quien y cuando— es historial: no se edita, ni desde la pantalla, ni con la llave de servicio, que se
-- salta RLS pero no los disparadores. Lo que si cambia: el estado al atenderla y el resultado del
-- correo, que lo escribe la propia ruta justo despues de intentarlo.

create or replace function public.guard_help_request_immutable()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.user_id is distinct from OLD.user_id
     or NEW.created_at  is distinct from OLD.created_at
     or NEW.message     is distinct from OLD.message
     or NEW.files       is distinct from OLD.files
     or NEW.page        is distinct from OLD.page
     or NEW.sender_name is distinct from OLD.sender_name
     or NEW.sender_email is distinct from OLD.sender_email
     or NEW.role_label  is distinct from OLD.role_label
     or NEW.app_version is distinct from OLD.app_version
     or NEW.lang        is distinct from OLD.lang then
    raise exception 'A help request is history: only its status and the email result can change';
  end if;
  return NEW;
end $$;

drop trigger if exists help_requests_guard_immutable on public.help_requests;
create trigger help_requests_guard_immutable
  before update on public.help_requests
  for each row execute function public.guard_help_request_immutable();

-- ---------------------------------------------------------------------------
-- Comprobar antes de darla por buena
-- ---------------------------------------------------------------------------
do $$
declare
  n_politicas int;
  n_rls boolean;
begin
  select relrowsecurity into n_rls from pg_class where oid = 'public.help_requests'::regclass;
  if not n_rls then
    raise exception 'help_requests quedo sin RLS';
  end if;

  select count(*) into n_politicas from pg_policies
   where schemaname = 'public' and tablename = 'help_requests';
  if n_politicas <> 3 then
    raise exception 'help_requests tiene % politicas, se esperaban 3', n_politicas;
  end if;
end $$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   drop trigger if exists help_requests_guard_immutable on public.help_requests;
--   drop function if exists public.guard_help_request_immutable();
--   drop table if exists public.help_requests;      -- se lleva sus politicas e indices
--   delete from public.schema_migrations where name = '120_help_requests.sql';
--
-- Ojo: el `drop table` borra el historial guardado. Si ya hay solicitudes que interesen, primero
--   create table help_requests_backup as select * from public.help_requests;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- Todo dentro de una transaccion que se deshace: no deja filas ni cambia nada. <uuid-...> son cuentas
-- reales de `public.profiles`.
--
--   -- 1. Un vendedor escribe la suya, y no puede escribir en nombre de otro.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   insert into public.help_requests (user_id, message) values ('<uuid-vendedor>', 'no carga');   -- 1 fila
--   insert into public.help_requests (user_id, message) values ('<uuid-admin>', 'suplantada');    -- ERROR de RLS
--   select count(*) from public.help_requests;                                                    -- solo las suyas
--   rollback;
--
--   -- 2. El admin las ve todas y puede atenderlas.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-admin>","role":"authenticated"}';
--   select count(*) from public.help_requests;                                                    -- todas
--   update public.help_requests
--      set status = 'atendida', attended_by = '<uuid-admin>', attended_at = now()
--    where id = '<uuid-solicitud>';                                                               -- 1 fila
--   update public.help_requests set message = 'reescrita' where id = '<uuid-solicitud>';          -- ERROR del guardia
--   rollback;
--
--   -- 3. Un vendedor no atiende ni la suya.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.help_requests set status = 'atendida' where user_id = '<uuid-vendedor>';        -- 0 filas
--   rollback;
--
--   -- 4. El guardia vale tambien para la llave de servicio (salta RLS, no disparadores).
--   begin;
--   update public.help_requests set message = 'reescrita' where id = '<uuid-solicitud>';          -- ERROR del guardia
--   update public.help_requests set email_ok = true where id = '<uuid-solicitud>';                -- 1 fila
--   rollback;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('120_help_requests.sql', 'd6cb53a09cfba2954286aa35193aba1a6a572561e64519c5f9472df92b27169a') on conflict (name) do nothing;
