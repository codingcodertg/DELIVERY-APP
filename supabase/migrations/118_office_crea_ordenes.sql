-- 118 · Office (rol `accounting`) crea, edita, envia y aprueba ordenes en la base, igual que el gerente
--
-- La decision que la acompana es la de la rama `rol-accounting-es-office`, en DECISIONS.md, y el plan en
-- papel es docs/PLAN-118-office-crea-ordenes.md. Se cita la rama y no el numero: el checksum congela este
-- cuerpo.
--
-- EL PEDIDO. El dueno renombro `accounting` a «Office» y pidio que toda la gente de office pueda crear
-- ordenes. La app le da `create` por rol (ROLE_CAPS); sin esta migracion, la base lo rechaza.
--
-- LO QUE HABIA. La `guard_delivery_stage()` vigente es la de la 048: el orquestador lo comprobo en produccion
-- con pg_get_functiondef el 2026-09-17. `accounting` no entra en ninguna de sus ramas: ni al crear (INSERT
-- acaba en 'Only sales, managers or drivers can create orders'), ni al editar en la misma etapa, ni al mover
-- de etapa. O sea que hoy tampoco aprueba ni rechaza en la base, aunque la app le ensena esos botones.
--
-- LO QUE CAMBIA. `accounting` entra en las seis listas donde esta 'manager', y nada mas:
--   1. crear una carga partida (order_suffix) en ready, approved o fulfilling;
--   2. registrar una re-entrega en approved o pending;
--   3. crear en draft, pending o approved;
--   4. editar sin cambiar de etapa, en cualquier etapa;
--   5. enviar, volver a borrador y cancelar (draft y rejected);
--   6. aprobar, rechazar y desbloquear (approved -> pending).
-- Admin, sales, driver, warehouse y logistics no cambian. Los mensajes de error tampoco: el de crear sigue
-- diciendo «managers», la app no lo lee, y cambiar un texto no es parte de esta decision.
--
-- FUERA. `logistics` tiene `approve` en la app y el guard tampoco le deja pasar pending -> approved. Esta
-- migracion no lo toca: es otra decision.
--
-- LA FUNCION SE COPIA DE LA 048, generada por programa, con las seis sustituciones. Deshacerlas devuelve la
-- 048 caracter a caracter, y una prueba lo comprueba. La firma no cambia (un trigger sin argumentos): basta
-- `create or replace`, y `deliveries_guard_stage` sigue apuntando a ella sin recrearlo.

create or replace function public.guard_delivery_stage()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(public.current_user_role(), 'sales');
  old_stage text := case when TG_OP = 'UPDATE' then OLD.stage else null end;
  new_stage text := NEW.stage;
  auto boolean := public.store_auto_approves(NEW.store);
  -- Scratch copy of NEW used to prove that a location-stamp patch changed
  -- nothing else.
  probe public.deliveries%rowtype;
begin
  if auth.uid() is null then return NEW; end if;
  if r = 'admin' then return NEW; end if;

  if TG_OP = 'INSERT' then
    if NEW.order_suffix is not null then
      if r in ('warehouse','driver','logistics','manager','accounting') and new_stage in ('ready','approved','fulfilling') then
        return NEW;
      end if;
      raise exception 'Not allowed to create this split load';
    end if;
    if NEW.redelivery_of is not null then
      if r in ('warehouse','manager','accounting','driver') and new_stage in ('approved','pending') then return NEW; end if;
      raise exception 'Not allowed to log this re-delivery';
    end if;
    if r in ('manager','accounting') then
      if new_stage in ('draft','pending','approved') then return NEW; end if;
      raise exception 'New orders start as draft, pending or approved';
    end if;
    if r in ('sales','driver') then
      if new_stage in ('draft','pending') then return NEW; end if;
      if new_stage = 'approved' and auto then return NEW; end if;  -- auto-approve store
      raise exception 'New orders start as draft or pending';
    end if;
    raise exception 'Only sales, managers or drivers can create orders';
  end if;

  if new_stage is not distinct from old_stage then
    if r in ('sales','driver') and old_stage in ('draft','pending','rejected') then return NEW; end if;
    -- A late GPS fix on the driver's own closed stop: allowed only when the
    -- location stamps are the ONLY difference between the two rows.
    if r = 'driver' and old_stage in ('picked_up','delivered') then
      probe := NEW;
      probe.pickup_lat    := OLD.pickup_lat;
      probe.pickup_lng    := OLD.pickup_lng;
      probe.pickup_gps_at := OLD.pickup_gps_at;
      probe.pod_lat       := OLD.pod_lat;
      probe.pod_lng       := OLD.pod_lng;
      probe.pod_accuracy  := OLD.pod_accuracy;
      probe.updated_at    := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
    if r in ('manager','accounting') then return NEW; end if;
    if r = 'warehouse'  and old_stage in ('approved','fulfilling','ready','picked_up','delivered') then return NEW; end if;
    -- Logistics can dispatch (same-stage edits) any order it can see in Routes
    -- Manager, including ones not yet approved/prepared (draft/pending).
    if r = 'logistics'  and old_stage in ('draft','pending','approved','fulfilling','ready') then return NEW; end if;
    raise exception 'You cannot edit an order in the % stage', old_stage;
  end if;

  if r in ('sales','driver','manager','accounting') then
    if (old_stage = 'draft'    and new_stage = 'pending')
    or (old_stage = 'pending'  and new_stage = 'draft')
    or (old_stage = 'rejected' and new_stage = 'pending')
    or (old_stage = 'draft'    and new_stage = 'canceled')
    or (old_stage = 'rejected' and new_stage = 'canceled')
    or (r in ('sales','driver') and new_stage = 'approved' and old_stage in ('draft','pending') and auto)  -- auto-approve store
    or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then
      return NEW;
    end if;
    if r in ('manager','accounting') then
      if (old_stage = 'pending'  and new_stage = 'approved')
      or (old_stage = 'pending'  and new_stage = 'rejected')
      or (old_stage = 'approved' and new_stage = 'pending') then return NEW; end if;
    end if;
    raise exception '% cannot move an order from % to %', r, old_stage, new_stage;
  elsif r = 'warehouse' then
    if (old_stage = 'approved'   and new_stage = 'fulfilling')
    or (old_stage = 'fulfilling' and new_stage = 'ready')
    or (old_stage = 'ready'      and new_stage = 'picked_up')
    or (old_stage = 'picked_up'  and new_stage = 'delivered')
    or (old_stage = 'ready'      and new_stage = 'fulfilling')
    or (old_stage = 'picked_up'  and new_stage = 'ready')
    or (old_stage = 'delivered'  and new_stage = 'picked_up') then return NEW; end if;
    raise exception 'Warehouse cannot move an order from % to %', old_stage, new_stage;
  end if;

  raise exception 'Not allowed';
end $$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   Volver a aplicar el bloque `create or replace function public.guard_delivery_stage()` de
--   048_driver_late_gps.sql, que es la definicion de produccion antes de esta. Una sola sentencia, sin
--   drop: el trigger no se toca. Las ordenes que office haya creado mientras tanto se quedan como estan.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Contra produccion, dos veces: ANTES de aplicar (la columna accounting, todo bloqueado) y con la 118
-- aplicada DENTRO de la misma transaccion (accounting igual que manager). La matriz esperada, rol por rol,
-- esta en el plan. Las filas son de ensayo: is_training, y la tienda ENSAYO-118, que no existe en Ajustes y
-- por tanto no se auto-aprueba.
--
--   begin;
--   -- 0. En deliveries no hay mas triggers que estos dos. Un webhook saldria aqui.
--   select tgname from pg_trigger where tgrelid = 'public.deliveries'::regclass and not tgisinternal;
--     -- deliveries_guard_stage, deliveries_touch
--
--   -- 1. Filas de partida, como postgres: auth.uid() es null y el guard deja pasar. Una por etapa.
--   insert into public.deliveries (stage, store, is_training)
--   select e, 'ENSAYO-118', true from unnest(array['draft','pending','approved','rejected','delivered']) e;
--
--   -- 2. Un intento se ejecuta y se deshace SIEMPRE. Cero filas no es un permiso: es «SIN FILAS».
--   create function pg_temp.intenta(sentencia text) returns text language plpgsql as $f$
--   declare n int;
--   begin
--     begin
--       execute sentencia;
--       get diagnostics n = row_count;
--       raise exception 'FILAS:%', n;
--     exception when others then
--       return case when sqlerrm = 'FILAS:0' then 'SIN FILAS (no medido)'
--                   when sqlerrm like 'FILAS:%' then 'PERMITIDO'
--                   else 'BLOQUEADO: ' || sqlerrm end;
--     end;
--   end $f$;
--
--   -- 3. La matriz. El mismo bloque con cada uuid: <uuid-admin>, <uuid-manager>, <uuid-accounting>,
--   --    <uuid-sales>, <uuid-warehouse>, <uuid-driver> y <uuid-logistics>.
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-accounting>","role":"authenticated"}';
--   select a.accion, pg_temp.intenta(a.sentencia) from (values
--     ('crear draft',       $q$insert into public.deliveries (stage, store, is_training) values ('draft','ENSAYO-118',true)$q$),
--     ('crear pending',     $q$insert into public.deliveries (stage, store, is_training) values ('pending','ENSAYO-118',true)$q$),
--     ('crear approved',    $q$insert into public.deliveries (stage, store, is_training) values ('approved','ENSAYO-118',true)$q$),
--     ('editar draft',      $q$update public.deliveries set store = store where store = 'ENSAYO-118' and stage = 'draft'$q$),
--     ('editar approved',   $q$update public.deliveries set store = store where store = 'ENSAYO-118' and stage = 'approved'$q$),
--     ('enviar',            $q$update public.deliveries set stage = 'pending' where store = 'ENSAYO-118' and stage = 'draft'$q$),
--     ('cancelar borrador', $q$update public.deliveries set stage = 'canceled' where store = 'ENSAYO-118' and stage = 'draft'$q$),
--     ('reenviar',          $q$update public.deliveries set stage = 'pending' where store = 'ENSAYO-118' and stage = 'rejected'$q$),
--     ('aprobar',           $q$update public.deliveries set stage = 'approved' where store = 'ENSAYO-118' and stage = 'pending'$q$),
--     ('rechazar',          $q$update public.deliveries set stage = 'rejected' where store = 'ENSAYO-118' and stage = 'pending'$q$),
--     ('desbloquear',       $q$update public.deliveries set stage = 'pending' where store = 'ENSAYO-118' and stage = 'approved'$q$),
--     ('re-entrega',        $q$insert into public.deliveries (stage, store, is_training, redelivery_of) select 'approved', 'ENSAYO-118', true, id from public.deliveries where store = 'ENSAYO-118' and stage = 'delivered'$q$),
--     ('carga partida',     $q$insert into public.deliveries (stage, store, is_training, order_suffix) values ('ready','ENSAYO-118',true,'B')$q$)
--   ) as a(accion, sentencia);
--
--   -- 4. Para el DESPUES: `reset role;`, aplicar este fichero aqui mismo, y repetir el paso 3.
--   reset role;
--   rollback;
--
-- No verificado al escribirlo: que `authenticated` pueda llamar a una funcion de pg_temp creada por
-- postgres en la misma sesion. Si no puede, el mismo cuerpo va en un `do $$ ... $$` por intento, con
-- `raise notice` en vez de `return`.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('118_office_crea_ordenes.sql', 'b9ff6429e12616fa47c55aea8bff0f27d0da266d8ceb487e03fa8b0e6ea2c91d') on conflict (name) do nothing;

