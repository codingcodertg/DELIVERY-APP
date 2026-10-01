-- 159 · El expediente, con los campos para llenarlo bien: puesto, telefono personal, correo personal,
--       contacto de emergencia, y el motivo de la baja con quien la registro
--
-- La decision que la acompana es la de la rama `feat/expediente-acciones`, en DECISIONS.md. Se cita la
-- rama y no el numero: el checksum congela este cuerpo. Plan: docs/PLAN-159-expediente-campos.md.
--
-- EL PEDIDO. El dueno quiere botones para dar de baja y agregar gente, y «llenar bien el sistema»: telefono
-- de oficina, telefono personal «y eso». La cita literal esta en la decision.
--
-- QUE ANADE. Diez columnas nulas en `recruiting.employee_files`, sin valor por defecto: ninguna fila cambia.
--   job_title                 el puesto
--   personal_phone            el telefono PERSONAL. `phone`, que ya existia, queda como el de OFICINA: es el que
--                             ensena `public.phone_book()` a toda la empresa, y eso no cambia.
--   personal_email            el correo personal. `email` sigue siendo el de trabajo (el del directorio).
--   emergency_name / emergency_relation / emergency_phone   a quien llamar
--   left_reason               por que se fue, de una lista corta (el `check` de abajo)
--   left_note                 la nota de la baja
--   left_by                   quien la registro (perfil). `on delete set null`: borrar esa cuenta no borra la baja.
--   left_recorded_at          cuando se registro (no es la fecha de salida: esa es `date_left`, de la 106)
--
-- QUE NO TOCA. Ni una politica, ni un permiso, ni un trigger, ni `public.phone_book()`. Las politicas de la
-- 094 dejan leer y escribir la fila ENTERA a admin y gerente de RR. HH. y a nadie mas; las columnas nuevas
-- heredan eso tal cual. El directorio lee columnas CON NOMBRE (117), asi que el telefono personal y el contacto
-- de emergencia no salen por el. La autocomprobacion del final lo exige.
--
-- EL ESTADO SIGUE SIN GUARDARSE (D-251): se deriva de `date_left`. `left_reason` describe una baja, no la crea.
--
-- CANDADOS. `alter table ... add column` sin valor por defecto es instantaneo, pero pide ACCESS EXCLUSIVE sobre
-- `employee_files` y la FK de `left_by` pide SHARE ROW EXCLUSIVE sobre `profiles`. Conviene
-- `set lock_timeout = '3s'` antes de aplicarla. Sin `begin`/`commit` propios: se aplica en UNA transaccion.

alter table recruiting.employee_files
  add column if not exists job_title          text,
  add column if not exists personal_phone     text,
  add column if not exists personal_email     text,
  add column if not exists emergency_name     text,
  add column if not exists emergency_relation text,
  add column if not exists emergency_phone    text,
  add column if not exists left_reason        text,
  add column if not exists left_note          text,
  add column if not exists left_by            uuid references public.profiles(id) on delete set null,
  add column if not exists left_recorded_at   timestamptz;

-- El motivo, de la lista corta de la pantalla (MOTIVOS_BAJA en src/lib/recruiting/employee-file.ts). Las
-- claves estan en ingles y no se traducen: lo que se traduce es la etiqueta.
alter table recruiting.employee_files
  drop constraint if exists employee_files_left_reason_known;
alter table recruiting.employee_files
  add constraint employee_files_left_reason_known
  check (left_reason in ('resignation', 'termination', 'abandonment', 'contract_end', 'other'));

comment on column recruiting.employee_files.job_title is
  'Puesto (159).';
comment on column recruiting.employee_files.phone is
  'Telefono de OFICINA: el que ensena public.phone_book() a toda la empresa. El personal es personal_phone (159).';
comment on column recruiting.employee_files.personal_phone is
  'Telefono PERSONAL (159). Solo RR. HH.: no sale en el directorio.';
comment on column recruiting.employee_files.personal_email is
  'Correo personal (159). Solo RR. HH. El de trabajo, el del directorio, es email.';
comment on column recruiting.employee_files.emergency_name is
  'Contacto de emergencia: nombre (159). Solo RR. HH.';
comment on column recruiting.employee_files.emergency_relation is
  'Contacto de emergencia: parentesco (159).';
comment on column recruiting.employee_files.emergency_phone is
  'Contacto de emergencia: telefono (159).';
comment on column recruiting.employee_files.left_reason is
  'Motivo de la baja (159): resignation, termination, abandonment, contract_end, other. El estado se sigue derivando de date_left.';
comment on column recruiting.employee_files.left_note is
  'Nota de la baja (159).';
comment on column recruiting.employee_files.left_by is
  'Quien registro la baja (159). on delete set null.';
comment on column recruiting.employee_files.left_recorded_at is
  'Cuando se registro la baja (159). La fecha de salida es date_left.';

-- ===========================================================================
-- Autocomprobacion: si algo no quedo como se dice arriba, la transaccion se cae
-- ===========================================================================
do $comprueba$
declare
  v_n   int;
  v_def text;
begin
  -- Las diez columnas, todas nulas y sin valor por defecto.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'recruiting' and table_name = 'employee_files'
     and column_name in ('job_title', 'personal_phone', 'personal_email', 'emergency_name', 'emergency_relation',
                         'emergency_phone', 'left_reason', 'left_note', 'left_by', 'left_recorded_at')
     and is_nullable = 'YES' and column_default is null;
  if v_n <> 10 then raise exception '159: deberian ser 10 columnas nuevas, nulas y sin default; hay %', v_n; end if;

  -- La FK de quien registro la baja deja la baja en pie si la cuenta se borra.
  select count(*) into v_n
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'recruiting.employee_files'::regclass and c.contype = 'f'
     and a.attname = 'left_by' and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'n';
  if v_n <> 1 then raise exception '159: left_by deberia tener UNA fk a profiles con on delete set null; hay %', v_n; end if;

  -- Las politicas son las de la 094, las dos y nada mas: esta migracion no abre ni cierra nada.
  select count(*) into v_n from pg_policy where polrelid = 'recruiting.employee_files'::regclass;
  if v_n <> 2 then raise exception '159: employee_files deberia seguir con 2 politicas, tiene %', v_n; end if;
  select count(*) into v_n
    from pg_policy
   where polrelid = 'recruiting.employee_files'::regclass
     and polname in ('employee_files_read', 'employee_files_write')
     and pg_get_expr(polqual, polrelid) like '%current_recruiting_role()%'
     and pg_get_expr(polqual, polrelid) like '%admin%'
     and pg_get_expr(polqual, polrelid) like '%manager%'
     and pg_get_expr(polqual, polrelid) not like '%recruiter%';
  if v_n <> 2 then raise exception '159: las politicas de employee_files ya no son las de la 094'; end if;
  if not (select relrowsecurity from pg_class where oid = 'recruiting.employee_files'::regclass) then
    raise exception '159: employee_files se quedo sin RLS';
  end if;

  -- anon no lee la tabla, ni antes ni ahora.
  if has_table_privilege('anon', 'recruiting.employee_files', 'select') then
    raise exception '159: anon puede leer employee_files';
  end if;

  -- El directorio no ensena nada de lo nuevo: sigue leyendo columnas con nombre.
  select pg_get_functiondef('public.phone_book()'::regprocedure) into v_def;
  if v_def like '%personal_phone%' or v_def like '%personal_email%' or v_def like '%emergency_%'
     or v_def like '%left_reason%' or v_def like '%left_note%' then
    raise exception '159: phone_book() nombra una columna privada del expediente';
  end if;
  if v_def not like '%f.date_left is null%' then
    raise exception '159: phone_book() ya no filtra por date_left: una baja saldria en el directorio';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia). BORRA lo que se haya escrito en esas columnas:
-- antes, un `pg_dump` o `create table ... as select id, job_title, ... from recruiting.employee_files`.
-- ===========================================================================
--   alter table recruiting.employee_files drop constraint if exists employee_files_left_reason_known;
--   alter table recruiting.employee_files
--     drop column if exists job_title, drop column if exists personal_phone, drop column if exists personal_email,
--     drop column if exists emergency_name, drop column if exists emergency_relation,
--     drop column if exists emergency_phone, drop column if exists left_reason, drop column if exists left_note,
--     drop column if exists left_by, drop column if exists left_recorded_at;
--   comment on column recruiting.employee_files.phone is null;
--   delete from public.schema_migrations where name = '159_expediente_campos.sql';
-- La app sin la 159: la lista y la ficha siguen (leen con `*`); los campos nuevos salen apagados con «falta la
-- migracion 159», y dar de baja guarda la fecha sin el motivo y lo dice.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('159_expediente_campos.sql', '6f9e6a79d0f5c1ed52f6a5a8a92c38700c10b6b35e94d4256149b37ebde13258') on conflict (name) do nothing;
