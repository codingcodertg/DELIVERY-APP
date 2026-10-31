-- 223: Entregas — la recogida LIBRE (Otro, Proveedor) tiene su propio punto en el mapa (D-NEXT, 2026-10-31).
--
-- Roberto Rodriguez Jr (admin), con la orden FV594 (Otro, recogida en Harlingen) en el Gestor de Rutas: «Pickup is in
-- harlingen but it put weslaco» y «When order type is Other or Supplier the store sold from does not apply and also
-- pickup is not a store».
--
-- Que habia: el motor de rutas y «Mi ruta» toman el ORIGEN de una orden de la tienda de Ajustes cuyo nombre coincide
-- con `pickup_name` (y si no, `store`). Una recogida libre (D-753) no es una tienda, pero no tenia donde guardar su
-- punto: `pickup_lat/lng` son la posicion del chofer al recoger (GPS), no la del sitio.
--
-- Que hace: dos columnas, `pickup_point_lat` y `pickup_point_lng`: el punto de la direccion de recogida tecleada,
-- geocodificado al guardar la orden (como `delivery_lat/lng` desde D-223/D-589). Solo las llenan las ordenes con
-- recogida libre; en las demas quedan en null y la recogida sigue siendo la tienda. Sin RLS nueva: son columnas de
-- `public.deliveries`, con las politicas y el guard (168) de siempre. Sin begin/commit propios.
-- Para deshacer: alter table public.deliveries drop column pickup_point_lat, drop column pickup_point_lng; borrar la
-- fila del registro.
alter table public.deliveries
  add column if not exists pickup_point_lat double precision,
  add column if not exists pickup_point_lng double precision;
comment on column public.deliveries.pickup_point_lat is '223: punto de la recogida LIBRE (Otro/Proveedor), geocodificado al guardar; null si la recogida es una tienda.';
comment on column public.deliveries.pickup_point_lng is '223: ver pickup_point_lat.';

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deliveries' and column_name = 'pickup_point_lat') then
    raise exception '223: falta pickup_point_lat';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deliveries' and column_name = 'pickup_point_lng') then
    raise exception '223: falta pickup_point_lng';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('223_recogida_libre_con_punto.sql', '7c749e2ae9e05f7c8b537bc835af7f4c4388000062e57bf0c778260421d2dc40') on conflict (name) do nothing;
