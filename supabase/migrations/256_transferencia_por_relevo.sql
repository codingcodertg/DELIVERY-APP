-- ===========================================================================
-- 256 · Transferencia por relevo: una orden de tienda a tienda que viaja en PASOS (Tr-1111-a, Tr-1111-b)
-- ===========================================================================
-- PEDIDO. El dueno, 2026-11-05: una intertienda va de McAllen a Brownsville; Julio la lleva de McAllen a Weslaco
-- y, mas tarde, Max de Weslaco a Brownsville. "Ya teniamos la idea de que la orden se vuelve 1111a y la segunda
-- parte 1111b", pero cuando pasa ESTO quiere un marcador propio: "Tr-1111-a" (paso a de la transferencia) y
-- "Tr-1111-b", con una etiqueta que se reconozca en todas partes. Quien planifica las rutas elige el dia de
-- recogida del segundo paso: el mismo dia o cualquier dia futuro.
--
-- EL MODELO. Se monta sobre las CARGAS HERMANAS de la 157 (misma `order_no` y `order_code`, letra en
-- `order_suffix`), no al lado: cada paso es una fila de `deliveries`, con su chofer, su dia, su puesto en la
-- ruta, su recogida, su entrega, su comprobante, su RLS y su historial, sin que ningun lector cambie. Lo unico
-- nuevo es UNA columna, `relay_step` (1 = paso a, 2 = paso b...): con ella la fila es un paso de relevo y la app
-- la nombra "Tr-1111-a"; sin ella es una carga partida de las de siempre ("1111a"). El dato admite mas de dos
-- pasos (c, d); la pantalla hoy solo crea dos.
--
-- En que se diferencia un paso de relevo de una carga partida:
--   * van EN SERIE: el paso b sale de donde el a llega, y NO se recoge (ni se da por entregado) hasta que el
--     paso anterior este ENTREGADO en la tienda de relevo. Lo exige el disparador de abajo, para todos los roles
--     (tambien el admin: no es un permiso, es que la mercancia aun no esta ahi);
--   * cada paso lleva TODOS los pallets; la tarifa se queda solo en el paso a;
--   * no se parte, no se junta y no se borra por los caminos de las cargas: se deshace entero con
--     `deshacer_relevo`, y solo mientras el paso a no se haya recogido.
--
-- QUE HACE:
--   1. `deliveries.relay_step smallint` (nulo = no es un relevo), con su check (la letra es la del paso) y un
--      indice unico por familia y paso.
--   2. `puede_relevo()`: quien planifica rutas. Admin y logistica por su rol, o a quien se le dio el permiso
--      `route_plan` (profiles.permissions), con el modulo de Entregas. Es el espejo de `canPlanRoutes` de la app.
--   3. `guard_relevo()` + disparador `deliveries_guard_relevo`: la regla del orden, que una entrega no se deshaga
--      si el paso siguiente ya salio, y que `relay_step` solo lo escriban las funciones de aqui.
--   4. `activar_relevo(p_id, p_tienda, p_fecha)`: la orden pasa a ser el paso a (su destino es la tienda de
--      relevo) y nace el paso b (de la tienda de relevo al destino final, el dia elegido, sin chofer, lista).
--      Invoker, como `partir_carga`: valen la RLS y el guard de etapas de quien llama.
--   5. `deshacer_relevo(p_id)`: el paso a vuelve a ser la orden entera, con su destino final, y los demas pasos
--      se borran. Security definer SOLO por el borrado (la politica de la 142 solo deja borrar borradores), como
--      `juntar_cargas`: comprueba por su cuenta quien llama, que VEA la orden y que ningun paso haya salido. El
--      rastro de lo borrado queda en `deliveries_borradas` por el disparador de la 142.
--   6. `pasos_del_relevo(p_id)`: los pasos de la orden con quien y cuando recogio y entrego cada uno. Definer
--      porque un chofer no puede leer el paso de otro chofer (131); devuelve solo lo minimo para la tarjeta.
--
-- QUE NO HACE:
--   - No reescribe `guard_delivery_stage` ni ninguna politica. No toca `partir_carga`, `juntar_cargas`,
--     `reparte_cargas`, `rutas_del_dia` ni `publish_route_plan`. No cambia ningun dato: al aplicarla ninguna fila
--     tiene `relay_step`.
--   - Como el guard de etapas sigue mandando, quien tenga `route_plan` por permiso pero un rol al que el guard no
--     deja crear una carga ni editar una orden aprobada (ventas) recibira el error del guard. Hoy planifican
--     admin y logistica.
--   - Sin begin/commit propios: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La columna
-- ---------------------------------------------------------------------------
alter table public.deliveries add column if not exists relay_step smallint;

alter table public.deliveries drop constraint if exists deliveries_relay_step_ck;
alter table public.deliveries add constraint deliveries_relay_step_ck
  check (relay_step is null or (relay_step between 1 and 26 and order_suffix = chr(96 + relay_step)));

create unique index if not exists deliveries_relay_step_uq
  on public.deliveries (order_no, is_training, relay_step) where relay_step is not null;

comment on column public.deliveries.relay_step is
  'Paso de una transferencia por relevo (256): 1 = a (origen -> tienda de relevo), 2 = b (relevo -> destino)... Nulo = no es un relevo. Solo lo escriben activar_relevo / deshacer_relevo.';

-- ---------------------------------------------------------------------------
-- 2. Quien puede: quien planifica rutas
-- ---------------------------------------------------------------------------
create or replace function public.puede_relevo()
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_deliveries_access()
     and exists (select 1 from public.profiles p
                  where p.id = (select auth.uid())
                    and (p.role in ('admin', 'logistics') or 'route_plan' = any(coalesce(p.permissions, '{}'))));
$$;
revoke execute on function public.puede_relevo() from public, anon;
grant execute on function public.puede_relevo() to authenticated;

-- Un nombre de tienda, comparable: sin espacios de mas y en minusculas (`normalizaLugar` en la app).
create or replace function public.relevo_norm(t text)
  returns text language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(t, ''))), '\s+', ' ', 'g');
$$;

-- ---------------------------------------------------------------------------
-- 3. El guard del relevo
-- ---------------------------------------------------------------------------
-- Security definer: tiene que leer el paso ANTERIOR, que puede ser de otro chofer y la RLS no se lo deja leer a
-- quien escribe. Las funciones de abajo marcan la familia en `rtg.relevo` (set_config local a la transaccion,
-- el patron de la 173 y la 188) justo antes de sus escrituras.
create or replace function public.guard_relevo()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  marca text := coalesce(current_setting('rtg.relevo', true), '');
  otro  text;
begin
  if TG_OP = 'DELETE' then
    if OLD.relay_step is not null and marca <> OLD.order_no::text then
      raise exception 'RELEVO_FIJO: #% is a relay transfer step: undo the relay instead of deleting or joining it', OLD.order_no;
    end if;
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.relay_step is not null and marca <> NEW.order_no::text then
      raise exception 'RELEVO_FIJO: a relay transfer step is only created by activar_relevo (it is not split into loads)';
    end if;
    return NEW;
  end if;

  -- UPDATE
  if NEW.relay_step is null and OLD.relay_step is null then return NEW; end if;

  -- El paso, su letra y su familia solo los cambian las funciones del relevo.
  if (NEW.relay_step is distinct from OLD.relay_step
      or NEW.order_suffix is distinct from OLD.order_suffix
      or NEW.order_no is distinct from OLD.order_no
      or NEW.is_training is distinct from OLD.is_training)
     and marca <> OLD.order_no::text then
    raise exception 'RELEVO_FIJO: the step of a relay transfer is only changed by activar_relevo / deshacer_relevo';
  end if;

  -- LA REGLA DEL ORDEN: el paso b (c, d...) no entra en recogido/entregado hasta que el anterior este entregado.
  if NEW.relay_step > 1 and NEW.stage in ('picked_up', 'delivered') and OLD.stage not in ('picked_up', 'delivered') then
    select d.stage into otro from public.deliveries d
     where d.order_no = NEW.order_no and d.is_training = NEW.is_training and d.relay_step = NEW.relay_step - 1
     limit 1;
    if otro is distinct from 'delivered' then
      raise exception 'RELEVO_ORDEN: this transfer step cannot be picked up before the previous step is delivered at the relay store (previous step: %)', coalesce(otro, 'missing');
    end if;
  end if;

  -- Y al reves: una entrega no se deshace si el paso siguiente ya salio con esa mercancia.
  if OLD.relay_step is not null and OLD.stage = 'delivered' and NEW.stage is distinct from 'delivered' then
    if exists (select 1 from public.deliveries d
                where d.order_no = OLD.order_no and d.is_training = OLD.is_training
                  and d.relay_step = OLD.relay_step + 1 and d.stage in ('picked_up', 'delivered')) then
      raise exception 'RELEVO_ORDEN_DESHACER: the next transfer step was already picked up: this delivery cannot be undone';
    end if;
  end if;

  return NEW;
end $$;
revoke execute on function public.guard_relevo() from public, anon, authenticated;

drop trigger if exists deliveries_guard_relevo on public.deliveries;
create trigger deliveries_guard_relevo before insert or update or delete on public.deliveries
  for each row execute function public.guard_relevo();

-- ---------------------------------------------------------------------------
-- 4. activar_relevo: la orden pasa a ser el paso a y nace el paso b
-- ---------------------------------------------------------------------------
create or replace function public.activar_relevo(p_id uuid, p_tienda text, p_fecha date)
  returns uuid language plpgsql set search_path = public as $$
declare
  madre     public.deliveries%rowtype;
  tienda    jsonb;
  hoy       date := (now() at time zone 'America/Chicago')::date;
  nueva_id  uuid := gen_random_uuid();
  fila      jsonb;
  etiqueta  text;
  n         integer;
begin
  if auth.uid() is null or not public.puede_relevo() then
    raise exception 'RELEVO_FORBIDDEN: only route planners or an admin set up a relay transfer' using errcode = '42501';
  end if;
  select * into madre from public.deliveries d where d.id = p_id for update;
  if not found then raise exception 'RELEVO_NOT_FOUND: %', p_id; end if;

  if madre.relay_step is not null or madre.order_suffix is not null
     or exists (select 1 from public.deliveries d
                 where d.order_no = madre.order_no and d.is_training = madre.is_training and d.id <> madre.id) then
    raise exception 'RELEVO_NO_APLICA: #% already is a relay transfer or is split into loads', madre.order_no;
  end if;
  if madre.stage not in ('approved', 'fulfilling', 'ready') then
    raise exception 'RELEVO_STAGE: a relay is set up on an approved order that has not been picked up (it is %)', madre.stage;
  end if;

  -- De tienda a tienda: el DESTINO es una tienda de Ajustes (la recogida sale de "Vendido desde", pero su nombre
  -- puede ser el del almacen de esa tienda, asi que no se exige por nombre). Y la de relevo es OTRA tienda de Ajustes.
  if not exists (select 1 from public.settings, jsonb_array_elements(coalesce(stores, '[]'::jsonb)) s
                  where public.relevo_norm(s->>'name') = public.relevo_norm(madre.delivery_name) and public.relevo_norm(madre.delivery_name) <> '') then
    raise exception 'RELEVO_NO_APLICA: #% is not a store-to-store order', madre.order_no;
  end if;
  select s into tienda from public.settings, jsonb_array_elements(coalesce(stores, '[]'::jsonb)) s
   where public.relevo_norm(s->>'name') = public.relevo_norm(p_tienda) limit 1;
  if tienda is null or public.relevo_norm(p_tienda) = ''
     or public.relevo_norm(p_tienda) in (public.relevo_norm(madre.pickup_name), public.relevo_norm(madre.delivery_name), public.relevo_norm(madre.store)) then
    raise exception 'RELEVO_TIENDA: the relay store must be a store from Settings other than the origin and the destination (got %)', coalesce(p_tienda, '');
  end if;

  -- El dia del paso b: el mismo que el a o cualquiera posterior; nunca en el pasado.
  if p_fecha is null or p_fecha < greatest(hoy, coalesce(madre.delivery_date, hoy)) then
    raise exception 'RELEVO_FECHA: step b cannot be picked up before today or before step a''s day (got %)', p_fecha;
  end if;

  etiqueta := coalesce(madre.order_code, madre.order_no::text);
  perform set_config('rtg.relevo', madre.order_no::text, true);

  -- El paso a: la misma fila, con la tienda de relevo como destino.
  update public.deliveries
     set order_suffix        = 'a',
         relay_step          = 1,
         delivery_name       = tienda->>'name',
         delivery_address    = tienda->>'address',
         delivery_lat        = nullif(tienda->>'lat', '')::double precision,
         delivery_lng        = nullif(tienda->>'lng', '')::double precision,
         delivery_pin_source = case when nullif(tienda->>'lat', '') is not null and nullif(tienda->>'lng', '') is not null then 'geocoded' else null end,
         route_miles = null, route_duration = null, route_provider = null, route_traffic = null
   where id = p_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RELEVO_UNSEEN: step a could not be written'; end if;

  -- El paso b: copia de la madre COMO ESTABA (su destino es el final), con lo suyo. La misma lista de columnas
  -- propias que una carga partida (157), mas las del relevo: recogida, dia, chofer, tarifa y la ruta calculada.
  fila := to_jsonb(madre)
    || jsonb_build_object(
      'id', nueva_id, 'order_suffix', 'b', 'relay_step', 2, 'stage', 'ready',
      'pickup_name', tienda->>'name', 'pickup_address', tienda->>'address', 'pickup_point_lat', null, 'pickup_point_lng', null,
      'delivery_date', p_fecha, 'assigned_driver', null, 'delivery_fee', null, 'morning_priority', false,
      'route_seq', null, 'pickup_seq', null, 'load_no', null, 'load_auto', false,
      'route_miles', null, 'route_duration', null, 'route_provider', null, 'route_traffic', null)
    || jsonb_build_object(
      'created_at', now(), 'updated_at', now(), 'created_by', auth.uid(),
      'pickup_lat', null, 'pickup_lng', null, 'pickup_gps_at', null, 'departed_at', null, 'arrived_at', null,
      'pod_received_by', null, 'pod_signature', null, 'pod_delivered_at', null, 'pod_lat', null, 'pod_lng', null, 'pod_accuracy', null,
      'photos', null, 'photo_meta', null, 'delivered_address', null, 'csat_rating', null, 'csat_comment', null,
      'delivery_notes', concat_ws(E'\n', madre.delivery_notes, format('Relay transfer Tr-%s-b: %s -> %s.', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'))));
  insert into public.deliveries select * from jsonb_populate_record(null::public.deliveries, fila);

  perform set_config('rtg.relevo', '', true);

  insert into public.order_events (delivery_id, kind, note, created_by) values
    (p_id,     'edited',  format('Relay transfer set up: this order is now step Tr-%s-a (%s -> %s); step Tr-%s-b (%s -> %s) is picked up on %s', etiqueta, coalesce(madre.pickup_name, '?'), tienda->>'name', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), p_fecha), auth.uid()),
    (nueva_id, 'created', format('Relay transfer step Tr-%s-b: %s -> %s, pickup day %s. It can be picked up once Tr-%s-a is delivered at %s', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), p_fecha, etiqueta, tienda->>'name'), auth.uid());
  return nueva_id;
end $$;
revoke execute on function public.activar_relevo(uuid, text, date) from public, anon;
grant execute on function public.activar_relevo(uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. deshacer_relevo: vuelve a ser UNA orden, mientras el paso a no se haya recogido
-- ---------------------------------------------------------------------------
-- Definer por el borrado (la politica de la 142 solo deja borrar borradores). Por eso comprueba aqui quien llama y
-- que VEA la orden (`la_ve_quien_llama`, la clausula de tienda de la politica de lectura, 157). El UPDATE del paso
-- a sigue pasando por el guard de etapas con el rol de quien llama (`auth.uid()` no cambia).
create or replace function public.deshacer_relevo(p_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  x       public.deliveries%rowtype;
  a       public.deliveries%rowtype;
  ultimo  public.deliveries%rowtype;
  etiqueta text;
  n       integer;
begin
  if auth.uid() is null or not public.puede_relevo() then
    raise exception 'RELEVO_FORBIDDEN: only route planners or an admin undo a relay transfer' using errcode = '42501';
  end if;
  select * into x from public.deliveries d where d.id = p_id;
  if not found or not public.la_ve_quien_llama(x) then raise exception 'RELEVO_NOT_FOUND: %', p_id; end if;
  if x.relay_step is null then raise exception 'RELEVO_NO_APLICA: #% is not a relay transfer', x.order_no; end if;

  perform 1 from public.deliveries d
    where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step is not null
    order by d.relay_step for update;
  if exists (select 1 from public.deliveries d
              where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step is not null
                and (d.stage in ('picked_up', 'delivered') or d.pickup_gps_at is not null or d.pod_delivered_at is not null)) then
    raise exception 'RELEVO_YA_SALIO: the relay can no longer be undone: a step was already picked up';
  end if;
  select * into a from public.deliveries d
    where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step = 1;
  select * into ultimo from public.deliveries d
    where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step is not null
    order by d.relay_step desc limit 1;
  if a.id is null or ultimo.id is null or ultimo.id = a.id then
    raise exception 'RELEVO_NO_APLICA: #% has no relay steps to undo', x.order_no;
  end if;

  etiqueta := coalesce(a.order_code, a.order_no::text);
  perform set_config('rtg.relevo', a.order_no::text, true);

  delete from public.deliveries d
   where d.order_no = a.order_no and d.is_training = a.is_training and d.relay_step > 1;

  update public.deliveries
     set order_suffix        = null,
         relay_step          = null,
         delivery_name       = ultimo.delivery_name,
         delivery_address    = ultimo.delivery_address,
         delivery_lat        = ultimo.delivery_lat,
         delivery_lng        = ultimo.delivery_lng,
         delivery_pin_source = ultimo.delivery_pin_source,
         route_miles = null, route_duration = null, route_provider = null, route_traffic = null
   where id = a.id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RELEVO_UNSEEN: the order could not be written'; end if;

  perform set_config('rtg.relevo', '', true);

  insert into public.order_events (delivery_id, kind, note, created_by) values
    (a.id, 'edited', format('Relay transfer undone: #%s is one order again, %s -> %s (the relay stop at %s was removed)', etiqueta, coalesce(a.pickup_name, '?'), coalesce(ultimo.delivery_name, '?'), coalesce(a.delivery_name, '?')), auth.uid());
  return a.id;
end $$;
revoke execute on function public.deshacer_relevo(uuid) from public, anon;
grant execute on function public.deshacer_relevo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. pasos_del_relevo: los pasos de la orden, con quien y cuando
-- ---------------------------------------------------------------------------
-- Para la tarjeta "Transferencia por relevo" de la ficha: el estado de la orden ENTERA es el de su ultimo paso, y
-- el chofer del paso b tiene que poder ver si el a ya llego aunque no pueda leer esa fila (131). Devuelve solo
-- esto; nada del cliente, de la tarifa ni de las notas.
create or replace function public.pasos_del_relevo(p_id uuid)
  returns table (
    id uuid, relay_step smallint, order_suffix text, stage text, assigned_driver text, delivery_date date,
    pickup_name text, delivery_name text,
    picked_up_by text, picked_up_at timestamptz, delivered_by text, delivered_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
declare
  x public.deliveries%rowtype;
begin
  if auth.uid() is null or not public.has_deliveries_access() then return; end if;
  select * into x from public.deliveries d where d.id = p_id;
  if not found or x.relay_step is null or not public.la_ve_quien_llama(x) then return; end if;
  return query
    select d.id, d.relay_step, d.order_suffix, d.stage::text, d.assigned_driver, d.delivery_date,
           d.pickup_name, d.delivery_name,
           rec.quien, case when d.stage in ('picked_up', 'delivered') then coalesce(rec.cuando, d.pickup_gps_at) end,
           ent.quien, case when d.stage = 'delivered' then coalesce(d.pod_delivered_at, ent.cuando) end
      from public.deliveries d
      left join lateral (
        select p.full_name as quien, e.created_at as cuando
          from public.order_events e left join public.profiles p on p.id = e.created_by
         where e.delivery_id = d.id and e.kind = 'picked_up' and d.stage in ('picked_up', 'delivered')
         order by e.created_at desc limit 1) rec on true
      left join lateral (
        select p.full_name as quien, e.created_at as cuando
          from public.order_events e left join public.profiles p on p.id = e.created_by
         where e.delivery_id = d.id and e.kind = 'delivered' and d.stage = 'delivered'
         order by e.created_at desc limit 1) ent on true
     where d.order_no = x.order_no and d.is_training = x.is_training and d.relay_step is not null
     order by d.relay_step;
end $$;
revoke execute on function public.pasos_del_relevo(uuid) from public, anon;
grant execute on function public.pasos_del_relevo(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Autocomprobacion: si algo de esto no quedo como se pide, la migracion falla entera
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries' and column_name = 'relay_step') then
    raise exception '256: falta deliveries.relay_step';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'deliveries_guard_relevo' and not tgisinternal) then
    raise exception '256: el disparador deliveries_guard_relevo no esta';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'deliveries_guard_stage' and not tgisinternal) then
    raise exception '256: el disparador deliveries_guard_stage ya no esta (esta migracion no lo toca)';
  end if;
  select p.prosecdef, pg_get_functiondef(p.oid) as def into f from pg_proc p where p.oid = 'public.guard_relevo()'::regprocedure;
  if not f.prosecdef then raise exception '256: guard_relevo tiene que ser security definer (lee el paso de otro chofer)'; end if;
  if position('RELEVO_ORDEN' in f.def) = 0 or position('RELEVO_ORDEN_DESHACER' in f.def) = 0 or position('RELEVO_FIJO' in f.def) = 0 then
    raise exception '256: a guard_relevo le falta una de sus reglas';
  end if;
  select p.prosecdef, pg_get_functiondef(p.oid) as def into f from pg_proc p where p.oid = 'public.activar_relevo(uuid, text, date)'::regprocedure;
  if f.prosecdef then raise exception '256: activar_relevo NO debe ser security definer'; end if;
  if position('puede_relevo' in f.def) = 0 or position('RELEVO_FECHA' in f.def) = 0 or position('RELEVO_TIENDA' in f.def) = 0 then
    raise exception '256: a activar_relevo le falta una comprobacion';
  end if;
  select p.prosecdef, pg_get_functiondef(p.oid) as def into f from pg_proc p where p.oid = 'public.deshacer_relevo(uuid)'::regprocedure;
  if not f.prosecdef then raise exception '256: deshacer_relevo tiene que ser security definer (la politica de borrar no deja)'; end if;
  if position('puede_relevo' in f.def) = 0 or position('la_ve_quien_llama' in f.def) = 0 or position('RELEVO_YA_SALIO' in f.def) = 0 then
    raise exception '256: a deshacer_relevo le falta la comprobacion de quien llama, la de tienda o la de que nada haya salido';
  end if;
  if has_function_privilege('anon', 'public.activar_relevo(uuid, text, date)', 'execute')
     or has_function_privilege('anon', 'public.deshacer_relevo(uuid)', 'execute')
     or has_function_privilege('anon', 'public.pasos_del_relevo(uuid)', 'execute')
     or has_function_privilege('anon', 'public.puede_relevo()', 'execute') then
    raise exception '256: anon no debe poder ejecutar las funciones del relevo';
  end if;
  if not has_function_privilege('authenticated', 'public.activar_relevo(uuid, text, date)', 'execute')
     or not has_function_privilege('authenticated', 'public.deshacer_relevo(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.pasos_del_relevo(uuid)', 'execute') then
    raise exception '256: authenticated debe poder ejecutar las funciones del relevo';
  end if;
  if exists (select 1 from public.deliveries where relay_step is not null) then
    raise exception '256: ya hay filas con relay_step y esta migracion no escribe ninguna';
  end if;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Para deshacer (si no hay ningun relevo activo; si los hay, deshacerlos antes con deshacer_relevo):
--   drop trigger if exists deliveries_guard_relevo on public.deliveries;
--   drop function if exists public.pasos_del_relevo(uuid);
--   drop function if exists public.deshacer_relevo(uuid);
--   drop function if exists public.activar_relevo(uuid, text, date);
--   drop function if exists public.guard_relevo();
--   drop function if exists public.puede_relevo();
--   drop function if exists public.relevo_norm(text);
--   drop index if exists public.deliveries_relay_step_uq;
--   alter table public.deliveries drop constraint if exists deliveries_relay_step_ck;
--   alter table public.deliveries drop column if exists relay_step;
--
-- Ensayo (con ROLLBACK), como logistica:
--   R1 activar_relevo(<intertienda aprobada>, 'RDZ Weslaco', current_date) -> devuelve el id del paso b; la madre
--      queda con order_suffix 'a', relay_step 1 y delivery_name 'RDZ Weslaco'; el b con relay_step 2, stage ready.
--   R2 como el chofer del b: update ... set stage = 'picked_up' where id = <b> -> RELEVO_ORDEN.
--   R3 entregar el a (picked_up, delivered) y repetir R2 -> pasa.
--   R4 con el b recogido: update <a> set stage = 'picked_up' -> RELEVO_ORDEN_DESHACER.
--   R5 deshacer_relevo(<a>) con el a sin recoger -> una sola fila, sin letra, con el destino final; con el a
--      recogido -> RELEVO_YA_SALIO.
--   R6 como ventas: activar_relevo(...) -> RELEVO_FORBIDDEN (42501).
--   R7 partir_carga(<a>, 1) -> RELEVO_FIJO; delete from deliveries where id = <b> -> RELEVO_FIJO.
-- ---------------------------------------------------------------------------

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('256_transferencia_por_relevo.sql', '0bfa6425a586b6f6624a1fcc140fd9a33752da1612d8402f0b572e43a2d3ad4d') on conflict (name) do nothing;
