-- 138 - Ventas agrega material a una orden ya hecha
-- ===========================================================================
-- Un vendedor, literal: "A veces agendo un Delivery pero luego el cliente me solicita mas material.
-- Para enviarlo con el mismo envio quiero que agregues la opcion de 'editar' pero no voy a poder
-- editar sino que voy a poder agregar mas facturas e incrementar # de Pallets".
--
-- Dos cosas y SOLO esas dos, en una orden suya que ya existe: anadir facturas y subir pallets.
-- Plan en papel: docs/PLAN-138-agregar-material.md
--
-- Que trae:
--   1. La columna `deliveries.invoices_extra text[] not null default '{}'`.
--   2. El guard, con un bloque nuevo para ventas. Se parte de la definicion VIGENTE, la de la 127.
--
-- POR QUE VAN JUNTAS: la columna sin el guard es un agujero. `profiles update self or admin` y las
-- politicas de `deliveries` dejan a ventas escribir su propia orden; lo unico que limita QUE columnas
-- es este disparador. Una columna nueva que el guard no nombra es una columna que cualquiera con el
-- modulo puede escribir a su gusto. Es la leccion de la 131.
--
-- POR QUE `invoice_num` NO SE TOCA: la leen trece sitios (comprobante, hoja de carga, manifiesto, la
-- columna y el agrupado de la tabla, el documento que exige el tipo, la pestana de factura pendiente
-- de D-338, la captura desde la fila, el control de duplicados, la busqueda, el CSV, duplicar y las
-- pantallas). Meter varios numeros separados por comas ahi los rompe a TODOS en silencio: ninguno
-- falla y todos funcionan mal. La lista nueva va aparte y `invoice_num` sigue significando lo mismo.
--
-- MEDIDO ANTES (2026-09-19, produccion, solo lectura): 15 ordenes ya llevan varios numeros metidos a
-- mano en `invoice_num` con separadores (, ; / + "y" "and"), 2 de ellas vivas. NO se migran y no se
-- tocan. Lo unico que se exige del lado del codigo es que quien enseñe las facturas no presuma que
-- `invoice_num` es un solo numero: lo enseña tal cual.
--
-- Reversion: al final de este fichero.
-- Sin transaccion propia: la pone quien aplica.
-- ===========================================================================

-- ===========================================================================
-- 1. La columna
-- ===========================================================================
-- `not null default '{}'` para que no haya nulo que tratar: ni en el guard, ni en el cliente. Postgres
-- rellena las filas que ya existen con el default, asi que ninguna queda en null.
alter table public.deliveries
  add column if not exists invoices_extra text[] not null default '{}'::text[];

comment on column public.deliveries.invoices_extra is
  'Facturas ANADIDAS despues de crear la orden (D-NEXT). La primera sigue siendo invoice_num, y nada de lo que la lee cambia. Solo crece: ventas anade, nadie quita. Maximo 20, cada una <= 40 caracteres, sin blancos.';

-- ===========================================================================
-- 2. El guard, con el bloque nuevo
-- ===========================================================================
-- Cuerpo copiado de 127_borrador_enviado_nace_aprobado.sql, que es la definicion VIGENTE, mas el
-- bloque de ventas. La autocomprobacion de abajo exige que siga dentro lo de la 127, la 125, la 123
-- y la 122: `create or replace` reemplaza la funcion ENTERA y partir de una copia vieja las borra.
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
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries' and column_name = 'invoices_extra') then
    raise exception '138: no esta la columna invoices_extra';
  end if;
  if position('invoices_extra' in def) = 0 then
    raise exception '138: el guard no nombra invoices_extra: la columna seria de escritura libre';
  end if;
  if position('probe.est_pallets       := OLD.est_pallets;' in def) = 0 then
    raise exception '138: falta el bloque de agregar material';
  end if;
  -- Y que no se perdio nada de las anteriores.
  if position('probe.invoice_num := OLD.invoice_num;' in def) = 0 then raise exception '138: se perdio lo de la 125'; end if;
  if position('account_requires_approval(NEW.account)' in def) = 0 then raise exception '138: se perdio lo de la 123'; end if;
  if position('A delivered order is not canceled' in def) = 0 then raise exception '138: se perdio lo de la 122'; end if;
  if position('old_stage in (''draft'',''rejected'') and new_stage = ''approved''' in def) = 0 then raise exception '138: se perdio lo de la 127'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '138: el disparador no esta';
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK  (15 casos)
-- ===========================================================================
-- Todo dentro de transacciones que se deshacen: no deja filas y no cambia nada. <uuid-...> son
-- cuentas reales de `public.profiles` y <orden-...> ordenes reales.
--
--   OJO AL ELEGIR AL VENDEDOR: tiene que tener 'deliveries' en `module_access` Y ser el dueno de
--   <orden-suya-approved> (`created_by` o `assigned_sales_rep`). Con una cuenta que no cumpla lo
--   primero, `has_deliveries_access()` ya devuelve false y TODOS los casos dan 0 filas: el ensayo
--   saldria "bien" sin haber medido nada. Es la leccion de la 131.
--
--   Y HACEN FALTA CUATRO ORDENES distintas, leidas antes:
--     select id, order_no, stage, invoice_num, est_pallets, invoices_extra, created_by, assigned_sales_rep
--       from public.deliveries
--      where stage in ('pending','approved','fulfilling','ready','canceled')
--      order by updated_at desc limit 40;
--   <orden-suya-approved>  suya, en 'approved'
--   <orden-suya-ready>     suya, en 'ready'
--   <orden-suya-canceled>  suya, anulada
--   <orden-de-otro>        de OTRO vendedor, en 'approved'
--
--   -- 0. Control: la ve. Sin esto, un 0 filas mas abajo no distingue "prohibido" de "no la ve".
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select count(*) from public.deliveries where id = '<orden-suya-approved>';   -- 1
--   rollback;
--
--   -- 1. Anade una factura a SU orden aprobada.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = invoices_extra || array['ENSAYO-1']
--    where id = '<orden-suya-approved>';                                          -- 1 fila
--   rollback;
--
--   -- 2. Sube los pallets.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set est_pallets = coalesce(est_pallets,0) + 2
--    where id = '<orden-suya-approved>';                                          -- 1 fila
--   rollback;
--
--   -- 3. Las dos cosas y las duraciones, en UNA escritura (lo que hace la app).
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries
--      set invoices_extra    = invoices_extra || array['ENSAYO-3'],
--          est_pallets       = coalesce(est_pallets,0) + 2,
--          pickup_duration   = coalesce(pickup_duration,0) + 30,
--          delivery_duration = coalesce(delivery_duration,0) + 30
--    where id = '<orden-suya-approved>';                                          -- 1 fila
--   rollback;
--
--   -- 4. BAJAR los pallets: prohibido.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set est_pallets = greatest(coalesce(est_pallets,1) - 1, 0)
--    where id = '<orden-suya-approved>';                                          -- ERROR del guard
--   rollback;
--
--   -- 5. QUITAR una factura de la lista: prohibido. (Se anade una y se intenta dejarla vacia; las
--   --    dos escrituras van en la misma transaccion, asi que la primera vale y la segunda tiene
--   --    que reventar.)
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = array['ENSAYO-5'] where id = '<orden-suya-approved>';  -- 1 fila
--   update public.deliveries set invoices_extra = '{}'::text[]      where id = '<orden-suya-approved>';  -- ERROR
--   rollback;
--
--   -- 6. CAMBIAR una ya puesta, sin cambiar la longitud: prohibido (el prefijo deja de ser identico).
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = array['ENSAYO-6']  where id = '<orden-suya-approved>';  -- 1 fila
--   update public.deliveries set invoices_extra = array['OTRA-6']    where id = '<orden-suya-approved>';  -- ERROR
--   rollback;
--
--   -- 7. Colar otro campo en la misma escritura: prohibido.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries
--      set invoices_extra = invoices_extra || array['ENSAYO-7'], delivery_address = 'CAMBIADA'
--    where id = '<orden-suya-approved>';                                          -- ERROR del guard
--   rollback;
--
--   -- 8. Tocar `invoice_num`, que ya tiene valor: prohibido (la 125 solo abre la VACIA).
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoice_num = 'ENSAYO-8'
--    where id = '<orden-suya-approved>' and coalesce(btrim(invoice_num),'') <> '';  -- ERROR del guard
--   rollback;
--
--   -- 9. En una orden de OTRO vendedor: 0 filas (RLS) o error del guard. Las dos son correctas; lo
--   --    que no vale es 1 fila.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = invoices_extra || array['ENSAYO-9']
--    where id = '<orden-de-otro>';                                                -- 0 filas o ERROR
--   rollback;
--
--   -- 10. En una orden en 'ready': prohibido. Almacen ya conto pallets y monto el camion.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = invoices_extra || array['ENSAYO-10']
--    where id = '<orden-suya-ready>';                                             -- ERROR del guard
--   rollback;
--
--   -- 11. En una anulada: prohibido.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = invoices_extra || array['ENSAYO-11']
--    where id = '<orden-suya-canceled>';                                          -- ERROR del guard
--   rollback;
--
--   -- 12. `actual_pallets` es de almacen: prohibido para ventas.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set actual_pallets = coalesce(actual_pallets,0) + 1
--    where id = '<orden-suya-approved>';                                          -- ERROR del guard
--   rollback;
--
--   -- 13. El tope: 21 facturas, o una vacia, o una de 41 caracteres. Las tres, prohibidas.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = (select array_agg('F-' || g) from generate_series(1,21) g)
--    where id = '<orden-suya-approved>';                                          -- ERROR del guard
--   rollback;
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = array['  ']
--    where id = '<orden-suya-approved>';                                          -- ERROR del guard
--   rollback;
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoices_extra = array[repeat('X', 41)]
--    where id = '<orden-suya-approved>';                                          -- ERROR del guard
--   rollback;
--
--   -- 14. Lo de almacen NO se rompio: sigue escribiendo `actual_pallets` en su etapa.
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-almacen>","role":"authenticated"}';
--   update public.deliveries set actual_pallets = coalesce(actual_pallets,0)
--    where id = '<orden-suya-approved>';                                          -- 1 fila
--   rollback;
--
--   -- 15. El camino de la 125 sigue vivo: ventas rellena una factura VACIA en SU orden. Hace falta
--   --     una orden suya, no anulada y sin factura; si no hay ninguna, SE DICE y no se da por bueno.
--   --     select id from public.deliveries
--   --      where coalesce(btrim(invoice_num),'') = '' and stage not in ('draft','rejected','canceled')
--   --        and (created_by = '<uuid-vendedor>' or assigned_sales_rep = '<uuid-vendedor>') limit 1;
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   update public.deliveries set invoice_num = 'ENSAYO-15' where id = '<orden-suya-sin-factura>';  -- 1 fila
--   rollback;
--
-- ===========================================================================
-- Reversion
-- ===========================================================================
--   -- 1. El guard, con el cuerpo de la 127 tal cual (copiarlo de ese fichero). Revertir SOLO esto ya
--   --    cierra la escritura nueva aunque la columna siga: es la marcha atras rapida.
--   -- 2. Si ademas se quiere borrar el dato:
--   --    alter table public.deliveries drop column if exists invoices_extra;
--   -- 3. delete from public.schema_migrations where name = '138_agregar_material.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('138_agregar_material.sql', '728a063efa82da17df36032e53aaa74d51b07b31565b2224ee6a107fd9c5e330') on conflict (name) do nothing;
