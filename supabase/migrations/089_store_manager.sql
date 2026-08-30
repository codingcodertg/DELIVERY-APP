-- 089 · El escalafón que faltaba: gerente de tienda, y las tiendas extra
--
-- Hasta ahora Time Tracker tenía DOS niveles —admin y empleado— y `clockin.profiles` derivaba
-- de ellos `owner` o `employee`. Nunca emitía 'manager'.
--
-- Consecuencia medida antes de tocar nada: la rama de `storeScope` que acota por tienda
--
--     const scopeStore = role === "manager" && storeId ? storeId : null;
--
-- **nunca se ejecutaba**, porque `role` jamás valía "manager". Es decir: todo el que entraba a
-- una pantalla de gerente veía la empresa entera, y los comentarios que decían "un gerente con
-- tienda ve solo su cuadrilla" describían algo que no ocurría. Ocho de doce personas tienen
-- `store_id` puesto y no servía para nada.
--
-- Esto crea el nivel intermedio de verdad y le añade lo que pidió Andrés: un gerente ve su
-- tienda, y se le pueden conceder otras.

-- ---------------------------------------------------------------------------
-- 1. El nivel
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_timetracker_role_check;
alter table public.profiles add constraint profiles_timetracker_role_check
  check (timetracker_role is null or timetracker_role in ('admin', 'manager', 'employee'));

-- ---------------------------------------------------------------------------
-- 2. Las tiendas extra
-- ---------------------------------------------------------------------------
-- Un array y no una tabla puente: es una lista corta por persona, se lee entera siempre y
-- nunca se consulta al revés ("quién ve esta tienda"). Una tabla puente sería más ceremonia
-- para exactamente las mismas respuestas. Sigue el patrón de `module_access`, que ya es así.
alter table clockin.employee_settings
  add column if not exists extra_store_ids uuid[] not null default '{}';

comment on column clockin.employee_settings.extra_store_ids is
  'Tiendas ADEMÁS de store_id que este gerente puede ver. Vacío = solo la suya.';

-- ---------------------------------------------------------------------------
-- 3. La vista emite el nivel nuevo y la lista
-- ---------------------------------------------------------------------------
create or replace view clockin.profiles
with (security_invoker = on) as
  select p.id,
    es.company_id,
    p.full_name,
    case
      when p.role = 'admin' or p.timetracker_role = 'admin' then 'owner'
      when p.timetracker_role = 'manager' then 'manager'
      else 'employee'
    end as role,
    es.phone,
    coalesce(es.language, 'en') as language,
    coalesce(es.active, true) as active,
    es.location_consent_at,
    p.created_at,
    es.store_id,
    es.tutorial_seen_at,
    es.default_schedule,
    es.custom_schedule,
    coalesce(es.is_runner, false) as is_runner,
    es.vehicle_id,
    es."position",
    coalesce(es.extra_store_ids, '{}'::uuid[]) as extra_store_ids
  from public.profiles p
  join clockin.employee_settings es on es.id = p.id;

-- ---------------------------------------------------------------------------
-- 4. Que un gerente pueda LEER algo
-- ---------------------------------------------------------------------------
-- Sin esto, el nivel nuevo existiría y no vería nada: las dos funciones solo aceptaban admin.
--
-- `auth_is_manager` pasa a incluir al gerente. `auth_is_owner` NO: cerrar un periodo de nómina,
-- firmar, y tocar los sitios de trabajo siguen siendo del dueño. Que las dos funciones tuvieran
-- exactamente el mismo cuerpo era precisamente lo que hacía imposible distinguirlos.
create or replace function clockin.auth_is_manager()
  returns boolean language sql stable security definer set search_path = 'clockin, public' as $$
  select coalesce((
    select p.role = 'admin'
        or (p.timetracker_role in ('admin', 'manager') and coalesce(es.active, true))
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- Lo que esto NO hace, y conviene que quede escrito
-- ---------------------------------------------------------------------------
-- El acotado por tienda lo aplica la APLICACIÓN (`storeScope`), no estas políticas: a nivel de
-- base, un gerente puede leer las filas de su empresa igual que un admin. No es un retroceso
-- —hoy CUALQUIERA que entrase veía la empresa entera— pero tampoco es una garantía de base de
-- datos, y llamarlo así sería mentir. Convertirlo en garantía significa meter la tienda dentro
-- de las políticas de cada tabla, y va en su propio paso.
