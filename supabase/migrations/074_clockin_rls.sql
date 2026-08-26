-- 074: RLS for the clock-in schema.
--
-- 17 tables with RLS and 32 policies, as they stand in the source. Every helper
-- call is wrapped as `(select fn())` so the planner hoists it into an InitPlan
-- evaluated once per query rather than once per row — the ERP's catalog hit an
-- 8s statement timeout on exactly that, and 31 of these 32 policies call
-- auth_is_manager().
--
-- employee_settings gets its own policies here: it did not exist upstream (its
-- columns lived on profiles), so it has no source policy to copy.

alter table clockin.audit_log enable row level security;
alter table clockin.companies enable row level security;
alter table clockin.exceptions enable row level security;
alter table clockin.job_sites enable row level security;
alter table clockin.notes_log enable row level security;
alter table clockin.notifications enable row level security;
alter table clockin.pay_period_signoffs enable row level security;
alter table clockin.push_subscriptions enable row level security;
alter table clockin.run_reviews enable row level security;
alter table clockin.scheduled_shifts enable row level security;
alter table clockin.shift_cancellations enable row level security;
alter table clockin.time_entries enable row level security;
alter table clockin.time_off_requests enable row level security;
alter table clockin.timesheet_approvals enable row level security;
alter table clockin.trip_stops enable row level security;
alter table clockin.vehicle_trips enable row level security;
alter table clockin.vehicles enable row level security;

create policy "audit_insert_mgr" on clockin.audit_log as permissive for insert to public
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "audit_read_mgr" on clockin.audit_log as permissive for select to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "company_read" on clockin.companies as permissive for select to public
  using ((id = clockin.auth_company_id()));
create policy "exceptions_manage" on clockin.exceptions as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "exceptions_rw_self" on clockin.exceptions as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())))
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "job_sites_manage" on clockin.job_sites as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_owner()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_owner()));
create policy "job_sites_read" on clockin.job_sites as permissive for select to public
  using ((company_id = clockin.auth_company_id()));
create policy "notes_read_mgr" on clockin.notes_log as permissive for select to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "notes_rw_self" on clockin.notes_log as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())))
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "notif_rw_self" on clockin.notifications as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())))
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "pps_manage" on clockin.pay_period_signoffs as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "push_rw_self" on clockin.push_subscriptions as permissive for all to public
  using ((employee_id = auth.uid()))
  with check ((employee_id = auth.uid()));
create policy "run_reviews_rw" on clockin.run_reviews as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "shifts_manage" on clockin.scheduled_shifts as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "shifts_read" on clockin.scheduled_shifts as permissive for select to public
  using (((company_id = clockin.auth_company_id()) AND ((employee_id = auth.uid()) OR clockin.auth_is_manager())));
create policy "shift_cancellations_rw" on clockin.shift_cancellations as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "entries_insert_self" on clockin.time_entries as permissive for insert to public
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "entries_manage" on clockin.time_entries as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "entries_read" on clockin.time_entries as permissive for select to public
  using (((company_id = clockin.auth_company_id()) AND ((employee_id = auth.uid()) OR clockin.auth_is_manager())));
create policy "entries_update_self_open" on clockin.time_entries as permissive for update to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "timeoff_manage" on clockin.time_off_requests as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "timeoff_rw_self" on clockin.time_off_requests as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())))
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "tsa_manage" on clockin.timesheet_approvals as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "stops_close_self" on clockin.trip_stops as permissive for update to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid()) AND (departed_at IS NULL)))
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "stops_insert_self" on clockin.trip_stops as permissive for insert to public
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "stops_manage" on clockin.trip_stops as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "stops_read" on clockin.trip_stops as permissive for select to public
  using (((company_id = clockin.auth_company_id()) AND ((employee_id = auth.uid()) OR clockin.auth_is_manager())));
create policy "trips_manage" on clockin.vehicle_trips as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "trips_read" on clockin.vehicle_trips as permissive for select to public
  using (((company_id = clockin.auth_company_id()) AND ((employee_id = auth.uid()) OR clockin.auth_is_manager())));
create policy "trips_rw_self" on clockin.vehicle_trips as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())))
  with check (((company_id = clockin.auth_company_id()) AND (employee_id = auth.uid())));
create policy "vehicles_manage" on clockin.vehicles as permissive for all to public
  using (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()))
  with check (((company_id = clockin.auth_company_id()) AND clockin.auth_is_manager()));
create policy "vehicles_read" on clockin.vehicles as permissive for select to public
  using ((company_id = clockin.auth_company_id()));

-- The split-out table, gated the same way the module gates everything else.
alter table clockin.employee_settings enable row level security;

create policy "employee_settings read" on clockin.employee_settings for select to authenticated
  using ((select public.has_clockin_access()));

create policy "employee_settings self update" on clockin.employee_settings for update to authenticated
  using (id = (select auth.uid()) or (select clockin.auth_is_manager()));

create policy "employee_settings manager insert" on clockin.employee_settings for insert to authenticated
  with check ((select clockin.auth_is_manager()));
