-- 073: clock-in's 8 database functions.
--
-- Their search_path was 'public' and they reference tables unqualified. Left
-- unqualified but pointed at 'clockin, public', so a bare `time_entries`
-- resolves inside the module while a bare `profiles` still finds the shared
-- identity table. Changing it to '' instead would have meant qualifying every
-- reference in 57 functions by hand.
--
-- Three were rewritten rather than moved, because they read a shape that no
-- longer exists: auth_is_manager() and auth_is_owner() read profiles.role (their
-- own enum) and profiles.active, and auth_company_id() read profiles.company_id.
-- Those now read public.profiles.clockin_role and clockin.employee_settings.
--
-- EIGHT, not the 57 in its public schema: the other 49 belong to the `cube` and
-- `earthdistance` extensions, which clock-in installs there for its geofence
-- distance maths. Copying those failed with "permission denied for language c",
-- which was the right answer to the wrong question — they are not its code, and
-- 076 installs the extensions instead.
--
-- check_function_bodies is off for the file: these are emitted alphabetically,
-- which is not dependency order, and pg_restore does the same for the same
-- reason.

set local check_function_bodies = off;

CREATE OR REPLACE FUNCTION clockin.auth_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
  select es.company_id from clockin.employee_settings es where es.id = (select auth.uid())
$function$;

CREATE OR REPLACE FUNCTION clockin.auth_is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
  -- Rewritten for this container: clock-in's profiles carried its own role enum and an
  -- `active` flag. Here the tier is public.profiles.clockin_role (071) and the flag is
  -- clockin.employee_settings.active (072).
  select coalesce((
    select p.clockin_role in ('manager','owner') and coalesce(es.active, true)
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$function$;

CREATE OR REPLACE FUNCTION clockin.auth_is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
  -- Rewritten for this container: clock-in's profiles carried its own role enum and an
  -- `active` flag. Here the tier is public.profiles.clockin_role (071) and the flag is
  -- clockin.employee_settings.active (072).
  select coalesce((
    select p.clockin_role = 'owner' and coalesce(es.active, true)
    from public.profiles p
    left join clockin.employee_settings es on es.id = p.id
    where p.id = (select auth.uid())
  ), false)
$function$;

CREATE OR REPLACE FUNCTION clockin.block_employee_exception_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
begin
  if auth.uid() is not null and not auth_is_manager() then
    raise exception 'Employees cannot delete a recorded break. Ask your manager.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION clockin.enforce_entry_employee_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if auth_is_manager() then
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'This time entry is locked. Ask your manager to change it.'
      using errcode = 'check_violation';
  end if;
  if new.status <> 'closed' or new.clock_out_at is null then
    raise exception 'Employees can only clock out.'
      using errcode = 'check_violation';
  end if;

  if new.clock_in_at        is distinct from old.clock_in_at
     or new.employee_id       is distinct from old.employee_id
     or new.company_id        is distinct from old.company_id
     or new.scheduled_shift_id is distinct from old.scheduled_shift_id
     or new.clock_in_lat      is distinct from old.clock_in_lat
     or new.clock_in_lng      is distinct from old.clock_in_lng
     or new.clock_in_site_id  is distinct from old.clock_in_site_id
     or new.clock_in_in_radius is distinct from old.clock_in_in_radius
     or new.clock_in_photo_path is distinct from old.clock_in_photo_path
     or new.lunch_minutes     is distinct from old.lunch_minutes
     or new.manual            is distinct from old.manual
     or new.edit_note         is distinct from old.edit_note
     or new.edited_by         is distinct from old.edited_by
  then
    raise exception 'Employees cannot edit a recorded punch. Ask your manager.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION clockin.enforce_exception_employee_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'clockin, public'
AS $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  if auth_is_manager() then
    return new;
  end if;

  if old.returned_at is not null then
    raise exception 'This break is already recorded and cannot be changed.'
      using errcode = 'check_violation';
  end if;
  if new.returned_at is null then
    raise exception 'Employees can only end an open break.'
      using errcode = 'check_violation';
  end if;
  if new.employee_id   is distinct from old.employee_id
     or new.company_id   is distinct from old.company_id
     or new.time_entry_id is distinct from old.time_entry_id
     or new.type         is distinct from old.type
     or new.reason       is distinct from old.reason
     or new.left_at      is distinct from old.left_at
     or new.latitude     is distinct from old.latitude
     or new.longitude    is distinct from old.longitude
     or new.photo_path   is distinct from old.photo_path
     or new.resolved     is distinct from old.resolved
  then
    raise exception 'Employees cannot edit a recorded break. Ask your manager.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION clockin.match_job_site(p_company_id uuid, p_lat double precision, p_lng double precision, p_buffer_meters integer DEFAULT 25)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'clockin, public', 'extensions'
AS $function$
  select id from job_sites
  where company_id = p_company_id and active
    and earth_distance(ll_to_earth(latitude, longitude), ll_to_earth(p_lat, p_lng))
        <= (radius_meters + p_buffer_meters)
  order by earth_distance(ll_to_earth(latitude, longitude), ll_to_earth(p_lat, p_lng))
  limit 1
$function$;

CREATE OR REPLACE FUNCTION clockin.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
