-- 118 · Office (rol accounting) crea, edita y aprueba ordenes igual que el gerente
--
-- Pedido del dueno, 2026-09-17: «all office people need to have the option to create new orders» y
-- «change accounting to office». La app ya ensenaba «+ Nueva orden» a esas cuentas (permiso create) y la
-- base lo rechazaba: «Only sales, managers or drivers can create orders» (captura de Carlos Fuentes).
--
-- Parte de la definicion VIGENTE, leida de produccion con pg_get_functiondef el 2026-09-17 (identica a
-- la 048). El UNICO cambio es anadir 'accounting' en cada rama donde esta 'manager':
--   * INSERT: resto de carga dividida, re-entrega, y nueva orden en draft/pending/approved;
--   * UPDATE misma etapa: editar en cualquier etapa;
--   * cambios de etapa: enviar, volver a borrador, cancelar, aprobar, rechazar, desaprobar.
-- Y el texto del error de alta nombra a office. Nada mas cambia; el trigger no se toca.
--
-- Reversion: re-ejecutar la definicion de la 048 (guard_delivery_stage) tal cual.

create or replace function public.guard_delivery_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'Only sales, office, managers or drivers can create orders';
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
end $function$

;

-- ===========================================================================
-- Comprobacion con ROLLBACK (por rol): la hace el orquestador antes de aplicar; ver la decision.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('118_guard_office_como_manager.sql', '27a36b4a55ed31e83f4ea5524131c6798216b6ebc670ae6f86638916df008d07') on conflict (name) do nothing;
