-- 123 · Cuentas que siempre requieren aprobacion de oficina
--
-- La decision que la acompana es la de la rama `cuentas-con-aprobacion`, en DECISIONS.md. Se cita la
-- rama y no el numero: el checksum congela este cuerpo.
--
-- EL PEDIDO. El dueno: «ya que se den de alta los clientes, estos clientes siempre van a requerir
-- aprobacion de oficina», con cuatro cuentas nombradas. Los nombres no estan aqui: son datos suyos, y
-- los carga el orquestador marcando esas cuentas en Ajustes.
--
-- LA MARCA ES UN DATO DE AJUSTES. Es la clave opcional `requires_approval` de cada objeto de
-- `public.settings.accounts`, igual que `intertienda`. No se deduce de nada: una cuenta la marca un
-- admin en Datos → Cuentas.
--
-- POR QUE TAMBIEN EN LA BASE. La pantalla ya no ofrece crear aprobada una orden de esas cuentas, pero
-- eso solo cubre el camino de la pantalla. El guard es quien decide de verdad que etapa puede nacer, y
-- hasta ahora la tienda con `auto_approve` dejaba nacer `approved` a cualquiera. Con esto, la marca de
-- la cuenta gana a la tienda tambien en la base.
--
-- QUE CAMBIA, EXACTAMENTE. Una linea del guard: el `auto` que ya se calculaba con la tienda ahora
-- ademas exige que la cuenta NO este marcada.
--
-- SE COPIA DE LA VIGENTE, QUE ES LA 122, no la 118. La 122 (anular con motivo) redefinio el guard
-- entero mientras esta rama estaba abierta; partir de la 118 habria devuelto el guard a antes de ella
-- y se habria llevado por delante lo de anular con motivo sin que nadie lo notara. Todo lo demas de la
-- 122 se copia tal cual —office como gerente, los grupos, las etapas por rol y las reglas de
-- anulacion— y una prueba lo comprueba deshaciendo el cambio.
--
-- LAS ORDENES YA CREADAS NO SE TOCAN. Esto solo decide que puede nacer o a que etapa se puede mover a
-- partir de ahora; ninguna fila se reescribe. Una orden de esas cuentas que ya este aprobada sigue
-- aprobada.

-- La marca, leida de Ajustes. `security definer` con `search_path` explicito, como sus vecinas: el
-- guard la llama desde un trigger que ya corre como dueno.
create or replace function public.account_requires_approval(account_name text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((a->>'requires_approval')::boolean, false)), false)
  from public.settings, jsonb_array_elements(coalesce(accounts, '[]'::jsonb)) as a
  where lower(btrim(a->>'name')) = lower(btrim(account_name));
$$;

revoke execute on function public.account_requires_approval(text) from public, anon;
grant  execute on function public.account_requires_approval(text) to authenticated;

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
-- Reversion
-- ===========================================================================
--   Volver a aplicar el bloque `create or replace function public.guard_delivery_stage()` de
--   122_anular_con_motivo.sql, que es la definicion anterior a esta (NO la de la 118: la 122 la
--   reescribio despues). Una sola sentencia, sin
--   drop: el trigger no se toca. La funcion `account_requires_approval` puede quedarse —no la llama
--   nadie mas— o borrarse con:
--     drop function if exists public.account_requires_approval(text);
--   Las marcas que haya en `settings.accounts` se quedan; sin el guard, simplemente no deciden nada.

-- ===========================================================================
-- Ensayo por rol y por cuenta, con ROLLBACK (lo que se escribe aqui se deshace)
-- ===========================================================================
-- Contra produccion, dos veces: ANTES de aplicar (una cuenta marcada nace `approved` desde una tienda
-- que auto-aprueba) y con la 123 aplicada DENTRO de la misma transaccion (esa misma insercion queda
-- bloqueada). Las filas y las marcas son de ensayo: la tienda y la cuenta se inventan aqui dentro y el
-- rollback se las lleva.
--
--   begin;
--   -- 0. Una tienda que auto-aprueba y dos cuentas: una marcada y otra no. Inventadas, no las del dueno.
--   update public.settings set
--     stores   = coalesce(stores, '[]'::jsonb)   || '[{"name":"TIENDA-ENSAYO","auto_approve":true}]'::jsonb,
--     accounts = coalesce(accounts, '[]'::jsonb) || '[{"name":"CUENTA-CON-APROBACION","requires_approval":true},
--                                                     {"name":"CUENTA-NORMAL"}]'::jsonb
--    where id = 1;
--
--   -- 1. La marca, leida por la funcion nueva (solo DESPUES; antes no existe).
--   select public.account_requires_approval('CUENTA-CON-APROBACION');  -- true
--   select public.account_requires_approval('  cuenta-con-aprobacion  ');  -- true: sin espacios ni mayusculas
--   select public.account_requires_approval('CUENTA-NORMAL');          -- false
--   select public.account_requires_approval('LA QUE NO EXISTE');       -- false
--   select public.account_requires_approval(null);                     -- false
--
--   -- 2. Un intento por rol y por cuenta. Se ejecuta y se deshace siempre; cero filas seria
--   --    «SIN FILAS», no un permiso.
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
--   -- Con <uuid-vendedor> y con <uuid-manager>: el vendedor depende de la tienda, el gerente crea
--   -- aprobada por su rol, y la cuenta marcada tiene que ganarles a los dos.
--   set local request.jwt.claims = '{"sub":"<uuid-vendedor>","role":"authenticated"}';
--   select a.caso, pg_temp.intenta(a.sentencia) from (values
--     ('cuenta normal, aprobada',   $q$insert into public.deliveries (stage, store, account, is_training) values ('approved','TIENDA-ENSAYO','CUENTA-NORMAL',true)$q$),
--     ('cuenta marcada, aprobada',  $q$insert into public.deliveries (stage, store, account, is_training) values ('approved','TIENDA-ENSAYO','CUENTA-CON-APROBACION',true)$q$),
--     ('cuenta marcada, pendiente', $q$insert into public.deliveries (stage, store, account, is_training) values ('pending','TIENDA-ENSAYO','CUENTA-CON-APROBACION',true)$q$)
--   ) as a(caso, sentencia);
--     -- ANTES:   PERMITIDO · PERMITIDO · PERMITIDO
--     -- DESPUES: PERMITIDO · BLOQUEADO · PERMITIDO
--
--   set local request.jwt.claims = '{"sub":"<uuid-manager>","role":"authenticated"}';
--   select a.caso, pg_temp.intenta(a.sentencia) from (values
--     ('gerente, cuenta marcada, aprobada',  $q$insert into public.deliveries (stage, store, account, is_training) values ('approved','TIENDA-ENSAYO','CUENTA-CON-APROBACION',true)$q$),
--     ('gerente, cuenta marcada, pendiente', $q$insert into public.deliveries (stage, store, account, is_training) values ('pending','TIENDA-ENSAYO','CUENTA-CON-APROBACION',true)$q$)
--   ) as a(caso, sentencia);
--     -- ANTES:   PERMITIDO · PERMITIDO
--     -- DESPUES: PERMITIDO · PERMITIDO
--     -- Ojo: el gerente crea aprobada POR SU ROL (rama `r in ('manager','accounting')` del guard), no
--     -- por `auto`. Esta migracion NO se lo quita: la marca de la cuenta gana a la tienda, y a la
--     -- pantalla, pero un gerente sigue pudiendo aprobar lo que crea. Si el dueno quiere cerrarle
--     -- tambien esa puerta, es otra decision y otra migracion.
--
--   -- 3. Y aprobar despues sigue siendo de quien ya podia: la cuenta no cambia quien aprueba.
--   select a.caso, pg_temp.intenta(a.sentencia) from (values
--     ('gerente aprueba una pendiente de cuenta marcada', $q$update public.deliveries set stage = 'approved' where store = 'TIENDA-ENSAYO' and account = 'CUENTA-CON-APROBACION' and stage = 'pending'$q$)
--   ) as a(caso, sentencia);
--     -- PERMITIDO en los dos casos
--
--   reset role;
--   rollback;
--
-- No verificado al escribirlo: que `authenticated` pueda llamar a una funcion de pg_temp creada por
-- postgres en la misma sesion. Si no puede, el mismo cuerpo va en un `do $$ ... $$` por intento.

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('123_cuentas_con_aprobacion.sql', '3f384b739b5587c305c15dc09c2574e25b6454cf6bd03ff978909de332d1bb75') on conflict (name) do nothing;
