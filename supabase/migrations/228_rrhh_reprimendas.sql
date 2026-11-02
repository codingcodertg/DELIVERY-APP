-- 228: RR. HH. — reprimendas en el expediente, junto a las amonestaciones (D-NEXT, 2026-11-02).
--
-- Roberto Rodriguez Jr, sobre la 227: «there will be a button that says employee actions, and when pressed will say give
-- warning or reprimand an employee, that will go into their expediente». Dos grados: amonestacion (warning) y reprimenda
-- (reprimand), los dos en el historial del expediente (recruiting.hr_history), con quien, cuando, motivo y nota.
--
-- Que hace: el check de kind (212, ampliado en la 227) acepta tambien 'employee_reprimand'. Politicas como la 212:
-- insertan y leen el admin y el gerente de RR. HH.; nadie edita ni borra.
--
-- Sin begin/commit propios. Para deshacer: volver a crear hr_history_kind_check con la lista de la 227 (borrando antes
-- las filas de kind = 'employee_reprimand'); borrar la fila del registro.
alter table recruiting.hr_history drop constraint if exists hr_history_kind_check;
alter table recruiting.hr_history add constraint hr_history_kind_check check (kind in (
  'employee_deactivated', 'employee_leaving_edited', 'employee_reactivated',
  'hub_access_removed', 'hub_access_restored',
  'asset_created', 'asset_edited', 'asset_deleted', 'asset_assigned', 'asset_released', 'asset_released_on_leaving',
  'asset_backed_up', 'asset_status_changed',
  'employee_warning', 'employee_reprimand'
));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conrelid = 'recruiting.hr_history'::regclass and conname = 'hr_history_kind_check';
  if def is null or position('employee_reprimand' in def) = 0 then raise exception '228: hr_history_kind_check sin employee_reprimand'; end if;
  if position('employee_warning' in def) = 0 or position('asset_status_changed' in def) = 0 then raise exception '228: hr_history_kind_check perdio un tipo'; end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('228_rrhh_reprimendas.sql', 'e039eacde09f92b4dc9a30a6d1b99f29ac8c69694dcdb6a6a4cd9102055558a7') on conflict (name) do nothing;
