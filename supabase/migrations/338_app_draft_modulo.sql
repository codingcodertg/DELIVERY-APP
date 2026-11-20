-- 338 · App Draft: la palabra del módulo en profiles_module_access_known.
--
-- App Draft (/app-draft) es el borrador donde el dueño le enseña al gerente funciones de prueba con datos de muestra.
-- El admin entra siempre; para dárselo a alguien más hay que marcar 'app_draft' en Usuarios, y el check de la 247 lo
-- rechazaba. Aquí solo se vuelve a crear el check con la lista de la 247 más 'app_draft'. No hay tablas ni funciones.
--
-- Vuelta atrás:
--   update public.profiles set module_access = array_remove(module_access, 'app_draft') where 'app_draft' = any(module_access);
--   y volver a crear profiles_module_access_known con la lista de la 247;
--   delete from public.schema_migrations where name = '338_app_draft_modulo.sql';

alter table public.profiles drop constraint if exists profiles_module_access_known;
alter table public.profiles add constraint profiles_module_access_known
  check (module_access is null or module_access <@ array['deliveries','recruiting','timetracker','erp','promos','estimator','surveys','leads','customers','warehouse_ops','app_draft'])
  not valid;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('338_app_draft_modulo.sql', '3e817cee53a9b2ad80139053460f798fbc61e65016de0dc0499dab1f0150a0fb') on conflict (name) do nothing;
