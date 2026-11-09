-- 276: Formulario de renuncia (quit form) del empleado (D-935, 2026-11-09).
--
-- Roberto en la junta: cuando un empleado renuncia firma un formato con el motivo (otro trabajo, asuntos personales, …)
-- para protegerse de reclamos de desempleo. Quiere capturarlo al dar de baja o desde el expediente, guardarlo y verlo
-- después, con una foto opcional del formato ya firmado.
--
-- Los motivos viven en código (src/lib/recruiting/quit-form.ts); el `check` de aquí los repite para que la base no acepte
-- otra cosa. La foto se sube con el mismo patrón que los documentos del empleado (cubo privado `hr-docs`, ruta que decide
-- el servidor). Puede haber más de un formulario por expediente (una recontratación que luego vuelve a renunciar); la
-- pantalla muestra el más reciente.
--
--   recruiting.quit_forms: `employee_file_id` (on delete cascade), `reason` (uno de la lista) + `note`, `signed_name`,
--   `signed_at` (fecha de la firma), `photo_path` (en `hr-docs`, opcional), `created_by`/`created_by_name`, `created_at`,
--   `updated_at`/`updated_by`.
--   Políticas: como el expediente y los activos (094/211): admin y gerente de RR. HH. leen y escriben.
-- Sin begin/commit propios. Para deshacer: drop table recruiting.quit_forms.

create table if not exists recruiting.quit_forms (
  id               uuid primary key default gen_random_uuid(),
  employee_file_id uuid not null references recruiting.employee_files(id) on delete cascade,
  reason           text not null check (reason in (
    'another_job', 'personal', 'relocation', 'health', 'school', 'family', 'schedule', 'pay', 'other'
  )),
  note             text,
  signed_name      text not null check (length(btrim(signed_name)) between 1 and 160),
  signed_at        date,
  photo_path       text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create index if not exists quit_forms_empleado on recruiting.quit_forms (employee_file_id, created_at desc);

alter table recruiting.quit_forms enable row level security;
drop policy if exists quit_forms_read on recruiting.quit_forms;
create policy quit_forms_read on recruiting.quit_forms
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists quit_forms_write on recruiting.quit_forms;
create policy quit_forms_write on recruiting.quit_forms
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

grant select, insert, update, delete on recruiting.quit_forms to authenticated;
grant all on recruiting.quit_forms to service_role;

do $chk$
begin
  if not exists (select 1 from pg_tables where schemaname = 'recruiting' and tablename = 'quit_forms') then
    raise exception '276: falta recruiting.quit_forms';
  end if;
  if (select count(*) from pg_policies where schemaname = 'recruiting' and tablename = 'quit_forms') <> 2 then
    raise exception '276: faltan politicas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('276_formulario_de_renuncia.sql', '50d35e7cb70d2008e57212085d25fabd1cfefb1bff1265272639a4fabbdbc27c') on conflict (name) do nothing;
