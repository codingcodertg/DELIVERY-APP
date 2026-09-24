-- 142 - Almacen deshace un paso en sus tiendas, y borrar pasa a ser del borrador propio
-- ===========================================================================
-- El dueno, literal: "deja que warehouse y office tengan la opcion de deshacer un stage, como por
-- ejemplo deshacer un delivered o un fulfilling o un ready; y tambien que los draft, si no los
-- ocupan, los puedan borrar o seguir editando; igual las duplicadas".
--
-- Plan en papel: docs/PLAN-142-deshacer-y-borradores.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- Lo que ya habia, medido en el repo antes de escribir esto:
--   - Office (`accounting`) y gerente deshacen un paso desde la 139 (D-361). No les falta nada de
--     deshacer: esta migracion no toca su rama.
--   - Almacen YA podia en la base ready->fulfilling, picked_up->ready y delivered->picked_up (138/139),
--     en CUALQUIER tienda y sin motivo. En pantalla solo tenia ready->fulfilling (D-287).
--   - Borrar: "deliveries delete" (131:195, la unica migracion que la toca) deja borrar cualquier orden
--     que se vea a cualquiera con el modulo de Entregas. No hay trigger de DELETE: el guard es
--     BEFORE INSERT OR UPDATE. La pantalla solo ensena el boton al admin (OrderModal.tsx:2435).
--     Y order_events cuelga de deliveries con ON DELETE CASCADE (schema.sql:129): borrar una orden
--     borra tambien su historial "append-only" (100), sin dejar rastro en ningun sitio.
--
-- Que trae, y SOLO esto:
--   1. ALMACEN DESHACE UN PASO, SOLO EN ORDENES DE SUS TIENDAS (la suya y las de su grupo, D-293):
--        delivered->picked_up y ready->fulfilling (ya los tenia, ahora acotados a su tienda) y
--        fulfilling->approved (nuevo). approved->pending NO: eso es de quien aprueba, y ademas
--        almacen dejaria de ver la orden (131: su lectura empieza en approved).
--      picked_up->ready se queda COMO ESTABA, sin tienda: es tambien "Dejar en tienda" (D-224), que
--      el almacen hace como chofer y que cambia la tienda de la orden en la misma escritura.
--   2. QUIEN CREO LA ORDEN NO SE REESCRIBE. Sin esto la regla 3 es decoracion: hoy ventas puede
--      poner `created_by` = si mismo en el borrador de otro (el tramo de misma etapa no mira columnas)
--      y despues borrarlo. En INSERT la base pone `created_by := auth.uid()` (como canceled_by en la
--      122); en UPDATE, cambiarlo se rechaza. El admin queda fuera, como en todo el guard.
--   3. BORRAR: el admin, cualquier orden (como hoy); cualquier otro, SOLO SU PROPIO BORRADOR
--      (stage 'draft' y created_by = el). Nadie mas borra nada.
--
-- Lo que NO cambia:
--   - Office y gerente: identicos (139). Ventas, chofer y logistica: identicos, salvo que ya no
--     pueden reescribir created_by ni borrar lo que no es su borrador.
--   - Almacen hacia delante: identico y en cualquier tienda.
--   - La invariante de la 122 (una entregada no se anula) sigue ANTES de la salida de admin.
--   - Ninguna columna nueva, ninguna fila escrita.
--
-- El MOTIVO obligatorio del deshacer lo pide la pantalla y viaja en la nota de order_events, como en
-- la 139: la base no lo comprueba. Esta dicho en el plan como no cubierto por la base.
--
-- Se parte de la definicion VIGENTE del guard, la de la 139 (pg_get_functiondef), no de la que lo
-- creo: create or replace reemplaza la funcion entera. El bloque de comprobacion lo verifica.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ===========================================================================
-- Las tiendas de QUIEN ESCRIBE, contra las de la orden
-- ===========================================================================
-- El mismo corte que la cola de almacen en pantalla (warehouse/page.tsx: tiendasDelGrupo + atStore):
-- su tienda (profiles.store) y las que comparten su grupo (settings.stores[*].group, D-293), contra
-- las tres columnas de tienda de la orden -- store, pickup_name, delivery_name, como la 131 -- o la
-- direccion de recogida igual a la de una de sus tiendas.
--
-- Mira las tres columnas SIN mirar el tipo de orden, que es mas ancho que la pantalla (esta solo
-- mira delivery_name en tienda-a-tienda). A proposito, como en la 131: un guard mas ANCHO que la
-- pantalla no produce un boton que la base rechace (D-044); uno mas estrecho si.
--
-- Sin tienda propia devuelve false: almacen sin tienda no deshace. Falla cerrado, y la pantalla
-- tiene que decir lo mismo (no ensenar el boton si me.store esta vacio).
--
-- Normaliza como `nombreNormalizado`/`normalizaLugar` (store-pins.ts, order-endpoints.ts): espacios
-- colapsados, recortada, en minusculas. El grupo, como `grupoNormalizado` (store-group.ts): recortado
-- y en minusculas.
create or replace function public.orden_de_mis_tiendas(
  p_store text, p_pickup_name text, p_delivery_name text, p_pickup_address text)
  returns boolean language sql stable security definer set search_path = public as $$
  with
  yo as (
    select lower(btrim(regexp_replace(coalesce(p.store, ''), '\s+', ' ', 'g'))) as tienda
      from public.profiles p
     where p.id = auth.uid()
  ),
  catalogo as (
    select lower(btrim(regexp_replace(coalesce(e->>'name', ''), '\s+', ' ', 'g'))) as nombre,
           lower(btrim(coalesce(e->>'group', '')))                                 as grupo,
           btrim(coalesce(e->>'address', ''))                                      as direccion
      from public.settings s, jsonb_array_elements(coalesce(s.stores, '[]'::jsonb)) as e
  ),
  mi_grupo as (
    select c.grupo from catalogo c, yo where c.nombre = yo.tienda and c.grupo <> '' limit 1
  ),
  mias as (
    -- La propia SIEMPRE, aunque ya no este en Ajustes (tiendasDelGrupo hace lo mismo).
    select yo.tienda as nombre, ''::text as direccion from yo where yo.tienda <> ''
    union
    select c.nombre, c.direccion
      from catalogo c, yo
     where yo.tienda <> ''
       and (c.nombre = yo.tienda or c.grupo = (select g.grupo from mi_grupo g))
  )
  select exists (
    select 1
      from mias m
     where (m.nombre <> ''
            and m.nombre in (lower(btrim(regexp_replace(coalesce(p_store, ''), '\s+', ' ', 'g'))),
                             lower(btrim(regexp_replace(coalesce(p_pickup_name, ''), '\s+', ' ', 'g'))),
                             lower(btrim(regexp_replace(coalesce(p_delivery_name, ''), '\s+', ' ', 'g')))))
        or (m.direccion <> '' and m.direccion = btrim(coalesce(p_pickup_address, '')))
  );
$$;

revoke execute on function public.orden_de_mis_tiendas(text, text, text, text) from public, anon;

-- ===========================================================================
-- El guard, desde la definicion VIGENTE (la de la 139) con dos cambios marcados "142"
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
-- Borrar: el admin, cualquiera; los demas, solo su propio borrador
-- ===========================================================================
-- Definicion vigente, la de 131_visibilidad_por_tienda.sql:195 (ninguna migracion posterior la toca):
--   create policy "deliveries delete" on public.deliveries
--     for delete to authenticated
--     using ((select public.has_deliveries_access()));
--
-- `alter policy` y no drop+create: no hay ni un instante sin politica.
--
-- Un DELETE que la politica no deja pasar NO da error: borra cero filas y vuelve limpio. La pantalla
-- tiene que pedir `.select("id")` y mirar cuantas volvieron (hoy `deleteDelivery` no lo hace y quita
-- la fila de la lista de todas formas: con el boton solo para admin no se notaba).
--
-- Office NO borra los borradores de otros: puede anularlos con motivo (draft->canceled, 118/122), que
-- deja rastro. Si el dueno lo quiere, es una linea mas -- esta escrita comentada en el plan.
alter policy "deliveries delete" on public.deliveries
  using (
    (select public.has_deliveries_access())
    and (
      (select public.is_admin())
      or (stage = 'draft' and created_by = (select auth.uid()))
    )
  );

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $chk$
declare
  def text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  pol text;
begin
  -- Lo que trae la 142.
  if position('or (old_stage = ''fulfilling'' and new_stage = ''approved'')) then' in def) = 0
     or position('public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address)' in def) = 0 then
    raise exception '142: falta el deshacer de almacen acotado a su tienda';
  end if;
  if position('NEW.created_by := auth.uid();' in def) = 0
     or position('Who created an order is history' in def) = 0 then
    raise exception '142: falta el candado de created_by';
  end if;
  -- El candado va DESPUES de la salida de admin (el admin sigue pudiendo corregirlo).
  if position('NEW.created_by := auth.uid();' in def) < position('if r = ''admin'' then return NEW; end if;' in def) then
    raise exception '142: el candado de created_by quedo antes de la salida de admin';
  end if;
  -- Y que no se perdio nada de las anteriores (la lista de la 139, mas la 139).
  if position('new_stage = ''delivered'' and old_stage in (''approved'',''fulfilling'',''ready'',''picked_up'')' in def) = 0 then
    raise exception '142: se perdio el entregar ya de la 139';
  end if;
  if position('(old_stage = ''fulfilling'' and new_stage = ''approved'') then return NEW; end if;' in def) = 0 then
    raise exception '142: se perdio el deshacer de office de la 139';
  end if;
  if position('invoices_extra' in def) = 0 then raise exception '142: se perdio lo de la 138'; end if;
  if position('probe.invoice_num := OLD.invoice_num;' in def) = 0 then raise exception '142: se perdio lo de la 125'; end if;
  if position('account_requires_approval(NEW.account)' in def) = 0 then raise exception '142: se perdio lo de la 123'; end if;
  if position('A delivered order is not canceled' in def) = 0 then raise exception '142: se perdio lo de la 122'; end if;
  if position('old_stage in (''draft'',''rejected'') and new_stage = ''approved''' in def) = 0 then raise exception '142: se perdio lo de la 127'; end if;
  if position('A delivered order is not canceled' in def) > position('if r = ''admin'' then return NEW; end if;' in def) then
    raise exception '142: la invariante de la anulacion quedo despues de la salida de admin';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '142: el disparador no esta';
  end if;
  if to_regprocedure('public.orden_de_mis_tiendas(text, text, text, text)') is null then
    raise exception '142: falta orden_de_mis_tiendas';
  end if;

  -- La politica de borrar dice lo que tiene que decir...
  select qual into pol from pg_policies
   where schemaname = 'public' and tablename = 'deliveries' and policyname = 'deliveries delete';
  if pol is null or position('is_admin' in pol) = 0 or position('draft' in pol) = 0 or position('created_by' in pol) = 0 then
    raise exception '142: la politica de borrar no quedo como se esperaba: %', pol;
  end if;
  -- ...y es la UNICA que otorga DELETE. Las permisivas se suman con OR: una ALL o una DELETE mas
  -- volveria a abrir el borrado a cualquiera, y no se notaria.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'deliveries'
                and permissive = 'PERMISSIVE' and cmd in ('ALL', 'DELETE')
                and policyname <> 'deliveries delete') then
    raise exception '142: otra politica otorga DELETE sobre deliveries';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz completa, con los datos de prueba que se crean DENTRO de la transaccion, esta en el plan
-- (docs/PLAN-142-deshacer-y-borradores.md, seccion 6). Se pega en una transaccion abierta a mano y
-- se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui
-- abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   -- 1. El guard, tal como lo dejo la 139: volver a correr SOLO su `create or replace function
--   --    public.guard_delivery_stage()` (de 139_office_entrega_y_deshace.sql, entero).
--   -- 2. La politica de borrar, tal como la dejo la 131:
--   alter policy "deliveries delete" on public.deliveries
--     using ((select public.has_deliveries_access()));
--   -- 3. La funcion nueva (despues del paso 1: el guard de la 142 la llama).
--   drop function if exists public.orden_de_mis_tiendas(text, text, text, text);
--   -- 4. La fila del registro.
--   delete from public.schema_migrations where name = '142_deshacer_almacen_y_borrar_borradores.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('142_deshacer_almacen_y_borrar_borradores.sql', 'e1aec446c54171bc5b6e6b2f628553641bbc6cf0772199ef1ed18410193aa07c') on conflict (name) do nothing;
