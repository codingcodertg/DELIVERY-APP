-- 275: Checklist de alta y baja (onboarding / offboarding) con seguimiento de estado (D-934, 2026-11-09).
--
-- Roberto en la junta: los pasos del alta son «signed email, RingCentral number, QuickBooks access, SharePoint/app
-- access, and app risk». La baja es el mismo set en reversa (quitar o recuperar cada cosa). Quiere ver, por empleado, qué
-- paso está hecho, cuál falta y quién lo marcó.
--
-- La PLANTILLA de pasos vive en código (src/lib/recruiting/checklist.ts) para poder ajustarla sin migrar. Esta tabla solo
-- guarda el estado: una fila por empleado, fase (onboarding/offboarding) e ítem (`item_key`, una de las claves de la
-- plantilla), con el estado (pending/done/na), quién lo marcó, cuándo y una nota.
--
--   recruiting.employee_checklist: `employee_file_id` (el expediente; on delete cascade: sin expediente no hay checklist),
--   `phase`, `item_key`, `status`, `done_by`/`done_by_name` (quién marcó, con el nombre copiado), `done_at`, `note`,
--   `updated_at`/`updated_by`. Una fila por (expediente, fase, ítem).
--   Políticas: las mismas del expediente y de los activos (094/211): admin y gerente de RR. HH. leen y escriben.
-- Sin begin/commit propios. Para deshacer: drop table recruiting.employee_checklist.

create table if not exists recruiting.employee_checklist (
  id               uuid primary key default gen_random_uuid(),
  employee_file_id uuid not null references recruiting.employee_files(id) on delete cascade,
  phase            text not null check (phase in ('onboarding', 'offboarding')),
  item_key         text not null check (length(btrim(item_key)) between 1 and 60),
  status           text not null default 'pending' check (status in ('pending', 'done', 'na')),
  done_by          uuid references public.profiles(id) on delete set null,
  done_by_name     text,
  done_at          timestamptz,
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint employee_checklist_unica unique (employee_file_id, phase, item_key)
);
create index if not exists employee_checklist_empleado on recruiting.employee_checklist (employee_file_id, phase);

alter table recruiting.employee_checklist enable row level security;
drop policy if exists employee_checklist_read on recruiting.employee_checklist;
create policy employee_checklist_read on recruiting.employee_checklist
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists employee_checklist_write on recruiting.employee_checklist;
create policy employee_checklist_write on recruiting.employee_checklist
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

grant select, insert, update, delete on recruiting.employee_checklist to authenticated;
grant all on recruiting.employee_checklist to service_role;

do $chk$
begin
  if not exists (select 1 from pg_tables where schemaname = 'recruiting' and tablename = 'employee_checklist') then
    raise exception '275: falta recruiting.employee_checklist';
  end if;
  if (select count(*) from pg_policies where schemaname = 'recruiting' and tablename = 'employee_checklist') <> 2 then
    raise exception '275: faltan politicas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('275_checklist_alta_y_baja.sql', 'a2bd27d9a9a01a1b933e89017d586541744b85a2d3d42c4abc2a5df2ce60adc3') on conflict (name) do nothing;
