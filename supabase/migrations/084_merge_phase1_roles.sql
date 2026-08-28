-- 084 · Fusión Time Tracker + Clock-in, fase 1: un solo escalafón.
--
-- Decidido con Andrés: la app madre es Time Tracker y su escalafón es el que queda
-- —admin / empleado— en vez de los tres de clock-in. Esta migración unifica el rol
-- SIN mover ninguna pantalla: las dos apps siguen donde están y siguen funcionando,
-- pero leen el mismo rol.
--
-- ---------------------------------------------------------------------------
-- Qué gana y qué pierde cada quien, medido antes de escribir esto
-- ---------------------------------------------------------------------------
-- Se miró quién ejerce hoy los poderes de "solo dueño":
--
--   cierre de nómina      Jose Perez (Owner)     2 veces
--   aprobación de parte   Patricia Hernández     2   ·  Jose Perez  1
--   turnos creados        Jose Perez (Owner)    38
--
-- La primera idea fue mapear "solo dueño" a "admin del hub" (Andrés y Roberto). Se
-- descartó al ver esto: habría dejado a Jose sin cerrar nóminas, que es lo único que
-- nadie más hace. Con dos niveles, el admin del módulo puede lo de un gerente Y lo de
-- un dueño.
--
-- Consecuencia real, y es la única: Patricia gana cerrar nóminas y editar geocercas.
-- No hay forma de evitarlo con dos niveles; el tercero existía justo para eso.
--
-- ---------------------------------------------------------------------------
-- La atadura a la geocerca deja de colgar del rol
-- ---------------------------------------------------------------------------
-- En clock.ts, estar atado a tu sitio salía de `role <> 'owner' and store_id`. Con dos
-- niveles eso desataría a todo admin. Pasa a ser tener sitio asignado, que es lo que
-- siempre debió significar. Para que el resultado sea idéntico al de hoy se le quita el
-- sitio al dueño: hoy NO está atado, y con la regla nueva su sitio lo ataría. Patricia
-- conserva el suyo y sigue atada, igual que hoy.

update clockin.employee_settings es
   set store_id = null
  from public.profiles p
 where p.id = es.id and p.clockin_role = 'owner' and es.store_id is not null;

-- ---------------------------------------------------------------------------
-- El rol, unificado
-- ---------------------------------------------------------------------------
update public.profiles
   set timetracker_role = case when clockin_role in ('owner','manager') then 'admin' else 'employee' end
 where clockin_role is not null and timetracker_role is null;

-- Quien ficha necesita el módulo madre para poder llegar a él cuando las pantallas se
-- muden (fase 3). Se otorga ahora para que no sea una cosa más que recordar luego.
update public.profiles
   set module_access = array_append(module_access, 'timetracker')
 where 'clockin' = any(coalesce(module_access, '{}'))
   and not ('timetracker' = any(coalesce(module_access, '{}')));

-- `clockin_role` se queda de momento —lo exige la restricción de 071 y lo leen algunas
-- pantallas— pero deja de ser donde se decide nada. Un espejo lo mantiene al día desde
-- el rol de verdad, para que nadie tenga que acordarse de tocar dos columnas. Se retira
-- en la fase 5, junto con la restricción.
create or replace function public.mirror_clockin_role()
  returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if NEW.timetracker_role is distinct from OLD.timetracker_role
     and 'clockin' = any(coalesce(NEW.module_access, '{}')) then
    -- 'owner' y no 'manager': con dos niveles el admin del módulo puede todo, y las
    -- pantallas que aún miran esta columna tienen que verlo así.
    NEW.clockin_role := case when NEW.timetracker_role = 'admin' then 'owner' else 'employee' end;
  end if;
  return NEW;
end $fn$;

drop trigger if exists profiles_mirror_clockin_role on public.profiles;
create trigger profiles_mirror_clockin_role before update of timetracker_role on public.profiles
  for each row execute function public.mirror_clockin_role();

-- ---------------------------------------------------------------------------
-- Las funciones de clock-in leen el rol nuevo
-- ---------------------------------------------------------------------------
-- Ahora el admin del módulo es a la vez gerente y dueño. `active` se sigue respetando:
-- a alguien desactivado no se le devuelve el mando por ser admin.
CREATE OR REPLACE FUNCTION clockin.auth_is_manager()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'clockin, public'
AS $fn$
  select coalesce((
    select p.role = 'admin'
        or (p.timetracker_role = 'admin' and coalesce(es.active, true))
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$fn$;

CREATE OR REPLACE FUNCTION clockin.auth_is_owner()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'clockin, public'
AS $fn$
  select coalesce((
    select p.role = 'admin'
        or (p.timetracker_role = 'admin' and coalesce(es.active, true))
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$fn$;

-- Y la vista traduce, que es lo que deja intactas las 71 llamadas: el código de
-- clock-in sigue comparando con 'owner' / 'employee' sin enterarse del cambio.
create or replace view clockin.profiles
with (security_invoker = on) as
select
  p.id,
  es.company_id,
  p.full_name,
  case when p.role = 'admin' or p.timetracker_role = 'admin' then 'owner' else 'employee' end as role,
  es.phone,
  coalesce(es.language, 'en')   as language,
  coalesce(es.active, true)     as active,
  es.location_consent_at,
  p.created_at,
  es.store_id,
  es.tutorial_seen_at,
  es.default_schedule,
  es.custom_schedule,
  coalesce(es.is_runner, false) as is_runner,
  es.vehicle_id,
  es."position"
from public.profiles p
join clockin.employee_settings es on es.id = p.id;

-- El trigger de escritura de la vista sigue el mismo mapa al revés.
create or replace function clockin.profiles_update()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  update public.profiles
     set full_name        = coalesce(new.full_name, old.full_name),
         timetracker_role = case
                              when new.role is null then old.role
                              when new.role in ('owner','manager') then 'admin'
                              else 'employee'
                            end
   where id = old.id;

  update clockin.employee_settings
     set company_id          = new.company_id,
         phone               = new.phone,
         language            = new.language,
         active              = new.active,
         location_consent_at = new.location_consent_at,
         store_id            = new.store_id,
         tutorial_seen_at    = new.tutorial_seen_at,
         default_schedule    = new.default_schedule,
         custom_schedule     = new.custom_schedule,
         is_runner           = new.is_runner,
         vehicle_id          = new.vehicle_id,
         "position"          = new."position"
   where id = old.id;

  return new;
end $fn$;
