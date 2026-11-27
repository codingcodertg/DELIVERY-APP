-- ---------------------------------------------------------------------------
-- 359 · Relevo de una orden ya recogida: el paso a SIGUE recogido (D-1207, 2026-11-27)
-- ---------------------------------------------------------------------------
-- POR QUÉ. El dueño, 27 nov (orden 172532, PO 12917): «estaba como recogido… le activé un relay y se puso en delivered y no
-- es así, Julio está en camino». Desde la 321, activar el relevo con la orden recogida marcaba el paso a ENTREGADO en la
-- tienda de relevo al instante (suponía que el chofer ya la había dejado). Eso es falso cuando el chofer va en camino.
--
-- QUÉ CAMBIA. `activar_relevo` se re-crea desde su definición EN VIVO (leída el 27 nov) con un solo cambio de fondo: con la
-- orden recogida, el paso a se queda en picked_up (sin pod_delivered_at ni delivered_address) y su nota va como 'note', no
-- como 'delivered'. El chofer lo entrega en la tienda de relevo como cualquier entrega; el paso b no sale antes (guard 256).
-- Todo lo demás (permisos, tiendas, fecha, copia del paso b, grants) es igual.
--
-- Sin begin/commit propios. Idempotente (create or replace).
-- Para deshacer: re-crear la definición de la 321 (supabase/migrations/321_relevo_de_orden_recogida.sql) y
--   delete from public.schema_migrations where name = '359_relevo_recogido_sigue_en_camino.sql';
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activar_relevo(p_id uuid, p_tienda text, p_fecha date)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  madre     public.deliveries%rowtype;
  tienda    jsonb;
  hoy       date := (now() at time zone 'America/Chicago')::date;
  nueva_id  uuid := gen_random_uuid();
  fila      jsonb;
  etiqueta  text;
  ya_salio  boolean;
  nota_ya   text;
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
  -- 321: también ya recogida (picked_up). 359: el paso a SIGUE recogido (el chofer va en camino a la tienda de relevo).
  if madre.stage not in ('approved', 'fulfilling', 'ready', 'picked_up') then
    raise exception 'RELEVO_STAGE: a relay is set up on an approved order that has not been delivered (it is %)', madre.stage;
  end if;
  ya_salio := madre.stage = 'picked_up';

  -- Cualquier tipo de orden (312): la tienda de relevo tiene que ser de Ajustes, y OTRA distinta del origen y del destino.
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
  nota_ya  := format('Relevo activado con la orden en camino: %s la lleva a %s; el paso a sigue recogido hasta que la entregue ahí', coalesce(madre.assigned_driver, '?'), tienda->>'name');
  perform set_config('rtg.relevo', madre.order_no::text, true);

  -- El paso a: la misma fila, con la tienda de relevo como destino (su tipo de orden no cambia). Si la orden ya salio
  -- con el chofer, el paso a SIGUE recogido (359): su recogida, su chofer y su salida se quedan; se entrega al llegar a la tienda.
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

  -- El paso b: copia de la madre COMO ESTABA (su destino es el final: el cliente, si la orden es de cliente), con lo suyo.
  -- La misma lista de columnas propias que una carga partida (157), mas las del relevo: recogida, dia, chofer, tarifa y la ruta.
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
    (nueva_id, 'created', case when ya_salio then nota_ya
                              else format('Relay transfer step Tr-%s-b: %s -> %s, pickup day %s. It can be picked up once Tr-%s-a is delivered at %s', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), p_fecha, etiqueta, tienda->>'name') end, auth.uid());
  if ya_salio then
    insert into public.order_events (delivery_id, kind, note, created_by) values (p_id, 'note', nota_ya, auth.uid());
  end if;
  return nueva_id;
end $function$
;

do $$
begin
  if pg_get_functiondef('public.activar_relevo(uuid,text,date)'::regprocedure) like '%then ''delivered'' else stage%' then
    raise exception 'La 359 no quitó el paso a entregado al activar el relevo';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('359_relevo_recogido_sigue_en_camino.sql', '18723dbd7d6a66c5af52bdd29906854e8f7407b4eaea7f312a45599ca7535067') on conflict (name) do nothing;
