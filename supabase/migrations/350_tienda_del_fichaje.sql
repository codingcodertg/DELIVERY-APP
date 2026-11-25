-- ---------------------------------------------------------------------------
-- 350 · Tienda del fichaje: el presencial en VARIAS tiendas elige en cuál ficha
-- ---------------------------------------------------------------------------
-- PEDIDO. El dueño, 2026-11-25, sobre Francis Lestarpe (presencial que trabaja en McAllen, Pharr, Edinburg…):
-- «en el clock in and out no puede elegir la tienda» y «a Francis remuévele el timer, pero él como pasa cambiando
-- puede choose el store en el clock in and out». Hasta ahora la tienda de un presencial en varias tiendas solo se
-- guardaba en las sesiones del cronómetro (316: timetracker.sessions.store_id). Con el cronómetro quitado, el
-- fichaje necesita su propio sitio para la tienda elegida.
--
-- QUÉ AÑADE, y solo esto:
--   · clockin.time_entries.work_store_id uuid, referencia a clockin.job_sites, ON DELETE SET NULL: la tienda que la
--     persona eligió al fichar. Null para todos los demás (y para los fichajes de antes de esta migración).
--   · NO toca clock_in_site_id ni clock_out_site_id: esas son el veredicto de la GEOCERCA (lo que midió el GPS) y no
--     se sobrescriben con una elección. Tampoco toca profile.store_id ni extra_store_ids (ver 316).
--   · Una política RESTRICTIVA de INSERT (entries_tienda_permitida): solo se puede poner una tienda si quien
--     inserta va en varias tiendas (timetracker.employee_settings.multi_store) y la tienda es activa de SU empresa.
--     Es restrictiva a propósito: se suma a las políticas que ya hay, sin reescribirlas.
--   · Un disparador (time_entries_guard_tienda) que impide al EMPLEADO cambiar work_store_id en un fichaje que ya
--     existe. Un cambio de tienda son dos pasos (salida y entrada), nunca una edición. Gerentes y servicio pasan.
--
-- LO QUE SE LEYÓ ANTES DE ESCRIBIR (última definición de cada política y disparador de clockin.time_entries, en las
-- migraciones; se tomó la más nueva):
--   · entries_insert_self        → 318_seguridad_permisos.sql (la más nueva; antes 074/080). NO se reescribe.
--   · entries_update_self_open   → 318_seguridad_permisos.sql. NO se reescribe.
--   · entries_read               → 080_initplan_all_modules.sql. NO se reescribe.
--   · entries_manage             → 080_initplan_all_modules.sql. NO se reescribe.
--   · time_entries_guard_employee_update → clockin.guard_time_entries_employee_update() (318). NO se reescribe: el
--     disparador nuevo es aparte, con su propia función, para no copiar de nuevo la función de 318.
--   · GRANT sobre clockin: ninguno en las migraciones (los privilegios de tabla son los de siempre; la columna nueva los
--     hereda). No hace falta grant ni cambio de RLS para leer o escribir la columna.
--
-- CÓMO LA APP SE COMPORTA SIN ESTA MIGRACIÓN (no aplicada todavía): detecta el error «la columna no existe»
--   (42703 / PGRST204, nombrando work_store_id) y sigue como hoy: sin selector de tienda y sin tienda en el fichaje.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción (como 348).
-- Idempotente: `add column if not exists`, `drop ... if exists` antes de cada create.
-- SIN APLICAR. Hasta que el dueño lo diga, no existe en la base.
--
-- Para deshacer (a mano, en una transacción propia):
--   drop trigger if exists time_entries_guard_tienda on clockin.time_entries;
--   drop function if exists clockin.guard_time_entries_tienda();
--   drop policy if exists "entries_tienda_permitida" on clockin.time_entries;
--   drop index if exists clockin.time_entries_work_store_idx;
--   alter table clockin.time_entries drop column if exists work_store_id;
-- ---------------------------------------------------------------------------

alter table clockin.time_entries
  add column if not exists work_store_id uuid references clockin.job_sites(id) on delete set null;

create index if not exists time_entries_work_store_idx
  on clockin.time_entries (work_store_id) where work_store_id is not null;

-- La tienda solo la pone quien va en varias tiendas, y debe ser activa de la empresa de la persona.
drop policy if exists "entries_tienda_permitida" on clockin.time_entries;
create policy "entries_tienda_permitida" on clockin.time_entries
  as restrictive for insert to public
  with check (
    work_store_id is null
    or (
      exists (
        select 1 from timetracker.employee_settings e
        where e.id = employee_id and e.multi_store
      )
      and exists (
        select 1 from clockin.job_sites j
        where j.id = work_store_id
          and j.company_id = (select clockin.auth_company_id())
          and j.active
      )
    )
  );

-- El empleado no cambia la tienda de un fichaje que ya existe. Sin JWT (cron, consola), gerente o servicio: sí.
create or replace function clockin.guard_time_entries_tienda()
  returns trigger language plpgsql security definer set search_path = clockin, public as $$
begin
  if new.work_store_id is distinct from old.work_store_id then
    if coalesce(auth.role(), '') in ('', 'service_role') or clockin.auth_is_manager() then
      return new;
    end if;
    raise exception 'Only a manager can change the store of a punch';
  end if;
  return new;
end $$;
revoke execute on function clockin.guard_time_entries_tienda() from public, anon;

drop trigger if exists time_entries_guard_tienda on clockin.time_entries;
create trigger time_entries_guard_tienda
  before update on clockin.time_entries
  for each row execute function clockin.guard_time_entries_tienda();
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('350_tienda_del_fichaje.sql', '6b595ff2c414591443a8b9efe70958033b3fc9276cfd9d014d054404de3fa930') on conflict (name) do nothing;
