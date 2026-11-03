-- 232: Security — el registro de a quién se le cerró la web (D-818, 2026-11-03).
--
-- El dueño: «enséñame también en security a los que se le bloqueó el app en la web». Hasta hoy el bloqueo (D-816) era
-- un rebote del middleware a /web-blocked y no dejaba rastro. Ahora la pantalla, al abrirse, anota quién, desde qué
-- dispositivo, con qué agente y adónde iba.
--
-- Sin begin/commit propios. Para deshacer: drop table public.security_web_blocks; drop function
-- public.security_note_web_block(text, text); borrar la fila del registro.
create table if not exists public.security_web_blocks (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  device_id   text,
  user_agent  text,
  path        text,
  at          timestamptz not null default now()
);
create index if not exists web_blocks_at_idx on public.security_web_blocks (at desc);
alter table public.security_web_blocks enable row level security;
drop policy if exists web_blocks_admin on public.security_web_blocks;
create policy web_blocks_admin on public.security_web_blocks for all to authenticated
  using (public.security_is_admin()) with check (public.security_is_admin());

-- Lo anota la propia sesión bloqueada (no es admin): security definer, solo de sí misma, y a lo sumo una fila por
-- minuto por persona para que recargar la pantalla no la llene.
create or replace function public.security_note_web_block(p_device text, p_path text, p_user_agent text)
  returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.security_web_blocks b where b.user_id = auth.uid() and b.at > now() - interval '1 minute') then
    return true;
  end if;
  insert into public.security_web_blocks (user_id, device_id, user_agent, path)
    values (auth.uid(), nullif(left(coalesce(p_device, ''), 64), ''), left(coalesce(p_user_agent, ''), 400), left(coalesce(p_path, ''), 200));
  return true;
end $$;
revoke execute on function public.security_note_web_block(text, text, text) from public, anon;
grant  execute on function public.security_note_web_block(text, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'security_web_blocks') then
    raise exception '232: security_web_blocks no existe';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'security_web_blocks' and policyname = 'web_blocks_admin') then
    raise exception '232: security_web_blocks sin la política de admin';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'security_note_web_block') then
    raise exception '232: security_note_web_block no existe';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('232_security_bloqueos_web.sql', '00a28b12850fce76d05d6890a39e03d84cf1e5bf8e7ea6b2118a0c19d05f8789') on conflict (name) do nothing;
