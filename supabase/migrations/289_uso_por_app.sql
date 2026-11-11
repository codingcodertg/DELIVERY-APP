-- 289: Permisos — "último uso por app" para el punto verde/gris de cada app en el panel de permisos (2026-11-10).
--
-- El dueño: en Permisos, por cada app habilitada de una persona, un punto verde si la usa (o está live) y gris si
-- lleva +2 días sin usarla, con la última vez que entró. Para eso hay que guardar el ÚLTIMO USO por (persona, app),
-- que hoy no se guarda (solo la última actividad global, en security_device_users).
--
-- Qué hace:
--   1. Tabla public.app_last_seen (user_id, app, last_seen_at) — una fila por persona+app, el sello del último uso.
--      RLS: la lee admin, RR. HH. y la propia persona; NO hay política de escritura (la escribe solo la RPC del latido,
--      security-definer). anon revocado.
--   2. Extiende el latido security_touch_device con un 8º parámetro OPCIONAL p_app: cuando llega un módulo real, hace
--      upsert en app_last_seen. El resto del latido queda igual; p_app por defecto NULL, así que una llamada vieja de
--      siete argumentos sigue funcionando (se aplica sola, sin romper, antes de publicar el cambio del server).
--
-- Additive. 237/280-288 intactas (287 vive en otra rama sin fusionar; aquí se salta a 289 a propósito). Para deshacer:
--   volver a crear security_touch_device como en la 278 (siete parámetros) y `drop table public.app_last_seen;`.

-- 1. La tabla del último uso por app.
create table if not exists public.app_last_seen (
  user_id uuid not null references public.profiles(id) on delete cascade,
  app text not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, app)
);
alter table public.app_last_seen enable row level security;
drop policy if exists "app_last_seen read" on public.app_last_seen;
create policy "app_last_seen read" on public.app_last_seen for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (select public.is_admin())
    or (select public.has_recruiting_access())
  );
revoke all on public.app_last_seen from anon;

-- 2. El latido, ahora con p_app (8º, opcional): sella el último uso de esa app.
drop function if exists public.security_touch_device(text, text, text, boolean, text, text, text);
create function public.security_touch_device(
    p_device text, p_user_agent text, p_kind text, p_bound boolean default false,
    p_ip text default null, p_place text default null, p_route text default null, p_app text default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind  text := case when p_kind in ('desktop', 'phone', 'browser') then p_kind else 'browser' end;
  v_ua    text := left(coalesce(p_user_agent, ''), 400);
  v_ip    text := nullif(left(coalesce(p_ip, ''), 64), '');
  v_place text := nullif(left(coalesce(p_place, ''), 120), '');
  v_route text := nullif(left(coalesce(p_route, ''), 200), '');
  v_app   text := nullif(left(coalesce(p_app, ''), 40), '');
begin
  if auth.uid() is null then return; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then return; end if;
  insert into public.security_devices (id, kind, user_agent, first_user_id, last_user_id, bound, last_ip, last_place)
    values (p_device, v_kind, v_ua, auth.uid(), auth.uid(), coalesce(p_bound, false), v_ip, v_place)
  on conflict (id) do update
    set last_seen_at = now(), last_user_id = auth.uid(), user_agent = coalesce(nullif(v_ua, ''), public.security_devices.user_agent),
        bound = public.security_devices.bound or coalesce(p_bound, false),
        last_ip = coalesce(v_ip, public.security_devices.last_ip), last_place = coalesce(v_place, public.security_devices.last_place);
  insert into public.security_device_users (device_id, user_id, last_ip, last_place, last_route)
    values (p_device, auth.uid(), v_ip, v_place, v_route)
  on conflict (device_id, user_id) do update
    set last_seen_at = now(), seen_count = public.security_device_users.seen_count + 1,
        last_ip = coalesce(v_ip, public.security_device_users.last_ip),
        last_place = coalesce(v_place, public.security_device_users.last_place),
        last_route = coalesce(v_route, public.security_device_users.last_route);
  -- 289: el último uso de la app donde está (si el server mandó un módulo real).
  if v_app is not null then
    insert into public.app_last_seen (user_id, app, last_seen_at) values (auth.uid(), v_app, now())
    on conflict (user_id, app) do update set last_seen_at = now();
  end if;
end $$;
revoke execute on function public.security_touch_device(text, text, text, boolean, text, text, text, text) from public, anon;
grant  execute on function public.security_touch_device(text, text, text, boolean, text, text, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobación
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'app_last_seen') then
    raise exception '289: falta la tabla app_last_seen';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'app_last_seen' and rowsecurity) then
    raise exception '289: app_last_seen sin RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_last_seen' and cmd <> 'SELECT') then
    raise exception '289: app_last_seen no debe tener politicas de escritura (solo la RPC)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'security_touch_device' and p.pronargs = 8) then
    raise exception '289: security_touch_device no tiene ocho parametros';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'security_touch_device' and p.pronargs = 7) then
    raise exception '289: la security_touch_device de siete parametros sigue ahi';
  end if;
  if has_function_privilege('anon', 'public.security_touch_device(text, text, text, boolean, text, text, text, text)', 'execute') then
    raise exception '289: anon no debe ejecutar security_touch_device';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('289_uso_por_app.sql', 'e2e77008cf54be195e3fee9dd77674332ab5422540202f47ecb7fb0c5cf7b213') on conflict (name) do nothing;
