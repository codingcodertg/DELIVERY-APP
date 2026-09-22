-- 139 - Office y gerente entregan de inmediato y deshacen un paso
-- ===========================================================================
-- El dueno, literal: "quiero que office people puedan darle deliver a una orden de inmediato y
-- revertir stages si fue un error", y al preguntarle si incluia al gerente: "si office incluye al
-- gerente".
--
-- El caso real: el cliente se lleva el material del mostrador, o el chofer entrego y no lo marco, y
-- office no tenia forma de cerrar la orden; y cuando alguien adelantaba una etapa por error, no
-- habia camino de vuelta. Hasta aqui office y gerente solo movian pendiente<->aprobada, rechazar y
-- anular con motivo (122, 127): lo demas lo rechazaba el guard, asi que un boton habria sido un
-- boton que la base rechaza (D-044).
--
-- Que trae, y SOLO esto:
--   1. ENTREGAR YA: office/gerente pueden approved|fulfilling|ready|picked_up -> delivered.
--   2. DESHACER UN PASO: delivered->picked_up, picked_up->ready, ready->fulfilling,
--      fulfilling->approved. Un solo paso cada vez, para que el historial diga por donde volvio.
--      (approved->pending ya existia desde la 118.)
--
-- Lo que NO cambia:
--   - Ventas, chofer, almacen y logistica: identicos.
--   - El admin sigue saltandose el guard, y una entregada sigue sin poder anularse (122), tampoco
--     para el: esa invariante va antes de la salida de admin y aqui no se toca.
--   - Sin columnas nuevas. El motivo del salto viaja en la nota del evento de historial, como el
--     de volver a preparar (D-287): una columna mas para algo que ya se cuenta en order_events
--     seria un segundo sitio donde mirar.
--
-- Se parte de la definicion VIGENTE del guard, la de la 138 (pg_get_functiondef), no de la que lo
-- creo: create or replace reemplaza la funcion entera, y partir de una version vieja borraria en
-- silencio lo de la 123, 125, 127 y 138. El bloque de comprobacion de abajo lo verifica.
--
-- Reversion, si hiciera falta: volver a aplicar 138_agregar_material.sql tal cual. Reemplaza el
-- guard entero por la definicion anterior a esta, que es exactamente lo que habia.
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
-- Se comprueba a si misma
-- ===========================================================================
do $chk$
declare def text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
begin
  -- Lo que trae la 139.
  if position('new_stage = ''delivered'' and old_stage in (''approved'',''fulfilling'',''ready'',''picked_up'')' in def) = 0 then
    raise exception '139: falta el salto de entregar ya';
  end if;
  if position('old_stage = ''fulfilling'' and new_stage = ''approved''' in def) = 0 then
    raise exception '139: falta el paso atras de fulfilling';
  end if;
  -- Y que no se perdio nada de las anteriores (misma lista que comprobaba la 138, mas la 138).
  if position('invoices_extra' in def) = 0 then raise exception '139: se perdio lo de la 138'; end if;
  if position('probe.invoice_num := OLD.invoice_num;' in def) = 0 then raise exception '139: se perdio lo de la 125'; end if;
  if position('account_requires_approval(NEW.account)' in def) = 0 then raise exception '139: se perdio lo de la 123'; end if;
  if position('A delivered order is not canceled' in def) = 0 then raise exception '139: se perdio lo de la 122'; end if;
  if position('old_stage in (''draft'',''rejected'') and new_stage = ''approved''' in def) = 0 then raise exception '139: se perdio lo de la 127'; end if;
  -- La invariante de la 122 sigue ANTES de la salida de admin.
  if position('A delivered order is not canceled' in def) > position('if r = ''admin'' then return NEW; end if;' in def) then
    raise exception '139: la invariante de la anulacion quedo despues de la salida de admin';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '139: el disparador no esta';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK  (12 casos)
-- ===========================================================================
-- Todo dentro de transacciones que se deshacen: no deja filas y no cambia nada. Se corre A MANO,
-- sustituyendo los uuid de office, gerente, ventas y de ordenes de prueba en la etapa que dice
-- cada caso.
--
-- OJO: este bloque NO lleva begin/commit propios. Se pega dentro de una transaccion abierta a mano
-- y se cierra con ROLLBACK; un commit aqui dentro cerraria la transaccion de fuera y el ensayo
-- dejaria de ser un ensayo (paso con la 124).
--
--   -- 1..4  office ENTREGA YA desde cada etapa: las cuatro pasan
--   --   set local role authenticated; set local request.jwt.claims to '{"sub":"UUID-OFFICE"}';
--   --   update public.deliveries set stage='delivered' where id='UUID-ORDEN-APPROVED';    -- OK
--   --   update public.deliveries set stage='delivered' where id='UUID-ORDEN-FULFILLING';  -- OK
--   --   update public.deliveries set stage='delivered' where id='UUID-ORDEN-READY';       -- OK
--   --   update public.deliveries set stage='delivered' where id='UUID-ORDEN-PICKEDUP';    -- OK
--   -- 5..8  gerente DESHACE un paso: los cuatro pasan
--   --   set local request.jwt.claims to '{"sub":"UUID-GERENTE"}';
--   --   update public.deliveries set stage='picked_up'  where id='UUID-ORDEN-DELIVERED';  -- OK
--   --   update public.deliveries set stage='ready'      where id='UUID-ORDEN-PICKEDUP';   -- OK
--   --   update public.deliveries set stage='fulfilling' where id='UUID-ORDEN-READY';      -- OK
--   --   update public.deliveries set stage='approved'   where id='UUID-ORDEN-FULFILLING'; -- OK
--   -- 9    ventas NO entrega: tiene que FALLAR con "sales cannot move an order from ... to delivered"
--   --   set local request.jwt.claims to '{"sub":"UUID-VENTAS"}';
--   --   update public.deliveries set stage='delivered' where id='UUID-ORDEN-READY';       -- ERROR esperado
--   -- 10   ventas NO deshace: tiene que FALLAR
--   --   update public.deliveries set stage='ready' where id='UUID-ORDEN-PICKEDUP';        -- ERROR esperado
--   -- 11   office NO salta dos pasos atras (delivered -> ready): tiene que FALLAR
--   --   set local request.jwt.claims to '{"sub":"UUID-OFFICE"}';
--   --   update public.deliveries set stage='ready' where id='UUID-ORDEN-DELIVERED';       -- ERROR esperado
--   -- 12   una entregada sigue sin poder anularse, ni para office: tiene que FALLAR
--   --   update public.deliveries set stage='canceled' where id='UUID-ORDEN-DELIVERED';    -- ERROR esperado
--   -- ROLLBACK;
--
-- Almacen no cambia: sus saltos son los mismos que ya tenia (la 138 le daba ready->fulfilling y
-- delivered->picked_up), asi que no hay caso nuevo que ensayar para el.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('139_office_entrega_y_deshace.sql', 'cc7b39c670503469ba36a9348de169de52b346add32ed390dd1b64c8735a1f14') on conflict (name) do nothing;
