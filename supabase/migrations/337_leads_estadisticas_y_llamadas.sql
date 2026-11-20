-- ===========================================================================
-- 337 - Leads: LLAMADAS DE RINGCENTRAL en la ficha del lead, y la lectura para las estadísticas de uso.
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueño, con migrate-status antes y después. SIN línea en schema_migrations
-- (el dueño la registra al aplicarla).
--
-- QUE HACE. Pedido del dueño (2026-11-19, reunión): ver en cada lead las llamadas que sus vendedores hacen (o reciben)
-- a los teléfonos del lead, con su grabación, y saber qué vendedor usa más la app.
--
--   rc_lead_calls       una fila por llamada de RingCentral que empareja con el teléfono de UN lead (contratista o
--                       propietario, el del Excel o el de mano). Como la 326 para candidatos: las llamadas que no son
--                       de ningún lead no se guardan. La clave de emparejar es `phone_key`: los 10 dígitos de EE. UU.
--                       (misma regla que `diezDigitos` de src/lib/recruiting/rc-comms.ts y que
--                       `public.leads_clave_de_telefono` de aquí; las dos deben quedarse iguales).
--   rc_lead_sync_state  una sola fila (id = 1): cuándo corrió la lectura y hasta dónde llegó, para barrer cada 2 horas.
--   Bucket rc-lead-recordings  PRIVADO, sin políticas para los clientes: el audio sale firmado (10 minutos) por el
--                       servidor, a quien ya pasó la comprobación de `leads_llamadas_de_lead`.
--
-- LECTURA. Ninguna tabla nueva se lee directo desde el navegador: solo por funciones.
--   leads_llamadas_de_lead(lead)            las llamadas de los teléfonos de UN lead. Exige que quien llama VEA el lead
--                                           (`leads_puede_ver_fila`) y que ningún lead que no ve comparta ese teléfono
--                                           (regla en el cuerpo de la función: los teléfonos a mano no filtran nada ajeno).
--   leads_estadisticas_de_llamadas(desde, hasta)  cuántas llamadas por vendedor (nombre y extensión de RingCentral).
--                                           Solo admin y gerente («manager»): la misma regla que la pestaña de estadísticas.
--
-- LO QUE NO TOCA. Ninguna tabla, política o función de 162, 163, 218, 253, 328 o 335. Ningún dato existente.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- Vuelta atrás: ver el final del fichero.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La clave de teléfono. Igual que `diezDigitos` (TypeScript): quita la extensión («ext», «x», «#»), deja los dígitos,
--    quita el 1 de EE. UU. si vienen 11, y devuelve los últimos 10. Null si quedan menos de 10.
-- ---------------------------------------------------------------------------
create or replace function public.leads_clave_de_telefono(p text)
  returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_digitos text;
begin
  if p is null then
    return null;
  end if;
  v_digitos := regexp_replace(regexp_replace(p, '\s*(ext\.?|x|#).*$', '', 'i'), '\D', '', 'g');
  if length(v_digitos) = 11 and left(v_digitos, 1) = '1' then
    v_digitos := substr(v_digitos, 2);
  end if;
  if length(v_digitos) < 10 then
    return null;
  end if;
  return right(v_digitos, 10);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Las llamadas que empareja un lead. Una fila por llamada de RingCentral (rc_call_id único).
-- ---------------------------------------------------------------------------
create table if not exists public.rc_lead_calls (
  id                  uuid primary key default gen_random_uuid(),
  -- Id del registro del call log de RingCentral. Único: una llamada entre dos personas de la empresa sale una vez.
  rc_call_id          text not null unique,
  -- 'in' = entrante (el teléfono del lead llamó), 'out' = saliente (el vendedor llamó al lead).
  direction           text not null check (direction in ('in', 'out')),
  started_at          timestamptz not null,
  duration_s          int,
  -- Resultado de RingCentral («Accepted», «Missed», «Voicemail»...).
  result              text,
  -- Clave de 10 dígitos del teléfono del lead (la otra parte). Con ella se empareja cada lead en las funciones.
  phone_key           text not null,
  -- El lado interno de la llamada: la extensión y el nombre que RingCentral dice (el vendedor). Puede faltar.
  rep_extension       text,
  rep_name            text,
  -- Grabación: la URL de RingCentral mientras está pendiente; la ruta en el bucket cuando ya se bajó.
  recording_uri       text,
  recording_path      text,
  recording_pending   boolean not null default false,
  recording_intentos  int not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists rc_lead_calls_phone_idx on public.rc_lead_calls (phone_key, started_at desc);
create index if not exists rc_lead_calls_started_idx on public.rc_lead_calls (started_at desc);
create index if not exists rc_lead_calls_pending_idx on public.rc_lead_calls (started_at desc) where recording_pending;

alter table public.rc_lead_calls enable row level security;
-- Sin políticas: nadie la lee ni la escribe desde el navegador. La escribe el servidor (llave de servicio, salta RLS) y la
-- leen las dos funciones de abajo (security definer).
revoke all on public.rc_lead_calls from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. El cursor de la lectura: una sola fila. Cuándo corrió por última vez, hasta dónde leyó y el último error.
-- ---------------------------------------------------------------------------
create table if not exists public.rc_lead_sync_state (
  id                int primary key default 1 check (id = 1),
  -- Hasta cuando se leyó sin errores (la siguiente vuelve 2 horas antes, por el solape).
  cursor_at         timestamptz,
  -- Cada intento, sea cual sea su resultado: así el barrido es cada 2 horas y no cada 10 minutos.
  last_run_at       timestamptz,
  -- Null cuando la última corrida salió bien. Valores: «sin_permiso», «limite», «listado».
  last_error_code   text,
  updated_at        timestamptz not null default now()
);

alter table public.rc_lead_sync_state enable row level security;
revoke all on public.rc_lead_sync_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Las grabaciones de los leads: bucket privado, sin políticas para los clientes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('rc-lead-recordings', 'rc-lead-recordings', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- 5. Las llamadas de UN lead. Quien VE el lead (la misma puerta que la nota y el teléfono de mano) las lee; si no lo ve,
--    la misma respuesta que para un lead que no existe: no se dice si existe.
--    El teléfono del lead son los cuatro campos (Excel y de mano, contratista y propietario).
-- ---------------------------------------------------------------------------
create or replace function public.leads_llamadas_de_lead(p_lead uuid)
  returns table (
    id uuid, rc_call_id text, direction text, started_at timestamptz, duration_s int, result text,
    rep_name text, rep_extension text, phone_key text, has_recording boolean, recording_pending boolean
  )
  language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if not public.leads_puede_ver_fila(p_lead) then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  -- REGLA DE VISIBILIDAD (con los teléfonos a mano, que un vendedor puede escribir): una llamada se devuelve para una
  -- clave de teléfono solo si (a) la clave es de ESTE lead y (b) NINGÚN lead que no ve quien pide tiene esa clave en
  -- cualquiera de sus cuatro teléfonos. Así, un vendedor que escribe el número de otro lead en uno suyo no obtiene las
  -- grabaciones de ese otro lead: el número también está en un lead que no ve, y se excluye. Admin y gerente con
  -- acceso ven todos los leads (`leads_puede_ver_fila`), así que ven todo lo que el lead tenga.
  return query
    with claves_del_lead as (
      select distinct public.leads_clave_de_telefono(t.v) as clave
        from public.leads l
        cross join lateral (values (l.owner_phone), (l.owner_phone_manual), (l.tenant_phone), (l.tenant_phone_manual)) as t(v)
       where l.id = p_lead
    ),
    claves_ocultas as (
      select distinct public.leads_clave_de_telefono(t.v) as clave
        from public.leads l
        cross join lateral (values (l.owner_phone), (l.owner_phone_manual), (l.tenant_phone), (l.tenant_phone_manual)) as t(v)
       where not public.leads_puede_ver_fila(l.id)
    )
    select c.id, c.rc_call_id, c.direction, c.started_at, c.duration_s, c.result,
           c.rep_name, c.rep_extension, c.phone_key,
           (c.recording_path is not null) as has_recording, c.recording_pending
      from public.rc_lead_calls c
     where c.phone_key in (select k.clave from claves_del_lead k where k.clave is not null)
       and c.phone_key not in (select o.clave from claves_ocultas o where o.clave is not null)
     order by c.started_at desc
     limit 200;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Cuántas llamadas hizo cada vendedor (por nombre y extensión de RingCentral) en un rango. Solo admin y gerente.
--    El enlace de la llamada con el vendedor de la app lo hace la pantalla por nombre: no hay tabla de extensiones.
-- ---------------------------------------------------------------------------
create or replace function public.leads_estadisticas_de_llamadas(p_desde timestamptz, p_hasta timestamptz)
  returns table (rep_name text, rep_extension text, llamadas bigint)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'manager')) then
    raise exception 'leads: only the admin or a manager sees the statistics' using errcode = '42501';
  end if;
  -- ALCANCE. Con el alcance de todas las tiendas (`leads_scope_all()`, 163: el admin, o el gerente con su permiso) se
  -- cuenta todo. Con alcance de tienda, solo las llamadas cuyo teléfono está en un lead que VE quien pide y en ningún
  -- lead que no ve: la misma regla de visibilidad por clave que `leads_llamadas_de_lead`.
  if public.leads_scope_all() then
    return query
      select c.rep_name, c.rep_extension, count(*)::bigint
        from public.rc_lead_calls c
       where c.started_at >= p_desde and c.started_at < p_hasta
       group by c.rep_name, c.rep_extension
       order by count(*) desc, c.rep_name;
  else
    return query
      with claves_visibles as (
        select distinct public.leads_clave_de_telefono(t.v) as clave
          from public.leads l
          cross join lateral (values (l.owner_phone), (l.owner_phone_manual), (l.tenant_phone), (l.tenant_phone_manual)) as t(v)
         where public.leads_puede_ver_fila(l.id)
      ),
      claves_ocultas as (
        select distinct public.leads_clave_de_telefono(t.v) as clave
          from public.leads l
          cross join lateral (values (l.owner_phone), (l.owner_phone_manual), (l.tenant_phone), (l.tenant_phone_manual)) as t(v)
         where not public.leads_puede_ver_fila(l.id)
      )
      select c.rep_name, c.rep_extension, count(*)::bigint
        from public.rc_lead_calls c
       where c.started_at >= p_desde and c.started_at < p_hasta
         and c.phone_key in (select v.clave from claves_visibles v where v.clave is not null)
         and c.phone_key not in (select o.clave from claves_ocultas o where o.clave is not null)
       group by c.rep_name, c.rep_extension
       order by count(*) desc, c.rep_name;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Permisos. Como lead_note y lead_set_phone: lo ejecuta quien tiene sesión; nadie anónimo.
-- ---------------------------------------------------------------------------
revoke execute on function public.leads_clave_de_telefono(text) from public, anon;
grant  execute on function public.leads_clave_de_telefono(text) to authenticated;
revoke execute on function public.leads_llamadas_de_lead(uuid) from public, anon;
grant  execute on function public.leads_llamadas_de_lead(uuid) to authenticated;
revoke execute on function public.leads_estadisticas_de_llamadas(timestamptz, timestamptz) from public, anon;
grant  execute on function public.leads_estadisticas_de_llamadas(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Comprobaciones: si algo no cuadra, la transacción se deshace entera.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'leads_clave_de_telefono') then
    raise exception '337: falta leads_clave_de_telefono';
  end if;
  if not exists (select 1 from pg_proc where proname = 'leads_llamadas_de_lead') then
    raise exception '337: falta leads_llamadas_de_lead';
  end if;
  if not exists (select 1 from pg_proc where proname = 'leads_estadisticas_de_llamadas') then
    raise exception '337: falta leads_estadisticas_de_llamadas';
  end if;
  if not exists (select 1 from storage.buckets where id = 'rc-lead-recordings' and public = false) then
    raise exception '337: el bucket rc-lead-recordings no es privado';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Vuelta atrás: drop function leads_estadisticas_de_llamadas(timestamptz, timestamptz); drop function
-- leads_llamadas_de_lead(uuid); drop function leads_clave_de_telefono(text); drop table rc_lead_sync_state; drop table
-- rc_lead_calls; y borrar el bucket rc-lead-recordings si está vacío. Las llamadas guardadas se pierden con las tablas.
