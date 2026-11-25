-- ---------------------------------------------------------------------------
-- 351 · Fichar desde el hub (app de escritorio): el interruptor por persona
-- ---------------------------------------------------------------------------
-- PEDIDO. El dueño, 2026-11-25: quien va en oficina y en ventas que tiene la app de escritorio del Hub pueda
-- fichar entrada, almuerzo («Take a break») y salida desde ahí, sin ir a la app de Time Tracker. Es un PILOTO:
-- apagado para todos por defecto, y el dueño lo enciende persona a persona en RR. HH. → «⏱ Time tracking setup».
--
-- QUÉ AÑADE, y solo esto:
--   · timetracker.employee_settings.hub_clock boolean not null default false: true = esta persona ficha, toma el
--     almuerzo y termina el turno desde el hub de escritorio. Sin efecto si no es presencial ni está activa (la
--     comprobación real está en el servidor: src/app/timetracker/clock-in/actions/hub.ts).
--   · La guardia de columnas de privilegio de esa tabla (la que ya protege `multi_store`) cubre también `hub_clock`:
--     solo un admin de Time Tracker lo cambia. Un empleado no puede darse el interruptor a sí mismo.
--
-- LA GUARDIA. La función se RECREA entera con el cuerpo de la 316 (timetracker.guard_employee_settings_privilege_columns,
-- la definición más NUEVA de esa función en las migraciones: 060 la creó, 303 solo cambió permisos, 316 la reescribió y
-- ninguna migración posterior la toca; la 318 define OTRA función, `clockin.guard_employee_settings_privilege_columns`,
-- y no se toca). Sobre esa copia se añaden SOLO estas líneas, y el resto queda byte a byte igual:
--   · en la rama de INSERT: `new.hub_clock := false;` (una ficha nueva nunca nace con el interruptor puesto).
--   · en la rama de UPDATE: el bloque que impide cambiar `hub_clock` sin ser admin.
-- El disparador (tt_guard_employee_settings_privilege) no cambia: ya llama a esta función en insert y update.
-- Los permisos de la función (revoke de public/anon, grant a authenticated y service_role, de la 303) se conservan:
-- CREATE OR REPLACE no los toca.
--
-- COMPROBACIÓN. Al final, un bloque `do` mira el cuerpo que quedó y falla si no contiene cada fragmento distintivo de
-- la 316 ni las líneas nuevas: si alguien vuelve a pegar una copia vieja, la migración se cae en vez de quitar la guardia.
--
-- CÓMO LA APP SE COMPORTA SIN ESTA MIGRACIÓN (no aplicada todavía): el hub lee `hub_clock` y, si la columna no existe
-- (42703 / PGRST204, nombrando `hub_clock`), lo trata como apagado para todos. Nada se rompe, y la pantalla de RR. HH.
-- no enseña el interruptor.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción (como 348 y 350).
-- Idempotente: `add column if not exists` y `create or replace`.
-- SIN APLICAR. Hasta que el dueño lo diga, no existe en la base.
--
-- Para deshacer (a mano, en una transacción propia). EN ESTE ORDEN: primero recrear la función con el cuerpo de la
-- 316 (sin las líneas de hub_clock), y solo después quitar la columna; si se quita la columna antes, la función
-- vieja con esas líneas dejaría de compilar en cada alta y cambio de ficha.
--   alter table timetracker.employee_settings drop column if exists hub_clock;
-- ---------------------------------------------------------------------------

alter table timetracker.employee_settings
  add column if not exists hub_clock boolean not null default false;

comment on column timetracker.employee_settings.hub_clock is 'true = this person clocks in, takes the break and ends the shift from the hub''s desktop app';

create or replace function timetracker.guard_employee_settings_privilege_columns()
  returns trigger language plpgsql security definer set search_path = timetracker, public as $$
begin
  -- Sin JWT (consola, migraciones) o con la llave de servicio también vale: no son un empleado.
  if not public.is_timetracker_admin() and coalesce(auth.role(), '') not in ('', 'service_role') then
    if tg_op = 'INSERT' then
      new.multi_store := false;
      new.hub_clock := false;
    else
      if new.active is distinct from old.active then
        raise exception 'Only a timetracker admin can change active status';
      end if;
      if new.multi_store is distinct from old.multi_store then
        raise exception 'Only a timetracker admin can change multi-store';
      end if;
      if new.hub_clock is distinct from old.hub_clock then
        raise exception 'Only a timetracker admin can change the hub clock-in';
      end if;
    end if;
  end if;
  return new;
end $$;

do $$
declare
  cuerpo text;
  fragmento text;
  distintivos text[] := array[
    'if not public.is_timetracker_admin() and coalesce(auth.role(), '''') not in ('''', ''service_role'') then',
    'new.multi_store := false;',
    'if tg_op = ''INSERT'' then',
    'if new.active is distinct from old.active then',
    'raise exception ''Only a timetracker admin can change active status'';',
    'if new.multi_store is distinct from old.multi_store then',
    'raise exception ''Only a timetracker admin can change multi-store'';',
    'new.hub_clock := false;',
    'if new.hub_clock is distinct from old.hub_clock then',
    'raise exception ''Only a timetracker admin can change the hub clock-in'';'
  ];
begin
  select p.prosrc into cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'timetracker' and p.proname = 'guard_employee_settings_privilege_columns';
  if cuerpo is null then
    raise exception '351: falta timetracker.guard_employee_settings_privilege_columns';
  end if;
  foreach fragmento in array distintivos loop
    if position(fragmento in cuerpo) = 0 then
      raise exception '351: el cuerpo de la guardia no contiene «%» (copia vieja?)', fragmento;
    end if;
  end loop;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('351_fichar_desde_el_hub.sql', '8e7e1e6ee932a8669ebcf7d58a7f95b9188fe8dad85fb9fdb4aac8a316258d83') on conflict (name) do nothing;
