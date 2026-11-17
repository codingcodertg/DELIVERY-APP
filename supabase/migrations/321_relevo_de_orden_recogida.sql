-- ===========================================================================
-- 321 · Relevo de una orden YA RECOGIDA: el paso a nace hecho (entregado en la tienda de relevo)
-- ===========================================================================
-- PEDIDO. El dueño, con la #1629 (FX112): la recogió Steven en RDZ Pharr y la dejó en RDZ McAllen. La quería como
-- transferencia: paso a ya hecho (entregado en la tienda de relevo, con el chofer que la llevaba) y paso b mañana. Hasta
-- hoy se hacía a mano: volver la orden a «listo», activar_relevo y entregar el paso a con una nota.
--
-- QUÉ CAMBIA (dos funciones; ningún dato se toca).
--   · guard_delivery_stage (173): una escritura que activar_relevo marca (rtg.relevo = el número de la orden) sobre una
--     fila de relevo pasa sin comprobar el rol de quien llama. Lo que sí decide es activar_relevo, que ya exige
--     puede_relevo(). Sin esto, logística (que puede planificar) no podía cambiar el paso a de una orden recogida: el guard
--     solo deja a logística tocar órdenes en borrador a listo. El resto del guard es idéntico al de la 173.
--   · activar_relevo (313): acepta también la etapa `picked_up`. Si la madre ya está recogida:
--       - el paso a es la misma fila, con su recogida original (chofer, GPS, salida) y su destino ahora la tienda de
--         relevo; se marca `delivered` con la hora de entrega (pod_delivered_at) y la dirección de la tienda;
--       - el paso b nace como siempre: de la tienda de relevo al destino final, `ready`, sin chofer, el día p_fecha.
--     Para una orden que no está recogida, el resultado es el de la 313.
--   · las notas (order_events) en los dos pasos: «Relevo con el paso a ya hecho: dejado en <tienda> por <chofer>».
-- Deshacer (256) no cambia: un paso ya entregado no se deshace (lo dice `RELEVO_YA_SALIO`).
--
-- Para volver atrás: reejecutar el create or replace de guard_delivery_stage de la 173 y el de activar_relevo de la 313,
-- y quitar la fila del registro: delete from public.schema_migrations where name = '321_relevo_de_orden_recogida.sql';

-- ---------------------------------------------------------------------------
-- 1. guard_delivery_stage: la copia de la 173 con UNA rama nueva (la marca del relevo, al principio)
-- ---------------------------------------------------------------------------
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
  auto boolean := public.store_auto_approves(NEW.store)
                  and not public.account_requires_approval(NEW.account);
  -- Esta escritura mete la orden en 'canceled' ahora mismo (no estaba ya anulada).
  entrando boolean := new_stage = 'canceled'
                      and (TG_OP = 'INSERT' or old_stage is distinct from 'canceled');
  -- Scratch copy of NEW used to prove that a location-stamp patch changed
  -- nothing else.
  probe public.deliveries%rowtype;
begin
  if auth.uid() is null then return NEW; end if;
  -- 321: el relevo de una orden recogida (activar_relevo y deshacer_relevo, que comprueban puede_relevo()) escribe el paso
  -- a y el b con la marca rtg.relevo = el numero de la orden. Solo pasan las filas de relevo marcadas; el resto del guard
  -- sigue igual para todo lo demas.
  if NEW.relay_step is not null and current_setting('rtg.relevo', true) = NEW.order_no::text then return NEW; end if;

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

  -- 142: quien creo la orden es historia. En INSERT lo pone la base (como canceled_by en la 122);
  -- en UPDATE no se reescribe. Sin esto, "solo su propio borrador" en la politica de borrar seria
  -- decoracion: el tramo de misma etapa no mira columnas, asi que ventas podia ponerse como autor
  -- del borrador de otro y despues borrarlo. Va despues de la salida de admin: el admin corrige.
  if TG_OP = 'INSERT' then
    NEW.created_by := auth.uid();
  elsif NEW.created_by is distinct from OLD.created_by then
    raise exception 'Who created an order is history: it cannot be rewritten';
  end if;

  if TG_OP = 'INSERT' then
    if NEW.order_suffix is not null then
      -- 157: una carga partida AL PLANIFICAR nace en la etapa de su madre, que puede ser 'pending' (el motor rutea
      -- pendientes). Hasta aqui solo nacian en ready/approved/fulfilling (la particion al recoger, 012).
      if r in ('warehouse','driver','logistics','manager','accounting') and new_stage in ('ready','approved','fulfilling','pending') then
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
    -- 125: ventas pone la factura que FALTA en SU orden, y nada mas. La orden es suya (la creo o se
    -- le asigno), la factura estaba vacia y deja de estarlo, y es lo unico que cambia: una copia de
    -- NEW con la factura y el `updated_at` viejos tiene que ser identica a OLD. No sobrescribe una
    -- factura ya puesta ni toca una anulada. PO y estimacion no entran: los captura quien ya edita.
    if r = 'sales'
       and old_stage not in ('draft','rejected','canceled')
       and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())
       and coalesce(btrim(OLD.invoice_num), '') = ''
       and coalesce(btrim(NEW.invoice_num), '') <> '' then
      probe := NEW;
      probe.invoice_num := OLD.invoice_num;
      probe.updated_at  := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
    -- 138: ventas AGREGA material a SU orden ya hecha. Dos cosas y nada mas: facturas NUEVAS en
    -- `invoices_extra` y mas `est_pallets`. Mismo patron que el bloque de arriba (125): se prueba con
    -- una copia de NEW que lo unico que cambio es lo permitido.
    --
    -- Lo estructural se comprueba aqui; la normalizacion de los numeros de factura (espacios, '#',
    -- mayusculas) NO: eso vive en `facturaComparable` en el cliente, y meterla aqui seria una segunda
    -- definicion de "la misma factura" que acabaria discrepando de la primera.
    if r = 'sales'
       and old_stage in ('pending','approved','fulfilling')
       and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())
       -- La lista solo CRECE y lo que ya estaba sigue en su sitio: el prefijo es identico.
       and coalesce(array_length(NEW.invoices_extra, 1), 0) >= coalesce(array_length(OLD.invoices_extra, 1), 0)
       and (NEW.invoices_extra)[1:coalesce(array_length(OLD.invoices_extra, 1), 0)]
           is not distinct from coalesce(OLD.invoices_extra, '{}'::text[])
       -- Tope: una columna de texto libre en la tabla mas leida de la app es donde alguien pega un Excel.
       and coalesce(array_length(NEW.invoices_extra, 1), 0) <= 20
       and not exists (select 1 from unnest(coalesce(NEW.invoices_extra, '{}'::text[])) as x
                        where btrim(x) = '' or length(btrim(x)) > 40)
       -- Los pallets solo SUBEN.
       and coalesce(NEW.est_pallets, 0) >= coalesce(OLD.est_pallets, 0)
       -- Y algo tiene que cambiar: una escritura que no cambia nada no pasa por este permiso.
       and (NEW.invoices_extra is distinct from OLD.invoices_extra
         or NEW.est_pallets     is distinct from OLD.est_pallets) then
      probe := NEW;
      probe.invoices_extra    := OLD.invoices_extra;
      probe.est_pallets       := OLD.est_pallets;
      -- Las duraciones son `pallets x minutos-por-pallet` y se recalculan en la MISMA escritura: si no
      -- se dejaran cambiar, el plan de ruta se quedaria con los tiempos de antes.
      probe.pickup_duration   := OLD.pickup_duration;
      probe.delivery_duration := OLD.delivery_duration;
      probe.updated_at        := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
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
    -- 169: el chofer, en SU orden (asignada a su nombre) desde que esta aprobada, guarda las fotos del material
    -- (`photos` + `photo_meta`, quien tomo cada una) y las marcas de salida y llegada (`departed_at`, `arrived_at`),
    -- sin tocar nada mas y sin cambiar de etapa. Antes la base le contestaba "You cannot edit an order in the % stage".
    -- `assigned_driver` es el NOMBRE del chofer (texto), como en la clausula 168 de abajo.
    if r = 'driver' and old_stage in ('approved','fulfilling','ready','picked_up','delivered')
       and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()) then
      probe := NEW;
      probe.photos      := OLD.photos;
      probe.photo_meta  := OLD.photo_meta;
      probe.departed_at := OLD.departed_at;
      probe.arrived_at  := OLD.arrived_at;
      probe.updated_at  := OLD.updated_at;
      if probe is not distinct from OLD then return NEW; end if;
    end if;
    -- 173: «📅 Reprogramar» por la funcion `reprogramar_orden` (de la misma migracion). La funcion comprueba quien y en
    -- que etapa, y marca ESTA orden en `rtg.reprogramar_orden` (set_config local a la transaccion) justo antes de su
    -- UPDATE. Aqui solo pasa esa escritura si lo UNICO que cambia es `delivery_date` (mismo patron que 125/138/169).
    -- Asi ventas mueve la fecha de SU orden aprobada o lista, con nota, sin poder tocar nada mas.
    if current_setting('rtg.reprogramar_orden', true) = OLD.id::text then
      probe := NEW;
      probe.delivery_date := OLD.delivery_date;
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
    or (r in ('sales','driver') and new_stage = 'approved' and old_stage in ('draft','pending','rejected') and auto)  -- auto-approve store (127: tambien al reenviar una rechazada)
    or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')
    -- 168: el chofer recoge SU orden aunque el almacen no la haya marcado lista (approved/fulfilling), con una nota que
    -- deja la app en el evento. `assigned_driver` es el NOMBRE del chofer (texto), no su id: se compara con el
    -- full_name de quien escribe, igual que la politica de lectura (011, 083, 131).
    or (r = 'driver' and old_stage in ('approved','fulfilling') and new_stage = 'picked_up'
        and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then
      return NEW;
    end if;
    if r in ('manager','accounting') then
      if (old_stage = 'pending'  and new_stage = 'approved')
      -- 127: quien aprueba puede enviar SU borrador (o reenviar una rechazada) ya aprobado, igual que ya puede CREARLA aprobada.
      or (old_stage in ('draft','rejected') and new_stage = 'approved')
      or (old_stage = 'pending'  and new_stage = 'rejected')
      or (old_stage = 'approved' and new_stage = 'pending') then return NEW; end if;
      -- 139: office y gerente entregan de inmediato y deshacen un paso. El motivo va en la nota del
      -- evento (order_events), no en una columna: aqui no hay nada que comprobar salvo el salto.
      -- ENTREGAR YA: el cliente se llevo el material, o el chofer entrego y no lo marco. Desde
      -- 'approved' tambien, porque una orden que nunca paso por almacen es justo el caso del
      -- mostrador. No hay firma ni GPS: el historial dice quien lo hizo.
      if new_stage = 'delivered' and old_stage in ('approved','fulfilling','ready','picked_up') then return NEW; end if;
      -- DESHACER UN PASO, y solo uno: asi el historial dice por donde volvio. 'approved' -> 'pending'
      -- ya estaba arriba. Una anulada no vuelve por aqui (la 122 manda) y una entregada vuelve a
      -- 'picked_up', que es de donde salio; lo que se firmo NO se borra.
      if (old_stage = 'delivered'  and new_stage = 'picked_up')
      or (old_stage = 'picked_up'  and new_stage = 'ready')
      or (old_stage = 'ready'      and new_stage = 'fulfilling')
      or (old_stage = 'fulfilling' and new_stage = 'approved') then return NEW; end if;
      -- 145: EL GERENTE HACE EL PROCESO DE BODEGA, paso a paso y hacia delante, como almacen y en
      -- cualquier tienda que vea (el entregar ya de arriba tampoco mira la tienda). Solo el gerente:
      -- el dueno lo pidio para el Office Manager. picked_up -> delivered ya lo tiene arriba.
      if r = 'manager'
         and ((old_stage = 'approved'   and new_stage = 'fulfilling')
           or (old_stage = 'fulfilling' and new_stage = 'ready')
           or (old_stage = 'ready'      and new_stage = 'picked_up')) then return NEW; end if;
    end if;
    raise exception '% cannot move an order from % to %', r, old_stage, new_stage;
  elsif r = 'warehouse' then
    -- Hacia delante, en cualquier tienda: identico a la 139.
    -- picked_up -> ready se queda aqui, tambien sin tienda: es la vuelta del chofer y "Dejar en
    -- tienda" (D-224), que almacen hace como chofer y que cambia la tienda en la misma escritura.
    if (old_stage = 'approved'   and new_stage = 'fulfilling')
    or (old_stage = 'fulfilling' and new_stage = 'ready')
    or (old_stage = 'ready'      and new_stage = 'picked_up')
    or (old_stage = 'picked_up'  and new_stage = 'delivered')
    or (old_stage = 'picked_up'  and new_stage = 'ready') then return NEW; end if;
    -- 142: DESHACER UN PASO, y solo en ordenes de sus tiendas (la suya y su grupo, D-293).
    -- delivered->picked_up y ready->fulfilling ya los tenia (138/139) en cualquier tienda; se
    -- acotan. fulfilling->approved es nuevo. approved->pending NO: es de quien aprueba. Se mira la
    -- orden como ESTABA (OLD): la tienda que ponga la misma escritura no cuenta.
    if ((old_stage = 'delivered'  and new_stage = 'picked_up')
     or (old_stage = 'ready'      and new_stage = 'fulfilling')
     or (old_stage = 'fulfilling' and new_stage = 'approved')) then
      if public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address) then
        return NEW;
      end if;
      raise exception 'Warehouse can only undo a step on orders of its own store';
    end if;
    raise exception 'Warehouse cannot move an order from % to %', old_stage, new_stage;
  end if;

  raise exception 'Not allowed';
end $function$
;

-- ---------------------------------------------------------------------------
-- 2. activar_relevo: también con la orden ya recogida (313 + etapa picked_up)
-- ---------------------------------------------------------------------------
create or replace function public.activar_relevo(p_id uuid, p_tienda text, p_fecha date)
  returns uuid language plpgsql set search_path = public as $$
declare
  madre     public.deliveries%rowtype;
  tienda    jsonb;
  hoy       date := (now() at time zone 'America/Chicago')::date;
  nueva_id  uuid := gen_random_uuid();
  fila      jsonb;
  etiqueta  text;
  ya_salio  boolean;
  nota_ya   text;
  n         integer;
begin
  if auth.uid() is null or not public.puede_relevo() then
    raise exception 'RELEVO_FORBIDDEN: only route planners or an admin set up a relay transfer' using errcode = '42501';
  end if;
  select * into madre from public.deliveries d where d.id = p_id for update;
  if not found then raise exception 'RELEVO_NOT_FOUND: %', p_id; end if;

  if madre.relay_step is not null or madre.order_suffix is not null
     or exists (select 1 from public.deliveries d
                 where d.order_no = madre.order_no and d.is_training = madre.is_training and d.id <> madre.id) then
    raise exception 'RELEVO_NO_APLICA: #% already is a relay transfer or is split into loads', madre.order_no;
  end if;
  -- 321: también ya recogida (picked_up): el paso a nace entregado en la tienda de relevo.
  if madre.stage not in ('approved', 'fulfilling', 'ready', 'picked_up') then
    raise exception 'RELEVO_STAGE: a relay is set up on an approved order that has not been delivered (it is %)', madre.stage;
  end if;
  ya_salio := madre.stage = 'picked_up';

  -- Cualquier tipo de orden (312): la tienda de relevo tiene que ser de Ajustes, y OTRA distinta del origen y del destino.
  select s into tienda from public.settings, jsonb_array_elements(coalesce(stores, '[]'::jsonb)) s
   where public.relevo_norm(s->>'name') = public.relevo_norm(p_tienda) limit 1;
  if tienda is null or public.relevo_norm(p_tienda) = ''
     or public.relevo_norm(p_tienda) in (public.relevo_norm(madre.pickup_name), public.relevo_norm(madre.delivery_name), public.relevo_norm(madre.store)) then
    raise exception 'RELEVO_TIENDA: the relay store must be a store from Settings other than the origin and the destination (got %)', coalesce(p_tienda, '');
  end if;

  -- El dia del paso b: el mismo que el a o cualquiera posterior; nunca en el pasado.
  if p_fecha is null or p_fecha < greatest(hoy, coalesce(madre.delivery_date, hoy)) then
    raise exception 'RELEVO_FECHA: step b cannot be picked up before today or before step a''s day (got %)', p_fecha;
  end if;

  etiqueta := coalesce(madre.order_code, madre.order_no::text);
  nota_ya  := format('Relevo con el paso a ya hecho: dejado en %s por %s', tienda->>'name', coalesce(madre.assigned_driver, '?'));
  perform set_config('rtg.relevo', madre.order_no::text, true);

  -- El paso a: la misma fila, con la tienda de relevo como destino (su tipo de orden no cambia). Si la orden ya salio
  -- con el chofer, el paso a nace ENTREGADO en la tienda de relevo: su recogida, su chofer y su salida se quedan como estaban.
  update public.deliveries
     set order_suffix        = 'a',
         relay_step          = 1,
         delivery_name       = tienda->>'name',
         delivery_address    = tienda->>'address',
         delivery_lat        = nullif(tienda->>'lat', '')::double precision,
         delivery_lng        = nullif(tienda->>'lng', '')::double precision,
         delivery_pin_source = case when nullif(tienda->>'lat', '') is not null and nullif(tienda->>'lng', '') is not null then 'geocoded' else null end,
         route_miles = null, route_duration = null, route_provider = null, route_traffic = null,
         stage               = case when ya_salio then 'delivered' else stage end,
         pod_delivered_at    = case when ya_salio then now() else pod_delivered_at end,
         delivered_address   = case when ya_salio then tienda->>'address' else delivered_address end
   where id = p_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RELEVO_UNSEEN: step a could not be written'; end if;

  -- El paso b: copia de la madre COMO ESTABA (su destino es el final: el cliente, si la orden es de cliente), con lo suyo.
  -- La misma lista de columnas propias que una carga partida (157), mas las del relevo: recogida, dia, chofer, tarifa y la ruta.
  fila := to_jsonb(madre)
    || jsonb_build_object(
      'id', nueva_id, 'order_suffix', 'b', 'relay_step', 2, 'stage', 'ready',
      'pickup_name', tienda->>'name', 'pickup_address', tienda->>'address', 'pickup_point_lat', null, 'pickup_point_lng', null,
      'delivery_date', p_fecha, 'assigned_driver', null, 'delivery_fee', null, 'morning_priority', false,
      'route_seq', null, 'pickup_seq', null, 'load_no', null, 'load_auto', false,
      'route_miles', null, 'route_duration', null, 'route_provider', null, 'route_traffic', null)
    || jsonb_build_object(
      'created_at', now(), 'updated_at', now(), 'created_by', auth.uid(),
      'pickup_lat', null, 'pickup_lng', null, 'pickup_gps_at', null, 'departed_at', null, 'arrived_at', null,
      'pod_received_by', null, 'pod_signature', null, 'pod_delivered_at', null, 'pod_lat', null, 'pod_lng', null, 'pod_accuracy', null,
      'photos', null, 'photo_meta', null, 'delivered_address', null, 'csat_rating', null, 'csat_comment', null,
      'delivery_notes', concat_ws(E'\n', madre.delivery_notes, format('Relay transfer Tr-%s-b: %s -> %s.', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'))));
  insert into public.deliveries select * from jsonb_populate_record(null::public.deliveries, fila);

  perform set_config('rtg.relevo', '', true);

  insert into public.order_events (delivery_id, kind, note, created_by) values
    (p_id,     'edited',  format('Relay transfer set up: this order is now step Tr-%s-a (%s -> %s); step Tr-%s-b (%s -> %s) is picked up on %s', etiqueta, coalesce(madre.pickup_name, '?'), tienda->>'name', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), p_fecha), auth.uid()),
    (nueva_id, 'created', case when ya_salio then nota_ya
                              else format('Relay transfer step Tr-%s-b: %s -> %s, pickup day %s. It can be picked up once Tr-%s-a is delivered at %s', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), p_fecha, etiqueta, tienda->>'name') end, auth.uid());
  if ya_salio then
    insert into public.order_events (delivery_id, kind, note, created_by) values (p_id, 'delivered', nota_ya, auth.uid());
  end if;
  return nueva_id;
end $$;
revoke execute on function public.activar_relevo(uuid, text, date) from public, anon;
grant execute on function public.activar_relevo(uuid, text, date) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.activar_relevo(uuid,text,date)'::regprocedure);
  if position('RELEVO_TIENDA' in f) = 0 or position('RELEVO_FECHA' in f) = 0 then
    raise exception '321: activar_relevo debe conservar las comprobaciones de tienda de relevo y de dia';
  end if;
  if position('picked_up' in f) = 0 or position('pod_delivered_at' in f) = 0 then
    raise exception '321: activar_relevo no tiene la rama de la orden ya recogida';
  end if;
  f := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  if position('rtg.relevo' in f) = 0 then
    raise exception '321: guard_delivery_stage no deja pasar el paso de relevo marcado';
  end if;
  if position('rtg.reprogramar_orden' in f) = 0 or position('You cannot edit an order in the % stage' in f) = 0
     or position('Warehouse can only undo a step' in f) = 0 then
    raise exception '321: al guard le falta algo de la 173';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '321: falta el disparador deliveries_guard_stage';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('321_relevo_de_orden_recogida.sql', '827173bb2b42631a22c843cc798d3f383c7a506ff92a12df21cb6317dfbe3bb4') on conflict (name) do nothing;
