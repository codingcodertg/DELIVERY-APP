-- 071: Clock-in module access on profiles (additive only).
--
-- Same shape as 055 (recruiting) and 058 (timetracker), and for the reason 058
-- spells out. Clock-in's own `profiles` carries 16 columns; only four of them are
-- identity (id, full_name, role, created_at). The rest — company_id, phone,
-- language, active, location_consent_at, store_id, tutorial_seen_at,
-- default_schedule, custom_schedule, is_runner, vehicle_id, position — are
-- business data belonging to the module. Those go in clockin.employee_settings
-- (072), not here: bloating the shared table with them would leak module-specific
-- shape into every other module that reads public.profiles.
--
--   clockin_role   -- employee | manager | owner inside clock-in. Null = none.
--   module_access  -- 'clockin' becomes a fourth valid value.
--
-- Safe to re-run.

alter table public.profiles
  add column if not exists clockin_role text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_clockin_role_check') then
    alter table public.profiles
      add constraint profiles_clockin_role_check
        check (clockin_role is null or clockin_role in ('employee','manager','owner'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_clockin_access_needs_role') then
    alter table public.profiles
      add constraint profiles_clockin_access_needs_role
        check (not ('clockin' = any(module_access)) or clockin_role is not null);
  end if;
end $$;

create or replace function public.current_clockin_role()
  returns text language sql stable security definer set search_path = public as $$
  select clockin_role from public.profiles where id = auth.uid();
$$;

-- Wrapped as `select coalesce((select ...), false)` for the reason 058 documents at
-- length: the bare form returns NULL when no row matches, and a plpgsql
-- `if not <expr> then raise` guard treats NULL as permission granted.
create or replace function public.has_clockin_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select clockin_role is not null or role = 'admin'
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- Only a deliveries admin may grant or revoke clock-in access. A separate trigger
-- from the recruiting and timetracker ones, keeping each module's gate independent
-- so one module's bug cannot reach another's — 058's reasoning, unchanged.
create or replace function public.guard_clockin_access_change()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (NEW.clockin_role is distinct from OLD.clockin_role
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

-- Last-owner guard, scoped to clockin_role only — same shape as
-- protect_last_recruiting_admin() (056) and its timetracker sibling (058).
create or replace function public.protect_last_clockin_owner()
  returns trigger language plpgsql security definer set search_path = public as $$
declare owner_count int;
begin
  if TG_OP = 'UPDATE' and OLD.clockin_role = 'owner' and NEW.clockin_role is distinct from 'owner' then
    select count(*) into owner_count from public.profiles where clockin_role = 'owner';
    if owner_count <= 1 then
      raise exception 'There must always be at least one clock-in owner';
    end if;
  elsif TG_OP = 'DELETE' and OLD.clockin_role = 'owner' then
    select count(*) into owner_count from public.profiles where clockin_role = 'owner';
    if owner_count <= 1 then
      raise exception 'Cannot delete the last clock-in owner';
    end if;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

drop trigger if exists profiles_protect_clockin_owner on public.profiles;
create trigger profiles_protect_clockin_owner before update or delete on public.profiles
  for each row execute function public.protect_last_clockin_owner();
