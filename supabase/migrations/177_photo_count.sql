-- ===========================================================================
-- 177 - deliveries.photo_count: cuantas fotos tiene la orden, sin bajarse las fotos
-- ===========================================================================
-- ESCRITA Y NO APLICADA desde la rama: aplicarla es del orquestador, con migrate-status antes y despues.
-- APLICARLA ANTES de publicar el codigo que la acompana: la lista de Entregas pide `photo_count` por nombre (si la
-- columna no existe, el cliente reintenta sin ella, pero vuelve a quedarse sin el conteo).
--
-- POR QUE (medido 2026-10-15). `deliveries.photos` y `photo_meta` guardan las fotos de la entrega en base64 DENTRO de
-- la fila. La lista de la app hacia `select("*")`, y ese dia entraron 4 entregas con ~5 MB de fotos: la lista paso a
-- 6,4 MB por carga, y se recarga entera con cada evento realtime. La app de Entregas se quedaba en «Cargando…» (23 s
-- en una laptop; en los telefonos no terminaba). El dueno: «desde la ultima actualizacion reportan que al abrir el app
-- queda toda en blanco que pasa» y «a mi me aparece que carga y nunca carga».
--
-- La lista deja de pedir `photos` y `photo_meta` (src/lib/columnas-de-la-lista.ts); lo que de ellas necesitaba —
-- cuantas hay (orden entregada sin comprobante, % de comprobante, el contador de la ficha)— lo lee de aqui. La ficha
-- de UNA orden baja sus fotos aparte.
--
-- QUE TRAE:
--   1. `photo_count integer not null default 0`.
--   2. `deliveries_photo_count()` + el disparador `deliveries_photo_count_trg` (BEFORE INSERT OR UPDATE): la base lo
--      calcula siempre a partir de `photos`; lo que mande el cliente en esa columna se pisa.
--   3. El relleno de las filas que ya tienen fotos.
--
-- LO QUE SE DESCARTO: una columna GENERATED ALWAYS ... STORED. Es lo natural, pero `partir_carga` (157) inserta con
-- `insert into public.deliveries select * from jsonb_populate_record(null::public.deliveries, fila)`, y una columna
-- generada no admite valor explicito en un INSERT («cannot insert a non-DEFAULT value into column»): partir una carga
-- habria dejado de funcionar. Con columna normal + disparador, ese insert copia el conteo de la madre y el disparador
-- lo corrige a 0 (la carga nueva nace con `photos` null).
--
-- EL ORDEN DE LOS DISPARADORES. Los BEFORE corren por orden alfabetico: `deliveries_guard_invoice`,
-- `deliveries_guard_stage`, despues `deliveries_photo_count_trg`, `deliveries_touch`... El guard compara la fila
-- entera (`probe is not distinct from OLD`, 173) y le deja al chofer cambiar `photos` y `photo_meta` al entregar; si
-- este disparador corriera ANTES, el guard veria `photo_count` cambiado y rechazaria esa entrega. Por eso el nombre:
-- tiene que ordenar despues de `deliveries_guard_*`. Si se renombra, que siga despues.
--
-- EL RELLENO, con `session_replication_role = replica`: un UPDATE masivo dispararia el guard (que puede rechazar la
-- fila: la columna nueva "cambia"), `deliveries_touch` (todas las ordenes con fotos con `updated_at` de hoy, que es lo
-- que la app usa para ordenar y detectar cambios) y los demas disparadores de deliveries. En modo replica no corre
-- ninguno de usuario; el relleno solo escribe la columna nueva con el valor que el disparador pondria. `set local`:
-- dura hasta el final de la transaccion de quien aplica. Solo las filas con al menos una foto: el resto ya vale 0.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

alter table public.deliveries
  add column if not exists photo_count integer not null default 0;

comment on column public.deliveries.photo_count is
  'Cuantas fotos hay en photos (array jsonb). Lo pone el disparador deliveries_photo_count_trg; la lista de la app lo lee en vez de bajarse las fotos (177).';

create or replace function public.deliveries_photo_count()
  returns trigger language plpgsql set search_path = public as $$
begin
  NEW.photo_count := case when jsonb_typeof(NEW.photos) = 'array' then jsonb_array_length(NEW.photos) else 0 end;
  return NEW;
end $$;

revoke execute on function public.deliveries_photo_count() from public, anon, authenticated;

drop trigger if exists deliveries_photo_count_trg on public.deliveries;
create trigger deliveries_photo_count_trg
  before insert or update on public.deliveries
  for each row execute function public.deliveries_photo_count();

set local session_replication_role = replica;
update public.deliveries
   set photo_count = jsonb_array_length(photos)
 where jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) > 0;
set local session_replication_role = origin;

-- Comprobacion tras aplicar (debe dar 0):
--   select count(*) from public.deliveries
--    where photo_count <> case when jsonb_typeof(photos) = 'array' then jsonb_array_length(photos) else 0 end;
--
-- Reversion (en este orden; el codigo que pide photo_count reintenta sin ella):
--   drop trigger if exists deliveries_photo_count_trg on public.deliveries;
--   drop function if exists public.deliveries_photo_count();
--   alter table public.deliveries drop column if exists photo_count;
--   delete from public.schema_migrations where name = '177_photo_count.sql';

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('177_photo_count.sql', '754a62c4f83580f68e6bf229c76b2594a451e5debdd1327bdf52c81124e78de7') on conflict (name) do nothing;
