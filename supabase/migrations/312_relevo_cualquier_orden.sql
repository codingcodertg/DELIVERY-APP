-- ===========================================================================
-- 312 · Transferencia por relevo en CUALQUIER tipo de orden (no solo tienda a tienda)
-- ===========================================================================
-- PEDIDO. El dueño: «Transfer se puede en cualquier tipo de orden». Caso real: la #1629 (FX112), tipo Customer, recogida
-- en RDZ Pharr, entrega a un cliente en Sullivan City. Quiere: paso a = Pharr → una tienda intermedia (RDZ Mission) con un
-- chofer; paso b = tienda intermedia → la dirección del cliente con otro chofer.
--
-- QUÉ CAMBIA. Solo `activar_relevo` (256): ya no exige que el DESTINO sea una tienda de Ajustes. Todo lo demás de la regla
-- queda igual: aprobada o lista, sin recoger, sin partir en cargas, tienda de relevo de Ajustes distinta del origen y del
-- destino, y el día del paso b (hoy o después, nunca antes que el paso a).
--   · el paso a es la MISMA fila, con la tienda de relevo como destino, y SU TIPO DE ORDEN NO CAMBIA: los avisos al cliente,
--     la cuenta y la clase de ruta lo tratan como tramo entre tiendas por `relay_step = 1` (lib/relevo-etiqueta.ts,
--     `esTramoEntreTiendas`);
--   · el paso b copia la orden COMO ESTABA antes de tocarla (tipo, cliente, dirección, coordenadas, teléfono, correo, notas):
--     su destino es el final. Por eso los avisos al cliente y el «en camino» salen solo del paso b.
-- Las demás funciones (`deshacer_relevo`, `pasos_del_relevo`) y los disparadores (256, 302) no cambian. Aditiva: se reemplaza
-- la función; ningún dato se toca.
--
-- Para volver atrás: reejecutar el `create or replace function public.activar_relevo` de la 256 (con la comprobación de que
-- el destino sea una tienda de Ajustes) y quitar la fila del registro: delete from public.schema_migrations where name = '312_relevo_cualquier_orden.sql';

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

  -- Cualquier tipo de orden (312): ya no se exige que el destino sea una tienda de Ajustes. La de relevo sí tiene que serlo,
  -- y ser OTRA distinta del origen y del destino.
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

  -- El paso a: la misma fila, con la tienda de relevo como destino (su tipo de orden no cambia).
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
    (nueva_id, 'created', format('Relay transfer step Tr-%s-b: %s -> %s, pickup day %s. It can be picked up once Tr-%s-a is delivered at %s', etiqueta, tienda->>'name', coalesce(madre.delivery_name, '?'), p_fecha, etiqueta, tienda->>'name'), auth.uid());
  return nueva_id;
end $$;
revoke execute on function public.activar_relevo(uuid, text, date) from public, anon;
grant execute on function public.activar_relevo(uuid, text, date) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.activar_relevo(uuid,text,date)'::regprocedure);
  if position('is not a store-to-store order' in f) > 0 then
    raise exception '312: activar_relevo todavía exige que el destino sea una tienda';
  end if;
  if position('RELEVO_TIENDA' in f) = 0 or position('RELEVO_FECHA' in f) = 0 then
    raise exception '312: activar_relevo debe conservar las comprobaciones de tienda de relevo y de día';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('312_relevo_cualquier_orden.sql', '1232960415cf58bcb087eae25ad1d9a43d487bedca4b5a6f899a7f17df04777f') on conflict (name) do nothing;
