-- ===========================================================================
-- 168 · El chofer recoge una orden aunque el almacen no la haya marcado lista, con una nota
-- ===========================================================================
-- PEDIDO. El dueno, 2026-10-11: "have the driver be able to override a pickup even if the warheouse doesnt have it
-- ready just put a note down for it". (Su decision es la de la rama feat/recogida-chofer. El numero no se escribe aqui a
-- proposito: numerarla despues cambiaria el cuerpo y con el el checksum de la linea de registro, D-512.)
--
-- EL HUECO. El guard vigente (157, que es la 145 con una lista cambiada) deja al chofer, entre etapas, solo:
-- ready -> picked_up, picked_up -> delivered y picked_up -> ready. Una orden en 'approved' o 'fulfilling' -- aprobada,
-- el almacen la esta preparando o aun no empezo -- no la puede recoger aunque tenga el material delante: la base contesta
-- "driver cannot move an order from approved to picked_up".
--
-- QUE HACE: redefine `guard_delivery_stage` copiando la de la 157 LETRA POR LETRA y anadiendo UNA clausula (marcada
-- "168") en la rama de sales/driver/manager/accounting:
--
--   or (r = 'driver' and old_stage in ('approved','fulfilling') and new_stage = 'picked_up'
--       and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))
--
--   - Solo el chofer, y solo SU orden: la que ya tenia asignada ANTES de esta escritura (OLD). Una orden sin chofer no
--     entra (la recogida normal de 'ready' si la reclama, `claimDelChofer`; aqui no hace falta: "Mi ruta" solo pinta
--     las asignadas).
--   - `assigned_driver` es TEXTO con el nombre del chofer (014; 128 y 133 lo comprueban), no un uuid. Compararlo con
--     `auth.uid()` a pelo no daria falso: reventaria con "operator does not exist: text = uuid" al evaluar la
--     condicion, y como va dentro de UNA expresion con todas las demas, cualquier cambio de etapa de ventas, chofer,
--     gerente u office fallaria. Por eso se compara con el full_name de quien escribe, como la politica de lectura.
--   - La nota obligatoria NO la puede exigir la base: va en `order_events`, que la app escribe despues de la etapa. La
--     exige la pantalla (`notaSinListoValida`, 3 letras), como la razon de un rechazo (D-487).
--
-- QUE NO HACE: no toca ninguna otra rama del guard (almacen, logistica, gerente, office, la anulacion, los borradores,
-- las cargas partidas). No crea tabla, columna, politica ni disparador. No toca ningun dato: ninguna fila cambia al
-- aplicarla. Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion (paso con la 124).
--
-- DE DONDE SALE EL CUERPO: de la 157, que es la ultima migracion que define el guard. Una prueba del repo
-- (src/lib/recogida-del-chofer.test.ts) compara los dos bloques linea a linea: todo igual salvo la clausula nueva.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- El guard, desde la definicion VIGENTE (la de la 157) con una clausula marcada "168"
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
-- Se mira el CODIGO del guard sin sus lineas de comentario (leccion de la 144/145): un comentario que cite lo que se
-- busca haria pasar la comprobacion por lo que dice y no por lo que hace.
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
begin
  if position('or (r = ''driver'' and old_stage in (''approved'',''fulfilling'') and new_stage = ''picked_up'' and OLD.assigned_driver = (select p.full_name from public.profiles p where p.id = auth.uid()))' in codigo) = 0 then
    raise exception '168: el guard no deja al chofer recoger su orden sin estar lista';
  end if;
  if position('if r in (''warehouse'',''driver'',''logistics'',''manager'',''accounting'') and new_stage in (''ready'',''approved'',''fulfilling'',''pending'') then' in codigo) = 0
     or position('Not allowed to create this split load' in codigo) = 0
     or position('A delivered order is not canceled' in codigo) = 0
     or position('Who created an order is history' in codigo) = 0
     or position('or (r = ''driver'' and old_stage = ''ready'' and new_stage = ''picked_up'')' in codigo) = 0
     or position('or (r = ''driver'' and old_stage = ''picked_up'' and new_stage = ''ready'') then' in codigo) = 0
     or position('168' in def) = 0 then
    raise exception '168: al guard le falta algo de la 157';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.guard_delivery_stage()'::regprocedure) is not true then
    raise exception '168: el guard tiene que seguir siendo security definer (lee profiles)';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '168: el disparador deliveries_guard_stage no esta';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (para pegar A MANO en una transaccion abierta; este fichero no lo ejecuta)
-- ===========================================================================
--   E1 chofer, SU orden en 'approved'  -> update ... set stage = 'picked_up'          -> pasa
--   E2 chofer, SU orden en 'fulfilling'-> lo mismo                                   -> pasa
--   E3 chofer, orden de OTRO chofer en 'approved' (o sin chofer)                     -> "driver cannot move an order from approved to picked_up"
--   E4 chofer, SU orden en 'pending' o 'draft' -> 'picked_up'                        -> rechazado (no esta aprobada)
--   E5 chofer, SU orden en 'approved' -> 'delivered' (saltandose la recogida)         -> rechazado
--   E6 almacen / logistica, 'approved' -> 'picked_up'                                -> rechazado, como antes
--   E7 chofer, ready -> picked_up / picked_up -> ready / picked_up -> delivered      -> pasan, como antes
--   E8 ventas y office cambian de etapa como antes (la expresion de su rama no revienta: la condicion nueva es texto = texto)

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   1. Volver a aplicar SOLO el bloque `create or replace function public.guard_delivery_stage() ... end
--      $function$;` de la 157_partes_de_orden.sql (no el fichero entero: volveria a correr su autocomprobacion y a
--      redefinir sus funciones). El chofer deja de poder recoger lo que no esta listo; la app le dice
--      "Aun no disponible: falta una actualizacion del sistema" en vez del error de la base.
--   2. delete from public.schema_migrations where name = '168_chofer_recoge_sin_listo.sql';
-- Las ordenes que ya se recogieron sin estar listas se quedan como estan: son ordenes en reparto como cualquier otra, y
-- su evento dice "Recogida sin estar lista: <nota>".

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('168_chofer_recoge_sin_listo.sql', '681337b77c1b43d564ae9fd695e12bf62f28342ac223fb72818a652a2670cfeb') on conflict (name) do nothing;
