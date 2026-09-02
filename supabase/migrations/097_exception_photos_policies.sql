-- 097 · El cubo de las fotos de fichaje no tenía NINGUNA política (D-162)
--
-- Síntoma: la pantalla de Auditoría → Photos enseñaba "0 photos" cualquier día que se
-- eligiera, incluso los días que sí tienen fotos. Y la conclusión natural —"la importación de
-- la app vieja no funcionó"— era falsa: los datos estaban enteros.
--
-- ---------------------------------------------------------------------------
-- Lo que se comprobó, en este orden
-- ---------------------------------------------------------------------------
--   · 385 fotos en la base (136 entrada + 112 salida + 137 excepciones), del 10-jul al 30-ago.
--   · Cada `photo_path` cruzado contra `storage.objects`: **137 de 137 existen**, cero rotas.
--   · Mismo `company_id` en fichajes, excepciones y perfiles.
--   · Haciéndose pasar por el admin (`set local role authenticated` + su `sub` en las claims):
--     `auth_is_manager()` = true y **136 fichajes y 137 excepciones visibles**. Las tablas se
--     leen perfectamente.
--
-- O sea que todo estaba bien hasta el último paso: firmar las URLs.
--
--     select count(*) from pg_policies
--      where schemaname='storage' and tablename='objects'
--        and qual::text like '%exception-photos%';   ->  0
--
-- `storage.objects` tiene RLS **encendido**, y sin una sola política que nombre este cubo la
-- respuesta por defecto es "no". `createSignedUrls` devolvía una lista vacía, la pantalla
-- descartaba todas las fotos por no tener URL, y lo que quedaba era un día en blanco.
--
-- Los otros cubos sí tenían las suyas (`resumes`, `timetracker-screenshots`); a este se le
-- pasaron, seguramente porque nació en el proyecto viejo —donde sí las tenía— y al copiar los
-- ficheros se copiaron los objetos y no las reglas. Un cubo sin políticas no da error al
-- crearse ni al escribirse: simplemente no devuelve nada, que es la peor forma de fallar.
--
-- ---------------------------------------------------------------------------
-- Quién puede
-- ---------------------------------------------------------------------------
-- La ruta es `{empresa}/{empleado}/{marca-de-tiempo}.jpg`, así que las dos primeras carpetas
-- son exactamente los dos permisos que hacen falta, sin tener que consultar ninguna tabla:
--
--   · **Leer** — de tu empresa, y o es tuya o eres encargado. La misma frase que gobierna
--     `clockin.time_entries`, y a propósito: la foto y el fichaje que prueba son el mismo
--     hecho, y si se rigen por reglas distintas un día se cambia una y la otra se queda.
--   · **Subir** — solo en tu propia carpeta. Es lo que hace la app al fichar con foto.
--   · **Borrar** — solo encargado. Un fichaje con foto es prueba de una hora que se paga;
--     que cada uno pueda borrar la suya vacía la auditoría de sentido.
--
-- No hay política de UPDATE: una foto no se corrige, se sustituye por otra con su hora.

drop policy if exists "exception photos read"   on storage.objects;
drop policy if exists "exception photos upload" on storage.objects;
drop policy if exists "exception photos delete" on storage.objects;

create policy "exception photos read" on storage.objects for select to authenticated
  using (
    bucket_id = 'exception-photos'
    and (storage.foldername(name))[1] = (select clockin.auth_company_id())::text
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or (select clockin.auth_is_manager())
    )
  );

create policy "exception photos upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exception-photos'
    and (storage.foldername(name))[1] = (select clockin.auth_company_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "exception photos delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'exception-photos'
    and (storage.foldername(name))[1] = (select clockin.auth_company_id())::text
    and (select clockin.auth_is_manager())
  );
