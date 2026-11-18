-- ===========================================================================
-- 322 · Deshacer el relevo: mientras el paso b no haya salido (la 256 lo dejaba solo con el paso a sin recoger)
-- ===========================================================================
-- PEDIDO. El dueno: quiere poder DESHACER una transferencia por relevo mientras el paso b no haya salido. Con la 256,
-- deshacer se bloqueaba en cuanto el paso a estaba recogido o entregado; ahora la regla es la del paso b.
--
-- REGLA (la decision de esta migracion; `deshacer_relevo` la reemplaza, la firma no cambia):
--   1. Se puede mientras NINGUN paso posterior al a haya salido: ni recogido, ni entregado, ni con la hora de recogida
--      (pickup_gps_at) ni con la de entrega (pod_delivered_at). Si ya salio, error RELEVO_YA_SALIO.
--   2. El paso a vuelve a ser la orden entera, con su DESTINO FINAL (el del ultimo paso). El resto de los pasos se borra.
--   3. Lo que pasa con el paso a depende de en que etapa este:
--        · approved / fulfilling / ready: la orden vuelve tal cual estaba antes del relevo (su origen, su etapa, su chofer).
--          Es el caso normal: nada salio, asi que la orden sigue en la tienda de origen.
--        · picked_up: la orden sigue recogida con su mismo chofer, que ya la lleva; ahora va al destino final.
--        · delivered (entregado en la tienda de relevo): la mercancia ESTA en la tienda de relevo, asi que la orden no
--          puede volver al origen. Vuelve a `ready` con la TIENDA DE RELEVO como origen (pickup_name/pickup_address), sin
--          chofer (assigned_driver nulo), y sin marcas de recogida ni de entrega (pickup_gps_at, pickup_lat/lng,
--          departed_at, arrived_at, pod_delivered_at, delivered_address, pickup_point_lat/lng nulos). La evidencia de la
--          entrega (firma, quien recibio, fotos, coordenadas de la entrega) SE CONSERVA; el historial de la orden tambien.
--      Lo que se pierde es solo la marca de «entregado», que es lo que hay que quitar para que la orden se pueda recoger.
--   4. Las rutas calculadas del paso a se quitan (route_miles, route_duration, route_provider, route_traffic), igual que
--      en la 256: la ruta era del tramo que ya no existe.
--
-- POR QUE SECURITY DEFINER Y POR QUE EL GUARD: el borrado del paso b la politica de la 142 no lo deja a casi nadie, y el
-- UPDATE del paso a pasa por `guard_delivery_stage` (173/321) con el rol de quien llama. La rama nueva de ese guard deja
-- pasar SOLO la escritura de deshacer (marca `rtg.relevo` = el numero de la orden, relay_step de 1 a nulo, y solo las
-- columnas de arriba; la etapa igual o entregado -> listo). Quien puede sigue decidiendose en `puede_relevo()`.
-- `guard_relevo` (256) no cambia: el borrado del paso b y el paso a sin relay_step pasan con la marca.
--
-- Additive: solo se reemplaza `deshacer_relevo` y se AMPLIA `guard_delivery_stage` (copia de la 321 con una rama nueva,
-- como hizo la 321 con la 173). Ningun dato se toca. 256/302/313/321 intactas.
--
-- Para volver atras: reejecutar el create or replace de deshacer_relevo de la 256 y el de guard_delivery_stage de la 321,
-- y quitar la fila del registro: delete from public.schema_migrations where name = '322_deshacer_relevo.sql';

-- ---------------------------------------------------------------------------
-- 1. guard_delivery_stage: la copia de la 321 con UNA rama nueva (deshacer el relevo), justo antes de la salida de admin
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

  -- 321: el paso a de un relevo de una orden YA RECOGIDA (activar_relevo, con la marca rtg.relevo = el número de la orden).
  -- Solo pasa ESE cambio exacto: de picked_up a delivered, relay_step de nulo a 1, y las columnas que activar_relevo escribe;
  -- todo lo demás de la fila tiene que ser igual que OLD. Va después de las invariantes (122) y antes de la salida de
  -- admin, para que ningún rol la salte, y la inserción del paso b NO pasa por aquí (va por la rama de INSERT de abajo).
  if TG_OP = 'UPDATE' and OLD.stage = 'picked_up' and NEW.stage = 'delivered'
     and OLD.relay_step is null and NEW.relay_step = 1
     and current_setting('rtg.relevo', true) = NEW.order_no::text
     and (to_jsonb(NEW) - array['order_suffix', 'relay_step', 'delivery_name', 'delivery_address', 'delivery_lat', 'delivery_lng',
                                'delivery_pin_source', 'route_miles', 'route_duration', 'route_provider', 'route_traffic',
                                'stage', 'pod_delivered_at', 'delivered_address', 'updated_at'])
         = (to_jsonb(OLD) - array['order_suffix', 'relay_step', 'delivery_name', 'delivery_address', 'delivery_lat', 'delivery_lng',
                                  'delivery_pin_source', 'route_miles', 'route_duration', 'route_provider', 'route_traffic',
                                  'stage', 'pod_delivered_at', 'delivered_address', 'updated_at']) then
    return NEW;
  end if;

  -- 322: DESHACER EL RELEVO (deshacer_relevo). El paso a vuelve a ser la orden entera: relay_step de 1 a nulo, con la marca
  -- rtg.relevo = el numero de la orden, y solo las columnas que deshacer_relevo escribe. La etapa, igual, o entregado -> listo
  -- (el paso a entregado en la tienda de relevo). Todo lo demas de la fila, igual que OLD. Va antes de la salida de admin para
  -- que ningun rol la salte, pero solo la marca de deshacer_relevo (que comprueba puede_relevo) la abre.
  if TG_OP = 'UPDATE' and OLD.relay_step = 1 and NEW.relay_step is null
     and current_setting('rtg.relevo', true) = NEW.order_no::text
     and OLD.stage in ('approved','fulfilling','ready','picked_up','delivered')
     and (NEW.stage = OLD.stage or (OLD.stage = 'delivered' and NEW.stage = 'ready'))
     and (to_jsonb(NEW) - array['order_suffix', 'relay_step', 'delivery_name', 'delivery_address', 'delivery_lat', 'delivery_lng', 'delivery_pin_source', 'route_miles', 'route_duration', 'route_provider', 'route_traffic', 'stage', 'pickup_name', 'pickup_address', 'pickup_point_lat', 'pickup_point_lng', 'assigned_driver', 'pickup_gps_at', 'pickup_lat', 'pickup_lng', 'departed_at', 'arrived_at', 'pod_delivered_at', 'delivered_address', 'updated_at']) = (to_jsonb(OLD) - array['order_suffix', 'relay_step', 'delivery_name', 'delivery_address', 'delivery_lat', 'delivery_lng', 'delivery_pin_source', 'route_miles', 'route_duration', 'route_provider', 'route_traffic', 'stage', 'pickup_name', 'pickup_address', 'pickup_point_lat', 'pickup_point_lng', 'assigned_driver', 'pickup_gps_at', 'pickup_lat', 'pickup_lng', 'departed_at', 'arrived_at', 'pod_delivered_at', 'delivered_address', 'updated_at']) then
    return NEW;
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
-- 2. deshacer_relevo: vuelve a ser UNA orden mientras el paso b no haya salido (ver la regla arriba)
-- ---------------------------------------------------------------------------
create or replace function public.deshacer_relevo(p_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  x        public.deliveries%rowtype;
  a        public.deliveries%rowtype;
  ultimo   public.deliveries%rowtype;
  etiqueta text;
  entregada boolean;
  n        integer;
begin
  if auth.uid() is null or not public.puede_relevo() then
    raise exception 'RELEVO_FORBIDDEN: only route planners or an admin undo a relay transfer' using errcode = '42501';
  end if;
  select * into x from public.deliveries d where d.id = p_id;
  if not found or not public.la_ve_quien_llama(x) then raise exception 'RELEVO_NOT_FOUND: %', p_id; end if;
  if x.relay_step is null then raise exception 'RELEVO_NO_APLICA: #% is not a relay transfer', x.order_no; end if;

  -- Se bloquean todos los pasos de la familia mientras se decide (para que nadie recoja el b a la vez).
  perform 1 from public.deliveries d
    where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step is not null
    order by d.relay_step for update;

  select * into a from public.deliveries d
    where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step = 1;
  select * into ultimo from public.deliveries d
    where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step is not null
    order by d.relay_step desc limit 1;
  if a.id is null or ultimo.id is null or ultimo.id = a.id then
    raise exception 'RELEVO_NO_APLICA: #% has no relay steps to undo', x.order_no;
  end if;

  -- La regla: nada posterior al paso a puede haber salido (el b, ni el c, d... si los hubiera).
  if exists (select 1 from public.deliveries d
              where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step > 1
                and (d.stage in ('picked_up', 'delivered') or d.pickup_gps_at is not null or d.pod_delivered_at is not null)) then
    raise exception 'RELEVO_YA_SALIO: the relay can no longer be undone: a later step was already picked up';
  end if;

  etiqueta := coalesce(a.order_code, a.order_no::text);
  -- El paso a entregado en la tienda de relevo: la mercancia esta alli, la orden vuelve a salir DE ALLI (ver el encabezado).
  entregada := a.stage = 'delivered';
  perform set_config('rtg.relevo', a.order_no::text, true);

  delete from public.deliveries d
   where d.order_no = a.order_no and d.is_training = a.is_training and d.relay_step > 1;

  update public.deliveries d
     set order_suffix        = null,
         relay_step          = null,
         delivery_name       = ultimo.delivery_name,
         delivery_address    = ultimo.delivery_address,
         delivery_lat        = ultimo.delivery_lat,
         delivery_lng        = ultimo.delivery_lng,
         delivery_pin_source = ultimo.delivery_pin_source,
         route_miles         = null,
         route_duration      = null,
         route_provider      = null,
         route_traffic       = null,
         -- Entregada en la tienda de relevo -> lista en esa tienda, sin chofer y sin marcas de recogida o entrega.
         stage               = case when entregada then 'ready' else d.stage end,
         pickup_name         = case when entregada then a.delivery_name    else d.pickup_name    end,
         pickup_address      = case when entregada then a.delivery_address else d.pickup_address end,
         pickup_point_lat    = case when entregada then null else d.pickup_point_lat end,
         pickup_point_lng    = case when entregada then null else d.pickup_point_lng end,
         assigned_driver     = case when entregada then null else d.assigned_driver end,
         pickup_gps_at       = case when entregada then null else d.pickup_gps_at end,
         pickup_lat          = case when entregada then null else d.pickup_lat end,
         pickup_lng          = case when entregada then null else d.pickup_lng end,
         departed_at         = case when entregada then null else d.departed_at end,
         arrived_at          = case when entregada then null else d.arrived_at end,
         pod_delivered_at    = case when entregada then null else d.pod_delivered_at end,
         delivered_address   = case when entregada then null else d.delivered_address end
   where d.id = a.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RELEVO_UNSEEN: the order could not be written'; end if;

  perform set_config('rtg.relevo', '', true);

  insert into public.order_events (delivery_id, kind, note, created_by) values
    (a.id, 'edited', format('Relay transfer undone: #%s is one order again, %s -> %s%s', etiqueta,
       case when entregada then coalesce(a.delivery_name, '?') else coalesce(a.pickup_name, '?') end,
       coalesce(ultimo.delivery_name, '?'),
       case when entregada then ' (it was already at the relay store: ready there, no driver)' else '' end), auth.uid());
  return a.id;
end $$;
revoke execute on function public.deshacer_relevo(uuid) from public, anon;
grant execute on function public.deshacer_relevo(uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.deshacer_relevo(uuid)'::regprocedure);
  if position('RELEVO_YA_SALIO' in f) = 0 or position('puede_relevo' in f) = 0 or position('la_ve_quien_llama' in f) = 0 then
    raise exception '322: deshacer_relevo debe conservar la comprobacion de quien llama y la de que el paso b no haya salido';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'public.deshacer_relevo(uuid)'::regprocedure) then
    raise exception '322: deshacer_relevo tiene que ser security definer';
  end if;
  f := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  if position('rtg.relevo' in f) = 0 or position('322:' in f) = 0 or position('rtg.reprogramar_orden' in f) = 0 then
    raise exception '322: guard_delivery_stage debe conservar las ramas de la 321 y la nueva de deshacer';
  end if;
  if has_function_privilege('anon', 'public.deshacer_relevo(uuid)', 'execute') then
    raise exception '322: anon no debe poder ejecutar deshacer_relevo';
  end if;
  if not has_function_privilege('authenticated', 'public.deshacer_relevo(uuid)', 'execute') then
    raise exception '322: authenticated debe poder ejecutar deshacer_relevo';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('322_deshacer_relevo.sql', '4fb5668362ce27beca76c92fabdd8ee41eecac5695d264d9cf5baa6a8c3de0b0') on conflict (name) do nothing;
