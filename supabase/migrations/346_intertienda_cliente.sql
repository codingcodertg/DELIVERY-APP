-- ===========================================================================
-- 346 · Intertienda Customer: una orden de cliente vendida desde una tienda y recogida en otra se parte sola en relevo
-- ===========================================================================
-- PEDIDO. El dueno: una orden de cliente que VENDE RDZ Pharr pero se RECOGE en RDZ McAllen no puede ir de McAllen directo
-- al cliente: tiene que pasar antes por Pharr. Hasta hoy eso era un relevo (256/313/321) que alguien tenia que activar a
-- mano, y solo lo podia activar quien planifica rutas (puede_relevo). Ahora se activa solo, en cuanto la orden se aprueba,
-- y cualquier usuario de Entregas puede dispararlo.
--
-- QUE ES (la regla vive en src/lib/intertienda-cliente.ts; esta migracion la escribe en la base):
--   · paso a: la misma orden, con la tienda de recogida como origen y la tienda que vende como destino (relay_step 1, letra 'a');
--   · paso b: nace como copia de la madre, de la tienda que vende al cliente (relay_step 2, letra 'b'), sin chofer, en
--     'ready', el dia = el de la orden o hoy, si es posterior. No se recoge hasta que el a este entregado (guard_relevo, 256);
--   · la TARIFA de entrega (delivery_fee) se queda en el paso b, que es el tramo del cliente; el paso a queda sin tarifa.
--
-- POR QUE UNA FUNCION NUEVA Y NO activar_relevo: activar_relevo (321) exige puede_relevo() y pide la tienda de relevo y el
-- dia. Esta no pide nada: la tienda de relevo es siempre la que vende y el dia sale de la orden. Lo que cambia respecto a
-- activar_relevo es solo quien puede dispararla; las marcas, las columnas y el historial son los mismos.
--
-- LO QUE NO HACE: no toca una orden que no cumpla TODA la regla. Devuelve null, sin error y sin escribir nada, si: tiene
-- relay_step o letra; tiene hermanas (ya esta partida); su etapa no es aprobada, en preparacion o lista; su tipo no tiene
-- cliente detras (settings.order_type_rules; un tipo que no esta en las reglas cuenta como cliente); la recogida o la
-- tienda que vende no son tiendas de Ajustes; son la misma tienda o del mismo grupo (settings.stores[].group, el mismo
-- grupo que orden_de_mis_tiendas, 142); o el destino es la tienda que vende (por nombre o por su direccion).
--
-- CAMBIOS EN ESTA MIGRACION:
--   1. guard_delivery_stage: copia EXACTA de la 322 con UNA rama nueva (marcada `-- 346`) que deja pasar las dos escrituras
--      de un paso de relevo hechas con la marca rtg.relevo. Sin ella, a ventas y a oficina el guard les rechazaba el paso a
--      (un UPDATE de una orden ya aprobada, que no pueden editar en esa etapa) y el paso b (un INSERT con letra: esa rama
--      solo deja crear cargas partidas a almacen, chofer, logistica, gerente y contabilidad).
--   2. activar_intertienda_cliente: nueva.
--
-- Para volver atras: reejecutar el create or replace de guard_delivery_stage de la 322 y quitar la funcion nueva con
-- `drop function if exists public.activar_intertienda_cliente(uuid);`.
--
-- Sin aplicar: esta migracion se escribio en la rama entregas/intertienda-cliente y NO se ha corrido en ninguna base.

-- ---------------------------------------------------------------------------
-- 1. guard_delivery_stage: la copia EXACTA de la 322 con UNA rama nueva (la insercion del paso b), marcada «-- 346»
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

  -- 346: los dos pasos de una Intertienda Customer los escribe activar_intertienda_cliente, a nombre de CUALQUIER usuario de
  -- Entregas (no solo de quien planifica): el paso a es un UPDATE de la orden ya aprobada (que ventas y oficina no pueden
  -- editar en esa etapa) y el paso b un INSERT con letra (que ventas y oficina no pueden crear). Pasan solo con la marca
  -- rtg.relevo = el numero de la orden, la misma que deja pasar guard_relevo (256) y que solo ponen activar_relevo y
  -- activar_intertienda_cliente dentro de su transaccion: sin ella, nada de esto pasa. Va despues de fijar created_by.
  if TG_OP in ('INSERT', 'UPDATE') and NEW.relay_step is not null and current_setting('rtg.relevo', true) = NEW.order_no::text then -- 346
    return NEW; -- 346
  end if; -- 346

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
-- 2. activar_intertienda_cliente: parte la orden en A (recogida -> tienda que vende) y B (tienda que vende -> cliente)
-- ---------------------------------------------------------------------------
-- Security definer: escribe las dos filas y el historial con el mismo camino que activar_relevo (321), y la politica de
-- escritura de `deliveries` no basta para el paso b (lo que escribe es un paso de relevo). Quien puede VERLA se decide aqui
-- mismo (la politica de lectura no aplica dentro de una funcion definer), con la misma condicion de la 083/131.
create or replace function public.activar_intertienda_cliente(p_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  madre      public.deliveries%rowtype;
  reglas     jsonb;
  tiendas    jsonb;
  regla      jsonb;
  tienda     jsonb;   -- la tienda que vende, tal como está en Ajustes
  origen     jsonb;   -- la tienda de recogida, tal como está en Ajustes
  hoy        date := (now() at time zone 'America/Chicago')::date;
  fecha      date;    -- el dia del paso b: el de la orden o hoy, lo que sea posterior (primerDiaDelPasoB)
  nueva_id   uuid := gen_random_uuid();
  fila       jsonb;
  etiqueta   text;
  n          integer;
  puede_ver  boolean;
begin
  if auth.uid() is null or not public.has_deliveries_access() then
    raise exception 'IC_FORBIDDEN: only Deliveries users can set up an Intertienda Customer' using errcode = '42501';
  end if;
  select * into madre from public.deliveries d where d.id = p_id for update;
  if not found then raise exception 'IC_NOT_FOUND: %', p_id; end if;

  -- Quien puede ver la orden: la misma condicion que la politica de lectura de `deliveries` (083 por rol, 131 por tienda).
  -- Chofer y almacen tienen su rama; el resto, la de sus tiendas marcadas (tiendas_visibles, null = todas).
  puede_ver := madre.is_training or (
       case (select p.role from public.profiles p where p.id = auth.uid())
         when 'driver' then (madre.created_by = auth.uid()
                             or madre.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))
         when 'warehouse' then madre.stage = any (array['approved','fulfilling','ready','picked_up','delivered'])
         else true
       end
       and ((select public.tiendas_visibles()) is null
            or btrim(coalesce(madre.store, '')) = ''
            or lower(btrim(coalesce(madre.store, ''))) = any ((select public.tiendas_visibles())::text[])
            or lower(btrim(coalesce(madre.pickup_name, ''))) = any ((select public.tiendas_visibles())::text[])
            or lower(btrim(coalesce(madre.delivery_name, ''))) = any ((select public.tiendas_visibles())::text[])));
  if not coalesce(puede_ver, false) then
    raise exception 'IC_FORBIDDEN: this order is not visible to you' using errcode = '42501';
  end if;

  -- ---- Cuando NO aplica: se devuelve null y no se escribe nada (no es un error: la orden simplemente no es de este tipo) ----
  if madre.relay_step is not null or madre.order_suffix is not null then return null; end if;
  if exists (select 1 from public.deliveries d
              where d.order_no = madre.order_no and d.is_training = madre.is_training and d.id <> madre.id) then
    return null;
  end if;
  if madre.stage not in ('approved', 'fulfilling', 'ready') then return null; end if;

  select coalesce(st.order_type_rules, '{}'::jsonb), coalesce(st.stores, '[]'::jsonb)
    into reglas, tiendas
    from public.settings st limit 1;

  -- Un tipo sin cliente detras (tienda a tienda o proveedor) no entra. Un tipo que no esta en las reglas cuenta como cliente.
  regla := reglas -> btrim(madre.order_type);
  if not coalesce((regla ->> 'hasCustomer')::boolean, not coalesce((regla ->> 'storeToStore')::boolean, false)) then
    return null;
  end if;

  -- La tienda que vende y la de recogida tienen que ser tiendas de Ajustes (por nombre, sin distinguir mayusculas ni espacios).
  select s into tienda from jsonb_array_elements(tiendas) s
   where public.relevo_norm(s->>'name') = public.relevo_norm(madre.store) and public.relevo_norm(madre.store) <> '' limit 1;
  select s into origen from jsonb_array_elements(tiendas) s
   where public.relevo_norm(s->>'name') = public.relevo_norm(madre.pickup_name) and public.relevo_norm(madre.pickup_name) <> '' limit 1;
  if tienda is null or origen is null then return null; end if;

  -- Ni la misma tienda ni una del mismo grupo (D-293: las tiendas que trabajan juntas no se pasan la orden a si mismas).
  if public.relevo_norm(madre.pickup_name) = public.relevo_norm(madre.store) then return null; end if;
  if nullif(lower(btrim(coalesce(origen->>'group', ''))), '') is not null
     and lower(btrim(coalesce(origen->>'group', ''))) = lower(btrim(coalesce(tienda->>'group', ''))) then
    return null;
  end if;

  -- El destino no puede ser la tienda que vende: entonces no hay cliente que atender desde ella (por nombre o por direccion).
  if public.relevo_norm(madre.delivery_name) = public.relevo_norm(tienda->>'name')
     or (btrim(coalesce(tienda->>'address', '')) <> ''
         and public.relevo_norm(madre.delivery_address) = public.relevo_norm(tienda->>'address')) then
    return null;
  end if;

  -- ---- Cuando SI aplica: se parte. Igual que activar_relevo (321) para una orden no recogida, con tres diferencias:
  --      la tienda de relevo es la que vende, el dia sale de la orden, y la tarifa se queda en el paso b.
  fecha    := greatest(hoy, coalesce(madre.delivery_date, hoy));
  etiqueta := coalesce(madre.order_code, madre.order_no::text);
  perform set_config('rtg.relevo', madre.order_no::text, true);

  -- El paso a: la misma fila, con la tienda que vende como destino. Su tarifa se va al paso b.
  update public.deliveries
     set order_suffix        = 'a',
         relay_step          = 1,
         delivery_name       = tienda->>'name',
         delivery_address    = tienda->>'address',
         delivery_lat        = nullif(tienda->>'lat', '')::double precision,
         delivery_lng        = nullif(tienda->>'lng', '')::double precision,
         delivery_pin_source = case when nullif(tienda->>'lat', '') is not null and nullif(tienda->>'lng', '') is not null then 'geocoded' else null end,
         route_miles = null, route_duration = null, route_provider = null, route_traffic = null,
         delivery_fee        = null
   where id = p_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'IC_UNSEEN: step a could not be written'; end if;

  -- El paso b: copia de la madre como estaba (su destino es el cliente), con lo suyo. Conserva su delivery_fee (no va en el jsonb).
  fila := to_jsonb(madre)
    || jsonb_build_object(
      'id', nueva_id, 'order_suffix', 'b', 'relay_step', 2, 'stage', 'ready',
      'pickup_name', tienda->>'name', 'pickup_address', tienda->>'address', 'pickup_point_lat', null, 'pickup_point_lng', null,
      'delivery_date', fecha, 'assigned_driver', null, 'morning_priority', false,
      'route_seq', null, 'pickup_seq', null, 'load_no', null, 'load_auto', false,
      'route_miles', null, 'route_duration', null, 'route_provider', null, 'route_traffic', null)
    || jsonb_build_object(
      'created_at', now(), 'updated_at', now(), 'created_by', auth.uid(),
      'pickup_lat', null, 'pickup_lng', null, 'pickup_gps_at', null, 'departed_at', null, 'arrived_at', null,
      'pod_received_by', null, 'pod_signature', null, 'pod_delivered_at', null, 'pod_lat', null, 'pod_lng', null, 'pod_accuracy', null,
      'photos', null, 'photo_meta', null, 'delivered_address', null, 'csat_rating', null, 'csat_comment', null,
      'delivery_notes', concat_ws(E'\n', madre.delivery_notes,
        format('Intertienda Customer Tr-%s-b: %s -> %s.', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'))));
  insert into public.deliveries select * from jsonb_populate_record(null::public.deliveries, fila);

  perform set_config('rtg.relevo', '', true);

  insert into public.order_events (delivery_id, kind, note, created_by) values
    (p_id, 'edited', format('Intertienda Customer: this order is now step Tr-%s-a (%s -> %s); step Tr-%s-b (%s -> %s) goes to the customer on %s',
                            etiqueta, coalesce(madre.pickup_name, '?'), tienda->>'name', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), fecha), auth.uid()),
    (nueva_id, 'created', format('Intertienda Customer: step Tr-%s-b: %s -> %s, pickup day %s. It can be picked up once Tr-%s-a is delivered at %s',
                                 etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), fecha, etiqueta, tienda->>'name'), auth.uid());
  return nueva_id;
end $$;
revoke execute on function public.activar_intertienda_cliente(uuid) from public, anon;
grant execute on function public.activar_intertienda_cliente(uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.activar_intertienda_cliente(uuid)'::regprocedure);
  if position('IC_FORBIDDEN' in f) = 0 or position('tiendas_visibles' in f) = 0 or position('rtg.relevo' in f) = 0 then
    raise exception '346: activar_intertienda_cliente debe conservar el acceso, la visibilidad y la marca rtg.relevo';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'activar_intertienda_cliente' and p.prosecdef) then
    raise exception '346: activar_intertienda_cliente no es security definer';
  end if;
  f := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  if position('-- 346' in f) = 0 or position('rtg.reprogramar_orden' in f) = 0 then
    raise exception '346: guard_delivery_stage no tiene la rama de la insercion del paso b (o perdio la de la 173)';
  end if;
end $chk$;

-- ===========================================================================
-- Verificar a mano (despues de aplicarla; NO se ha aplicado en ninguna base)
-- ===========================================================================
-- 1. Una orden de cliente aprobada que vende RDZ Pharr y se recoge en RDZ McAllen:
--      select public.activar_intertienda_cliente('<id de la orden>');        -- devuelve el id del paso b
--    Si devuelve null, la orden no cumple la regla (ver el comentario de arriba): no escribio nada.
-- 2. Los dos pasos, con la tarifa solo en el b:
--      select order_suffix, relay_step, stage, pickup_name, delivery_name, delivery_fee, est_pallets
--        from public.deliveries where order_no = <n> order by relay_step;
--    Dos filas: a (relay_step 1, delivery_name = RDZ Pharr, delivery_fee nulo) y b (relay_step 2, pickup_name = RDZ Pharr,
--    delivery_name = el cliente, delivery_fee = la tarifa de antes, est_pallets igual).
-- 3. El historial, con las dos notas:
--      select kind, note from public.order_events where delivery_id in ('<id a>', '<id b>') order by created_at;
-- 4. Segunda llamada: no cambia nada.
--      select public.activar_intertienda_cliente('<el mismo id>');           -- null
-- 5. Otro rol (ventas) no puede activarla sobre una orden de otra tienda: debe salir IC_FORBIDDEN.
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('346_intertienda_cliente.sql', 'c1ec9d409fd8cdef51ca71a1e764850e899ded534a8b4b4c17c9bd1813c8f073') on conflict (name) do nothing;
