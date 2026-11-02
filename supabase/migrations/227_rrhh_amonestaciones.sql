-- 227: RR. HH. — amonestaciones en el expediente (D-806, 2026-11-02).
--
-- El dueño, tras Roberto Rodriguez Jr («we can start giving warnings when they don't do their job right»): «let's have
-- the option to admin and manager to give and register warnings in their expedients».
--
-- Que hace: el historial de RR. HH. (recruiting.hr_history, 212) acepta el tipo 'employee_warning'. Quien la da, cuando,
-- el motivo (reason) y la nota (detail) van en la misma fila que todo lo demas; las politicas de la 212 ya dejan insertar
-- y leer al admin y al gerente de RR. HH. (current_recruiting_role in admin, manager), que es justo lo pedido.
--
-- Sin begin/commit propios. Para deshacer: volver a crear hr_history_kind_check con la lista de la 212 (ninguna fila
-- quedaria huerfana si antes se borran las de kind = 'employee_warning'); borrar la fila del registro.
alter table recruiting.hr_history drop constraint if exists hr_history_kind_check;
alter table recruiting.hr_history add constraint hr_history_kind_check check (kind in (
  'employee_deactivated', 'employee_leaving_edited', 'employee_reactivated',
  'hub_access_removed', 'hub_access_restored',
  'asset_created', 'asset_edited', 'asset_deleted', 'asset_assigned', 'asset_released', 'asset_released_on_leaving',
  'asset_backed_up', 'asset_status_changed',
  'employee_warning'
));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conrelid = 'recruiting.hr_history'::regclass and conname = 'hr_history_kind_check';
  if def is null or position('employee_warning' in def) = 0 then raise exception '227: hr_history_kind_check sin employee_warning'; end if;
  if position('asset_status_changed' in def) = 0 then raise exception '227: hr_history_kind_check perdio un tipo de la 212'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'recruiting' and tablename = 'hr_history' and cmd = 'INSERT'
                   and with_check ~ 'manager') then
    raise exception '227: el gerente de RR. HH. no puede insertar en hr_history';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('227_rrhh_amonestaciones.sql', 'f9d3a88604dc72f2c15a8c7939d7eba0a6489f97e538d731283bc16860b3f810') on conflict (name) do nothing;
