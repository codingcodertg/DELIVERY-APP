-- ---------------------------------------------------------------------------
-- 316 · Time Tracker multitienda: presencial que trabaja en VARIAS tiendas
-- ---------------------------------------------------------------------------
-- PEDIDO. El dueño, sobre Francis Lestarpe (gerente que trabaja en McAllen, Pharr, Edinburg…): «Pásalo a
-- presencial y dale la opción de todas las tiendas para que pueda hacer clock in en cualquier lado». Sin
-- proyecto asignado, sus solicitudes y su cronómetro le daban problemas. Su «proyecto» pasa a ser la tienda
-- donde está HOY, y la sesión queda ligada a esa tienda.
--
-- DOS COLUMNAS, nada más:
--   · timetracker.employee_settings.multi_store : la persona puede elegir CUALQUIER tienda (no solo la suya).
--     Solo tiene efecto con worker_type = 'inhouse'. Lo cambia un admin de Time Tracker en Personas.
--   · timetracker.sessions.store_id            : la tienda en la que se trabajó esa sesión (o solicitud aprobada).
--     Nullable: las sesiones de antes y las de remoto no la tienen. ON DELETE SET NULL: borrar una tienda
--     (job_sites) no borra horas.
--
-- NO se reutiliza clockin.profiles.extra_store_ids: esa columna dice qué tiendas VE un gerente de tienda
-- (visibleStores / canManageEmployee, 089), no dónde puede fichar. Mezclarlas daría a un gerente permisos de
-- gestión que no tiene.
--
-- RLS: no cambia. Las columnas nuevas heredan las políticas de cada tabla (`sessions` y `employee_settings`
-- siguen filtrando por employee_uid / is_timetracker_admin()).
--
-- Para deshacer: alter table timetracker.sessions drop column store_id;
--                alter table timetracker.employee_settings drop column multi_store;
-- ---------------------------------------------------------------------------

alter table timetracker.employee_settings
  add column if not exists multi_store boolean not null default false;

alter table timetracker.sessions
  add column if not exists store_id uuid references clockin.job_sites(id) on delete set null;
