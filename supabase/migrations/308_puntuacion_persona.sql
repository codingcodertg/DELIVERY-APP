-- ===========================================================================
-- 308 . La puntuacion de RR. HH. gana la columna «Persona» (Person)
-- ===========================================================================
-- PEDIDO. Ayuda de Roberto (RR. HH.): la hoja de puntuacion del expediente tiene Riesgo y Desempeno, pero le falta
-- la columna «Persona» (Person). La deja en blanco en D-xxxx y no hay donde anotarla.
--
-- QUE HACE. Una columna nueva, nula y sin valor por defecto, en recruiting.employee_files: ninguna fila cambia.
--   person_score   la puntuacion «Persona» de la hoja de RR. HH.; se guarda igual que risk_score y performance_score
--
-- El total (Riesgo + Desempeno + Persona) NO se guarda: lo calcula la pantalla con puntuacionTotal().
--
-- QUE NO TOCA. Ni politicas ni permisos: la columna hereda las politicas de la 094 (solo admin y gerente de RR. HH.),
-- igual que las demas columnas de la hoja. Ni public.phone_book() ni la lista de directorio.
--
-- CANDADOS. `add column` sin valor por defecto es instantaneo pero pide ACCESS EXCLUSIVE sobre employee_files.
-- Sin begin/commit propios: se aplica en UNA transaccion.

alter table recruiting.employee_files
  add column if not exists person_score numeric(6,2);

comment on column recruiting.employee_files.person_score is 'Puntuacion «Persona» de la hoja de RR. HH. (308).';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'recruiting' and table_name = 'employee_files' and column_name = 'person_score'
  ) then raise exception '308: falta person_score'; end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('308_puntuacion_persona.sql', 'dffb49cc93e501762e1e1abd2f83902b1d4786cd004ed9942635a34f64194502') on conflict (name) do nothing;
