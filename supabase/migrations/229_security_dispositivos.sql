-- 229: Security — dispositivos registrados y la regla de acceso por dispositivo (D-811, 2026-11-03).
--
-- El dueño: la empresa no quiere que managers, sales y office entren al hub «por la web» desde su casa. Cada
-- computadora de tienda con el RTG Hub instalado se REGISTRA; esas son las únicas desde las que esos roles entran a
-- todo. Un vendedor puede entrar desde su teléfono (registrado también) y ahí solo ve Time Tracker —y Quote Builder
-- mientras tiene una visita a cliente abierta—. Admin, warehouse y driver no tienen límite. Y una app aparte,
-- «Security», con la lista de dispositivos, quién entra desde cuál y cuándo fue la última vez.
--
-- NACE APAGADA. `public.security_policy.enforced` es false hasta que el dueño la encienda (desde la app o con
-- `scripts/db/security-policy.mjs --on`). Con la regla apagada, lo único que hace esta migración es REGISTRAR: cada
-- sesión deja su dispositivo y su última hora, para que la lista esté llena el día que se encienda.
--
-- Qué hace: tres tablas en `public` con prefijo `security_` (un esquema propio obligaría a tocar «Exposed schemas» en el panel a mano), dos funciones security definer
-- (`security_touch_device`, que registra sin dar permisos de escritura a nadie; `security_gate`, lo que el middleware
-- pregunta en cada navegación, solo de la propia sesión) y RLS: solo el admin lee y edita las tablas.
--
-- Sin begin/commit propios. Para deshacer: drop table public.security_device_users, public.security_devices, public.security_policy; drop function public.security_is_admin(); drop function public.security_gate(text);
-- drop function public.security_touch_device(text, text, text, boolean); drop function public.security_request_access(text, text); borrar la fila del registro.




-- ---------------------------------------------------------------------------
-- 1. Las tablas
-- ---------------------------------------------------------------------------

-- Un dispositivo = un navegador o una app con su id propio (`rtg_device`, uuid que nace en el cliente y se guarda en
-- cookie). La app de escritorio tiene su almacén aparte del Chrome de la misma máquina, así que son dos dispositivos.
create table if not exists public.security_devices (
  id            text primary key,
  -- Lo que el admin le pone: «Sales McAllen 1». Hasta entonces, el nombre lo da el agente de usuario.
  label         text,
  -- desktop = la app RTG Hub de escritorio (RTGHub/ en el agente); phone = móvil; browser = un navegador de computadora.
  kind          text not null default 'browser' check (kind in ('desktop', 'phone', 'browser')),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  user_agent    text,
  platform      text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Quién lo abrió la primera vez y quién lo usó la última.
  first_user_id uuid references public.profiles(id) on delete set null,
  last_user_id  uuid references public.profiles(id) on delete set null,
  approved_by   uuid references public.profiles(id) on delete set null,
  approved_at   timestamptz,
  revoked_by    uuid references public.profiles(id) on delete set null,
  revoked_at    timestamptz,
  notes         text,
  -- true si el id vino en la cabecera de la app de escritorio (ligado a la máquina, no copiable); false si vino en
  -- la cookie de un navegador o un teléfono.
  bound         boolean not null default false,
  -- La solicitud de autorización desde la pantalla de bloqueo: quién, cuándo y qué dijo.
  requested_at  timestamptz,
  requested_by  uuid references public.profiles(id) on delete set null,
  request_note  text
);
create index if not exists devices_last_seen_idx on public.security_devices (last_seen_at desc);

-- Quién entró desde qué dispositivo: una fila por (dispositivo, persona), con la primera y la última vez.
create table if not exists public.security_device_users (
  device_id     text not null references public.security_devices(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    integer not null default 1,
  primary key (device_id, user_id)
);
create index if not exists device_users_last_seen_idx on public.security_device_users (last_seen_at desc);

-- El interruptor. UNA fila (id = 1). Nace apagado.
create table if not exists public.security_policy (
  id         integer primary key check (id = 1),
  enforced   boolean not null default false,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
insert into public.security_policy (id, enforced) values (1, false) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RLS: solo el admin (las políticas se llaman security_*)
-- ---------------------------------------------------------------------------
alter table public.security_devices      enable row level security;
alter table public.security_device_users enable row level security;
alter table public.security_policy       enable row level security;

create or replace function public.security_is_admin()
  returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.security_is_admin() from public, anon;
grant  execute on function public.security_is_admin() to authenticated;

drop policy if exists devices_admin on public.security_devices;
create policy devices_admin on public.security_devices for all to authenticated
  using (public.security_is_admin()) with check (public.security_is_admin());
drop policy if exists device_users_admin on public.security_device_users;
create policy device_users_admin on public.security_device_users for all to authenticated
  using (public.security_is_admin()) with check (public.security_is_admin());
drop policy if exists policy_admin on public.security_policy;
create policy policy_admin on public.security_policy for all to authenticated
  using (public.security_is_admin()) with check (public.security_is_admin());

grant select, insert, update, delete on public.security_devices, public.security_device_users, public.security_policy to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Registrar: lo hace cualquier sesión, pero solo sobre SU dispositivo y SU fila
-- ---------------------------------------------------------------------------
-- Security definer a propósito: nadie que no sea admin tiene permiso de escribir en estas tablas, y aun así cada
-- sesión tiene que dejar su huella. La función escribe solo lo que la sesión puede saber de sí misma: su id de
-- dispositivo, su agente, su hora. Un dispositivo nuevo nace `pending`; uno que ya existe NO cambia de estado ni de
-- nombre aquí (eso es del admin).
create or replace function public.security_touch_device(p_device text, p_user_agent text, p_kind text, p_bound boolean default false)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_kind text := case when p_kind in ('desktop', 'phone', 'browser') then p_kind else 'browser' end;
  v_ua   text := left(coalesce(p_user_agent, ''), 400);
begin
  if auth.uid() is null then return; end if;
  if p_device is null or length(p_device) < 8 or length(p_device) > 64 then return; end if;
  insert into public.security_devices (id, kind, user_agent, first_user_id, last_user_id, bound)
    values (p_device, v_kind, v_ua, auth.uid(), auth.uid(), coalesce(p_bound, false))
  on conflict (id) do update
    set last_seen_at = now(), last_user_id = auth.uid(), user_agent = coalesce(nullif(v_ua, ''), public.security_devices.user_agent),
        bound = public.security_devices.bound or coalesce(p_bound, false);
  insert into public.security_device_users (device_id, user_id)
    values (p_device, auth.uid())
  on conflict (device_id, user_id) do update
    set last_seen_at = now(), seen_count = public.security_device_users.seen_count + 1;
end $$;
revoke execute on function public.security_touch_device(text, text, text, boolean) from public, anon;
grant  execute on function public.security_touch_device(text, text, text, boolean) to authenticated;

-- «Solicitar autorización» desde la pantalla de bloqueo: la persona deja su nombre y una nota en SU dispositivo, y el
-- admin lo ve arriba en Security. No cambia el estado: aprobar sigue siendo del admin.
create or replace function public.security_request_access(p_device text, p_note text)
  returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return false; end if;
  update public.security_devices
     set requested_at = now(), requested_by = auth.uid(), request_note = left(coalesce(p_note, ''), 300)
   where id = p_device and status <> 'approved';
  return found;
end $$;
revoke execute on function public.security_request_access(text, text) from public, anon;
grant  execute on function public.security_request_access(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. La puerta: lo que el middleware pregunta en cada navegación
-- ---------------------------------------------------------------------------
-- Como `session_gate` (107): solo de la propia sesión (`auth.uid()`), una fila, y si algo falla el middleware lo lee
-- como «sin regla». Devuelve si la regla está encendida, el rol, el estado y tipo del dispositivo que trae la cookie, y
-- si la persona tiene un viaje abierto (clockin.vehicle_trips sin ended_at), que es lo que abre Quote Builder en el
-- teléfono.
create or replace function public.security_gate(p_device text)
  returns table (enforced boolean, role text, device_status text, device_kind text, visit_open boolean)
  language sql stable security definer set search_path = public, clockin, pg_temp as $$
  select
    coalesce((select p.enforced from public.security_policy p where p.id = 1), false),
    (select pr.role::text from public.profiles pr where pr.id = auth.uid()),
    coalesce((select d.status from public.security_devices d where d.id = p_device), 'none'),
    (select d.kind from public.security_devices d where d.id = p_device),
    exists (select 1 from clockin.vehicle_trips t where t.employee_id = auth.uid() and t.ended_at is null);
$$;
revoke execute on function public.security_gate(text) from public, anon;
grant  execute on function public.security_gate(text) to authenticated;

comment on function public.security_gate(text) is
  'Lo que el middleware necesita para la regla de acceso por dispositivo (D-811): el interruptor, el rol de quien '
  'llama, el estado del dispositivo de su cookie y si tiene un viaje abierto. Solo de la propia sesión.';

-- ===========================================================================
-- Autocomprobación (mira el catálogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from public.security_policy where id = 1 and enforced = false) then
    raise exception '229: la política no nació apagada';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'security_gate' and p.prosecdef) then
    raise exception '229: security_gate no es security definer';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename like 'security_%') < 3 then
    raise exception '229: faltan políticas RLS en security';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'security_%' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception '229: una tabla de security quedó sin RLS';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('229_security_dispositivos.sql', '99eaf52e11dc66544a5401dce98a86ad5d2a79c963dc14033d27a9f98483a00e') on conflict (name) do nothing;
