-- 278: «en vivo por módulo» — el latido guarda también la ruta/app donde está la persona.
--
-- Qué hace: a cada «sigo aquí» (security_touch_device, D-811) llega ahora, OPCIONAL, la ruta
-- actual (p. ej. "/", "/operaciones", "/timetracker"). Se guarda en la pareja dispositivo-persona
-- (security_device_users.last_route), para que Seguridad enseñe en qué app está metida cada
-- persona ahora mismo, no solo desde qué cliente.
--
-- `p_route` es opcional y por defecto NULL: la app vieja (que todavía no la manda) sigue llamando
-- con seis argumentos y funciona igual; la ruta se queda en NULL hasta que la app nueva empiece a
-- mandarla. Por eso esta migración se puede aplicar sola, sin romper nada, antes de publicar el
-- cambio de la app.
--
-- Sin begin/commit propios. Para deshacer: volver a crear security_touch_device como en la 234
-- (seis parámetros) y `alter table public.security_device_users drop column last_route;` y borrar
-- la fila del registro.

alter table public.security_device_users add column if not exists last_route text;

drop function if exists public.security_touch_device(text, text, text, boolean, text, text);
create function public.security_touch_device(
    p_device text, p_user_agent text, p_kind text, p_bound boolean default false,
    p_ip text default null, p_place text default null, p_route text default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind  text := case when p_kind in ('desktop', 'phone', 'browser') then p_kind else 'browser' end;
  v_ua    text := left(coalesce(p_user_agent, ''), 400);
  v_ip    text := nullif(left(coalesce(p_ip, ''), 64), '');
  v_place text := nullif(left(coalesce(p_place, ''), 120), '');
  v_route text := nullif(left(coalesce(p_route, ''), 200), '');
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
end $$;
revoke execute on function public.security_touch_device(text, text, text, boolean, text, text, text) from public, anon;
grant  execute on function public.security_touch_device(text, text, text, boolean, text, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'security_device_users' and column_name = 'last_route') then
    raise exception '278: security_device_users.last_route no existe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'security_touch_device' and p.pronargs = 7) then
    raise exception '278: security_touch_device no tiene siete parametros';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'security_touch_device' and p.pronargs = 6) then
    raise exception '278: la security_touch_device de seis parametros sigue ahi';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('278_presencia_por_ruta.sql', '406a35d85c36730024361571c8f2cab8d84aa331e420d61aaeb1e9cf69625d9f') on conflict (name) do nothing;
