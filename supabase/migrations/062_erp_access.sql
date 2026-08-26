-- 062: ERP module access on profiles (additive only).
--
-- Same shape as 055 (recruiting) and 058 (timetracker), with ONE deliberate
-- difference: there is no `erp_role` column.
--
-- Recruiting and timetracker each have a role tier of their own (admin/manager/
-- recruiter, admin/employee) that means nothing outside the module. The ERP does
-- not: what it cares about is the SHARED role already on this table. Its cost
-- guarantee (rtg-erp's decision #29 — cost, margin and GM never reach a
-- non-admin/manager session) is expressed as `role in ('admin','manager')`, and
-- 'admin'/'manager' are values public.profiles.role already carries. Adding an
-- erp_role would have meant maintaining a second copy of the same fact, and the
-- two would drift.
--
-- So access is the module_access flag alone. 'erp' becomes a fourth valid value
-- beside 'recruiting' and 'timetracker'. No constraint change is needed: nothing
-- restricts which strings module_access may hold, only the two
-- <module>_access_needs_role pairings, and this module has no role to pair with.
--
-- Safe to re-run.

-- Whether this identity may open the ERP at all.
--
-- Wrapped as `select coalesce((select ...), false)` for the reason 058 spells
-- out at length: the bare form returns NULL when no profile row matches, and a
-- plpgsql `if not <expr> then raise` guard treats NULL as falsy — that is, as
-- permission granted. A boolean helper gating a privilege must never return
-- anything but true or false.
--
-- An admin is always in, without needing the flag set: the same person who
-- grants module access should not be able to lock themselves out of the module
-- they administer.
create or replace function public.has_erp_access()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select 'erp' = any(module_access) or role = 'admin'
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- Only a deliveries admin may grant or revoke ERP access. A new trigger rather
-- than an extension of guard_recruiting_access_change() /
-- guard_timetracker_access_change(), keeping each module's gate independent so
-- one module's bug cannot reach another's — 058's reasoning, unchanged.
--
-- Note this fires on module_access alone, since there is no erp_role to watch.
-- The other two guards already fire on module_access as well; all three
-- co-existing is intended, not redundant. Each refuses the change for its own
-- reason, and removing any one of them must not open a hole in the others.
create or replace function public.guard_erp_access_change()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.module_access is distinct from OLD.module_access
     and ('erp' = any(coalesce(NEW.module_access, '{}')) is distinct from
          'erp' = any(coalesce(OLD.module_access, '{}')))
     and auth.uid() is not null
     and coalesce(public.current_user_role(), 'sales') <> 'admin' then
    raise exception 'Only an admin can change ERP access';
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_guard_erp_access on public.profiles;
create trigger profiles_guard_erp_access before update on public.profiles
  for each row execute function public.guard_erp_access_change();
