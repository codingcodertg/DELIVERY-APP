-- 288: Subidas — poner límite de tamaño (y tipo donde es seguro) a los buckets que no lo tenían (seguridad, #18) (2026-11-10).
--
-- Los buckets de subida principales (help-files, delivery-photos, delivery-files, warehouse-ops, estimator-...) YA tienen
-- `file_size_limit` y `allowed_mime_types` (el límite real del lado del servidor). Faltaban algunos internos sin tope.
-- Esto es defensa contra abuso (archivos enormes / tipos raros) sin romper las subidas normales: los tamaños son
-- generosos y las listas de tipos son las ya probadas en `delivery-files`.
--
-- Additive/correctivo (solo UPDATE a storage.buckets). 237/280-287 intactas. Para deshacer: volver los valores a null.

-- Listas de tipos reutilizadas (las mismas que ya funcionan en delivery-files / para imágenes).
-- Documentos + imágenes (pdf, office, csv, imágenes): para buckets de archivos.
-- Solo imágenes: para buckets de fotos/capturas.

-- Buckets de imágenes: tope de tamaño + solo imágenes.
update storage.buckets set
  file_size_limit = coalesce(file_size_limit, 10485760),  -- 10 MB
  allowed_mime_types = coalesce(allowed_mime_types, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
where id in ('exception-photos', 'product-images', 'timetracker-screenshots');

-- Buckets de documentos: tope de tamaño + documentos e imágenes (la lista probada de delivery-files).
update storage.buckets set
  file_size_limit = coalesce(file_size_limit, 26214400),  -- 25 MB
  allowed_mime_types = coalesce(allowed_mime_types, array[
    'application/pdf','image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv','text/plain'
  ])
where id in ('customer-files', 'hr-docs', 'resumes', 'po-docs');

-- `app` (instaladores de escritorio, 200 MB) y buckets de sistema se dejan como están.

-- ===========================================================================
-- Autocomprobacion: ninguno de los tocados debe quedar sin tope de tamaño.
-- ===========================================================================
do $chk$
declare n int;
begin
  select count(*) into n from storage.buckets
   where id in ('exception-photos','product-images','timetracker-screenshots','customer-files','hr-docs','resumes','po-docs')
     and file_size_limit is null;
  if n > 0 then raise exception '288: quedaron % buckets sin tope de tamano', n; end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('288_subidas_limites_de_bucket.sql', 'f84e52914f79f40dd78de7804f8f97117dcbb3e40a59d9417ab987b5bf4abf83') on conflict (name) do nothing;
