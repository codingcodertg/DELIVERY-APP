-- ===========================================================================
-- 153 - El estimado de la competencia en el Estimador: archivos (PDF o foto) pegados a una cotizacion
-- ===========================================================================
-- Plan en papel: docs/PLAN-153-estimados-competencia.md. ESCRITA Y NO APLICADA: aplicarla es del
-- orquestador, despues del merge, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (2026-09-27): "en el estimador app deja que se pueda subir el competitors estimate upload
-- option". El vendedor sube el estimado que le dio otro almacen, pegado a SU cotizacion (148). Es
-- INTERNO: no entra en la hoja del cliente; eso lo garantiza la app (la hoja no recibe estos datos).
--
-- QUE TRAE:
--   1. Un cubo PRIVADO nuevo, 'estimator-competitor-files': 10 MB por archivo, solo PDF y fotos.
--   2. public.estimator_competitor_files: una fila por archivo (nombre, tipo, tamano, quien, cuando, y
--      opcionales: competidor, su total, una nota).
--   3. Un disparador que pone con auth.uid() quien sube y su nombre, toma tamano y tipo del objeto
--      real del cubo, exige que la ruta sea '<quote_id>/...' y corta en 5 archivos por cotizacion.
--   4. RLS: VE quien ve la cotizacion (la subconsulta a estimator_quotes pasa por SU RLS, la de la
--      148); SUBE quien la puede editar (dueno, aprobado, admin: la regla de UPDATE de la 148); QUITA
--      quien lo subio o el admin. Sin UPDATE: lo opcional se escribe al subir.
--   5. Tres politicas de storage.objects para el cubo, por la primera carpeta de la ruta (= quote_id).
--
-- LO QUE NO TOCA: ninguna tabla ni politica existente. Ningun dato.
--
-- AVISO para quien vuelva a correr la 148 entera: su autocomprobacion exige que ninguna tabla
-- 'estimator_%' tenga politica DELETE, y esta la tiene (quitar un archivo). La 148 ya esta aplicada;
-- solo importa si alguien la re-ejecuta a mano.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un
-- commit de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. El cubo. Privado, con su limite y sus tipos: la pantalla avisa, pero quien manda es el cubo,
--    porque una subida se puede hacer sin pasar por la pantalla.
-- ---------------------------------------------------------------------------
-- 10 MB: el mismo numero que help-files (119). Una foto de movil pesa 2-5 MB y un PDF de estimado
-- menos de 1; 10 da margen a un escaneo de varias paginas. Con 5 por cotizacion (seccion 3), el
-- techo es 50 MB por estimado. El 2026-09-25 produccion se cayo por cuota (D-403; segun el
-- orquestador, el cubo de capturas de timetracker lleno el plan): aqui el techo lo pone la base.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'estimator-competitor-files', 'estimator-competitor-files', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. La tabla de metadatos.
-- ---------------------------------------------------------------------------
create table if not exists public.estimator_competitor_files (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references public.estimator_quotes(id) on delete cascade,
  -- La clave dentro del cubo. Empieza por el quote_id (lo exige el disparador).
  path              text not null,
  file_name         text not null,
  mime_type         text not null,
  size_bytes        bigint not null,
  competitor        text,
  competitor_total  numeric(12,2),
  note              text,
  -- Quien lo subio y su nombre, puestos por el disparador. El nombre se copia porque leer el perfil de
  -- otro depende de la RLS de profiles, y la lista tiene que decir quien subio cada cosa.
  uploaded_by       uuid references public.profiles(id) on delete set null,
  uploaded_by_name  text,
  uploaded_at       timestamptz not null default now(),
  constraint estimator_competitor_files_path_unica unique (path),
  constraint estimator_competitor_files_nombre check (length(btrim(file_name)) between 1 and 200),
  constraint estimator_competitor_files_tipo check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')),
  constraint estimator_competitor_files_tamano check (size_bytes > 0 and size_bytes <= 10485760),
  constraint estimator_competitor_files_competidor check (competitor is null or length(competitor) <= 120),
  constraint estimator_competitor_files_total check (competitor_total is null or competitor_total >= 0),
  constraint estimator_competitor_files_nota check (note is null or length(note) <= 500)
);

create index if not exists estimator_competitor_files_quote_idx on public.estimator_competitor_files (quote_id);

-- ---------------------------------------------------------------------------
-- 3. Lo que no decide el navegador.
-- ---------------------------------------------------------------------------
-- Cuantos objetos hay ya en la carpeta de una cotizacion. Definer porque cuenta en storage.objects,
-- cuya RLS no es la de quien pregunta; devuelve solo un numero.
create or replace function public.estimator_competitor_object_count(p_folder text)
  returns integer language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects
   where bucket_id = 'estimator-competitor-files'
     and (storage.foldername(name))[1] = p_folder;
$$;

-- ¿Puede quien pregunta SUBIR a la carpeta de esta cotizacion? La regla de UPDATE de la 148 (dueno,
-- aprobado, admin), con el modulo. Recibe texto porque la carpeta es texto: un nombre que no es un
-- uuid no revienta el cast, simplemente no es ninguna cotizacion.
create or replace function public.estimator_can_attach(p_folder text)
  returns boolean language sql stable security definer set search_path = public as $$
  select public.has_estimator_access()
     and exists (
       select 1 from public.estimator_quotes q
        where q.id::text = p_folder
          and (public.is_admin() or q.owner_id = auth.uid() or public.estimator_has_approval(q.id))
     );
$$;

create or replace function public.estimator_competitor_files_guard()
  returns trigger language plpgsql security definer set search_path = public, storage as $$
declare
  yo  uuid := auth.uid();
  obj record;
  n   int;
begin
  if new.path is null or new.path not like new.quote_id::text || '/%' or position('..' in new.path) > 0 then
    raise exception 'The file path must be inside its quote folder' using errcode = '22023';
  end if;
  -- El objeto tiene que existir: una fila sin archivo seria una lista que miente.
  select o.metadata into obj from storage.objects o
   where o.bucket_id = 'estimator-competitor-files' and o.name = new.path;
  if not found then
    raise exception 'The file was not uploaded' using errcode = '22023';
  end if;
  -- Tamano y tipo del objeto real, no los que dice el navegador (si el cubo los trae).
  new.size_bytes := coalesce(nullif(obj.metadata->>'size', '')::bigint, new.size_bytes);
  new.mime_type  := coalesce(nullif(obj.metadata->>'mimetype', ''), new.mime_type);
  -- Cinco por cotizacion, contando las filas que ya hay.
  select count(*) into n from public.estimator_competitor_files where quote_id = new.quote_id;
  if n >= 5 then
    raise exception 'Up to 5 competitor files per quote' using errcode = '23514';
  end if;
  if yo is not null then
    new.uploaded_by := yo;
  end if;
  new.uploaded_by_name := (select nullif(trim(full_name), '') from public.profiles where id = new.uploaded_by);
  new.uploaded_at := now();
  return new;
end $$;

drop trigger if exists estimator_competitor_files_guard on public.estimator_competitor_files;
create trigger estimator_competitor_files_guard before insert on public.estimator_competitor_files
  for each row execute function public.estimator_competitor_files_guard();

-- ---------------------------------------------------------------------------
-- 4. Privilegios y RLS de la tabla. Una tabla nueva nace con todo concedido a anon y authenticated
--    (medido al ensayar la 126): se revoca y se concede lo justo. Sin UPDATE.
-- ---------------------------------------------------------------------------
revoke all on public.estimator_competitor_files from anon, authenticated;
grant select, insert, delete on public.estimator_competitor_files to authenticated;

alter table public.estimator_competitor_files enable row level security;

drop policy if exists "estimator_competitor_files select" on public.estimator_competitor_files;
drop policy if exists "estimator_competitor_files insert" on public.estimator_competitor_files;
drop policy if exists "estimator_competitor_files delete" on public.estimator_competitor_files;

-- Ver: quien ve la cotizacion. La subconsulta pasa por la RLS de estimator_quotes (148) con la sesion
-- de quien pregunta: dueno, su tienda, aprobado, admin. Sin copiar la regla aqui.
create policy "estimator_competitor_files select" on public.estimator_competitor_files for select to authenticated
  using (
    (select public.has_estimator_access())
    and exists (select 1 from public.estimator_quotes q where q.id = quote_id)
  );

-- Subir: quien puede editar la cotizacion, y a su nombre (el disparador ya lo puso antes de mirar esto).
create policy "estimator_competitor_files insert" on public.estimator_competitor_files for insert to authenticated
  with check (
    public.estimator_can_attach(quote_id::text)
    and uploaded_by = (select auth.uid())
  );

-- Quitar: quien lo subio o el admin, y solo si todavia ve la cotizacion.
create policy "estimator_competitor_files delete" on public.estimator_competitor_files for delete to authenticated
  using (
    (select public.has_estimator_access())
    and ((select public.is_admin()) or uploaded_by = (select auth.uid()))
    and exists (select 1 from public.estimator_quotes q where q.id = quote_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Las politicas del cubo. La primera carpeta de la ruta es el quote_id.
-- ---------------------------------------------------------------------------
drop policy if exists "estimator competitor files read"   on storage.objects;
drop policy if exists "estimator competitor files insert" on storage.objects;
drop policy if exists "estimator competitor files delete" on storage.objects;

-- Leer (firmar un enlace): quien ve la cotizacion, por la misma subconsulta con RLS.
create policy "estimator competitor files read" on storage.objects for select to authenticated
  using (
    bucket_id = 'estimator-competitor-files'
    and (select public.has_estimator_access())
    and exists (select 1 from public.estimator_quotes q where q.id::text = (storage.foldername(name))[1])
  );

-- Subir: quien puede editar la cotizacion, y con menos de 5 objetos ya en su carpeta. Es el techo
-- que importa para la cuota: aunque alguien suba sin pasar por la tabla, la carpeta no pasa de 5.
create policy "estimator competitor files insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'estimator-competitor-files'
    and public.estimator_can_attach((storage.foldername(name))[1])
    and public.estimator_competitor_object_count((storage.foldername(name))[1]) < 5
  );

-- Quitar: quien lo subio (owner_id del objeto, que pone Storage con la sesion) o el admin.
create policy "estimator competitor files delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'estimator-competitor-files'
    and (select public.has_estimator_access())
    and ((select public.is_admin()) or owner_id = (select auth.uid())::text)
  );

revoke execute on function public.estimator_competitor_object_count(text) from public, anon;
revoke execute on function public.estimator_can_attach(text)              from public, anon;
grant execute on function public.estimator_competitor_object_count(text)  to authenticated;
grant execute on function public.estimator_can_attach(text)               to authenticated;

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
do $comprueba$
declare
  n int;
begin
  select count(*) into n from storage.buckets
   where id = 'estimator-competitor-files' and public = false and file_size_limit = 10485760
     and allowed_mime_types @> array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']
     and array_length(allowed_mime_types, 1) = 6;
  if n <> 1 then raise exception '153: el cubo no quedo privado con su limite y sus 6 tipos'; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.estimator_competitor_files'::regclass) then
    raise exception '153: estimator_competitor_files sin RLS';
  end if;
  if has_table_privilege('anon', 'public.estimator_competitor_files', 'select') then
    raise exception '153: anon no debe leer estimator_competitor_files';
  end if;
  if has_table_privilege('authenticated', 'public.estimator_competitor_files', 'update') then
    raise exception '153: authenticated no debe poder actualizar estimator_competitor_files';
  end if;

  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_files';
  if n <> 3 then raise exception '153: estimator_competitor_files debe tener 3 politicas, tiene %', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'estimator_competitor_files'
              and cmd in ('ALL', 'UPDATE')) then
    raise exception '153: una politica de estimator_competitor_files es ALL o UPDATE';
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'estimator competitor files %';
  if n <> 3 then raise exception '153: el cubo debe tener 3 politicas, tiene %', n; end if;

  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_competitor_files'::regclass
                   and tgname = 'estimator_competitor_files_guard' and not tgisinternal) then
    raise exception '153: falta el disparador estimator_competitor_files_guard';
  end if;

  -- La columna que usa la politica de DELETE del cubo existe en esta version de Storage.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    raise exception '153: storage.objects no tiene owner_id';
  end if;
end $comprueba$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK: en el plan (docs/PLAN-153-estimados-competencia.md, seccion 6). Aqui
-- no va ejecutable a proposito: cualquier sentencia de este fichero corre al aplicarlo.
-- ===========================================================================

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia; por eso lleva begin/commit y el fichero no)
-- ---------------------------------------------------------------------------
-- AVISO: el drop de la tabla BORRA los metadatos; los ARCHIVOS del cubo hay que vaciarlos antes con la
-- API de Storage (el panel o storage.from(...).remove), no con un DELETE en storage.objects, que deja
-- el archivo huerfano en el almacenamiento y gastando cuota. Un cubo con objetos no se puede borrar.
--
--   begin;
--   drop policy if exists "estimator competitor files read"   on storage.objects;
--   drop policy if exists "estimator competitor files insert" on storage.objects;
--   drop policy if exists "estimator competitor files delete" on storage.objects;
--   drop table    if exists public.estimator_competitor_files;
--   drop function if exists public.estimator_competitor_files_guard();
--   drop function if exists public.estimator_can_attach(text);
--   drop function if exists public.estimator_competitor_object_count(text);
--   delete from storage.buckets where id = 'estimator-competitor-files';  -- solo si ya esta vacio
--   delete from public.schema_migrations where name = '153_estimados_competencia.sql';
--   commit;
-- La app no se rompe: sin la tabla, la seccion se ve apagada («falta actualizar la base») y el resto
-- del Estimador funciona igual.
-- ===========================================================================

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('153_estimados_competencia.sql', 'e96016bc1a36f8559fa6e21a57c90a35021c90a6329a188786e13b840df0fda0') on conflict (name) do nothing;
