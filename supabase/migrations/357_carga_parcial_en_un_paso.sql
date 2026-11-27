-- ---------------------------------------------------------------------------
-- 357 · Carga parcial al recoger, en UNA transacción, y sin dividir dos veces (auditoría 2026-11-27, lote 2)
-- ---------------------------------------------------------------------------
-- POR QUÉ. El chofer que carga menos pallets de las que tiene la orden la parte en dos. El código lo hacía en DOS
-- escrituras separadas (src/components/OrderModal.tsx, confirmPickup): primero crea el resto como orden nueva (letra
-- siguiente, sin chofer, en 'ready') y después cambia la original a 'picked_up' con su recuento. Si la segunda falla
-- (corte de señal, error del guard), quedan DOS órdenes con todos los pallets: duplicados. Y si el chofer reintenta
-- (doble toque, o un reintento tras mala señal), vuelve a partir: otro resto, otra letra, más duplicados.
--
-- QUÉ. Función public.carga_parcial(...): hace las dos escrituras en una sola transacción (si una falla, no queda
-- nada a medias) y es idempotente por clave: el cliente genera p_clave UNA vez por intento; si ya existe un resto con
-- esa clave para esa orden, devuelve el id del resto que ya existe y no crea nada más.
--
-- SECURITY INVOKER a propósito: corre con los permisos de quien la llama. Así RLS y los triggers guard_delivery_stage,
-- guard_relevo y guard_factura_obligatoria se aplican al chofer exactamente igual que antes, en las mismas escrituras.
-- No es un atajo que salte reglas. Lo que copia y cambia es lo mismo que el código de antes:
--   · RESTO (nueva fila): toda la columna de la orden original excepto id, creación/edición, autor, puesto en la ruta
--     (route_seq), GPS de recogida (pickup_lat/lng/gps_at), salida (departed_at), relay_step. Luego: letra siguiente a la
--     mayor de la familia (misma order_no e is_training), est_pallets y actual_pallets = lo que queda, stage 'ready',
--     assigned_driver null, autor = quien llama, created_at/updated_at = now(), y las notas de la original más p_nota_resto.
--   · ORIGINAL: stage 'picked_up', order_suffix = su letra (o 'a'), actual_pallets = p_pallets_cargados, y de p_cambios
--     solo se aceptan los campos de la recogida (pickup_lat, pickup_lng, pickup_gps_at, assigned_driver). est_pallets no cambia.
--   · order_events: 'picked_up' en la original (con p_nota) y 'created' en el resto, igual que hacía el cliente.
-- La clave queda en public.carga_parcial_intentos (una fila por intento, con el resto que creó). Va en tabla aparte y no
-- en una columna de deliveries a propósito: partir_carga, reentrega_como_carga y las demás copian filas enteras con
-- to_jsonb; una columna única se copiaría a la hija y la siguiente partición fallaría por clave duplicada.
--
-- Concurrencia: la función bloquea la orden original con FOR UPDATE ANTES de mirar la clave. Un segundo intento con la
-- misma clave espera a que termine el primero y luego ve el resto ya creado.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero. Idempotente (create ... if not exists, create or replace,
-- drop policy if exists). NO SE APLICA desde la rama: lo aplica el orquestador después del merge.
--
-- Para deshacer: drop function if exists public.carga_parcial(uuid, numeric, uuid, jsonb, text, text);
--                drop table if exists public.carga_parcial_intentos;
--                delete from public.schema_migrations where name = '357_carga_parcial_en_un_paso.sql';
-- ---------------------------------------------------------------------------

create table if not exists public.carga_parcial_intentos (
  clave      uuid primary key,
  orden_id   uuid not null references public.deliveries(id) on delete cascade,
  resto_id   uuid not null references public.deliveries(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.carga_parcial_intentos enable row level security;

drop policy if exists carga_parcial_intentos_leer_propias on public.carga_parcial_intentos;
create policy carga_parcial_intentos_leer_propias on public.carga_parcial_intentos
  for select to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists carga_parcial_intentos_crear_propias on public.carga_parcial_intentos;
create policy carga_parcial_intentos_crear_propias on public.carga_parcial_intentos
  for insert to authenticated
  with check (created_by = (select auth.uid()));

revoke all on public.carga_parcial_intentos from anon, public;
grant select, insert on public.carga_parcial_intentos to authenticated;

create or replace function public.carga_parcial(
  p_orden            uuid,
  p_pallets_cargados numeric,
  p_clave            uuid,
  p_cambios          jsonb default '{}'::jsonb,
  p_nota             text default null,
  p_nota_resto       text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  madre      public.deliveries%rowtype;
  total      numeric;
  letra      text;
  nueva      text;
  nueva_id   uuid := gen_random_uuid();
  ya         uuid;
  etiqueta   text;
  fila       jsonb;
  campo      text;
  permitidos text[] := array['pickup_lat', 'pickup_lng', 'pickup_gps_at', 'assigned_driver'];
begin
  if auth.uid() is null then
    raise exception 'CARGA_FORBIDDEN: sign in to split a load' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'CARGA_CLAVE: the split needs its key';
  end if;
  for campo in select jsonb_object_keys(coalesce(p_cambios, '{}'::jsonb)) loop
    if not (campo = any (permitidos)) then
      raise exception 'CARGA_CAMBIO: % is not a field a load split can set', campo;
    end if;
  end loop;

  -- 1. Bloquear la original ANTES de mirar la clave: así un reintento concurrente espera y ve el resto ya creado.
  select * into madre from public.deliveries d where d.id = p_orden for update;
  if not found then
    raise exception 'CARGA_NOT_FOUND: %', p_orden;
  end if;

  -- 2. Idempotencia: si esta clave ya partió esta orden, se devuelve su resto y no se toca nada más.
  select i.resto_id into ya from public.carga_parcial_intentos i where i.clave = p_clave and i.orden_id = p_orden;
  if found then
    return ya;
  end if;
  if exists (select 1 from public.carga_parcial_intentos i where i.clave = p_clave) then
    raise exception 'CARGA_CLAVE: that split key belongs to another order';
  end if;

  -- 3. Reglas de la partición (las mismas que hacía el cliente antes de llamar).
  if madre.relay_step is not null then
    raise exception 'RELEVO_FIJO: a relay transfer step is not split into loads';
  end if;
  if madre.stage not in ('approved', 'fulfilling', 'ready') then
    raise exception 'CARGA_STAGE: an order in % is not split at pickup', madre.stage;
  end if;
  total := coalesce(madre.actual_pallets, madre.est_pallets, 0);
  if total <= 0 or p_pallets_cargados is null or p_pallets_cargados <= 0 or p_pallets_cargados >= total then
    raise exception 'CARGA_BAD_SPLIT: the loaded count must be more than 0 and less than % (got %)', total, p_pallets_cargados;
  end if;

  -- 4. Letra del resto: la siguiente a la mayor de la familia. Bajo RLS un hermano oculto haría fallar el insert por
  --    la clave única de código+letra (23505), con todo deshecho: nunca deja dos órdenes con la misma letra.
  letra := coalesce(madre.order_suffix, 'a');
  select chr(ascii(max(coalesce(d.order_suffix, 'a'))) + 1) into nueva
    from public.deliveries d where d.order_no = madre.order_no and d.is_training = madre.is_training;
  nueva := coalesce(nueva, 'b');
  if nueva > 'z' then
    raise exception 'CARGA_TOO_MANY: no letters left for #%', madre.order_no;
  end if;
  etiqueta := coalesce(madre.order_code, madre.order_no::text);

  -- 5. RESTO: la fila nueva, copia de la original con lo que el cliente ponía.
  fila := (to_jsonb(madre)
            - array['id', 'created_at', 'updated_at', 'created_by', 'route_seq', 'pickup_lat', 'pickup_lng',
                    'pickup_gps_at', 'departed_at', 'relay_step'])
          || jsonb_build_object(
               'id', nueva_id,
               'order_suffix', nueva,
               'est_pallets', total - p_pallets_cargados,
               'actual_pallets', total - p_pallets_cargados,
               'stage', 'ready',
               'assigned_driver', null,
               'created_by', auth.uid(),
               'created_at', now(),
               'updated_at', now(),
               'delivery_notes', nullif(concat_ws(E'\n', madre.delivery_notes, p_nota_resto), '')
             );
  insert into public.deliveries select * from jsonb_populate_record(null::public.deliveries, fila);

  -- 6. ORIGINAL: sale a la calle con su recuento y su letra. Solo los campos de la recogida (p_cambios ya filtrado).
  update public.deliveries d
     set stage          = 'picked_up',
         order_suffix   = letra,
         actual_pallets = p_pallets_cargados,
         pickup_lat     = coalesce((p_cambios ->> 'pickup_lat')::double precision, d.pickup_lat),
         pickup_lng     = coalesce((p_cambios ->> 'pickup_lng')::double precision, d.pickup_lng),
         pickup_gps_at  = coalesce((p_cambios ->> 'pickup_gps_at')::timestamptz, d.pickup_gps_at),
         assigned_driver = coalesce(p_cambios ->> 'assigned_driver', d.assigned_driver)
   where d.id = p_orden;

  -- 7. Historial, igual que el cliente: una entrada en cada orden.
  insert into public.order_events (delivery_id, kind, note, created_by) values
    (p_orden,  'picked_up', p_nota, auth.uid()),
    (nueva_id, 'created',   null,   auth.uid());

  -- 8. La clave queda guardada en la misma transacción: si algo de arriba falla, no hay clave ni resto.
  insert into public.carga_parcial_intentos (clave, orden_id, resto_id, created_by)
    values (p_clave, p_orden, nueva_id, auth.uid());

  return nueva_id;
end
$function$;

revoke all on function public.carga_parcial(uuid, numeric, uuid, jsonb, text, text) from public, anon;
grant execute on function public.carga_parcial(uuid, numeric, uuid, jsonb, text, text) to authenticated;

do $$
declare
  f record;
begin
  select p.prosecdef, p.proconfig, p.oid into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'carga_parcial';
  if not found then raise exception 'La 357 no creó public.carga_parcial'; end if;
  if f.prosecdef then raise exception 'La 357: carga_parcial debe ser SECURITY INVOKER'; end if;
  if has_function_privilege('anon', f.oid, 'execute') then raise exception 'La 357: anon puede ejecutar carga_parcial'; end if;
  if not has_function_privilege('authenticated', f.oid, 'execute') then raise exception 'La 357: authenticated no puede ejecutar carga_parcial'; end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.carga_parcial_intentos'::regclass) then
    raise exception 'La 357: carga_parcial_intentos sin RLS';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('357_carga_parcial_en_un_paso.sql', '4f232b2144e53c1cc6eae1a07d08433afb7826055d5e0ebeb7d7924c4bc122f5') on conflict (name) do nothing;
