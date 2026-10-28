-- 211: Los activos de la empresa: correos y numeros de telefono que se pagan (D-730, 2026-10-28).
--
-- El dueño: «the company pays for every email account and phone number (RingCentral), so I need to control which ones
-- are in use and which are free … Each asset has a status: Assigned (shows which employee), Available / Not Assigned,
-- Not In Use, Pending Backup».
--
--   recruiting.company_assets: una fila por correo o por numero. `kind` (email | phone), `value` (el correo o el numero,
--   unico por tipo), `ext` y `phone_type` (app | physical) para los telefonos, `status`, `employee_id` (el expediente
--   que lo tiene; solo con status = assigned), `last_employee_id` (quien lo tuvo, al liberarlo), `plan` y `cost_year`
--   (del correo), `note`.
--   Politicas: las mismas de los expedientes (094): admin y gerente de RR. HH. leen y escriben.
-- Sin begin/commit propios. Para deshacer: drop table recruiting.company_assets.

create table if not exists recruiting.company_assets (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('email', 'phone')),
  value            text not null check (length(btrim(value)) between 1 and 120),
  ext              text check (ext is null or ext ~ '^[0-9]{2,6}$'),
  phone_type       text check (phone_type is null or phone_type in ('app', 'physical')),
  status           text not null default 'available' check (status in ('assigned', 'available', 'not_in_use', 'pending_backup')),
  employee_id      uuid references recruiting.employee_files(id) on delete set null,
  last_employee_id uuid references recruiting.employee_files(id) on delete set null,
  plan             text,
  cost_year        numeric(10,2),
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint company_assets_value_unica unique (kind, value),
  constraint company_assets_asignado_con_persona check ((status = 'assigned') = (employee_id is not null))
);
create index if not exists company_assets_employee on recruiting.company_assets (employee_id);

alter table recruiting.company_assets enable row level security;
drop policy if exists company_assets_read on recruiting.company_assets;
create policy company_assets_read on recruiting.company_assets
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists company_assets_write on recruiting.company_assets;
create policy company_assets_write on recruiting.company_assets
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

grant select, insert, update, delete on recruiting.company_assets to authenticated;
grant all on recruiting.company_assets to service_role;

do $chk$
begin
  if not exists (select 1 from pg_tables where schemaname = 'recruiting' and tablename = 'company_assets') then
    raise exception '211: falta recruiting.company_assets';
  end if;
  if (select count(*) from pg_policies where schemaname = 'recruiting' and tablename = 'company_assets') <> 2 then
    raise exception '211: faltan politicas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('211_activos_de_empresa.sql', '45f53ad9646471d72c7026ad66541a77f44463000fe901ccadb063e773cbc948') on conflict (name) do nothing;
