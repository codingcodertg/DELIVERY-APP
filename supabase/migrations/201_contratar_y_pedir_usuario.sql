-- ===========================================================================
-- 201 . Contratar desde el candidato y pedir al admin que cree el usuario
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-26: «en candidates tiene que tener un hire button para que el manager o el admin le
-- pongan que ese user fue hired y él mismo puede mandar un request al admin para decir, hey, ya está creado, créale
-- el usuario.»
--
-- QUE HACE:
--   1. recruiting.employee_files.candidate_id: el candidato del que salio el expediente. Sirve para no crear dos
--      expedientes si se pulsa «Hire» dos veces. Se vacia si el candidato se borra.
--   2. recruiting.user_creation_requests: una fila por «créale el usuario». Quien la pide (gerente o admin de RR. HH.)
--      la inserta; solo el admin de RR. HH. la lee y la marca hecha.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: drop table recruiting.user_creation_requests; alter table recruiting.employee_files drop column
-- candidate_id; y borrar la fila del registro.

alter table recruiting.employee_files
  add column if not exists candidate_id uuid references recruiting.candidates(id) on delete set null;
create unique index if not exists employee_files_candidate_id on recruiting.employee_files (candidate_id)
  where candidate_id is not null;

create table if not exists recruiting.user_creation_requests (
  id               uuid primary key default gen_random_uuid(),
  employee_file_id uuid references recruiting.employee_files(id) on delete cascade,
  candidate_id     uuid references recruiting.candidates(id) on delete set null,
  full_name        text not null,
  note             text,
  status           text not null default 'pending' check (status in ('pending', 'done')),
  requested_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_at     timestamptz not null default now(),
  done_by          uuid references public.profiles(id) on delete set null,
  done_at          timestamptz
);
create index if not exists user_creation_requests_pending on recruiting.user_creation_requests (requested_at)
  where status = 'pending';
-- Una sola pendiente por expediente: pulsar dos veces no duplica el aviso.
create unique index if not exists user_creation_requests_one_pending on recruiting.user_creation_requests (employee_file_id)
  where status = 'pending';

alter table recruiting.user_creation_requests enable row level security;

drop policy if exists ucr_insert on recruiting.user_creation_requests;
create policy ucr_insert on recruiting.user_creation_requests for insert to authenticated
  with check ((select public.current_recruiting_role()) in ('admin', 'manager') and requested_by = auth.uid());
drop policy if exists ucr_read on recruiting.user_creation_requests;
create policy ucr_read on recruiting.user_creation_requests for select to authenticated
  using ((select public.current_recruiting_role()) = 'admin');
drop policy if exists ucr_update on recruiting.user_creation_requests;
create policy ucr_update on recruiting.user_creation_requests for update to authenticated
  using ((select public.current_recruiting_role()) = 'admin')
  with check ((select public.current_recruiting_role()) = 'admin');

grant select, insert, update on recruiting.user_creation_requests to authenticated;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('201_contratar_y_pedir_usuario.sql', '089d5bcb93ec18175b5468bf4f16595dbf75f82d1285822a1400dc875251c6e7') on conflict (name) do nothing;
