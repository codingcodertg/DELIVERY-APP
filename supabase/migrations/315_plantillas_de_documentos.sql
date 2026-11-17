-- ---------------------------------------------------------------------------
-- 315 · Documentos de ingreso: documentos, variantes por puesto y estado por empleado
-- ---------------------------------------------------------------------------
-- PEDIDO. El dueño: «Create a template option that will store this document and many more to come, so during the
-- onboarding of a new employee the HR manager can easily find the documents to download and sign». Primer documento:
-- la política de comisiones, que tiene VARIANTES por puesto u oferta («Junior Sales Representative», «Senior Sales»,
-- «Key Accounts», y variantes con la oferta: «$11/hr», «$13/hr + commission»).
--
-- CUATRO TABLAS, todas en `recruiting`, junto al expediente:
--   · `document_templates`        : el documento (nombre, descripción, categoría corta, orden, activo, y si aplica a
--                                   TODOS —p. ej. un manual— o solo a quien tenga una variante que le toque).
--   · `document_variants`         : las variantes de un documento. Cada una lleva los puestos a los que aplica
--                                   (`positions`), una nota de oferta opcional y el archivo vigente con su versión.
--   · `document_variant_versions` : historial sencillo: cada versión nueva guarda la anterior aquí (la ruta sigue en el cubo).
--   · `employee_documents`        : por empleado y documento: qué variante se usó, su estado (pendiente / enviado /
--                                   firmado / no aplica), la copia firmada y quién y cuándo lo marcó.
--
-- Los archivos van al cubo PRIVADO `hr-docs` (096, 288), el mismo de los papeles del expediente; sus políticas de
-- storage (096) ya dejan leer, subir y borrar solo a admin y gerente de RR. HH. Esta migración NO crea cubo ni políticas
-- de storage. Rutas:
--   templates/<variante>/<versión>-<nombre>
--   employees/<empleado>/signed/<documento>-<marca de tiempo>-<nombre>
--
-- QUIÉN PUEDE. Lo mismo que el expediente (094): `current_recruiting_role()` en ('admin','manager').
--
-- BORRAR. Un documento o una variante con registros de empleados NO se borra (`on delete restrict`): la firma es prueba.
-- Se archiva (`active = false`).
--
-- Para deshacer: drop table recruiting.employee_documents, recruiting.document_variant_versions,
-- recruiting.document_variants, recruiting.document_templates; y quitar la fila del registro
-- (delete from public.schema_migrations where name = '315_plantillas_de_documentos.sql').

-- ---------------------------------------------------------------------------
-- 1 · El documento
-- ---------------------------------------------------------------------------
create table if not exists recruiting.document_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) > 0),
  description     text,
  -- Categoría corta y opcional (Onboarding, Policy, Commission, Tax / Payroll, Other). Texto libre a propósito.
  category        text,
  -- Orden en la lista (menor primero).
  sort_order      integer not null default 100,
  active          boolean not null default true,
  -- false = solo aparece a quien tenga una variante que le toque por puesto. true = aparece a TODOS (p. ej. un manual).
  applies_to_all  boolean not null default false,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists document_templates_by_order on recruiting.document_templates (active, sort_order, name);

comment on table recruiting.document_templates is
  'Documentos de ingreso (315). Solo admin y gerente de RR. HH.';

-- ---------------------------------------------------------------------------
-- 2 · Las variantes de cada documento
-- ---------------------------------------------------------------------------
create table if not exists recruiting.document_variants (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references recruiting.document_templates(id) on delete restrict,
  -- Nombre de la variante, p. ej. «Junior Sales Representative — $13/hr + commission».
  label        text not null check (length(btrim(label)) > 0),
  -- Puestos a los que aplica (comparados sin acentos ni mayúsculas en la app). Vacío = no se sugiere a nadie por puesto.
  positions    text[] not null default '{}',
  -- Nota de la oferta (p. ej. «$11/hr», «$13/hr + commission»). Libre, solo informativa.
  offer_note   text,
  -- Archivo vigente.
  file_path    text not null,
  file_name    text not null,
  mime         text,
  size         bigint,
  version      integer not null default 1 check (version >= 1),
  active       boolean not null default true,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists document_variants_by_template on recruiting.document_variants (template_id, active);

comment on table recruiting.document_variants is
  'Variantes de un documento de ingreso, por puesto u oferta (315). La vigente tiene el archivo actual.';

-- ---------------------------------------------------------------------------
-- 3 · Historial de versiones de cada variante
-- ---------------------------------------------------------------------------
create table if not exists recruiting.document_variant_versions (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references recruiting.document_variants(id) on delete cascade,
  version     integer not null check (version >= 1),
  file_path   text not null,
  file_name   text not null,
  mime        text,
  size        bigint,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (variant_id, version)
);

comment on table recruiting.document_variant_versions is
  'Versiones anteriores del archivo de una variante (315). La vigente está en document_variants.';

-- ---------------------------------------------------------------------------
-- 4 · Lo que pasa con cada documento para cada empleado
-- ---------------------------------------------------------------------------
-- El empleado es la fila de `recruiting.employee_files` (el expediente, 106), no la cuenta. Una fila por (empleado,
-- documento): la variante elegida queda guardada aquí.
create table if not exists recruiting.employee_documents (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references recruiting.employee_files(id) on delete cascade,
  template_id      uuid not null references recruiting.document_templates(id) on delete restrict,
  variant_id       uuid references recruiting.document_variants(id) on delete restrict,
  -- Versión de la variante que se mandó (para saber qué papel firmó).
  variant_version  integer,
  -- pending = sin enviar · sent = enviado para firmar · signed = firmado · na = no aplica a esta persona.
  status           text not null default 'pending' check (status in ('pending', 'sent', 'signed', 'na')),
  signed_file_path text,
  signed_file_name text,
  notes            text,
  -- Campos del documento confirmados por RR. HH. («Information is correct»): { "<id del campo>": "valor" }.
  -- Se reusan al reimprimir la MISMA versión de la variante (variant_version).
  field_values     jsonb not null default '{}'::jsonb,
  reviewed_by      uuid references public.profiles(id),
  reviewed_at      timestamptz,
  -- Quién y cuándo lo marcó por última vez. por última vez. El nombre se copia (como en el checklist, 275).
  updated_by       uuid references public.profiles(id),
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  unique (employee_id, template_id)
);

create index if not exists employee_documents_by_template on recruiting.employee_documents (template_id);
create index if not exists employee_documents_by_variant on recruiting.employee_documents (variant_id);

comment on table recruiting.employee_documents is
  'Estado de cada documento de ingreso para cada empleado, con la variante usada (315). Solo admin y gerente de RR. HH.';

-- ---------------------------------------------------------------------------
-- Quién puede: la misma regla que el expediente (094)
-- ---------------------------------------------------------------------------
alter table recruiting.document_templates         enable row level security;
alter table recruiting.document_variants          enable row level security;
alter table recruiting.document_variant_versions  enable row level security;
alter table recruiting.employee_documents         enable row level security;

drop policy if exists document_templates_read on recruiting.document_templates;
create policy document_templates_read on recruiting.document_templates
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists document_templates_write on recruiting.document_templates;
create policy document_templates_write on recruiting.document_templates
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

drop policy if exists document_variants_read on recruiting.document_variants;
create policy document_variants_read on recruiting.document_variants
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists document_variants_write on recruiting.document_variants;
create policy document_variants_write on recruiting.document_variants
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

drop policy if exists document_variant_versions_read on recruiting.document_variant_versions;
create policy document_variant_versions_read on recruiting.document_variant_versions
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists document_variant_versions_write on recruiting.document_variant_versions;
create policy document_variant_versions_write on recruiting.document_variant_versions
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

drop policy if exists employee_documents_read on recruiting.employee_documents;
create policy employee_documents_read on recruiting.employee_documents
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
drop policy if exists employee_documents_write on recruiting.employee_documents;
create policy employee_documents_write on recruiting.employee_documents
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

grant select, insert, update, delete on recruiting.document_templates         to authenticated;
grant select, insert, update, delete on recruiting.document_variants          to authenticated;
grant select, insert, update, delete on recruiting.document_variant_versions  to authenticated;
grant select, insert, update, delete on recruiting.employee_documents         to authenticated;

-- ---------------------------------------------------------------------------
-- Autocomprobación: el cubo del que dependen las rutas debe existir (096) y ser privado.
-- ---------------------------------------------------------------------------
do $chk$
begin
  if not exists (select 1 from storage.buckets where id = 'hr-docs' and public = false) then
    raise exception '315: falta el cubo privado hr-docs (096)';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('315_plantillas_de_documentos.sql', '8ec970387e69e54172a4bb1a10d3eb1ec689807348df3161b5baa5f4f34bfc06') on conflict (name) do nothing;
