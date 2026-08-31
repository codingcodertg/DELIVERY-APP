-- 094 · El expediente no es para el reclutador (D-145, corrección de 093)
--
-- La 093 dejó `employee_files` y `employee_docs` bajo `has_recruiting_access()`, que es el
-- guardián del módulo entero. Eso está bien para candidatos y mal para esto: `recruiting_role`
-- tiene tres tramos —admin, manager, recruiter— y un reclutador entra a mover candidatos, no
-- a leer la dirección, el cumpleaños, las amonestaciones y el antidoping de toda la plantilla.
--
-- No se inventa un permiso nuevo (una casilla más en Usuarios que nadie recordaría marcar):
-- se reutiliza el tramo que ya existe. Admin y gerente sí; reclutador no.
--
-- Se cambia la política en vez de filtrar en la aplicación porque el que filtra en la
-- aplicación deja la puerta abierta a quien llame a PostgREST por su cuenta.

drop policy if exists employee_files_read  on recruiting.employee_files;
drop policy if exists employee_files_write on recruiting.employee_files;
drop policy if exists employee_docs_read   on recruiting.employee_docs;
drop policy if exists employee_docs_write  on recruiting.employee_docs;

create policy employee_files_read on recruiting.employee_files
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
create policy employee_files_write on recruiting.employee_files
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

create policy employee_docs_read on recruiting.employee_docs
  for select using ((select public.current_recruiting_role()) in ('admin', 'manager'));
create policy employee_docs_write on recruiting.employee_docs
  for all using ((select public.current_recruiting_role()) in ('admin', 'manager'))
  with check ((select public.current_recruiting_role()) in ('admin', 'manager'));

comment on table recruiting.employee_files is
  'Ficha de RR. HH. por empleado (D-145). Solo admin y gerente de RR. HH. (094).';
comment on table recruiting.employee_docs is
  'Documentos del expediente (D-145). Solo admin y gerente de RR. HH. (094).';
