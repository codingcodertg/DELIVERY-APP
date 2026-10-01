-- ===========================================================================
-- 157 · Partes de una orden: una orden que no cabe en el camion se parte en CARGAS que son ORDENES
--       (#Xa, #Xb), y se puede repartir o volver a juntar
-- ===========================================================================
-- PEDIDO. El dueno, 2026-09-30: "so if we have an order of more than 10 pallets that will be devided into 2
-- those 2 orders should assign as 2 p 2 d". Plan en papel: docs/PLAN-157-partes-de-orden.md.
--
-- EL HUECO (medido, src/lib/cargas-partidas.test.ts, bloque "HOY"). El motor parte una orden grande en cargas
-- VIRTUALES (`id#a`, `id#b`) del mismo chofer; publicar escribe UNA fila (el chofer y el puesto de la primera
-- carga); el Gestor y "Mi ruta" pintan la segunda carga como una fila informativa que no se mueve ni se marca; y
-- en cuanto alguien toca la ruta a mano, la lista guardada solo conoce UNA recogida y UNA entrega de 15 pallets
-- en un camion de 10 ("+15 = 15 · se pasa 5 de 10").
--
-- EL MODELO. Las cargas de una orden son ORDENES de verdad, hermanas: la misma `order_no` y `order_code` con
-- `order_suffix` 'a', 'b', 'c'... Es el mecanismo que la app YA tiene desde la 012 (la particion al recoger,
-- cuando el chofer carga menos de lo que la orden dice), extendido al momento de PLANIFICAR. Una carga es una
-- fila: tiene su chofer, su puesto (`route_seq`, `pickup_seq`), su etapa, su recogida y su entrega, su RLS, su
-- realtime y su historial, sin que ningun lector de `deliveries` tenga que aprender nada nuevo. Por que no una
-- tabla `delivery_parts` ni un jsonb: en el plan, seccion 1.
--
-- QUE HACE:
--   1. `guard_delivery_stage`: la de la 145 LETRA POR LETRA con UN cambio marcado "157": una carga partida
--      (`order_suffix` no nulo) puede NACER tambien en 'pending'. El motor rutea ordenes pendientes, y una carga
--      partida al planificar nace en la etapa de su madre. Hasta aqui solo nacian en ready/approved/fulfilling.
--   2. `partir_carga(p_id, p_resto)`: mueve `p_resto` pallets de una orden a una carga hermana NUEVA (copia de
--      la madre, con la letra siguiente, sin puesto, sin sellos de recogida ni entrega). Invoker: valen la RLS y
--      el guard de quien la llama. Devuelve el id de la nueva.
--   3. `reparte_cargas(p_a, p_b, p_pallets_a)`: cambia cuantos pallets lleva cada una de dos cargas hermanas,
--      sin cambiar el total. Invoker.
--   4. `juntar_cargas(p_a, p_b)`: devuelve los pallets de `p_b` a `p_a` y BORRA `p_b`. Es SECURITY DEFINER
--      porque la politica de borrar (142) solo deja borrar borradores, y una carga que se junta no es un
--      borrador: por eso comprueba por su cuenta quien llama, que las dos sean hermanas y pendientes, y que
--      quien llama VEA las dos (la misma clausula de tienda de la politica de lectura, 131). El rastro queda en
--      `deliveries_borradas` por el disparador de la 142.
--
-- QUE NO HACE:
--   - No crea ninguna tabla ni columna. No toca ninguna politica. No toca `publish_route_plan` (154): con cargas
--     que son filas, publicar ya escribe cada una. No toca ningun dato: ninguna fila cambia al aplicarla.
--   - No parte nada sola: parte quien llama (la app, al "Armar rutas", con la sesion de quien planifica; o el
--     Gestor, a mano).
--   - Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
--     cerraria la de fuera (paso con la 124).
--
-- DE DONDE SALE EL CUERPO DEL GUARD: de la 145, que es la ultima migracion que lo define (medido en
-- produccion el 2026-09-30, solo lectura: la definicion vigente lleva la marca "145" y no la "151"; una prueba
-- del repo compara los dos bloques linea a linea).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. El guard, desde la definicion VIGENTE (la de la 145) con un cambio marcado "157"
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
-- 2. Quien puede partir, repartir y juntar: admin, logistica y office (gerente y accounting), con el modulo.
--    El chofer parte AL RECOGER por su camino de siempre (OrderModal, 012); esto es lo de planificar.
-- ---------------------------------------------------------------------------
create or replace function public.puede_partir_cargas()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_deliveries_access()
     and coalesce(public.current_user_role() in ('admin', 'logistics', 'manager', 'accounting'), false);
$$;
revoke execute on function public.puede_partir_cargas() from public, anon;
grant execute on function public.puede_partir_cargas() to authenticated;

-- Los pallets que cuentan de una fila: los contados si los hay, y si no los estimados (`palletsDeLaOrden`).
create or replace function public.pallets_de_la_carga(p public.deliveries)
  returns numeric language sql immutable as $$
  select coalesce(p.actual_pallets, p.est_pallets);
$$;

-- ---------------------------------------------------------------------------
-- 3. partir_carga: `p_resto` pallets de la orden `p_id` pasan a una carga hermana NUEVA
-- ---------------------------------------------------------------------------
-- Invoker a proposito: la fila nueva pasa por la politica de INSERT y por el guard (que es quien pone
-- `created_by`); la madre, por la de UPDATE y por el guard de misma etapa. Una orden que quien llama no VE no
-- se encuentra, y eso es lo que tiene que pasar.
--
-- Que copia la carga nueva: TODO lo de la madre (cliente, direccion, ventana, factura, tipo, tienda, tarifa,
-- notas, chofer...), menos lo que es de ESTA fila: id, letra, pallets, puesto en la ruta (route_seq,
-- pickup_seq, load_no, load_auto), sellos (created_*, updated_at), y lo hecho (recogida, salida, llegada,
-- comprobante, fotos, CSAT), que una carga pendiente no tiene. La lista es la misma que mira la app
-- (src/lib/cargas-partidas.ts, `COLUMNAS_PROPIAS_DE_LA_CARGA`; una prueba compara las dos).
--
-- Los pallets: si la madre tiene recuento (`actual_pallets`), se reparte el recuento y la estimacion de
-- ventas se deja como historia (como la particion al recoger, 012); si solo tiene estimacion, se reparte la
-- estimacion. La hermana nueva lleva en los dos campos lo que se lleva.
create or replace function public.partir_carga(p_id uuid, p_resto numeric)
  returns uuid language plpgsql set search_path = public as $$
declare
  madre      public.deliveries%rowtype;
  total      numeric;
  contada    boolean;
  letra      text;
  nueva      text;
  nueva_id   uuid := gen_random_uuid();
  fila       jsonb;
  etiqueta   text;
begin
  if auth.uid() is null or not public.puede_partir_cargas() then
    raise exception 'CARGA_FORBIDDEN: only admin, logistics or office split a load' using errcode = '42501';
  end if;
  select * into madre from public.deliveries d where d.id = p_id for update;
  if not found then raise exception 'CARGA_NOT_FOUND: %', p_id; end if;
  if madre.stage not in ('pending', 'approved', 'fulfilling', 'ready') then
    raise exception 'CARGA_STAGE: an order in % is not split', madre.stage;
  end if;
  contada := madre.actual_pallets is not null;
  total   := public.pallets_de_la_carga(madre);
  if total is null or total <= 0 then raise exception 'CARGA_NO_PALLETS: the order has no pallet count'; end if;
  if p_resto is null or p_resto <= 0 or p_resto >= total then
    raise exception 'CARGA_BAD_SPLIT: the remainder must be more than 0 and less than % (got %)', total, p_resto;
  end if;

  -- La letra: la madre se queda con la suya ('a' si nunca se partio); la nueva, la siguiente a la mayor de la
  -- familia (misma order_no, mismo is_training). 'a' + 1 = 'b'.
  letra := coalesce(madre.order_suffix, 'a');
  select chr(ascii(max(coalesce(d.order_suffix, 'a'))) + 1) into nueva
    from public.deliveries d where d.order_no = madre.order_no and d.is_training = madre.is_training;
  nueva := coalesce(nueva, 'b');
  if nueva > 'z' then raise exception 'CARGA_TOO_MANY: no letters left for #%', madre.order_no; end if;

  etiqueta := coalesce(madre.order_code, madre.order_no::text);
  fila := to_jsonb(madre) || jsonb_build_object(
    'id', nueva_id, 'order_suffix', nueva,
    'est_pallets', p_resto, 'actual_pallets', case when contada then p_resto else null end,
    'route_seq', null, 'pickup_seq', null, 'load_no', null, 'load_auto', false,
    'created_at', now(), 'updated_at', now(), 'created_by', auth.uid(),
    'pickup_lat', null, 'pickup_lng', null, 'pickup_gps_at', null, 'departed_at', null, 'arrived_at', null,
    'pod_received_by', null, 'pod_signature', null, 'pod_delivered_at', null, 'pod_lat', null, 'pod_lng', null, 'pod_accuracy', null,
    'photos', null, 'photo_meta', null, 'delivered_address', null, 'csat_rating', null, 'csat_comment', null,
    'delivery_notes', concat_ws(E'\n', madre.delivery_notes, format('Split of #%s%s at planning: %s of %s pallets.', etiqueta, letra, p_resto, total))
  );
  insert into public.deliveries select * from jsonb_populate_record(null::public.deliveries, fila);

  update public.deliveries
     set order_suffix   = letra,
         est_pallets    = case when contada then est_pallets else total - p_resto end,
         actual_pallets = case when contada then total - p_resto else actual_pallets end
   where id = p_id;

  insert into public.order_events (delivery_id, kind, note, created_by) values
    (p_id,     'edited',  format('Split at planning: %s of %s pallets stay as #%s%s; %s pallets go to #%s%s', total - p_resto, total, etiqueta, letra, p_resto, etiqueta, nueva), auth.uid()),
    (nueva_id, 'created', format('Split of #%s%s at planning: %s pallets', etiqueta, letra, p_resto), auth.uid());
  return nueva_id;
end $$;
revoke execute on function public.partir_carga(uuid, numeric) from public, anon;
grant execute on function public.partir_carga(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. reparte_cargas: cuantos pallets lleva cada una de DOS cargas hermanas, sin cambiar el total
-- ---------------------------------------------------------------------------
-- Invoker: dos UPDATE de misma etapa, con la RLS y el guard de quien llama. Cada fila escribe el campo que
-- tiene en uso (recuento si lo hay, si no estimacion).
create or replace function public.reparte_cargas(p_a uuid, p_b uuid, p_pallets_a numeric)
  returns void language plpgsql set search_path = public as $$
declare
  a      public.deliveries%rowtype;
  b      public.deliveries%rowtype;
  tmp    public.deliveries%rowtype;
  total  numeric;
  n      integer;
begin
  if auth.uid() is null or not public.puede_partir_cargas() then
    raise exception 'CARGA_FORBIDDEN: only admin, logistics or office split a load' using errcode = '42501';
  end if;
  if p_a = p_b then raise exception 'CARGA_SAME: the two loads are the same row'; end if;
  -- Siempre en el mismo orden, para que dos llamadas cruzadas no se esperen una a la otra.
  select * into a from public.deliveries d where d.id = least(p_a, p_b) for update;
  select * into b from public.deliveries d where d.id = greatest(p_a, p_b) for update;
  if a.id is null or b.id is null then raise exception 'CARGA_NOT_FOUND'; end if;
  if a.id <> p_a then tmp := a; a := b; b := tmp; end if;
  if a.order_no <> b.order_no or a.is_training <> b.is_training or a.order_suffix is null or b.order_suffix is null then
    raise exception 'CARGA_NOT_SIBLINGS: #% and #% are not loads of the same order', a.order_no, b.order_no;
  end if;
  if a.stage not in ('pending', 'approved', 'fulfilling', 'ready') or b.stage not in ('pending', 'approved', 'fulfilling', 'ready') then
    raise exception 'CARGA_STAGE: both loads must still be pending (%, %)', a.stage, b.stage;
  end if;
  total := coalesce(public.pallets_de_la_carga(a), 0) + coalesce(public.pallets_de_la_carga(b), 0);
  if p_pallets_a is null or p_pallets_a <= 0 or p_pallets_a >= total then
    raise exception 'CARGA_BAD_SPLIT: load a must take more than 0 and less than % (got %)', total, p_pallets_a;
  end if;
  update public.deliveries
     set est_pallets    = case when actual_pallets is null then p_pallets_a else est_pallets end,
         actual_pallets = case when actual_pallets is null then actual_pallets else p_pallets_a end
   where id = a.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CARGA_UNSEEN: load a could not be written'; end if;
  update public.deliveries
     set est_pallets    = case when actual_pallets is null then total - p_pallets_a else est_pallets end,
         actual_pallets = case when actual_pallets is null then actual_pallets else total - p_pallets_a end
   where id = b.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CARGA_UNSEEN: load b could not be written'; end if;
  insert into public.order_events (delivery_id, kind, note, created_by) values
    (a.id, 'edited', format('Loads re-split: #%s%s takes %s of %s pallets', coalesce(a.order_code, a.order_no::text), a.order_suffix, p_pallets_a, total), auth.uid()),
    (b.id, 'edited', format('Loads re-split: #%s%s takes %s of %s pallets', coalesce(b.order_code, b.order_no::text), b.order_suffix, total - p_pallets_a, total), auth.uid());
end $$;
revoke execute on function public.reparte_cargas(uuid, uuid, numeric) from public, anon;
grant execute on function public.reparte_cargas(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. juntar_cargas: los pallets de `p_b` vuelven a `p_a`, y `p_b` se borra
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, y SOLO por el DELETE: la politica de borrar (142) deja borrar borradores, y una carga que se
-- junta esta en pending/approved/fulfilling/ready. Por eso esta funcion comprueba por su cuenta lo que la RLS
-- comprobaria: quien llama (`puede_partir_cargas`), y que VE las dos filas con la misma clausula de tienda de la
-- politica de lectura (131: `tiendas_visibles()` sobre store, pickup_name y delivery_name). Si un dia esa clausula
-- cambia, cambia aqui; la autocomprobacion de abajo exige que la politica siga mirando `tiendas_visibles`.
-- El UPDATE de `p_a` sigue pasando por el guard (`auth.uid()` es el de quien llama). El DELETE dispara
-- `deliveries_guardar_borrada` (142): la fila, sus eventos y sus avisos quedan en `deliveries_borradas`.
create or replace function public.la_ve_quien_llama(d public.deliveries)
  returns boolean language sql stable security definer set search_path = public as $$
  select d.is_training
      or (select public.tiendas_visibles()) is null
      or btrim(coalesce(d.store, '')) = ''
      or lower(btrim(coalesce(d.store, ''))) = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(d.pickup_name, ''))) = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(d.delivery_name, ''))) = any ((select public.tiendas_visibles())::text[]);
$$;
-- Interna: la llama juntar_cargas (definer, como postgres). Supabase concede EXECUTE a authenticated por defecto
-- (default privileges), asi que el revoke tiene que nombrarla.
revoke execute on function public.la_ve_quien_llama(public.deliveries) from public, anon, authenticated;

create or replace function public.juntar_cargas(p_a uuid, p_b uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  a        public.deliveries%rowtype;
  b        public.deliveries%rowtype;
  de_b     numeric;
  quedan   integer;
  n        integer;
  tmp      public.deliveries%rowtype;
begin
  if auth.uid() is null or not public.puede_partir_cargas() then
    raise exception 'CARGA_FORBIDDEN: only admin, logistics or office join loads' using errcode = '42501';
  end if;
  if p_a = p_b then raise exception 'CARGA_SAME: the two loads are the same row'; end if;
  select * into a from public.deliveries d where d.id = least(p_a, p_b) for update;
  select * into b from public.deliveries d where d.id = greatest(p_a, p_b) for update;
  if a.id is null or b.id is null then raise exception 'CARGA_NOT_FOUND'; end if;
  if a.id <> p_a then tmp := a; a := b; b := tmp; end if;
  if not public.la_ve_quien_llama(a) or not public.la_ve_quien_llama(b) then raise exception 'CARGA_NOT_FOUND'; end if;
  if a.order_no <> b.order_no or a.is_training <> b.is_training or a.order_suffix is null or b.order_suffix is null then
    raise exception 'CARGA_NOT_SIBLINGS: #% and #% are not loads of the same order', a.order_no, b.order_no;
  end if;
  if a.stage not in ('pending', 'approved', 'fulfilling', 'ready') or b.stage not in ('pending', 'approved', 'fulfilling', 'ready') then
    raise exception 'CARGA_STAGE: both loads must still be pending (%, %)', a.stage, b.stage;
  end if;
  -- `photos` es jsonb (no text[], medido en el ensayo): se mira como array json.
  if (jsonb_typeof(b.photos) = 'array' and jsonb_array_length(b.photos) > 0) or b.pod_signature is not null or b.pickup_gps_at is not null then
    raise exception 'CARGA_STAGE: load b already has pickup or delivery proof';
  end if;
  de_b := coalesce(public.pallets_de_la_carga(b), 0);
  select count(*)::integer into quedan from public.deliveries d where d.order_no = a.order_no and d.is_training = a.is_training and d.id <> b.id;

  update public.deliveries
     set est_pallets    = case when actual_pallets is null then coalesce(est_pallets, 0) + de_b else est_pallets end,
         actual_pallets = case when actual_pallets is null then actual_pallets else actual_pallets + de_b end,
         -- Si no queda otra hermana, la orden vuelve a ser una orden sin letra.
         order_suffix   = case when quedan <= 1 then null else order_suffix end
   where id = a.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CARGA_UNSEEN: load a could not be written'; end if;
  delete from public.deliveries where id = b.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CARGA_UNSEEN: load b could not be deleted'; end if;
  insert into public.order_events (delivery_id, kind, note, created_by) values
    (a.id, 'edited', format('Loads joined: #%s%s takes back the %s pallets of #%s%s', coalesce(a.order_code, a.order_no::text), coalesce(a.order_suffix, ''), de_b, coalesce(b.order_code, b.order_no::text), b.order_suffix), auth.uid());
end $$;
revoke execute on function public.juntar_cargas(uuid, uuid) from public, anon;
grant execute on function public.juntar_cargas(uuid, uuid) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo: sobrevive a re-aplicar el fichero)
-- ===========================================================================
-- Se mira el CODIGO del guard sin sus lineas de comentario (leccion de la 144/145): un comentario que cite lo
-- que se busca haria pasar la comprobacion por lo que dice y no por lo que hace.
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  f      record;
  pol    text;
begin
  -- 1. El guard deja nacer una carga partida en pending, y sigue siendo el de la 145 en todo lo demas.
  if position('if NEW.order_suffix is not null then if r in (''warehouse'',''driver'',''logistics'',''manager'',''accounting'') and new_stage in (''ready'',''approved'',''fulfilling'',''pending'') then return NEW; end if;' in codigo) = 0 then
    raise exception '157: el guard no deja nacer una carga partida en pending';
  end if;
  if position('Not allowed to create this split load' in codigo) = 0
     or position('A delivered order is not canceled' in codigo) = 0
     or position('Who created an order is history' in codigo) = 0
     or position('145' in def) = 0 then
    raise exception '157: al guard le falta algo de la 145';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.guard_delivery_stage()'::regprocedure) is not true then
    raise exception '157: el guard tiene que seguir siendo security definer (lee profiles)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '157: el disparador deliveries_guard_stage no esta';
  end if;

  -- 2. Las funciones: partir y repartir NO definer (valen RLS y guard); juntar SI (borra), y mira la tienda.
  select p.prosecdef into f from pg_proc p where p.oid = 'public.partir_carga(uuid, numeric)'::regprocedure;
  if f.prosecdef then raise exception '157: partir_carga NO debe ser security definer'; end if;
  select p.prosecdef into f from pg_proc p where p.oid = 'public.reparte_cargas(uuid, uuid, numeric)'::regprocedure;
  if f.prosecdef then raise exception '157: reparte_cargas NO debe ser security definer'; end if;
  select p.prosecdef, pg_get_functiondef(p.oid) as def into f from pg_proc p where p.oid = 'public.juntar_cargas(uuid, uuid)'::regprocedure;
  if not f.prosecdef then raise exception '157: juntar_cargas tiene que ser security definer (la politica de borrar no deja)'; end if;
  if position('la_ve_quien_llama' in f.def) = 0 or position('puede_partir_cargas' in f.def) = 0 or position('delete from public.deliveries' in f.def) = 0 then
    raise exception '157: a juntar_cargas le falta la comprobacion de quien llama, la de tienda o el borrado';
  end if;
  foreach pol in array array['public.partir_carga(uuid, numeric)', 'public.reparte_cargas(uuid, uuid, numeric)', 'public.juntar_cargas(uuid, uuid)', 'public.puede_partir_cargas()'] loop
    if has_function_privilege('anon', pol, 'execute') then raise exception '157: anon no debe poder ejecutar %', pol; end if;
    if not has_function_privilege('authenticated', pol, 'execute') then raise exception '157: authenticated debe poder ejecutar %', pol; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.la_ve_quien_llama(public.deliveries)', 'execute') then
    raise exception '157: la_ve_quien_llama es interna: authenticated no la ejecuta';
  end if;

  -- 3. Lo que esta migracion NO toca sigue como estaba: la politica de borrar es la de la 142, la de lectura
  --    sigue mirando tiendas_visibles (juntar_cargas la replica), y no hay politica nueva sobre deliveries.
  select qual into pol from pg_policies where schemaname = 'public' and tablename = 'deliveries' and policyname = 'deliveries delete';
  if pol is null or position('is_admin' in pol) = 0 or position('draft' in pol) = 0 then
    raise exception '157: la politica de borrar ya no es la de la 142: %', pol;
  end if;
  select qual into pol from pg_policies where schemaname = 'public' and tablename = 'deliveries' and policyname = 'auth read deliveries';
  if pol is null or position('tiendas_visibles' in pol) = 0 then
    raise exception '157: la politica de lectura ya no mira tiendas_visibles: juntar_cargas se quedo con una copia vieja';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'deliveries') <> 4 then
    raise exception '157: deliveries tiene % politicas y tenia 4', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'deliveries');
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-157-partes-de-orden.md, seccion 6). Se pega en una transaccion abierta a
-- mano y se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui
-- abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   1. Volver a aplicar SOLO el bloque `create or replace function public.guard_delivery_stage() ... end
--      $function$;` de la 145_gerente_hace_bodega.sql (no el fichero entero: volveria a correr su
--      autocomprobacion y lo demas). Una carga partida deja de poder nacer en pending.
--   2. drop function if exists public.juntar_cargas(uuid, uuid);
--      drop function if exists public.reparte_cargas(uuid, uuid, numeric);
--      drop function if exists public.partir_carga(uuid, numeric);
--      drop function if exists public.la_ve_quien_llama(public.deliveries);
--      drop function if exists public.pallets_de_la_carga(public.deliveries);
--      drop function if exists public.puede_partir_cargas();
--   3. delete from public.schema_migrations where name = '157_partes_de_orden.sql';
-- Las cargas ya partidas se quedan: son ordenes (#Xa, #Xb) y se leen, mueven y marcan como cualquier otra. La
-- app sin las funciones vuelve a partir en cargas virtuales al "Armar rutas" (lo de hoy) y apaga los botones
-- de partir, repartir y juntar al recibir "funcion no encontrada" (PGRST202).

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('157_partes_de_orden.sql', 'cf3e7ebef2626a79675148174ff3a47b10d00d1fe46562b671bf64ddb4c1f639') on conflict (name) do nothing;
