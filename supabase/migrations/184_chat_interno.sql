-- 184: Chat interno entre empleados (D-NEXT, 2026-10-20).
--
-- El dueño: «un chat dentro del app en general … un botón que se puede ocultar … en el right upper corner … uno ahí puede
-- hacer un chat con los de su tienda y … buscar el nombre para mandar un chat a esa persona en específico, y esa persona en
-- su hub va a aparecer un botón y ahí va a ver todos los contactos … si es un admin siempre son como que push messages».
--
-- Qué hay: mensajes directos (una persona a otra) en `public.chat_messages`. Quién puede escribir a quién lo decide la
-- app (lista de perfiles, `profiles select = true` desde la A-2a); aquí solo se garantiza que cada quien lee lo SUYO
-- (lo que mandó o lo que le mandaron), que nadie escribe en nombre de otro, y que solo el destinatario marca leído.
-- Sin UPDATE del cuerpo ni DELETE desde el cliente: lo dicho, dicho está (como `help_messages`, 126).
-- Los avisos (campana + push al teléfono si escribe un admin) van por `public.notifications`, que ya existe.

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references public.profiles(id) on delete cascade,
  to_user     uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  constraint chat_messages_body_len check (char_length(btrim(body)) between 1 and 2000),
  constraint chat_messages_not_self check (from_user <> to_user)
);
create index if not exists chat_messages_to_idx   on public.chat_messages(to_user, read_at, created_at desc);
create index if not exists chat_messages_from_idx on public.chat_messages(from_user, created_at desc);

alter table public.chat_messages enable row level security;
-- Supabase concede TODO a anon y authenticated por defecto (default privileges del esquema): se quita y se da lo justo.
revoke all on public.chat_messages from public, anon, authenticated;
grant select, insert on public.chat_messages to authenticated;
-- UPDATE solo de `read_at` (la columna, no la fila entera): el cuerpo y las partes no se tocan.
grant update (read_at) on public.chat_messages to authenticated;

drop policy if exists "chat select own" on public.chat_messages;
create policy "chat select own" on public.chat_messages for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
drop policy if exists "chat insert as self" on public.chat_messages;
create policy "chat insert as self" on public.chat_messages for insert to authenticated
  with check (from_user = (select auth.uid()));
drop policy if exists "chat mark read" on public.chat_messages;
create policy "chat mark read" on public.chat_messages for update to authenticated
  using (to_user = (select auth.uid())) with check (to_user = (select auth.uid()));

-- Tiempo real: el destinatario ve llegar el mensaje sin recargar (como `help_messages`, 126). La RLS de arriba filtra
-- también lo que la suscripción entrega.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- Comprobaciones (fallan la migración si algo no quedó como se dice arriba).
do $$ declare n int; begin
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'chat_messages';
  if n <> 3 then raise exception '184: chat_messages tiene % politicas, se esperaban 3', n; end if;
  if has_table_privilege('authenticated', 'public.chat_messages', 'DELETE')
     or has_table_privilege('anon', 'public.chat_messages', 'SELECT') then
    raise exception '184: permisos de mas sobre chat_messages';
  end if;
  if has_column_privilege('authenticated', 'public.chat_messages', 'body', 'UPDATE') then
    raise exception '184: authenticated puede cambiar el cuerpo de un mensaje';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    raise exception '184: chat_messages no esta en la publicacion de tiempo real';
  end if;
end $$;

-- Para deshacer:
--   alter publication supabase_realtime drop table public.chat_messages;
--   drop table public.chat_messages;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('184_chat_interno.sql', '4164e2f7d0533216b6d3e978f36505412a0f32945adf6db427d00febc0218c30') on conflict (name) do nothing;
