-- ===========================================================================
-- 169 · El chofer guarda las fotos del material y sus marcas de salida / llegada en SU orden
-- ===========================================================================
-- PEDIDO. El dueno, 2026-10-12: "haz el 5" sobre este punto de la lista de pendientes: "Fotos del material desde el
-- chofer: en la ficha de orden el boton 'Fotos del material' usa una actualizacion que el guardia de la base rechaza al
-- chofer (...) Lo mismo para arrived_at / departed_at del chofer". (El numero no se escribe en el cuerpo a proposito,
-- D-512: lo pone el nombre del fichero.) Plan en papel: docs/PLAN-169-fotos-del-chofer.md.
--
-- EL HUECO (medido en OrderModal.tsx: `PhotoUpload` de "Fotos del material" hace `updateDelivery(id, { photos })`;
-- `depart` y `arrive` hacen `updateDelivery(id, { departed_at })` / `{ arrived_at }`). Sin cambiar de etapa, el guard
-- vigente (168 = 157 + una clausula) solo deja al chofer tocar las coordenadas de una parada ya recogida o entregada
-- (clausula 142/145). Cualquier otra columna, en cualquier etapa, le contesta "You cannot edit an order in the %
-- stage": las fotos del material desde el chofer NUNCA se guardaban.
--
-- QUE HACE: redefine `guard_delivery_stage` copiando la de la 168 LETRA POR LETRA y anadiendo UN bloque (marcado "169")
-- en el tramo "misma etapa", justo despues del bloque del chofer de la 142/145:
--
--   if r = 'driver' and old_stage in ('approved','fulfilling','ready','picked_up','delivered')
--      and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()) then
--     probe := NEW; probe.photos := OLD.photos; probe.photo_meta := OLD.photo_meta;
--     probe.departed_at := OLD.departed_at; probe.arrived_at := OLD.arrived_at; probe.updated_at := OLD.updated_at;
--     if probe is not distinct from OLD then return NEW; end if;
--   end if;
--
--   - Solo el chofer y solo SU orden (asignada a su nombre ANTES de la escritura, OLD), igual que la 168.
--   - Solo esas cuatro columnas (y updated_at): si la escritura trae cualquier otra, el `probe` no iguala a OLD y se
--     sigue al resto del guard, que contesta como hasta hoy.
--   - Desde 'approved': una orden en 'draft', 'pending', 'rejected' o 'canceled' no entra (no es trabajo del chofer).
--   - No toca la lectura (RLS), ni INSERT, ni ningun cambio de etapa. Las demas ramas quedan letra por letra.
--
-- QUE NO HACE: no decide que fotos son "del material" y cuales "prueba de entrega" (eso es de la app, D-527). No da
-- nada al almacen, ventas, office ni logistica.
--
-- Reversion: volver a aplicar SOLO el bloque `create or replace function ... end $function$;` de la
-- 168_chofer_recoge_sin_listo.sql y `delete from public.schema_migrations where name = '169_fotos_del_chofer.sql';`.
-- Las fotos ya guardadas se quedan (son columnas que ya existian).

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

-- ===========================================================================
-- Autocomprobacion (mira el catalogo: sobrevive a re-aplicar el fichero)
-- ===========================================================================
-- Se mira el CODIGO del guard sin sus lineas de comentario (leccion de la 144/145).
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
begin
  if position('if r = ''driver'' and old_stage in (''approved'',''fulfilling'',''ready'',''picked_up'',''delivered'') and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()) then probe := NEW; probe.photos := OLD.photos; probe.photo_meta := OLD.photo_meta; probe.departed_at := OLD.departed_at; probe.arrived_at := OLD.arrived_at; probe.updated_at := OLD.updated_at; if probe is not distinct from OLD then return NEW; end if; end if;' in codigo) = 0 then
    raise exception '169: el guard no deja al chofer guardar fotos del material ni salida/llegada en su orden';
  end if;
  if position('or (r = ''driver'' and old_stage in (''approved'',''fulfilling'') and new_stage = ''picked_up'' and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))' in codigo) = 0
     or position('if r in (''warehouse'',''driver'',''logistics'',''manager'',''accounting'') and new_stage in (''ready'',''approved'',''fulfilling'',''pending'') then' in codigo) = 0
     or position('Not allowed to create this split load' in codigo) = 0
     or position('A delivered order is not canceled' in codigo) = 0
     or position('Who created an order is history' in codigo) = 0
     or position('or (r = ''driver'' and old_stage = ''ready'' and new_stage = ''picked_up'')' in codigo) = 0
     or position('or (r = ''driver'' and old_stage = ''picked_up'' and new_stage = ''ready'') then' in codigo) = 0
     or position('169' in def) = 0 then
    raise exception '169: al guard le falta algo de la 168';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.guard_delivery_stage()'::regprocedure) is not true then
    raise exception '169: el guard tiene que seguir siendo security definer (lee profiles)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '169: el disparador deliveries_guard_stage no esta';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (para pegar A MANO en una transaccion abierta; este fichero no lo ejecuta)
-- ===========================================================================
--   E1 chofer, SU orden en 'approved'/'ready'/'picked_up'/'delivered' -> update ... set photos = ..., photo_meta = ... -> pasa
--   E2 chofer, SU orden en 'ready' -> update ... set departed_at = now()                                             -> pasa
--   E3 chofer, SU orden en 'picked_up' -> update ... set arrived_at = now()                                          -> pasa
--   E4 chofer, orden de OTRO chofer (o sin chofer) -> set photos = ...                                               -> "You cannot edit an order in the % stage"
--   E5 chofer, SU orden en 'pending' -> set photos = ...                                                             -> rechazado
--   E6 chofer, SU orden en 'ready' -> set photos = ..., delivery_notes = 'x'                                         -> rechazado (otra columna)
--   E7 chofer, SU orden en 'picked_up' -> set pod_lat = ... (clausula 142/145)                                       -> pasa, como antes
--   E8 almacen, ventas, office, logistica: todo como antes (su rama no cambia)

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('169_fotos_del_chofer.sql', '8a14d1b6be361c2bf4b678259a3deb6af850d11e1c4f763f1f710cb7fb691ff9') on conflict (name) do nothing;
