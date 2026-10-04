-- ===========================================================================
-- 160 - Las rutas del dia, para todos los del modulo de entregas, SOLO lo minimo (D-467)
-- ===========================================================================
-- El dueno, 2026-10-04, sobre la pestana «Ruta de hoy» (antes «Mapa»): «este mapa lo quiero en el map
-- view que ya esta y que todos los puedan ver», y a la pregunta de si rutas enteras o solo lo que cada
-- rol ya lee: «si rutas completas pero solo ver nada mas».
--
-- EL PROBLEMA: la politica de lectura de `deliveries` (131) deja al chofer solo SUS ordenes y a almacen
-- solo cinco etapas (sin las pendientes), y a quien tiene tiendas marcadas (`visible_stores`), solo
-- esas. Con eso, la ruta de otro chofer no se puede pintar entera para ellos.
--
-- LO QUE SE HACE: **no se toca ninguna politica**. Se anade UNA funcion `security definer` que devuelve,
-- de las ordenes de UN dia, solo las columnas que hacen falta para pintar la ruta en el mapa: quien la
-- lleva, en que puesto, donde se recoge (la tienda), donde se entrega (el punto y la CIUDAD), cuantos
-- pallets, la ventana y la etapa. **Nada de cliente**: ni cuenta, ni contacto, ni telefono, ni correo,
-- ni factura, ni PO/SO, ni tarifa, ni notas, ni la direccion.
--
-- QUIEN LA EJECUTA: `authenticated`, y dentro se comprueba el modulo (`has_deliveries_access()`: admin,
-- o `deliveries` en `module_access`). `anon` y `public` no tienen EXECUTE. Quien no tiene el modulo
-- recibe 42501.
--
-- QUE DIAS: de hoy-7 a hoy+7 (hoy, en la hora del negocio, America/Chicago). Fuera de ahi, cero filas:
-- esto es la ruta del dia, no un historial. El historial sigue detras de la RLS de siempre.
--
-- QUE ORDENES: las del dia pedido que no son de ensenanza (`is_training`) ni estan en borrador,
-- rechazadas o anuladas. El techo por persona de la 131 (`visible_stores`) NO se aplica aqui, a
-- proposito: el pedido es que todos vean las rutas ENTERAS, y lo que se ensena no identifica al cliente.
--
-- Sin `begin`/`commit` propios (ver la nota de la 131): la transaccion la pone quien aplica.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- La CIUDAD de una direccion, sin la direccion
-- ---------------------------------------------------------------------------
-- La orden no guarda la ciudad: solo `delivery_address`, texto libre. La app la saca con
-- `ciudadDeEntrega` (src/lib/ciudad-de-entrega.ts, D-408/D-423); esto es la MISMA lectura para las
-- direcciones con comas: quita el lote/apartamento, quita por el final pais, codigo postal, estado y
-- condado, y del trozo que queda quita el estado y el codigo pegados.
--
-- Lo que NO hace, a proposito: el caso de la direccion escrita sin comas («9 W ROBLES EDINBURG TX»), que
-- la app resuelve con la lista de ciudades conocidas. Aqui, **si el trozo lleva un numero es la calle y
-- se devuelve ''**: de los dos errores posibles (no decir la ciudad, o ensenar la calle a quien no debe
-- verla) esta funcion solo puede permitirse el primero. Una prueba (`rutas-del-dia.test.ts`) compara
-- las dos lecturas con los mismos ejemplos.
create or replace function public.ciudad_de_la_direccion(p_direccion text)
  returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare
  trozos text[];
  ultimo text;
  ciudad text;
begin
  select array_agg(x order by n) into trozos
    from (select btrim(regexp_replace(t, '\s+', ' ', 'g')) as x, n
            from unnest(string_to_array(
                   regexp_replace(coalesce(p_direccion, ''),
                     '(?:\m(?:lote|lot|apt|apartment|unit|ste|suite|sweet|spc|space|trlr)\M\.?|#)\s*#?\s*[a-z]?-?\d+[a-z]?\M', ' ', 'gi'),
                   ',')) with ordinality as s(t, n)) q
   where x <> '';
  if trozos is null then return ''; end if;
  -- El primer trozo es la calle: nunca se quita.
  while cardinality(trozos) > 1 loop
    ultimo := trozos[cardinality(trozos)];
    exit when not (
         ultimo ~* '^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?|estados unidos|m[eé]xico|mx)$'
      or ultimo ~  '^\d{5}(?:-\d{4})?$'
      or ultimo ~  '^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$'
      or ultimo ~* '^(?:tx|texas|tamaulipas|tamps\.?|nuevo le[oó]n|n\.\s?l\.)\.?(?:\s*\d{5}(?:-\d{4})?)?$'
      or ultimo ~* '\mcounty$');
    trozos := trozos[1:cardinality(trozos) - 1];
  end loop;
  ciudad := trozos[cardinality(trozos)];
  ciudad := regexp_replace(ciudad, '[\s.]+\d{5}(?:-\d{4})?$', '');
  ciudad := regexp_replace(ciudad, '\s+[A-Z]{2}\.?$', '');
  ciudad := regexp_replace(ciudad, '\s+(?:texas|tx)\.?$', '', 'i');
  ciudad := regexp_replace(ciudad, '[.\s]+$', '');
  -- Lleva numeros: es la calle. No se ensena.
  if ciudad ~ '\d' then return ''; end if;
  return ciudad;
end;
$$;

revoke execute on function public.ciudad_de_la_direccion(text) from public, anon;
grant execute on function public.ciudad_de_la_direccion(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Las paradas del dia
-- ---------------------------------------------------------------------------
-- LA LISTA BLANCA de columnas es el `returns table`: lo que no esta ahi no sale, pase lo que pase con
-- la tabla. `src/lib/rutas-del-dia.ts` (`COLUMNAS_DE_RUTAS_DEL_DIA`) tiene la misma lista y una prueba
-- las compara; el ensayo del plan (docs/PLAN-160-rutas-del-dia.md, par. 6) la comprueba contra el catalogo.
--
-- Por que cada una:
--   id, order_no, order_code, order_suffix ... el nombre de la orden («FA100b») y su desempate al ordenar
--   stage ................................ pendiente / recogida / entregada (el ✓ del mapa)
--   assigned_driver, route_seq, pickup_seq, load_no ... de quien es y su puesto en la lista (D-443)
--   actual_pallets, est_pallets .......... la carga del camion
--   store, store_lat, store_lng .......... la tienda donde se recoge y su punto (de Ajustes -> Tiendas)
--   delivery_lat, delivery_lng, delivery_city ... donde se entrega: el punto y la ciudad, no la direccion
--   delivery_windows, delivery_date ...... la ventana y el dia
--   delivery_duration, pickup_duration ... lo que el camion pasa parado: sin ellas la llegada estimada
--                                          no seria la del Gestor de Rutas
--   pod_delivered_at, pickup_gps_at ...... la hora real de lo ya hecho («entregada 10:42»)
create or replace function public.rutas_del_dia(p_fecha date)
  returns table (
    id uuid,
    order_no bigint,
    order_code text,
    order_suffix text,
    stage text,
    assigned_driver text,
    route_seq integer,
    pickup_seq numeric,
    load_no integer,
    actual_pallets numeric,
    est_pallets numeric,
    store text,
    store_lat double precision,
    store_lng double precision,
    delivery_lat double precision,
    delivery_lng double precision,
    delivery_city text,
    delivery_windows text,
    delivery_date date,
    delivery_duration text,
    pickup_duration text,
    pod_delivered_at timestamptz,
    pickup_gps_at timestamptz
  )
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  hoy date := (now() at time zone 'America/Chicago')::date;
begin
  -- Solo quien tiene el modulo de entregas (o es admin). Sin sesion, `auth.uid()` es null y esto es falso.
  if not coalesce((select public.has_deliveries_access()), false) then
    raise exception 'rutas_del_dia: requires the deliveries module' using errcode = '42501';
  end if;
  -- La ruta del dia, no un historial.
  if p_fecha is null or p_fecha < hoy - 7 or p_fecha > hoy + 7 then
    return;
  end if;
  return query
    select d.id, d.order_no, d.order_code, d.order_suffix, d.stage, d.assigned_driver, d.route_seq, d.pickup_seq, d.load_no,
           d.actual_pallets, d.est_pallets, d.store,
           t.lat, t.lng,
           d.delivery_lat, d.delivery_lng,
           public.ciudad_de_la_direccion(d.delivery_address),
           d.delivery_windows, d.delivery_date, d.delivery_duration, d.pickup_duration, d.pod_delivered_at, d.pickup_gps_at
      from public.deliveries d
      left join lateral (
        select nullif(s ->> 'lat', '')::double precision as lat, nullif(s ->> 'lng', '')::double precision as lng
          from public.settings st, jsonb_array_elements(coalesce(st.stores, '[]'::jsonb)) s
         where st.id = 1
           and btrim(coalesce(d.store, '')) <> ''
           and lower(btrim(s ->> 'name')) = lower(btrim(d.store))
         limit 1
      ) t on true
     where d.delivery_date = p_fecha
       and not d.is_training
       and d.stage not in ('draft', 'rejected', 'canceled')
     order by d.assigned_driver nulls last, d.route_seq nulls last, d.order_no;
end;
$$;

revoke execute on function public.rutas_del_dia(date) from public, anon;
grant execute on function public.rutas_del_dia(date) to authenticated;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $$
declare
  esperadas text[] := array['id','order_no','order_code','order_suffix','stage','assigned_driver','route_seq','pickup_seq','load_no',
    'actual_pallets','est_pallets','store','store_lat','store_lng','delivery_lat','delivery_lng','delivery_city',
    'delivery_windows','delivery_date','delivery_duration','pickup_duration','pod_delivered_at','pickup_gps_at'];
  devueltas text[];
begin
  select array_agg(a.nombre order by a.n) into devueltas
    from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(nombre, modo, n)
   where p.oid = 'public.rutas_del_dia(date)'::regprocedure and a.modo = 't';
  if devueltas is distinct from esperadas then
    raise exception '160: rutas_del_dia devuelve % y se esperaba %', devueltas, esperadas;
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.rutas_del_dia(date)'::regprocedure) then
    raise exception '160: rutas_del_dia no es security definer';
  end if;
  if has_function_privilege('anon', 'public.rutas_del_dia(date)', 'execute') then
    raise exception '160: anon puede ejecutar rutas_del_dia';
  end if;
  if not has_function_privilege('authenticated', 'public.rutas_del_dia(date)', 'execute') then
    raise exception '160: authenticated no puede ejecutar rutas_del_dia';
  end if;
  -- Las politicas de `deliveries` siguen siendo las cuatro de la 131.
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'deliveries') <> 4 then
    raise exception '160: deliveries ya no tiene sus 4 politicas';
  end if;
  if public.ciudad_de_la_direccion('4500 N 23rd St, McAllen, TX 78504, USA') <> 'McAllen'
     or public.ciudad_de_la_direccion('LOTE #24 9 W ROBLES EDINBURG TX') <> '' then
    raise exception '160: ciudad_de_la_direccion no lee como se espera';
  end if;
end $$;

-- ===========================================================================
-- REVERSION
-- ===========================================================================
-- No hay datos que perder: son dos funciones.
--   begin;
--   drop function if exists public.rutas_del_dia(date);
--   drop function if exists public.ciudad_de_la_direccion(text);
--   delete from public.schema_migrations where name = '160_rutas_del_dia.sql';
--   commit;
-- La app no se rompe: sin la funcion, «Ruta de hoy» pinta lo que cada rol ya podia leer y se lo dice
-- al admin.
-- ===========================================================================
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('160_rutas_del_dia.sql', '5cfe9e9063840e37a876844b9c5846e5dc3ac0d3a2f0e92809a388c153715aa8') on conflict (name) do nothing;
