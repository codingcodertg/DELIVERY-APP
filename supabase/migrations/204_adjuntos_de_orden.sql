-- ===========================================================================
-- 204 . Adjuntos de una orden
-- ===========================================================================
-- PEDIDO. Carlos Fuentes (oficina), Entregas: «you can't copy and paste...example, i tried copying an invoice on
-- quickbooks and attach it on the app». El dueño: una sección «Adjuntos» en la orden para pegar, arrastrar o elegir.
--
-- QUE HACE:
--  1. `public.delivery_files`: los documentos de una orden (factura en PDF, capturas). Se borran con la orden.
--  2. Cubo privado `delivery-files` (25 MB, PDF / imágenes / Office), en `<id de la orden>/<nombre unico>`; se abre con
--     un enlace firmado.
--  3. Quien VE la orden lee, sube y quita sus adjuntos: las políticas preguntan `exists (select 1 from public.deliveries
--     d where d.id = ...)`, y esa subconsulta pasa por la RLS de `deliveries` — la visibilidad es la misma, sin copiarla.
--     En el cubo, la orden es la primera carpeta de la ruta.
--
-- Sin begin/commit: quien aplica envuelve el fichero.
--
-- Reversion: `drop table public.delivery_files;`, borrar el cubo `delivery-files` (y sus ficheros), las tres
-- políticas «delivery files bucket *» de storage.objects, y la fila del registro.

create table if not exists public.delivery_files (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  path text not null unique,
  size bigint,
  content_type text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists delivery_files_por_orden on public.delivery_files (delivery_id);

revoke all on public.delivery_files from public, anon, authenticated;
grant select, insert, delete on public.delivery_files to authenticated;
alter table public.delivery_files enable row level security;

drop policy if exists "delivery files read" on public.delivery_files;
create policy "delivery files read" on public.delivery_files for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id));
drop policy if exists "delivery files insert" on public.delivery_files;
create policy "delivery files insert" on public.delivery_files for insert to authenticated
  with check (exists (select 1 from public.deliveries d where d.id = delivery_id) and created_by = auth.uid());
drop policy if exists "delivery files delete" on public.delivery_files;
create policy "delivery files delete" on public.delivery_files for delete to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-files', 'delivery-files', false, 26214400, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "delivery files bucket read"   on storage.objects;
drop policy if exists "delivery files bucket insert" on storage.objects;
drop policy if exists "delivery files bucket delete" on storage.objects;

create policy "delivery files bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-files' and exists (select 1 from public.deliveries d where d.id::text = (storage.foldername(name))[1]));
create policy "delivery files bucket insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-files' and exists (select 1 from public.deliveries d where d.id::text = (storage.foldername(name))[1]));
create policy "delivery files bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'delivery-files' and exists (select 1 from public.deliveries d where d.id::text = (storage.foldername(name))[1]));

-- ===========================================================================
-- Autocomprobacion (mira el catalogo)
-- ===========================================================================
do $chk$
begin
  if not exists (select 1 from pg_class where oid = 'public.delivery_files'::regclass and relrowsecurity) then
    raise exception '204: delivery_files sin RLS';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'delivery_files') <> 3 then
    raise exception '204: se esperaban 3 politicas en delivery_files';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'delivery files bucket %') <> 3 then
    raise exception '204: se esperaban 3 politicas en el cubo';
  end if;
  if not exists (select 1 from storage.buckets where id = 'delivery-files' and not public) then
    raise exception '204: el cubo no existe o es publico';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('204_adjuntos_de_orden.sql', 'e3ef875058a770abf9e496972fa7784aed5a8594047fe1ca5d083d6898c67356') on conflict (name) do nothing;
