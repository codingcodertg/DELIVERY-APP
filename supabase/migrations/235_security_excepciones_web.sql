-- 235: Security — excepciones a la web bloqueada (D-826, 2026-11-03).
--
-- El dueño: «Nick y Francis tampoco los bloquees, agrégalo a exception». Personas concretas que entran por la web
-- aunque su rol esté en la lista de D-816. Es una lista en la base, no en el código: el admin la cambia en Security.
--
-- Qué hace: `security_policy.web_exempt uuid[]` (nace vacía) y `security_gate` devuelve también si QUIEN LLAMA está en
-- ella (`web_exempt`). Cambiar lo que devuelve una función SQL obliga a borrarla y crearla de nuevo.
--
-- Sin begin/commit propios. Para deshacer: volver a crear security_gate como en la 231 y
-- `alter table public.security_policy drop column web_exempt`; borrar la fila del registro.
alter table public.security_policy add column if not exists web_exempt uuid[] not null default '{}';
comment on column public.security_policy.web_exempt is
  'D-826: personas que entran por la web aunque su rol esté bloqueado (D-816). Lo cambia el admin en Security.';

drop function if exists public.security_gate(text);
create function public.security_gate(p_device text)
  returns table (enforced boolean, role text, device_status text, device_kind text, visit_open boolean, web_blocked boolean, web_exempt boolean)
  language sql stable security definer set search_path = public, clockin, pg_temp as $$
  select
    coalesce((select p.enforced from public.security_policy p where p.id = 1), false),
    (select pr.role::text from public.profiles pr where pr.id = auth.uid()),
    coalesce((select d.status from public.security_devices d where d.id = p_device), 'none'),
    (select d.kind from public.security_devices d where d.id = p_device),
    exists (select 1 from clockin.vehicle_trips t where t.employee_id = auth.uid() and t.ended_at is null),
    coalesce((select p.web_blocked from public.security_policy p where p.id = 1), false),
    coalesce((select auth.uid() = any (p.web_exempt) from public.security_policy p where p.id = 1), false);
$$;
revoke execute on function public.security_gate(text) from public, anon;
grant  execute on function public.security_gate(text) to authenticated;

comment on function public.security_gate(text) is
  'Lo que el middleware necesita para las reglas de acceso (D-811, D-816, D-826): los interruptores, el rol de quien '
  'llama, si está exento de la web bloqueada, el estado del dispositivo de su cookie y si tiene un viaje abierto.';

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_policy' and column_name = 'web_exempt') then
    raise exception '235: security_policy.web_exempt no existe';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'security_gate' and pg_get_function_result(p.oid) like '%web_exempt boolean%') then
    raise exception '235: security_gate no devuelve web_exempt';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('235_security_excepciones_web.sql', '3a923859b35c5c1f9236cc884f71762a00f685033bc3b21120bd48805111b056') on conflict (name) do nothing;
