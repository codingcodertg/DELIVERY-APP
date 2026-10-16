-- ===========================================================================
-- 179 - Indice por fecha en order_events: la carga del historial deja de recorrer la tabla entera
-- ===========================================================================
-- Medido el 2026-10-15 en produccion (EXPLAIN ANALYZE): `select * from order_events order by created_at desc
-- limit 1000` —lo que baja cada cliente al abrir Entregas y en cada recarga por fila de D-564— hacia un Seq Scan
-- de 6.448 filas y un top-N heapsort: 80 ms y 120 buffers por llamada. La tabla solo tenia indice por `id` y
-- por `delivery_id`. Salio en la investigacion de la caida del 2026-10-15 (D-562) como el coste secundario
-- tras las fotos.
--
-- QUE TRAE: un indice btree por `created_at desc`. Con el, el LIMIT lee las ultimas filas del indice y para.
-- Tambien sirve a la lectura por delivery_id + orden por fecha de la ficha, que ya usa `order_events_delivery_idx`.
--
-- LO QUE NO TOCA: ni datos, ni politicas, ni disparadores, ni codigo de cliente. Es una migracion solo-base:
-- sube `package.json`, no `APP_VERSIONS` (CLAUDE.md, flujo paso 3).
--
-- `if not exists` para que se pueda ensayar y reaplicar; sin `concurrently` porque dentro de una transaccion no
-- se puede, y la tabla es de 1,4 MB: el bloqueo dura milisegundos.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion.
-- ===========================================================================

create index if not exists order_events_created_idx
  on public.order_events (created_at desc);

-- Reversion:
--   drop index if exists public.order_events_created_idx;
--   delete from public.schema_migrations where name = '179_order_events_por_fecha.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('179_order_events_por_fecha.sql', '56774ddda555b39cabd14967cba146b762ce132991e67ad09e5ada04f2ebfbf4') on conflict (name) do nothing;
