-- ===========================================================================
-- 173 · «📅 Reprogramar» para todos (menos el chofer): la funcion `reprogramar_orden`
-- ===========================================================================
-- PEDIDO. El dueno, 2026-10-14: «reprogamar buttom in ther order view put it the top right hand side insead» y «all sales
-- people well everybody has the iption to reprogramar». (El numero no se escribe en el cuerpo a proposito, D-512: lo pone
-- el nombre del fichero.) Plan en papel: docs/PLAN-173-reprogramar-orden.md.
--
-- EL HUECO (medido en produccion el 2026-10-14 por el orquestador): el guard le contesta a un vendedor que cambia
-- `delivery_date` en su orden aprobada o lista «You cannot edit an order in the approved stage». El tramo «misma etapa»
-- del guard (169) solo le deja a ventas borrador/pendiente/rechazada (cualquier columna), la factura que falta (125) y
-- agregar material (138). La fecha, desde `approved`, no.
--
-- POR QUE NO BASTA UNA FUNCION SECURITY DEFINER (lo que se pidio): el guard es un disparador BEFORE UPDATE y mira
-- `auth.uid()` y `current_user_role()`, que salen del JWT de la PETICION, no del duenio de la funcion. Una funcion
-- definer que hace el UPDATE sigue pasando por el guard como el vendedor (lo dice la propia 157 de `juntar_cargas`:
-- «El UPDATE de `p_a` sigue pasando por el guard (`auth.uid()` es el de quien llama)»), y el guard la rechaza igual.
-- Por eso esta migracion hace DOS cosas:
--
--   1. `guard_delivery_stage`: la de la 169 LETRA POR LETRA con UN bloque mas (marcado "173") en el tramo «misma
--      etapa», despues del bloque 169 del chofer: si la transaccion lleva `rtg.reprogramar_orden` = el id de ESTA orden
--      (lo pone la funcion de abajo con set_config local, justo antes de su UPDATE) y lo UNICO que cambia es
--      `delivery_date` (mismo patron `probe` que 125/138/169), pasa. Un cliente no puede poner esa variable: PostgREST
--      no ejecuta SQL suelto, y ninguna otra funcion la escribe.
--   2. `reprogramar_orden(p_id, p_fecha, p_nota, p_lang)`: SECURITY INVOKER (no definer, a proposito): la lectura y la
--      escritura pasan por la RLS de quien llama (visibilidad por tienda, 131), y el UPDATE por el guard con su rol.
--      Comprueba quien y en que etapa (espejo de `puedeReprogramar`, src/lib/reprogramar-orden.ts):
--        - admin: borrador, pendiente, aprobada, preparando, lista, en camino, rechazada.
--        - logistica, gerente, oficina (logistics, manager, accounting): borrador a lista.
--        - almacen: aprobada, preparando, lista (D-534).
--        - ventas: SOLO su orden (la creo o es su vendedor, como `esMia` y el guard 125/138), borrador a lista.
--        - chofer y cualquier otro: no.
--      Entregada y anulada no se reprograman (nadie); en camino solo el admin.
--      Exige nota de 3 letras o mas (ya limpia) y una fecha que no sea anterior a hoy (America/Chicago) y que no sea la
--      que ya tiene. Cambia SOLO `delivery_date` (asi el disparador de la 172, si esta aplicada, saca la orden de la ruta
--      del chofer) y deja en `order_events`, como `quien llama`, los dos eventos que dejaba la pantalla: el «edited» con
--      el valor de antes y el de despues (formato de `changedFieldsNote`) y la nota (formato de `notaDeReprogramacion`).
--
-- QUE NO HACE: no toca la RLS, ni INSERT, ni ningun cambio de etapa, ni ninguna otra columna. Las demas ramas del guard
-- quedan letra por letra. No le da nada al chofer.
--
-- Sin begin/commit (memoria «una migracion no lleva su propia transaccion»): quien aplica envuelve el fichero.
--
-- Reversion: ver docs/PLAN-173-reprogramar-orden.md (volver a aplicar SOLO el bloque `create or replace function ...
-- end $function$;` de la 169, `drop function public.reprogramar_orden(uuid, date, text, text);` y borrar la fila del
-- registro). Las fechas ya cambiadas se quedan: su valor anterior esta en el evento «edited».

-- ===========================================================================
-- 1. El guard, desde la definicion VIGENTE (la de la 169) con un bloque marcado "173"
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

-- ===========================================================================
-- 2. La funcion
-- ===========================================================================
create or replace function public.reprogramar_orden(p_id uuid, p_fecha date, p_nota text, p_lang text default 'es')
  returns void
  language plpgsql
  security invoker
  set search_path = public
as $function$
declare
  yo     uuid := auth.uid();
  r      text := public.current_user_role();
  limpia text := btrim(regexp_replace(coalesce(p_nota, ''), '\s+', ' ', 'g'));
  hoy    date := (now() at time zone 'America/Chicago')::date;
  o      record;
  filas  integer;
  de     text;
begin
  if yo is null then
    raise exception 'REPROGRAMAR_SIN_SESION: sign in first' using errcode = '42501';
  end if;

  select d.id, d.stage, d.delivery_date, d.created_by, d.assigned_sales_rep
    into o
    from public.deliveries d
   where d.id = p_id;
  if not found then
    raise exception 'REPROGRAMAR_NO_EXISTE: order not found' using errcode = 'P0002';
  end if;

  if not (
       (r = 'admin' and o.stage in ('draft','pending','approved','fulfilling','ready','picked_up','rejected'))
    or (r in ('logistics','manager','accounting') and o.stage in ('draft','pending','approved','fulfilling','ready'))
    or (r = 'warehouse' and o.stage in ('approved','fulfilling','ready'))
    or (r = 'sales' and o.stage in ('draft','pending','approved','fulfilling','ready')
        and (o.created_by = yo or o.assigned_sales_rep = yo))
  ) then
    raise exception 'REPROGRAMAR_NO_PERMITIDO: % cannot reschedule this order in the % stage', coalesce(r, 'nobody'), o.stage
      using errcode = '42501';
  end if;

  if p_fecha is null or p_fecha < hoy then
    raise exception 'REPROGRAMAR_FECHA_PASADA: pick today or a later date' using errcode = '22023';
  end if;
  if o.delivery_date is not distinct from p_fecha then
    raise exception 'REPROGRAMAR_MISMA_FECHA: the order already has that date' using errcode = '22023';
  end if;
  if char_length(limpia) < 3 then
    raise exception 'REPROGRAMAR_SIN_NOTA: write why it is moving (3 letters or more)' using errcode = '22023';
  end if;

  -- La marca que el guard (bloque 173) reconoce, solo para ESTA orden y solo en esta transaccion.
  perform set_config('rtg.reprogramar_orden', p_id::text, true);
  update public.deliveries set delivery_date = p_fecha where id = p_id;
  get diagnostics filas = row_count;
  perform set_config('rtg.reprogramar_orden', '', true);
  if filas <> 1 then
    raise exception 'REPROGRAMAR_NO_GUARDADA: the order was not updated' using errcode = 'P0002';
  end if;

  de := coalesce(o.delivery_date::text, case when p_lang = 'en' then 'no date' else 'sin fecha' end);
  insert into public.order_events (delivery_id, kind, note, created_by)
    values (p_id, 'edited', 'Changed: Delivery Date: ' || coalesce(o.delivery_date::text, '—') || ' → ' || p_fecha::text, yo);
  insert into public.order_events (delivery_id, kind, note, created_by)
    values (p_id, 'note',
            case when p_lang = 'en'
                 then 'Rescheduled from ' || de || ' to ' || p_fecha::text || ': ' || limpia
                 else 'Reprogramada de ' || de || ' a ' || p_fecha::text || ': ' || limpia end,
            yo);
end $function$;

revoke execute on function public.reprogramar_orden(uuid, date, text, text) from public, anon;
grant execute on function public.reprogramar_orden(uuid, date, text, text) to authenticated;

-- ===========================================================================
-- Autocomprobacion (mira el catalogo: sobrevive a re-aplicar el fichero)
-- ===========================================================================
-- Se mira el CODIGO del guard sin sus lineas de comentario (leccion de la 144/145).
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  fdef   text := pg_get_functiondef('public.reprogramar_orden(uuid, date, text, text)'::regprocedure);
begin
  if position('if current_setting(''rtg.reprogramar_orden'', true) = OLD.id::text then probe := NEW; probe.delivery_date := OLD.delivery_date; probe.updated_at := OLD.updated_at; if probe is not distinct from OLD then return NEW; end if; end if;' in codigo) = 0 then
    raise exception '173: el guard no reconoce la marca de reprogramar_orden';
  end if;
  -- Lo de la 169 y lo de antes sigue ahi.
  if position('probe.photos := OLD.photos; probe.photo_meta := OLD.photo_meta;' in codigo) = 0
     or position('or (r = ''driver'' and old_stage in (''approved'',''fulfilling'') and new_stage = ''picked_up'' and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))' in codigo) = 0
     or position('Not allowed to create this split load' in codigo) = 0
     or position('A delivered order is not canceled' in codigo) = 0
     or position('Who created an order is history' in codigo) = 0
     or position('raise exception ''You cannot edit an order in the % stage'', old_stage;' in codigo) = 0 then
    raise exception '173: al guard le falta algo de la 169';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.guard_delivery_stage()'::regprocedure) is not true then
    raise exception '173: el guard tiene que seguir siendo security definer (lee profiles)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '173: el disparador deliveries_guard_stage no esta';
  end if;
  -- La funcion: invoker, solo para authenticated, y con sus comprobaciones.
  if (select p.prosecdef from pg_proc p where p.oid = 'public.reprogramar_orden(uuid, date, text, text)'::regprocedure) then
    raise exception '173: reprogramar_orden NO debe ser security definer (la RLS de quien llama tiene que mandar)';
  end if;
  if has_function_privilege('anon', 'public.reprogramar_orden(uuid, date, text, text)', 'execute') then
    raise exception '173: anon no debe poder ejecutar reprogramar_orden';
  end if;
  if not has_function_privilege('authenticated', 'public.reprogramar_orden(uuid, date, text, text)', 'execute') then
    raise exception '173: authenticated tiene que poder ejecutar reprogramar_orden';
  end if;
  if position('REPROGRAMAR_NO_PERMITIDO' in fdef) = 0 or position('REPROGRAMAR_SIN_NOTA' in fdef) = 0
     or position('REPROGRAMAR_FECHA_PASADA' in fdef) = 0 or position('America/Chicago' in fdef) = 0 then
    raise exception '173: a reprogramar_orden le falta una comprobacion';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (para pegar A MANO en una transaccion abierta; este fichero no lo ejecuta).
-- La matriz completa, en docs/PLAN-173-reprogramar-orden.md.
-- ===========================================================================
--   R1 ventas, SU orden 'approved', manana, nota 'cliente cerro'  -> pasa; delivery_date cambia; 2 eventos
--   R2 ventas, orden de OTRO vendedor 'approved'                   -> REPROGRAMAR_NO_PERMITIDO
--   R3 ventas, SU orden 'picked_up' / 'delivered' / 'canceled'     -> REPROGRAMAR_NO_PERMITIDO
--   R4 chofer, cualquier orden                                     -> REPROGRAMAR_NO_PERMITIDO
--   R5 almacen 'pending'                                           -> REPROGRAMAR_NO_PERMITIDO; 'ready' -> pasa
--   R6 cualquiera: fecha de ayer / la misma fecha / nota 'x'       -> FECHA_PASADA / MISMA_FECHA / SIN_NOTA
--   R7 ventas, SU orden 'approved', UPDATE directo de delivery_date (sin la funcion) -> "You cannot edit an order in the approved stage", como hoy
--   R8 ventas: select set_config('rtg.reprogramar_orden', '<id>', true); update ... set delivery_date = ..., contact = 'x' -> rechazado (otra columna)

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('173_reprogramar_orden.sql', 'b7d46ffdce473234b1a3d0b307ae9d567b66dc344499917bde40c285fa87c112') on conflict (name) do nothing;
