-- ===========================================================================
-- 178 - Las fotos de entrega van a Storage (cubo `delivery-photos`); la fila guarda solo rutas
-- ===========================================================================
-- ESCRITA Y NO APLICADA desde la rama: aplicarla es del orquestador, con migrate-status antes y despues.
-- APLICARLA ANTES de publicar el codigo que la acompana: la ficha sube cada foto nueva a este cubo y, si el cubo no
-- existe, la subida falla con error claro y NO se guarda la orden (ni la foto ni la entrega del chofer).
--
-- POR QUE (medido 2026-10-15). `deliveries.photos` (jsonb array) guarda cada foto como `data:image/jpeg;base64,...`
-- (~400 KB-1 MB por orden), y `photo_meta` PESA LO MISMO que `photos` porque esta indexado por la URL de la foto: la
-- clave de cada entrada es el base64 entero otra vez. Una orden con fotos ocupa el doble de lo que ocupan sus fotos,
-- y hoy eso tumbo la instancia. La 177 dejo de bajarlas en la lista; esta las saca de la fila.
-- El dueno: «solo que se descargue lo neesario que se ocupa para ese momento».
--
-- QUE TRAE:
--   1. El cubo `delivery-photos`, PRIVADO: una foto de entrega es la prueba de lo que se entrego y a quien, no es
--      publica. Se ensena con URL firmada (1 h), que el cliente pide solo para la orden que tiene abierta.
--   2. Politicas de Storage sobre `storage.objects`:
--        · leer   - `authenticated` que PUEDA LEER LA ORDEN: la primera carpeta de la ruta es el `id` de la orden
--                   (`<delivery_id>/<marca-de-tiempo>-<n>.jpg`), y el `exists` sobre `public.deliveries` corre con
--                   la RLS de la propia tabla (`auth read deliveries`: chofer sus ordenes, vendedor su tienda...).
--                   Asi la foto se rige por la MISMA regla que la orden sin escribir una funcion nueva: si manana
--                   cambia quien ve una orden, cambia quien ve sus fotos.
--        · subir  - `authenticated` que pueda leer la orden, misma frase. No se exige el permiso de UPDATE de la
--                   orden porque el objeto solo, sin la fila apuntandole, no cambia ninguna orden; lo que cambia la
--                   orden es el UPDATE de `deliveries`, que sigue con su guard y su politica.
--        · borrar - nadie (salvo service-role). Quitar una foto de la rejilla quita su RUTA de `photos` y su entrada
--                   de `photo_meta`; el objeto queda huerfano en el cubo. Es a proposito: una foto de entrega es
--                   prueba, y borrarla de verdad se decide aparte (ver D-565, «Lo que queda»).
--        · no hay UPDATE: una foto no se corrige, se sube otra con su marca de tiempo (como en la 097).
--
-- NO migra las fotos que ya estan en base64 (7 ordenes el 2026-10-15): eso lo hace `scripts/migra-fotos-a-storage.mjs`
-- con service-role, en seco por defecto, idempotente. Una migracion SQL no puede subir objetos al cubo.
--
-- El cliente sigue ensenando una foto vieja `data:` tal cual (compatibilidad): solo firma las que son rutas.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('delivery-photos', 'delivery-photos', false, 5242880, array['image/jpeg'])
  on conflict (id) do nothing;

drop policy if exists "delivery photos read"   on storage.objects;
drop policy if exists "delivery photos upload" on storage.objects;

create policy "delivery photos read" on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-photos'
    and exists (
      select 1 from public.deliveries d
       where d.id::text = (storage.foldername(name))[1]
    )
  );

create policy "delivery photos upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-photos'
    and exists (
      select 1 from public.deliveries d
       where d.id::text = (storage.foldername(name))[1]
    )
  );

-- Comprobacion tras aplicar (debe dar 1 y 2):
--   select count(*) from storage.buckets where id = 'delivery-photos';
--   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
--     and (qual::text like '%delivery-photos%' or with_check::text like '%delivery-photos%');
--
-- Reversion (en este orden; el cubo solo se borra vacio, por eso el delete de objetos va antes):
--   drop policy if exists "delivery photos read"   on storage.objects;
--   drop policy if exists "delivery photos upload" on storage.objects;
--   delete from storage.objects where bucket_id = 'delivery-photos';
--   delete from storage.buckets where id = 'delivery-photos';
--   delete from public.schema_migrations where name = '178_fotos_en_storage.sql';
-- OJO: revertir el cubo sin volver a meter las fotos en las filas deja `photos` apuntando a rutas que no existen.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('178_fotos_en_storage.sql', 'dac0c4090c7241cd1c0784f9e3cb65dc26a38ad68b5718ce92cbe9dfff15ad0a') on conflict (name) do nothing;
