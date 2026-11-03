-- 231: Security — la web bloqueada para manager, sales y logistics: solo la app de escritorio (D-816, 2026-11-03).
--
-- El dueño: «bloquees el web app para office manager y sales people, ellos solo podrán usar el app desde el rtg hub
-- desktop app… es obligatorio ahora». Es una regla APARTE de la de dispositivos (229, `enforced`): esa mira si la
-- computadora está aprobada y nace apagada; esta mira solo CON QUÉ entra (la app de escritorio, un teléfono o un
-- navegador) y se enciende hoy.
--
-- Qué hace: `security_policy.web_blocked` (nace en false; se enciende con el botón de Security o con
-- scripts/db/security-policy.mjs --web-on, justo después de publicar) y `security_gate` devuelve también ese valor.
-- Cambiar lo que devuelve una función SQL obliga a borrarla y crearla de nuevo (no vale `create or replace`).
--
-- Sin begin/commit propios. Para deshacer: volver a crear security_gate como en la 229 y
-- `alter table public.security_policy drop column web_blocked`; borrar la fila del registro.
alter table public.security_policy add column if not exists web_blocked boolean not null default false;
comment on column public.security_policy.web_blocked is
  'D-816: true = manager, sales y logistics no entran desde un navegador de computadora; solo desde la app RTG Hub (y el teléfono, al Time Tracker).';

drop function if exists public.security_gate(text);
create function public.security_gate(p_device text)
  returns table (enforced boolean, role text, device_status text, device_kind text, visit_open boolean, web_blocked boolean)
  language sql stable security definer set search_path = public, clockin, pg_temp as $$
  select
    coalesce((select p.enforced from public.security_policy p where p.id = 1), false),
    (select pr.role::text from public.profiles pr where pr.id = auth.uid()),
    coalesce((select d.status from public.security_devices d where d.id = p_device), 'none'),
    (select d.kind from public.security_devices d where d.id = p_device),
    exists (select 1 from clockin.vehicle_trips t where t.employee_id = auth.uid() and t.ended_at is null),
    coalesce((select p.web_blocked from public.security_policy p where p.id = 1), false);
$$;
revoke execute on function public.security_gate(text) from public, anon;
grant  execute on function public.security_gate(text) to authenticated;

comment on function public.security_gate(text) is
  'Lo que el middleware necesita para las reglas de acceso (D-811, D-816): los dos interruptores, el rol de quien '
  'llama, el estado del dispositivo de su cookie y si tiene un viaje abierto. Solo de la propia sesión.';

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_policy' and column_name = 'web_blocked') then
    raise exception '231: security_policy.web_blocked no existe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'security_gate' and pg_get_function_result(p.oid) like '%web_blocked boolean%') then
    raise exception '231: security_gate no devuelve web_blocked';
  end if;
  if exists (select 1 from public.security_policy where id = 1 and web_blocked = true) then
    raise exception '231: la web no nació sin bloquear (se enciende después, a propósito)';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('231_security_web_bloqueada.sql', '3bd73dc6bf8677f573f68bc52ef123498b2f537d71f8ebcad6148d0e29e54393') on conflict (name) do nothing;
