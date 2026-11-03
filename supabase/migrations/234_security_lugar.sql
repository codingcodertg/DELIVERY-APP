-- 234: Security — desde dónde entra cada uno: IP y lugar (D-822, 2026-11-03).
--
-- El dueño: «en los devices donde se login consígueme el address para saber también, y avísame si ellos quieren
-- ingresar desde otro lado». Y el porqué: «para evitar robo de información sensible… office people solo pueden ver
-- info de los clientes y eso solo desde el rtg desktop app… evitar que se logeen desde otros dispositivos fuera de los
-- aprobados que están dentro de la tienda».
--
-- Qué hace: a cada «sigo aquí» (security_touch_device) llega también la IP y el lugar que Vercel deduce de ella
-- (ciudad, región, país). Se guardan en el dispositivo (la última), en la pareja dispositivo-persona (la última de esa
-- persona ahí) y en cada bloqueo de la web. Cambia lo que reciben dos funciones: se borran y se crean de nuevo.
--
-- Sin begin/commit propios. Para deshacer: volver a crear las dos funciones como en la 229 y la 232, y
-- alter table … drop column last_ip, last_place / ip, place; borrar la fila del registro.
alter table public.security_devices      add column if not exists last_ip text, add column if not exists last_place text;
alter table public.security_device_users add column if not exists last_ip text, add column if not exists last_place text;
alter table public.security_web_blocks   add column if not exists ip text,      add column if not exists place text;

drop function if exists public.security_touch_device(text, text, text, boolean);
create function public.security_touch_device(p_device text, p_user_agent text, p_kind text, p_bound boolean default false, p_ip text default null, p_place text default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind  text := case when p_kind in ('desktop', 'phone', 'browser') then p_kind else 'browser' end;
  v_ua    text := left(coalesce(p_user_agent, ''), 400);
  v_ip    text := nullif(left(coalesce(p_ip, ''), 64), '');
  v_place text := nullif(left(coalesce(p_place, ''), 120), '');
begin
  if auth.uid() is null then return; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then return; end if;
  insert into public.security_devices (id, kind, user_agent, first_user_id, last_user_id, bound, last_ip, last_place)
    values (p_device, v_kind, v_ua, auth.uid(), auth.uid(), coalesce(p_bound, false), v_ip, v_place)
  on conflict (id) do update
    set last_seen_at = now(), last_user_id = auth.uid(), user_agent = coalesce(nullif(v_ua, ''), public.security_devices.user_agent),
        bound = public.security_devices.bound or coalesce(p_bound, false),
        last_ip = coalesce(v_ip, public.security_devices.last_ip), last_place = coalesce(v_place, public.security_devices.last_place);
  insert into public.security_device_users (device_id, user_id, last_ip, last_place)
    values (p_device, auth.uid(), v_ip, v_place)
  on conflict (device_id, user_id) do update
    set last_seen_at = now(), seen_count = public.security_device_users.seen_count + 1,
        last_ip = coalesce(v_ip, public.security_device_users.last_ip), last_place = coalesce(v_place, public.security_device_users.last_place);
end $$;
revoke execute on function public.security_touch_device(text, text, text, boolean, text, text) from public, anon;
grant  execute on function public.security_touch_device(text, text, text, boolean, text, text) to authenticated;

drop function if exists public.security_note_web_block(text, text, text);
create function public.security_note_web_block(p_device text, p_path text, p_user_agent text, p_ip text default null, p_place text default null)
  returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.security_web_blocks b where b.user_id = auth.uid() and b.at > now() - interval '1 minute') then
    return true;
  end if;
  insert into public.security_web_blocks (user_id, device_id, user_agent, path, ip, place)
    values (auth.uid(), nullif(left(coalesce(p_device, ''), 64), ''), left(coalesce(p_user_agent, ''), 400), left(coalesce(p_path, ''), 200),
            nullif(left(coalesce(p_ip, ''), 64), ''), nullif(left(coalesce(p_place, ''), 120), ''));
  return true;
end $$;
revoke execute on function public.security_note_web_block(text, text, text, text, text) from public, anon;
grant  execute on function public.security_note_web_block(text, text, text, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_device_users' and column_name = 'last_place') then
    raise exception '234: security_device_users.last_place no existe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'security_touch_device' and p.pronargs = 6) then
    raise exception '234: security_touch_device no tiene seis parámetros';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'security_touch_device' and p.pronargs = 4) then
    raise exception '234: la security_touch_device vieja sigue ahí';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'security_note_web_block' and p.pronargs = 5) then
    raise exception '234: security_note_web_block no tiene cinco parámetros';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('234_security_lugar.sql', '9f83b37be7479f8e74a08eb5046178e29ee26b0f55dfd4e317f3fc9fdc2e351d') on conflict (name) do nothing;
