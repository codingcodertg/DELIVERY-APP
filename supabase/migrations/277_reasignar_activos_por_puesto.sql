-- 277: Reasignar activos por puesto, semiautomático (D-936, 2026-11-09).
--
-- Roberto en la junta: hoy la baja libera los activos (company_assets) pero falta poder reasignarlos. Al contratar para un
-- puesto (p. ej. «accounts receivable»: de Maricella que se fue a Christy que entra), quiere reasignar el correo / número /
-- extensión que quedaron libres al nuevo, SUGIRIENDO los activos liberados del mismo puesto.
--
-- Qué hace:
--   1. recruiting.company_assets gana `position` (el puesto al que pertenece el activo, p. ej. «accounts receivable»). Se
--      llena al asignar o reasignar, y sobrevive a la baja: así, cuando entra el relevo del mismo puesto, se puede sugerir.
--   2. El historial (212) acepta un tipo nuevo: `asset_reassigned` (reasignado por puesto). La reasignación la hace solo el
--      admin de RR. HH. (no el gerente); eso lo decide la acción de servidor, como el resto de la baja (D-251).
-- Sin begin/commit propios. Para deshacer: alter table recruiting.company_assets drop column position; y volver a crear
-- hr_history_kind_check con la lista de la 247 (ninguna fila 'asset_reassigned' debe existir antes).

alter table recruiting.company_assets add column if not exists position text;
create index if not exists company_assets_position on recruiting.company_assets (position);

alter table recruiting.hr_history drop constraint if exists hr_history_kind_check;
alter table recruiting.hr_history add constraint hr_history_kind_check check (kind in (
  'employee_deactivated', 'employee_leaving_edited', 'employee_reactivated',
  'hub_access_removed', 'hub_access_restored',
  'asset_created', 'asset_edited', 'asset_deleted', 'asset_assigned', 'asset_released', 'asset_released_on_leaving',
  'asset_backed_up', 'asset_status_changed', 'asset_reassigned',
  'employee_warning', 'employee_reprimand',
  'employee_insubordination', 'employee_zone_infraction', 'employee_positive_observation'
));

do $chk$
declare def text;
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'recruiting' and table_name = 'company_assets' and column_name = 'position') then
    raise exception '277: falta company_assets.position';
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint
    where conrelid = 'recruiting.hr_history'::regclass and conname = 'hr_history_kind_check';
  if def is null or position('asset_reassigned' in def) = 0 then
    raise exception '277: hr_history_kind_check sin asset_reassigned';
  end if;
  if position('employee_positive_observation' in def) = 0 then
    raise exception '277: hr_history_kind_check perdio un tipo de la 247';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('277_reasignar_activos_por_puesto.sql', 'b3a20013dcc4ff43716ac62d53773240c4e953ffc9f968fbed6601960e5baa79') on conflict (name) do nothing;
