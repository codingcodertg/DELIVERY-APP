-- 349 - La guardia de etapas recupera los permisos que la 321 dejo fuera
-- ===========================================================================
-- Que paso. El 2026-11-17 la 321 (relevo de una orden ya recogida) volvio a crear `guard_delivery_stage` partiendo del
-- texto de la 173, no del de la 244, que era el que estaba en produccion. La 322 y la 346 copiaron la de la 321. Asi se
-- perdieron, sin que nadie lo pidiera, seis permisos que habian anadido la 185, la 187, la 188/213, la 191/192, la 196
-- y la 244. Desde ese dia la base contestaba "You cannot edit an order in the % stage" (o "Not allowed") en:
--
--   1. 188 / 213  El chofer TOMA una orden para recogerla, o AGREGA a su ruta una que no tenia chofer
--                 (`tomar_orden_para_recoger`, marca rtg.tomar_orden). La app decia «No se pudo tomar. Intentalo de
--                 nuevo.» Asi se encontro: el dueno, 2026-11-25, viendo como un chofer, con la orden 1784.
--   2. 244        Ventas AGREGA una nota (`role_notes`) a su orden ya aprobada.
--   3. 191 / 192  Ventas ANULA su orden hasta «Listo».
--   4. 196        El chofer ANULA su orden ya recogida.
--   5. 187        El puesto en la ruta de una entrega ya RECOGIDA se mueve (logistica y oficina).
--   6. 185        La letra de una carga (`order_suffix`) se pone aunque la orden este entregada (reentrega como carga).
--
-- Que hace esta migracion, y SOLO esto: vuelve a crear `guard_delivery_stage` con la fusion de las dos ramas: la que
-- esta hoy en produccion (la de la 346: 173 + 321 + 322 + 346) y la de la 244 (173 + 185 + 187 + 188 + 191 + 192 + 196 +
-- 244), con la 173 como antepasado comun. La fusion a tres bandas no tuvo conflictos. Lo que la 346 hace hoy queda
-- identico, linea por linea; se suman los seis bloques de arriba, tal como estaban en la 244. No toca tablas, datos,
-- disparadores ni ninguna otra funcion.
--
-- Como se comprobo antes de aplicarla: ensayo en una transaccion que se deshace, entrando como el chofer y llamando a
-- `tomar_orden_para_recoger` sobre la orden que fallaba: con la guardia de hoy, "You cannot edit an order in the ready
-- stage"; con esta, pasa.
--
-- Como deshacer: volver a aplicar el bloque `create or replace function public.guard_delivery_stage()` de la 346, y
--   delete from public.schema_migrations where name = '349_guardia_recupera_permisos.sql';
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

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

  -- ---- El puesto de una entrega ya recogida se mueve (187, D-625) ----
  -- La orden va en el camion y su ENTREGA sigue pendiente: logistica (y oficina) la bajan o suben en la ruta como a
  -- cualquier pendiente. Solo cambian el puesto (`route_seq`, `pickup_seq`, `load_no`); nada mas de la orden.
  if TG_OP = 'UPDATE' and old_stage = 'picked_up' and new_stage = 'picked_up'
     and public.has_deliveries_access() then
    probe := NEW;
    probe.route_seq  := OLD.route_seq;
    probe.pickup_seq := OLD.pickup_seq;
    probe.load_no    := OLD.load_no;
    probe.updated_at := OLD.updated_at;
    if probe is not distinct from OLD then return NEW; end if;
  end if;

  -- ---- La letra de una carga es un nombre, no historia (185, D-625) ----
  -- Ponerle (o cambiarle) SOLO `order_suffix` a una orden —aunque este entregada— lo puede hacer cualquiera con el
  -- modulo: lo necesita la reentrega como carga (`reentrega_como_carga`): la madre entregada pasa a 'a' y la nueva es 'b'.
  if TG_OP = 'UPDATE' and NEW.order_suffix is distinct from OLD.order_suffix then
    probe := NEW;
    probe.order_suffix := OLD.order_suffix;
    probe.updated_at   := OLD.updated_at;
    if probe is not distinct from OLD then return NEW; end if;
  end if;

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
    -- 244 (D-NEXT): ventas AGREGA una nota (`role_notes`) a SU orden ya aprobada. Hasta aqui solo podia en
    -- draft/pending/rejected (arriba); desde 'approved' la base contestaba "You cannot edit an order in the % stage" y la
    -- nota no se guardaba (Melecio Rodriguez, 2026-11-05, ordenes 1433/1434 en 'fulfilling'). Mismo patron que 125/138:
    -- la orden es suya, la lista solo CRECE (lo que ya estaba sigue identico y en su sitio), cada nota nueva va firmada
    -- por quien escribe y no esta vacia, y una copia de NEW con las notas viejas tiene que ser identica a OLD.
    if r = 'sales'
       and old_stage in ('approved','fulfilling','ready','picked_up')
       and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid())
       and jsonb_typeof(NEW.role_notes) = 'array'
       and jsonb_array_length(NEW.role_notes) > jsonb_array_length(coalesce(OLD.role_notes, '[]'::jsonb))
       and jsonb_array_length(NEW.role_notes) <= 50
       and (select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
              from jsonb_array_elements(NEW.role_notes) with ordinality as t(e, i)
             where t.i <= jsonb_array_length(coalesce(OLD.role_notes, '[]'::jsonb)))
           = coalesce(OLD.role_notes, '[]'::jsonb)
       and not exists (select 1 from jsonb_array_elements(NEW.role_notes) with ordinality as t(e, i)
                        where t.i > jsonb_array_length(coalesce(OLD.role_notes, '[]'::jsonb))
                          and (t.e ->> 'by' is distinct from auth.uid()::text
                            or btrim(coalesce(t.e ->> 'text', '')) = ''
                            or length(t.e ->> 'text') > 2000)) then
      probe := NEW;
      probe.role_notes := OLD.role_notes;
      probe.updated_at := OLD.updated_at;
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
    -- 188: el chofer TOMA una orden que no es suya para recogerla (excepcion), por la funcion `tomar_orden_para_recoger`
    -- (de la misma migracion), que comprueba quien, en que etapa y con motivo, y marca ESTA orden en `rtg.tomar_orden`
    -- (set_config local) justo antes de su UPDATE. Aqui solo pasa esa escritura si lo UNICO que cambia es el chofer, su
    -- puesto en la ruta (`route_seq`, `pickup_seq`, `load_no`) y la fecha de entrega (pasa a hoy: la recoge ahora).
    if current_setting('rtg.tomar_orden', true) = OLD.id::text then
      probe := NEW;
      probe.assigned_driver := OLD.assigned_driver;
      probe.route_seq       := OLD.route_seq;
      probe.pickup_seq      := OLD.pickup_seq;
      probe.load_no         := OLD.load_no;
      probe.delivery_date   := OLD.delivery_date;
      probe.updated_at      := OLD.updated_at;
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
    -- 191 (D-656) y 192 (D-663): ventas anula SU orden hasta «Listo»: la creo o es su vendedor, la misma duenez que la
    -- factura de la 125. Desde 'picked_up' no: la mercancia ya va en el camion. El motivo, quien y cuando los pone el
    -- bloque de arriba, igual que a cualquiera.
    or (r = 'sales' and new_stage = 'canceled' and old_stage in ('pending','approved','fulfilling','ready') and (OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid()))
    -- 196 (D-676): el chofer anula SU orden ya recogida (la que lleva asignada: `assigned_driver` es su NOMBRE, como en la
    -- 168). El motivo, quien y cuando los pone el bloque de arriba, igual que a cualquiera.
    or (r = 'driver' and new_stage = 'canceled' and old_stage = 'picked_up' and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))
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
end $function$;

-- ===========================================================================
-- Autocomprobacion: la guardia que queda tiene TODO lo de las dos ramas
-- ===========================================================================
do $comprueba$
declare
  f text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  falta text;
begin
  foreach falta in array array[
    -- lo que ya tenia la de produccion (173 + 321 + 322 + 346)
    'current_setting(''rtg.reprogramar_orden'', true) = OLD.id::text',
    'current_setting(''rtg.relevo'', true) = NEW.order_no::text',
    '-- 346',
    -- lo que vuelve (185, 187, 188/213, 191/192, 196, 244)
    'current_setting(''rtg.tomar_orden'', true) = OLD.id::text',
    'probe.role_notes := OLD.role_notes',
    'probe.order_suffix := OLD.order_suffix',
    'old_stage = ''picked_up'' and new_stage = ''picked_up''',
    'r = ''sales'' and new_stage = ''canceled''',
    'r = ''driver'' and new_stage = ''canceled'' and old_stage = ''picked_up'''
  ] loop
    if position(falta in f) = 0 then
      raise exception '349: a la guardia le falta: %', falta;
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) <> 1 then
    raise exception '349: el disparador deliveries_guard_stage no esta';
  end if;
end $comprueba$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('349_guardia_recupera_permisos.sql', '6c9f114f4621e844e9e3449ec8f508d9edae66c12d7f9feb776798f01dfc8dbb') on conflict (name) do nothing;
