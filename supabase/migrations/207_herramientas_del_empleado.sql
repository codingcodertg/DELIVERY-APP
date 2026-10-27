-- ===========================================================================
-- 207 . El expediente lleva las herramientas de cada empleado y lo que cuestan
-- ===========================================================================
-- PEDIDO. El duenio, 2026-10-27, con el archivo «RTG EMAILS»: «quiero que todas las columnas que estan en ese file se
-- agreguen al expediente de employees en el RTG HR app ... incluso hasta el valor que cuesta la anualidad de la licencia
-- ... queremos saber cuanto cuesta tener cada empleado, cuanto se invierte en cada empleado al mes ... un expediente
-- centralizado donde se pueda ver todos los tools que tiene, si tiene los emails, cuanto se esta pagando al anio».
--
-- QUE HACE. Columnas nulas en recruiting.employee_files, sin valor por defecto: ninguna fila cambia. Las de siempre
-- (email, phone, ringcentral_ext, personal_phone, job_title, date_hired) ya existen y se llenan con el archivo; estas son
-- las que faltaban:
--   email_plan            el plan de Microsoft 365 del correo de trabajo («Currently No Email» si no tiene)
--   email_cost_year       lo que cuesta ese correo al anio (USD); con dos correos, la suma
--   email_renewal_date    cuando se renueva
--   second_email          un segundo correo de trabajo (la gerente que ademas tiene uno del grupo)
--   app_username          el usuario del hub cuando no es el correo (los choferes)
--   onepassword           si tiene 1Password: yes / no / maybe
--   previous_phone        el numero de oficina anterior (antes de RingCentral)
--   device_serial         la serie del telefono de escritorio (o «Wireless», o lo que diga el archivo)
--   qb_initials           sus iniciales en QuickBooks
--   remote_pc_name        la PC a la que entra por Remote PC
--   remote_pc_status      el estado de esa clave (DONE / DNE / SWITCH TO SITE ...)
--   rc_user_created       si ya tiene usuario de RingCentral (YES / LATER / RAN OUT OF LICENSES ...)
--   rc_device_assigned    si ya tiene telefono de RingCentral asignado
--   risk_score / performance_score / score_status / score_action   la hoja de puntuacion de RR. HH. (vacia hoy)
--   tools_cost_year       otras herramientas al anio (1Password, RingCentral ... cuando se sepan)
--   tools_note            que herramientas son
--
-- El costo mensual NO se guarda: es (email_cost_year + tools_cost_year) / 12 y lo calcula la pantalla.
--
-- QUE NO TOCA. Ni politicas ni permisos ni public.phone_book(): las columnas heredan las politicas de la 094 (solo
-- admin y gerente de RR. HH.) y el directorio lee columnas con nombre (117), asi que nada de esto sale por el.
--
-- CANDADOS. `add column` sin valor por defecto es instantaneo pero pide ACCESS EXCLUSIVE sobre employee_files.
-- Sin begin/commit propios: se aplica en UNA transaccion.

alter table recruiting.employee_files
  add column if not exists email_plan          text,
  add column if not exists email_cost_year     numeric(10,2),
  add column if not exists email_renewal_date  date,
  add column if not exists second_email        text,
  add column if not exists app_username        text,
  add column if not exists onepassword         text,
  add column if not exists previous_phone      text,
  add column if not exists device_serial       text,
  add column if not exists qb_initials         text,
  add column if not exists remote_pc_name      text,
  add column if not exists remote_pc_status    text,
  add column if not exists rc_user_created     text,
  add column if not exists rc_device_assigned  text,
  add column if not exists risk_score          numeric(6,2),
  add column if not exists performance_score   numeric(6,2),
  add column if not exists score_status        text,
  add column if not exists score_action        text,
  add column if not exists tools_cost_year     numeric(10,2),
  add column if not exists tools_note          text;

alter table recruiting.employee_files
  drop constraint if exists employee_files_onepassword_known;
alter table recruiting.employee_files
  add constraint employee_files_onepassword_known
  check (onepassword is null or onepassword in ('yes', 'no', 'maybe'));

comment on column recruiting.employee_files.email_plan is 'Plan de Microsoft 365 del correo de trabajo (207).';
comment on column recruiting.employee_files.email_cost_year is 'Costo del correo al anio, USD; con dos correos, la suma (207).';
comment on column recruiting.employee_files.tools_cost_year is 'Otras herramientas al anio, USD (207). El costo mensual lo calcula la pantalla.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'recruiting' and table_name = 'employee_files' and column_name = 'tools_note'
  ) then raise exception '207: falta tools_note'; end if;
end $$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('207_herramientas_del_empleado.sql', 'be8ae100b5c3282a68388189d634fefcb2f054665c01a19f57691afcdf4e8c2c') on conflict (name) do nothing;
