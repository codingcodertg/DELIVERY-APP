-- 145 - El gerente hace el proceso de bodega: Preparar, Listo y Recogida, paso a paso
-- ===========================================================================
-- El dueno, literal (2026-09-25): "Como gerente quiero poder hacer el proceso de bodega cuando
-- necesario. Ahorita solo permite brincar a Delivered pero no me deja poner Prepare, Ready, Pickup,
-- etc. Esto es de office manager, hazlo".
--
-- Plan en papel: docs/PLAN-145-gerente-hace-bodega.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- Lo que ya habia, leido en el repo (142, la ultima que define el guard):
--   - El gerente (`manager`) y office (`accounting`) ENTREGAN YA desde approved, fulfilling, ready y
--     picked_up, y DESHACEN un paso (139, D-361). En cualquier tienda que vean.
--   - Hacia DELANTE, paso a paso, solo avanzan almacen (cualquier tienda, 142 linea 320) y, para
--     ready->picked_up y picked_up->delivered, el chofer. El gerente no: su rama de cambios de
--     etapa no tiene approved->fulfilling, fulfilling->ready ni ready->picked_up, y cae en
--     "manager cannot move an order from approved to fulfilling". Por eso "solo me deja brincar".
--   - picked_up->delivered YA lo tiene el gerente (es uno de los cuatro de "entregar ya").
--   - Lo que la recogida escribe ademas de la etapa (pickup_gps_at, pickup_lat/lng, actual_pallets,
--     order_suffix) y la carga partida (INSERT con order_suffix en 'ready') ya se lo deja la base al
--     gerente: la escritura va en la misma fila que el cambio de etapa, y el guard no mira columnas
--     en un cambio de etapa; el INSERT con order_suffix admite a 'manager' desde antes de la 139.
--
-- Que trae, y SOLO esto:
--   EL GERENTE AVANZA COMO ALMACEN: approved->fulfilling ("Preparar"), fulfilling->ready ("Listo") y
--   ready->picked_up ("Recogida"). Con picked_up->delivered, que ya tenia, recorre la cadena entera.
--
-- Dos decisiones, con su motivo:
--   1. SOLO `manager`, NO `accounting`. El dueno lo pidio para el Office Manager ("esto es de office
--      manager"). D-279 puso a office en las mismas listas que el gerente para CREAR y APROBAR (la
--      118); la 139 y la 142 tambien los tratan igual, pero eso fue porque el dueno los nombro a los
--      dos ("si office incluye al gerente"). Aqui no los nombro a los dos. Si office tambien debe
--      hacer bodega, es anadir 'accounting' a esta rama y a `haceBodega` en la app.
--   2. EN CUALQUIER TIENDA QUE VEA, no acotado a `orden_de_mis_tiendas` como el deshacer de almacen.
--      a) El gerente YA puede llevar una orden de approved a delivered de un salto en cualquier
--         tienda (139). Acotar los pasos intermedios no le quitaria nada: la dejaria entregar de golpe
--         en otra tienda pero no prepararla. Seria un limite que no limita.
--      b) Almacen avanza hacia delante en cualquier tienda (142: "hacia delante, identico y en
--         cualquier tienda"); lo que la 142 acoto por tienda fue el DESHACER de almacen, no el avanzar.
--      c) Medido el 2026-09-23 (D-377): 2 gerentes no tienen tienda. Con el limite, no podrian hacer
--         bodega en ninguna orden, y la pantalla tendria que esconderles los botones.
--
-- Lo que NO cambia:
--   - Office (`accounting`): identico a la 142. Sigue entregando ya y deshaciendo, sin avanzar.
--   - Almacen, chofer, ventas, logistica y admin: identicos.
--   - El deshacer de almacen, acotado a sus tiendas (142). El candado de created_by (142). La
--     invariante de la 122 (una entregada no se anula), ANTES de la salida de admin.
--   - Ninguna columna, tabla, politica ni funcion nueva. Solo el guard.
--
-- Lo que la base NO pide y la pantalla tampoco al gerente: firma, foto ni GPS. La recogida estampa
-- la hora y, si el navegador la da, la posicion (nunca bloquea; igual que para almacen). Entregar
-- sigue siendo el "entregar ya" de la 139, con motivo: sin POD.
--
-- Se parte de la definicion VIGENTE del guard, la de la 142 (su create or replace entero), no de
-- una anterior: create or replace reemplaza la funcion entera. El bloque de comprobacion lo verifica.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ===========================================================================
-- El guard, desde la definicion VIGENTE (la de la 142) con un cambio marcado "145"
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
-- Se comprueba a si misma
-- ===========================================================================
-- Se mira el CODIGO, sin las lineas de comentario (leccion de la 144): pg_get_functiondef devuelve el
-- cuerpo con sus comentarios dentro, y un comentario que cita lo que se busca haria pasar (o caer) la
-- comprobacion por lo que dice el comentario y no por lo que hace el codigo. Se quitan solo las
-- lineas que EMPIEZAN por `--`; la `n` de las banderas hace que `^` y `$` valgan por linea. Despues,
-- los espacios se colapsan a uno, para no depender de la alineacion de las columnas.
do $chk$
declare
  def    text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  codigo text := regexp_replace(regexp_replace(def, '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  bodega text := 'if r = ''manager'' and ((old_stage = ''approved'' and new_stage = ''fulfilling'') '
              || 'or (old_stage = ''fulfilling'' and new_stage = ''ready'') '
              || 'or (old_stage = ''ready'' and new_stage = ''picked_up'')) then return NEW; end if;';
  p_bodega  int;
  p_office  int;
  p_almacen int;
  n_prep    int;
begin
  -- Lo que trae la 145: la rama del gerente, entera y con su condicion de rol.
  p_bodega := position(bodega in codigo);
  if p_bodega = 0 then
    raise exception '145: falta la rama del gerente que hace bodega';
  end if;
  -- Dentro del sub-bloque de gerente y office (despues de su deshacer) y antes de la rama de almacen.
  p_office  := position('(old_stage = ''fulfilling'' and new_stage = ''approved'') then return NEW; end if;' in codigo);
  p_almacen := position('elsif r = ''warehouse'' then' in codigo);
  if p_office = 0 or p_almacen = 0 or not (p_office < p_bodega and p_bodega < p_almacen) then
    raise exception '145: la rama del gerente no quedo dentro del sub-bloque de gerente y office';
  end if;
  -- Y SOLO el gerente: "Preparar" sale exactamente dos veces en el codigo, la de almacen y la del
  -- gerente. Una tercera seria alguien mas avanzando (office, ventas...).
  n_prep := (length(codigo) - length(replace(codigo, 'old_stage = ''approved'' and new_stage = ''fulfilling''', '')))
            / length('old_stage = ''approved'' and new_stage = ''fulfilling''');
  if n_prep <> 2 then
    raise exception '145: approved->fulfilling aparece % veces en el guard; se esperaban 2 (almacen y gerente)', n_prep;
  end if;

  -- Que no se perdio nada de las anteriores.
  if position('public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address)' in codigo) = 0 then
    raise exception '145: se perdio el deshacer de almacen acotado a su tienda (142)';
  end if;
  if position('NEW.created_by := auth.uid();' in codigo) = 0
     or position('Who created an order is history' in codigo) = 0 then
    raise exception '145: se perdio el candado de created_by (142)';
  end if;
  if position('NEW.created_by := auth.uid();' in codigo) < position('if r = ''admin'' then return NEW; end if;' in codigo) then
    raise exception '145: el candado de created_by quedo antes de la salida de admin';
  end if;
  if position('new_stage = ''delivered'' and old_stage in (''approved'',''fulfilling'',''ready'',''picked_up'')' in codigo) = 0 then
    raise exception '145: se perdio el entregar ya de la 139';
  end if;
  if p_office = 0 then
    raise exception '145: se perdio el deshacer de office de la 139';
  end if;
  if position('invoices_extra' in codigo) = 0 then raise exception '145: se perdio lo de la 138'; end if;
  if position('probe.invoice_num := OLD.invoice_num;' in codigo) = 0 then raise exception '145: se perdio lo de la 125'; end if;
  if position('account_requires_approval(NEW.account)' in codigo) = 0 then raise exception '145: se perdio lo de la 123'; end if;
  if position('A delivered order is not canceled' in codigo) = 0 then raise exception '145: se perdio lo de la 122'; end if;
  if position('old_stage in (''draft'',''rejected'') and new_stage = ''approved''' in codigo) = 0 then raise exception '145: se perdio lo de la 127'; end if;
  if position('A delivered order is not canceled' in codigo) > position('if r = ''admin'' then return NEW; end if;' in codigo) then
    raise exception '145: la invariante de la anulacion quedo despues de la salida de admin';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '145: el disparador del guard no esta';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz completa, con los datos de prueba que se crean DENTRO de la transaccion, esta en el plan
-- (docs/PLAN-145-gerente-hace-bodega.md, seccion 6). Se pega en una transaccion abierta a mano y se
-- cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui
-- abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   -- 1. El guard, tal como lo dejo la 142: volver a correr SOLO su `create or replace function
--   --    public.guard_delivery_stage()` (de 142_deshacer_almacen_y_borrar_borradores.sql, entero,
--   --    desde `create or replace function public.guard_delivery_stage()` hasta `end $function$ ;`).
--   --    NO el fichero 142 entero: volveria a correr su alter policy y sus create table/trigger.
--   -- 2. La fila del registro.
--   delete from public.schema_migrations where name = '145_gerente_hace_bodega.sql';
--   -- 3. Comprobacion: la autocomprobacion de arriba (el do $chk$) tiene que FALLAR ahora con
--   --    "145: falta la rama del gerente que hace bodega", y la de la 142 volver a pasar.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('145_gerente_hace_bodega.sql', 'cad9cd1e2fff1cbbc716f8273e225133f9c808c4ccb58d77dda0512a79a6227a') on conflict (name) do nothing;
