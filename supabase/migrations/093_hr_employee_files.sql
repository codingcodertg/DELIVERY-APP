-- 093 · El expediente del empleado (D-145)
--
-- El módulo pasa a llamarse **HR Management** y recruiting queda como una de sus partes. Esto
-- es la otra: la ficha de cada empleado, con lo que RR. HH. necesita tener a mano.
--
-- ---------------------------------------------------------------------------
-- Dos tablas y no una, y la razón importa
-- ---------------------------------------------------------------------------
-- Lo que pidió Andrés son tres columnas: INFO, HR y FORMS. Pero no son tres cosas del mismo
-- tipo:
--
--   · **INFO** es UN dato por persona — cumpleaños, teléfono, dirección. Cabe en una fila.
--   · **HR y FORMS** son DOCUMENTOS, y varios de ellos son listas: una persona tiene varias
--     amonestaciones, varias pruebas antidoping, varias certificaciones. Y hasta los que
--     parecen únicos —el manual firmado— se vuelven varios en cuanto alguien firma una versión
--     nueva.
--
-- Meterlos como columnas (`handbook_signed`, `noncompete_signed`, …) obligaría a una columna
-- por formulario, y a una migración cada vez que RR. HH. inventara un papel nuevo. Con una
-- tabla de documentos, un formulario nuevo es una fila más y cero cambios de esquema.

-- ---------------------------------------------------------------------------
-- INFO: una fila por persona
-- ---------------------------------------------------------------------------
create table if not exists recruiting.employee_files (
  id            uuid primary key references public.profiles(id) on delete cascade,
  -- El número de empleado de la empresa, que NO es el uuid: es el que se escribe en un papel.
  employee_code text,
  birthday      date,
  date_hired    date,
  phone         text,
  address       text,
  -- Días libres tomados. Se guarda a mano de momento: derivarlo de `time_off_requests` solo
  -- valdría para quien ficha, y este expediente es de TODA la plantilla.
  days_off      numeric,
  notes         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id)
);

comment on table recruiting.employee_files is
  'Ficha de RR. HH. por empleado (D-145). El nombre no se copia: vive en public.profiles.';

-- ---------------------------------------------------------------------------
-- HR + FORMS: un documento por fila
-- ---------------------------------------------------------------------------
create table if not exists recruiting.employee_docs (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  -- `kind` no lleva CHECK a propósito: RR. HH. añadirá papeles que hoy no existen, y una
  -- restricción aquí convertiría "necesitamos otro formulario" en una migración. Los valores
  -- que la aplicación conoce están en src/lib/recruiting/hr.ts.
  kind        text not null,
  -- Cuándo se firmó o se hizo. Nulo = pendiente, que es justo lo que RR. HH. viene a buscar.
  signed_at   date,
  -- Vence: licencias y certificaciones caducan, y un expediente que no lo sabe no sirve.
  expires_at  date,
  file_path   text,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

create index if not exists employee_docs_by_employee on recruiting.employee_docs (employee_id, kind);

-- ---------------------------------------------------------------------------
-- Quién puede verlo
-- ---------------------------------------------------------------------------
-- El mismo guardián que el resto del módulo. Un expediente lleva cumpleaños, dirección,
-- antidoping y amonestaciones: es de lo más sensible de la casa, así que no se inventa aquí
-- una regla nueva — se usa la que ya decide quién entra a RR. HH.
alter table recruiting.employee_files enable row level security;
alter table recruiting.employee_docs  enable row level security;

drop policy if exists employee_files_read on recruiting.employee_files;
create policy employee_files_read on recruiting.employee_files
  for select using ((select public.has_recruiting_access()));
drop policy if exists employee_files_write on recruiting.employee_files;
create policy employee_files_write on recruiting.employee_files
  for all using ((select public.has_recruiting_access()))
  with check ((select public.has_recruiting_access()));

drop policy if exists employee_docs_read on recruiting.employee_docs;
create policy employee_docs_read on recruiting.employee_docs
  for select using ((select public.has_recruiting_access()));
drop policy if exists employee_docs_write on recruiting.employee_docs;
create policy employee_docs_write on recruiting.employee_docs
  for all using ((select public.has_recruiting_access()))
  with check ((select public.has_recruiting_access()));

grant select, insert, update, delete on recruiting.employee_files to authenticated;
grant select, insert, update, delete on recruiting.employee_docs  to authenticated;
