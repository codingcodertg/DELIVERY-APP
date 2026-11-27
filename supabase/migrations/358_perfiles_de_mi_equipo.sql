-- 358: clockin.perfiles_de_mi_equipo() — la lista de personas que quien llama puede gestionar en Time Tracker (lote 2 de la auditoría, 27 nov).
--
-- POR QUÉ. La 291 (pendiente) cierra la lectura de public.profiles a la propia fila, admin y RR. HH.
-- Time Tracker lee `profiles` de OTRAS personas a través de la vista clockin.profiles (security_invoker, 077/089),
-- y esa vista hereda el RLS de public.profiles. Tras la 291 un gerente sin RR. HH. no vería a su cuadrilla:
-- canManageEmployee (company_id, store_id), la lista de fichaje, nómina, horarios, excepciones y fotos quedarían
-- vacíos o dejarían de poder gestionar a nadie. La solución es una consulta propia, SECURITY DEFINER, que aplique
-- EXACTAMENTE el alcance que ya aplica el código (src/lib/clockin/scope.ts y mgrScope.ts) y devuelva solo esas filas.
--
-- QUÉ. Una función de solo lectura, sin argumentos, que devuelve las columnas que usa Time Tracker para cada
-- persona del alcance de quien llama:
--   · dueño (rol de Time Tracker 'owner' en la vista, o admin del hub): toda la empresa del llamante;
--   · gerente (rol 'manager'): las tiendas de su store_id más las de extra_store_ids (089). Sin tienda, nadie (D-237);
--   · cualquier otro: solo su propia fila.
-- El rol 'owner' de la vista ya incluye al admin del hub con fila en clockin.employee_settings (CASE de la 077/089
-- tal como está hoy en vivo). Un admin del hub SIN fila de Time Tracker usa clockin.auth_company_id(), que ya
-- resuelve la única empresa existente, igual que managerCtx.
-- Se apoya en las mismas fuentes que el código: clockin.profiles (vista viva) y public.profiles.timetracker_role.
--
-- CÓMO DESHACER. Nada más lee esta función: el código que la usa cae a la lectura antigua si no existe (PGRST202).
--   drop function if exists clockin.perfiles_de_mi_equipo();
--   delete from public.schema_migrations where name = '358_perfiles_de_mi_equipo.sql';
--
-- Notas de seguridad: el search_path es fijo (clockin, public); la función se ejecuta como su dueño, así que
-- ignora el RLS de public.profiles SOLO para armar esta lista, y por eso el filtro de alcance va dentro de la
-- consulta y no fuera. No se concede a anon ni a public; a authenticated sí (el llamante es siempre un usuario con
-- sesión: sin auth.uid() no devuelve nada).

create or replace function clockin.perfiles_de_mi_equipo()
returns table (
  id                 uuid,
  full_name          text,
  role               text,
  company_id         uuid,
  store_id           uuid,
  extra_store_ids    uuid[],
  active             boolean,
  "position"         text,
  default_schedule   text,
  custom_schedule    jsonb,
  is_runner          boolean,
  vehicle_id         uuid,
  timetracker_role   text
)
language sql
stable
security definer
set search_path = clockin, public
as $$
  with yo as (
    -- El llamante según la vista de Time Tracker (con fila en employee_settings).
    select v.role, v.company_id, v.store_id, v.extra_store_ids
      from clockin.profiles v
     where v.id = (select auth.uid())
    union all
    -- Un admin del hub SIN fila de Time Tracker: dueño de la única empresa (igual que managerCtx).
    select 'owner'::text, clockin.auth_company_id(), null::uuid, '{}'::uuid[]
     where not exists (select 1 from clockin.profiles v where v.id = (select auth.uid()))
       and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  ),
  alcance as (
    select y.role,
           y.company_id,
           case when y.role = 'manager' and y.store_id is not null
                then array[y.store_id] || coalesce(y.extra_store_ids, '{}'::uuid[])
                else '{}'::uuid[]
           end as tiendas
      from yo y
  )
  select t.id, t.full_name, t.role, t.company_id, t.store_id, t.extra_store_ids, t.active,
         t."position", t.default_schedule, t.custom_schedule, t.is_runner, t.vehicle_id,
         p.timetracker_role
    from clockin.profiles t
    join public.profiles p on p.id = t.id
   where exists (
     select 1 from alcance a
      where (a.role = 'owner' and t.company_id = a.company_id)
         or (a.role = 'manager' and t.company_id = a.company_id and t.store_id = any (a.tiendas))
         or (coalesce(a.role, '') not in ('owner', 'manager') and t.id = (select auth.uid()))
   )
$$;

revoke execute on function clockin.perfiles_de_mi_equipo() from public, anon;
grant execute on function clockin.perfiles_de_mi_equipo() to authenticated, service_role;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare
  f regprocedure := 'clockin.perfiles_de_mi_equipo()'::regprocedure;
  cfg text[];
begin
  if not exists (select 1 from pg_proc where oid = f and prosecdef) then
    raise exception '358: perfiles_de_mi_equipo no es SECURITY DEFINER';
  end if;
  select proconfig into cfg from pg_proc where oid = f;
  if cfg is null or not exists (select 1 from unnest(cfg) c where c like 'search_path=%') then
    raise exception '358: perfiles_de_mi_equipo no fija search_path';
  end if;
  if has_function_privilege('anon', f, 'execute') then
    raise exception '358: anon puede ejecutar perfiles_de_mi_equipo';
  end if;
  if not has_function_privilege('authenticated', f, 'execute') then
    raise exception '358: authenticated no puede ejecutar perfiles_de_mi_equipo';
  end if;
  -- Sin sesión no devuelve nada (la función filtra por auth.uid()).
  if exists (select 1 from clockin.perfiles_de_mi_equipo()) then
    raise exception '358: sin sesión la función devuelve filas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('358_perfiles_de_mi_equipo.sql', 'dddd2f4e70a3e5a0ef28e5ec7de64d051bad38cb4b2410ec0c6e3df09cea3455') on conflict (name) do nothing;
