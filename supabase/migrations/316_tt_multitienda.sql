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

-- Solo un admin del Time Tracker cambia «Cualquier tienda» (revisión de seguridad): mismo guardia que «active».
create or replace function timetracker.guard_employee_settings_privilege_columns()
  returns trigger language plpgsql security definer set search_path = timetracker, public as $$
begin
  if not public.is_timetracker_admin() then
    if tg_op = 'INSERT' then
      new.multi_store := false;
    else
      if new.active is distinct from old.active then
        raise exception 'Only a timetracker admin can change active status';
      end if;
      if new.multi_store is distinct from old.multi_store then
        raise exception 'Only a timetracker admin can change multi-store';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tt_guard_employee_settings_privilege on timetracker.employee_settings;
create trigger tt_guard_employee_settings_privilege before insert or update on timetracker.employee_settings
  for each row execute function timetracker.guard_employee_settings_privilege_columns();

-- La tienda de una sesión solo la pone quien tiene «Cualquier tienda» (o un admin), y debe ser una tienda activa.
create or replace function timetracker.guard_session_store()
  returns trigger language plpgsql security definer set search_path = timetracker, public as $$
begin
  if new.store_id is not null and (tg_op = 'INSERT' or new.store_id is distinct from old.store_id) then
    if not exists (select 1 from clockin.job_sites j where j.id = new.store_id and j.active) then
      raise exception 'Store is not active';
    end if;
    if not public.is_timetracker_admin()
       and not exists (select 1 from timetracker.employee_settings e where e.id = new.employee_uid and e.multi_store) then
      raise exception 'Only multi-store employees can set a store on a session';
    end if;
  end if;
  return new;
end $$;
revoke execute on function timetracker.guard_session_store() from public, anon;
drop trigger if exists tt_guard_session_store on timetracker.sessions;
create trigger tt_guard_session_store before insert or update on timetracker.sessions
  for each row execute function timetracker.guard_session_store();
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('316_tt_multitienda.sql', '015fc85ef5698cd3cd95312b44d587a4f447daaf21fc62c736c5037aa0e80792') on conflict (name) do nothing;
