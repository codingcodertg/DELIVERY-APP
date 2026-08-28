-- 087 · Fusión fase 5: se retira `clockin_role` y todo lo que la sostenía.
--
-- Desde 084 el escalafón de fichaje es el de Time Tracker (admin / empleado) y esta columna
-- ya no decide nada: la mantenía al día un espejo, precisamente para no obligar a nadie a
-- acordarse de tocar dos columnas mientras duraba la transición. La transición terminó.
--
-- Dejarla sería peor que quitarla. Una columna que parece un rol y no lo es acaba
-- consultándose por error —es exactamente lo que pasó con `position`, que escribía el rol
-- sin que se viera (D-095)— y la siguiente persona que la lea no tendrá esta conversación
-- para saber que miente.
--
-- ---------------------------------------------------------------------------
-- Antes de soltar nada: que el rol de verdad esté puesto
-- ---------------------------------------------------------------------------
-- Si alguien tuviera clockin_role y NO timetracker_role, soltar la columna lo dejaría sin
-- acceso a fichaje en silencio. 084 hizo este relleno, pero repetirlo aquí cuesta nada y
-- cubre a quien se haya dado de alta entre una migración y otra.
update public.profiles
   set timetracker_role = case when clockin_role in ('owner','manager') then 'admin' else 'employee' end
 where clockin_role is not null and timetracker_role is null;

-- Y que quien tenga fichaje tenga también el módulo madre, por lo mismo.
update public.profiles
   set module_access = array_append(module_access, 'timetracker')
 where 'clockin' = any(coalesce(module_access, '{}'))
   and not ('timetracker' = any(coalesce(module_access, '{}')));

-- ---------------------------------------------------------------------------
-- has_clockin_access: la misma pregunta, contra la columna que sí manda
-- ---------------------------------------------------------------------------
-- Sigue existiendo porque las políticas de 074 la consultan; lo que cambia es de dónde lee.
-- Envuelta en coalesce por lo que documenta 071: la forma desnuda devuelve NULL cuando no
-- hay fila, y un `if not <expr>` en plpgsql trata NULL como permiso concedido.
create or replace function public.has_clockin_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select timetracker_role is not null or role = 'admin'
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- El guardián de 071 vigilaba quién puede cambiar el acceso a fichaje. La decisión sigue
-- siendo la misma —solo un admin de deliveries— pero ahora la columna vigilada es la del
-- escalafón único. Sin esto, un empleado podría ascenderse a sí mismo.
create or replace function public.guard_clockin_access_change()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (NEW.timetracker_role is distinct from OLD.timetracker_role
      or NEW.module_access is distinct from OLD.module_access)
     and auth.uid() is not null
     and coalesce(public.current_user_role(), 'sales') <> 'admin' then
    raise exception 'Only an admin can change clock-in access or role';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_clockin_access on public.profiles;
create trigger profiles_guard_clockin_access before update on public.profiles
  for each row execute function public.guard_clockin_access_change();

-- La ficha de fichaje se sigue creando sola (078), ahora al aparecer el rol único.
create or replace function public.ensure_clockin_settings()
  returns trigger language plpgsql security definer set search_path = '' as $$
declare only_company uuid;
begin
  if NEW.timetracker_role is null then
    return NEW;                    -- revocar no borra la fila: su historial cuelga de ella
  end if;

  select c.id into only_company
    from clockin.companies c
   where (select count(*) from clockin.companies) = 1;

  insert into clockin.employee_settings (id, company_id)
  values (NEW.id, only_company)
  on conflict (id) do nothing;

  return NEW;
end $$;

drop trigger if exists profiles_ensure_clockin_settings on public.profiles;
create trigger profiles_ensure_clockin_settings
  after insert or update of timetracker_role on public.profiles
  for each row execute function public.ensure_clockin_settings();

-- La vista escribe el rol único; ya no hay columna legada que rellenar.
create or replace function clockin.profiles_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.id) then
    raise exception 'no profile for % — create the account first, then grant clock-in access', new.id
      using errcode = 'foreign_key_violation';
  end if;

  insert into clockin.employee_settings
    (id, company_id, phone, language, active, location_consent_at, store_id,
     tutorial_seen_at, default_schedule, custom_schedule, is_runner, vehicle_id, "position")
  values
    (new.id, new.company_id, new.phone, coalesce(new.language,'en'), coalesce(new.active,true),
     new.location_consent_at, new.store_id, new.tutorial_seen_at, new.default_schedule,
     new.custom_schedule, coalesce(new.is_runner,false), new.vehicle_id, new."position")
  on conflict (id) do nothing;

  if new.role is not null then
    update public.profiles
       set timetracker_role = case when new.role in ('owner','manager') then 'admin' else 'employee' end
     where id = new.id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Fuera lo que ya no sostiene nada
-- ---------------------------------------------------------------------------
-- El último dueño: protegía que no se quedara la empresa sin owner de fichaje. Ese nivel ya
-- no existe — con dos escalones, el equivalente es no quedarse sin admin, que es cosa del
-- hub y no de este módulo.
drop trigger if exists profiles_protect_clockin_owner on public.profiles;
drop function if exists public.protect_last_clockin_owner();

-- El espejo: existía solo para la transición.
drop trigger if exists profiles_mirror_clockin_role on public.profiles;
drop function if exists public.mirror_clockin_role();

drop function if exists public.current_clockin_role();

alter table public.profiles drop constraint if exists profiles_clockin_access_needs_role;
alter table public.profiles drop constraint if exists profiles_clockin_role_check;

-- Y por fin la columna.
alter table public.profiles drop column if exists clockin_role;
