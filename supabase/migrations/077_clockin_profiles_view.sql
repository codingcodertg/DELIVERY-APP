-- 077: clockin.profiles — the shape clock-in's code expects, over the shape this
-- container actually uses.
--
-- 071/072 split clock-in's 16-column `profiles` the way 058 split timetracker's:
-- identity stays in public.profiles (+ clockin_role), the module's twelve business
-- columns moved to clockin.employee_settings. That is the right storage shape and
-- it breaks 71 call sites, which read `.from("profiles")` and expect language,
-- company_id, store_id, role, is_runner and the rest to be there.
--
-- Rewriting 71 call sites by hand would be 71 chances to get one wrong, and every
-- one of them a silent wrong-column read rather than a compile error. A view with
-- the original shape costs one file and leaves their code untouched — the module
-- client already defaults to this schema, so `.from("profiles")` lands here.
--
-- SECURITY INVOKER, deliberately. A view runs as its owner unless told otherwise,
-- which is how the ERP's app_products ended up ignoring RLS and letting a driver
-- read the whole catalog (068). Both underlying tables have policies; this makes
-- them apply to whoever is querying.
--
-- Writable through INSTEAD OF triggers below, because they update 12 of these
-- columns. Each write is routed to whichever table actually owns the column.

create or replace view clockin.profiles
with (security_invoker = on) as
select
  p.id,
  es.company_id,
  p.full_name,
  p.clockin_role                    as role,
  es.phone,
  coalesce(es.language, 'en')       as language,
  coalesce(es.active, true)         as active,
  es.location_consent_at,
  p.created_at,
  es.store_id,
  es.tutorial_seen_at,
  es.default_schedule,
  es.custom_schedule,
  coalesce(es.is_runner, false)     as is_runner,
  es.vehicle_id,
  es."position"
from public.profiles p
join clockin.employee_settings es on es.id = p.id;

-- ---------------------------------------------------------------------------
-- Writes, routed to the table that owns each column.
-- ---------------------------------------------------------------------------

create or replace function clockin.profiles_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Identity half. clockin_role is guarded by 071's trigger, which still fires:
  -- only a deliveries admin may change who has access.
  update public.profiles
     set full_name    = coalesce(new.full_name, old.full_name),
         clockin_role = coalesce(new.role, old.role)
   where id = old.id;

  -- Everything else belongs to the module.
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
end $$;

create or replace function clockin.profiles_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- No row is created in public.profiles here. An identity comes from signing up,
  -- and inventing one from a module write is how you get two accounts for one
  -- person. If the profile does not exist yet, say so rather than half-create it.
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
    update public.profiles set clockin_role = new.role where id = new.id;
  end if;
  return new;
end $$;

create trigger profiles_update instead of update on clockin.profiles
  for each row execute function clockin.profiles_update();
create trigger profiles_insert instead of insert on clockin.profiles
  for each row execute function clockin.profiles_insert();

revoke execute on function clockin.profiles_update() from public, anon;
revoke execute on function clockin.profiles_insert() from public, anon;
grant select, insert, update on clockin.profiles to authenticated, service_role;
