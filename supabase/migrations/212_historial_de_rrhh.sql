-- 212: El historial de RR. HH. (D-734, 2026-10-28).
--
-- El dueño: «quiero que todas esas asignaciones … de los números, de todo eso, quede un historial. Y cada vez que un
-- usuario, un employee se desactiva, se activa, lo que sea, … todo tiene que quedar en un historial, que se mire, no se
-- desactivó tal día por tal cosa y así».
--
--   recruiting.hr_history: una fila por cosa que pasó. `kind` (qué), `employee_id`/`employee_name` (a quién; el nombre
--   se copia para que la fila sobreviva al expediente), `asset_id`/`asset_text` (qué correo o número; igual), `actor_id`/
--   `actor_name` (quién lo hizo), `reason` (el motivo que escribió), `detail` (texto libre con el resto) y `data` (lo
--   que cambió, en json). Solo se inserta: ni la app ni nadie con la sesión de la app la edita o la borra.
--   Politicas: leen e insertan admin y gerente de RR. HH. (las mismas de la 211); no hay update ni delete.
-- Sin begin/commit propios. Para deshacer: drop table recruiting.hr_history.

create table if not exists recruiting.hr_history (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  kind          text not null check (kind in (
    'employee_deactivated', 'employee_leaving_edited', 'employee_reactivated',
    'hub_access_removed', 'hub_access_restored',
    'asset_created', 'asset_edited', 'asset_deleted', 'asset_assigned', 'asset_released', 'asset_released_on_leaving',
    'asset_backed_up', 'asset_status_changed'
  )),
  employee_id   uuid references recruiting.employee_files(id) on delete set null,
  employee_name text,
  asset_id      uuid references recruiting.company_assets(id) on delete set null,
  asset_text    text,
  actor_id      uuid references public.profiles(id) on delete set null,
  actor_name    text,
  reason        text,
  detail        text,
  data          jsonb not null default '{}'::jsonb
);
create index if not exists hr_history_employee on recruiting.hr_history (employee_id, at desc);
create index if not exists hr_history_asset on recruiting.hr_history (asset_id, at desc);
create index if not exists hr_history_at on recruiting.hr_history (at desc);

alter table recruiting.hr_history enable row level security;
drop policy if exists hr_history_read on recruiting.hr_history;
create policy hr_history_read on recruiting.hr_history
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists hr_history_insert on recruiting.hr_history;
create policy hr_history_insert on recruiting.hr_history
  for insert with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

grant select, insert on recruiting.hr_history to authenticated;
grant all on recruiting.hr_history to service_role;

do $chk$
begin
  if not exists (select 1 from pg_tables where schemaname = 'recruiting' and tablename = 'hr_history') then
    raise exception '212: falta recruiting.hr_history';
  end if;
  if (select count(*) from pg_policies where schemaname = 'recruiting' and tablename = 'hr_history') <> 2 then
    raise exception '212: faltan politicas';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'recruiting' and tablename = 'hr_history' and cmd in ('UPDATE', 'DELETE', 'ALL')) then
    raise exception '212: el historial no se edita ni se borra';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('212_historial_de_rrhh.sql', 'fa71b3fab802b5376829316f6ed78fdac877da4768cbe9b9bcceb4e949764686') on conflict (name) do nothing;
