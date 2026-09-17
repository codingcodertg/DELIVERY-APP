-- 122 · Anular una orden deja motivo, quien y cuando; una entregada no se anula
--
-- Pedido del dueno, 2026-09-17: «agrega una opcion para anular ordenes y deben dejar razon por que la
-- anularon, ya sea duplicacion, o cliente cancelo, o cliente recogera en tienda». Preguntado despues:
-- una orden ENTREGADA no se anula, ni siquiera el admin.
--
-- Lo que habia (medido el 2026-09-17): la ficha ya ensenaba un selector de motivo, pero la lista de
-- motivos vivia fija en el codigo (OrderModal.tsx) y el motivo NO se guardaba en ninguna columna — solo
-- viajaba como nota del evento de etapa, y ademas se guardaba la etiqueta TRADUCIDA, asi que la misma
-- causa quedaba escrita en dos idiomas segun quien anulara. Y el boton de anular en bloque de la lista
-- no mandaba motivo ninguno.
--
-- Esta migracion hace tres cosas:
--   1. Cuatro columnas en deliveries: el motivo (una CLAVE estable, no texto traducido), su texto libre
--      cuando la clave es 'other', y quien/cuando.
--   2. El guard rechaza dejar una orden en 'canceled' sin motivo, y estampa el quien/cuando el mismo,
--      para que no dependa de lo que mande el cliente.
--   3. Dos invariantes que van ANTES de la salida temprana de admin, porque son de la orden y no
--      permisos de un rol: una entregada no se anula, y un motivo escrito no se reescribe (patron de
--      la 120 con las solicitudes de ayuda).
--
-- Y abre etapas: gerente y office pueden anular desde pending, approved, fulfilling y ready, que es el
-- caso del dueno (el cliente llama y cancela, o pasara a recoger). Ventas y chofer siguen solo con
-- draft y rejected. Logistica no anula. picked_up solo el admin. delivered, nadie.
--
-- Parte de la definicion VIGENTE del guard, la de la 118, leida del repo el 2026-09-17. Lo unico que
-- cambia dentro de lo que ya habia es la rama nueva de gerente/office en los cambios de etapa; el resto
-- del cuerpo esta copiado tal cual.
--
-- Reversion: al final del fichero, comentada.

-- ---- 1. Las columnas -------------------------------------------------------
alter table public.deliveries
  add column if not exists canceled_reason      text,
  add column if not exists canceled_reason_note text,
  add column if not exists canceled_by          uuid references public.profiles(id) on delete set null,
  add column if not exists canceled_at          timestamptz;

comment on column public.deliveries.canceled_reason is
  'Clave estable del motivo de anulacion (settings.cancel_reasons). NUNCA la etiqueta traducida: la pantalla traduce la clave. 122';
comment on column public.deliveries.canceled_reason_note is
  'Texto libre, obligatorio cuando la clave es other. 122';

-- ---- 2. El guard -----------------------------------------------------------
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
  -- Esta escritura mete la orden en 'canceled' ahora mismo (no estaba ya anulada).
  entrando boolean := new_stage = 'canceled'
                      and (TG_OP = 'INSERT' or old_stage is distinct from 'canceled');
  -- Scratch copy of NEW used to prove that a location-stamp patch changed
  -- nothing else.
  probe public.deliveries%rowtype;
begin
  if auth.uid() is null then return NEW; end if;

  -- ---- Invariantes de la anulacion (122) ----
  -- Van antes de la salida de admin A PROPOSITO: no son permisos de un rol, son cosas que no pasan.
  -- El admin se salta los permisos; no se salta que una entrega hecha salga del computo.
  if TG_OP = 'UPDATE' and old_stage = 'delivered' and new_stage = 'canceled' then
    raise exception 'A delivered order is not canceled: log a re-delivery or a note instead';
  end if;

  if entrando then
    if coalesce(btrim(NEW.canceled_reason), '') = '' then
      raise exception 'A canceled order needs a reason';
    end if;
    -- La unica clave que la base conoce por su nombre: la sembrada para «otro», que la pantalla de
    -- Datos no deja borrar. Cualquier otra clave la decide el admin y aqui da igual cual sea.
    if NEW.canceled_reason = 'other' and coalesce(btrim(NEW.canceled_reason_note), '') = '' then
      raise exception 'The other cancellation reason needs its free text';
    end if;
    -- Quien y cuando los pone la base, no el cliente.
    NEW.canceled_by := auth.uid();
    NEW.canceled_at := now();
  end if;

  -- El motivo es historia: escrito una vez, no se reescribe. Se exceptua `entrando`, que es una
  -- anulacion nueva de una orden que un admin habia revivido; esa deja su motivo nuevo, y las dos
  -- vueltas quedan en order_events.
  if TG_OP = 'UPDATE' and not entrando and OLD.canceled_reason is not null
     and (NEW.canceled_reason      is distinct from OLD.canceled_reason
       or NEW.canceled_reason_note is distinct from OLD.canceled_reason_note
       or NEW.canceled_by          is distinct from OLD.canceled_by
       or NEW.canceled_at          is distinct from OLD.canceled_at) then
    raise exception 'A cancellation reason is history: it cannot be rewritten';
  end if;

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
    -- 122: gerente y office anulan una orden viva; el motivo lo exige el bloque de arriba.
    or (r in ('manager','accounting') and new_stage = 'canceled' and old_stage in ('pending','approved','fulfilling','ready'))
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
-- Comprobacion con ROLLBACK, por rol. La corre el orquestador ANTES de aplicar; cada bloque va en su
-- propia transaccion y termina en rollback, asi que no deja nada escrito. `set local role` no basta:
-- el guard lee `auth.uid()` y `public.current_user_role()`, asi que hay que suplantar al usuario de
-- verdad con `set local request.jwt.claims`.
--
-- Lo que tiene que pasar, etapa a etapa (X = permitido, · = rechazado):
--
--   desde \ rol      admin   gerente/office   ventas/chofer   almacen   logistica
--   draft              X           X                X            ·          ·
--   rejected           X           X                X            ·          ·
--   pending            X           X                ·            ·          ·
--   approved           X           X                ·            ·          ·
--   fulfilling         X           X                ·            ·          ·
--   ready              X           X                ·            ·          ·
--   picked_up          X           ·                ·            ·          ·
--   delivered          ·           ·                ·            ·          ·
--
-- Y ademas, para cualquiera de los que pueden:
--   * sin canceled_reason  -> 'A canceled order needs a reason'
--   * canceled_reason='other' sin texto -> 'The other cancellation reason needs its free text'
--   * canceled_by / canceled_at los pone la base aunque el cliente mande otros
--   * reescribir el motivo de una ya anulada -> 'A cancellation reason is history'
--
-- begin;
--   set local request.jwt.claims = '{"sub":"<uuid del gerente>","role":"authenticated"}';
--   -- 1. Anular una aprobada, con motivo: debe PASAR y estampar quien/cuando.
--   update public.deliveries set stage='canceled', canceled_reason='customer_canceled'
--     where id='<uuid de una orden approved>';
--   select stage, canceled_reason, canceled_by, canceled_at from public.deliveries where id='<misma>';
--   -- 2. Sin motivo: debe FALLAR.
--   update public.deliveries set stage='canceled' where id='<uuid de otra approved>';
--   -- 3. Reescribir el motivo de la que acabo de anular: debe FALLAR.
--   update public.deliveries set canceled_reason='duplicate' where id='<la del punto 1>';
-- rollback;
--
-- begin;
--   set local request.jwt.claims = '{"sub":"<uuid del admin>","role":"authenticated"}';
--   -- 4. Entregada -> anulada: debe FALLAR tambien para el admin.
--   update public.deliveries set stage='canceled', canceled_reason='duplicate'
--     where id='<uuid de una orden delivered>';
-- rollback;
--
-- begin;
--   set local request.jwt.claims = '{"sub":"<uuid de un vendedor>","role":"authenticated"}';
--   -- 5. Ventas anulando una aprobada: debe FALLAR ('sales cannot move an order from approved to canceled').
--   update public.deliveries set stage='canceled', canceled_reason='duplicate'
--     where id='<uuid de una orden approved>';
-- rollback;
--
-- ===========================================================================
-- Reversion (deja las columnas, que ya tendrian datos; vuelve el guard de la 118):
--   Re-ejecutar el bloque `create or replace function public.guard_delivery_stage()` de
--   118_guard_office_como_manager.sql tal cual. Las columnas se quedan: borrarlas perderia el motivo de
--   las ordenes ya anuladas, y una columna de mas no molesta a nadie.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('122_anular_con_motivo.sql', 'b0750640f649ec2e9cebbbdfc13c6e8f56ce6e4246c51280c7dbb1275bb3c6d9') on conflict (name) do nothing;
