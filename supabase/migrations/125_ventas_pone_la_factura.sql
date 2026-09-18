-- 125 · Ventas pone la factura que falta en SU orden, sin abrirla y sin poder tocar nada mas
--
-- La decision que la acompana es la de la rama `factura-pendiente`, en DECISIONS.md. Se cita la rama y
-- no el numero: el checksum congela este cuerpo.
--
-- EL PEDIDO. El dueno: «los de sales no pueden editar, pero si les falta el invoice solo eso pueden
-- ingresar, directo en la orden sin abrirla, ahi en el table, que puedan ingresar el invoice number y
-- guardar».
--
-- POR QUE EN LA BASE. La pantalla sola no basta, y esta medido (orquestador, produccion, ROLLBACK,
-- 2026-09-18): un vendedor actualizando SOLO `invoice_num` en SU orden queda BLOQUEADO en approved,
-- ready y delivered — «You cannot edit an order in the <stage> stage». Es la rama de «misma etapa» del
-- guard, que a ventas solo le deja editar en draft, pending y rejected.
--
-- QUE ABRE, EXACTAMENTE. Una excepcion estrecha en esa rama, ANTES del rechazo por etapa. Se permite
-- la escritura si se cumple TODO esto a la vez:
--   * el rol es `sales`;
--   * la orden es SUYA: `created_by` o `assigned_sales_rep` es `auth.uid()` (los dos son uuid). Son
--     exactamente las ordenes que un vendedor ve en su tabla (`orderOwner` en la app);
--   * la etapa no es draft, rejected ni canceled (en draft y rejected ya edita; una anulada no se toca);
--   * `invoice_num` ESTABA vacio y DEJA de estarlo. No puede sobrescribir una factura ya puesta ni
--     vaciarla: eso sigue siendo de office;
--   * y `invoice_num` es LO UNICO que cambia. Se comprueba con el mismo patron que la rama del chofer
--     (048, y copiada hasta la 123): una copia de NEW a la que se le devuelven los valores viejos de
--     las columnas permitidas tiene que ser identica a OLD. Ni etapa, ni tarifa, ni tienda, ni nada.
--
-- SOLO `invoice_num`, NO «el documento de su tipo». El documento que exige cada tipo lo dice
-- `settings.order_type_rules` (invoice / po / estimate), con valores por defecto por palabra clave que
-- hoy viven solo en TypeScript (`orderTypeRule`). Duplicar esa regla en SQL para abrir tambien `po2` y
-- `estimate_num` seria tener dos sitios decidiendo lo mismo. PO y estimacion los captura quien ya edita.
--
-- LA COLUMNA AUTOMATICA. Un solo trigger toca columnas en UPDATE: `deliveries_touch`, que pone
-- `updated_at = now()`. Los BEFORE disparan por orden alfabetico y `deliveries_guard_stage` va antes
-- que `deliveries_touch`, asi que el guard ve el `updated_at` viejo salvo que el cliente lo mande — y no
-- lo manda. Se excluye igualmente de la comparacion, como hace la rama del chofer.
--
-- SE COPIA DE LA VIGENTE, QUE ES LA 123 (la ultima que redefine el guard; comprobado con grep de
-- `function public.guard_delivery_stage` sobre las migraciones). La 124 no esta en el repo y, leida
-- desde su rama, no toca el guard. Todo lo demas se copia tal cual y una prueba lo comprueba
-- deshaciendo el cambio.
--
-- ES ADITIVA: solo permite algo mas. Por eso va ANTES que el codigo: con la migracion aplicada y la
-- pantalla vieja no pasa nada; con la pantalla nueva y sin la migracion, el vendedor veria un input que
-- la base le rechaza.
--
-- SIN `begin`/`commit` PROPIOS. Quien aplica envuelve el fichero. Un `commit` de dentro cierra la
-- transaccion de fuera y convierte un ensayo con ROLLBACK en una aplicacion de verdad.

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
    or (r in ('sales','driver') and new_stage = 'approved' and old_stage in ('draft','pending') and auto)  -- auto-approve store
    or (r = 'driver' and old_stage = 'ready'     and new_stage = 'picked_up')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'delivered')
    or (r = 'driver' and old_stage = 'picked_up' and new_stage = 'ready') then
      return NEW;
    end if;
    if r in ('manager','accounting') then
      if (old_stage = 'pending'  and new_stage = 'approved')
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
-- Autocomprobacion: que lo aplicado es esto, y que no se llevo nada por delante
-- ===========================================================================
-- Lee la definicion que QUEDO en la base, no este fichero. Si falla, la sentencia revienta y quien
-- aplica —que envuelve el fichero en una transaccion— lo ve y no confirma.
do $comprueba$
declare
  def text := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
begin
  -- La excepcion nueva, entera.
  if position('probe.invoice_num := OLD.invoice_num;' in def) = 0
     or position('OLD.created_by = auth.uid() or OLD.assigned_sales_rep = auth.uid()' in def) = 0
     or position('old_stage not in (''draft'',''rejected'',''canceled'')' in def) = 0 then
    raise exception '125: la excepcion de la factura no quedo en el guard';
  end if;
  -- Lo heredado que un `create or replace` desde una definicion vieja se habria llevado.
  if position('account_requires_approval(NEW.account)' in def) = 0 then
    raise exception '125: se perdio lo de la 123 (cuentas con aprobacion)';
  end if;
  if position('A delivered order is not canceled' in def) = 0
     or position('A cancellation reason is history' in def) = 0 then
    raise exception '125: se perdio lo de la 122 (anular con motivo)';
  end if;
  if position('r in (''manager'',''accounting'') then return NEW; end if;' in def) = 0 then
    raise exception '125: se perdio lo de la 118 (office como gerente)';
  end if;
  -- Y el trigger sigue colgado de la tabla: esta migracion no lo toca, pero sin el nada de esto corre.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass
                  and tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '125: el trigger deliveries_guard_stage no esta';
  end if;
end $comprueba$;

-- ===========================================================================
-- Reversion
-- ===========================================================================
--   Volver a aplicar el bloque `create or replace function public.guard_delivery_stage()` de
--   123_cuentas_con_aprobacion.sql, que es la definicion anterior a esta. Una sola sentencia, sin drop:
--   el trigger no se toca y no hay columnas ni datos nuevos que deshacer. Las facturas que un vendedor
--   haya puesto mientras estuvo aplicada se quedan: son datos buenos.

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Contra produccion, dos veces: ANTES de aplicar y con la 125 aplicada DENTRO de la misma transaccion.
-- `set local role` no basta: el guard lee `auth.uid()` y `current_user_role()`, asi que se suplanta al
-- usuario con `request.jwt.claims`. Los <uuid-…> los pone quien ensaya; las ordenes, una propia del
-- vendedor SIN factura en `approved` (<orden-suya>), una suya CON factura (<orden-con-factura>) y una
-- de OTRO vendedor sin factura (<orden-ajena>).
--
--   begin;
--   create function pg_temp.intenta(sentencia text) returns text language plpgsql as $f$
--   declare n int;
--   begin
--     begin
--       execute sentencia;
--       get diagnostics n = row_count;
--       raise exception 'FILAS:%', n;
--     exception when others then
--       return case when sqlerrm = 'FILAS:0' then 'SIN FILAS (no medido)'
--                   when sqlerrm like 'FILAS:%' then 'PERMITIDO'
--                   else 'BLOQUEADO: ' || sqlerrm end;
--     end;
--   end $f$;
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select a.caso, pg_temp.intenta(a.sentencia) from (values
--     ('1 pone la factura que falta en SU orden',      $q$update public.deliveries set invoice_num = 'ENSAYO-1' where id = '<orden-suya>'$q$),
--     ('2 cambia una factura ya puesta',               $q$update public.deliveries set invoice_num = 'ENSAYO-2' where id = '<orden-con-factura>'$q$),
--     ('3 factura + otro campo',                       $q$update public.deliveries set invoice_num = 'ENSAYO-3', delivery_fee = 1 where id = '<orden-suya>'$q$),
--     ('4 factura + cambio de etapa',                  $q$update public.deliveries set invoice_num = 'ENSAYO-4', stage = 'ready' where id = '<orden-suya>'$q$),
--     ('5 la deja en blanco (espacios)',               $q$update public.deliveries set invoice_num = '   ' where id = '<orden-suya>'$q$),
--     ('6 la factura de una orden AJENA',              $q$update public.deliveries set invoice_num = 'ENSAYO-6' where id = '<orden-ajena>'$q$),
--     ('7 solo otro campo, sin factura',               $q$update public.deliveries set delivery_fee = 1 where id = '<orden-suya>'$q$)
--   ) as a(caso, sentencia);
--     -- ANTES:   BLOQUEADO en los siete («You cannot edit an order in the approved stage»)
--     -- DESPUES: 1 PERMITIDO · 2 BLOQUEADO · 3 BLOQUEADO · 4 BLOQUEADO (sales cannot move…) ·
--     --          5 BLOQUEADO · 6 BLOQUEADO · 7 BLOQUEADO
--
--   set local request.jwt.claims = '{"sub":"<uuid-chofer>","role":"authenticated"}';
--   select pg_temp.intenta($q$update public.deliveries set invoice_num = 'ENSAYO-8' where id = '<orden-del-chofer-en-picked_up>'$q$);
--     -- ANTES y DESPUES: BLOQUEADO. La excepcion es de `sales`; la del chofer sigue siendo solo el GPS.
--
--   set local request.jwt.claims = '{"sub":"<uuid-office>","role":"authenticated"}';
--   select pg_temp.intenta($q$update public.deliveries set invoice_num = 'ENSAYO-9' where id = '<orden-con-factura>'$q$);
--     -- ANTES y DESPUES: PERMITIDO. Office edita en cualquier etapa, tambien una factura ya puesta.
--
--   reset role;
--   rollback;
--
-- Dos casos que conviene mirar aparte: la MISMA orden del caso 1 en `delivered` (debe pasar: es donde
-- estan casi todas las que faltan) y en `canceled` (no debe pasar).
--
-- No verificado al escribirlo: nada de esto se ha corrido. Una rama no toca produccion.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('125_ventas_pone_la_factura.sql', '6e9d91c490d8dddb229a6186eb306cba73643a469b01a985e6d9468da9e6aa0a') on conflict (name) do nothing;
