-- 072: the clock-in schema — 18 tables, 6 enums.
--
-- Generated from the live clock-in database (project zicjztjdlznqxoddrxtn), the
-- same way the ERP's was, and with the same traps already handled: generated
-- columns emitted as generated rather than as defaults, enum casts schema-
-- qualified, and constraint-backed indexes left to their constraints instead of
-- being re-issued.
--
-- Everything lands in schema `clockin`, following `recruiting`, `timetracker`
-- and `erp`. Two names collided with this database's public schema — `profiles`
-- and `notifications` — and the schema boundary settles the second one for free.
--
-- `profiles` is NOT copied. Its identity half is the shared table; its other
-- twelve columns are the module's own business data and live in
-- clockin.employee_settings above, per 071.

create schema if not exists clockin;

-- enums
create type clockin.entry_status as enum ('open', 'closed', 'edited', 'void');
create type clockin.exception_type as enum ('out_of_radius', 'leaving_while_clocked_in', 'missed_punch', 'other');
create type clockin.leave_reason as enum ('delivery', 'customer_visit', 'picking_up_supplies', 'moving_between_stores', 'lunch', 'personal_emergency', 'other');
create type clockin.request_status as enum ('pending', 'approved', 'denied');
create type clockin.timeoff_type as enum ('vacation', 'sick', 'schedule_change', 'shift_swap');
create type clockin.user_role as enum ('employee', 'manager', 'owner');

-- tables
create table clockin.audit_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  actor_id uuid,
  table_name text not null,
  record_id uuid not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamp with time zone default now() not null
);
create table clockin.companies (
  id uuid default gen_random_uuid() not null,
  name text not null,
  timezone text default 'America/Chicago'::text not null,
  ot_weekly_hours numeric default 40 not null,
  created_at timestamp with time zone default now() not null
);
create table clockin.exceptions (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  time_entry_id uuid,
  type clockin.exception_type not null,
  reason clockin.leave_reason,
  note text,
  photo_path text,
  latitude double precision,
  longitude double precision,
  left_at timestamp with time zone,
  expected_return_at timestamp with time zone,
  returned_at timestamp with time zone,
  resolved boolean default false not null,
  created_at timestamp with time zone default now() not null,
  returned_lat double precision,
  returned_lng double precision,
  returned_photo_path text
);
create table clockin.job_sites (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer default 30 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  boundary jsonb,
  padding_meters integer default 25 not null
);
create table clockin.notes_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  note text not null,
  created_at timestamp with time zone default now() not null
);
create table clockin.notifications (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  type text not null,
  message text not null,
  read boolean default false not null,
  created_at timestamp with time zone default now() not null
);
create table clockin.pay_period_signoffs (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  period_start date not null,
  owner_approved_by uuid,
  owner_approved_at timestamp with time zone default now() not null,
  exported_at timestamp with time zone
);
create table clockin.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default now() not null
);
create table clockin.run_reviews (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  period_start date not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone default now() not null
);
create table clockin.scheduled_shifts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  site_id uuid,
  shift_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  lunch_minutes integer default 30 not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  lunch_start_time time without time zone
);
create table clockin.shift_cancellations (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  shift_date date not null,
  start_time time without time zone not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);
create table clockin.time_entries (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  scheduled_shift_id uuid,
  clock_in_at timestamp with time zone default now() not null,
  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_in_site_id uuid,
  clock_in_in_radius boolean,
  clock_out_at timestamp with time zone,
  clock_out_lat double precision,
  clock_out_lng double precision,
  lunch_minutes integer default 0,
  device_id text,
  ip_address inet,
  status clockin.entry_status default 'open'::clockin.entry_status not null,
  created_at timestamp with time zone default now() not null,
  clock_in_photo_path text,
  edited_at timestamp with time zone,
  edited_by uuid,
  edit_note text,
  manual boolean default false not null,
  clock_out_photo_path text,
  clock_out_in_radius boolean,
  clock_out_site_id uuid,
  still_working_at timestamp with time zone,
  auto_closed boolean default false not null
);
create table clockin.time_off_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  type clockin.timeoff_type not null,
  start_date date not null,
  end_date date not null,
  note text,
  status clockin.request_status default 'pending'::clockin.request_status not null,
  manager_comment text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);
create table clockin.timesheet_approvals (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  period_start date not null,
  approved_by uuid,
  approved_at timestamp with time zone default now() not null,
  note text
);
create table clockin.trip_stops (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  trip_id uuid,
  time_entry_id uuid,
  label text,
  note text,
  arrived_at timestamp with time zone default now() not null,
  latitude double precision,
  longitude double precision,
  photo_path text,
  miles_from_prev numeric,
  created_at timestamp with time zone default now() not null,
  address text,
  departed_at timestamp with time zone,
  depart_lat double precision,
  depart_lng double precision
);
create table clockin.vehicle_trips (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  employee_id uuid not null,
  time_entry_id uuid,
  vehicle_id uuid,
  kind text default 'runner'::text not null,
  started_at timestamp with time zone default now() not null,
  start_odometer numeric,
  start_fuel text,
  start_photo_path text,
  start_lat double precision,
  start_lng double precision,
  ended_at timestamp with time zone,
  end_odometer numeric,
  end_fuel text,
  end_photo_path text,
  end_lat double precision,
  end_lng double precision,
  created_at timestamp with time zone default now() not null,
  start_address text,
  end_address text,
  reason text,
  note text,
  paused_at timestamp with time zone,
  paused_minutes integer default 0 not null
);
create table clockin.vehicles (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  plate text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

-- The module's own per-person data, split out of its `profiles` so the shared
-- identity table keeps only identity (071, following 058's precedent). Column
-- types are copied from the source verbatim.
create table clockin.employee_settings (
  id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid,
  phone text,
  language text not null default 'en',
  active boolean not null default true,
  location_consent_at timestamptz,
  store_id uuid,
  tutorial_seen_at timestamptz,
  default_schedule text,
  custom_schedule jsonb,
  is_runner boolean not null default false,
  vehicle_id uuid,
  "position" text,
  created_at timestamptz not null default now()
);

-- constraints
alter table clockin.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table clockin.companies add constraint companies_pkey PRIMARY KEY (id);
alter table clockin.exceptions add constraint exceptions_pkey PRIMARY KEY (id);
alter table clockin.job_sites add constraint job_sites_pkey PRIMARY KEY (id);
alter table clockin.notes_log add constraint notes_log_pkey PRIMARY KEY (id);
alter table clockin.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table clockin.pay_period_signoffs add constraint pay_period_signoffs_pkey PRIMARY KEY (id);
alter table clockin.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table clockin.run_reviews add constraint run_reviews_pkey PRIMARY KEY (id);
alter table clockin.scheduled_shifts add constraint scheduled_shifts_pkey PRIMARY KEY (id);
alter table clockin.shift_cancellations add constraint shift_cancellations_pkey PRIMARY KEY (id);
alter table clockin.time_entries add constraint time_entries_pkey PRIMARY KEY (id);
alter table clockin.time_off_requests add constraint time_off_requests_pkey PRIMARY KEY (id);
alter table clockin.timesheet_approvals add constraint timesheet_approvals_pkey PRIMARY KEY (id);
alter table clockin.trip_stops add constraint trip_stops_pkey PRIMARY KEY (id);
alter table clockin.vehicle_trips add constraint vehicle_trips_pkey PRIMARY KEY (id);
alter table clockin.vehicles add constraint vehicles_pkey PRIMARY KEY (id);
alter table clockin.pay_period_signoffs add constraint pay_period_signoffs_company_id_period_start_key UNIQUE (company_id, period_start);
alter table clockin.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table clockin.run_reviews add constraint run_reviews_employee_id_period_start_key UNIQUE (employee_id, period_start);
alter table clockin.shift_cancellations add constraint shift_cancellations_employee_id_shift_date_start_time_key UNIQUE (employee_id, shift_date, start_time);
alter table clockin.timesheet_approvals add constraint timesheet_approvals_employee_id_period_start_key UNIQUE (employee_id, period_start);
alter table clockin.audit_log add constraint audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
alter table clockin.audit_log add constraint audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.exceptions add constraint exceptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.exceptions add constraint exceptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.exceptions add constraint exceptions_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES clockin.time_entries(id) ON DELETE CASCADE;
alter table clockin.job_sites add constraint job_sites_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.notes_log add constraint notes_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.notes_log add constraint notes_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.notifications add constraint notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.notifications add constraint notifications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.pay_period_signoffs add constraint pay_period_signoffs_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.pay_period_signoffs add constraint pay_period_signoffs_owner_approved_by_fkey FOREIGN KEY (owner_approved_by) REFERENCES public.profiles(id);
alter table clockin.push_subscriptions add constraint push_subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.push_subscriptions add constraint push_subscriptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.run_reviews add constraint run_reviews_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.run_reviews add constraint run_reviews_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.run_reviews add constraint run_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table clockin.scheduled_shifts add constraint scheduled_shifts_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.scheduled_shifts add constraint scheduled_shifts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table clockin.scheduled_shifts add constraint scheduled_shifts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.scheduled_shifts add constraint scheduled_shifts_site_id_fkey FOREIGN KEY (site_id) REFERENCES clockin.job_sites(id) ON DELETE SET NULL;
alter table clockin.shift_cancellations add constraint shift_cancellations_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.shift_cancellations add constraint shift_cancellations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);
alter table clockin.shift_cancellations add constraint shift_cancellations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.time_entries add constraint time_entries_clock_in_site_id_fkey FOREIGN KEY (clock_in_site_id) REFERENCES clockin.job_sites(id);
alter table clockin.time_entries add constraint time_entries_clock_out_site_id_fkey FOREIGN KEY (clock_out_site_id) REFERENCES clockin.job_sites(id);
alter table clockin.time_entries add constraint time_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.time_entries add constraint time_entries_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.profiles(id);
alter table clockin.time_entries add constraint time_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.time_entries add constraint time_entries_scheduled_shift_id_fkey FOREIGN KEY (scheduled_shift_id) REFERENCES clockin.scheduled_shifts(id) ON DELETE SET NULL;
alter table clockin.time_off_requests add constraint time_off_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.time_off_requests add constraint time_off_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.time_off_requests add constraint time_off_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
alter table clockin.timesheet_approvals add constraint timesheet_approvals_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);
alter table clockin.timesheet_approvals add constraint timesheet_approvals_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.timesheet_approvals add constraint timesheet_approvals_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.trip_stops add constraint trip_stops_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.trip_stops add constraint trip_stops_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.trip_stops add constraint trip_stops_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES clockin.time_entries(id) ON DELETE CASCADE;
alter table clockin.trip_stops add constraint trip_stops_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES clockin.vehicle_trips(id) ON DELETE CASCADE;
alter table clockin.vehicle_trips add constraint vehicle_trips_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;
alter table clockin.vehicle_trips add constraint vehicle_trips_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
alter table clockin.vehicle_trips add constraint vehicle_trips_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES clockin.time_entries(id) ON DELETE CASCADE;
alter table clockin.vehicle_trips add constraint vehicle_trips_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES clockin.vehicles(id);
alter table clockin.vehicles add constraint vehicles_company_id_fkey FOREIGN KEY (company_id) REFERENCES clockin.companies(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX audit_log_company_id_created_at_idx ON clockin.audit_log USING btree (company_id, created_at);
CREATE INDEX exceptions_company_id_created_at_idx ON clockin.exceptions USING btree (company_id, created_at);
CREATE INDEX job_sites_company_id_idx ON clockin.job_sites USING btree (company_id);
CREATE INDEX notes_log_company_id_employee_id_created_at_idx ON clockin.notes_log USING btree (company_id, employee_id, created_at);
CREATE INDEX notifications_employee_id_read_idx ON clockin.notifications USING btree (employee_id, read);
CREATE INDEX push_subscriptions_employee_idx ON clockin.push_subscriptions USING btree (employee_id);
CREATE INDEX run_reviews_period_idx ON clockin.run_reviews USING btree (company_id, period_start);
CREATE INDEX scheduled_shifts_company_id_shift_date_idx ON clockin.scheduled_shifts USING btree (company_id, shift_date);
CREATE INDEX scheduled_shifts_employee_id_shift_date_idx ON clockin.scheduled_shifts USING btree (employee_id, shift_date);
CREATE INDEX shift_cancellations_emp_idx ON clockin.shift_cancellations USING btree (employee_id, shift_date);
CREATE INDEX time_entries_company_id_clock_in_at_idx ON clockin.time_entries USING btree (company_id, clock_in_at);
CREATE INDEX time_entries_employee_id_clock_in_at_idx ON clockin.time_entries USING btree (employee_id, clock_in_at);
CREATE INDEX time_entries_open_idx ON clockin.time_entries USING btree (status) WHERE (status = 'open'::clockin.entry_status);
CREATE INDEX time_off_requests_company_id_status_idx ON clockin.time_off_requests USING btree (company_id, status);
CREATE INDEX timesheet_approvals_period_idx ON clockin.timesheet_approvals USING btree (company_id, period_start);
CREATE INDEX trip_stops_emp_idx ON clockin.trip_stops USING btree (employee_id);
CREATE INDEX trip_stops_trip_idx ON clockin.trip_stops USING btree (trip_id);
CREATE INDEX vehicle_trips_emp_idx ON clockin.vehicle_trips USING btree (employee_id);
CREATE INDEX vehicle_trips_entry_idx ON clockin.vehicle_trips USING btree (time_entry_id);
CREATE INDEX vehicle_trips_vehicle_idx ON clockin.vehicle_trips USING btree (vehicle_id);
CREATE INDEX vehicles_company_idx ON clockin.vehicles USING btree (company_id);
