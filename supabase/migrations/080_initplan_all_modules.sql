-- 080: las políticas evalúan sus helpers UNA vez por consulta, no una por fila.
--
-- Es el fallo que tumbó el catálogo del ERP (070), encontrado ahora en los demás
-- módulos por una auditoría: 80 políticas de clockin, recruiting, timetracker y
-- public llamaban a su helper —auth_company_id(), auth_is_manager(),
-- has_recruiting_access(), current_user_role()— sin envolver, y también a
-- auth.uid(). Postgres no puede saber que son constantes dentro de la consulta,
-- así que las ejecuta POR CADA FILA examinada. Envueltas en (select f()) pasan a
-- ser un InitPlan: se calculan una vez y se reutilizan.
--
-- Medido sobre clockin.notifications, 2.161 filas, antes de aplicar esto:
--
--   where company_id = clockin.auth_company_id()            ->  100.9 ms
--   where company_id = (select clockin.auth_company_id())   ->    2.4 ms
--
-- Hoy ninguna tabla es lo bastante grande para que se note en pantalla; el punto
-- es que time_entries crece con cada fichaje y notifications con cada aviso. El
-- catálogo del ERP tampoco molestaba hasta que llegó a 84.000 filas y empezó a
-- dar timeout.
--
-- El cambio es solo de plan, no de permisos: (select f()) devuelve exactamente lo
-- que f(). Se generó leyendo pg_policy y reescribiendo cada expresión, de modo
-- que ninguna condición se escribió a mano ni se pudo alterar por descuido.
-- Idempotente: volver a aplicarlo deja las mismas expresiones.

alter policy "recruiting read settings" on recruiting.settings
  using ((select has_recruiting_access()));
alter policy "recruiting write settings" on recruiting.settings
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read questions" on recruiting.questions
  using ((select has_recruiting_access()));
alter policy "recruiting write questions" on recruiting.questions
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read templates" on recruiting.templates
  using ((select has_recruiting_access()));
alter policy "recruiting write templates" on recruiting.templates
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read custom_fields" on recruiting.custom_fields
  using ((select has_recruiting_access()));
alter policy "recruiting write custom_fields" on recruiting.custom_fields
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read question_sets" on recruiting.question_sets
  using ((select has_recruiting_access()));
alter policy "recruiting write question_sets" on recruiting.question_sets
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read candidates" on recruiting.candidates
  using ((select has_recruiting_access()));
alter policy "recruiting write candidates" on recruiting.candidates
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read contacts" on recruiting.contacts
  using ((select has_recruiting_access()));
alter policy "recruiting write contacts" on recruiting.contacts
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read jobs" on recruiting.jobs
  using ((select has_recruiting_access()));
alter policy "notif read own" on public.notifications
  using ((user_id = (select auth.uid())));
alter policy "notif update own" on public.notifications
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "tokens update own" on public.device_tokens
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "tokens delete own" on public.device_tokens
  using ((user_id = (select auth.uid())));
alter policy "security write admin" on public.security_events
  with check (((select auth.uid()) = actor_id));
alter policy "recruiting write jobs" on recruiting.jobs
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read stages" on recruiting.stages
  using ((select has_recruiting_access()));
alter policy "recruiting write stages" on recruiting.stages
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read stage_history" on recruiting.stage_history
  using ((select has_recruiting_access()));
alter policy "recruiting write stage_history" on recruiting.stage_history
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "recruiting read attachments" on recruiting.attachments
  using ((select has_recruiting_access()));
alter policy "recruiting write attachments" on recruiting.attachments
  using ((select has_recruiting_access()))
  with check ((select has_recruiting_access()));
alter policy "auth read deliveries" on public.deliveries
  using ((is_training OR
CASE ( SELECT profiles.role
       FROM profiles
      WHERE (profiles.id = (select auth.uid())))
    WHEN 'driver'::text THEN ((created_by = (select auth.uid())) OR (assigned_driver = ( SELECT profiles.full_name
       FROM profiles
      WHERE (profiles.id = (select auth.uid())))))
    WHEN 'warehouse'::text THEN (stage = ANY (ARRAY['approved'::text, 'fulfilling'::text, 'ready'::text, 'picked_up'::text, 'delivered'::text]))
    ELSE true
END));
alter policy "driver writes own location" on public.driver_locations
  with check ((driver_id = (select auth.uid())));
alter policy "read fleet locations" on public.driver_locations
  using (((driver_id = (select auth.uid())) OR (COALESCE((select current_user_role()), ''::text) = ANY (ARRAY['admin'::text, 'logistics'::text, 'manager'::text]))));
alter policy "tokens read own" on public.device_tokens
  using ((user_id = (select auth.uid())));
alter policy "tokens write own" on public.device_tokens
  with check ((user_id = (select auth.uid())));
alter policy "security read admin" on public.security_events
  using (((select current_user_role()) = 'admin'::text));
alter policy "tt employee_settings read" on timetracker.employee_settings
  using ((is_timetracker_admin() OR (id = (select auth.uid()))));
alter policy "tt employee_settings insert" on timetracker.employee_settings
  with check (((id = (select auth.uid())) OR is_timetracker_admin()));
alter policy "tt employee_settings update" on timetracker.employee_settings
  using ((is_timetracker_admin() OR (id = (select auth.uid()))));
alter policy "tt projects read" on timetracker.projects
  using ((select has_timetracker_access()));
alter policy "tt assignments read" on timetracker.assignments
  using ((select has_timetracker_access()));
alter policy "tt settings read" on timetracker.settings
  using ((select has_timetracker_access()));
alter policy "tt sessions read" on timetracker.sessions
  using ((is_timetracker_admin() OR (employee_uid = (select auth.uid()))));
alter policy "tt sessions insert" on timetracker.sessions
  with check ((is_timetracker_admin() OR (employee_uid = (select auth.uid()))));
alter policy "audit_insert_mgr" on clockin.audit_log
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "tt sessions update" on timetracker.sessions
  using ((is_timetracker_admin() OR ((employee_uid = (select auth.uid())) AND (payroll_id IS NULL))));
alter policy "tt requests read" on timetracker.requests
  using ((is_timetracker_admin() OR (employee_uid = (select auth.uid()))));
alter policy "tt requests insert" on timetracker.requests
  with check ((employee_uid = (select auth.uid())));
alter policy "tt payrolls read" on timetracker.payrolls
  using ((is_timetracker_admin() OR (employee_uid = (select auth.uid()))));
alter policy "tt screenshots read" on timetracker.screenshots
  using ((is_timetracker_admin() OR (employee_uid = (select auth.uid()))));
alter policy "tt screenshots insert" on timetracker.screenshots
  with check ((employee_uid = (select auth.uid())));
alter policy "tt screenshots delete" on timetracker.screenshots
  using ((is_timetracker_admin() OR (employee_uid = (select auth.uid()))));
alter policy "audit_read_mgr" on clockin.audit_log
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "company_read" on clockin.companies
  using ((id = (select clockin.auth_company_id())));
alter policy "exceptions_manage" on clockin.exceptions
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "exceptions_rw_self" on clockin.exceptions
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))))
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "job_sites_manage" on clockin.job_sites
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_owner())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_owner())));
alter policy "job_sites_read" on clockin.job_sites
  using ((company_id = (select clockin.auth_company_id())));
alter policy "notes_read_mgr" on clockin.notes_log
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "notes_rw_self" on clockin.notes_log
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))))
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "vehicles_manage" on clockin.vehicles
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "notif_rw_self" on clockin.notifications
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))))
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "pps_manage" on clockin.pay_period_signoffs
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "push_rw_self" on clockin.push_subscriptions
  using ((employee_id = (select auth.uid())))
  with check ((employee_id = (select auth.uid())));
alter policy "run_reviews_rw" on clockin.run_reviews
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "shifts_manage" on clockin.scheduled_shifts
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "shifts_read" on clockin.scheduled_shifts
  using (((company_id = (select clockin.auth_company_id())) AND ((employee_id = (select auth.uid())) OR (select clockin.auth_is_manager()))));
alter policy "shift_cancellations_rw" on clockin.shift_cancellations
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "entries_insert_self" on clockin.time_entries
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "entries_manage" on clockin.time_entries
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "entries_read" on clockin.time_entries
  using (((company_id = (select clockin.auth_company_id())) AND ((employee_id = (select auth.uid())) OR (select clockin.auth_is_manager()))));
alter policy "entries_update_self_open" on clockin.time_entries
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "timeoff_manage" on clockin.time_off_requests
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "vehicles_read" on clockin.vehicles
  using ((company_id = (select clockin.auth_company_id())));
alter policy "timeoff_rw_self" on clockin.time_off_requests
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))))
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "tsa_manage" on clockin.timesheet_approvals
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "stops_close_self" on clockin.trip_stops
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid())) AND (departed_at IS NULL)))
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "stops_insert_self" on clockin.trip_stops
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));
alter policy "stops_manage" on clockin.trip_stops
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "stops_read" on clockin.trip_stops
  using (((company_id = (select clockin.auth_company_id())) AND ((employee_id = (select auth.uid())) OR (select clockin.auth_is_manager()))));
alter policy "trips_manage" on clockin.vehicle_trips
  using (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())))
  with check (((company_id = (select clockin.auth_company_id())) AND (select clockin.auth_is_manager())));
alter policy "trips_read" on clockin.vehicle_trips
  using (((company_id = (select clockin.auth_company_id())) AND ((employee_id = (select auth.uid())) OR (select clockin.auth_is_manager()))));
alter policy "trips_rw_self" on clockin.vehicle_trips
  using (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))))
  with check (((company_id = (select clockin.auth_company_id())) AND (employee_id = (select auth.uid()))));